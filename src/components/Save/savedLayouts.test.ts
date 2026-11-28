import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readSidePanel,
  saveSidePanel,
  SIDE_PANEL_DEFAULT,
  type SidePanelSettings,
  withSidePanelQdnItem,
} from '../Desktop/sidePanel';
import {
  homeDefaultGrid,
  type HomeWindowId,
  homeWidgetWindowId,
  homeWorkspaceCopyId,
} from '../Group/HomeDesktop/homeGrid';
import {
  HOME_LAYOUT_DEFAULT,
  type HomeLayout,
  homeLayoutGrid,
  homeLayoutStorageKey,
  readHomeLayout,
  saveHomeLayout,
  withHomeWidgetWindow,
  withHomeWorkspaceCopy,
} from '../Group/HomeDesktop/homeLayout';
import {
  chooseSavedPartUse,
  hasUnsavedLayouts,
  keepLocalLayouts,
  loadLayoutMarks,
  markLayoutsSaved,
  NO_SAVED_LAYOUTS,
  readLocalLayouts,
  readSavedLayouts,
  restoreSavedLayouts,
  revertToSavedLayouts,
  takeInSavedLayouts,
  takeInSavedSidePanelItems,
  toSavedLayoutSettings,
  withSavedSidePanelItems,
} from './savedLayouts';

const ALICE = 'QaliceAddress00000000000000000000';

