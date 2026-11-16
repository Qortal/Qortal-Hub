import { useId, useState } from 'react';
import { Menu, MenuItem } from '@mui/material';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import DownloadDoneRoundedIcon from '@mui/icons-material/DownloadDoneRounded';
import { useTranslation } from 'react-i18next';
import {
  cap,
  libraryMenuItemSx,
  libraryMenuPaperSx,
  usePrefersReducedMotion,
} from '../AppsLibrary/libraryStyles';
import { FilterPill } from './FilterPill';

export type StatusFilterOption = 'all' | 'installed' | 'not_installed';

interface StatusFilterProps {
  value: StatusFilterOption;
  onChange: (value: StatusFilterOption) => void;
}

const STATUS_OPTIONS: StatusFilterOption[] = [
  'all',
  'installed',
  'not_installed',
];

/** Whether the node has an app ready: a pill that opens a short menu. */
export const StatusFilter = ({ value, onChange }: StatusFilterProps) => {
  const { t } = useTranslation(['core']);
  const reduce = usePrefersReducedMotion();
  const popupId = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const label = t('core:filter.status', cap);
  const close = () => setAnchor(null);
  const optionLabel = (option: StatusFilterOption) =>
    t(`core:filter.${option}`, cap);

  return (
    <>
      <FilterPill
        active={value !== 'all'}
        icon={<DownloadDoneRoundedIcon />}
        label={label}
        onClick={(event) => setAnchor(event.currentTarget)}
        open={!!anchor}
        popupId={popupId}
        popupRole="menu"
        valueLabel={optionLabel(value)}
      />
      <Menu
        anchorEl={anchor}
        anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
        id={popupId}
        onClose={close}
        open={!!anchor}
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
        {STATUS_OPTIONS.map((option) => (
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
            {optionLabel(option)}
            <CheckRoundedIcon aria-hidden className="libraryCheck" />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};
