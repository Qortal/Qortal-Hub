import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../i18n/i18n';

vi.mock('../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

import { ReticulumQAppLinkPreviews } from './ReticulumQAppLinkPreview';

const qtubeLink =
  'qortal://APP/Q-Tube/video/Johnny%20Go%20Vroom/qtube_vid_grizzla-armor-for-the-lynx-s-t_wirangkppk_metadata';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a Q-App link's preview", () => {
  it('shows the Qortal logo for an app without a picture, not a letter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => null }))
    );
    // No picture loads: what Core answers for a name that has none.
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        crossOrigin = '';
        referrerPolicy = '';
        srcset = '';
        sizes = '';
        set src(_value: string) {
          queueMicrotask(() => this.onerror?.());
        }
      }
    );

    render(<ReticulumQAppLinkPreviews source={qtubeLink} />);
    await act(async () => {});

    const header = (await screen.findAllByText('Q-Tube'))[0].parentElement!;
    expect(
      Array.from(header.querySelectorAll('img')).map((img) =>
        img.getAttribute('src')
      )
    ).toEqual([expect.stringContaining('LogoSelected')]);
    expect(header.textContent).toBe('Q-Tube');
  });
});
