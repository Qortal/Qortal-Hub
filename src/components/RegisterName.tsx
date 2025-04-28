import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Input,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  List,
  MenuItem,
  Popover,
  Select,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { Label } from './Group/AddGroup';
import { Spacer } from '../common/Spacer';
import { LoadingButton } from '@mui/lab';
import { getBaseApiReact, MyContext } from '../App';
import { getFee } from '../background';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import { subscribeToEvent, unsubscribeFromEvent } from '../utils/events';
import { BarSpinner } from '../common/Spinners/BarSpinner/BarSpinner';
import CheckIcon from '@mui/icons-material/Check';
import ErrorIcon from '@mui/icons-material/Error';

enum Availability {
  NULL = 'null',
  LOADING = 'loading',
  AVAILABLE = 'available',
  NOT_AVAILABLE = 'not-available',
}
export const RegisterName = ({
  setOpenSnack,
  setInfoSnack,
  userInfo,
  show,
  setTxList,
  balance,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [registerNameValue, setRegisterNameValue] = useState('');
  const [isLoadingRegisterName, setIsLoadingRegisterName] = useState(false);
  const [isNameAvailable, setIsNameAvailable] = useState<Availability>(
    Availability.NULL
  );
  const [nameFee, setNameFee] = useState(null);
  const theme = useTheme();
  const checkIfNameExisits = async (name) => {
    if (!name?.trim()) {
      setIsNameAvailable(Availability.NULL);

      return;
    }
    setIsNameAvailable(Availability.LOADING);
    try {
      const res = await fetch(`${getBaseApiReact()}/names/` + name);
      const data = await res.json();
      if (data?.message === 'name unknown') {
        setIsNameAvailable(Availability.AVAILABLE);
      } else {
        setIsNameAvailable(Availability.NOT_AVAILABLE);
      }
    } catch (error) {
      console.error(error);
    } finally {
    }
  };
  // Debounce logic
  useEffect(() => {
    const handler = setTimeout(() => {
      checkIfNameExisits(registerNameValue);
    }, 500);

    // Cleanup timeout if searchValue changes before the timeout completes
    return () => {
      clearTimeout(handler);
    };
  }, [registerNameValue]);

  const openRegisterNameFunc = useCallback(
    (e) => {
      setIsOpen(true);
    },
    [setIsOpen]
  );

  useEffect(() => {
    subscribeToEvent('openRegisterName', openRegisterNameFunc);

    return () => {
      unsubscribeFromEvent('openRegisterName', openRegisterNameFunc);
    };
  }, [openRegisterNameFunc]);

  useEffect(() => {
    const nameRegistrationFee = async () => {
      try {
        const fee = await getFee('REGISTER_NAME');
        setNameFee(fee?.fee);
      } catch (error) {
        console.error(error);
      }
    };
    nameRegistrationFee();
  }, []);

  const registerName = async () => {
    try {
      if (!userInfo?.address) throw new Error('Your address was not found');
      if (!registerNameValue) throw new Error('Enter a name');

      const fee = await getFee('REGISTER_NAME');
      await show({
        message: 'Would you like to register this name?',
        publishFee: fee.fee + ' QORT',
      });
      setIsLoadingRegisterName(true);
      new Promise((res, rej) => {
        window
          .sendMessage('registerName', {
            name: registerNameValue,
          })
          .then((response) => {
            if (!response?.error) {
              res(response);
              setIsLoadingRegisterName(false);
              setInfoSnack({
                type: 'success',
                message:
                  'Successfully registered. It may take a couple of minutes for the changes to propagate',
              });
              setIsOpen(false);
              setRegisterNameValue('');
              setOpenSnack(true);
              setTxList((prev) => [
                {
                  ...response,
                  type: 'register-name',
                  label: `Registered name: awaiting confirmation. This may take a couple minutes.`,
                  labelDone: `Registered name: success!`,
                  done: false,
                },
                ...prev.filter((item) => !item.done),
              ]);
              return;
            }
            setInfoSnack({
              type: 'error',
              message: response?.error,
            });
            setOpenSnack(true);
            rej(response.error);
          })
          .catch((error) => {
            setInfoSnack({
              type: 'error',
              message: error.message || 'An error occurred',
            });
            setOpenSnack(true);
            rej(error);
          });
      });
    } catch (error) {
      if (error?.message) {
        setOpenSnack(true);
        setInfoSnack({
          type: 'error',
          message: error?.message,
        });
      }
    } finally {
      setIsLoadingRegisterName(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      aria-labelledby="alert-dialog-title"
      aria-describedby="alert-dialog-description"
    >
      <DialogTitle id="alert-dialog-title">{'Register name'}</DialogTitle>
      <DialogContent>
        <Box
          sx={{
            width: '400px',
            maxWidth: '90vw',
            height: '500px',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '10px',
            padding: '10px',
          }}
        >
          <Label>Choose a name</Label>
          <TextField
            autoComplete="off"
            autoFocus
            onChange={(e) => setRegisterNameValue(e.target.value)}
            value={registerNameValue}
            placeholder="Choose a name"
          />
          {(!balance || (nameFee && balance && balance < nameFee)) && (
            <>
              <Spacer height="10px" />
              <Box
                sx={{
                  display: 'flex',
                  gap: '5px',
                  alignItems: 'center',
                }}
              >
                <ErrorIcon
                  sx={{
                    color: theme.palette.text.primary,
                  }}
                />
                <Typography>
                  Your balance is {balance ?? 0} QORT. A name registration
                  requires a {nameFee} QORT fee
                </Typography>
              </Box>
              <Spacer height="10px" />
            </>
          )}
          <Spacer height="5px" />
          {isNameAvailable === Availability.AVAILABLE && (
            <Box
              sx={{
                display: 'flex',
                gap: '5px',
                alignItems: 'center',
              }}
            >
              <CheckIcon
                sx={{
                  color: theme.palette.text.primary,
                }}
              />
              <Typography>{registerNameValue} is available</Typography>
            </Box>
          )}
          {isNameAvailable === Availability.NOT_AVAILABLE && (
            <Box
              sx={{
                display: 'flex',
                gap: '5px',
                alignItems: 'center',
              }}
            >
              <ErrorIcon
                sx={{
                  color: theme.palette.text.primary,
                }}
              />
              <Typography>{registerNameValue} is unavailable</Typography>
            </Box>
          )}
          {isNameAvailable === Availability.LOADING && (
            <Box
              sx={{
                display: 'flex',
                gap: '5px',
                alignItems: 'center',
              }}
            >
              <BarSpinner width="16px" color={theme.palette.text.primary} />
              <Typography>Checking if name already existis</Typography>
            </Box>
          )}
          <Spacer height="25px" />
          <Typography
            sx={{
              textDecoration: 'underline',
            }}
          >
            Benefits of a name
          </Typography>
          <List
            sx={{ width: '100%', maxWidth: 360, bgcolor: 'background.paper' }}
            aria-label="contacts"
          >
            <ListItem disablePadding>
              <ListItemIcon>
                <RadioButtonCheckedIcon
                  sx={{
                    color: theme.palette.text.primary,
                  }}
                />
              </ListItemIcon>
              <ListItemText primary="Publish data to Qortal: anything from apps to videos. Fully decentralized!" />
            </ListItem>
            <ListItem disablePadding>
              <ListItemIcon>
                <RadioButtonCheckedIcon
                  sx={{
                    color: theme.palette.text.primary,
                  }}
                />
              </ListItemIcon>
              <ListItemText primary="Secure ownership of data published by your name. You can even sell your name, along with your data to a third party." />
            </ListItem>
          </List>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button
          disabled={isLoadingRegisterName}
          variant="contained"
          onClick={() => {
            setIsOpen(false);
            setRegisterNameValue('');
          }}
        >
          Close
        </Button>
        <Button
          disabled={
            !registerNameValue.trim() ||
            isLoadingRegisterName ||
            isNameAvailable !== Availability.AVAILABLE ||
            !balance ||
            (balance && nameFee && +balance < +nameFee)
          }
          variant="contained"
          onClick={registerName}
          autoFocus
        >
          Register Name
        </Button>
      </DialogActions>
    </Dialog>
  );
};
