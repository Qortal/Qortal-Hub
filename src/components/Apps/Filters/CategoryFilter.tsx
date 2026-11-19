import { type Ref, useId, useMemo, useRef, useState } from 'react';
import {
  Autocomplete,
  Box,
  createFilterOptions,
  InputBase,
  Popover,
} from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import CategoryRoundedIcon from '@mui/icons-material/CategoryRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { useTranslation } from 'react-i18next';
import { CategoryIcon } from '../config/categoryIconComponents';
import { CountBadge } from '../AppsLibrary/LibrarySection';
import {
  cap,
  libraryAccent,
  libraryFocusRing,
  libraryMenuPaperSx,
  libraryMuted,
  usePrefersReducedMotion,
} from '../AppsLibrary/libraryStyles';
import type { CategoryCounts } from './categoryCounts';
import { useLauncherTabDialog } from '../launcherTabs';
import { FilterPill } from './FilterPill';
import { filterFieldSx } from './LibraryFilterField';

interface CategoryFilterProps {
  value: string;
  onChange: (value: string) => void;
  categories: Array<{ id: string; name: string }>;
  /**
   * How many apps of the current list each category holds. With it, empty
   * categories are left out and each row shows its count.
   */
  counts?: CategoryCounts | null;
  /** The pill, for giving it focus. */
  buttonRef?: Ref<HTMLButtonElement>;
}

type CategoryOption = { id: string; label: string; count?: number };

const ALL = 'all';

/** Matches the name, or the id with underscores read as spaces. */
const categoryFilterOptions = createFilterOptions<CategoryOption>({
  ignoreAccents: true,
  ignoreCase: true,
  matchFrom: 'any',
  stringify: (option) => `${option.label} ${option.id.replace(/_/g, ' ')}`,
});

/**
 * The Autocomplete draws its list in place, inside the popover, as in MUI's
 * "GitHub label picker".
 */
const InlinePopper = ({
  disablePortal,
  anchorEl,
  open,
  style,
  ...rest
}: any) => <Box {...rest} style={{ position: 'relative' }} />;

const InlinePaper = (props: any) => <Box {...props} />;

/** The rows' look, set on the listbox so it overrides MUI's own. */
const optionsSx = (theme: Theme) => ({
  maxHeight: 'min(400px, 60vh)',
  p: 0,
  pt: 0.75,
  '& .MuiAutocomplete-option': {
    borderRadius: '10px',
    color: theme.palette.text.primary,
    fontSize: 14,
    gap: 1.25,
    minHeight: 40,
    px: 1,
    py: 0.5,
    '&.Mui-focused': {
      backgroundColor: alpha(theme.palette.text.primary, 0.06),
    },
    '&.Mui-focusVisible': {
      backgroundColor: alpha(theme.palette.text.primary, 0.1),
      ...libraryFocusRing(theme, -2),
    },
    '&[aria-selected="true"]': {
      backgroundColor: alpha(theme.palette.primary.main, 0.12),
      color: libraryAccent(theme),
      fontWeight: 600,
      '&.Mui-focused, &.Mui-focusVisible': {
        backgroundColor: alpha(theme.palette.primary.main, 0.18),
      },
    },
    '& .libraryCheck': {
      color: libraryAccent(theme),
      fontSize: 18,
      visibility: 'hidden',
    },
    '&[aria-selected="true"] .libraryCheck': { visibility: 'visible' },
  },
});

/**
 * The category filter: a pill that opens a searchable list, with an icon and
 * a count on every row, so a category can be found by typing instead of
 * reading through all of them.
 */
