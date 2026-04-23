import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  ButtonBase,
  Dialog,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CloseIcon from '@mui/icons-material/Close';
import { getBaseApiReact } from '../App';
import { getFee } from '../background/background.ts';
import { subscribeToEvent, unsubscribeFromEvent } from '../utils/events';
import { BarSpinner } from '../common/Spinners/BarSpinner/BarSpinner';
import CheckIcon from '@mui/icons-material/Check';
import ErrorIcon from '@mui/icons-material/Error';
import { useSetAtom } from 'jotai';
import { txListAtom } from '../atoms/global';
import { useTranslation } from 'react-i18next';
import { getBlueTier1ButtonSx } from '../styles/blueMaterial';

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
  const isDarkMode = theme.palette.mode === 'dark';
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const modalSurface = isDarkMode
    ? 'linear-gradient(145deg, rgba(49,54,64,0.985) 0%, rgba(35,39,47,0.992) 48%, rgba(24,27,33,0.996) 100%)'
    : 'linear-gradient(180deg, rgba(251,253,255,0.985) 0%, rgba(244,247,251,0.99) 100%)';
  const surfaceBorder = isDarkMode
    ? 'rgba(255,255,255,0.08)'
    : alpha(theme.palette.divider, 0.32);
  const shellDivider = isDarkMode
    ? 'rgba(255,255,255,0.052)'
    : alpha(theme.palette.divider, 0.24);
  const sectionDivider = isDarkMode
    ? 'rgba(255,255,255,0.052)'
    : alpha(theme.palette.divider, 0.18);
  const softSectionSurface = isDarkMode
    ? 'linear-gradient(145deg, rgba(94,101,114,0.34) 0%, rgba(72,78,89,0.3) 100%)'
    : alpha(theme.palette.text.primary, 0.035);
  const fieldBorder =
    theme.palette.border?.subtle ??
    (isDarkMode ? 'rgba(255,255,255,0.085)' : 'rgba(24,29,36,0.12)');
  const fieldSurface = isDarkMode
    ? 'linear-gradient(145deg, rgba(88,95,108,0.2) 0%, rgba(56,62,73,0.28) 44%, rgba(37,41,49,0.42) 100%)'
    : 'linear-gradient(180deg, rgba(17,23,34,0.042) 0%, rgba(17,23,34,0.024) 100%)';
  const fieldSurfaceHover = isDarkMode
    ? 'linear-gradient(145deg, rgba(98,106,120,0.24) 0%, rgba(63,70,82,0.34) 46%, rgba(43,48,57,0.48) 100%)'
    : 'linear-gradient(180deg, rgba(17,23,34,0.06) 0%, rgba(17,23,34,0.034) 100%)';
  const fieldInsetShadow = isDarkMode
    ? '0 8px 20px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.035)'
    : '0 4px 10px rgba(24,32,44,0.06), inset 0 1px 0 rgba(255,255,255,0.5)';
  const contentColumnMaxWidth = 428;

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

  const closeRegisterName = useCallback(() => {
    if (isLoadingRegisterName) return;
    setIsOpen(false);
    setRegisterNameValue('');
    setIsNameAvailable(NameAvailability.NULL);
  }, [isLoadingRegisterName]);

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
      onClose={closeRegisterName}
      aria-labelledby="register-name-dialog-title"
      aria-describedby="register-name-dialog-description"
      maxWidth="sm"
      fullWidth
      slotProps={{
        backdrop: {
          sx: {
            backdropFilter: isDarkMode
              ? 'blur(12px) brightness(0.76) saturate(0.88)'
              : 'blur(12px) brightness(0.9) saturate(0.94)',
            WebkitBackdropFilter: isDarkMode
              ? 'blur(12px) brightness(0.76) saturate(0.88)'
              : 'blur(12px) brightness(0.9) saturate(0.94)',
            backgroundColor: isDarkMode
              ? 'rgba(6, 8, 12, 0.4)'
              : 'rgba(22, 26, 34, 0.14)',
          },
        },
        paper: {
          sx: {
            background: modalSurface,
            border: `1px solid ${surfaceBorder}`,
            borderRadius: '14px',
            boxShadow: isDarkMode
              ? '0 34px 120px rgba(0,0,0,0.46)'
              : '0 28px 88px rgba(18,28,45,0.16)',
            clipPath: 'inset(0 round 14px)',
            isolation: 'isolate',
            overflow: 'hidden',
            width: 'min(700px, calc(100vw - 32px))',
          },
        },
      }}
    >
      <Box sx={{ background: modalSurface, display: 'flex', flexDirection: 'column' }}>
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
            px: 2.25,
            py: 1.45,
          }}
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              maxWidth: `${contentColumnMaxWidth}px`,
              width: '100%',
            }}
          >
            <Typography
              id="register-name-dialog-title"
              sx={{
                color: theme.palette.text.primary,
                fontSize: '0.98rem',
                fontWeight: 700,
                letterSpacing: '-0.02em',
              }}
            >
              {t('core:action.register_name', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
            <Typography
              id="register-name-dialog-description"
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.76rem',
                lineHeight: 1.45,
              }}
            >
              {t(
                'tutorial:home.register_name_workspace_hint',
                'A registered name turns this account into a recognizable identity.'
              )}
            </Typography>
          </Box>
          <ButtonBase
            onClick={closeRegisterName}
            disabled={isLoadingRegisterName}
            sx={{
              borderRadius: '8px',
              color: theme.palette.text.secondary,
              height: 30,
              width: 30,
              '&:hover': {
                backgroundColor: alpha(
                  theme.palette.common.white,
                  isDarkMode ? 0.05 : 0.55
                ),
                color: theme.palette.text.primary,
              },
            }}
          >
            <CloseIcon sx={{ fontSize: 17 }} />
          </ButtonBase>
        </Box>

        <Box
          sx={{
            borderTop: `1px solid ${shellDivider}`,
            display: 'flex',
            flexDirection: 'column',
            px: 2.25,
            pb: 1.85,
            pt: 1.75,
          }}
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1.25,
              maxWidth: `${contentColumnMaxWidth}px`,
              mx: 'auto',
              width: '100%',
            }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.72 }}>
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  display: 'block',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  letterSpacing: '0.01em',
                }}
              >
                Name
              </Typography>
              <TextField
                autoComplete="off"
                autoFocus
                fullWidth
                variant="outlined"
                size="medium"
                onChange={(e) => setRegisterNameValue(e.target.value)}
                value={registerNameValue}
                placeholder="Name"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    background: fieldSurface,
                    borderRadius: '10px',
                    boxShadow: fieldInsetShadow,
                    color: theme.palette.text.primary,
                    '& fieldset': {
                      borderColor: fieldBorder,
                    },
                    '&:hover fieldset': {
                      borderColor: isDarkMode
                        ? 'rgba(255,255,255,0.12)'
                        : alpha(theme.palette.primary.main, 0.42),
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: alpha(theme.palette.primary.main, 0.9),
                      borderWidth: 1.5,
                    },
                    '&:hover': {
                      background: fieldSurfaceHover,
                    },
                  },
                  '& .MuiOutlinedInput-input': {
                    fontSize: '0.92rem',
                    px: 1.25,
                    py: 1.18,
                  },
                }}
              />
            </Box>

            {hasInsufficientBalance && (
              <Box
                sx={{
                  alignItems: 'flex-start',
                  background: alpha(
                    theme.palette.warning?.main ?? '#d19932',
                    isDarkMode ? 0.13 : 0.08
                  ),
                  border: `1px solid ${alpha(
                    theme.palette.warning?.main ?? '#d19932',
                    isDarkMode ? 0.28 : 0.2
                  )}`,
                  borderRadius: '12px',
                  display: 'flex',
                  gap: 1,
                  px: 1.25,
                  py: 1.1,
                }}
              >
                <InfoOutlinedIcon
                  sx={{
                    color: theme.palette.warning?.main ?? '#d19932',
                    fontSize: 18,
                    flexShrink: 0,
                    mt: '1px',
                  }}
                />
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: '0.77rem',
                    lineHeight: 1.45,
                  }}
                >
                  {t('core:message.generic.name_registration', {
                    balance: balance ?? 0,
                    fee: nameFee != null ? Number(nameFee).toFixed(2) : nameFee,
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
              </Box>
            )}

            {isNameAvailable === NameAvailability.AVAILABLE && (
              <Box
                sx={{
                  alignItems: 'center',
                  background: alpha(
                    theme.palette.success?.main ?? '#2e7d32',
                    isDarkMode ? 0.13 : 0.08
                  ),
                  border: `1px solid ${alpha(
                    theme.palette.success?.main ?? '#2e7d32',
                    isDarkMode ? 0.28 : 0.2
                  )}`,
                  borderRadius: '12px',
                  display: 'flex',
                  gap: 1,
                  px: 1.25,
                  py: 1.05,
                }}
              >
                <CheckIcon
                  sx={{
                    color: theme.palette.success?.main ?? '#2e7d32',
                    fontSize: 18,
                    flexShrink: 0,
                  }}
                />
                <Typography
                  sx={{
                    color: theme.palette.text.primary,
                    fontSize: '0.77rem',
                    fontWeight: 500,
                    lineHeight: 1.4,
                  }}
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
                  alignItems: 'center',
                  background: alpha(
                    theme.palette.error?.main ?? '#d32f2f',
                    isDarkMode ? 0.13 : 0.08
                  ),
                  border: `1px solid ${alpha(
                    theme.palette.error?.main ?? '#d32f2f',
                    isDarkMode ? 0.28 : 0.2
                  )}`,
                  borderRadius: '12px',
                  display: 'flex',
                  gap: 1,
                  px: 1.25,
                  py: 1.05,
                }}
              >
                <ErrorIcon
                  sx={{
                    color: theme.palette.error?.main ?? '#d32f2f',
                    fontSize: 18,
                    flexShrink: 0,
                  }}
                />
                <Typography
                  sx={{
                    color: theme.palette.text.primary,
                    fontSize: '0.77rem',
                    fontWeight: 500,
                    lineHeight: 1.4,
                  }}
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
                  alignItems: 'center',
                  background: softSectionSurface,
                  border: `1px solid ${fieldBorder}`,
                  borderRadius: '12px',
                  display: 'flex',
                  gap: 1,
                  px: 1.25,
                  py: 1.05,
                }}
              >
                <BarSpinner width="16px" color={theme.palette.text.primary} />
                <Typography
                  sx={{
                    color: theme.palette.text.primary,
                    fontSize: '0.77rem',
                    fontWeight: 500,
                    lineHeight: 1.4,
                  }}
                >
                  {t('core:message.generic.name_checking', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
              </Box>
            )}

            <Box
              sx={{
                borderTop: `1px solid ${sectionDivider}`,
                display: 'flex',
                flexDirection: 'column',
                gap: 0.82,
                pt: 1.2,
              }}
            >
              <Typography
                sx={{
                  color: alpha(theme.palette.text.secondary, 0.72),
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  letterSpacing: '0.01em',
                }}
              >
                {t('core:message.generic.name_benefits', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.88,
                  opacity: 0.86,
                }}
              >
                <Box sx={{ display: 'flex', gap: 0.9, alignItems: 'flex-start' }}>
                  <CheckCircleOutlineIcon
                    sx={{
                      color: alpha(theme.palette.primary.main, 0.88),
                      fontSize: 17,
                      mt: '1px',
                      flexShrink: 0,
                    }}
                  />
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '0.75rem',
                      lineHeight: 1.5,
                    }}
                  >
                    {t('core:message.generic.publish_data', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.9, alignItems: 'flex-start' }}>
                  <CheckCircleOutlineIcon
                    sx={{
                      color: alpha(theme.palette.primary.main, 0.88),
                      fontSize: 17,
                      mt: '1px',
                      flexShrink: 0,
                    }}
                  />
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '0.75rem',
                      lineHeight: 1.5,
                    }}
                  >
                    {t('core:message.generic.secure_ownership', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>

        <Box
          sx={{
            borderTop: `1px solid ${shellDivider}`,
            px: 2.25,
            py: 1.5,
            mt: 0.5,
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: 0.7,
              maxWidth: `${contentColumnMaxWidth}px`,
              mx: 'auto',
              width: '100%',
            }}
          >
            <ButtonBase
              disabled={isRegisterDisabled}
              onClick={registerName}
              autoFocus
              sx={{
                ...getBlueTier1ButtonSx(),
                alignItems: 'center',
                borderRadius: '10px',
                justifyContent: 'center',
                minHeight: 40,
                px: 1.65,
                width: '100%',
                '& .register-name-primary-label': {
                  color: alpha('#FFFFFF', 0.98),
                },
                '&.Mui-disabled': {
                  background: isDarkMode
                    ? 'rgba(255,255,255,0.035)'
                    : 'rgba(24,29,36,0.04)',
                  border: isDarkMode
                    ? '1px solid rgba(255,255,255,0.055)'
                    : '1px solid rgba(24,29,36,0.06)',
                  boxShadow: 'none',
                },
              }}
            >
              <Typography
                className="register-name-primary-label"
                sx={{
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  letterSpacing: '0.01em',
                  lineHeight: 1.2,
                }}
              >
                {t('core:action.register_name', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </ButtonBase>
            <ButtonBase
              disabled={isLoadingRegisterName}
              onClick={closeRegisterName}
              sx={{
                alignItems: 'center',
                borderRadius: '10px',
                color: theme.palette.text.secondary,
                display: 'inline-flex',
                justifyContent: 'center',
                minHeight: 32,
                px: 1.2,
                textAlign: 'center',
                transition:
                  'background-color 160ms ease, color 160ms ease, opacity 160ms ease',
                '&:hover': {
                  backgroundColor: softSectionSurface,
                  color: theme.palette.text.primary,
                },
                '&.Mui-disabled': {
                  opacity: 0.5,
                },
              }}
            >
              <Typography
                sx={{
                  color: 'inherit',
                  fontSize: '0.76rem',
                  fontWeight: 500,
                  lineHeight: 1.2,
                }}
              >
                {t('core:action.close', { postProcess: 'capitalizeFirstChar' })}
              </Typography>
            </ButtonBase>
          </Box>
        </Box>
      </Box>
    </Dialog>
  );
};
