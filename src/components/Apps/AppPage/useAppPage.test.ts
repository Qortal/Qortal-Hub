import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../App', () => ({ getBaseApiReact: () => 'http://node' }));

import {
  claimHiddenStateRun,
  clearAppPageCache,
  hiddenStateChangeCount,
  rememberHiddenState,
} from './useAppPage';

const app = { service: 'APP', name: 'Q-Blog' };

beforeEach(() => clearAppPageCache());

describe('hiding or showing an app from several pages', () => {
  it('lets one go on at a time for each app, whichever page started it', () => {
    const release = claimHiddenStateRun(app, 'hide');
    expect(release).toBeTypeOf('function');
    // The same app in any case, and showing it too, wait.
    expect(
      claimHiddenStateRun({ service: 'app', name: 'q-blog' }, 'hide')
    ).toBe(null);
    expect(claimHiddenStateRun(app, 'show')).toBe(null);
    // Another app, or the website of the same name, doesn't.
    expect(
      claimHiddenStateRun({ service: 'WEBSITE', name: 'Q-Blog' }, 'hide')
    ).toBeTypeOf('function');

    release();
    expect(claimHiddenStateRun(app, 'show')).toBeTypeOf('function');
  });

  it('ends only its own run', () => {
    const first = claimHiddenStateRun(app, 'hide');
    first();
    const second = claimHiddenStateRun(app, 'hide');
    // Ending the first one again leaves the second going.
    first();
    expect(claimHiddenStateRun(app, 'hide')).toBe(null);
    second();
    expect(claimHiddenStateRun(app, 'hide')).toBeTypeOf('function');
  });

  it('counts each time it was hidden or shown from here', () => {
    expect(hiddenStateChangeCount(app)).toBe(0);
    rememberHiddenState(app, { hidden: true, replaced: false, at: 1 });
    rememberHiddenState(
      { service: 'app', name: 'Q-BLOG' },
      { hidden: false, replaced: false, at: 2 }
    );
    expect(hiddenStateChangeCount(app)).toBe(2);
    expect(hiddenStateChangeCount({ service: 'WEBSITE', name: 'Q-Blog' })).toBe(
      0
    );
  });
});
