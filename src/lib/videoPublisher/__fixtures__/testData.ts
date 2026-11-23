/** Shared test inputs (imported by *.test.ts only). */
import { base64ToBytes } from '../encoding';
import type { ConvertedVideo } from '../types';

export const COVER = 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4';
export const FRAMES = [1, 2, 3, 4].map(
  (n) => `data:image/webp;base64,UklGR${n}AAAABXRUJQVlA4`
);

export const convertedVideo = (
  overrides: Partial<ConvertedVideo> = {}
): ConvertedVideo => ({
  data: new Blob(['mp4']),
  size: 1_385_868_608,
  durationSec: 5118.780333,
  width: 854,
  height: 480,
  ...overrides,
});

export const decodeJson = (base64: string): unknown =>
  JSON.parse(new TextDecoder().decode(base64ToBytes(base64)));

export const stepJson = (step: { data: unknown }): any => {
  const data = step.data as { base64?: string };
  if (!data.base64) throw new Error('not a base64 step');
  return decodeJson(data.base64);
};

export const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHällo\n';

export const last = <T>(items: readonly T[]): T => items[items.length - 1];
