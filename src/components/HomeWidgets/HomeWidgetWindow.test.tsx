import { ThemeProvider } from '@mui/material/styles';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lightTheme } from '../../styles/theme-light';
import {
  HomeWidgetWindow,
  widgetCellsFor,
  widgetRowsPx,
} from './HomeWidgetWindow';

type ViewProps = {
  interactive: boolean;
  onAskSize: (key: string, size: { w: number | null; h: number }) => void;
  visible: boolean;
  widget: Record<string, unknown>;
};
let viewProps: ViewProps | null = null;

vi.mock('./HomeWidgetView', () => ({
  HomeWidgetView: (props: ViewProps) => {
    viewProps = props;
    return <div data-testid="widget-view" />;
  },
}));

vi.mock('../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://node',
}));

describe('HomeWidgetWindow', () => {
  beforeEach(() => {
    viewProps = null;
  });

  it("reports a frame's size in the widgets' own cells", () => {
    // A new widget in the Widgets window: 4 columns by 5 rows.
    expect(widgetCellsFor(386, 248)).toEqual({ w: 4, h: 5 });
    expect(widgetCellsFor(0, 0)).toEqual({ w: 1, h: 2 });
    expect(widgetRowsPx(5)).toBe(248);
  });

  it('runs the widget, and passes on the height it asks for', () => {
    const onAskHeight = vi.fn();
    render(
      <ThemeProvider theme={lightTheme}>
        <HomeWidgetWindow
          active
          interactive={false}
          loadDelayMs={0}
          onAskHeight={onAskHeight}
          reloadKey={0}
          widget={{ name: 'GO Clock', identifier: null, title: 'Clock' }}
        />
      </ThemeProvider>
    );

    expect(viewProps?.widget).toMatchObject({
      name: 'GO Clock',
      identifier: null,
      sizedBy: 'default',
      title: 'Clock',
    });
    expect(viewProps?.interactive).toBe(false);
    expect(viewProps?.visible).toBe(true);

    viewProps?.onAskSize('GO Clock', { w: null, h: 3 });
    expect(onAskHeight).toHaveBeenCalledWith(widgetRowsPx(3));
  });
});
