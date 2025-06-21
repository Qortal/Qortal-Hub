import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  ListItem,
  ListItemIcon,
  ListItemText,
  List,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { Label } from './Group/AddGroup';
import { Spacer } from '../common/Spacer';
import { getBaseApiReact } from '../App';
import { getFee } from '../background/background.ts';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import { subscribeToEvent, unsubscribeFromEvent } from '../utils/events';
import { BarSpinner } from '../common/Spinners/BarSpinner/BarSpinner';
import CheckIcon from '@mui/icons-material/Check';
import ErrorIcon from '@mui/icons-material/Error';
import { useSetAtom } from 'jotai';
import { txListAtom } from '../atoms/global';
import { useTranslation } from 'react-i18next';

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
  balance,
}) => {
  const setTxList = useSetAtom(txListAtom);

  const [isOpen, setIsOpen] = useState(false);
  const [registerNameValue, setRegisterNameValue] = useState('');
  const [isLoadingRegisterName, setIsLoadingRegisterName] = useState(false);
  const [isNameAvailable, setIsNameAvailable] = useState<Availability>(
    Availability.NULL
  );
  const [nameFee, setNameFee] = useState(null);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
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
      if (!userInfo?.address)
        throw new Error(
          t('core:message.error.address_not_found', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      if (!registerNameValue)
        throw new Error(
          t('core:action.enter_name', {
            postProcess: 'capitalizeFirstChar',
          })
        );

      const fee = await getFee('REGISTER_NAME');
      await show({
        message: t('core:message.question.register_name', {
          postProcess: 'capitalizeFirstChar',
        }),
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
                message: t('group:message.success.registered_name', {
                  postProcess: 'capitalizeFirstChar',
                }),
              });
              setIsOpen(false);
              setRegisterNameValue('');
              setOpenSnack(true);
              setTxList((prev) => [
                {
                  ...response,
                  type: 'register-name',
                  label: t('group:message.success.registered_name_label', {
                    postProcess: 'capitalizeFirstChar',
                  }),
                  labelDone: t(
                    'group:message.success.registered_name_success',
                    {
                      postProcess: 'capitalizeFirstChar',
                    }
                  ),
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
              message:
                error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                }),
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
      <DialogTitle
        id="alert-dialog-title"
        sx={{
          textAlign: 'center',
          color: theme.palette.text.primary,
          fontWeight: 'bold',
          opacity: 1,
        }}
      >
        {t('core:action.register_name', {
          postProcess: 'capitalizeAll',
        })}
      </DialogTitle>

      <DialogContent>
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            height: '500px',
            maxHeight: '90vh',
            maxWidth: '90vw',
            padding: '10px',
            width: '400px',
          }}
        >
          <Label>
            {t('core:action.choose_name', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Label>

          <TextField
            autoComplete="off"
            autoFocus
            onChange={(e) => setRegisterNameValue(e.target.value)}
            value={registerNameValue}
            placeholder={t('core:action.choose_name', {
              postProcess: 'capitalizeFirstChar',
            })}
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
                  {t('core:message.generic.name_registration', {
                    balance: balance ?? 0,
                    fee: { nameFee },
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
              </Box>

              <Spacer height="10px" />
            </>
          )}

          <Spacer height="5px" />

          {isNameAvailable === Availability.AVAILABLE && (
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                gap: '5px',
              }}
            >
              <CheckIcon
                sx={{
                  color: theme.palette.text.primary,
                }}
              />
              <Typography>
                {t('core:message.generic.name_available', {
                  name: registerNameValue,
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
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
              <Typography>
                {t('core:message.generic.name_unavailable', {
                  name: registerNameValue,
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
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

              <Typography>
                {t('core:message.generic.name_checking', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </Box>
          )}

          <Spacer height="25px" />

          <Typography
            sx={{
              textDecoration: 'underline',
            }}
          >
            {t('core:message.generic.name_benefits', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>

          <List
            sx={{ width: '100%', maxWidth: 360, bgcolor: 'background.paper' }}
            aria-label={t('core:contact_other', {
              postProcess: 'capitalizeFirstChar',
            })}
          >
            <ListItem disablePadding>
              <ListItemIcon>
                <RadioButtonCheckedIcon
                  sx={{
                    color: theme.palette.text.primary,
                  }}
                />
              </ListItemIcon>
              <ListItemText
                primary={t('core:message.generic.publish_data', {
                  postProcess: 'capitalizeFirstChar',
                })}
              />
            </ListItem>

            <ListItem disablePadding>
              <ListItemIcon>
                <RadioButtonCheckedIcon
                  sx={{
                    color: theme.palette.text.primary,
                  }}
                />
              </ListItemIcon>
              <ListItemText
                primary={t('core:message.generic.secure_ownership', {
                  postProcess: 'capitalizeFirstChar',
                })}
              />
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
          {t('core:action.close', { postProcess: 'capitalizeFirstChar' })}
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
          {t('core:action.register_name', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