/** Settings as another device saved them. */
const savedSettings = (
  hidden: string[],
  changedAt: number,
  show: 'hover' | 'always' = 'always'
) => ({
  sortablePinnedApps: [],
  homeLayout: {
    v: 1,
    layout: { hidden, stack: ['widgets', 'groupActivity', 'feed'] },
    changedAt,
  },
  sidePanel: {
    v: 1,
    settings: { ...SIDE_PANEL_DEFAULT, show },
    changedAt,
  },
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('chooseSavedPartUse', () => {
  const saved = { changedAt: 30 };
  it('keeps when nothing is saved, or the same is', () => {
    expect(
      chooseSavedPartUse({ saved: null, same: false, localAt: 5, mark: null })
    ).toBe('keep');
    expect(
      chooseSavedPartUse({ saved, same: true, localAt: 5, mark: null })
    ).toBe('keep');
  });

  it('keeps what this device last saved or took in', () => {
    expect(
      chooseSavedPartUse({
        saved,
        same: false,
        localAt: 50,
        mark: { changedAt: 30, localAt: 30 },
      })
    ).toBe('keep');
  });

  it('replaces a layout never changed here, or not since', () => {
    expect(
      chooseSavedPartUse({ saved, same: false, localAt: 0, mark: null })
    ).toBe('replace');
    expect(
      chooseSavedPartUse({
        saved,
        same: false,
        localAt: 10,
        mark: { changedAt: 10, localAt: 10 },
      })
    ).toBe('replace');
  });

  it('offers it when both changed', () => {
    expect(
      chooseSavedPartUse({
        saved,
        same: false,
        localAt: 20,
        mark: { changedAt: 10, localAt: 10 },
      })
    ).toBe('offer');
    expect(
      chooseSavedPartUse({ saved, same: false, localAt: 20, mark: null })
    ).toBe('offer');
  });
});

describe('readSavedLayouts', () => {
  it('reads both layouts, and leaves out what has the wrong shape', () => {
    const read = readSavedLayouts(savedSettings(['feed'], 70));
    expect(read.homeLayout).toEqual({
      changedAt: 70,
      value: {
        hidden: ['feed'],
        stack: ['widgets', 'groupActivity', 'feed'],
        version: 2,
      },
    });
    expect(read.sidePanel?.value.show).toBe('always');

    expect(
      readSavedLayouts({ homeLayout: { v: 2, layout: {} }, sidePanel: 'x' })
    ).toEqual(NO_SAVED_LAYOUTS);
    expect(readSavedLayouts(null)).toEqual(NO_SAVED_LAYOUTS);
  });
});

describe('toSavedLayoutSettings', () => {
  it('saves what changed here, and what was saved for the rest', () => {
    vi.spyOn(Date, 'now').mockReturnValue(500);
    saveHomeLayout(ALICE, { hidden: ['qortino'], stack: [] });
    const saved = readSavedLayouts(savedSettings(['feed'], 70));

    const fields = toSavedLayoutSettings(readLocalLayouts(ALICE), saved) as {
      homeLayout: { changedAt: number; layout: { hidden: string[] } };
      sidePanel: { changedAt: number; settings: { show: string } };
    };

    expect(fields.homeLayout.changedAt).toBe(500);
    expect(fields.homeLayout.layout.hidden).toEqual(['qortino']);
    // Never changed here: it goes as it was saved, so it isn't lost.
    expect(fields.sidePanel).toEqual(
      expect.objectContaining({ changedAt: 70 })
    );
    expect(fields.sidePanel.settings.show).toBe('always');
  });

  it('leaves out what was never changed nor saved', () => {
    expect(
      toSavedLayoutSettings(readLocalLayouts(ALICE), NO_SAVED_LAYOUTS)
    ).toEqual({});
  });

  it("saves the widgets in windows of their own with Home's layout", () => {
    const clock = { name: 'GO Clock', identifier: null };
    saveHomeLayout(ALICE, withHomeWidgetWindow(readHomeLayout(ALICE), clock));
    const fields = toSavedLayoutSettings(
      readLocalLayouts(ALICE),
      NO_SAVED_LAYOUTS
    );

    // Another device, which never changed its layout, takes it in.
    localStorage.clear();
    takeInSavedLayouts(ALICE, fields);

    const layout = readHomeLayout(ALICE);
    expect(layout.widgetWindows).toEqual([clock]);
    expect(layout.grid?.map((item) => item.key)).toContain(
      homeWidgetWindowId(clock)
    );
  });
});

describe('takeInSavedLayouts', () => {
  it('puts the saved layouts in place on a device that never changed them', () => {
    const state = takeInSavedLayouts(ALICE, savedSettings(['feed'], 70));

    expect(state.offer).toEqual([]);
    expect(readHomeLayout(ALICE)).toEqual(
      expect.objectContaining({ changedAt: 70, hidden: ['feed'] })
    );
    expect(readSidePanel(ALICE).show).toBe('always');
    expect(loadLayoutMarks(ALICE).homeLayout).toEqual({
      changedAt: 70,
      localAt: 70,
    });
  });

  it("doesn't offer this device's own last save after it changed again", () => {
    vi.spyOn(Date, 'now').mockReturnValue(100);
    saveHomeLayout(ALICE, { hidden: ['feed'], stack: [] });
    const saved = markLayoutsSaved(
      ALICE,
      readLocalLayouts(ALICE),
      NO_SAVED_LAYOUTS
    );
    vi.spyOn(Date, 'now').mockReturnValue(200);
    saveHomeLayout(ALICE, { hidden: ['status'], stack: [] });

    const settings = {
      homeLayout: {
        v: 1,
        layout: saved.saved.homeLayout?.value,
        changedAt: 100,
      },
    };
    const state = takeInSavedLayouts(ALICE, settings);

    expect(state.offer).toEqual([]);
    expect(readHomeLayout(ALICE).hidden).toEqual(['status']);
  });

  it('offers a layout changed both here and elsewhere, and keeps this one', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100);
    saveHomeLayout(ALICE, { hidden: ['status'], stack: [] });

    const state = takeInSavedLayouts(ALICE, savedSettings(['feed'], 70));

    expect(state.offer).toEqual(['homeLayout']);
    expect(readHomeLayout(ALICE).hidden).toEqual(['status']);
    // The side panel was never changed here: it's put in place.
    expect(readSidePanel(ALICE).show).toBe('always');
  });

  it('never replaces a layout stored before changes were timed', () => {
    localStorage.setItem(
      homeLayoutStorageKey(ALICE),
      JSON.stringify({ hidden: ['status'], stack: [] })
    );
    const state = takeInSavedLayouts(ALICE, savedSettings(['feed'], 70));
    expect(state.offer).toEqual(['homeLayout']);
    expect(readHomeLayout(ALICE).hidden).toEqual(['status']);
  });

  it('is read, with nothing saved, when there are no settings', () => {
    expect(takeInSavedLayouts(ALICE, null)).toEqual({
      address: ALICE,
      offer: [],
      saved: NO_SAVED_LAYOUTS,
      status: 'read',
    });
  });
});

describe('changes made after taking in a layout', () => {
  it('count as newer than it, even from a device whose clock is ahead', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    // Saved on a device whose clock is far ahead of this one's.
    takeInSavedLayouts(ALICE, savedSettings(['feed'], 5_000));
    expect(readHomeLayout(ALICE).changedAt).toBe(5_000);

    now.mockReturnValue(1_100);
    saveHomeLayout(ALICE, { hidden: ['status'], stack: [] });
    saveSidePanel(ALICE, { ...readSidePanel(ALICE), background: 0.5 });
    expect(readHomeLayout(ALICE).changedAt).toBeGreaterThan(5_000);
    expect(readSidePanel(ALICE).changedAt).toBeGreaterThan(5_000);

    // That device saves again: the changes made here aren't written over.
    const state = takeInSavedLayouts(ALICE, savedSettings(['qortino'], 6_000));
    expect(state.offer).toEqual(['homeLayout', 'sidePanel']);
    expect(readHomeLayout(ALICE).hidden).toEqual(['status']);
    expect(readSidePanel(ALICE).background).toBe(0.5);
  });
});

