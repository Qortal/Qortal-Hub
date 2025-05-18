import { Fragment, useContext, useEffect, useState } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Divider from '@mui/material/Divider';
import ListItemText from '@mui/material/ListItemText';
import ListItemAvatar from '@mui/material/ListItemAvatar';
import Avatar from '@mui/material/Avatar';
import Typography from '@mui/material/Typography';
import {
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Input,
  useTheme,
} from '@mui/material';
import { CustomButton } from './styles/App-styles';
import { useDropzone } from 'react-dropzone';
import EditIcon from '@mui/icons-material/Edit';
import { Label } from './components/Group/AddGroup';
import { Spacer } from './common/Spacer';
import { getWallets, storeWallets, walletVersion } from './background';
import { useModal } from './common/useModal';
import PhraseWallet from './utils/generateWallet/phrase-wallet';
import { decryptStoredWalletFromSeedPhrase } from './utils/decryptWallet';
import { crypto } from './constants/decryptWallet';
import { LoadingButton } from '@mui/lab';
import { PasswordField } from './components';
import { HtmlTooltip } from './components/NotAuthenticated';
import { MyContext } from './App';
import { useTranslation } from 'react-i18next';

const parsefilenameQortal = (filename) => {
  return filename.startsWith('qortal_backup_') ? filename.slice(14) : filename;
};

