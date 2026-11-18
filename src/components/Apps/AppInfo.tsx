import { AppPage } from './AppPage/AppPage';
import { isLibraryWidget } from './AppsLibrary/widgetLibrary';
import { WidgetPage } from './WidgetPage/WidgetPage';

/** An app's or website's page in the library, or a widget's. */
export const AppInfo = ({ app, myName }) =>
  isLibraryWidget(app) ? (
    <WidgetPage
      key={`widget:${app.name.toLowerCase()}\n${app.identifier ?? ''}`}
      myName={myName}
      widget={app}
    />
  ) : (
    <AppPage
      app={app}
      key={`${String(app?.service || 'APP').toUpperCase()}:${String(app?.name || '').toLowerCase()}`}
      myName={myName}
    />
  );
