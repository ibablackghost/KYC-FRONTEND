import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data', 'accounts.json');
const DIDIT_BASE = 'https://verification.didit.me';

loadEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3001);

const TERMINAL_STATUSES = new Set([
    'approved',
    'declined',
    'in review',
    'expired',
    'abandoned',
    'kyc expired',
]);

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);

        if (req.method === 'OPTIONS') {
            send(res, 204, null);
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/health') {
            send(res, 200, {
                ok: true,
                diditConfigured: isDiditConfigured(),
            });
            return;
        }

        if (req.method === 'POST' && url.pathname === '/api/accounts') {
            await createAccount(req, res);
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/accounts') {
            send(res, 200, { accounts: loadAccounts() });
            return;
        }

        const accountMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)$/);
        if (req.method === 'GET' && accountMatch) {
            await getAccount(decodeURIComponent(accountMatch[1]), res);
            return;
        }

        const verificationMatch = url.pathname.match(
            /^\/api\/verifications\/([^/]+)$/
        );
        if (req.method === 'GET' && verificationMatch) {
            await getVerification(decodeURIComponent(verificationMatch[1]), res);
            return;
        }

        send(res, 404, { message: 'Route introuvable.' });
    } catch (error) {
        console.error(error);
        const status = Number(error?.status) || 500;
        send(res, status >= 400 && status < 600 ? status : 500, {
            message:
                error?.message || 'Erreur interne du serveur de vérification.',
        });
    }
});

server.listen(PORT, () => {
    console.log(`API KYC sur http://localhost:${PORT}`);
});

async function createAccount(req, res) {
    const body = await readJson(req);
    const accountInput = validateAccount(body);
    if (accountInput.error) {
        send(res, 400, { message: accountInput.error });
        return;
    }

    const configError = configurationError();
    if (configError) {
        send(res, 503, { message: configError });
        return;
    }

    const now = new Date().toISOString();
    const account = {
        id: randomUUID(),
        ...accountInput.value,
        status: 'Not Started',
        sessionId: null,
        verificationUrl: null,
        verification: null,
        verificationError: null,
        createdAt: now,
        updatedAt: now,
    };

    const appUrl = (process.env.PUBLIC_APP_URL || 'http://localhost:4200').replace(
        /\/$/,
        ''
    );

    let diditResponse;
    try {
        diditResponse = await didit('/v3/session/', {
            method: 'POST',
            body: {
                workflow_id: process.env.DIDIT_WORKFLOW_ID,
                vendor_data: account.id,
                callback: `${appUrl}/verification`,
                callback_method: 'both',
                language: 'fr',
                contact_details: {
                    email: account.email,
                    phone: account.phone,
                    send_notification_emails: false,
                    email_lang: 'fr',
                },
                expected_details: {
                    first_name: account.firstName,
                    last_name: account.lastName,
                    date_of_birth: account.dateOfBirth,
                    expected_document_types: ['ID'],
                },
                metadata: {
                    source: 'ouverture-compte',
                    required_checks: [
                        'id_verification',
                        'liveness',
                        'face_match',
                    ],
                },
            },
        });
    } catch (error) {
        send(res, error.status || 502, {
            message: error.message || 'Impossible de créer la session Didit.',
        });
        return;
    }

    account.sessionId = diditResponse.session_id || null;
    account.verificationUrl = diditResponse.url || null;
    account.status = diditResponse.status || 'Not Started';

    if (!account.verificationUrl) {
        send(res, 502, {
            message: 'Didit n’a pas renvoyé de lien de vérification.',
        });
        return;
    }

    const accounts = loadAccounts();
    accounts.unshift(account);
    saveAccounts(accounts);

    send(res, 201, {
        account: publicAccount(account),
        verificationUrl: account.verificationUrl,
    });
}

async function getAccount(id, res) {
    const accounts = loadAccounts();
    const index = accounts.findIndex((item) => item.id === id);
    if (index === -1) {
        send(res, 404, { message: 'Dossier introuvable.' });
        return;
    }

    const refreshed = await refreshAccount(accounts[index]);
    accounts[index] = refreshed;
    saveAccounts(accounts);
    send(res, 200, { account: publicAccount(refreshed) });
}

