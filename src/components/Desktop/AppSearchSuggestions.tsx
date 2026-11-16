import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import LockIcon from '@mui/icons-material/Lock';
import SearchIcon from '@mui/icons-material/Search';
import {
  Avatar,
  Box,
  Button,
  Paper,
  Popper,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Fragment,
  type HTMLAttributes,
  type Key,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';
import { getBaseApiReactForAvatar } from '../../utils/globalApi';
import type { PinnedApp } from '../../utils/pinnedAppsSettings';
import type { AppBookmark } from '../Apps/AppBookmarks/bookmarkTypes';
import {
  appTitle,
  type SearchableApp,
  splitFirstMatch,
} from './appSearchSuggestions';
import {
  canOpenInNewTab,
  isPrivateAppTab,
  type OmniboxGroup,
  type OmniboxLink,
  type OmniboxOption,
  type OmniboxTab,
  omniboxTabTitle,
} from './omniboxSuggestions';

type SuggestionOptionProps = HTMLAttributes<HTMLLIElement> & { key: Key };

/** The list is never narrower than this, unless the field is. */
export const SUGGESTIONS_MIN_WIDTH = 380;

/** One group of rows, as `useAutocomplete` hands them out with `groupBy`. */
export type SuggestionGroup = {
  group: OmniboxGroup;
  /** The index of the group's first row among all the rows. */
  index: number;
  key: number;
  options: OmniboxOption[];
};

type AppSearchSuggestionsProps = {
  anchorEl: HTMLElement | null;
  getListboxProps: () => HTMLAttributes<HTMLUListElement>;
  getOptionProps: (props: {
    index: number;
    option: OmniboxOption;
  }) => SuggestionOptionProps;
  groups: SuggestionGroup[];
  /** Opens a row in its app's open tab, or with `newTab` in a new one. */
  onOpenOption?: (option: OmniboxOption, newTab: boolean) => void;
  open: boolean;
  /** The open tab a row's app is in, if any. */
  openTabOf?: (option: OmniboxOption) => OmniboxTab | null;
  query: string;
  /** The page an open tab shows ('' at its start page). */
  tabPageOf?: (tab: OmniboxTab) => string;
};

/** `text` with the part that matches `query` in bold. */
const MatchedText = ({ query, text }: { query: string; text: string }) => {
  const { after, before, match } = splitFirstMatch(text, query);
  return (
    <>
      {before}
      {match ? (
        <Box
          component="mark"
          sx={{
            backgroundColor: 'transparent',
            color: 'inherit',
            fontWeight: 800,
          }}
        >
          {match}
        </Box>
      ) : null}
      {after}
    </>
  );
};

/**
 * A row's picture. A Q-App or website without one shows the Qortal logo, as
 * the launcher's tiles and the tabs do; a name shows its first letter.
 */
const SuggestionAvatar = ({
  label,
  name,
  round = false,
  src,
}: {
  label: string;
  name?: string | null;
  round?: boolean;
  src?: string | null;
}) => (
  <Avatar
    alt=""
    src={
      src ||
      (name
        ? `${getBaseApiReactForAvatar()}/arbitrary/THUMBNAIL/${encodeURIComponent(
            name
          )}/qortal_avatar?async=true`
        : undefined)
    }
    variant={round ? 'circular' : 'rounded'}
    sx={{
      borderRadius: round ? '50%' : '7px',
      flexShrink: 0,
      fontSize: '0.8rem',
      height: 28,
      width: 28,
    }}
  >
    {round ? (
      label.charAt(0).toUpperCase()
    ) : (
      <Box
        alt=""
        component="img"
        draggable={false}
        src={LogoSelected}
        sx={{ height: 'auto', width: '64%' }}
      />
    )}
  </Avatar>
);

/** A row's picture when it is an icon. */
const SuggestionIcon = ({ children }: { children: ReactNode }) => {
  const theme = useTheme();
  return (
    <Box
      sx={{
        alignItems: 'center',
        color: theme.palette.text.secondary,
        display: 'flex',
        flexShrink: 0,
        height: 28,
        justifyContent: 'center',
        width: 28,
      }}
    >
      {children}
    </Box>
  );
};

/** A row's two lines: its title, with the typed part in bold, and what it is. */
const SuggestionText = ({
  details,
  query,
  title,
}: {
  details: ReactNode;
  query: string;
  title: string;
}) => {
  const theme = useTheme();
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography
        noWrap
        sx={{
          color: theme.palette.text.primary,
          fontSize: '0.82rem',
          fontWeight: 600,
          lineHeight: 1.3,
        }}
      >
        <MatchedText query={query} text={title} />
      </Typography>
      <Typography
        noWrap
        sx={{
          color: theme.palette.text.secondary,
          fontSize: '0.7rem',
          lineHeight: 1.3,
        }}
      >
        {details}
      </Typography>
    </Box>
  );
};

