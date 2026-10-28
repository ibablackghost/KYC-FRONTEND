import { Component, OnInit, ViewEncapsulation, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { KycService, httpErrorMessage } from 'app/core/kyc/kyc.service';

@Component({
    selector: 'kyc-site-shell',
    templateUrl: './site-shell.component.html',
    encapsulation: ViewEncapsulation.None,
    imports: [RouterLink, RouterLinkActive, RouterOutlet],
    styles: [
        `
            :host {
                display: block;
                flex: 1 1 100%;
                width: 100%;
                max-width: 100%;
                min-width: 0;
            }
        `,
    ],
})
export class SiteShellComponent implements OnInit {
    private readonly _kyc = inject(KycService);

    diditConfigured: boolean | null = null;
    healthMessage = '';

    ngOnInit(): void {
        this._kyc.health().subscribe({
            next: (health) => {
                this.diditConfigured = health.diditConfigured;
            },
            error: (error) => {
                this.healthMessage = httpErrorMessage(
                    error,
                    'Le serveur de vérification est injoignable.'
                );
            },
        });
    }
}
