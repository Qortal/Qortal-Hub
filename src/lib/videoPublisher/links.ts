/**
 * Where a published video is seen: its qortal:// link (what each app's own
 * "copy link" gives) and the Hub tab that opens it (`addTab` with
 * `{ service: 'APP', name, path }`, as openTorqPost does).
 */
import { torqPostLink } from '../../components/Widgets/quitter/torqFeed';
import type { AppTabTarget, PublishService } from './types';

export const QTUBE_APP_NAME = 'Q-Tube';
export const SUBSCREEN_APP_NAME = 'Subscreen';
export const TORQ_APP_NAME = 'Torq';
export const QSHARE_APP_NAME = 'Q-Share';

const enc = encodeURIComponent;

const appLink = (target: AppTabTarget) =>
  `qortal://APP/${target.name}/${target.path}`;

/** Q-Tube's video page, by the metadata DOCUMENT's identifier. */
export const qtubeVideoTarget = (
  name: string,
  metadataIdentifier: string
): AppTabTarget => ({
  service: 'APP',
  name: QTUBE_APP_NAME,
  path: `video/${enc(name)}/${enc(metadataIdentifier)}`,
});

export const qtubeVideoLink = (name: string, metadataIdentifier: string) =>
  appLink(qtubeVideoTarget(name, metadataIdentifier));

/** Subscreen's title page: a film's DOCUMENT or a series' PLAYLIST. */
export const subscreenTitleTarget = (
  service: Extract<PublishService, 'DOCUMENT' | 'PLAYLIST'>,
  name: string,
  identifier: string
): AppTabTarget => ({
  service: 'APP',
  name: SUBSCREEN_APP_NAME,
  path: `title/${service}/${enc(name)}/${enc(identifier)}`,
});

export const subscreenTitleLink = (
  service: Extract<PublishService, 'DOCUMENT' | 'PLAYLIST'>,
  name: string,
  identifier: string
) => appLink(subscreenTitleTarget(service, name, identifier));

export const torqPostTarget = (
  name: string,
  postIdentifier: string
): AppTabTarget => ({
  service: 'APP',
  name: TORQ_APP_NAME,
  path: `post/${enc(name)}/${enc(postIdentifier)}`,
});

export { torqPostLink };

/** Q-Share's share page, by the share DOCUMENT's identifier. */
export const qshareTarget = (
  name: string,
  metadataIdentifier: string
): AppTabTarget => ({
  service: 'APP',
  name: QSHARE_APP_NAME,
  path: `share/${enc(name)}/${enc(metadataIdentifier)}`,
});

export const qshareLink = (name: string, metadataIdentifier: string) =>
  appLink(qshareTarget(name, metadataIdentifier));
