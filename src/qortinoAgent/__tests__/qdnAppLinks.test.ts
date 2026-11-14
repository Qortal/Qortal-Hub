import { beforeEach, describe, expect, it, vi } from 'vitest';

const events = vi.hoisted(() => ({ executeEvent: vi.fn() }));
vi.mock('../../utils/events', () => events);

import { openQortalDeepLink } from '../qdnAppLinks';

describe('qortal:// links in Qortino answers', () => {
  beforeEach(() => {
    events.executeEvent.mockClear();
  });

  it('opens an app link in a Hub tab, without trailing punctuation', () => {
    openQortalDeepLink('qortal://APP/Q-Tube.');
    expect(events.executeEvent).toHaveBeenCalledWith('addTab', {
      data: expect.objectContaining({
        service: 'APP',
        name: 'Q-Tube',
        navigateIfAlreadyOpen: true,
      }),
    });
    expect(events.executeEvent).toHaveBeenCalledWith('open-apps-mode', {});
  });

  it('ignores anything that is not a qortal:// link', () => {
    openQortalDeepLink('https://example.com/');
    openQortalDeepLink('javascript:alert(1)');
    expect(events.executeEvent).not.toHaveBeenCalled();
  });
});
