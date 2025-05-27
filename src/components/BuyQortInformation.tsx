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
  useTheme,
} from '@mui/material';
import { Spacer } from '../common/Spacer';
import qTradeLogo from '../assets/Icons/q-trade-logo.webp';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../utils/events';
import { useTranslation } from 'react-i18next';

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
    >
      <DialogTitle
        id="alert-dialog-title"
        sx={{
          textAlign: 'center',
          color: theme.palette.text.primary,
          fontWeight: 'bold',
          opacity: 1,
        }}
      >
        {t('core:action.get_qort', {
          postProcess: 'capitalizeFirstChar',
        })}
      </DialogTitle>

      <DialogContent>
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            height: '350px',
            maxHeight: '80vh',
            maxWidth: '90vw',
            padding: '10px',
            width: '400px',
          }}
        >
          <Typography>
            {t('core:message.generic.get_qort_trade_portal', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>

          <ButtonBase
            sx={{
              '&:hover': { backgroundColor: theme.palette.secondary.main },
              transition: 'all 0.1s ease-in-out',
              padding: '5px',
              borderRadius: '8px',
              gap: '5px',
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
                borderRadius: '50%',
                height: '30px',
              }}
              src={qTradeLogo}
            />
            <Typography
              sx={{
                fontSize: '1rem',
              }}
            >
              {t('core:action.trade_qort', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </ButtonBase>

          <Spacer height="15px" />

          <Typography
            sx={{
              textDecoration: 'underline',
            }}
          >
            {t('core:message.generic.benefits_qort', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>

          <List
            sx={{
              maxWidth: 360,
              width: '100%',
            }}
            aria-label={t('core:contact_other', {
              postProcess: 'capitalizeFirstChar',
            })}
          >
            <ListItem disablePadding>
              <ListItemIcon>
                <RadioButtonCheckedIcon />
              </ListItemIcon>
              <ListItemText
                primary={t('core:action.create_transaction', {
                  postProcess: 'capitalizeFirstChar',
                })}
              />
            </ListItem>

            <ListItem disablePadding>
              <ListItemIcon>
                <RadioButtonCheckedIcon />
              </ListItemIcon>
              <ListItemText
                primary={t('core:message.generic.minimal_qort_balance', {
                  quantity: 6,
                  postProcess: 'capitalizeFirstChar',
                })}
              />
            </ListItem>
          </List>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button
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