describe('restoring and keeping', () => {
  const offered = () => {
    vi.spyOn(Date, 'now').mockReturnValue(100);
    saveHomeLayout(ALICE, { hidden: ['status'], stack: [] });
    saveSidePanel(ALICE, { ...SIDE_PANEL_DEFAULT, background: 0.5 });
    return takeInSavedLayouts(ALICE, savedSettings(['feed'], 70));
  };

  it('restores the saved layouts', () => {
    const state = offered();
    expect(state.offer).toEqual(['homeLayout', 'sidePanel']);

    const after = restoreSavedLayouts(ALICE, state, state.offer);

    expect(after.offer).toEqual([]);
    expect(readHomeLayout(ALICE).hidden).toEqual(['feed']);
    expect(readSidePanel(ALICE)).toEqual(
      expect.objectContaining({ background: 1, show: 'always' })
    );
  });

  it("keeps this device's, and doesn't offer the same again", () => {
    const state = offered();
    expect(keepLocalLayouts(ALICE, state, state.offer).offer).toEqual([]);

    const again = takeInSavedLayouts(ALICE, savedSettings(['feed'], 70));
    expect(again.offer).toEqual([]);
    expect(readHomeLayout(ALICE).hidden).toEqual(['status']);

    // A newer save elsewhere is offered again.
    expect(
      takeInSavedLayouts(ALICE, savedSettings(['qortino'], 90)).offer
    ).toEqual(['homeLayout', 'sidePanel']);
  });

  it('reverts to every saved layout, and leaves one never saved alone', () => {
    const state = offered();
    const after = revertToSavedLayouts(ALICE, {
      ...state,
      saved: { ...state.saved, sidePanel: null },
    });

    expect(after.offer).toEqual(['sidePanel']);
    expect(readHomeLayout(ALICE).hidden).toEqual(['feed']);
    expect(readSidePanel(ALICE).background).toBe(0.5);
  });

  it('reverts nothing before the settings were read', () => {
    offered();
    const unknown = {
      address: ALICE,
      status: 'unknown' as const,
      saved: NO_SAVED_LAYOUTS,
      offer: [],
    };
    expect(revertToSavedLayouts(ALICE, unknown)).toBe(unknown);
    expect(readHomeLayout(ALICE).hidden).toEqual(['status']);
  });
});

describe("the side panel's added Q-Apps and websites", () => {
  const added = (settings: SidePanelSettings, ...names: string[]) =>
    names.reduce(
      (panel, name) => withSidePanelQdnItem(panel, { service: 'APP', name }),
      settings
    );
  const names = (settings: SidePanelSettings) =>
    settings.items.flatMap((item) => ('name' in item ? [item.name] : []));

  it("keeps this device's order and settings, and adds what only the saved one has", () => {
    const here = { ...added(SIDE_PANEL_DEFAULT, 'B', 'A'), background: 0.5 };
    const saved = added(SIDE_PANEL_DEFAULT, 'A', 'B', 'C');

    const merged = withSavedSidePanelItems(here, saved);

    expect(names(merged)).toEqual(['B', 'A', 'C']);
    expect(merged.background).toBe(0.5);
    // Before the divider, where an added one goes.
    expect(merged.items.findIndex((item) => item.kind === 'divider')).toBe(
      merged.items.findIndex((item) => 'name' in item && item.name === 'C') + 1
    );
  });

  it('takes them in before a save only from a copy offered to restore', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100);
    const other = {
      ...savedSettings([], 90),
      sidePanel: {
        v: 1,
        settings: added(SIDE_PANEL_DEFAULT, 'Q-Mail'),
        changedAt: 90,
      },
    };
    saveSidePanel(ALICE, added(SIDE_PANEL_DEFAULT, 'Q-Tube'));
    const state = takeInSavedLayouts(ALICE, other);
    expect(state.offer).toContain('sidePanel');

    expect(takeInSavedSidePanelItems(ALICE, state.saved)).toBe(true);
    expect(names(readSidePanel(ALICE))).toEqual(['Q-Tube', 'Q-Mail']);
    expect(takeInSavedSidePanelItems(ALICE, state.saved)).toBe(false);
  });

  it("adds nothing from a copy set aside with Keep this device's", () => {
    vi.spyOn(Date, 'now').mockReturnValue(100);
    saveSidePanel(ALICE, added(SIDE_PANEL_DEFAULT, 'Q-Tube'));
    const state = takeInSavedLayouts(ALICE, {
      ...savedSettings([], 90),
      sidePanel: {
        v: 1,
        settings: added(SIDE_PANEL_DEFAULT, 'Q-Mail'),
        changedAt: 90,
      },
    });
    keepLocalLayouts(ALICE, state, ['sidePanel']);

    expect(takeInSavedSidePanelItems(ALICE, state.saved)).toBe(false);
    expect(names(readSidePanel(ALICE))).toEqual(['Q-Tube']);
  });
});

