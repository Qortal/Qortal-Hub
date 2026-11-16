import { ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded';
import ViewListRoundedIcon from '@mui/icons-material/ViewListRounded';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  cap,
  INSTANT_TOOLTIP,
  libraryAccent,
  libraryFocusRing,
  libraryMuted,
} from './libraryStyles';
import { type LibraryView, libraryViewAtom } from './libraryView';

/** Grid or list, for every library tab at once. */
export const LibraryViewToggle = () => {
  const { t } = useTranslation(['core']);
  const [view, setView] = useAtom(libraryViewAtom);
  const gridLabel = t('core:launcher.library.view_grid', cap);
  const listLabel = t('core:launcher.library.view_list', cap);

  return (
    <ToggleButtonGroup
      aria-label={t('core:launcher.library.view_label', cap)}
      exclusive
      onChange={(_event, next: LibraryView | null) => {
        if (next) setView(next);
      }}
      size="small"
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
          transition: 'background-color 160ms, color 160ms',
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
      value={view}
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
};
