import { Item, Submenu } from 'react-contexify';
import { Box, Radio, Typography } from '@mui/material';
import SortRoundedIcon from '@mui/icons-material/SortRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useTranslation } from 'react-i18next';

export const GROUP_SORT_MODE_STORAGE_KEY = 'qortal_group_sort_mode';

const GROUP_SORT_MODE_EVENT = 'qortal-group-sort-mode-change';

export type GroupSortMode = 'recent' | 'alphabetical' | 'manual';

export function readGroupSortMode(): GroupSortMode {
  try {
    const stored = window.localStorage.getItem(GROUP_SORT_MODE_STORAGE_KEY);
    if (stored === 'alphabetical' || stored === 'manual') return stored;
  } catch {}
  return 'recent';
}

export function persistGroupSortMode(mode: GroupSortMode) {
  try {
    window.localStorage.setItem(GROUP_SORT_MODE_STORAGE_KEY, mode);
    window.dispatchEvent(
      new CustomEvent<GroupSortMode>(GROUP_SORT_MODE_EVENT, { detail: mode })
    );
  } catch {}
}

export function subscribeToGroupSortMode(
  listener: (mode: GroupSortMode) => void
): () => void {
  const handle = (e: Event) => {
    listener((e as CustomEvent<GroupSortMode>).detail);
  };
  window.addEventListener(GROUP_SORT_MODE_EVENT, handle);
  return () => window.removeEventListener(GROUP_SORT_MODE_EVENT, handle);
}

const MODES: GroupSortMode[] = ['recent', 'alphabetical', 'manual'];

export function SortGroupsSubmenu() {
  const { t } = useTranslation(['group']);
  const currentMode = readGroupSortMode();

  const labelKey = (mode: GroupSortMode): string => {
    switch (mode) {
      case 'recent':
        return 'group:context_menu.sort_most_recent_post';
      case 'alphabetical':
        return 'group:context_menu.sort_alphabetically';
      case 'manual':
        return 'group:context_menu.sort_manually';
    }
  };

  return (
    <Submenu
      label={
        <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.5 }}>
          <SortRoundedIcon sx={{ fontSize: 18 }} />
          <Typography
            component="span"
            sx={{ fontSize: '14px', fontWeight: 600 }}
          >
            {t('group:context_menu.sort_groups')}
          </Typography>
        </Box>
      }
      arrow={<ChevronRightRoundedIcon sx={{ fontSize: 20 }} />}
    >
      {MODES.map((mode) => (
        <Item
          key={mode}
          closeOnClick={false}
          onClick={() => persistGroupSortMode(mode)}
        >
          <Radio
            size="small"
            checked={currentMode === mode}
            sx={{
              mr: 1.5,
              pointerEvents: 'none',
              padding: 0,
              '& .MuiSvgIcon-root': { fontSize: 18 },
            }}
          />
          <Typography
            component="span"
            sx={{ fontSize: '14px', fontWeight: 600 }}
          >
            {t(labelKey(mode))}
          </Typography>
        </Item>
      ))}
    </Submenu>
  );
}