describe('hasUnsavedLayouts', () => {
  it('knows nothing before the settings were read', () => {
    saveHomeLayout(ALICE, { hidden: ['status'], stack: [] });
    expect(
      hasUnsavedLayouts(
        {
          address: ALICE,
          offer: [],
          saved: NO_SAVED_LAYOUTS,
          status: 'unknown',
        },
        ALICE,
        readLocalLayouts(ALICE)
      )
    ).toBe(false);
  });

  it('is unsaved when a layout differs from the saved one', () => {
    const state = takeInSavedLayouts(ALICE, savedSettings(['feed'], 70));
    expect(hasUnsavedLayouts(state, ALICE, readLocalLayouts(ALICE))).toBe(
      false
    );

    saveHomeLayout(ALICE, { hidden: [], stack: [] });
    expect(hasUnsavedLayouts(state, ALICE, readLocalLayouts(ALICE))).toBe(true);
  });

  it('is unsaved when one was changed here and none is saved', () => {
    const none = takeInSavedLayouts(ALICE, null);
    expect(hasUnsavedLayouts(none, ALICE, readLocalLayouts(ALICE))).toBe(false);
    saveSidePanel(ALICE, { ...SIDE_PANEL_DEFAULT, show: 'always' });
    expect(hasUnsavedLayouts(none, ALICE, readLocalLayouts(ALICE))).toBe(true);
  });
});

