import { AppPage } from './AppPage/AppPage';

/** An app's or website's page in the library. */
export const AppInfo = ({ app, myName }) => (
  <AppPage
    app={app}
    key={`${String(app?.service || 'APP').toUpperCase()}:${String(app?.name || '').toLowerCase()}`}
    myName={myName}
  />
);
