import { describe, expect, it } from 'vitest';
import i18n from '../../i18n/i18n';
import { fakeProbe } from '../../test/mocks/videoTool';
import {
  channelLayout,
  containerName,
  leftOutText,
  probeSummary,
} from './format';

const t = i18n.t.bind(i18n);

describe('format', () => {
  it('says mono and stereo, and keeps surround layouts', () => {
    expect(channelLayout(t, 1)).toBe('mono');
    expect(channelLayout(t, 2)).toBe('stereo');
    expect(channelLayout(t, 6)).toBe('5.1');
    expect(channelLayout(t, 8)).toBe('7.1');
    expect(
      probeSummary(
        t,
        fakeProbe({
          audio: [{ index: 1, codec: 'ac3', channels: 1, isDefault: true }],
        })
      )
    ).toBe('H.264 · AC-3 mono');
  });

  it('names what was left out and why, three files at most', () => {
    expect(leftOutText(t, 'en', [{ name: 'song.flac', reason: 'audio' }])).toBe(
      'Left out: song.flac (audio only).'
    );
    expect(
      leftOutText(t, 'en', [
        { name: 'a.srt', reason: 'subtitle' },
        { name: 'b.txt', reason: 'other' },
        { name: 'c.mp3', reason: 'audio' },
        { name: 'd.txt', reason: 'other' },
      ])
    ).toBe(
      'Left out: a.srt (no video named like it), b.txt (not a video), c.mp3 (audio only) and 1 more.'
    );
  });

  it('names the original file type from what ffprobe found', () => {
    const of = (container: string, name: string) =>
      containerName(fakeProbe({ container }), name);
    expect(of('matroska,webm', 'Night Walk.mkv')).toBe('MKV');
    expect(of('matroska,webm', 'clip.webm')).toBe('WebM');
    expect(of('mov,mp4,m4a,3gp,3g2,mj2', 'phone.MOV')).toBe('MOV');
    expect(of('mov,mp4,m4a,3gp,3g2,mj2', 'film.mp4')).toBe('MP4');
    // A wrong extension doesn't win over what's inside.
    expect(of('avi', 'Old Home Movie.mp4')).toBe('AVI');
    expect(of('mov,mp4,m4a,3gp,3g2,mj2', 'renamed.avi')).toBe('MP4');
    expect(of('mpeg', 'VTS_01_1.VOB')).toBe('VOB');
    expect(of('mpegts', 'record.m2ts')).toBe('M2TS');
    expect(of('asf', 'old.wmv')).toBe('WMV');
    expect(of('flv', 'x')).toBe('FLV');
  });
});
