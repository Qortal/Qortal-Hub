/**
 * Subtitles as qapp-core's video player reads them (Q-Tube, Subscreen and
 * Torq all use it): one FILE per track, under the video publisher's name,
 * found by an identifier prefix hashed from the VIDEO it belongs to.
 *
 * qapp-core: buildLooseIdentifier(ENTITY_SUBTITLE, `VIDEO-<name>-<id>`)
 *   = `<h6(ENTITY_SUBTITLE)>-<h14(parent)>-<15 random alnum>-v1`
 * where hN = SHA-256, base64 with + → . and / → ~, no padding, N chars.
 */
import { qappCoreHash } from '../../components/Widgets/quitter/torqFeed';
import { VideoPublishError } from './errors';
import {
  base64ByteLength,
  jsonToBase64,
  textToBase64,
  utf8Bytes,
} from './encoding';
import { randomAlphanumeric } from './ids';
import { normalizeLanguage } from './languages';
import type { PublishStep, SubtitleTrack } from './types';

const ENTITY_SUBTITLE = 'ENTITY_SUBTITLE';
const IDENTIFIER_VERSION = 'v1';
export const SUBTITLE_SERVICE = 'FILE';
export const SUBTITLE_MIME_TYPE = 'text/vtt';
/** The players' import limit for one subtitle file. */
export const SUBTITLE_MAX_BYTES = 2 * 1024 * 1024;

/** What the players search for: every subtitle of this VIDEO. */
export async function subtitleIdentifierPrefix(
  name: string,
  videoIdentifier: string
): Promise<string> {
  const [entity, parent] = await Promise.all([
    qappCoreHash(ENTITY_SUBTITLE, 6, ''),
    qappCoreHash(`VIDEO-${name}-${videoIdentifier}`, 14, ''),
  ]);
  return `${entity}-${parent}-`;
}

export async function subtitleIdentifier(
  name: string,
  videoIdentifier: string
): Promise<string> {
  const prefix = await subtitleIdentifierPrefix(name, videoIdentifier);
  return `${prefix}${randomAlphanumeric(15)}-${IDENTIFIER_VERSION}`;
}

export const subtitleFileName = (baseName: string, language: string) =>
  `${baseName}.${language}.vtt`;

/** The record's JSON, keys in qapp-core's order. */
export type SubtitleRecord = {
  subtitleData: string;
  language: string;
  filename: string;
  type: typeof SUBTITLE_MIME_TYPE;
};

export function subtitleRecord(
  track: SubtitleTrack,
  filename: string
): SubtitleRecord {
  return {
    subtitleData: textToBase64(track.vtt),
    language: track.language,
    filename,
    type: SUBTITLE_MIME_TYPE,
  };
}

/** Refuses a track the players would drop or couldn't list. */
export function assertSubtitleTrack(track: SubtitleTrack): void {
  if (!track.language || normalizeLanguage(track.language) !== track.language) {
    throw new VideoPublishError('invalid-language', track.language);
  }
  const bytes = utf8Bytes(track.vtt).length;
  if (bytes > SUBTITLE_MAX_BYTES) {
    throw new VideoPublishError('subtitle-too-large', String(bytes));
  }
}

/**
 * One FILE step per track, titled with its language code (the players drop
 * a subtitle without one). They come after the VIDEO, before the listing.
 */
export async function buildSubtitleSteps({
  key,
  name,
  videoIdentifier,
  baseName,
  tracks,
  dependsOn,
}: {
  key: string;
  name: string;
  videoIdentifier: string;
  baseName: string;
  tracks: readonly SubtitleTrack[];
  dependsOn: string[];
}): Promise<PublishStep[]> {
  tracks.forEach(assertSubtitleTrack);
  const used = new Set<string>();
  const steps: PublishStep[] = [];
  for (const [index, track] of tracks.entries()) {
    let identifier = await subtitleIdentifier(name, videoIdentifier);
    while (used.has(identifier)) {
      identifier = await subtitleIdentifier(name, videoIdentifier);
    }
    used.add(identifier);
    const filename = subtitleFileName(baseName, track.language);
    const base64 = jsonToBase64(subtitleRecord(track, filename));
    steps.push({
      key: `${key}:subtitle:${index}`,
      kind: 'subtitle',
      service: SUBTITLE_SERVICE,
      identifier,
      title: track.language,
      filename,
      data: { base64 },
      dependsOn,
      bytes: base64ByteLength(base64),
    });
  }
  return steps;
}
