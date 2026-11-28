import { useEffect, useRef } from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { readPicks, writePicks } from '../../../lib/explorer/comparePicks';
import { useComparePicks } from './compareSteps';

// The picks while Hub switches accounts: what the last Hub account picked
// never reaches the next one, not in a render and not in storage.

const HUB_A = `Q${'A'.repeat(33)}`;
const HUB_B = `Q${'B'.repeat(33)}`;
const PICK = `Q${'P'.repeat(33)}`;
const OTHER = `Q${'R'.repeat(33)}`;

let seen: Array<{ viewer: string; picks: readonly string[] }> = [];

/** A part that picks an account in its own effect when the Hub account changes (child effects run first). */
function PickOnSwitch({
  viewer,
  toggle,
  pick,
}: {
  viewer: string;
  toggle: (address: string) => unknown;
  pick?: string;
}) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (pick) toggle(pick);
  }, [viewer, toggle, pick]);
  return null;
}

function Harness({ viewer, pick }: { viewer: string; pick?: string }) {
  const steps = useComparePicks(viewer);
  seen.push({ viewer, picks: steps.picks });
  return <PickOnSwitch viewer={viewer} toggle={steps.togglePick} pick={pick} />;
}

beforeEach(() => {
  window.sessionStorage.clear();
  seen = [];
});

describe('the picks when Hub switches accounts', () => {
  it('the next Hub account never gets the last one’s picks, not even for one render', () => {
    writePicks(HUB_A, [PICK]);
    const view = render(<Harness viewer={HUB_A} />);
    expect(seen[seen.length - 1]).toEqual({ viewer: HUB_A, picks: [PICK] });
    act(() => view.rerender(<Harness viewer={HUB_B} />));
    const asB = seen.filter((each) => each.viewer === HUB_B);
    expect(asB.length).toBeGreaterThan(0);
    for (const each of asB) expect(each.picks).toEqual([]);
    // The last one's are cleared where they were kept.
    expect(readPicks(HUB_A)).toEqual([]);
  });

  it('a pick made while Hub switches accounts is dropped, never kept for the next one', () => {
    writePicks(HUB_A, [PICK]);
    const view = render(<Harness viewer={HUB_A} pick={OTHER} />);
    act(() => view.rerender(<Harness viewer={HUB_B} pick={OTHER} />));
    expect(readPicks(HUB_B)).toEqual([]);
    expect(seen[seen.length - 1]).toEqual({ viewer: HUB_B, picks: [] });
  });
});
