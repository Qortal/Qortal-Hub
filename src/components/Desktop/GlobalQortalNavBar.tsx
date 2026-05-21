import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, ButtonBase, IconButton, InputBase, Tooltip, useTheme } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward';
import RefreshIcon from '@mui/icons-material/Refresh';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import ArrowBackIosNewRoundedIcon from '@mui/icons-material/ArrowBackIosNewRounded';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { extractComponents } from '../Chat/MessageDisplay';
import {
  infoSnackGlobalAtom,
  navigationControllerAtom,
  openSnackGlobalAtom,
  txListAtom,
  userInfoAtom,
} from '../../atoms/global';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { QORTAL_PROTOCOL } from '../../constants/constants';
import { APP_NAV_BAR_HEIGHT, type CustomTitleBarRightNavProps } from './CustomTitleBar';
import { QMailStatus } from '../QMailStatus';
import { GeneralNotifications } from '../GeneralNotifications';
import { TaskManager } from '../TaskManager/TaskManager';
import { GlobalActions } from '../GlobalActions/GlobalActions';
import { ChatWidgetReopenIcon } from '../Profile/ChatWidgetReopenIcon';
import { SubscriptionsStatus } from './SubscriptionsStatus';
import { AppBookmarksButton } from '../Apps/AppBookmarks';

export const QORTAL_GROUP_CALL_NAV_SLOT_ID = 'qortal-group-call-nav-slot';
export const DIRECT_VOICE_CALL_NAV_SLOT_ID = 'direct-voice-call-nav-slot';

type GlobalQortalNavBarProps = {
  desktopViewMode: string;
  utilityNav?: CustomTitleBarRightNavProps | null;
};

/** Hub-owned surfaces in the app tab strip (e.g. Q-Chat), not arbitrary Q-Apps */
const INTERNAL_TAB_SERVICE = 'INTERNAL';

type SelectedTab = {
  tabId: string;
  name: string;
  service: string;
  identifier?: string;
  path?: string;
  internal?: string;
  refreshFunc?: (tabId?: string) => void;
} | null;

const QAppsNavIcon = ({ color = 'currentColor' }: { color?: string }) => (
  <Box
    aria-hidden="true"
    sx={{
      display: 'grid',
      gap: '3px',
      gridTemplateColumns: 'repeat(2, 1fr)',
      height: 14,
      width: 14,
    }}
  >
    {Array.from({ length: 4 }).map((_, index) => (
      <Box
        key={index}
        sx={{
          backgroundColor: color,
          borderRadius: '50%',
          height: 4,
          width: 4,
        }}
      />
    ))}
  </Box>
);

