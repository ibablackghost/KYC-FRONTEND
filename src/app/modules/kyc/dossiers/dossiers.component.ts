import { DatePipe } from '@angular/common';
import { Component, OnInit, ViewEncapsulation, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
    AccountApplication,
    KycService,
    httpErrorMessage,
    kycStatusLabel,
    kycStatusTone,
} from 'app/core/kyc/kyc.service';

@Component({
    selector: 'kyc-dossiers',
    templateUrl: './dossiers.component.html',
    encapsulation: ViewEncapsulation.None,
    imports: [RouterLink, DatePipe],
})
export class DossiersComponent implements OnInit {
    private readonly _kyc = inject(KycService);

    accounts: AccountApplication[] = [];
    loading = true;
    errorMessage = '';
    refreshingId = '';

    readonly statusLabel = kycStatusLabel;
    readonly tone = kycStatusTone;

    ngOnInit(): void {
        this._load();
    }

    refresh(account: AccountApplication): void {
        this.refreshingId = account.id;
        this._kyc.getAccount(account.id).subscribe({
            next: (response) => {
                this.accounts = this.accounts.map((item) =>
                    item.id === response.account.id ? response.account : item
                );
                this.refreshingId = '';
            },
            error: (error) => {
                this.refreshingId = '';
                this.errorMessage = httpErrorMessage(
                    error,
                    'Impossible d’actualiser ce dossier.'
                );
            },
        });
    }

    private _load(): void {
        this.loading = true;
        this._kyc.listAccounts().subscribe({
            next: (response) => {
                this.accounts = response.accounts;
                this.loading = false;
            },
            error: (error) => {
                this.loading = false;
                this.errorMessage = httpErrorMessage(
                    error,
                    'Impossible de charger les dossiers.'
                );
            },
        });
    }
}
