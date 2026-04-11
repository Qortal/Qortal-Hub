import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, ButtonBase, InputBase, useTheme } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward';
import RefreshIcon from '@mui/icons-material/Refresh';
import ArrowBackIosNewRoundedIcon from '@mui/icons-material/ArrowBackIosNewRounded';
import ArrowForwardIosRoundedIcon from '@mui/icons-material/ArrowForwardIosRounded';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { extractComponents } from '../Chat/MessageDisplay';
import { navigationControllerAtom } from '../../atoms/global';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { QORTAL_PROTOCOL } from '../../constants/constants';
import { APP_NAV_BAR_HEIGHT } from './CustomTitleBar';

type GlobalQortalNavBarProps = {
  desktopViewMode: string;
};

type SelectedTab = {
  tabId: string;
  name: string;
  service: string;
  identifier?: string;
  path?: string;
  refreshFunc?: (tabId?: string) => void;
} | null;

function normalizeQortalInput(value: string) {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  if (/^qortal:\/\//i.test(trimmed)) return trimmed;
  return `${QORTAL_PROTOCOL}${trimmed}`;
}

export function GlobalQortalNavBar({
  desktopViewMode,
}: GlobalQortalNavBarProps) {
  const theme = useTheme();
  const navigationController = useAtomValue(navigationControllerAtom);
  const { t } = useTranslation(['core']);
  const [selectedTab, setSelectedTab] = useState<SelectedTab>(null);
  const [inputValue, setInputValue] = useState('');
  const isInputFocusedRef = useRef(false);

  const setTabsToNav = useCallback((e: CustomEvent) => {
    const nextSelectedTab = e.detail?.data?.selectedTab;
    setSelectedTab(nextSelectedTab ? { ...nextSelectedTab } : null);
  }, []);

  useEffect(() => {
    subscribeToEvent('setTabsToNav', setTabsToNav);

    return () => {
      unsubscribeFromEvent('setTabsToNav', setTabsToNav);
    };
  }, [setTabsToNav]);

  const currentNavigation = selectedTab?.tabId
    ? navigationController?.[selectedTab.tabId]
    : null;

  const currentLink = useMemo(() => {
    return currentNavigation?.currentLink || '';
  }, [currentNavigation]);

  useEffect(() => {
    if (isInputFocusedRef.current) return;
    if (desktopViewMode === 'apps' && currentLink) {
      setInputValue(currentLink);
      return;
    }
    if (desktopViewMode !== 'apps') {
      setInputValue('');
    }
  }, [currentLink, desktopViewMode]);

  const handleOpenInput = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    const normalized = normalizeQortalInput(trimmed);
    const parsedLink = extractComponents(normalized);

    if (parsedLink) {
      const { service, name, identifier, path } = parsedLink;
      executeEvent('addTab', { data: { service, name, identifier, path } });
      executeEvent('open-apps-mode', {});
      return;
    }

    executeEvent('openAppsLibrarySearch', {
      data: {
        query: trimmed,
      },
    });
    executeEvent('open-apps-mode', {});
  }, [inputValue]);

  const canGoBack = !!selectedTab?.tabId && !!currentNavigation?.hasBack;
  const canGoForward = !!selectedTab?.tabId && !!currentNavigation?.hasForward;
  const canRefresh = !!selectedTab?.tabId && desktopViewMode === 'apps';
  const chromeBackground =
    theme.palette.mode === 'dark'
      ? 'rgba(39, 40, 44, 0.96)'
      : 'rgba(206, 209, 216, 0.96)';
  const inputBackground =
    theme.palette.mode === 'dark'
      ? 'rgba(58, 60, 65, 0.88)'
      : 'rgba(255, 255, 255, 0.72)';
  const inputHoverBackground =
    theme.palette.mode === 'dark'
      ? 'rgba(65, 67, 73, 0.94)'
      : 'rgba(255, 255, 255, 0.82)';
  const inputFocusBackground =
    theme.palette.mode === 'dark'
      ? 'rgba(70, 73, 79, 0.96)'
      : 'rgba(255, 255, 255, 0.9)';
  const hoverBorderColor =
    theme.palette.mode === 'dark'
      ? 'rgba(255, 255, 255, 0.16)'
      : 'rgba(0, 0, 0, 0.14)';
  const focusBorderColor =
    theme.palette.mode === 'dark'
      ? 'rgba(255, 255, 255, 0.24)'
      : 'rgba(0, 0, 0, 0.2)';
  const inputHoverShadow =
    theme.palette.mode === 'dark'
      ? '0 0 0 1px rgba(255, 255, 255, 0.03), 0 8px 18px rgba(0, 0, 0, 0.14)'
      : '0 0 0 1px rgba(255, 255, 255, 0.08), 0 8px 18px rgba(120, 127, 140, 0.12)';
  const inputFocusShadow =
    theme.palette.mode === 'dark'
      ? '0 0 0 1px rgba(255, 255, 255, 0.06), 0 10px 24px rgba(0, 0, 0, 0.2)'
      : '0 0 0 1px rgba(255, 255, 255, 0.12), 0 10px 24px rgba(120, 127, 140, 0.16)';
  const buttonHoverBackground =
    theme.palette.mode === 'dark'
      ? 'rgba(255, 255, 255, 0.06)'
      : 'rgba(0, 0, 0, 0.05)';

  return (
    <Box
      sx={{
        alignItems: 'center',
        backdropFilter: 'blur(10px)',
        backgroundColor: chromeBackground,
        borderBottom: `1px solid ${theme.palette.border.subtle}`,
        display: 'flex',
        height: `${APP_NAV_BAR_HEIGHT}px`,
        width: '100%',
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: 1.25,
          height: '100%',
          maxWidth: '100%',
          pl: { xs: 1.5, sm: 2, md: 3 },
          pr: { xs: 1.5, sm: 2, md: 2.5 },
          width: '100%',
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexShrink: 0,
            gap: 0.5,
            pr: 1.25,
            position: 'relative',
            '&::after': {
              backgroundColor: theme.palette.border.subtle,
              content: '""',
              height: 20,
              position: 'absolute',
              right: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              width: '1px',
            },
          }}
        >
          <ButtonBase
            onClick={() => {
              if (!selectedTab?.tabId) return;
              executeEvent(`navigateBackApp-${selectedTab.tabId}`, {});
            }}
            disabled={!canGoBack}
            sx={{
              alignItems: 'center',
              borderRadius: '9px',
              color: theme.palette.text.primary,
              display: 'flex',
              height: 32,
              justifyContent: 'center',
              opacity: canGoBack ? 1 : 0.32,
              transition:
                'background-color 180ms ease, color 180ms ease, opacity 180ms ease, transform 220ms ease',
              width: 32,
              '&:hover:not(.Mui-disabled)': {
                backgroundColor: buttonHoverBackground,
                transform: 'translateY(-1px)',
              },
            }}
          >
            <ArrowBackIosNewRoundedIcon sx={{ fontSize: 15 }} />
          </ButtonBase>

          <ButtonBase
            onClick={() => {
              if (!selectedTab?.tabId) return;
              executeEvent(`navigateForwardApp-${selectedTab.tabId}`, {});
            }}
            disabled={!canGoForward}
            sx={{
              alignItems: 'center',
              borderRadius: '9px',
              color: theme.palette.text.primary,
              display: 'flex',
              height: 32,
              justifyContent: 'center',
              opacity: canGoForward ? 1 : 0.32,
              transition:
                'background-color 180ms ease, color 180ms ease, opacity 180ms ease, transform 220ms ease',
              width: 32,
              '&:hover:not(.Mui-disabled)': {
                backgroundColor: buttonHoverBackground,
                transform: 'translateY(-1px)',
              },
            }}
          >
            <ArrowForwardIosRoundedIcon sx={{ fontSize: 15 }} />
          </ButtonBase>

          <ButtonBase
            onClick={() => {
              if (!selectedTab?.tabId) return;
              if (selectedTab?.refreshFunc) {
                selectedTab.refreshFunc(selectedTab?.tabId);
                return;
              }
              executeEvent('refreshApp', {
                tabId: selectedTab.tabId,
              });
            }}
            disabled={!canRefresh}
            sx={{
              alignItems: 'center',
              borderRadius: '9px',
              color: theme.palette.text.primary,
              display: 'flex',
              height: 32,
              justifyContent: 'center',
              opacity: canRefresh ? 1 : 0.32,
              transition:
                'background-color 180ms ease, color 180ms ease, opacity 180ms ease, transform 220ms ease',
              width: 32,
              '&:hover:not(.Mui-disabled)': {
                backgroundColor: buttonHoverBackground,
                transform: 'translateY(-1px)',
              },
            }}
          >
            <RefreshIcon sx={{ fontSize: 18 }} />
          </ButtonBase>
        </Box>

        <Box
          sx={{
            alignItems: 'center',
            backgroundColor: inputBackground,
            border: `1px solid ${theme.palette.border.subtle}`,
            borderRadius: '12px',
            display: 'flex',
            flex: 1,
            gap: 1,
            height: 34,
            minWidth: 0,
            px: 1.5,
            boxShadow: 'none',
            transition:
              'background-color 240ms ease, border-color 240ms ease, box-shadow 280ms ease, transform 280ms ease',
            '&:hover': {
              backgroundColor: inputHoverBackground,
              borderColor: hoverBorderColor,
              boxShadow: inputHoverShadow,
              transform: 'translateY(-1px)',
            },
            '&:focus-within': {
              backgroundColor: inputFocusBackground,
              borderColor: focusBorderColor,
              boxShadow: inputFocusShadow,
              transform: 'translateY(-1px)',
            },
          }}
        >
          <SearchIcon
            sx={{
              color: theme.palette.text.secondary,
              fontSize: 17,
            }}
          />
          <InputBase
            value={inputValue}
            onBlur={() => {
              isInputFocusedRef.current = false;
            }}
            onChange={(e) => setInputValue(e.target.value)}
            onFocus={() => {
              isInputFocusedRef.current = true;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleOpenInput();
              }
            }}
            placeholder={t('core:action.search_apps_or_link', {
              postProcess: 'capitalizeFirstChar',
            })}
            sx={{
              color: theme.palette.text.primary,
              flex: 1,
              fontSize: '13.5px',
              minWidth: 0,
              '& .MuiInputBase-input': {
                py: '6px',
              },
              '& .MuiInputBase-input::placeholder': {
                color: theme.palette.text.secondary,
                opacity: 1,
              },
            }}
          />
          <ButtonBase
            onClick={handleOpenInput}
            sx={{
              alignItems: 'center',
              borderRadius: '8px',
              color: theme.palette.text.secondary,
              display: 'flex',
              flexShrink: 0,
              height: 26,
              justifyContent: 'center',
              transition:
                'background-color 180ms ease, color 180ms ease, transform 220ms ease',
              width: 26,
              '&:hover': {
                backgroundColor: buttonHoverBackground,
                color: theme.palette.text.primary,
                transform: 'translateY(-1px)',
              },
            }}
          >
            <ArrowOutwardIcon sx={{ fontSize: 17 }} />
          </ButtonBase>
        </Box>
      </Box>
    </Box>
  );
}
