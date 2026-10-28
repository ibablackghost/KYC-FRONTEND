import { Component, ViewEncapsulation, inject } from '@angular/core';
import {
    FormBuilder,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
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

    submitting = false;
    errorMessage = '';

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
                window.location.href = response.verificationUrl;
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
}
