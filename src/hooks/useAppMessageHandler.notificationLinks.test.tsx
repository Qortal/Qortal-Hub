import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/events', () => ({ executeEvent: vi.fn() }));
vi.mock('../utils/indexedDB', () => ({
  handleGetFileFromIndexedDB: vi.fn(),
}));
vi.mock('../utils/openQortalUseGroupLink', () => ({
  openQortalUseGroupLink: vi.fn(async () => true),
}));

import { executeEvent } from '../utils/events';
import { openQortalUseGroupLink } from '../utils/openQortalUseGroupLink';
import { useAppMessageHandler } from './useAppMessageHandler';

// A click on a notification, as Hub's own window posts it.
const clickNotification = async (link: unknown) => {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { action: 'NOTIFICATION_OPEN_APP', payload: { link } },
      origin: window.location.origin,
    })
  );
  // The link opens in an async step: let it finish.
  await Promise.resolve();
  await Promise.resolve();
};

describe("a clicked notification's link", () => {
  let unmount: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    unmount = renderHook(() =>
      useAppMessageHandler({ current: true }, { current: null })
    ).unmount;
  });

  afterEach(() => {
    unmount();
  });

  it('opens a link given as text', async () => {
    await clickNotification('qortal://APP/Q-Mail/inbox');
    expect(executeEvent).toHaveBeenCalledWith('addTab', {
      data: {
        service: 'APP',
        name: 'Q-Mail',
        identifier: undefined,
        path: 'inbox',
      },
    });
  });

  // The link comes from the node's notification, as JSON: it can be
  // something other than text.
  it.each([
    ['a list', ['qortal://APP/Q-Tube']],
    [
      'a Q-App or website made up field by field',
      { kind: 'resource', service: 'WEBSITE', name: 'Another', path: 'x' },
    ],
    ["an app's page made up field by field", { kind: 'page', name: 'Q-Shop' }],
    ["a group's link that is no group link", { kind: 'group', link: 'x' }],
    [
      'a link whose text is a list',
      { kind: 'resource', link: ['qortal://APP/Q-Tube'] },
    ],
  ])('opens nothing for %s', async (_what, link) => {
    await clickNotification(link);
    expect(executeEvent).not.toHaveBeenCalled();
    expect(openQortalUseGroupLink).not.toHaveBeenCalled();
  });
});
