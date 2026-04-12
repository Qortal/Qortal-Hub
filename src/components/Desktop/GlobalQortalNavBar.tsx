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
  const [isInputHovered, setIsInputHovered] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const isInputFocusedRef = useRef(false);
  const inputElementRef = useRef<HTMLInputElement | null>(null);

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

    const isExplicitQortalLink = /^qortal:\/\//i.test(trimmed);
    const parsedLink = isExplicitQortalLink
      ? extractComponents(normalizeQortalInput(trimmed))
      : null;

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
      ? 'rgba(62, 78, 108, 0.96)'
      : 'rgba(194, 216, 242, 0.94)';
  const inputFocusBackground =
    theme.palette.mode === 'dark'
      ? 'rgba(68, 71, 77, 0.94)'
      : 'rgba(255, 255, 255, 0.88)';
  const hoverBorderColor =
    theme.palette.mode === 'dark'
      ? 'rgba(255, 255, 255, 0.16)'
      : 'rgba(0, 0, 0, 0.14)';
  const focusBorderColor =
    theme.palette.mode === 'dark'
      ? 'rgba(255, 255, 255, 0.24)'
      : 'rgba(0, 0, 0, 0.2)';
  const inputHoverShadow =
    'none';
  const inputFocusShadow =
    theme.palette.mode === 'dark'
      ? 'none'
      : 'none';
  const buttonHoverBackground =
    theme.palette.mode === 'dark'
      ? 'rgba(255, 255, 255, 0.06)'
      : 'rgba(0, 0, 0, 0.05)';
  const inputTextDefaultColor = theme.palette.text.secondary;
  const inputTextHoverColor =
    theme.palette.mode === 'dark'
      ? 'rgba(236, 240, 246, 0.96)'
      : 'rgba(0, 0, 0, 0.78)';
  const inputTextFocusColor = theme.palette.text.primary;
  const inputTextColor = isInputFocused
    ? inputTextFocusColor
    : isInputHovered
      ? inputTextHoverColor
      : inputTextDefaultColor;
  const placeholderColor = isInputFocused
    ? inputTextHoverColor
    : theme.palette.text.secondary;
  const selectionBackground = theme.palette.primary.main;
  const selectionColor =
    theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.92)' : '#ffffff';
  const showStyledLinkPreview =
    !isInputFocused && !!inputValue && /^qortal:\/\//i.test(inputValue);
  const protocolMatch = inputValue.match(/^(qortal:\/\/)/i);
  const protocolText = protocolMatch?.[0] || '';
  const remainderText = protocolText ? inputValue.slice(protocolText.length) : '';
  const protocolColor =
    theme.palette.mode === 'dark'
      ? isInputHovered
        ? 'rgba(242, 246, 252, 0.98)'
        : 'rgba(224, 224, 224, 0.92)'
      : isInputHovered
        ? 'rgba(0, 0, 0, 0.82)'
        : 'rgba(0, 0, 0, 0.74)';
  const remainderColor =
    theme.palette.mode === 'dark'
      ? isInputHovered
        ? 'rgba(218, 226, 238, 0.94)'
        : 'rgba(176, 176, 176, 0.9)'
      : isInputHovered
        ? 'rgba(0, 0, 0, 0.66)'
        : 'rgba(0, 0, 0, 0.56)';
  const linkTextMetrics = {
    fontSize: '13.5px',
    fontWeight: 400,
    letterSpacing: 'normal',
    lineHeight: '20px',
  } as const;

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
                'background-color 180ms ease, color 180ms ease, opacity 180ms ease',
              width: 32,
              '&:hover:not(.Mui-disabled)': {
                backgroundColor: buttonHoverBackground,
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
                'background-color 180ms ease, color 180ms ease, opacity 180ms ease',
              width: 32,
              '&:hover:not(.Mui-disabled)': {
                backgroundColor: buttonHoverBackground,
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
                'background-color 180ms ease, color 180ms ease, opacity 180ms ease',
              width: 32,
              '&:hover:not(.Mui-disabled)': {
                backgroundColor: buttonHoverBackground,
              },
            }}
          >
            <RefreshIcon sx={{ fontSize: 18 }} />
          </ButtonBase>
        </Box>

        <Box
          onMouseEnter={() => setIsInputHovered(true)}
          onMouseLeave={() => setIsInputHovered(false)}
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
              'background-color 240ms ease, border-color 240ms ease, box-shadow 280ms ease',
            '&:hover': {
              backgroundColor: inputHoverBackground,
              borderColor: hoverBorderColor,
              boxShadow: inputHoverShadow,
            },
            '&:focus-within': {
              backgroundColor: inputFocusBackground,
              borderColor: focusBorderColor,
              boxShadow: inputFocusShadow,
            },
          }}
        >
          <SearchIcon
            sx={{
              color: theme.palette.text.secondary,
              fontSize: 17,
            }}
          />
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flex: 1,
              minWidth: 0,
              position: 'relative',
            }}
          >
            {showStyledLinkPreview && (
              <Box
                aria-hidden
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  inset: 0,
                  overflow: 'hidden',
                  pointerEvents: 'none',
                  position: 'absolute',
                  whiteSpace: 'nowrap',
                }}
              >
                <Box
                  component="span"
                  sx={{
                    color: protocolColor,
                    display: 'inline-flex',
                    alignItems: 'center',
                    height: '20px',
                    transition: 'color 220ms ease',
                    ...linkTextMetrics,
                  }}
                >
                  {protocolText}
                </Box>
                <Box
                  component="span"
                  sx={{
                    alignItems: 'center',
                    color: remainderColor,
                    display: 'inline-flex',
                    height: '20px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    transition: 'color 220ms ease',
                    ...linkTextMetrics,
                  }}
                >
                  {remainderText}
                </Box>
              </Box>
            )}
            <InputBase
              inputRef={inputElementRef}
              value={inputValue}
              onBlur={() => {
                isInputFocusedRef.current = false;
                setIsInputFocused(false);
              }}
              onChange={(e) => setInputValue(e.target.value)}
              onFocus={() => {
                isInputFocusedRef.current = true;
                setIsInputFocused(true);
                window.setTimeout(() => {
                  inputElementRef.current?.select();
                }, 0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleOpenInput();
                }
              }}
              placeholder="Search Q-Apps or enter qortal://"
              sx={{
                color: inputTextColor,
                flex: 1,
                minWidth: 0,
                transition: 'color 220ms ease',
                ...linkTextMetrics,
                '& .MuiInputBase-input': {
                  appearance: 'none',
                  boxSizing: 'border-box',
                  color: showStyledLinkPreview ? 'transparent' : 'inherit',
                  display: 'block',
                  height: '20px',
                  lineHeight: '20px',
                  margin: 0,
                  padding: 0,
                  transition: 'color 220ms ease',
                  ...linkTextMetrics,
                  '::selection': {
                    backgroundColor: selectionBackground,
                    color: selectionColor,
                  },
                },
                '& .MuiInputBase-input::placeholder': {
                  color: placeholderColor,
                  opacity: 1,
                  transition: 'color 220ms ease',
                },
              }}
            />
          </Box>
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
                'background-color 180ms ease, color 180ms ease',
              width: 26,
              '&:hover': {
                backgroundColor: buttonHoverBackground,
                color: theme.palette.text.primary,
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
