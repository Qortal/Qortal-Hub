import {
  ChangeEvent,
  forwardRef,
  Fragment,
  ReactElement,
  Ref,
  useContext,
  useEffect,
  useState,
} from 'react';
import Dialog from '@mui/material/Dialog';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import Slide from '@mui/material/Slide';
import { TransitionProps } from '@mui/material/transitions';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {
  Box,
  Button,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Switch,
  TextField,
  styled,
  useTheme,
} from '@mui/material';
import { enabledDevModeAtom } from '../../atoms/global';
import ThemeManager from '../Theme/ThemeManager';
import { useAtom } from 'jotai';
import { decryptStoredWallet } from '../../utils/decryptWallet';
import { Spacer } from '../../common/Spacer';
import PhraseWallet from '../../utils/generateWallet/phrase-wallet';
import { walletVersion } from '../../background/background.ts';
import Base58 from '../../encryption/Base58.ts';
import { QORTAL_APP_CONTEXT } from '../../App';
import { executeEvent } from '../../utils/events';
import { useTranslation } from 'react-i18next';
import { TransitionUp } from '../../common/Transitions.tsx';

const LocalNodeSwitch = styled(Switch)(({ theme }) => ({
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

export const Settings = ({ open, setOpen, rawWallet }) => {
  const [checked, setChecked] = useState(false);
  const [generalChatEnabled, setGeneralChatEnabled] = useState(true);
  const [isEnabledDevMode, setIsEnabledDevMode] = useAtom(enabledDevModeAtom);
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

  const handleGeneralChatChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextEnabled = event.target.checked;
    setGeneralChatEnabled(nextEnabled);
    // Store as disable flag
    window
      .sendMessage('addUserSettings', {
        keyValue: {
          key: 'disable-general-chat',
          value: !nextEnabled,
        },
      })
      .then((response) => {
        if (response?.error) {
          console.error('Error adding user settings:', response.error);
        }
      })
      .catch((error) => {
        console.error(
          'Failed to add user settings:',
          error.message || 'An error occurred'
        );
      });
    // Notify the app to update visibility immediately
    executeEvent('generalChatVisibilityChanged', { disabled: !nextEnabled });
  };

  const handleClose = () => {
    setOpen(false);
  };

  const getUserSettings = async () => {
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
  };

  const getGeneralChatSetting = async () => {
    try {
      return new Promise((res, rej) => {
        window
          .sendMessage('getUserSettings', {
            key: 'disable-general-chat',
          })
          .then((response) => {
            if (!response?.error) {
              // Response is the disable flag; enabled is the inverse
              setGeneralChatEnabled(!(response || false));
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
  };

  useEffect(() => {
    getUserSettings();
    getGeneralChatSetting();
  }, []);

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
            color: theme.palette.text.primary,
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            gap: '20px',
            overflowY: 'auto',
            padding: '20px',
          }}
        >
          <FormControlLabel
            sx={{
              color: theme.palette.text.primary,
            }}
            control={
              <LocalNodeSwitch checked={checked} onChange={handleChange} />
            }
            label={t('group:action.disable_push_notifications', {
              postProcess: 'capitalizeFirstChar',
            })}
          />

          <FormControlLabel
            sx={{
              color: theme.palette.text.primary,
            }}
            control={
              <LocalNodeSwitch
                checked={generalChatEnabled}
                onChange={handleGeneralChatChange}
              />
            }
            label={t('tutorial:initial.general_chat', {
              postProcess: 'capitalizeFirstChar',
            })}
          />

          {window?.electronAPI && (
            <FormControlLabel
              control={
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
              }
              label={t('core:action.enable_dev_mode', {
                postProcess: 'capitalizeFirstChar',
              })}
            />
          )}

          {isEnabledDevMode && <ExportPrivateKey rawWallet={rawWallet} />}
          <ThemeManager />
        </Box>
      </Dialog>
    </Fragment>
  );
};

const ExportPrivateKey = ({ rawWallet }) => {
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const { setOpenSnackGlobal, setInfoSnackCustom } =
    useContext(QORTAL_APP_CONTEXT);
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
        sx={{
          width: '200px',
        }}
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
            textAlign: 'center',
            color: theme.palette.text.primary,
            fontWeight: 'bold',
            opacity: 1,
          }}
        >
          {t('group:action.export_password', {
            postProcess: 'capitalizeFirstChar',
          })}
        </DialogTitle>

        <DialogContent
          sx={{
            flexDirection: 'column',
            display: 'flex',
            gap: '10px',
          }}
        >
          <DialogContentText id="alert-dialog-description">
            {t('group:message.generic.secure_place', {
              postProcess: 'capitalizeFirstChar',
            })}
          </DialogContentText>

          <Spacer height="20px" />

          <TextField
            autoFocus
            type="password"
            value={password}
            autoComplete="off"
            onChange={(e) => setPassword(e.target.value)}
          />

          {privateKey && (
            <Button
              variant="outlined"
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
            >
              {t('group:action.copy_private_key', {
                postProcess: 'capitalizeFirstChar',
              })}{' '}
              <ContentCopyIcon color="primary" />
            </Button>
          )}
        </DialogContent>

        <DialogActions>
          <Button
            variant="contained"
            onClick={() => {
              setIsOpen(false);
              setPassword('');
              setPrivateKey('');
            }}
          >
            {t('core:action.cancel', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>

          <Button variant="contained" onClick={exportPrivateKeyFunc}>
            {t('core:action.decrypt', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