/** `name · what it is`, without the name when the title already says it. */
const NameAndType = ({
  name,
  query,
  title,
  type,
}: {
  name?: string | null;
  query: string;
  title: string;
  type: string;
}) => (
  <>
    {name && title.toLowerCase() !== name.toLowerCase() ? (
      <>
        <MatchedText query={query} text={name} />
        {' · '}
      </>
    ) : null}
    {type}
  </>
);

const AppSuggestion = ({
  app,
  query,
}: {
  app: SearchableApp;
  query: string;
}) => {
  const { t } = useTranslation(['core']);
  const title = appTitle(app);
  const type =
    app.service.toUpperCase() === 'WEBSITE'
      ? t('core:navbar.suggestion_type.website')
      : t('core:navbar.suggestion_type.app');

  return (
    <>
      <SuggestionAvatar label={title} name={app.name} />
      <SuggestionText
        details={
          <NameAndType
            name={app.name}
            query={query}
            title={title}
            type={type}
          />
        }
        query={query}
        title={title}
      />
    </>
  );
};

/** The private app's logo, or a lock. */
const PrivateAppPicture = ({
  label,
  logo,
}: {
  label: string;
  logo?: string | null;
}) =>
  logo ? (
    <SuggestionAvatar label={label} src={logo} />
  ) : (
    <SuggestionIcon>
      <LockIcon sx={{ fontSize: 17 }} />
    </SuggestionIcon>
  );

const TabSuggestion = ({
  hasActions,
  page,
  query,
  tab,
}: {
  /** The row has its Switch to tab and New tab buttons. */
  hasActions: boolean;
  /** The page the tab shows, which tells two tabs of one app apart. */
  page: string;
  query: string;
  tab: OmniboxTab;
}) => {
  const { t } = useTranslation(['core']);
  const title = omniboxTabTitle(tab);
  const isPrivate = isPrivateAppTab(tab);
  const kind =
    String(tab.service ?? '').toUpperCase() === 'WEBSITE'
      ? t('core:navbar.suggestion_type.website')
      : t('core:navbar.suggestion_type.app');

  return (
    <>
      {isPrivate ? (
        <PrivateAppPicture
          label={title}
          logo={tab.privateAppProperties?.logo}
        />
      ) : (
        <SuggestionAvatar label={title} name={tab.name} />
      )}
      <SuggestionText
        details={
          <NameAndType
            // The strip names a private app's tab after its publisher.
            name={isPrivate ? tab.privateAppProperties?.appName : tab.name}
            query={query}
            title={title}
            type={
              hasActions
                ? page || kind
                : t('core:navbar.suggestion_action.switch_to_tab')
            }
          />
        }
        query={query}
        title={title}
      />
    </>
  );
};

const PinnedSuggestion = ({
  app,
  query,
  title,
}: {
  app: PinnedApp;
  query: string;
  title: string;
}) => {
  const { t } = useTranslation(['core']);

  if (!app.isPrivate) {
    return (
      <AppSuggestion
        app={{
          metadata: { title },
          name: String(app.name),
          service: String(app.service),
        }}
        query={query}
      />
    );
  }

  const properties = app.privateAppProperties;
  const privateLabel = t('core:app_private', {
    postProcess: 'capitalizeFirstChar',
  });
  const label = title || privateLabel;
  return (
    <>
      <PrivateAppPicture label={label} logo={properties?.logo} />
      <SuggestionText
        details={
          <NameAndType
            name={properties?.name}
            query={query}
            title={label}
            type={privateLabel}
          />
        }
        query={query}
        title={label}
      />
    </>
  );
};

