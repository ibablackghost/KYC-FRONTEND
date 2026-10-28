import { Routes } from '@angular/router';
import { SiteShellComponent } from 'app/modules/kyc/site-shell/site-shell.component';

export default [
    {
        path: '',
        component: SiteShellComponent,
        children: [
            {
                path: 'ouvrir-compte',
                loadChildren: () =>
                    import('app/modules/kyc/account-opening/account-opening.routes'),
            },
            {
                path: 'verification',
                loadChildren: () =>
                    import(
                        'app/modules/kyc/verification-result/verification-result.routes'
                    ),
            },
            {
                path: 'dossiers',
                loadChildren: () =>
                    import('app/modules/kyc/dossiers/dossiers.routes'),
            },
        ],
    },
] as Routes;
