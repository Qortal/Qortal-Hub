/**
 * Grid or list, for an Explorer list (the Names tab; later Assets), in the
 * launcher library's look. The choice is kept on this device for each list
 * (`explorer-<list>-view`); where storage can't be read or written the
 * list still works, as a grid.
 */
import { useState } from 'react';
import { ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded';
import ViewListRoundedIcon from '@mui/icons-material/ViewListRounded';
import { useTranslation } from 'react-i18next';
import {
  INSTANT_TOOLTIP,
  libraryAccent,
  libraryFocusRing,
  libraryMuted,
} from '../Apps/AppsLibrary/libraryStyles';
import { cap } from './parts';

export type ListView = 'grid' | 'list';

export const listViewKey = (list: string) => `explorer-${list}-view`;

function stored(key: string): ListView {
  try {
    return window.localStorage.getItem(key) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

/** `list` names the list ("names"). */
export function useListView(
  list: string
): [ListView, (view: ListView) => void] {
  const key = listViewKey(list);
  const [view, setView] = useState<ListView>(() => stored(key));
  const choose = (next: ListView) => {
    setView(next);
    try {
      window.localStorage.setItem(key, next);
    } catch {
      // Kept for this visit only.
    }
  };
  return [view, choose];
}

export function ViewToggle({
  view,
  onView,
  label,
}: {
  view: ListView;
  onView: (view: ListView) => void;
  /** What the buttons lay out: "Show the names as". */
  label: string;
}) {
  const { t } = useTranslation(['core']);
  const gridLabel = t('core:launcher.library.view_grid', cap);
  const listLabel = t('core:launcher.library.view_list', cap);
  return (
    <ToggleButtonGroup
      aria-label={label}
      exclusive
      onChange={(_event, next: ListView | null) => {
        if (next) onView(next);
      }}
      size="small"
      value={view}
      sx={(theme) => ({
        backgroundColor: alpha(theme.palette.background.paper, 0.72),
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: '12px',
        boxSizing: 'border-box',
        flexShrink: 0,
        gap: '2px',
        height: 36,
        p: '2px',
        '& .MuiToggleButton-root': {
          border: 0,
          borderRadius: '10px !important',
          color: libraryMuted(theme),
          height: 30,
          m: '0 !important',
          minWidth: 0,
          p: 0,
          width: 32,
          '&:hover': {
            backgroundColor: alpha(theme.palette.text.primary, 0.06),
            color: theme.palette.text.primary,
          },
          '&.Mui-selected, &.Mui-selected:hover': {
            backgroundColor: alpha(theme.palette.primary.main, 0.18),
            color: libraryAccent(theme),
          },
          '&.Mui-focusVisible': libraryFocusRing(theme, -2),
        },
      })}
    >
      <Tooltip {...INSTANT_TOOLTIP} title={gridLabel}>
        <ToggleButton aria-label={gridLabel} disableRipple value="grid">
          <GridViewRoundedIcon sx={{ fontSize: 18 }} />
        </ToggleButton>
      </Tooltip>
      <Tooltip {...INSTANT_TOOLTIP} title={listLabel}>
        <ToggleButton aria-label={listLabel} disableRipple value="list">
          <ViewListRoundedIcon sx={{ fontSize: 18 }} />
        </ToggleButton>
      </Tooltip>
    </ToggleButtonGroup>
  );
}
