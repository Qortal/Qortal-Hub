import { lazy } from 'react';

export const LazyAuthenticatedShell = lazy(() =>
  import('./AuthenticatedShell').then((m) => ({
    default: m.AuthenticatedShell,
  }))
);