function normalizeQortalInput(value: string) {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  if (/^qortal:\/\//i.test(trimmed)) return trimmed;
  return `${QORTAL_PROTOCOL}${trimmed}`;
}

export function GlobalQortalNavBar({
  desktopViewMode,
  utilityNav = null,
}: GlobalQortalNavBarProps) {
  const theme = useTheme();
  const navigationController = useAtomValue(navigationControllerAtom);
  const txList = useAtomValue(txListAtom);
  const userInfo = useAtomValue(userInfoAtom);
  const setOpenSnackGlobal = useSetAtom(openSnackGlobalAtom);
  const setInfoSnackGlobal = useSetAtom(infoSnackGlobalAtom);
  const { t } = useTranslation(['core', 'question']);
  const [selectedTab, setSelectedTab] = useState<SelectedTab>(null);
  const [inputValue, setInputValue] = useState('');
  const [isInputHovered, setIsInputHovered] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const isInputFocusedRef = useRef(false);
  const lastTabsTokenRef = useRef(0);
  const navClearLockUntilRef = useRef(0);
  const inputElementRef = useRef<HTMLInputElement | null>(null);

  const setTabsToNav = useCallback((e: CustomEvent) => {
    const nextToken = Number(e.detail?.data?.tabsToken || 0);
    if (Date.now() < navClearLockUntilRef.current) {
      return;
    }
    if (lastTabsTokenRef.current > 0 && !nextToken) {
      return;
    }
    if (nextToken && nextToken <= lastTabsTokenRef.current) {
      return;
    }
    if (nextToken) {
      lastTabsTokenRef.current = nextToken;
    }
    const nextSelectedTab = e.detail?.data?.selectedTab;
    setSelectedTab(nextSelectedTab ? { ...nextSelectedTab } : null);
  }, []);

  useEffect(() => {
    subscribeToEvent('setTabsToNav', setTabsToNav);

    return () => {
      unsubscribeFromEvent('setTabsToNav', setTabsToNav);
    };
  }, [setTabsToNav]);

  useEffect(() => {
    const handleClearNavInput = () => {
      setInputValue('');
      setIsInputFocused(false);
      isInputFocusedRef.current = false;
      if (inputElementRef.current) {
        inputElementRef.current.blur();
      }
    };

    subscribeToEvent('clearNavInput', handleClearNavInput);

    return () => {
      unsubscribeFromEvent('clearNavInput', handleClearNavInput);
    };
  }, []);

  useEffect(() => {
    const handleForceNavClear = (e: CustomEvent) => {
      const nextToken = Number(e.detail?.data?.tabsToken || 0);
      if (nextToken) {
        lastTabsTokenRef.current = nextToken;
      }
      navClearLockUntilRef.current = Date.now() + 250;
      setSelectedTab(null);
      setInputValue('');
      setIsInputFocused(false);
      isInputFocusedRef.current = false;
      if (inputElementRef.current) {
        inputElementRef.current.blur();
      }
    };

    subscribeToEvent('forceNavClear', handleForceNavClear);

    return () => {
      unsubscribeFromEvent('forceNavClear', handleForceNavClear);
    };
  }, []);

  const currentNavigation = selectedTab?.tabId
    ? navigationController?.[selectedTab.tabId]
    : null;

  const currentLink = useMemo(() => {
    return currentNavigation?.currentLink || '';
  }, [currentNavigation]);
  const bookmarkSelectedTab = useMemo(() => {
    const parsedLink = currentLink
      ? extractComponents(normalizeQortalInput(currentLink))
      : null;
    if (!parsedLink) return selectedTab;
    return {
      ...(selectedTab || {}),
      service: parsedLink.service,
      name: parsedLink.name,
      identifier: parsedLink.identifier,
      path: parsedLink.path,
    };
  }, [currentLink, selectedTab]);

  useEffect(() => {
    if (isInputFocusedRef.current) return;
    if (
      (desktopViewMode === 'apps' || desktopViewMode === 'dev') &&
      currentLink
    ) {
      setInputValue(currentLink);
      return;
    }
    setInputValue('');
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

  const canCopyCurrentLink = Boolean(currentLink);
  const handleCopyCurrentLink = useCallback(() => {
    if (!currentLink) return;
    if (!navigator.clipboard?.writeText) {
      setInfoSnackGlobal({
        compact: true,
        duration: 3200,
        message: t('question:message.error.copy_clipboard', {
          defaultValue: 'Failed to copy to clipboard',
          postProcess: 'capitalizeFirstChar',
        }),
        type: 'error',
      });
      setOpenSnackGlobal(true);
      return;
    }
    navigator.clipboard
      .writeText(currentLink)
      .then(() => {
        setInfoSnackGlobal({
          compact: true,
          duration: 3000,
          message: t('core:message.generic.link_copied', {
            defaultValue: 'Link copied to clipboard.',
          }),
          type: 'success',
        });
        setOpenSnackGlobal(true);
      })
      .catch((error) => {
        console.error('Failed to copy link:', error);
        setInfoSnackGlobal({
          compact: true,
          duration: 3200,
          message: t('question:message.error.copy_clipboard', {
            defaultValue: 'Failed to copy to clipboard',
            postProcess: 'capitalizeFirstChar',
          }),
          type: 'error',
        });
        setOpenSnackGlobal(true);
      });
  }, [currentLink, setInfoSnackGlobal, setOpenSnackGlobal, t]);

  const isInternalTabSelected = selectedTab?.service === INTERNAL_TAB_SERVICE;
  const canGoBack =
    !!selectedTab?.tabId &&
    !!currentNavigation?.hasBack &&
    !isInternalTabSelected;
  const canRefresh =
    !!selectedTab?.tabId &&
    (desktopViewMode === 'apps' || desktopViewMode === 'dev') &&
    !isInternalTabSelected;
  const isAppsMode = desktopViewMode === 'apps';
  const isDevMode = desktopViewMode === 'dev';
  const isHomeMode = desktopViewMode === 'home';
  const chromeBackground =
    theme.palette.mode === 'dark'
      ? 'rgba(33, 36, 42, 0.95)'
      : 'rgba(223, 228, 235, 0.96)';
  const navShadow =
    theme.palette.mode === 'dark'
      ? `inset 0 -1px 0 ${theme.palette.border.subtle}`
      : `inset 0 -1px 0 ${theme.palette.border.subtle}`;
  const inputBackground =
    theme.palette.mode === 'dark'
      ? 'rgba(28, 31, 37, 0.98)'
      : 'rgba(232, 236, 241, 0.96)';
  const inputHoverBackground =
    theme.palette.mode === 'dark'
      ? 'rgba(41, 45, 52, 0.99)'
      : 'rgba(214, 220, 228, 0.98)';
  const inputFocusBackground =
    theme.palette.mode === 'dark'
      ? 'rgba(46, 51, 59, 1)'
      : 'rgba(214, 220, 228, 1)';
  const hoverBorderColor =
    theme.palette.mode === 'dark'
      ? theme.palette.border.main
      : theme.palette.border.main;
  const focusBorderColor =
    theme.palette.mode === 'dark'
      ? 'rgba(130, 185, 255, 0.28)'
      : 'rgba(41, 121, 218, 0.2)';
  const inputHoverShadow =
    'none';
  const inputFocusShadow =
    theme.palette.mode === 'dark'
      ? 'none'
      : 'none';
  const buttonHoverBackground =
    theme.palette.mode === 'dark'
      ? theme.palette.action.hover
      : theme.palette.action.hover;
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
  const tooltipSlotProps = {
    tooltip: {
      sx: {
        color: theme.palette.text.primary,
        backgroundColor: theme.palette.background.paper,
      },
    },
    arrow: {
      sx: {
        color: theme.palette.text.primary,
      },
    },
  } as const;
  const tooltipTitle = (text: string) => (
    <span
      style={{ fontSize: '14px', fontWeight: 700, textTransform: 'uppercase' }}
    >
      {text}
    </span>
  );
  const utilityModuleButtonSx = {
    alignItems: 'center',
    border: `1px solid ${theme.palette.border.subtle}`,
    borderRadius: '10px',
    color: theme.palette.text.secondary,
    display: 'inline-flex',
    height: 32,
    justifyContent: 'center',
    minWidth: 32,
    transition:
      'background-color 140ms ease, border-color 140ms ease, color 140ms ease, transform 120ms ease, box-shadow 140ms ease',
    width: 32,
    '&:hover': {
      backgroundColor: buttonHoverBackground,
      borderColor: hoverBorderColor,
      color: theme.palette.text.primary,
      transform: 'translateY(-1px)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    },
    '&:active': {
      transform: 'translateY(0)',
      boxShadow: 'none',
    },
    '&:focus-visible': {
      outline: `1px solid ${theme.palette.primary.main}`,
      outlineOffset: '2px',
    },
  } as const;
  const utilityModuleIconSx = {
    fontSize: 20,
  } as const;
  const utilitySectionSx = {
    alignItems: 'center',
    display: 'flex',
    flexShrink: 0,
    gap: 0.75,
    ml: 0.125,
    pl: 0.25,
  } as const;
  const hasActiveTasks = !!txList?.some((item: any) => item && !item.done);
  const utilityLayoutTransition = {
    duration: 0.22,
    ease: [0.22, 1, 0.36, 1],
  } as const;

  return (
    <>
    <Box
        sx={{
          alignItems: 'center',
          backdropFilter: 'blur(10px)',
          backgroundColor: chromeBackground,
          borderBottom: `1px solid ${theme.palette.border.subtle}`,
          boxShadow: navShadow,
          display: 'flex',
          height: `${APP_NAV_BAR_HEIGHT}px`,
          transition: `background-color 180ms ease, box-shadow 180ms ease`,
          width: '100%',
        }}
      >
        <Box
          component={motion.div}
          layout
          transition={utilityLayoutTransition}
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: 1.25,
            height: '100%',
            maxWidth: '100%',
            pl: { xs: '12px', sm: '16px', md: '20px' },
            pr: { xs: 1.5, sm: 2, md: 2.25 },
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
              height: 18,
              position: 'absolute',
              right: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              width: '1px',
            },
          }}
        >
          <ButtonBase
            disableRipple
            onClick={() => {
              if (isDevMode) {
                executeEvent('devModeNavigateBack', {});
                return;
              }
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
                'background-color 140ms ease, color 140ms ease, opacity 140ms ease, transform 120ms ease, box-shadow 140ms ease',
              width: 32,
              '&:hover:not(.Mui-disabled)': {
                backgroundColor: buttonHoverBackground,
                transform: 'translateY(-1px)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              },
              '&:active:not(.Mui-disabled)': {
                transform: 'translateY(0)',
                boxShadow: 'none',
              },
              '&:focus-visible': {
                outline: `1px solid ${theme.palette.primary.main}`,
                outlineOffset: '2px',
              },
            }}
          >
            <ArrowBackIosNewRoundedIcon sx={{ fontSize: 15 }} />
          </ButtonBase>

          <ButtonBase
            disableRipple
            onClick={() => {
              if (isHomeMode) {
                executeEvent('open-apps-mode', {});
                return;
              }
              executeEvent('open-home-mode', {});
            }}
            sx={{
              alignItems: 'center',
              borderRadius: '9px',
              color: theme.palette.text.primary,
              display: 'flex',
              height: 32,
              justifyContent: 'center',
              opacity: isHomeMode || isAppsMode || isDevMode ? 1 : 0.92,
              transition:
                'background-color 140ms ease, color 140ms ease, opacity 140ms ease, transform 120ms ease, box-shadow 140ms ease',
              width: 32,
              backgroundColor:
                isHomeMode || isAppsMode || isDevMode
                  ? buttonHoverBackground
                  : 'transparent',
              '&:hover': {
                backgroundColor: buttonHoverBackground,
                transform: 'translateY(-1px)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              },
              '&:active': {
                transform: 'translateY(0)',
                boxShadow: 'none',
              },
              '&:focus-visible': {
                outline: `1px solid ${theme.palette.primary.main}`,
                outlineOffset: '2px',
              },
            }}
          >
            {isAppsMode || isDevMode ? (
              <HomeRoundedIcon sx={{ fontSize: 19 }} />
            ) : (
              <QAppsNavIcon color={theme.palette.text.primary} />
            )}
          </ButtonBase>

          <ButtonBase
            disableRipple
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
                'background-color 140ms ease, color 140ms ease, opacity 140ms ease, transform 120ms ease, box-shadow 140ms ease',
              width: 32,
              '&:hover:not(.Mui-disabled)': {
                backgroundColor: buttonHoverBackground,
                transform: 'translateY(-1px)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              },
              '&:active:not(.Mui-disabled)': {
                transform: 'translateY(0)',
                boxShadow: 'none',
              },
              '&:focus-visible': {
                outline: `1px solid ${theme.palette.primary.main}`,
                outlineOffset: '2px',
              },
            }}
          >
            <RefreshIcon sx={{ fontSize: 18 }} />
          </ButtonBase>

          <Box
            sx={{
              borderLeft: `1px solid ${theme.palette.border.subtle}`,
              display: 'flex',
              ml: 0.75,
              pl: 1,
            }}
          >
            <AppBookmarksButton
              address={userInfo?.address}
              chromeBackground={chromeBackground}
              selectedTab={bookmarkSelectedTab}
              tooltipSlotProps={tooltipSlotProps}
              tooltipTitle={tooltipTitle}
              buttonSx={{
                alignItems: 'center',
                borderRadius: '9px',
                display: 'flex',
                height: 32,
                justifyContent: 'center',
                transition:
                  'background-color 140ms ease, color 140ms ease, opacity 140ms ease, transform 120ms ease, box-shadow 140ms ease',
                width: 32,
                '&:hover:not(.Mui-disabled)': {
                  backgroundColor: buttonHoverBackground,
                  transform: 'translateY(-1px)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                },
                '&:active:not(.Mui-disabled)': {
                  transform: 'translateY(0)',
                  boxShadow: 'none',
                },
                '&:focus-visible': {
                  outline: `1px solid ${theme.palette.primary.main}`,
                  outlineOffset: '2px',
                },
              }}
            />
          </Box>
        </Box>

        <Box
          component={motion.div}
          layout
          transition={utilityLayoutTransition}
          onMouseEnter={() => setIsInputHovered(true)}
          onMouseLeave={() => setIsInputHovered(false)}
          sx={{
            alignItems: 'center',
            backgroundColor: inputBackground,
            border: `1px solid ${theme.palette.border.subtle}`,
            borderRadius: '10px',
            display: 'flex',
            flex: 1,
            gap: 1,
            height: 32,
            minWidth: 0,
            px: 1.25,
              boxShadow: 'none',
              transition:
              'background-color 180ms ease, border-color 180ms ease, box-shadow 200ms ease',
            '&:hover': {
              backgroundColor: inputHoverBackground,
              borderColor: hoverBorderColor,
              boxShadow: inputHoverShadow,
            },
            '&:focus-within': {
              backgroundColor: inputFocusBackground,
              borderColor: focusBorderColor,
              boxShadow: `0 0 0 1px ${focusBorderColor}`,
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
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flex: '0 0 58px',
              gap: 0.75,
              height: 26,
              justifyContent: 'flex-end',
              maxWidth: 58,
              minWidth: 58,
              width: 58,
            }}
          >
            <Tooltip
              title={tooltipTitle(t('core:action.copy_link'))}
              placement="bottom"
              arrow
              slotProps={tooltipSlotProps}
            >
              <Box
                component="span"
                sx={{
                  display: 'inline-flex',
                  visibility: canCopyCurrentLink ? 'visible' : 'hidden',
                }}
              >
                <ButtonBase
                  disableRipple
                  aria-label={t('core:action.copy_link')}
                  onClick={handleCopyCurrentLink}
                  tabIndex={canCopyCurrentLink ? 0 : -1}
                  sx={{
                    alignItems: 'center',
                    borderRadius: '8px',
                    color: theme.palette.text.secondary,
                    display: 'flex',
                    flexShrink: 0,
                    height: 26,
                    justifyContent: 'center',
                    minWidth: 26,
                    transition:
                      'background-color 140ms ease, color 140ms ease, transform 120ms ease, box-shadow 140ms ease',
                    width: 26,
                    '&:hover': {
                      backgroundColor: buttonHoverBackground,
                      color: theme.palette.text.primary,
                      transform: 'translateY(-1px)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                    },
                    '&:active': {
                      transform: 'translateY(0)',
                      boxShadow: 'none',
                    },
                    '&:focus-visible': {
                      outline: `1px solid ${theme.palette.primary.main}`,
                      outlineOffset: '2px',
                    },
                  }}
                >
                  <ContentCopyRoundedIcon
                    sx={{
                      display: 'block',
                      flexShrink: 0,
                      fontSize: 15,
                    }}
                  />
                </ButtonBase>
              </Box>
            </Tooltip>

            <ButtonBase
              disableRipple
              onClick={handleOpenInput}
              sx={{
                alignItems: 'center',
                borderRadius: '8px',
                color: theme.palette.text.secondary,
                display: 'flex',
                flexShrink: 0,
                height: 26,
                justifyContent: 'center',
                minWidth: 26,
                transition:
                  'background-color 140ms ease, color 140ms ease, transform 120ms ease, box-shadow 140ms ease',
                width: 26,
                '&:hover': {
                  backgroundColor: buttonHoverBackground,
                  color: theme.palette.text.primary,
                  transform: 'translateY(-1px)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                },
                '&:active': {
                  transform: 'translateY(0)',
                  boxShadow: 'none',
                },
                '&:focus-visible': {
                  outline: `1px solid ${theme.palette.primary.main}`,
                  outlineOffset: '2px',
                },
              }}
            >
              <ArrowOutwardIcon
                sx={{
                  display: 'block',
                  flexShrink: 0,
                  fontSize: 17,
                }}
              />
            </ButtonBase>
          </Box>
        </Box>
        <Box
          id={QORTAL_GROUP_CALL_NAV_SLOT_ID}
          component={motion.div}
          layout
          transition={utilityLayoutTransition}
          sx={{
            alignItems: 'center',
            display: 'inline-flex',
            flexShrink: 0,
            minWidth: 0,
          }}
        />
        <Box
          id={DIRECT_VOICE_CALL_NAV_SLOT_ID}
          component={motion.div}
          layout
          transition={utilityLayoutTransition}
          sx={{
            alignItems: 'center',
            display: 'inline-flex',
            flexShrink: 0,
            minWidth: 0,
          }}
        />
        {utilityNav && (
          <Box
            component={motion.div}
            layout
            transition={utilityLayoutTransition}
            sx={utilitySectionSx}
          >
            <GlobalActions />
            <Box
              component={motion.span}
              layout
              transition={utilityLayoutTransition}
              sx={{ display: 'inline-flex', flexShrink: 0 }}
            >
              <ChatWidgetReopenIcon
                inTitleBar
                buttonSx={utilityModuleButtonSx}
                iconSx={utilityModuleIconSx}
              />
            </Box>
            <Box
              component={motion.span}
              layout
              transition={utilityLayoutTransition}
              sx={{ display: 'inline-flex', flexShrink: 0 }}
            >
              <QMailStatus
                compact
                buttonSx={utilityModuleButtonSx}
                iconSx={utilityModuleIconSx}
                tooltipPlacement="bottom"
              />
            </Box>
            {utilityNav.extState === 'authenticated' && (
              <Box
                component={motion.span}
                layout
                transition={utilityLayoutTransition}
                sx={{ display: 'inline-flex', flexShrink: 0 }}
              >
                <SubscriptionsStatus
                  compact
                  buttonSx={utilityModuleButtonSx}
                  iconSx={utilityModuleIconSx}
                  tooltipPlacement="bottom"
                />
              </Box>
            )}
            {utilityNav.extState === 'authenticated' && (
              <Box
                component={motion.span}
                layout
                transition={utilityLayoutTransition}
                sx={{ display: 'inline-flex', flexShrink: 0 }}
              >
                <GeneralNotifications
                  address={utilityNav.userInfo?.address}
                  tooltipPlacement="bottom"
                  compact
                  buttonSx={utilityModuleButtonSx}
                  iconSx={utilityModuleIconSx}
                />
              </Box>
            )}
            {hasActiveTasks && (
              <Box
                component={motion.span}
                layout
                transition={utilityLayoutTransition}
                sx={{ display: 'inline-flex', flexShrink: 0 }}
              >
                <TaskManager
                  getUserInfo={utilityNav.getUserInfo}
                  buttonSx={utilityModuleButtonSx}
                  iconSx={utilityModuleIconSx}
                  tooltipSlotProps={tooltipSlotProps}
                  tooltipTitle={tooltipTitle(
                    t('core:message.generic.ongoing_transactions')
                  )}
                />
              </Box>
            )}
            <Tooltip
              title={tooltipTitle(t('core:action.logout'))}
              placement="bottom"
              arrow
              slotProps={tooltipSlotProps}
            >
              <Box
                component={motion.span}
                layout
                transition={utilityLayoutTransition}
                sx={{ display: 'inline-flex', flexShrink: 0 }}
              >
                <IconButton
                  size="small"
                  onClick={utilityNav.onLogout}
                  sx={utilityModuleButtonSx}
                  aria-label={t('core:action.logout')}
                >
                  <LogoutRoundedIcon sx={utilityModuleIconSx} />
                </IconButton>
              </Box>
            </Tooltip>
          </Box>
        )}
        </Box>
      </Box>
    </>
  );
}
