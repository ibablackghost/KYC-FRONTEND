import { Component, ViewEncapsulation } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
    selector: 'kyc-nav',
    templateUrl: './kyc-nav.component.html',
    encapsulation: ViewEncapsulation.None,
    imports: [RouterLink, RouterLinkActive, MatButtonModule],
})
export class KycNavComponent {}
