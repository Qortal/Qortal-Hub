import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  ListItem,
  ListItemIcon,
  ListItemText,
  List,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import qTradeLogo from '../assets/Icons/q-trade-logo.webp';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../utils/events';
import { useTranslation } from 'react-i18next';
import { SUGGESTED_QORTS } from '../constants/constants';

export const BuyQortInformation = ({ balance }) => {
  const [isOpen, setIsOpen] = useState(false);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const openBuyQortInfoFunc = useCallback(
    (e) => {
      setIsOpen(true);
    },
    [setIsOpen]
  );

  useEffect(() => {
    subscribeToEvent('openBuyQortInfo', openBuyQortInfoFunc);

    return () => {
      unsubscribeFromEvent('openBuyQortInfo', openBuyQortInfoFunc);
    };
  }, [openBuyQortInfoFunc]);

  return (
    <Dialog
      open={isOpen}
      aria-labelledby="alert-dialog-title"
      aria-describedby="alert-dialog-description"
      PaperProps={{
        sx: {
          background: '#121821',
          backgroundImage: 'none',
          border: '1px solid rgba(169,188,216,0.18)',
          borderRadius: '18px',
          boxShadow: '0 26px 56px rgba(0,0,0,0.44)',
          color: theme.palette.text.primary,
          overflow: 'hidden',
          width: '100%',
          maxWidth: 460,
        },
      }}
    >
      <DialogTitle
        id="alert-dialog-title"
        sx={{
          borderBottom: '1px solid rgba(169,188,216,0.1)',
          textAlign: 'left',
          color: theme.palette.text.primary,
          fontSize: '1.04rem',
          fontWeight: 650,
          opacity: 1,
          px: 3,
          py: 2,
        }}
      >
        {t('core:action.get_qort', {
          postProcess: 'capitalizeFirstChar',
        })}
      </DialogTitle>

      <DialogContent sx={{ px: 3, py: 2.5 }}>
        <Box
          sx={{
            display: 'grid',
            gap: 2,
          }}
        >
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.9),
              fontSize: '0.94rem',
              lineHeight: 1.58,
            }}
          >
            {t('core:message.generic.get_qort_trade_portal', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>

          <ButtonBase
            sx={{
              '&:hover': {
                backgroundColor: alpha('#FFFFFF', 0.05),
                borderColor: alpha(theme.palette.primary.main, 0.34),
              },
              alignItems: 'center',
              backgroundColor: alpha('#FFFFFF', 0.026),
              border: '1px solid rgba(169,188,216,0.12)',
              borderRadius: '14px',
              display: 'flex',
              gap: 1.1,
              justifyContent: 'flex-start',
              px: 1.35,
              py: 1.2,
              transition: 'all 0.14s ease',
            }}
            onClick={async () => {
              executeEvent('addTab', {
                data: { service: 'APP', name: 'q-trade' },
              });
              executeEvent('open-apps-mode', {});
              setIsOpen(false);
            }}
          >
            <img
              style={{
                borderRadius: '10px',
                height: '34px',
              }}
              src={qTradeLogo}
            />
            <Box sx={{ minWidth: 0, textAlign: 'left' }}>
              <Typography
                sx={{
                  color: theme.palette.text.primary,
                  fontSize: '0.94rem',
                  fontWeight: 700,
                }}
              >
                {t('core:action.trade_qort', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
              <Typography
                sx={{
                  color: alpha(theme.palette.text.secondary, 0.76),
                  fontSize: '0.76rem',
                  lineHeight: 1.45,
                  mt: 0.25,
                }}
              >
                Open Q-Trade and buy QORT from the trade portal.
              </Typography>
            </Box>
          </ButtonBase>

          <Typography
            sx={{
              color: theme.palette.text.primary,
              fontSize: '0.82rem',
              fontWeight: 700,
              letterSpacing: '0.01em',
            }}
          >
            {t('core:message.generic.benefits_qort', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>

          <List
            sx={{
              backgroundColor: alpha('#FFFFFF', 0.026),
              border: '1px solid rgba(169,188,216,0.12)',
              borderRadius: '14px',
              display: 'grid',
              gap: 0.25,
              maxWidth: 360,
              p: 1.1,
              width: '100%',
            }}
            aria-label={t('core:contact_other', {
              postProcess: 'capitalizeFirstChar',
            })}
          >
            <ListItem disablePadding>
              <ListItemIcon sx={{ minWidth: 32 }}>
                <RadioButtonCheckedIcon sx={{ fontSize: 17 }} />
              </ListItemIcon>
              <ListItemText
                primary={t('core:action.create_transaction', {
                  postProcess: 'capitalizeFirstChar',
                })}
                primaryTypographyProps={{
                  sx: {
                    color: theme.palette.text.primary,
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    lineHeight: 1.45,
                  },
                }}
              />
            </ListItem>

            <ListItem disablePadding>
              <ListItemIcon sx={{ minWidth: 32 }}>
                <RadioButtonCheckedIcon sx={{ fontSize: 17 }} />
              </ListItemIcon>
              <ListItemText
                primary={t('core:message.generic.minimal_qort_balance', {
                  quantity: SUGGESTED_QORTS,
                  postProcess: 'capitalizeFirstChar',
                })}
                primaryTypographyProps={{
                  sx: {
                    color: theme.palette.text.primary,
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    lineHeight: 1.45,
                  },
                }}
              />
            </ListItem>
          </List>
        </Box>
      </DialogContent>

      <DialogActions
        sx={{
          borderTop: '1px solid rgba(169,188,216,0.1)',
          px: 3,
          py: 1.8,
        }}
      >
        <Button
          sx={{
            backgroundColor: alpha('#FFFFFF', 0.035),
            border: '1px solid rgba(169,188,216,0.16)',
            borderRadius: '11px',
            color: theme.palette.text.primary,
            fontSize: '0.9rem',
            fontWeight: 600,
            minHeight: 42,
            minWidth: 112,
            px: 2.2,
            textTransform: 'none',
            '&:hover': {
              backgroundColor: alpha('#FFFFFF', 0.055),
              borderColor: 'rgba(169,188,216,0.24)',
            },
          }}
          variant="contained"
          onClick={() => {
            setIsOpen(false);
          }}
        >
          {t('core:action.close', { postProcess: 'capitalizeFirstChar' })}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
