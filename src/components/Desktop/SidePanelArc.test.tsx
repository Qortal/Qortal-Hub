import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { darkTheme } from '../../styles/theme-dark';
import {
  ARC_OUTER_PX,
  arcAngle,
  arcPositions,
  SidePanelArc,
} from './SidePanelArc';
import type { SidePanelItem } from './sidePanel';

const apps = (count: number): SidePanelItem[] =>
  Array.from({ length: count }, (_, index) => ({
    kind: 'qdn',
    name: `App ${index}`,
    service: 'APP',
  }));

const renderArc = (items: SidePanelItem[], scale?: number) =>
  render(
    <ThemeProvider theme={darkTheme}>
      <SidePanelArc
        background={1}
        centerY={400}
        editDisabled={false}
        editLabel="Edit side panel"
        items={items}
        labelOf={(item) => (item.kind === 'qdn' ? item.name : item.kind)}
        onEdit={vi.fn()}
        renderItem={(item) => (
          <button type="button">
            {item.kind === 'qdn' ? item.name : item.kind}
          </button>
        )}
        scale={scale}
        shown
        surfaceColor="rgb(36, 39, 45)"
      />
    </ThemeProvider>
  );

const slotAngle = (key: string) =>
  document
    .querySelector(`[data-side-panel-slot="${key}"]`)
    ?.getAttribute('data-angle');

describe('arcPositions', () => {
  it('spaces the buttons along the rim, a divider taking half the room', () => {
    const { length, positions } = arcPositions([
      { kind: 'home' },
      { kind: 'divider' },
      { kind: 'info' },
    ]);
    expect(positions).toEqual([0, 0.75, 1.5]);
    expect(length).toBe(1.5);
  });

  it('turns only when the buttons are more than the rim holds', () => {
    expect(arcPositions(apps(6)).maxTurn).toBe(0);
    expect(arcPositions(apps(12)).maxTurn).toBeGreaterThan(0);
  });
});

describe('arcAngle', () => {
  it('centres buttons that fit, and starts at the top when they do not', () => {
    // Three that fit: above, straight out, below.
    expect(arcAngle(0, 2, 6, 0)).toBe(-22);
    expect(arcAngle(1, 2, 6, 0)).toBe(0);
    expect(arcAngle(2, 2, 6, 0)).toBe(22);
    // Too many: the first at the top, then turned by one.
    expect(arcAngle(0, 11, 6, 0)).toBe(-70);
    expect(arcAngle(1, 11, 6, 1)).toBe(-70);
  });
});

describe('SidePanelArc', () => {
  it('puts every button on the rim, with the edit button in the middle', () => {
    const view = renderArc(apps(4));
    expect(document.querySelectorAll('[data-side-panel-slot]').length).toBe(4);
    expect(view.getByRole('button', { name: 'Edit side panel' })).toBeTruthy();
  });

  it('turns the rim when scrolled over, if there is more than fits', () => {
    renderArc(apps(12));
    const before = slotAngle('qdn:APP:app 0');
    const arc = document.querySelector(
      '[data-side-panel-layout="arc"]'
    ) as HTMLElement;

    fireEvent.wheel(arc, { deltaY: 120 });

    expect(slotAngle('qdn:APP:app 0')).not.toBe(before);
  });

  it('grows and shrinks with the buttons, around the same middle', () => {
    renderArc(apps(3), 1.25);
    const outer = Math.round(ARC_OUTER_PX * 1.25);
    expect(
      document.querySelector('[data-side-panel-layout="arc"]')
    ).toHaveStyle({
      height: `${2 * outer}px`,
      top: `${400 - outer}px`,
      width: `${outer}px`,
    });
  });

  it('stays put when scrolled over with everything in view', () => {
    renderArc(apps(3));
    const before = slotAngle('qdn:APP:app 1');
    fireEvent.wheel(
      document.querySelector('[data-side-panel-layout="arc"]') as HTMLElement,
      { deltaY: 120 }
    );
    expect(slotAngle('qdn:APP:app 1')).toBe(before);
  });
});
