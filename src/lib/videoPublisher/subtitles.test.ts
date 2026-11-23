import { describe, expect, it } from 'vitest';
import records from './__fixtures__/real-records.json';
import { decodeJson, VTT } from './__fixtures__/testData';
import { base64ToBytes } from './encoding';
import {
  buildSubtitleSteps,
  SUBTITLE_MAX_BYTES,
  subtitleIdentifier,
  subtitleIdentifierPrefix,
  subtitleRecord,
} from './subtitles';

describe('subtitle identifiers', () => {
  it("match qapp-core's, as a subtitle on QDN is named", async () => {
    // qapp-core's h6("ENTITY_SUBTITLE") and h14("VIDEO-<name>-<identifier>"),
    // worked out apart from this code (SHA-256, base64 with + → . and / → ~).
    const prefix = await subtitleIdentifierPrefix(
      'Film Owner',
      'qtube_vid_moon-base-2012_AXjUWc'
    );
    expect(prefix).toBe('GYDXhZ-n6L9kG7WlQeS5d-');
    expect(records.subtitleResource.identifier.startsWith(prefix)).toBe(true);
  });

  it('end with 15 random characters and v1', async () => {
    const identifier = await subtitleIdentifier('Name', 'qtube_vid_x_abcdef');
    expect(identifier).toMatch(
      /^GYDXhZ-[A-Za-z0-9.~!]{14}-[A-Za-z0-9]{15}-v1$/
    );
    expect(identifier.length).toBeLessThanOrEqual(64);
  });
});

describe('subtitle records', () => {
  it("have qapp-core's keys, the .vtt as base64", () => {
    const record = subtitleRecord({ language: 'de', vtt: VTT }, 'film.de.vtt');
    expect(Object.keys(record)).toEqual(Object.keys(records.subtitleRecord));
    expect(record.type).toBe('text/vtt');
    expect(new TextDecoder().decode(base64ToBytes(record.subtitleData))).toBe(
      VTT
    );
  });

  it('become FILE steps after the video, titled with the language', async () => {
    const steps = await buildSubtitleSteps({
      key: 'item',
      name: 'Name',
      videoIdentifier: 'qtube_vid_film_abcdef',
      baseName: 'Film',
      tracks: [
        { language: 'en', vtt: VTT },
        { language: 'de', vtt: VTT },
      ],
      dependsOn: ['item:video'],
    });
    expect(steps.map((s) => [s.key, s.service, s.title, s.filename])).toEqual([
      ['item:subtitle:0', 'FILE', 'en', 'Film.en.vtt'],
      ['item:subtitle:1', 'FILE', 'de', 'Film.de.vtt'],
    ]);
    expect(steps[0].identifier).not.toBe(steps[1].identifier);
    expect(steps[0].dependsOn).toEqual(['item:video']);
    expect(decodeJson((steps[1].data as { base64: string }).base64)).toEqual({
      subtitleData: expect.any(String),
      language: 'de',
      filename: 'Film.de.vtt',
      type: 'text/vtt',
    });
  });

  it('refuse a track without a two-letter language, or too big', async () => {
    const build = (language: string, vtt = VTT) =>
      buildSubtitleSteps({
        key: 'k',
        name: 'N',
        videoIdentifier: 'v',
        baseName: 'b',
        tracks: [{ language, vtt }],
        dependsOn: [],
      });
    await expect(build('eng')).rejects.toMatchObject({
      code: 'invalid-language',
    });
    await expect(build('')).rejects.toMatchObject({ code: 'invalid-language' });
    await expect(
      build('en', 'x'.repeat(SUBTITLE_MAX_BYTES + 1))
    ).rejects.toMatchObject({ code: 'subtitle-too-large' });
  });
});