async function getVerification(sessionId, res) {
    const accounts = loadAccounts();
    let index = accounts.findIndex((item) => item.sessionId === sessionId);

    if (index === -1) {
        try {
            const decision = await didit(
                `/v3/session/${encodeURIComponent(sessionId)}/decision/`
            );
            if (decision.vendor_data) {
                index = accounts.findIndex(
                    (item) => item.id === decision.vendor_data
                );
                if (index !== -1) {
                    accounts[index].sessionId = sessionId;
                }
            }
            if (index === -1) {
                send(res, 404, {
                    message: 'Aucune ouverture de compte ne correspond à cette vérification.',
                });
                return;
            }
            accounts[index] = applyDecision(accounts[index], decision);
            saveAccounts(accounts);
            send(res, 200, { account: publicAccount(accounts[index]) });
            return;
        } catch (error) {
            send(res, error.status === 404 ? 404 : 502, {
                message:
                    error.message ||
                    'Impossible de récupérer le résultat de la vérification.',
            });
            return;
        }
    }

    const refreshed = await refreshAccount(accounts[index]);
    accounts[index] = refreshed;
    saveAccounts(accounts);
    send(res, 200, { account: publicAccount(refreshed) });
}

async function refreshAccount(account) {
    if (!account.sessionId || isTerminal(account.status) || !isDiditConfigured()) {
        return account;
    }

    try {
        const decision = await didit(
            `/v3/session/${encodeURIComponent(account.sessionId)}/decision/`
        );
        return applyDecision(account, decision);
    } catch (error) {
        return {
            ...account,
            verificationError:
                error.message || 'Actualisation de la vérification impossible.',
            updatedAt: new Date().toISOString(),
        };
    }
}

function applyDecision(account, decision) {
    return {
        ...account,
        status: decision.status || account.status,
        verification: summarizeDecision(decision),
        verificationError: null,
        updatedAt: new Date().toISOString(),
    };
}

function summarizeDecision(decision) {
    const identity = Array.isArray(decision.id_verifications)
        ? decision.id_verifications[0]
        : null;
    const liveness = Array.isArray(decision.liveness_checks)
        ? decision.liveness_checks[0]
        : null;
    const faceMatch = Array.isArray(decision.face_matches)
        ? decision.face_matches[0]
        : null;
    const aml = Array.isArray(decision.aml_screenings)
        ? decision.aml_screenings[0]
        : null;

    return {
        status: decision.status || null,
        document: identity
            ? {
                  status: identity.status || null,
                  type: identity.document_type || null,
                  fullName:
                      identity.full_name ||
                      [identity.first_name, identity.last_name]
                          .filter(Boolean)
                          .join(' ') ||
                      null,
                  nationality: identity.nationality || null,
                  dateOfBirth: identity.date_of_birth || null,
                  documentNumber: maskValue(
                      identity.document_number || identity.personal_number
                  ),
                  expirationDate:
                      identity.expiration_date ||
                      identity.expiry_date ||
                      identity.date_of_expiry ||
                      null,
                  warnings: warningLabels(identity.warnings),
              }
            : null,
        liveness: biometricCheck(liveness),
        faceMatch: biometricCheck(faceMatch),
        accountReady:
            isApprovedStatus(identity?.status) &&
            isApprovedStatus(liveness?.status) &&
            isApprovedStatus(faceMatch?.status),
        workflowGap: workflowGap(decision.features),
        aml: aml
            ? {
                  status: aml.status || null,
                  totalHits:
                      typeof aml.total_hits === 'number' ? aml.total_hits : null,
              }
            : null,
    };
}

function biometricCheck(item) {
    if (!item) {
        return null;
    }

    return {
        status: item.status || null,
        score: typeof item.score === 'number' ? item.score : null,
        present: true,
    };
}

function workflowGap(features) {
    const names = listFeatures(features);
    if (!names.length) {
        return null;
    }

    const missing = [];
    if (!names.some((name) => name.includes('ID'))) {
        missing.push('vérification de la CNI');
    }
    if (!names.some((name) => name.includes('LIVENESS'))) {
        missing.push('détection de présence (Liveness)');
    }
    if (!names.some((name) => name.includes('FACE_MATCH'))) {
        missing.push('correspondance faciale (Face Match)');
    }

    if (!missing.length) {
        return null;
    }

    return `Le workflow Didit ne contient pas : ${missing.join(', ')}. Ajoutez ces étapes dans la console, puis republiez le workflow.`;
}

function listFeatures(features) {
    if (Array.isArray(features)) {
        return features.map((item) => String(item).toUpperCase());
    }
    if (typeof features === 'string' && features.trim()) {
        return features
            .split(/[^A-Za-z0-9_]+/)
            .filter(Boolean)
            .map((item) => item.toUpperCase());
    }
    return [];
}

function isApprovedStatus(status) {
    return String(status || '').trim().toLowerCase() === 'approved';
}

function warningLabels(warnings) {
    if (!Array.isArray(warnings)) {
        return [];
    }

    return warnings
        .slice(0, 5)
        .map((warning) => {
            if (typeof warning === 'string') {
                return warning;
            }
            if (warning && typeof warning === 'object') {
                return (
                    warning.short_description ||
                    warning.message ||
                    warning.risk ||
                    null
                );
            }
            return null;
        })
        .filter(Boolean);
}

