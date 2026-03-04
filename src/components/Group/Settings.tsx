import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {
  alpha,
  Box,
  Button,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  Select,
  styled,
  Switch,
  TextField,
  useTheme,
} from '@mui/material';
import AppBar from '@mui/material/AppBar';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { useAtom } from 'jotai';
import {
  ChangeEvent,
  Fragment,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSetAtom } from 'jotai';
import {
  enabledDevModeAtom,
  infoSnackGlobalAtom,
  openSnackGlobalAtom,
} from '../../atoms/global';
import { walletVersion } from '../../background/background.ts';
import { TransitionUp } from '../../common/Transitions.tsx';
import Base58 from '../../encryption/Base58.ts';
import { decryptStoredWallet } from '../../utils/decryptWallet';
import { executeEvent } from '../../utils/events';
import PhraseWallet from '../../utils/generateWallet/phrase-wallet';
import ThemeManager from '../Theme/ThemeManager';

export const LocalNodeSwitch = styled(Switch)(({ theme }) => ({
  padding: 8,
  '& .MuiSwitch-track': {
    borderRadius: 22 / 2,
    '&::before, &::after': {
      content: '""',
      position: 'absolute',
      top: '50%',
      transform: 'translateY(-50%)',
      width: 16,
      height: 16,
    },
    '&::before': {
      backgroundImage: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 24 24"><path fill="${encodeURIComponent(
        theme.palette.getContrastText(theme.palette.primary.main)
      )}" d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z"/></svg>')`,
      left: 12,
    },
    '&::after': {
      backgroundImage: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 24 24"><path fill="${encodeURIComponent(
        theme.palette.getContrastText(theme.palette.primary.main)
      )}" d="M19,13H5V11H19V13Z" /></svg>')`,
      right: 12,
    },
  },
  '& .MuiSwitch-thumb': {
    boxShadow: 'none',
    width: 16,
    height: 16,
    margin: 2,
  },
}));

type CloseAction = 'ask' | 'minimizeToTray' | 'quit';

