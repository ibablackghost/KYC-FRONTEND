import { Component, DestroyRef, OnInit, ViewEncapsulation, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
    AccountApplication,
    KycService,
    formatKycScore,
    httpErrorMessage,
    isTerminalKycStatus,
    kycStatusLabel,
    kycStatusTone,
    withLastKnownVerification,
} from 'app/core/kyc/kyc.service';
import { interval, startWith, switchMap, take, takeWhile } from 'rxjs';

@Component({
    selector: 'kyc-verification-result',
    templateUrl: './verification-result.component.html',
    encapsulation: ViewEncapsulation.None,
    imports: [RouterLink],
})
export class VerificationResultComponent implements OnInit {
    private readonly _route = inject(ActivatedRoute);
    private readonly _kyc = inject(KycService);
    private readonly _destroyRef = inject(DestroyRef);

    account: AccountApplication | null = null;
    loading = true;
    errorMessage = '';
    waiting = false;
    stalled = false;
    private _sessionId = '';

    readonly statusLabel = kycStatusLabel;
    readonly scoreLabel = formatKycScore;
    readonly tone = kycStatusTone;

    ngOnInit(): void {
        this._sessionId =
            this._route.snapshot.queryParamMap.get('verificationSessionId') ||
            sessionStorage.getItem('kycSessionId') ||
            '';

        if (!this._sessionId) {
            this.loading = false;
            this.errorMessage =
                'Aucune vérification en cours. Reprenez depuis une nouvelle demande.';
            return;
        }

        this._watch();
    }

    refresh(): void {
        if (!this._sessionId || this.waiting) {
            return;
        }
        this.stalled = false;
        this._watch();
    }

    private _watch(): void {
        this.waiting = true;
        interval(3000)
            .pipe(
                startWith(0),
                take(20),
                switchMap(() => this._kyc.getVerification(this._sessionId)),
                takeWhile(
                    (response) => !isTerminalKycStatus(response.account.status),
                    true
                ),
                takeUntilDestroyed(this._destroyRef)
            )
            .subscribe({
                next: (response) => {
                    this.account = withLastKnownVerification(
                        this.account,
                        response.account
                    );
                    this.loading = false;
                    this.waiting = !isTerminalKycStatus(this.account.status);
                    this.errorMessage = '';
                },
                error: (error) => {
                    this.loading = false;
                    this.waiting = false;
                    this.errorMessage = httpErrorMessage(
                        error,
                        'Impossible de lire le résultat de la vérification.'
                    );
                },
                complete: () => {
                    this.waiting = false;
                    this.stalled = !!this.account && !isTerminalKycStatus(this.account.status);
                },
            });
    }
}
