import type { LibraryView } from '../AppsLibrary/libraryView';
import { AppCardEnhanced } from './AppCardEnhanced';

interface PublishedAppCardProps {
  app: any;
  onUpdate: () => void;
  /** Not shown at the moment; kept for the callers that pass it. */
  onViewStats?: () => void;
  myName?: string;
  view?: LibraryView;
}

/**
 * The account's own app or website: the library card, with Update next to
 * Pin and Open.
 */
export const PublishedAppCard = ({
  app,
  onUpdate,
  myName = '',
  view = 'grid',
}: PublishedAppCardProps) => (
  <AppCardEnhanced app={app} myName={myName} onUpdate={onUpdate} view={view} />
);
