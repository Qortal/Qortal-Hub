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
  const { t } = useTranslation(['auth', 'core', 'group']);

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
      <DialogTitle id="alert-dialog-title">{'Get QORT'}</DialogTitle>
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
          }} // TODO translate
        >
          <Typography>
            Get QORT using Qortal's crosschain trade portal
          </Typography>
          <ButtonBase
            sx={{
              '&:hover': { backgroundColor: theme.palette.secondary.main },
              transition: 'all 0.1s ease-in-out',
              padding: '5px',
              borderRadius: '5px',
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
              Trade QORT
            </Typography>
          </ButtonBase>

          <Spacer height="15px" />

          <Typography
            sx={{
              textDecoration: 'underline',
            }}
          >
            Benefits of having QORT
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
              <ListItemText primary="Create transactions on the Qortal Blockchain" />
            </ListItem>
            <ListItem disablePadding>
              <ListItemIcon>
                <RadioButtonCheckedIcon />
              </ListItemIcon>
              <ListItemText primary="Having at least 4 QORT in your balance allows you to send chat messages at near instant speed." />
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
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};
