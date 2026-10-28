import { Component, ViewEncapsulation, inject } from '@angular/core';
import {
    FormBuilder,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import {
    KycService,
    httpErrorMessage,
} from 'app/core/kyc/kyc.service';

@Component({
    selector: 'kyc-account-opening',
    templateUrl: './account-opening.component.html',
    encapsulation: ViewEncapsulation.None,
    imports: [ReactiveFormsModule],
})
export class AccountOpeningComponent {
    private readonly _formBuilder = inject(FormBuilder);
    private readonly _kyc = inject(KycService);
    private readonly _sanitizer = inject(DomSanitizer);

    submitting = false;
    errorMessage = '';
    verificationUrl: SafeResourceUrl | null = null;

    readonly form = this._formBuilder.nonNullable.group({
        firstName: ['', [Validators.required, Validators.minLength(2)]],
        lastName: ['', [Validators.required, Validators.minLength(2)]],
        email: ['', [Validators.required, Validators.email]],
        phone: ['', [Validators.required, Validators.pattern(/^[0-9+\s().-]{8,20}$/)]],
        dateOfBirth: ['', Validators.required],
        consent: [false, Validators.requiredTrue],
    });

    submit(): void {
        this.errorMessage = '';
        if (this.form.invalid) {
            this.form.markAllAsTouched();
            return;
        }

        this.submitting = true;
        const value = this.form.getRawValue();
        this._kyc.openAccount(value).subscribe({
            next: (response) => {
                if (response.account.sessionId) {
                    sessionStorage.setItem('kycSessionId', response.account.sessionId);
                }
                sessionStorage.setItem('kycAccountId', response.account.id);
                const frameUrl = this._frameUrl(response.verificationUrl);
                if (!frameUrl) {
                    this.submitting = false;
                    this.errorMessage = 'Le lien de vérification est invalide.';
                    return;
                }
                this.verificationUrl = frameUrl;
                this.submitting = false;
            },
            error: (error) => {
                this.submitting = false;
                this.errorMessage = httpErrorMessage(
                    error,
                    'La demande n’a pas pu être envoyée.'
                );
            },
        });
    }

    onFrameLoad(event: Event): void {
        const frame = event.target as HTMLIFrameElement;
        try {
            const next = frame.contentWindow?.location;
            if (!next || next.origin !== window.location.origin) {
                return;
            }
            if (next.pathname.startsWith('/verification')) {
                window.location.assign(next.pathname + next.search);
            }
        } catch {
            // La page Didit est encore affichée.
        }
    }

    private _frameUrl(url: string): SafeResourceUrl | null {
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
                return null;
            }
            return this._sanitizer.bypassSecurityTrustResourceUrl(url);
        } catch {
            return null;
        }
    }
}