export const Settings = ({ open, setOpen, rawWallet }) => {
  const [checked, setChecked] = useState(false);
  const [isEnabledDevMode, setIsEnabledDevMode] = useAtom(enabledDevModeAtom);
  const [closeAction, setCloseAction] = useState<CloseAction>('ask');
  const [platform, setPlatform] = useState<string>('');
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setChecked(event.target.checked);
    window
      .sendMessage('addUserSettings', {
        keyValue: {
          key: 'disable-push-notifications',
          value: event.target.checked,
        },
      })
      .then((response) => {
        if (response?.error) {
          console.error('Error adding user settings:', response.error);
        } else {
          console.log('User settings added successfully');
        }
      })
      .catch((error) => {
        console.error(
          'Failed to add user settings:',
          error.message || 'An error occurred'
        );
      });
  };

  const handleClose = () => {
    setOpen(false);
  };

  const getUserSettings = useCallback(async () => {
    try {
      return new Promise((res, rej) => {
        window
          .sendMessage('getUserSettings', {
            key: 'disable-push-notifications',
          })
          .then((response) => {
            if (!response?.error) {
              setChecked(response || false);
              res(response);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
          });
      });
    } catch (error) {
      console.log('error', error);
    }
  }, [setChecked]);

  useEffect(() => {
    getUserSettings();
  }, [getUserSettings]);

  const loadAppSettings = useCallback(async () => {
    if (typeof window.electronAPI?.getAppSettings !== 'function') return;
    const settings = await window.electronAPI.getAppSettings();
    if (settings?.closeAction) setCloseAction(settings.closeAction);
    if (typeof window.electronAPI?.getPlatform === 'function') {
      const p = await window.electronAPI.getPlatform();
      setPlatform(p || '');
    }
  }, []);

  useEffect(() => {
    if (window?.electronAPI) loadAppSettings();
  }, [loadAppSettings]);

  const handleCloseActionChange = useCallback(
    async (value: CloseAction) => {
      setCloseAction(value);
      if (typeof window.electronAPI?.setAppSettings === 'function') {
        await window.electronAPI.setAppSettings({ closeAction: value });
      }
    },
    []
  );

  return (
    <Fragment>
      <Dialog
        fullScreen
        open={open}
        onClose={handleClose}
        slots={{
          transition: TransitionUp,
        }}
      >
        <AppBar sx={{ position: 'relative' }}>
          <Toolbar>
            <Typography sx={{ ml: 2, flex: 1 }} variant="h4" component="div">
              {t('core:general_settings', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>

            <IconButton
              color="inherit"
              edge="start"
              onClick={handleClose}
              aria-label={t('core:action.close', {
                postProcess: 'capitalizeFirstChar',
              })}
              sx={{
                bgcolor: theme.palette.background.default,
                color: theme.palette.text.primary,
              }}
            >
              <CloseIcon />
            </IconButton>
          </Toolbar>
        </AppBar>

        <Box
          sx={{
            bgcolor: theme.palette.background.default,
            color: theme.palette.text.primary,
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            overflowY: 'auto',
            p: 2,
          }}
        >
          <Box
            sx={{ maxWidth: 560, mx: 'auto', py: 3, px: 1, width: '100%' }}
          >

            {/* Notifications */}
            <Box
              sx={{
                borderRadius: 2,
                overflow: 'hidden',
                border: 1,
                borderColor: alpha(theme.palette.divider, 0.4),
                bgcolor: alpha(theme.palette.background.default, 0.5),
                mb: 3,
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  px: 2,
                  py: 1.25,
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  {t('group:action.disable_push_notifications', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
                <LocalNodeSwitch checked={checked} onChange={handleChange} />
              </Box>
            </Box>

            {/* Electron-only app settings */}
            {window?.electronAPI && (
              <Box
                sx={{
                  borderRadius: 2,
                  overflow: 'hidden',
                  border: 1,
                  borderColor: alpha(theme.palette.divider, 0.4),
                  bgcolor: alpha(theme.palette.background.default, 0.5),
                  mb: 3,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    px: 2,
                    py: 1.25,
                    borderBottom: 1,
                    borderColor: 'divider',
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    {t('core:action.enable_dev_mode', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                  <LocalNodeSwitch
                    checked={isEnabledDevMode}
                    onChange={(e) => {
                      setIsEnabledDevMode(e.target.checked);
                      localStorage.setItem(
                        'isEnabledDevMode',
                        JSON.stringify(e.target.checked)
                      );
                    }}
                  />
                </Box>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    px: 2,
                    py: 1.5,
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    {t('core:close_window_behavior', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                  <Select
                    size="small"
                    value={closeAction}
                    onChange={(e) =>
                      handleCloseActionChange(e.target.value as CloseAction)
                    }
                    sx={{ minWidth: 180, borderRadius: 2 }}
                  >
                    <MenuItem value="ask">
                      {t('core:close_always_ask', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </MenuItem>
                    <MenuItem value="minimizeToTray">
                      {platform === 'darwin'
                        ? t('core:close_minimize_to_dock', {
                            postProcess: 'capitalizeFirstChar',
                          })
                        : t('core:close_minimize_to_tray', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                    </MenuItem>
                    <MenuItem value="quit">
                      {t('core:close_quit_completely', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </MenuItem>
                  </Select>
                </Box>
              </Box>
            )}

            {/* Security — Export private key (dev mode only) */}
            {isEnabledDevMode && (
              <Box
                sx={{
                  borderRadius: 2,
                  overflow: 'hidden',
                  border: 1,
                  borderColor: alpha(theme.palette.divider, 0.4),
                  bgcolor: alpha(theme.palette.background.default, 0.5),
                  mb: 3,
                  px: 2,
                  py: 1.5,
                }}
              >
                <ExportPrivateKey rawWallet={rawWallet} />
              </Box>
            )}

            {/* Appearance — Theme Manager */}
            <Box
              sx={{
                borderRadius: 2,
                border: 1,
                borderColor: alpha(theme.palette.divider, 0.4),
                bgcolor: alpha(theme.palette.background.default, 0.5),
                overflow: 'hidden',
              }}
            >
              <ThemeManager />
            </Box>

          </Box>
        </Box>
      </Dialog>
    </Fragment>
  );
};

const ExportPrivateKey = ({ rawWallet }) => {
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const setOpenSnackGlobal = useSetAtom(openSnackGlobalAtom);
  const setInfoSnackCustom = useSetAtom(infoSnackGlobalAtom);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const exportPrivateKeyFunc = async () => {
    try {
      setInfoSnackCustom({
        type: 'info',
        message: t('group:message.generic.descrypt_wallet', {
          postProcess: 'capitalizeFirstChar',
        }),
      });

      setOpenSnackGlobal(true);
      const wallet = structuredClone(rawWallet);

      const res = await decryptStoredWallet(password, wallet);
      const wallet2 = new PhraseWallet(res, wallet?.version || walletVersion);

      const keyPair = Base58.encode(wallet2._addresses[0].keyPair.privateKey);
      setPrivateKey(keyPair);
      setInfoSnackCustom({
        type: '',
        message: '',
      });

      setOpenSnackGlobal(false);
    } catch (error) {
      setInfoSnackCustom({
        type: 'error',
        message: error?.message
          ? t('group:message.error.decrypt_wallet', {
              message: error?.message,
              postProcess: 'capitalizeFirstChar',
            })
          : t('group:message.error.descrypt_wallet', {
              postProcess: 'capitalizeFirstChar',
            }),
      });

      setOpenSnackGlobal(true);
    }
  };

  return (
    <>
      <Button
        variant="contained"
        size="small"
        onClick={() => setIsOpen(true)}
      >
        {t('group:action.export_private_key', {
          postProcess: 'capitalizeFirstChar',
        })}
      </Button>

      <Dialog
        open={isOpen}
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
      >
        <DialogTitle
          id="alert-dialog-title"
          sx={{
            color: theme.palette.text.primary,
            fontWeight: 700,
          }}
        >
          {t('group:action.export_password', {
            postProcess: 'capitalizeFirstChar',
          })}
        </DialogTitle>

        <DialogContent
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minWidth: 320,
          }}
        >
          <DialogContentText
            id="alert-dialog-description"
            variant="body2"
            color="text.secondary"
          >
            {t('group:message.generic.secure_place', {
              postProcess: 'capitalizeFirstChar',
            })}
          </DialogContentText>

          <TextField
            autoFocus
            type="password"
            value={password}
            autoComplete="off"
            size="small"
            onChange={(e) => setPassword(e.target.value)}
            sx={{
              '& .MuiOutlinedInput-root': { borderRadius: 2 },
            }}
          />

          {privateKey && (
            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                navigator.clipboard.writeText(privateKey);
                setInfoSnackCustom({
                  type: 'success',
                  message: t('group:message.generic.private_key_copied', {
                    postProcess: 'capitalizeFirstChar',
                  }),
                });

                setOpenSnackGlobal(true);
              }}
              sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
            >
              {t('group:action.copy_private_key', {
                postProcess: 'capitalizeFirstChar',
              })}{' '}
              <ContentCopyIcon fontSize="small" sx={{ ml: 0.5 }} />
            </Button>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={() => {
              setIsOpen(false);
              setPassword('');
              setPrivateKey('');
            }}
            sx={{ borderRadius: 2, textTransform: 'none' }}
          >
            {t('core:action.cancel', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>

          <Button
            variant="contained"
            size="small"
            onClick={exportPrivateKeyFunc}
            sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
          >
            {t('core:action.decrypt', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
