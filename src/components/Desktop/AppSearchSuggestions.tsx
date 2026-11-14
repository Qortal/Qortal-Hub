import SearchIcon from '@mui/icons-material/Search';
import {
  Avatar,
  Box,
  Paper,
  Popper,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { HTMLAttributes, Key } from 'react';
import { useTranslation } from 'react-i18next';
import { getBaseApiReactForAvatar } from '../../utils/globalApi';
import {
  type AppSearchOption,
  appTitle,
  type SearchableApp,
  splitFirstMatch,
} from './appSearchSuggestions';

type SuggestionOptionProps = HTMLAttributes<HTMLLIElement> & { key: Key };

type AppSearchSuggestionsProps = {
  anchorEl: HTMLElement | null;
  getListboxProps: () => HTMLAttributes<HTMLUListElement>;
  getOptionProps: (props: {
    index: number;
    option: AppSearchOption;
  }) => SuggestionOptionProps;
  open: boolean;
  options: AppSearchOption[];
  query: string;
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

const AppSuggestion = ({
  app,
  query,
}: {
  app: SearchableApp;
  query: string;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const title = appTitle(app);
  const type =
    app.service.toUpperCase() === 'WEBSITE'
      ? t('core:navbar.suggestion_type.website')
      : t('core:navbar.suggestion_type.app');
  const showName = title.toLowerCase() !== app.name.toLowerCase();

  return (
    <>
      <Avatar
        alt=""
        src={`${getBaseApiReactForAvatar()}/arbitrary/THUMBNAIL/${encodeURIComponent(
          app.name
        )}/qortal_avatar?async=true`}
        variant="rounded"
        sx={{
          borderRadius: '7px',
          flexShrink: 0,
          fontSize: '0.8rem',
          height: 28,
          width: 28,
        }}
      >
        {title.charAt(0).toUpperCase()}
      </Avatar>
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
          {showName ? (
            <>
              <MatchedText query={query} text={app.name} />
              {' · '}
            </>
          ) : null}
          {type}
        </Typography>
      </Box>
    </>
  );
};

const LibrarySuggestion = ({ query }: { query: string }) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  return (
    <>
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
        <SearchIcon sx={{ fontSize: 18 }} />
      </Box>
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

/** The top bar's suggestions, under the search field. */
export const AppSearchSuggestions = ({
  anchorEl,
  getListboxProps,
  getOptionProps,
  open,
  options,
  query,
}: AppSearchSuggestionsProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  return (
    <Popper
      anchorEl={anchorEl}
      open={open && !!anchorEl && options.length > 0}
      placement="bottom-start"
      sx={{ width: anchorEl?.offsetWidth, zIndex: theme.zIndex.modal }}
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
          {...getListboxProps()}
          aria-label={t('core:navbar.suggestions')}
          aria-labelledby={undefined}
          sx={{
            listStyle: 'none',
            m: 0,
            maxHeight: 'min(420px, 60vh)',
            overflowY: 'auto',
            p: 0,
          }}
        >
          {options.map((option, index) => {
            const { key, ...optionProps } = getOptionProps({ index, option });
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
                {option.kind === 'app' ? (
                  <AppSuggestion app={option.app} query={query} />
                ) : (
                  <LibrarySuggestion query={option.query} />
                )}
              </Box>
            );
          })}
        </Box>
      </Paper>
    </Popper>
  );
};
