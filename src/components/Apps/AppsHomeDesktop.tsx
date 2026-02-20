import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppCircle,
  AppCircleContainer,
  AppCircleLabel,
  AppLibrarySubTitle,
  AppsContainer,
} from './Apps-styles';
import {
  Avatar,
  Box,
  ButtonBase,
  ClickAwayListener,
  InputBase,
  Paper,
  Popper,
  useTheme,
} from '@mui/material';
import AppsIcon from '@mui/icons-material/Apps';
import SearchIcon from '@mui/icons-material/Search';
import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward';
import LinkIcon from '@mui/icons-material/Link';
import { executeEvent } from '../../utils/events';
import { Spacer } from '../../common/Spacer';
import { SortablePinnedApps } from './SortablePinnedApps';
import { extractComponents } from '../Chat/MessageDisplay';
import { useTranslation } from 'react-i18next';
import { QORTAL_PROTOCOL } from '../../constants/constants';
import IconClearInput from '../../assets/svgs/ClearInput.svg';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';
import { getBaseApiReact } from '../../App';
import { officialAppList } from './config/officialApps';

const MAX_SUGGESTIONS = 8;
const MAX_DEFAULT_APPS = 16;

function normalizeQortalInput(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  if (/^qortal:\/\//i.test(trimmed)) return trimmed;
  return `${QORTAL_PROTOCOL}${trimmed}`;
}

export const AppsHomeDesktop = ({
  setMode,
  myApp,
  myWebsite,
  availableQapps = [],
  myName,
  myAddress,
}) => {
  const [query, setQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const searchContainerRef = useRef(null);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const canOpenAsLink = useMemo(() => {
    const normalized = normalizeQortalInput(query);
    if (!normalized) return false;
    return !!extractComponents(normalized);
  }, [query]);

  const officialApps = useMemo(
    () =>
      availableQapps.filter((app) =>
        officialAppList.includes((app?.name ?? '').toLowerCase())
      ),
    [availableQapps]
  );

  const filteredApps = useMemo(() => {
    const q = (query || '').trim().toLowerCase();
    if (!q) return officialApps.slice(0, MAX_DEFAULT_APPS);
    return availableQapps.filter((app) => {
      const name = (app?.name ?? '').toLowerCase();
      const title = (app?.metadata?.title ?? '').toLowerCase();
      const desc = (app?.metadata?.description ?? '').toLowerCase();
      return name.includes(q) || title.includes(q) || desc.includes(q);
    });
  }, [query, availableQapps, officialApps]);

  const suggestions = useMemo(() => {
    const list = [];
    if (canOpenAsLink && query.trim()) {
      list.push({ type: 'link', label: t('core:action.open_as_qortal_link', { postProcess: 'capitalizeFirstChar' }) });
    }
    const apps = filteredApps.slice(0, MAX_SUGGESTIONS - list.length);
    apps.forEach((app) => list.push({ type: 'app', app }));
    return list;
  }, [canOpenAsLink, query, filteredApps, t]);

  const openAsLink = useCallback(() => {
    const normalized = normalizeQortalInput(query);
    const res = extractComponents(normalized);
    if (res) {
      const { service, name, identifier, path } = res;
      executeEvent('addTab', { data: { service, name, identifier, path } });
      executeEvent('open-apps-mode', {});
      setQuery('');
      setDropdownOpen(false);
    }
  }, [query]);

  const openApp = useCallback((app) => {
    executeEvent('addTab', { data: app });
    executeEvent('open-apps-mode', {});
    setQuery('');
    setDropdownOpen(false);
  }, []);

  const displaySuggestions = useMemo(() => {
    if (query.trim()) return suggestions;
    return filteredApps.map((app) => ({ type: 'app', app }));
  }, [query, suggestions, filteredApps]);

  const showDropdown = dropdownOpen && displaySuggestions.length > 0;

  useEffect(() => {
    setHighlightedIndex((i) =>
      displaySuggestions.length ? Math.min(i, displaySuggestions.length - 1) : 0
    );
  }, [displaySuggestions.length]);

  const handleSubmit = useCallback(() => {
    const q = query.trim();
    if (!q) return;

    const suggestion = displaySuggestions[highlightedIndex];
    if (suggestion) {
      if (suggestion.type === 'link') {
        openAsLink();
        return;
      }
      if (suggestion.type === 'app') {
        openApp(suggestion.app);
        return;
      }
    }

    if (canOpenAsLink) {
      openAsLink();
    } else if (filteredApps.length > 0) {
      openApp(filteredApps[0]);
    }
  }, [query, displaySuggestions, highlightedIndex, canOpenAsLink, filteredApps, openAsLink, openApp]);

  const handleKeyDown = useCallback(
    (e) => {
      if (!dropdownOpen || displaySuggestions.length === 0) {
        if (e.key === 'Enter') handleSubmit();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((i) => (i + 1) % displaySuggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((i) => (i - 1 + displaySuggestions.length) % displaySuggestions.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const s = displaySuggestions[highlightedIndex];
        if (s?.type === 'link') openAsLink();
        else if (s?.type === 'app') openApp(s.app);
        else handleSubmit();
        return;
      }
      if (e.key === 'Escape') {
        setDropdownOpen(false);
      }
    },
    [dropdownOpen, displaySuggestions, highlightedIndex, handleSubmit, openAsLink, openApp]
  );

  return (
    <>
      <AppsContainer
        sx={{
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <AppLibrarySubTitle
          sx={{
            fontSize: '30px',
          }}
        >
          {t('core:apps_dashboard', { postProcess: 'capitalizeFirstChar' })}
        </AppLibrarySubTitle>

        <ClickAwayListener onClickAway={() => setDropdownOpen(false)}>
          <Box
            ref={searchContainerRef}
            sx={{
              position: 'relative',
              width: '100%',
              maxWidth: '560px',
            }}
          >
            <Paper
              elevation={0}
              sx={{
                alignItems: 'center',
                backgroundColor: theme.palette.background.paper,
                borderRadius: '28px',
                border: `1px solid ${theme.palette.divider}`,
                display: 'flex',
                gap: '8px',
                padding: '6px 8px 6px 20px',
                transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
                width: '100%',
                '&:hover': {
                  borderColor: theme.palette.text.secondary,
                },
                '&:focus-within': {
                  borderColor: theme.palette.primary.main,
                  boxShadow: `0 0 0 1px ${theme.palette.primary.main}`,
                },
              }}
            >
              <SearchIcon
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: 22,
                }}
              />
              <InputBase
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setDropdownOpen(true);
                  setHighlightedIndex(0);
                }}
                onFocus={() => setDropdownOpen(true)}
                onKeyDown={handleKeyDown}
                placeholder={t('core:action.search_apps_or_link', { postProcess: 'capitalizeFirstChar' })}
                autoComplete="off"
                autoCorrect="off"
                inputProps={{
                  'aria-label': t('core:action.search_apps_or_link', { postProcess: 'capitalizeFirstChar' }),
                }}
                sx={{
                  flex: 1,
                  fontSize: '16px',
                  color: theme.palette.text.primary,
                  '& .MuiInputBase-input::placeholder': {
                    color: theme.palette.text.secondary,
                    opacity: 1,
                  },
                }}
              />
              {query && (
                <ButtonBase
                  onClick={() => {
                    setQuery('');
                    setHighlightedIndex(0);
                  }}
                  sx={{ p: 0.5, borderRadius: '50%' }}
                  aria-label="Clear"
                >
                  <img src={IconClearInput} alt="" style={{ width: 18, height: 18 }} />
                </ButtonBase>
              )}
              <ButtonBase
                onClick={handleSubmit}
                sx={{
                  p: 1,
                  borderRadius: '50%',
                  color: query ? theme.palette.primary.main : theme.palette.text.secondary,
                }}
                aria-label="Go"
              >
                <ArrowOutwardIcon sx={{ fontSize: 22 }} />
              </ButtonBase>
            </Paper>

            <Popper
              open={showDropdown}
              anchorEl={searchContainerRef.current}
              placement="bottom-start"
              style={{ width: searchContainerRef.current?.offsetWidth ?? '100%', maxWidth: 560 }}
              modifiers={[
                { name: 'offset', options: { offset: [0, 8] } },
              ]}
            >
              <Paper
                elevation={8}
                sx={{
                  width: '100%',
                  maxWidth: 560,
                  maxHeight: 360,
                  overflowX: 'hidden',
                  overflowY: 'auto',
                  borderRadius: '16px',
                  border: `1px solid ${theme.palette.divider}`,
                  py: 0.5,
                  minWidth: 0,
                  boxSizing: 'border-box',
                  // Clean scrollbar: vertical only, subtle styling
                  scrollbarWidth: 'thin',
                  scrollbarColor: `${theme.palette.divider} transparent`,
                  '&::-webkit-scrollbar': {
                    width: '8px',
                  },
                  '&::-webkit-scrollbar-track': {
                    background: 'transparent',
                  },
                  '&::-webkit-scrollbar-thumb': {
                    backgroundColor: theme.palette.divider,
                    borderRadius: '4px',
                  },
                  '&::-webkit-scrollbar-thumb:hover': {
                    backgroundColor: theme.palette.text.secondary,
                  },
                  // No horizontal scrollbar in Firefox
                  '&::-webkit-scrollbar-corner': { display: 'none' },
                }}
              >
                {displaySuggestions.length === 0 && (
                  <Box sx={{ px: 2, py: 2, color: theme.palette.text.secondary, fontSize: 14 }}>
                    {t('core:action.search_apps', { postProcess: 'capitalizeFirstChar' })}
                  </Box>
                )}
                {displaySuggestions.map((item, idx) => {
                  if (item.type === 'link') {
                    return (
                      <ButtonBase
                        key="qortal-link"
                        onClick={openAsLink}
                        onMouseEnter={() => setHighlightedIndex(idx)}
                        sx={{
                          width: '100%',
                          justifyContent: 'flex-start',
                          gap: 1.5,
                          px: 2,
                          py: 1.5,
                          textAlign: 'left',
                          backgroundColor: highlightedIndex === idx ? theme.palette.action.hover : 'transparent',
                          borderRadius: '8px',
                          mx: 0.5,
                        }}
                      >
                        <LinkIcon sx={{ color: theme.palette.primary.main, fontSize: 20, flexShrink: 0 }} />
                        <Box sx={{ fontSize: 14, color: theme.palette.text.primary, flexShrink: 0 }}>
                          {item.label}
                        </Box>
                        <Box
                          sx={{
                            fontSize: 12,
                            color: theme.palette.text.secondary,
                            ml: 0.5,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {normalizeQortalInput(query)}
                        </Box>
                      </ButtonBase>
                    );
                  }
                  const app = item.app;
                  const title = app?.metadata?.title || app?.name || '';
                  return (
                    <ButtonBase
                      key={`${app?.service}-${app?.name}`}
                      onClick={() => openApp(app)}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      sx={{
                        width: '100%',
                        justifyContent: 'flex-start',
                        alignItems: 'center',
                        gap: 1.5,
                        px: 2,
                        py: 1.25,
                        textAlign: 'left',
                        backgroundColor: highlightedIndex === idx ? theme.palette.action.hover : 'transparent',
                        borderRadius: '8px',
                        mx: 0.5,
                      }}
                    >
                      <Avatar
                        variant="rounded"
                        sx={{
                          width: 36,
                          height: 36,
                          '& img': { objectFit: 'fill' },
                        }}
                        alt={title}
                        src={
                          app?.privateAppProperties?.logo
                            ? app.privateAppProperties.logo
                            : `${getBaseApiReact()}/arbitrary/THUMBNAIL/${app?.name}/qortal_avatar?async=true`
                        }
                      >
                        <img
                          style={{ width: 24, height: 'auto' }}
                          src={LogoSelected}
                          alt=""
                        />
                      </Avatar>
                      <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                        <Box
                          sx={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: theme.palette.text.primary,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {title}
                        </Box>
                        {app?.name && (
                          <Box
                            sx={{
                              fontSize: 12,
                              color: theme.palette.text.secondary,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {app.name}
                          </Box>
                        )}
                      </Box>
                    </ButtonBase>
                  );
                })}
              </Paper>
            </Popper>
          </Box>
        </ClickAwayListener>
      </AppsContainer>

      <Spacer height="45px" />

      <AppsContainer
        sx={{
          gap: '50px',
          justifyContent: 'flex-start',
        }}
      >
        <ButtonBase
          onClick={() => {
            setMode('library');
          }}
        >
          <AppCircleContainer
            sx={{
              gap: '10px',
            }}
          >
            <AppCircle>
              <AppsIcon />
            </AppCircle>

            <AppCircleLabel>
              {t('core:explore', { postProcess: 'capitalizeFirstChar' })}
            </AppCircleLabel>
          </AppCircleContainer>
        </ButtonBase>

        <SortablePinnedApps
          isDesktop={true}
          availableQapps={availableQapps}
          myWebsite={myWebsite}
          myApp={myApp}
        />
      </AppsContainer>
    </>
  );
};
