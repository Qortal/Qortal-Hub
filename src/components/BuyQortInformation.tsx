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

export const BuyQortInformation = ({ balance }) => {
  const [isOpen, setIsOpen] = useState(false);

  const openBuyQortInfoFunc = useCallback(
    (e) => {
      setIsOpen(true);
    },
    [setIsOpen]
  );

  const theme = useTheme();

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
            height: '400px',
            maxHeight: '90vh',
            maxWidth: '90vw',
            padding: '10px',
            width: '400px',
          }}
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
          <Spacer height="40px" />
          <Typography
            sx={{
              textDecoration: 'underline',
            }}
          >
            Benefits of having QORT
          </Typography>
          <List
            sx={{
              width: '100%',
              maxWidth: 360,
              bgcolor: theme.palette.background.paper,
            }}
            aria-label="contacts"
          >
            <ListItem disablePadding>
              <ListItemIcon>
                <RadioButtonCheckedIcon
                  sx={{
                    color: theme.palette.primary.main,
                  }}
                />
              </ListItemIcon>
              <ListItemText primary="Create transactions on the Qortal Blockchain" />
            </ListItem>
            <ListItem disablePadding>
              <ListItemIcon>
                <RadioButtonCheckedIcon
                  sx={{
                    color: theme.palette.primary.main,
                  }}
                />
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