const BookmarkSuggestion = ({
  bookmark,
  query,
}: {
  bookmark: AppBookmark;
  query: string;
}) => {
  const { t } = useTranslation(['core']);
  const title = bookmark.name || bookmark.appName;

  return (
    <>
      <SuggestionAvatar label={title} name={bookmark.appName} />
      <SuggestionText
        details={
          <NameAndType
            name={bookmark.appName}
            query={query}
            title={title}
            type={t('core:navbar.suggestion_type.bookmark')}
          />
        }
        query={query}
        title={title}
      />
    </>
  );
};

const NameSuggestion = ({
  app,
  name,
  query,
}: {
  app: SearchableApp | null;
  name: string;
  query: string;
}) => {
  const { t } = useTranslation(['core']);
  const type = !app
    ? t('core:navbar.suggestion_type.name')
    : app.service.toUpperCase() === 'WEBSITE'
      ? t('core:navbar.suggestion_type.website')
      : t('core:navbar.suggestion_type.app');

  return (
    <>
      <SuggestionAvatar label={name} name={name} round />
      <SuggestionText details={type} query={query} title={name} />
    </>
  );
};

const LinkSuggestion = ({ link }: { link: OmniboxLink }) => {
  const { t } = useTranslation(['core']);

  return (
    <>
      <SuggestionIcon>
        <LinkRoundedIcon sx={{ fontSize: 19 }} />
      </SuggestionIcon>
      <SuggestionText
        details={t('core:navbar.suggestion_action.open_link')}
        query=""
        title={link.link}
      />
    </>
  );
};

const LibrarySuggestion = ({ query }: { query: string }) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  return (
    <>
      <SuggestionIcon>
        <SearchIcon sx={{ fontSize: 18 }} />
      </SuggestionIcon>
      <Typography
        noWrap
        sx={{
          color: theme.palette.text.primary,
          flex: 1,
          fontSize: '0.82rem',
          minWidth: 0,
        }}
      >
        {t('core:navbar.search_library', { query })}
      </Typography>
    </>
  );
};

/**
 * For a row whose Q-App or website is open already: its open tab, or a new
 * one. For the pointer; the keyboard has Enter and Alt+Enter.
 */
