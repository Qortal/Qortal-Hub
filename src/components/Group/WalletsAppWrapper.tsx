import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { alpha, Box, ButtonBase, Typography, useTheme } from '@mui/material';
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import AppViewerContainer from '../Apps/AppViewerContainer';
import { navigationControllerAtom } from '../../atoms/global';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { appChromeOffsetPx } from '../Desktop/CustomTitleBar';

export const WalletsAppWrapper = () => {
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const theme = useTheme();
  const iframeRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [navigationController] = useAtom(navigationControllerAtom);
  const [selectedTab] = useState({
    tabId: '5558589',
    name: 'Q-Wallets',
    service: 'APP',
    path: 'qortal?authOnMount=true',
  });

  const isDisableBackButton = useMemo(() => {
    if (selectedTab && navigationController[selectedTab?.tabId]?.hasBack) {
      return false;
    }
    if (selectedTab && !navigationController[selectedTab?.tabId]?.hasBack) {
      return true;
    }
    return false;
  }, [navigationController, selectedTab]);

  const openWalletsAppFunc = useCallback(() => {
    setIsOpen(true);
  }, []);

  useEffect(() => {
    subscribeToEvent('openWalletsApp', openWalletsAppFunc);

    return () => {
      unsubscribeFromEvent('openWalletsApp', openWalletsAppFunc);
    };
  }, [openWalletsAppFunc]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    iframeRef.current = null;
  }, []);

  const handleBack = useCallback(() => {
    executeEvent(`navigateBackApp-${selectedTab?.tabId}`, {});
  }, [selectedTab]);

  const handleRefresh = useCallback(() => {
    if (selectedTab?.refreshFunc) {
      selectedTab.refreshFunc(selectedTab?.tabId);
      return;
    }

    executeEvent('refreshApp', {
      tabId: selectedTab?.tabId,
    });
  }, [selectedTab]);

  if (!isOpen) return null;

  return (
    <Box
      sx={{
        inset: 0,
        position: 'fixed',
        zIndex: 100,
      }}
    >
      <Box
        sx={{
          alignItems: { xs: 'stretch', md: 'center' },
          backdropFilter: 'blur(12px)',
          backgroundColor: alpha('#07090D', 0.66),
          display: 'flex',
          height: '100%',
          justifyContent: { xs: 'flex-start', md: 'center' },
          p: { xs: 2, md: 3 },
          pb: { xs: 2, md: 3 },
          pt: `calc(${appChromeOffsetPx} + 18px)`,
          width: '100%',
        }}
      >
        <ButtonBase
          onClick={handleClose}
          sx={{
            inset: 0,
            position: 'absolute',
          }}
        />

        <Box
          onClick={(event) => event.stopPropagation()}
          sx={{
            background:
              theme.palette.mode === 'dark'
                ? 'linear-gradient(180deg, rgba(21,24,31,0.985) 0%, rgba(16,18,24,0.99) 100%)'
                : 'linear-gradient(180deg, rgba(251,253,255,0.985) 0%, rgba(244,247,251,0.99) 100%)',
            border: `1px solid ${alpha(theme.palette.common.white, 0.08)}`,
            borderRadius: '26px',
            boxShadow:
              theme.palette.mode === 'dark'
                ? '0 34px 120px rgba(0,0,0,0.46)'
                : '0 28px 88px rgba(18,28,45,0.16)',
            display: 'flex',
            flexDirection: 'column',
            height: {
              xs: '100%',
              md: 'min(82vh, 920px)',
            },
            maxHeight: '100%',
            maxWidth: '1360px',
            minHeight: { md: 620 },
            overflow: 'hidden',
            position: 'relative',
            width: 'min(1360px, calc(100vw - 48px))',
            zIndex: 1,
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              borderBottom: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
              display: 'flex',
              flexShrink: 0,
              justifyContent: 'space-between',
              minHeight: 54,
              px: { xs: 2, md: 2.75 },
              py: 1,
            }}
          >
            <Box sx={{ width: 32 }} />

            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                gap: 1,
                justifyContent: 'center',
                minWidth: 0,
              }}
            >
              <AccountBalanceWalletRoundedIcon
                sx={{
                  color: alpha(theme.palette.primary.main, 0.92),
                  fontSize: '1.05rem',
                }}
              />
              <Typography
                sx={{
                  fontSize: '1rem',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  lineHeight: 1.1,
                }}
              >
                {t('core:q_apps.q_wallets', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </Box>

            <ButtonBase
              onClick={handleClose}
              sx={{
                alignItems: 'center',
                borderRadius: '10px',
                color: theme.palette.text.secondary,
                display: 'inline-flex',
                height: 32,
                justifyContent: 'center',
                width: 32,
                '&:hover': {
                  backgroundColor: theme.palette.action.hover,
                  color: theme.palette.text.primary,
                },
              }}
            >
              <CloseRoundedIcon sx={{ fontSize: '1rem' }} />
            </ButtonBase>
          </Box>

          <Box
            sx={{
              flex: '1 1 auto',
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
            <AppViewerContainer
              customHeight="100%"
              app={selectedTab}
              isSelected
              ref={iframeRef}
              skipAuth={true}
            />
          </Box>

          <Box
            sx={{
              alignItems: 'center',
              backdropFilter: 'blur(16px)',
              backgroundColor:
                theme.palette.mode === 'dark'
                  ? 'rgba(16,18,24,0.94)'
                  : 'rgba(248,250,252,0.94)',
              borderTop: `1px solid ${alpha(theme.palette.divider, 0.42)}`,
              display: 'flex',
              flexShrink: 0,
              justifyContent: 'space-between',
              minHeight: 52,
              px: { xs: 1.4, md: 1.8 },
              py: 0.65,
            }}
          >
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                gap: 1,
              }}
            >
              <ButtonBase
                onClick={handleBack}
                disabled={isDisableBackButton}
                sx={{
                  alignItems: 'center',
                  border: `1px solid ${alpha(theme.palette.divider, 0.28)}`,
                  borderRadius: '12px',
                  color: !isDisableBackButton
                    ? theme.palette.text.primary
                    : theme.palette.text.disabled,
                  display: 'inline-flex',
                  gap: 0.65,
                  height: 40,
                  justifyContent: 'center',
                  minWidth: 96,
                  opacity: !isDisableBackButton ? 1 : 0.52,
                  px: 1.2,
                  transition: 'background-color 0.2s ease, opacity 0.2s ease',
                  '&:hover': !isDisableBackButton
                    ? {
                        backgroundColor: alpha(
                          theme.palette.common.white,
                          theme.palette.mode === 'dark' ? 0.04 : 0.55
                        ),
                      }
                    : undefined,
                }}
              >
                <ArrowBackRoundedIcon sx={{ fontSize: '1rem' }} />
                <Typography sx={{ fontSize: '0.8rem', fontWeight: 600 }}>
                  Back
                </Typography>
              </ButtonBase>

              <ButtonBase
                onClick={handleRefresh}
                sx={{
                  alignItems: 'center',
                  border: `1px solid ${alpha(theme.palette.divider, 0.28)}`,
                  borderRadius: '12px',
                  color: theme.palette.text.primary,
                  display: 'inline-flex',
                  gap: 0.65,
                  height: 40,
                  justifyContent: 'center',
                  minWidth: 104,
                  px: 1.2,
                  transition: 'background-color 0.2s ease',
                  '&:hover': {
                    backgroundColor: alpha(
                      theme.palette.common.white,
                      theme.palette.mode === 'dark' ? 0.04 : 0.55
                    ),
                  },
                }}
              >
                <RefreshRoundedIcon sx={{ fontSize: '1rem' }} />
                <Typography sx={{ fontSize: '0.8rem', fontWeight: 600 }}>
                  Refresh
                </Typography>
              </ButtonBase>
            </Box>

            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.76rem',
                fontWeight: 500,
                px: 1,
              }}
            >
              Wallet workspace
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};