describe("a Home layout taken in, and the Workspace's copies that hold something here", () => {
  /** What the Workspaces hold on this device, where the Qortino card keeps it. */
  const holdHere = (
    windows: Record<string, { hotkeys: string[]; mode: string }>
  ) =>
    localStorage.setItem(
      `home-qortino-workspace-v1_${ALICE}`,
      JSON.stringify({ hotkeys: [], mode: 'empty', version: 1, windows })
    );
  const APPS = { hotkeys: ['APP::Q-Tube'], mode: 'hotkeys' };
  const MUSIC = { hotkeys: [], mode: 'music' };
  const NOTHING = { hotkeys: [], mode: 'empty' };

  const withCopies = (
    layout: HomeLayout,
    keys: string[],
    under: HomeWindowId
  ) =>
    keys.reduce((next, key) => withHomeWorkspaceCopy(next, under, key), layout);

  /** This device's layout with copies made under `under`, saved to QDN from here. */
  const savedHere = (keys: string[], under: HomeWindowId = 'workspace') => {
    vi.spyOn(Date, 'now').mockReturnValue(100);
    saveHomeLayout(ALICE, withCopies(HOME_LAYOUT_DEFAULT, keys, under));
    markLayoutsSaved(ALICE, readLocalLayouts(ALICE), NO_SAVED_LAYOUTS);
  };

  const placeOf = (id: HomeWindowId) =>
    homeLayoutGrid(readHomeLayout(ALICE)).find((item) => item.key === id);

  /** A layout as a device with copies of the Workspace saves it. */
  const savedLayout = (layout: HomeLayout, changedAt: number) => ({
    homeLayout: { v: 1, layout, changedAt },
  });

  it('keeps them when a layout saved by a Hub without copies is taken in', () => {
    savedHere(['k1']);
    holdHere({ k1: APPS });

    // Saved by a Hub without copies of the Workspace: no `workspaces`.
    const state = takeInSavedLayouts(ALICE, savedSettings(['feed'], 200));

    expect(state.offer).toEqual([]);
    const layout = readHomeLayout(ALICE);
    expect(layout.hidden).toEqual(['feed']);
    expect(layout.workspaces).toEqual(['k1']);
    // Qortino has its place there: the copy goes right under the Workspace,
    // as big as it, as Duplicate puts it, and Qortino goes down.
    const workspace = placeOf('workspace');
    const copy = placeOf(homeWorkspaceCopyId('k1'));
    expect(copy).toEqual({
      key: 'workspace:k1',
      x: workspace?.x,
      y: (workspace?.y ?? 0) + (workspace?.h ?? 0),
      w: workspace?.w,
      h: workspace?.h,
    });
    expect(placeOf('qortino')?.y).toBe((copy?.y ?? 0) + (copy?.h ?? 0));

    // It's no longer the saved layout: it goes with the next save, with a
    // time of its own.
    expect(hasUnsavedLayouts(state, ALICE, readLocalLayouts(ALICE))).toBe(true);
    const fields = toSavedLayoutSettings(
      readLocalLayouts(ALICE),
      state.saved
    ) as {
      homeLayout: { changedAt: number; layout: HomeLayout };
    };
    expect(fields.homeLayout.layout.workspaces).toEqual(['k1']);
    expect(fields.homeLayout.changedAt).toBeGreaterThan(200);

    // Nothing was changed here since: a newer one still takes its place.
    const next = takeInSavedLayouts(ALICE, savedSettings(['status'], 300));
    expect(next.offer).toEqual([]);
    expect(readHomeLayout(ALICE)).toEqual(
      expect.objectContaining({ hidden: ['status'], workspaces: ['k1'] })
    );
  });

  it("keeps one a newer device's layout doesn't list, where it was when that's free", () => {
    // Moved to the bottom, under the Video publisher (the last window).
    savedHere(['k1'], 'video');
    holdHere({ k1: MUSIC });
    const was = placeOf(homeWorkspaceCopyId('k1'));

    takeInSavedLayouts(
      ALICE,
      savedLayout(
        { ...HOME_LAYOUT_DEFAULT, grid: homeDefaultGrid(), hidden: ['status'] },
        200
      )
    );

    const layout = readHomeLayout(ALICE);
    expect(layout.hidden).toEqual(['status']);
    expect(layout.workspaces).toEqual(['k1']);
    expect(placeOf(homeWorkspaceCopyId('k1'))).toEqual(was);
  });

  it('lets copies that hold nothing here go as the layout taken in says', () => {
    savedHere(['k1', 'k2', 'k3']);
    holdHere({ k1: APPS, k2: NOTHING });

    takeInSavedLayouts(
      ALICE,
      savedLayout(withCopies(HOME_LAYOUT_DEFAULT, ['b1'], 'workspace'), 200)
    );

    expect(readHomeLayout(ALICE).workspaces).toEqual(['b1', 'k1']);
    expect(
      homeLayoutGrid(readHomeLayout(ALICE))
        .map((item) => item.key)
        .filter((key) => key.startsWith('workspace:'))
    ).toEqual(['workspace:b1', 'workspace:k1']);
  });

  it('keeps the ones that hold something first, within the limit', () => {
    savedHere(['r1', 'k1']);
    holdHere({ k1: MUSIC, r1: APPS });
    const theirs = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'];

    takeInSavedLayouts(
      ALICE,
      savedLayout(withCopies(HOME_LAYOUT_DEFAULT, theirs, 'workspace'), 200)
    );

    // The newest copy that holds nothing here makes room.
    expect(readHomeLayout(ALICE).workspaces).toEqual([
      'r1',
      'r2',
      'r3',
      'r4',
      'r5',
      'r6',
      'r7',
      'k1',
    ]);
  });

  /** A copy that holds apps, made here since the layout was last saved. */
  const offered = () => {
    vi.spyOn(Date, 'now').mockReturnValue(100);
    saveHomeLayout(ALICE, withCopies(HOME_LAYOUT_DEFAULT, ['k1'], 'workspace'));
    holdHere({ k1: APPS });
    return takeInSavedLayouts(ALICE, savedSettings(['feed'], 70));
  };

  it('keeps them when the layout offered is restored', () => {
    const state = offered();
    expect(state.offer).toContain('homeLayout');

    restoreSavedLayouts(ALICE, state, ['homeLayout']);

    expect(readHomeLayout(ALICE)).toEqual(
      expect.objectContaining({ hidden: ['feed'], workspaces: ['k1'] })
    );
  });

  it('keeps them through Revert', () => {
    revertToSavedLayouts(ALICE, offered());

    expect(readHomeLayout(ALICE)).toEqual(
      expect.objectContaining({ hidden: ['feed'], workspaces: ['k1'] })
    );
  });
});