const SuggestionActions = ({
  onNewTab,
  onSwitch,
}: {
  onNewTab: () => void;
  onSwitch: () => void;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const capital = { postProcess: 'capitalizeFirstChar' };
  const pressing = (action: () => void) => ({
    // The field keeps the focus, and the row doesn't take the click too.
    onMouseDown: (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    },
    onClick: (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    },
  });
  const buttonSx = {
    borderRadius: '7px',
    flexShrink: 0,
    fontSize: '0.72rem',
    lineHeight: 1.4,
    minWidth: 0,
    px: '9px',
    py: '3px',
    textTransform: 'none',
    whiteSpace: 'nowrap',
  } as const;
  return (
    <Box aria-hidden sx={{ display: 'flex', flexShrink: 0, gap: '6px' }}>
      <Button
        size="small"
        tabIndex={-1}
        variant="contained"
        disableElevation
        {...pressing(onSwitch)}
        sx={buttonSx}
      >
        {t('core:navbar.suggestion_action.switch_to_tab', capital)}
      </Button>
      <Button
        size="small"
        tabIndex={-1}
        variant="outlined"
        {...pressing(onNewTab)}
        sx={{ ...buttonSx, color: theme.palette.text.primary }}
      >
        {t('core:navbar.suggestion_action.new_tab', capital)}
      </Button>
    </Box>
  );
};

const SuggestionRow = ({
  hasActions,
  option,
  query,
  tabPageOf,
}: {
  hasActions: boolean;
  option: OmniboxOption;
  query: string;
  tabPageOf?: (tab: OmniboxTab) => string;
}) => {
  switch (option.kind) {
    case 'app':
      return <AppSuggestion app={option.app} query={query} />;
    case 'bookmark':
      return <BookmarkSuggestion bookmark={option.bookmark} query={query} />;
    case 'link':
      return <LinkSuggestion link={option.link} />;
    case 'name':
      return (
        <NameSuggestion app={option.app} name={option.name} query={query} />
      );
    case 'pinned':
      return (
        <PinnedSuggestion app={option.app} query={query} title={option.title} />
      );
    case 'tab':
      return (
        <TabSuggestion
          hasActions={hasActions}
          page={tabPageOf?.(option.tab) ?? ''}
          query={query}
          tab={option.tab}
        />
      );
    default:
      return <LibrarySuggestion query={option.query} />;
  }
};

/**
 * The top bar's suggestions, under the search field: a listbox whose groups
 * are named by their headings. The link and the library search stand alone.
 */
export const AppSearchSuggestions = ({
  anchorEl,
  getListboxProps,
  getOptionProps,
  groups,
  onOpenOption,
  open,
  openTabOf,
  query,
  tabPageOf,
}: AppSearchSuggestionsProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const listboxProps = getListboxProps();
  const fieldWidth = anchorEl?.offsetWidth ?? 0;

  const groupLabel = (group: OmniboxGroup): string | null => {
    switch (group) {
      case 'apps':
        return t('core:navbar.suggestion_group.apps');
      case 'names':
        return t('core:navbar.suggestion_group.names');
      case 'saved':
        return t('core:navbar.suggestion_group.saved');
      case 'tabs':
        return t('core:navbar.suggestion_group.tabs');
      default:
        return null;
    }
  };

  const renderOption = (option: OmniboxOption, index: number) => {
    const { key, ...optionProps } = getOptionProps({ index, option });
    // An app that is open already: its tab, or a new one.
    const hasActions =
      !!onOpenOption && canOpenInNewTab(openTabOf?.(option) ?? null);
    return (
      <Box
        component="li"
        key={key}
        {...optionProps}
        sx={{
          alignItems: 'center',
          borderRadius: '8px',
          cursor: 'pointer',
          display: 'flex',
          gap: '10px',
          minHeight: 40,
          px: '8px',
          py: '5px',
          '&.Mui-focused': {
            backgroundColor: alpha(
              theme.palette.primary.main,
              theme.palette.mode === 'dark' ? 0.18 : 0.1
            ),
          },
        }}
      >
        <SuggestionRow
          hasActions={hasActions}
          option={option}
          query={query}
          tabPageOf={tabPageOf}
        />
        {hasActions ? (
          <SuggestionActions
            onNewTab={() => onOpenOption?.(option, true)}
            onSwitch={() => onOpenOption?.(option, false)}
          />
        ) : null}
      </Box>
    );
  };

  return (
    <Popper
      anchorEl={anchorEl}
      open={open && !!anchorEl && groups.length > 0}
      placement="bottom-start"
      sx={{
        // As wide as its widest row, up to the field's width, where a long
        // title ends in "…"; never narrower than a row with its buttons.
        maxWidth: fieldWidth || undefined,
        minWidth: Math.min(SUGGESTIONS_MIN_WIDTH, fieldWidth || Infinity),
        width: 'max-content',
        zIndex: theme.zIndex.modal,
      }}
    >
      <Paper
        elevation={8}
        sx={{
          backgroundColor: theme.palette.background.paper,
          border: `1px solid ${theme.palette.border.subtle}`,
          borderRadius: '12px',
          mt: '6px',
          overflow: 'hidden',
          p: '4px',
        }}
      >
        <Box
          component="ul"
          {...listboxProps}
          aria-label={t('core:navbar.suggestions')}
          aria-labelledby={undefined}
          sx={{
            listStyle: 'none',
            m: 0,
            maxHeight: 'min(420px, 60vh)',
            overflowY: 'auto',
            p: 0,
            // Rows are scrolled into view by their offset in the list.
            position: 'relative',
          }}
        >
          {groups.map((group) => {
            const rows = group.options.map((option, offset) =>
              renderOption(option, group.index + offset)
            );
            const label = groupLabel(group.group);
            if (!label) return <Fragment key={group.key}>{rows}</Fragment>;

            const labelId = `${listboxProps.id}-group-${group.group}`;
            return (
              <Box component="li" key={group.key} role="presentation">
                <Typography
                  aria-hidden
                  component="div"
                  id={labelId}
                  noWrap
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    lineHeight: 1.3,
                    pb: '2px',
                    pt: '6px',
                    px: '8px',
                  }}
                >
                  {label}
                </Typography>
                <Box
                  aria-labelledby={labelId}
                  component="ul"
                  role="group"
                  sx={{ listStyle: 'none', m: 0, p: 0 }}
                >
                  {rows}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Paper>
    </Popper>
  );
};
