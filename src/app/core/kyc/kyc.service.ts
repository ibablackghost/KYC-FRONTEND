import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from 'environments/environment';
import { Observable } from 'rxjs';

export interface IdentityDocumentSummary {
    status: string | null;
    type: string | null;
    fullName: string | null;
    nationality: string | null;
    dateOfBirth: string | null;
    documentNumber: string | null;
    expirationDate: string | null;
    warnings: string[];
}

export interface BiometricCheck {
    status: string | null;
    score: number | null;
    present: boolean;
}

export interface VerificationSummary {
    status: string | null;
    document: IdentityDocumentSummary | null;
    liveness: BiometricCheck | null;
    faceMatch: BiometricCheck | null;
    accountReady: boolean;
    workflowGap: string | null;
    aml: {
        status: string | null;
        totalHits: number | null;
    } | null;
}

export interface AccountApplication {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    dateOfBirth: string;
    status: string;
    sessionId: string | null;
    verificationUrl: string | null;
    verification: VerificationSummary | null;
    verificationError: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface OpenAccountPayload {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    dateOfBirth: string;
    consent: boolean;
}

export interface OpenAccountResponse {
    account: AccountApplication;
    verificationUrl: string;
}

export interface HealthStatus {
    ok: boolean;
    diditConfigured: boolean;
}

const STATUS_LABELS: Record<string, string> = {
    approved: 'Approuvé',
    declined: 'Refusé',
    'in review': 'En revue',
    'in progress': 'En cours',
    'not started': 'Non commencé',
    'awaiting user': 'En attente du client',
    resubmitted: 'Renvoyé',
    expired: 'Expiré',
    'kyc expired': 'KYC expiré',
    abandoned: 'Abandonné',
};

@Injectable({ providedIn: 'root' })
export class KycService {
    private readonly _http = inject(HttpClient);
    private readonly _json = {
        headers: new HttpHeaders({ 'Content-Type': 'application/json' }),
        withCredentials: false,
    };

    openAccount(payload: OpenAccountPayload): Observable<OpenAccountResponse> {
        return this._http.post<OpenAccountResponse>(
            this._url('/api/accounts/'),
            payload,
            this._json
        );
    }

    listAccounts(): Observable<{ accounts: AccountApplication[] }> {
        return this._http.get<{ accounts: AccountApplication[] }>(
            this._url('/api/accounts/'),
            this._json
        );
    }

    getAccount(id: string): Observable<{ account: AccountApplication }> {
        return this._http.get<{ account: AccountApplication }>(
            this._url(`/api/accounts/${id}/`),
            this._json
        );
    }

    getVerification(sessionId: string): Observable<{ account: AccountApplication }> {
        return this._http.get<{ account: AccountApplication }>(
            this._url(`/api/verifications/${sessionId}/`),
            this._json
        );
    }

    health(): Observable<HealthStatus> {
        return this._http.get<HealthStatus>(this._url('/api/health/'), this._json);
    }

    private _url(path: string): string {
        return `${this._apiBase()}${path}`;
    }

    private _apiBase(): string {
        if (typeof window !== 'undefined') {
            const host = window.location.hostname;
            if (host !== 'localhost' && host !== '127.0.0.1') {
                return window.location.origin;
            }
        }
        return environment.apiUrl.replace(/\/$/, '');
    }
}

export function withLastKnownVerification(
    previous: AccountApplication | null,
    incoming: AccountApplication
): AccountApplication {
    if (
        previous?.verification &&
        incoming.verificationError &&
        !incoming.verification
    ) {
        return { ...incoming, verification: previous.verification };
    }
    return incoming;
}

export function kycStatusLabel(status: string | null | undefined): string {
    const key = (status ?? '').trim().toLowerCase();
    if (!key) {
        return 'En attente';
    }
    return STATUS_LABELS[key] ?? status;
}

export function kycStatusTone(
    status: string | null | undefined
): 'ok' | 'no' | 'wait' | 'idle' {
    const key = (status ?? '').trim().toLowerCase();
    if (key === 'approved') {
        return 'ok';
    }
    if (key === 'declined' || key === 'expired' || key === 'abandoned' || key === 'kyc expired') {
        return 'no';
    }
    if (key === 'in review' || key === 'in progress' || key === 'resubmitted') {
        return 'wait';
    }
    return 'idle';
}

export function formatKycScore(score: number | null | undefined): string | null {
    if (typeof score !== 'number' || Number.isNaN(score)) {
        return null;
    }

    const text = new Intl.NumberFormat('fr-FR', {
        maximumFractionDigits: 1,
    }).format(score);
    return `${text} %`;
}

export function isTerminalKycStatus(status: string | null | undefined): boolean {
    const key = (status ?? '').trim().toLowerCase();
    return (
        key === 'approved' ||
        key === 'declined' ||
        key === 'in review' ||
        key === 'expired' ||
        key === 'abandoned' ||
        key === 'kyc expired'
    );
}

function readErrorMessage(body: unknown): string | null {
    if (!body || typeof body !== 'object') {
        return null;
    }
    const message = (body as { message?: unknown }).message;
    return typeof message === 'string' ? message : null;
}

export function httpErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
        const body = error.error;
        const message = readErrorMessage(body);
        if (message) {
            return message;
        }
        if (error.status === 0) {
            return 'Le serveur Django est injoignable. Lancez-le sur http://127.0.0.1:8000.';
        }
    }
    return fallback;
}