function publicAccount(account) {
    return {
        id: account.id,
        firstName: account.firstName,
        lastName: account.lastName,
        email: account.email,
        phone: account.phone,
        dateOfBirth: account.dateOfBirth,
        status: account.status,
        sessionId: account.sessionId,
        verificationUrl: account.verificationUrl,
        verification: account.verification,
        verificationError: account.verificationError,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
    };
}

function validateAccount(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { error: 'Corps de requête invalide.' };
    }
    if (body.consent !== true) {
        return {
            error: 'Le consentement à la vérification d’identité est obligatoire.',
        };
    }

    const firstName = cleanName(body.firstName);
    const lastName = cleanName(body.lastName);
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const dateOfBirth =
        typeof body.dateOfBirth === 'string' ? body.dateOfBirth.trim() : '';

    if (!firstName || !lastName) {
        return { error: 'Le prénom et le nom sont obligatoires.' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { error: 'Adresse e-mail invalide.' };
    }
    if (!/^[0-9+\s().-]{8,20}$/.test(phone)) {
        return { error: 'Numéro de téléphone invalide.' };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || Number.isNaN(Date.parse(dateOfBirth))) {
        return { error: 'Date de naissance invalide.' };
    }

    return {
        value: { firstName, lastName, email, phone, dateOfBirth },
    };
}

function cleanName(value) {
    if (typeof value !== 'string') {
        return '';
    }
    const name = value.trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 80) {
        return '';
    }
    return name;
}

function configurationError() {
    if (!process.env.DIDIT_API_KEY) {
        return 'DIDIT_API_KEY est absente. Ajoutez-la dans server/.env (clé créée dans la console Didit).';
    }
    if (!process.env.DIDIT_WORKFLOW_ID) {
        return 'DIDIT_WORKFLOW_ID est absent. Collez l’identifiant du workflow KYC publié dans server/.env.';
    }
    if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            process.env.DIDIT_WORKFLOW_ID
        )
    ) {
        return 'DIDIT_WORKFLOW_ID doit être l’UUID du workflow publié dans la console Didit.';
    }
    return null;
}

function isDiditConfigured() {
    return configurationError() === null;
}

function isTerminal(status) {
    return TERMINAL_STATUSES.has(String(status || '').trim().toLowerCase());
}

async function didit(pathname, options = {}) {
    const headers = {
        'x-api-key': process.env.DIDIT_API_KEY,
    };
    const init = { method: options.method || 'GET', headers };

    if (options.body) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(options.body);
    }

    const response = await fetch(`${DIDIT_BASE}${pathname}`, init);
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
        const error = new Error(diditErrorMessage(response.status, payload));
        error.status = response.status === 401 || response.status === 403 ? 502 : 502;
        if (response.status === 400) {
            error.status = 400;
        }
        throw error;
    }

    return payload || {};
}

function diditErrorMessage(status, payload) {
    if (payload && typeof payload.detail === 'string') {
        return payload.detail;
    }
    if (payload && typeof payload === 'object') {
        const [field, value] = Object.entries(payload)[0] || [];
        if (field) {
            const text = Array.isArray(value) ? value.join(', ') : String(value);
            return `${field} : ${text}`;
        }
    }
    if (status === 401) {
        return 'La clé API Didit a été refusée.';
    }
    return `Didit a répondu avec le statut ${status}.`;
}

function maskValue(value) {
    if (!value) {
        return null;
    }
    const text = String(value);
    if (text.length <= 4) {
        return '••••';
    }
    return `${'•'.repeat(Math.min(text.length - 4, 8))}${text.slice(-4)}`;
}

function loadAccounts() {
    if (!fs.existsSync(DATA_FILE)) {
        return [];
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveAccounts(accounts) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(accounts, null, 2));
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > 64_000) {
                reject(Object.assign(new Error('Requête trop volumineuse.'), { status: 413 }));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (chunks.length === 0) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch {
                reject(Object.assign(new Error('JSON invalide.'), { status: 400 }));
            }
        });
        req.on('error', reject);
    });
}

function send(res, status, payload) {
    const origin = process.env.PUBLIC_APP_URL || 'http://localhost:4200';
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'no-store',
    });
    res.end(payload === null ? '' : JSON.stringify(payload));
}

function loadEnv(file) {
    if (!fs.existsSync(file)) {
        return;
    }
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const separator = trimmed.indexOf('=');
        if (separator === -1) {
            continue;
        }
        const key = trimmed.slice(0, separator).trim();
        let value = trimmed.slice(separator + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}
