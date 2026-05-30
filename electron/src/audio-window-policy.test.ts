import { describe, expect, it } from 'vitest';
import {
  AUDIO_SURFACE_ENTRY_PATH,
  buildAudioSurfaceScheme,
  buildAudioSurfaceUrl,
  shouldApplyAudioSurfaceIsolationHeaders,
  withAudioSurfaceIsolationHeaders,
} from './audio-window-policy';

describe('audio window policy', () => {
  it('derives the hidden audio surface URL from the main window URL', () => {
    expect(
      buildAudioSurfaceUrl('http://localhost:5173/', 'capacitor-electron')
    ).toBe(`http://localhost:5173${AUDIO_SURFACE_ENTRY_PATH}`);

    expect(
      buildAudioSurfaceUrl(
        'capacitor-electron://-/index.html?foo=bar#hash',
        'capacitor-electron'
      )
    ).toBe(
      `${buildAudioSurfaceScheme('capacitor-electron')}://-${AUDIO_SURFACE_ENTRY_PATH}`
    );
  });

  it('falls back to the custom scheme when the main URL is unavailable', () => {
    expect(buildAudioSurfaceUrl('', 'capacitor-electron')).toBe(
      `${buildAudioSurfaceScheme('capacitor-electron')}://-${AUDIO_SURFACE_ENTRY_PATH}`
    );
  });

  it('applies isolation headers only to registered hidden audio contents', () => {
    const isolatedIds = new Set([42]);
    expect(shouldApplyAudioSurfaceIsolationHeaders(42, isolatedIds)).toBe(true);
    expect(shouldApplyAudioSurfaceIsolationHeaders(7, isolatedIds)).toBe(false);
    expect(shouldApplyAudioSurfaceIsolationHeaders(undefined, isolatedIds)).toBe(
      false
    );
  });

  it('adds COOP/COEP/CORP to the top-level audio-surface document', () => {
    const input = { Existing: ['value'] } as Record<string, string | string[]>;
    expect(
      withAudioSurfaceIsolationHeaders(input, {
        url: 'http://localhost:5173/audio-surface.html',
        resourceType: 'mainFrame',
      })
    ).toEqual({
      Existing: ['value'],
      'Cross-Origin-Opener-Policy': ['same-origin'],
      'Cross-Origin-Embedder-Policy': ['require-corp'],
      'Cross-Origin-Resource-Policy': ['same-origin'],
    });
  });

  it('adds COEP/CORP to same-origin audio-surface subresources', () => {
    const input = { Existing: ['value'] } as Record<string, string | string[]>;
    expect(
      withAudioSurfaceIsolationHeaders(input, {
        url: 'http://localhost:5173/assets/audio-decrypt.worker.js',
        resourceType: 'script',
        origin: 'http://localhost:5173',
      })
    ).toEqual({
      Existing: ['value'],
      'Cross-Origin-Embedder-Policy': ['require-corp'],
      'Cross-Origin-Resource-Policy': ['same-origin'],
    });
  });

  it('adds COEP/CORP to local worker assets even when origin metadata is absent', () => {
    const input = { Existing: ['value'] } as Record<string, string | string[]>;
    expect(
      withAudioSurfaceIsolationHeaders(input, {
        url: 'http://localhost:5173/assets/gcall-opus-fec.worker-DRxn6HUk.js',
        resourceType: 'worker',
      })
    ).toEqual({
      Existing: ['value'],
      'Cross-Origin-Embedder-Policy': ['require-corp'],
      'Cross-Origin-Resource-Policy': ['same-origin'],
    });
  });

  it('adds COEP/CORP to local wasm assets even when origin metadata is absent', () => {
    const input = { Existing: ['value'] } as Record<string, string | string[]>;
    expect(
      withAudioSurfaceIsolationHeaders(input, {
        url: 'http://localhost:5173/assets/opus-decoder.wasm',
        resourceType: 'other',
      })
    ).toEqual({
      Existing: ['value'],
      'Cross-Origin-Embedder-Policy': ['require-corp'],
      'Cross-Origin-Resource-Policy': ['same-origin'],
    });
  });

  it('does not force CORP onto cross-origin resources loaded by the audio surface', () => {
    const input = { Existing: ['value'] } as Record<string, string | string[]>;
    expect(
      withAudioSurfaceIsolationHeaders(input, {
        url: 'https://api.example.com/data.json',
        resourceType: 'xhr',
        origin: 'http://localhost:5173',
      })
    ).toEqual({
      Existing: ['value'],
    });
  });

  it('passes through unchanged when request details are unavailable', () => {
    const input = { Existing: ['value'] } as Record<string, string | string[]>;
    expect(withAudioSurfaceIsolationHeaders(input)).toEqual({
      Existing: ['value'],
    });
  });

  it('treats referrer origin as the same-origin signal when origin is absent', () => {
    const input = { Existing: ['value'] } as Record<string, string | string[]>;
    expect(
      withAudioSurfaceIsolationHeaders(input, {
        url: 'capacitor-electron://-/assets/audio-decrypt.worker.js',
        resourceType: 'script',
        referrer: 'capacitor-electron://-/audio-surface.html',
      })
    ).toEqual({
      Existing: ['value'],
      'Cross-Origin-Embedder-Policy': ['require-corp'],
      'Cross-Origin-Resource-Policy': ['same-origin'],
    });
  });
});