export const CategoryFilter = ({
  value,
  onChange,
  categories,
  counts,
  buttonRef,
}: CategoryFilterProps) => {
  const { t, i18n } = useTranslation(['core']);
  const reduce = usePrefersReducedMotion();
  const popupId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  // In a hidden launcher tab the list steps aside, and comes back with it.
  const popoverShown = useLauncherTabDialog(!!anchor, () => setAnchor(null));
  const label = t('core:filter.category', cap);
  const allLabel = t('core:launcher.library.all_categories', cap);
  const searchLabel = t('core:launcher.library.search_categories', cap);

  const options = useMemo<CategoryOption[]>(() => {
    const locale = i18n?.language;
    const listed = (categories ?? [])
      .filter((category) =>
        counts
          ? (counts.byId.get(category.id) ?? 0) > 0 || category.id === value
          : true
      )
      .map((category) => ({
        id: category.id,
        label: category.name || category.id,
        count: counts ? (counts.byId.get(category.id) ?? 0) : undefined,
      }));
    if (
      value !== ALL &&
      !listed.some((option) => option.id === value) &&
      value
    ) {
      listed.push({
        id: value,
        label: value,
        count: counts ? (counts.byId.get(value) ?? 0) : undefined,
      });
    }
    listed.sort((a, b) => {
      try {
        return a.label.localeCompare(b.label, locale, { sensitivity: 'base' });
      } catch {
        return a.label.localeCompare(b.label);
      }
    });
    return [{ id: ALL, label: allLabel, count: counts?.total }, ...listed];
  }, [allLabel, categories, counts, i18n?.language, value]);

  const selectedOption =
    options.find((option) => option.id === value) ?? options[0];

  const open = (element: HTMLElement) => {
    setQuery('');
    setAnchor(element);
  };
  const close = () => setAnchor(null);

  return (
    <>
      <FilterPill
        active={value !== ALL}
        icon={
          value !== ALL ? (
            <CategoryIcon id={value} size={16} />
          ) : (
            <CategoryRoundedIcon />
          )
        }
        buttonRef={buttonRef}
        label={label}
        onClick={(event) => open(event.currentTarget)}
        open={!!anchor}
        popupId={popupId}
        popupRole="dialog"
        valueLabel={value === ALL ? allLabel : selectedOption.label}
      />
      <Popover
        anchorEl={anchor}
        anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
        id={popupId}
        onClose={close}
        {...popoverShown}
        slotProps={{
          paper: {
            'aria-label': label,
            role: 'dialog',
            sx: (theme: Theme) => ({
              ...libraryMenuPaperSx(theme),
              borderRadius: '16px',
              maxWidth: 'calc(100vw - 32px)',
              p: 1,
              width: 340,
            }),
          },
          transition: { onEntered: () => inputRef.current?.focus() },
        }}
        transformOrigin={{ horizontal: 'left', vertical: 'top' }}
        // Popover sets the transition's timeout from this prop, over slotProps.
        transitionDuration={reduce ? 0 : 'auto'}
      >
        <Autocomplete
          autoHighlight
          disableClearable
          disablePortal
          filterOptions={categoryFilterOptions}
          getOptionLabel={(option) => option.label}
          inputValue={query}
          isOptionEqualToValue={(option, selected) => option.id === selected.id}
          noOptionsText={t('core:launcher.library.no_category_matches', {
            postProcess: 'capitalizeFirstChar',
            query,
          })}
          onChange={(_event, option) => {
            if (option) {
              onChange(option.id);
              close();
            }
          }}
          onClose={(_event, reason) => {
            // A pick of the option already chosen changes nothing, so no
            // onChange comes: it still closes the picker.
            if (reason === 'escape' || reason === 'selectOption') close();
          }}
          onInputChange={(_event, next, reason) => {
            // Only what is typed: picking or leaving the field must not
            // write the chosen name into the search.
            if (reason === 'input' || reason === 'clear') setQuery(next);
          }}
          open
          openOnFocus
          options={options}
          renderInput={(params) => (
            <InputBase
              autoFocus
              fullWidth
              inputProps={{
                ...params.inputProps,
                'aria-label': searchLabel,
              }}
              inputRef={inputRef}
              placeholder={searchLabel}
              ref={params.InputProps.ref}
              startAdornment={<SearchRoundedIcon aria-hidden />}
              sx={filterFieldSx}
            />
          )}
          renderOption={({ key, ...props }, option) => (
            <Box component="li" {...props} key={option.id}>
              <Box
                aria-hidden
                sx={(theme) => ({
                  alignItems: 'center',
                  backgroundColor: alpha(theme.palette.primary.main, 0.12),
                  borderRadius: '8px',
                  color: libraryAccent(theme),
                  display: 'flex',
                  flexShrink: 0,
                  height: 26,
                  justifyContent: 'center',
                  width: 26,
                })}
              >
                <CategoryIcon id={option.id} size={16} />
              </Box>
              <Box
                component="span"
                sx={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {option.label}
              </Box>
              {option.count != null ? (
                <CountBadge decorative={false}>{option.count}</CountBadge>
              ) : null}
              <CheckRoundedIcon aria-hidden className="libraryCheck" />
            </Box>
          )}
          slotProps={{
            listbox: { sx: optionsSx },
            paper: {
              sx: (theme: Theme) => ({
                backgroundColor: 'transparent',
                '& .MuiAutocomplete-noOptions': {
                  color: libraryMuted(theme),
                  fontSize: '13px',
                  overflowWrap: 'anywhere',
                  px: 1.25,
                  py: 1.5,
                },
              }),
            },
          }}
          slots={{ paper: InlinePaper, popper: InlinePopper }}
          value={selectedOption}
        />
      </Popover>
    </>
  );
};
