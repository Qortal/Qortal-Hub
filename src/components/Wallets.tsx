import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
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
import { CustomButton, Label } from '../styles/App-styles.ts';
import { useDropzone } from 'react-dropzone';
import EditIcon from '@mui/icons-material/Edit';
import PersonIcon from '@mui/icons-material/Person';
import { Spacer } from '../common/Spacer.tsx';
import {
  deleteAvatar,
  loadAvatar,
  resizeImageToAvatar,
  saveAvatar,
} from '../utils/avatarStorage.ts';
import {
  getWallets,
  storeWallets,
  walletVersion,
} from '../background/background.ts';
import { getNameInfo } from './Group/groupApi';
import { getBaseApiReact } from '../App';
import { useModal } from '../hooks/useModal.tsx';
import PhraseWallet from '../utils/generateWallet/phrase-wallet.ts';
import { decryptStoredWalletFromSeedPhrase } from '../utils/decryptWallet.ts';
import { crypto } from '../constants/decryptWallet.ts';
import { LoadingButton } from '@mui/lab';
import { PasswordField } from './index.ts';
import { HtmlTooltip } from './NotAuthenticated.tsx';
import { useAtomValue } from 'jotai';
import { hasSeenGettingStartedAtom } from '../atoms/global';
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
  const hasSeenGettingStarted = useAtomValue(hasSeenGettingStartedAtom);
  const [password, setPassword] = useState('');
  const [isOpenSeedModal, setIsOpenSeedModal] = useState(false);
  const [isLoadingEncryptSeed, setIsLoadingEncryptSeed] = useState(false);
  const [primaryNamesByAddress, setPrimaryNamesByAddress] = useState<
    Record<string, string>
  >({});
  const fetchingAddressesRef = useRef<Set<string>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const { isShow, onCancel, onOk, show } = useModal();

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target as HTMLElement;
          const address = el.getAttribute('data-address');
          if (!address || fetchingAddressesRef.current.has(address)) return;
          fetchingAddressesRef.current.add(address);
          getNameInfo(address)
            .then((name) => {
              if (name) {
                setPrimaryNamesByAddress((prev) =>
                  prev[address] === undefined
                    ? { ...prev, [address]: name }
                    : prev
                );
              }
            })
            .catch(() => {})
            .finally(() => {
              fetchingAddressesRef.current.delete(address);
              observerRef.current?.unobserve(el);
            });
        });
      },
      { rootMargin: '100px', threshold: 0.01 }
    );
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  const registerCardRef = useCallback((address: string) => {
    return (el: HTMLElement | null) => {
      if (!el) return;
      el.setAttribute('data-address', address);
      observerRef.current?.observe(el);
    };
  }, []);

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

            reader.onabort = () => reject('File reading was aborted'); // TODO translate
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

  const { getRootProps: getRootPropsTemp, getInputProps: getInputPropsTemp } =
    useDropzone({
      accept: {
        'application/json': ['.json'], // Only accept JSON files
      },
      multiple: false,
      onDrop: async (acceptedFiles) => {
        const files: any = acceptedFiles;
        let importedWallet: any = null;

        for (const file of files) {
          try {
            const fileContents = await new Promise((resolve, reject) => {
              const reader = new FileReader();

              reader.onabort = () => reject('File reading was aborted'); // TODO translate
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
            importedWallet = parsedData;
          } catch (error) {
            console.error(error);
          }
        }

        if (importedWallet) {
          selectedWalletFunc(importedWallet);
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
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
    } catch (error) {
      setSeedError(
        error?.message ||
          t('auth:message.error.account_creation', {
            postProcess: 'capitalizeFirstChar',
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
    <Box>
      {wallets?.length === 0 || !wallets ? (
        <>
          <Typography>
            {t('auth:message.generic.no_account', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>

          <Spacer height="75px" />
        </>
      ) : (
        <>
          <Typography>
            {t('auth:message.generic.your_accounts', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>

          <Spacer height="30px" />
        </>
      )}

      {rawWallet && (
        <Box>
          <Typography>
            {t('auth:account.selected', {
              postProcess: 'capitalizeFirstChar',
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
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '16px',
            maxHeight: '60vh',
            overflowY: 'auto',
            width: '100%',
            maxWidth: '700px',
            padding: '8px',
          }}
        >
          {wallets?.map((wallet, idx) => {
            return (
              <WalletItem
                setSelectedWallet={selectedWalletFunc}
                key={wallet?.address0}
                wallet={wallet}
                idx={idx}
                updateWalletItem={updateWalletItem}
                primaryName={
                  wallet?.address0
                    ? primaryNamesByAddress[wallet.address0]
                    : undefined
                }
                registerCardRef={registerCardRef}
              />
            );
          })}
        </Box>
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
          title={
            <Fragment>
              <Typography
                color="inherit"
                sx={{
                  fontSize: '16px',
                }}
              >
                {t('auth:temp_auth.tooltip', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </Fragment>
          }
        >
          <CustomButton
            {...getRootPropsTemp()}
            sx={{
              padding: '10px',
              display: 'inline',
            }}
          >
            <input {...getInputPropsTemp()} />
            {t('auth:temp_auth.button', {
              postProcess: 'capitalizeFirstChar',
            })}
          </CustomButton>
        </HtmlTooltip>
        <HtmlTooltip
          title={
            <Fragment>
              <Typography
                color="inherit"
                sx={{
                  fontSize: '16px',
                }}
              >
                {t('auth:tips.existing_account', {
                  postProcess: 'capitalizeFirstChar',
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
              postProcess: 'capitalizeFirstChar',
            })}
          </CustomButton>
        </HtmlTooltip>

        <HtmlTooltip
          title={
            <Fragment>
              <Typography
                color="inherit"
                sx={{
                  fontSize: '16px',
                }}
              >
                {t('auth:tips.additional_wallet', {
                  postProcess: 'capitalizeFirstChar',
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
              postProcess: 'capitalizeFirstChar',
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
        <DialogTitle
          id="alert-dialog-title"
          sx={{
            textAlign: 'center',
            color: theme.palette.text.primary,
            fontWeight: 'bold',
            opacity: 1,
          }}
        >
          {t('auth:message.generic.type_seed', {
            postProcess: 'capitalizeFirstChar',
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
                postProcess: 'capitalizeFirstChar',
              })}
            </Label>
            <Input
              placeholder={t('core:name', {
                postProcess: 'capitalizeFirstChar',
              })}
              value={seedName}
              onChange={(e) => setSeedName(e.target.value)}
            />

            <Spacer height="7px" />

            <Label>
              {t('auth:seed_phrase', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Label>
            <PasswordField
              placeholder={t('auth:seed_phrase', {
                postProcess: 'capitalizeFirstChar',
              })}
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
                postProcess: 'capitalizeFirstChar',
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
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>

          <LoadingButton
            autoFocus
            disabled={!seedValue || !seedName || !password}
            loading={isLoadingEncryptSeed}
            onClick={() => {
              if (!seedValue || !seedName || !password) return;
              onOk({ seedValue, seedName, password });
            }}
            variant="contained"
          >
            {t('core:action.add', {
              postProcess: 'capitalizeFirstChar',
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
    </Box>
  );
};

const WalletItem = ({
  wallet,
  updateWalletItem,
  idx,
  setSelectedWallet,
  primaryName,
  registerCardRef,
}) => {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [isEdit, setIsEdit] = useState(false);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  useEffect(() => {
    if (wallet?.name) {
      setName(wallet.name);
    }
    if (wallet?.note) {
      setNote(wallet.note);
    }
  }, [wallet]);

  const qortalAvatarSrc =
    primaryName &&
    `${getBaseApiReact()}/arbitrary/THUMBNAIL/${primaryName}/qortal_avatar?async=true`;
  const displayAvatarSrc = qortalAvatarSrc || undefined;
  const displayName =
    primaryName ||
    wallet?.name ||
    (wallet?.filename ? parsefilenameQortal(wallet.filename) : null) ||
    'No name';

  return (
    <Box
      ref={wallet?.address0 ? registerCardRef(wallet.address0) : undefined}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        padding: '16px',
        borderRadius: '12px',
        backgroundColor: theme.palette.background.paper,
        border: `1px solid ${theme.palette.divider}`,
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        cursor: isEdit ? 'default' : 'pointer',
        minHeight: '180px',
        ...(isEdit
          ? { gridColumn: '1 / -1' }
          : {
              '&:hover': {
                transform: 'translateY(-2px)',
                boxShadow: theme.shadows[4],
              },
            }),
      }}
      onClick={() => {
        if (!isEdit) setSelectedWallet(wallet);
      }}
    >
      {/* Card header: avatar + edit button */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 1.5,
        }}
      >
        <Avatar
          alt={displayName}
          src={displayAvatarSrc}
          sx={{ width: 56, height: 56 }}
        >
          <PersonIcon sx={{ fontSize: 32 }} />
        </Avatar>
        <IconButton
          sx={{
            color: theme.palette.text.primary,
          }}
          onClick={(e) => {
            e.stopPropagation();
            setIsEdit(true);
          }}
          aria-label={t('core:action.edit', {
            postProcess: 'capitalizeFirstChar',
          })}
        >
          <EditIcon />
        </IconButton>
      </Box>

      {/* Card body: name, address, note */}
      <Typography
        sx={{
          fontSize: '16px',
          fontWeight: 600,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: theme.palette.text.primary,
        }}
      >
        {displayName}
      </Typography>

      <Typography
        sx={{
          fontSize: '13px',
          color: theme.palette.text.secondary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          mt: 0.5,
        }}
      >
        {wallet?.address0}
      </Typography>

      {wallet?.note && (
        <Typography
          sx={{
            fontSize: '13px',
            color: theme.palette.text.secondary,
            fontStyle: 'italic',
            mt: 0.5,
          }}
        >
          {wallet.note}
        </Typography>
      )}

      {/* Card footer: choose button */}
      {!isEdit && (
        <Box
          sx={{
            mt: 'auto',
            pt: 1.5,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <ButtonBase
            sx={{
              backgroundColor: theme.palette.primary.main,
              color: theme.palette.primary.contrastText,
              borderRadius: '20px',
              padding: '6px 24px',
              fontSize: '13px',
              fontWeight: 500,
              transition: 'filter 0.2s ease, transform 0.1s ease',
              '&:hover': {
                filter: 'brightness(1.2)',
                transform: 'scale(1.05)',
              },
            }}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedWallet(wallet);
            }}
          >
            {t('core:action.choose', {
              postProcess: 'capitalizeFirstChar',
            })}
          </ButtonBase>
        </Box>
      )}

      {/* Edit mode panel */}
      {isEdit && (
        <Box
          sx={{
            mt: 2,
            pt: 2,
            borderTop: `1px solid ${theme.palette.divider}`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Label>
            {t('core:name', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Label>
          <Input
            placeholder={t('core:name', { postProcess: 'capitalizeFirstChar' })}
            value={name}
            onChange={(e) => setName(e.target.value)}
            sx={{
              width: '100%',
            }}
          />

          <Spacer height="10px" />

          <Label>
            {t('auth:note', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Label>
          <Input
            placeholder={t('core:note', { postProcess: 'capitalizeFirstChar' })}
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
                postProcess: 'capitalizeFirstChar',
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
                postProcess: 'capitalizeFirstChar',
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
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
};
