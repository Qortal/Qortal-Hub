import { beforeEach, describe, expect, it, vi } from 'vitest';

const events = vi.hoisted(() => ({ executeEvent: vi.fn() }));
vi.mock('../../utils/events', () => events);

import { openQortalDeepLink } from '../qdnAppLinks';

const openedTab = () =>
  events.executeEvent.mock.calls.find(([name]) => name === 'addTab')?.[1]?.data;

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

describe('qortal:// links to apps whose name ends in a plus', () => {
  beforeEach(() => {
    events.executeEvent.mockClear();
  });

  it('opens the + app, not the app without the plus', () => {
    openQortalDeepLink('qortal://APP/POS+');
    expect(openedTab()).toMatchObject({ service: 'APP', name: 'POS+' });
  });

  it('keeps the plus when the sentence goes on after the link', () => {
    openQortalDeepLink('qortal://APP/Q-Share+.');
    expect(openedTab()).toMatchObject({ service: 'APP', name: 'Q-Share+' });
  });

  it('still drops a bracket and a full stop after the name', () => {
    openQortalDeepLink('qortal://APP/Q-Tube).');
    expect(openedTab()).toMatchObject({ service: 'APP', name: 'Q-Tube' });
  });
});

describe('A group link in a Qortino answer', () => {
  beforeEach(() => {
    events.executeEvent.mockClear();
  });

  it('offers to join the group, as the same link does in a chat', () => {
    openQortalDeepLink('qortal://use-group/action-join/groupid-801.');
    expect(events.executeEvent).toHaveBeenCalledWith('globalActionJoinGroup', {
      groupId: '801',
    });
    expect(openedTab()).toBeUndefined();
  });

  it('does nothing for a link that is neither a resource nor a group', () => {
    openQortalDeepLink('qortal://use-embed/POLL?name=x');
    expect(events.executeEvent).not.toHaveBeenCalled();
  });
});

describe('A payment link in a Qortino answer', () => {
  beforeEach(() => {
    events.executeEvent.mockClear();
  });

  it('opens nothing, not even a website named after it', () => {
    openQortalDeepLink('qortal://pay');
    openQortalDeepLink('qortal://pay?recipient=NAME&amount=5.');
    openQortalDeepLink('qortal://send,');
    expect(events.executeEvent).not.toHaveBeenCalled();
  });

  it('still opens a website whose name only starts with pay', () => {
    openQortalDeepLink('qortal://payments');
    expect(openedTab()).toMatchObject({ service: 'WEBSITE', name: 'payments' });
  });
});