export const Wallets = ({ setExtState, setRawWallet, rawWallet }) => {
  const [wallets, setWallets] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [seedValue, setSeedValue] = useState('');
  const [seedName, setSeedName] = useState('');
  const [seedError, setSeedError] = useState('');
  const { hasSeenGettingStarted } = useContext(MyContext);
  const [password, setPassword] = useState('');
  const [isOpenSeedModal, setIsOpenSeedModal] = useState(false);
  const [isLoadingEncryptSeed, setIsLoadingEncryptSeed] = useState(false);
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core', 'group']);
  const { isShow, onCancel, onOk, show } = useModal();

  const { getRootProps, getInputProps } = useDropzone({
    accept: {
      'application/json': ['.json'], // Only accept JSON files
    },
    onDrop: async (acceptedFiles) => {
      const files: any = acceptedFiles;
      let importedWallets: any = [];

      for (const file of files) {
        try {
          const fileContents = await new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onabort = () => reject('File reading was aborted');
            reader.onerror = () => reject('File reading has failed');
            reader.onload = () => {
              // Resolve the promise with the reader result when reading completes
              resolve(reader.result);
            };

            // Read the file as text
            reader.readAsText(file);
          });
          if (typeof fileContents !== 'string') continue;
          const parsedData = JSON.parse(fileContents);
          importedWallets.push({ ...parsedData, filename: file?.name });
        } catch (error) {
          console.error(error);
        }
      }

      const uniqueInitialMap = new Map();

      // Only add a message if it doesn't already exist in the Map
      importedWallets.forEach((wallet) => {
        if (!wallet?.address0) return;
        if (!uniqueInitialMap.has(wallet?.address0)) {
          uniqueInitialMap.set(wallet?.address0, wallet);
        }
      });

      const data = Array.from(uniqueInitialMap.values());

      if (data && data?.length > 0) {
        const uniqueNewWallets = data.filter(
          (newWallet) =>
            !wallets.some(
              (existingWallet) =>
                existingWallet?.address0 === newWallet?.address0
            )
        );
        setWallets([...wallets, ...uniqueNewWallets]);
      }
    },
  });

  const updateWalletItem = (idx, wallet) => {
    setWallets((prev) => {
      let copyPrev = [...prev];
      if (wallet === null) {
        copyPrev.splice(idx, 1); // Use splice to remove the item
        return copyPrev;
      } else {
        copyPrev[idx] = wallet; // Update the wallet at the specified index
        return copyPrev;
      }
    });
  };

  const handleSetSeedValue = async () => {
    try {
      setIsOpenSeedModal(true);
      const { seedValue, seedName, password } = await show({
        message: '',
        publishFee: '',
      });
      setIsLoadingEncryptSeed(true);
      const res = await decryptStoredWalletFromSeedPhrase(seedValue);
      const wallet2 = new PhraseWallet(res, walletVersion);
      const wallet = await wallet2.generateSaveWalletData(
        password,
        crypto.kdfThreads,
        () => {}
      );
      if (wallet?.address0) {
        setWallets([
          ...wallets,
          {
            ...wallet,
            name: seedName,
          },
        ]);
        setIsOpenSeedModal(false);
        setSeedValue('');
        setSeedName('');
        setPassword('');
        setSeedError('');
      } else {
        setSeedError(
          t('auth:message.error.account_creation', {
            postProcess: 'capitalizeFirst',
          })
        );
      }
    } catch (error) {
      setSeedError(
        error?.message ||
          t('auth:message.error.account_creation', {
            postProcess: 'capitalizeFirst',
          })
      );
    } finally {
      setIsLoadingEncryptSeed(false);
    }
  };

  const selectedWalletFunc = (wallet) => {
    setRawWallet(wallet);
    setExtState('wallet-dropped');
  };

  useEffect(() => {
    setIsLoading(true);
    getWallets()
      .then((res) => {
        if (res && Array.isArray(res)) {
          setWallets(res);
        }
        setIsLoading(false);
      })
      .catch((error) => {
        console.error(error);
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!isLoading && wallets && Array.isArray(wallets)) {
      storeWallets(wallets);
    }
  }, [wallets, isLoading]);

  if (isLoading) return null;

  return (
    <div>
      {wallets?.length === 0 || !wallets ? (
        <>
          <Typography>
            {t('auth:message.generic.no_account', {
              postProcess: 'capitalizeFirst',
            })}
          </Typography>

          <Spacer height="75px" />
        </>
      ) : (
        <>
          <Typography>
            {t('auth:message.generic.your_accounts', {
              postProcess: 'capitalizeFirst',
            })}
          </Typography>

          <Spacer height="30px" />
        </>
      )}

      {rawWallet && (
        <Box>
          <Typography>
            {t('auth:account.selected', {
              postProcess: 'capitalizeFirst',
            })}
            :
          </Typography>
          {rawWallet?.name && <Typography>{rawWallet.name}</Typography>}
          {rawWallet?.address0 && (
            <Typography>{rawWallet?.address0}</Typography>
          )}
        </Box>
      )}
      {wallets?.length > 0 && (
        <List
          sx={{
            backgroundColor: theme.palette.background.paper,
            maxHeight: '60vh',
            maxWidth: '500px',
            overflowX: 'hidden',
            overflowY: 'auto',
            width: '100%',
          }}
        >
          {wallets?.map((wallet, idx) => {
            return (
              <>
                <WalletItem
                  setSelectedWallet={selectedWalletFunc}
                  key={wallet?.address0}
                  wallet={wallet}
                  idx={idx}
                  updateWalletItem={updateWalletItem}
                />
                <Divider variant="inset" component="li" />
              </>
            );
          })}
        </List>
      )}

      <Box
        sx={{
          alignItems: 'center',
          bottom: wallets?.length === 0 ? 'unset' : '20px',
          display: 'flex',
          gap: '10px',
          position: wallets?.length === 0 ? 'relative' : 'fixed',
          right: wallets?.length === 0 ? 'unset' : '20px',
        }}
      >
        <HtmlTooltip
          disableHoverListener={hasSeenGettingStarted === true}
          title={
            <Fragment>
              <Typography
                color="inherit"
                sx={{
                  fontSize: '16px',
                }}
              >
                {t('auth:tips.existing_account', {
                  postProcess: 'capitalizeFirst',
                })}
              </Typography>
            </Fragment>
          }
        >
          <CustomButton
            onClick={handleSetSeedValue}
            sx={{
              padding: '10px',
              display: 'inline',
            }}
          >
            {t('auth:action.add.seed_phrase', {
              postProcess: 'capitalizeFirst',
            })}
          </CustomButton>
        </HtmlTooltip>

        <HtmlTooltip
          disableHoverListener={hasSeenGettingStarted === true}
          title={
            <Fragment>
              <Typography
                color="inherit"
                sx={{
                  fontSize: '16px',
                }}
              >
                {t('auth:tips.additional_wallet', {
                  postProcess: 'capitalizeFirst',
                })}
              </Typography>
            </Fragment>
          }
        >
          <CustomButton
            sx={{
              padding: '10px',
            }}
            {...getRootProps()}
          >
            <input {...getInputProps()} />
            {t('auth:action.add.account', {
              postProcess: 'capitalizeFirst',
            })}
          </CustomButton>
        </HtmlTooltip>
      </Box>

      <Dialog
        open={isOpenSeedModal}
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && seedValue && seedName && password) {
            onOk({ seedValue, seedName, password });
          }
        }}
      >
        <DialogTitle id="alert-dialog-title">
          {t('auth:message.generic.type_seed', {
            postProcess: 'capitalizeFirst',
          })}
        </DialogTitle>

        <DialogContent>
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Label>
              {t('core:name', {
                postProcess: 'capitalizeFirst',
              })}
            </Label>
            <Input
              placeholder="Name"
              value={seedName}
              onChange={(e) => setSeedName(e.target.value)}
            />

            <Spacer height="7px" />

            <Label>
              {t('auth:seed', {
                postProcess: 'capitalizeFirst',
              })}
            </Label>
            <PasswordField
              placeholder="Seed-phrase"
              id="standard-adornment-password"
              value={seedValue}
              onChange={(e) => setSeedValue(e.target.value)}
              autoComplete="off"
              sx={{
                width: '100%',
              }}
            />

            <Spacer height="7px" />

            <Label>
              {t('auth:action.choose_password', {
                postProcess: 'capitalizeFirst',
              })}
            </Label>
            <PasswordField
              id="standard-adornment-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              sx={{
                width: '100%',
              }}
            />
          </Box>
        </DialogContent>

        <DialogActions>
          <Button
            disabled={isLoadingEncryptSeed}
            variant="contained"
            onClick={() => {
              setIsOpenSeedModal(false);
              setSeedValue('');
              setSeedName('');
              setPassword('');
              setSeedError('');
            }}
          >
            {t('core:action.close', {
              postProcess: 'capitalizeFirst',
            })}
          </Button>
          <LoadingButton
            loading={isLoadingEncryptSeed}
            disabled={!seedValue || !seedName || !password}
            variant="contained"
            onClick={() => {
              if (!seedValue || !seedName || !password) return;
              onOk({ seedValue, seedName, password });
            }}
            autoFocus
          >
            {t('core:action.add', {
              postProcess: 'capitalizeFirst',
            })}
          </LoadingButton>
          <Typography
            sx={{
              fontSize: '14px',
              visibility: seedError ? 'visible' : 'hidden',
            }}
          >
            {seedError}
          </Typography>
        </DialogActions>
      </Dialog>
    </div>
  );
};

