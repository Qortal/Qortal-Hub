import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { getBaseApiReact } from '../App';
import { getFee } from '../background/background.ts';
import { subscribeToEvent, unsubscribeFromEvent } from '../utils/events';
import { BarSpinner } from '../common/Spinners/BarSpinner/BarSpinner';
import CheckIcon from '@mui/icons-material/Check';
import ErrorIcon from '@mui/icons-material/Error';
import { useSetAtom } from 'jotai';
import { txListAtom } from '../atoms/global';
import { useTranslation } from 'react-i18next';

enum NameAvailability {
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
  const [isNameAvailable, setIsNameAvailable] = useState<NameAvailability>(
    NameAvailability.NULL
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
      setIsNameAvailable(NameAvailability.NULL);

      return;
    }
    setIsNameAvailable(NameAvailability.LOADING);
    try {
      const res = await fetch(`${getBaseApiReact()}/names/` + name);
      const data = await res.json();
      if (data?.message === 'name unknown' || data?.error) {
        setIsNameAvailable(NameAvailability.AVAILABLE);
      } else {
        setIsNameAvailable(NameAvailability.NOT_AVAILABLE);
      }
    } catch (error) {
      setIsNameAvailable(NameAvailability.AVAILABLE);
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

  const hasInsufficientBalance =
    !balance || (nameFee && balance && +balance < +nameFee);
  const isRegisterDisabled =
    !registerNameValue.trim() ||
    isLoadingRegisterName ||
    isNameAvailable !== NameAvailability.AVAILABLE ||
    !balance ||
    (nameFee && balance && +balance < +nameFee);

  return (
    <Dialog
      open={isOpen}
      aria-labelledby="register-name-dialog-title"
      aria-describedby="register-name-dialog-description"
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: '16px',
            overflow: 'hidden',
            bgcolor: theme.palette.background.paper,
            border: `1px solid ${theme.palette.border?.subtle ?? 'rgba(255,255,255,0.08)'}`,
            boxShadow: theme.shadows[24],
          },
        },
      }}
    >
      <DialogTitle
        id="register-name-dialog-title"
        sx={{
          pb: 2.5,
          pt: 2.5,
          px: 2.5,
          borderBottom: `1px solid ${theme.palette.divider}`,
          fontWeight: 600,
          fontSize: '1.125rem',
          textAlign: 'center',
          color: theme.palette.text.primary,
          textTransform: 'none',
        }}
      >
        {t('core:action.register_name', {
          postProcess: 'capitalizeFirstChar',
        })}
      </DialogTitle>

      <DialogContent id="register-name-dialog-description" sx={{ px: 2.5 }}>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2.5,
            maxWidth: 400,
            mx: 'auto',
            pt: 1,
            pb: 1,
          }}
        >
          <Box>
            <Typography
              variant="subtitle2"
              color="text.secondary"
              sx={{ mb: 1, display: 'block', fontWeight: 600 }}
            >
              {t('core:action.choose_name', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
            <TextField
              autoComplete="off"
              autoFocus
              fullWidth
              variant="outlined"
              size="medium"
              onChange={(e) => setRegisterNameValue(e.target.value)}
              value={registerNameValue}
              placeholder={t('core:action.choose_name', {
                postProcess: 'capitalizeFirstChar',
              })}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: '12px',
                  bgcolor:
                    theme.palette.background?.default ??
                    'rgba(255,255,255,0.04)',
                },
              }}
            />
          </Box>

          {hasInsufficientBalance && (
            <Alert
              severity="warning"
              icon={<InfoOutlinedIcon fontSize="small" />}
              sx={{
                borderRadius: '10px',
                '& .MuiAlert-message': { fontSize: '0.8125rem' },
              }}
            >
              {t('core:message.generic.name_registration', {
                balance: balance ?? 0,
                fee: nameFee != null ? Number(nameFee).toFixed(2) : nameFee,
                postProcess: 'capitalizeFirstChar',
              })}
            </Alert>
          )}

          {isNameAvailable === NameAvailability.AVAILABLE && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                py: 1,
                px: 1.5,
                borderRadius: '10px',
                bgcolor:
                  theme.palette.mode === 'dark'
                    ? `${theme.palette.success?.main ?? theme.palette.other?.positive ?? '#2e7d32'}30`
                    : `${theme.palette.success?.main ?? theme.palette.other?.positive ?? '#2e7d32'}18`,
                border: `1px solid ${theme.palette.success?.main ?? theme.palette.other?.positive ?? '#2e7d32'}50`,
              }}
            >
              <CheckIcon
                sx={{ color: 'success.main', fontSize: 22, flexShrink: 0 }}
              />
              <Typography
                variant="body2"
                sx={{ color: theme.palette.text.primary, fontWeight: 500 }}
              >
                {t('core:message.generic.name_available', {
                  name: registerNameValue,
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </Box>
          )}

          {isNameAvailable === NameAvailability.NOT_AVAILABLE && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                py: 1,
                px: 1.5,
                borderRadius: '10px',
                bgcolor:
                  theme.palette.mode === 'dark'
                    ? `${theme.palette.error?.main ?? theme.palette.other?.danger ?? '#d32f2f'}28`
                    : `${theme.palette.error?.main ?? theme.palette.other?.danger ?? '#d32f2f'}14`,
                border: `1px solid ${theme.palette.error?.main ?? theme.palette.other?.danger ?? '#d32f2f'}50`,
              }}
            >
              <ErrorIcon
                sx={{ color: 'error.main', fontSize: 22, flexShrink: 0 }}
              />
              <Typography
                variant="body2"
                sx={{ color: theme.palette.text.primary, fontWeight: 500 }}
              >
                {t('core:message.generic.name_unavailable', {
                  name: registerNameValue,
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </Box>
          )}

          {isNameAvailable === NameAvailability.LOADING && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                py: 1,
                px: 1.5,
                borderRadius: '10px',
                bgcolor: theme.palette.action.hover,
                border: `1px solid ${theme.palette.divider}`,
              }}
            >
              <BarSpinner width="16px" color={theme.palette.text.primary} />
              <Typography
                variant="body2"
                sx={{ color: theme.palette.text.primary, fontWeight: 500 }}
              >
                {t('core:message.generic.name_checking', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </Box>
          )}

          <Box sx={{ pt: 0.5 }}>
            <Typography variant="subtitle2" sx={{ mb: 1.25, fontWeight: 600 }}>
              {t('core:message.generic.name_benefits', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              <Box
                sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}
              >
                <CheckCircleOutlineIcon
                  sx={{
                    color: theme.palette.primary.main,
                    fontSize: 20,
                    mt: 0.15,
                    flexShrink: 0,
                  }}
                />
                <Typography variant="body2" sx={{ lineHeight: 1.5 }}>
                  {t('core:message.generic.publish_data', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
              </Box>
              <Box
                sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}
              >
                <CheckCircleOutlineIcon
                  sx={{
                    color: theme.palette.primary.main,
                    fontSize: 20,
                    mt: 0.15,
                    flexShrink: 0,
                  }}
                />
                <Typography variant="body2" sx={{ lineHeight: 1.5 }}>
                  {t('core:message.generic.secure_ownership', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
              </Box>
            </Box>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions
        sx={{
          px: 2.5,
          py: 2.5,
          pt: 3,
          gap: 1.5,
          borderTop: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Button
          disabled={isLoadingRegisterName}
          variant="outlined"
          onClick={() => {
            setIsOpen(false);
            setRegisterNameValue('');
          }}
          sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '10px' }}
        >
          {t('core:action.close', { postProcess: 'capitalizeFirstChar' })}
        </Button>
        <Button
          disabled={isRegisterDisabled}
          variant="contained"
          onClick={registerName}
          autoFocus
          sx={{
            textTransform: 'none',
            fontWeight: 600,
            borderRadius: '10px',
            minWidth: 140,
          }}
        >
          {t('core:action.register_name', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
