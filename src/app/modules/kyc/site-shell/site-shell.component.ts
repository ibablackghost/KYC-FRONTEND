import { Component, ViewEncapsulation } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

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
export class SiteShellComponent {}
