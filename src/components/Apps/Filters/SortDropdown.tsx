import { useId, useState } from 'react';
import { Menu, MenuItem } from '@mui/material';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import SortRoundedIcon from '@mui/icons-material/SortRounded';
import { useTranslation } from 'react-i18next';
import {
  cap,
  libraryMenuItemSx,
  libraryMenuPaperSx,
  usePrefersReducedMotion,
} from '../AppsLibrary/libraryStyles';
import { useLauncherTabDialog } from '../launcherTabs';
import { FilterPill } from './FilterPill';

export type SortOption =
  | 'newest'
  | 'oldest'
  | 'alphabetical'
  | 'highest_rated'
  | 'most_rated'
  | 'recently_updated';

interface SortDropdownProps {
  value: SortOption;
  onChange: (value: SortOption) => void;
}

/** In a fixed order, the same in every language. */
const SORT_OPTIONS: SortOption[] = [
  'highest_rated',
  'most_rated',
  'recently_updated',
  'newest',
  'oldest',
  'alphabetical',
];

/** How the library is sorted: a pill that opens a short menu. */
export const SortDropdown = ({ value, onChange }: SortDropdownProps) => {
  const { t } = useTranslation(['core']);
  const reduce = usePrefersReducedMotion();
  const popupId = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // In a hidden launcher tab the menu steps aside, and comes back with it.
  const menuShown = useLauncherTabDialog(!!anchor, () => setAnchor(null));
  const label = t('core:filter.sort_by', cap);
  const close = () => setAnchor(null);

  return (
    <>
      <FilterPill
        icon={<SortRoundedIcon />}
        label={label}
        onClick={(event) => setAnchor(event.currentTarget)}
        open={!!anchor}
        popupId={popupId}
        popupRole="menu"
        valueLabel={t(`core:sort.${value}`, cap)}
      />
      <Menu
        anchorEl={anchor}
        anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
        id={popupId}
        onClose={close}
        {...menuShown}
        slotProps={{
          list: { 'aria-label': label, sx: { py: 0.75 } },
          paper: {
            sx: (theme) => ({ ...libraryMenuPaperSx(theme), minWidth: 220 }),
          },
        }}
        transformOrigin={{ horizontal: 'left', vertical: 'top' }}
        // Menu passes this to the Popover, which sets the transition's
        // timeout from it, over slotProps.
        transitionDuration={reduce ? 0 : 'auto'}
      >
        {SORT_OPTIONS.map((option) => (
          <MenuItem
            aria-checked={option === value}
            key={option}
            onClick={() => {
              onChange(option);
              close();
            }}
            role="menuitemradio"
            selected={option === value}
            sx={libraryMenuItemSx}
          >
            {t(`core:sort.${option}`, cap)}
            <CheckRoundedIcon aria-hidden className="libraryCheck" />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};