const WalletItem = ({ wallet, updateWalletItem, idx, setSelectedWallet }) => {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [isEdit, setIsEdit] = useState(false);
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core', 'group']);

  useEffect(() => {
    if (wallet?.name) {
      setName(wallet.name);
    }
    if (wallet?.note) {
      setNote(wallet.note);
    }
  }, [wallet]);
  return (
    <>
      <ButtonBase
        onClick={() => {
          setSelectedWallet(wallet);
        }}
        sx={{
          width: '100%',
          padding: '10px',
        }}
      >
        <ListItem
          sx={{
            bgcolor: theme.palette.background.default,
            flexGrow: 1,
            '&:hover': {
              backgroundColor: theme.palette.action.hover,
              transform: 'scale(1.01)',
            },
            transition: 'all 0.1s ease-in-out',
          }}
          alignItems="flex-start"
        >
          <ListItemAvatar>
            <Avatar alt="" src="/static/images/avatar/1.jpg" />
          </ListItemAvatar>

          <ListItemText
            primary={
              wallet?.name
                ? wallet.name
                : wallet?.filename
                  ? parsefilenameQortal(wallet?.filename)
                  : 'No name'
            }
            secondary={
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <Typography
                  component="span"
                  variant="body2"
                  sx={{ color: theme.palette.text.primary, display: 'inline' }}
                >
                  {wallet?.address0}
                </Typography>
                {wallet?.note}
                <Typography
                  sx={{
                    textAlign: 'end',
                    marginTop: '5px',
                  }}
                >
                  {t('core:action.login', {
                    postProcess: 'capitalizeFirst',
                  })}
                </Typography>
              </Box>
            }
          />
        </ListItem>

        <IconButton
          sx={{
            alignSelf: 'flex-start',
          }}
          onClick={(e) => {
            e.stopPropagation();
            setIsEdit(true);
          }}
          edge="end"
          aria-label="edit"
        >
          <EditIcon />
        </IconButton>
      </ButtonBase>
      {isEdit && (
        <Box
          sx={{
            padding: '8px',
          }}
        >
          <Label>
            {t('core:name', {
              postProcess: 'capitalizeFirst',
            })}
          </Label>
          <Input
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            sx={{
              width: '100%',
            }}
          />

          <Spacer height="10px" />

          <Label>
            {t('auth:note', {
              postProcess: 'capitalizeFirst',
            })}
          </Label>
          <Input
            placeholder="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            inputProps={{
              maxLength: 100,
            }}
            sx={{
              width: '100%',
            }}
          />

          <Spacer height="10px" />

          <Box
            sx={{
              display: 'flex',
              gap: '20px',
              justifyContent: 'flex-end',
              width: '100%',
            }}
          >
            <Button
              size="small"
              variant="contained"
              onClick={() => setIsEdit(false)}
            >
              {t('core:action.close', {
                postProcess: 'capitalizeFirst',
              })}
            </Button>
            <Button
              sx={{
                backgroundColor: theme.palette.other.danger,
                '&:hover': {
                  backgroundColor: theme.palette.other.danger,
                },
                '&:focus': {
                  backgroundColor: theme.palette.other.danger,
                },
              }}
              size="small"
              variant="contained"
              onClick={() => updateWalletItem(idx, null)}
            >
              {t('core:action.remove', {
                postProcess: 'capitalizeFirst',
              })}
            </Button>
            <Button
              sx={{
                backgroundColor: '#5EB049',
                '&:hover': {
                  backgroundColor: '#5EB049',
                },
                '&:focus': {
                  backgroundColor: '#5EB049',
                },
              }}
              size="small"
              variant="contained"
              onClick={() => {
                updateWalletItem(idx, {
                  ...wallet,
                  name,
                  note,
                });
                setIsEdit(false);
              }}
            >
              {t('core:action.save', {
                postProcess: 'capitalizeFirst',
              })}
            </Button>
          </Box>
        </Box>
      )}
    </>
  );
};
