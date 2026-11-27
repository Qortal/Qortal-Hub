import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
}));
vi.mock('../../../hooks/useQortalMessageListener', () => ({
  useQortalMessageListener: () => ({
    path: '',
    history: {},
    resetHistory: vi.fn(),
  }),
}));
vi.mock('../../Theme/ThemeContext', () => ({
  useThemeContext: () => ({ themeMode: 'dark' }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}));

import { AppViewer } from '../AppViewer';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const stubGuest = () => {
  const prepare = vi.fn().mockResolvedValue({
    partition: 'test-partition',
    preload: 'file:///test/qapp-guest-preload.js',
  });
  const release = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('electronAPI', {
    qappGuestPrepare: prepare,
    qappGuestRelease: release,
  });
  return { prepare, release };
};

// A private app as useHandlePrivateApps opens it: its publisher's name, its
// own identifier, at its preview address.
const privateApp = (identifier: string) => ({
  tabId: `tab-${identifier}`,
  name: 'Publisher',
  service: 'DOCUMENT',
  identifier,
  url: `http://localhost:12391/render/hash/HashOf${identifier}?secret=s`,
  isPreview: true,
  isPrivate: true,
  privateAppProperties: {
    name: 'Publisher',
    service: 'DOCUMENT',
    identifier,
    appName: identifier,
  },
});

describe('AppViewer guest owner, for the app’s zoom', () => {
  it('names a private app’s own resource, so its zoom is its own', async () => {
    const { prepare } = stubGuest();
    render(<AppViewer app={privateApp('Tools')} isDevMode={false} />);

    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    expect(prepare.mock.calls[0][0]).toEqual({
      tabId: 'tab-Tools',
      name: 'Publisher',
      service: 'DOCUMENT',
      identifier: 'Tools',
    });
  });

  it('leaves a Q-App’s owner as it was', async () => {
    const { prepare } = stubGuest();
    render(
      <AppViewer
        app={{
          tabId: 'tab-1',
          name: 'Opened-App',
          service: 'APP',
          identifier: 'x',
        }}
        isDevMode={false}
      />
    );

    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    expect(prepare.mock.calls[0][0]).toEqual({
      tabId: 'tab-1',
      name: 'Opened-App',
      service: 'APP',
    });
  });

  it('keeps the guest when the tab is drawn again with a new object', async () => {
    const { prepare, release } = stubGuest();
    const { rerender } = render(
      <AppViewer app={privateApp('Tools')} isDevMode={false} />
    );
    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));

    // The tab list hands over a new object with the same app in it.
    rerender(<AppViewer app={privateApp('Tools')} isDevMode={false} />);
    rerender(<AppViewer app={{ ...privateApp('Tools') }} isDevMode={false} />);
    expect(release).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
