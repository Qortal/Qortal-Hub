import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  ButtonBase,
  IconButton,
  Input,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { useDropzone } from 'react-dropzone';
import EditIcon from '@mui/icons-material/Edit';
import PersonIcon from '@mui/icons-material/Person';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import VpnKeyRoundedIcon from '@mui/icons-material/VpnKeyRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import { getWallets, storeWallets, walletVersion } from '../background/background.ts';
import { getPrimaryNameForAvatar } from './Group/groupApi';
import { getBaseApiReactForAvatar } from '../App';
import PhraseWallet from '../utils/generateWallet/phrase-wallet.ts';
import { decryptStoredWalletFromSeedPhrase } from '../utils/decryptWallet.ts';
import { crypto } from '../constants/decryptWallet.ts';
import { PasswordField } from './index.ts';
import { AuthButton, AuthSectionLabel } from './Auth/AuthShell';

const parsefilenameQortal = (filename) => {
  return filename.startsWith('qortal_backup_') ? filename.slice(14) : filename;
};

const shortenAddress = (address?: string) => {
  if (!address) return '';
  if (address.length <= 18) return address;
  return `${address.slice(0, 8)}...${address.slice(-8)}`;
};

type WalletsProps = {
  setExtState: (state: any) => void;
  setRawWallet: (wallet: any) => void;
  rawWallet?: any;
  mode?: 'entry' | 'import';
};

export const Wallets = ({
  setExtState,
  setRawWallet,
  mode = 'import',
}: WalletsProps) => {
  const [wallets, setWallets] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [seedValue, setSeedValue] = useState('');
  const [seedError, setSeedError] = useState('');
  const [password, setPassword] = useState('');
  const [isLoadingEncryptSeed, setIsLoadingEncryptSeed] = useState(false);
  const [isSeedVisible, setIsSeedVisible] = useState(false);
  const [importView, setImportView] = useState<'choice' | 'backup' | 'seedphrase'>(
    'choice'
  );
  const [backupImportHint, setBackupImportHint] = useState('');
  const [primaryNamesByAddress, setPrimaryNamesByAddress] = useState<
    Record<string, string>
  >({});
  const fetchingAddressesRef = useRef<Set<string>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const theme = useTheme();

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target as HTMLElement;
          const address = el.getAttribute('data-address');
          if (!address || fetchingAddressesRef.current.has(address)) return;
          fetchingAddressesRef.current.add(address);

          getPrimaryNameForAvatar(address)
            .then((name) => {
              if (name) {
                setPrimaryNamesByAddress((prev) =>
                  prev[address] === undefined ? { ...prev, [address]: name } : prev
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
    if (!isLoading && Array.isArray(wallets)) {
      storeWallets(wallets);
    }
  }, [wallets, isLoading]);

  const selectedWalletFunc = (wallet) => {
    setRawWallet(wallet);
    setExtState('wallet-dropped');
  };

  const updateWalletItem = (idx, wallet) => {
    setWallets((prev) => {
      const copyPrev = [...prev];
      if (wallet === null) {
        copyPrev.splice(idx, 1);
        return copyPrev;
      }
      copyPrev[idx] = wallet;
      return copyPrev;
    });
  };

  const importSeedphrase = async () => {
    try {
      setIsLoadingEncryptSeed(true);
      setSeedError('');
      const res = await decryptStoredWalletFromSeedPhrase(seedValue.trim());
      const wallet2 = new PhraseWallet(res, walletVersion);
      const wallet = await wallet2.generateSaveWalletData(
        password,
        crypto.kdfThreads,
        () => {}
      );

      if (wallet?.address0) {
        const existsAlready = wallets.some(
          (existingWallet) => existingWallet?.address0 === wallet.address0
        );
        if (!existsAlready) {
          setWallets([
            ...wallets,
            {
              ...wallet,
              name: '',
            },
          ]);
        }
        setSeedValue('');
        setPassword('');
        setImportView('choice');
        setBackupImportHint(
          existsAlready
            ? 'This account is already stored on this device.'
            : 'Account imported successfully.'
        );
      } else {
        setSeedError('Unable to import this seedphrase.');
      }
    } catch (error: any) {
      setSeedError(error?.message || 'Unable to import this seedphrase.');
    } finally {
      setIsLoadingEncryptSeed(false);
    }
  };

  const { getRootProps, getInputProps } = useDropzone({
    accept: {
      'application/json': ['.json'],
    },
    onDrop: async (acceptedFiles) => {
      const importedWallets: any[] = [];

      for (const file of acceptedFiles as File[]) {
        try {
          const fileContents = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onabort = () => reject(new Error('File reading was aborted'));
            reader.onerror = () => reject(new Error('File reading has failed'));
            reader.onload = () => resolve(reader.result);
            reader.readAsText(file);
          });
          if (typeof fileContents !== 'string') continue;
          const parsedData = JSON.parse(fileContents);
          importedWallets.push({ ...parsedData, filename: file.name });
        } catch (error) {
          console.error(error);
        }
      }

      const uniqueInitialMap = new Map();
      importedWallets.forEach((wallet) => {
        if (!wallet?.address0) return;
        if (!uniqueInitialMap.has(wallet.address0)) {
          uniqueInitialMap.set(wallet.address0, wallet);
        }
      });

      const uniqueWallets = Array.from(uniqueInitialMap.values());
      if (!uniqueWallets.length) return;

      const uniqueNewWallets = uniqueWallets.filter(
        (newWallet) =>
          !wallets.some(
            (existingWallet) => existingWallet?.address0 === newWallet?.address0
          )
      );

      if (uniqueNewWallets.length > 0) {
        setWallets([...wallets, ...uniqueNewWallets]);
      }

      setBackupImportHint(
        uniqueNewWallets.length > 0
          ? `${uniqueNewWallets.length} account${
              uniqueNewWallets.length === 1 ? '' : 's'
            } imported successfully.`
          : 'These accounts are already stored on this device.'
      );
      setImportView('choice');
    },
  });

  if (isLoading) return null;

  const accountsList = (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        maxHeight: mode === 'entry' ? 280 : 'none',
        overflowY: mode === 'entry' ? 'auto' : 'visible',
        width: '100%',
      }}
    >
      {wallets.map((wallet, idx) => (
        <WalletRow
          key={wallet?.address0}
          idx={idx}
          primaryName={
            wallet?.address0 ? primaryNamesByAddress[wallet.address0] : undefined
          }
          registerCardRef={registerCardRef}
          setSelectedWallet={selectedWalletFunc}
          updateWalletItem={updateWalletItem}
          wallet={wallet}
        />
      ))}
    </Box>
  );

  if (mode === 'entry') {
    return wallets.length === 0 ? (
      <Typography
        sx={{
          color: 'rgba(214,221,233,0.56)',
          fontSize: '0.92rem',
          lineHeight: 1.6,
          textAlign: 'center',
        }}
      >
        No accounts found on this device.
      </Typography>
    ) : (
      accountsList
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        width: '100%',
      }}
    >
      {importView === 'choice' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <ChoiceRow
            description="Import a saved Hub backup."
            icon={<DescriptionRoundedIcon sx={{ fontSize: 22 }} />}
            onClick={() => setImportView('backup')}
            title="Backup file"
          />
          <ChoiceRow
            description="Restore using your seedphrase."
            icon={<VpnKeyRoundedIcon sx={{ fontSize: 22 }} />}
            onClick={() => setImportView('seedphrase')}
            title="Seedphrase"
          />
        </Box>
      )}

      {importView === 'backup' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
          <InlineReturn label="Return" onClick={() => setImportView('choice')} />
          <Box
            {...getRootProps()}
            sx={{
              alignItems: 'center',
              backgroundColor: 'rgba(255,255,255,0.02)',
              border: '1px dashed rgba(255,255,255,0.12)',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: 0.8,
              justifyContent: 'center',
              minHeight: 170,
              px: 3,
              py: 3,
              textAlign: 'center',
              transition: 'background-color 160ms ease, border-color 160ms ease',
              '&:hover': {
                backgroundColor: 'rgba(255,255,255,0.03)',
                borderColor: 'rgba(255,255,255,0.18)',
              },
            }}
          >
            <input {...getInputProps()} />
            <Typography sx={{ fontSize: '1rem', fontWeight: 700 }}>
              Import from backup file
            </Typography>
            <Typography
              sx={{
                color: 'rgba(214,221,233,0.56)',
                fontSize: '0.88rem',
                lineHeight: 1.6,
                maxWidth: 300,
              }}
            >
              Drop backup file or click to select.
            </Typography>
          </Box>
          {backupImportHint && (
            <Typography
              sx={{
                color: 'rgba(214,221,233,0.56)',
                fontSize: '0.84rem',
              }}
            >
              {backupImportHint}
            </Typography>
          )}
        </Box>
      )}

      {importView === 'seedphrase' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
          <InlineReturn label="Return" onClick={() => setImportView('choice')} />

          <Box>
            <AuthSectionLabel>Seedphrase</AuthSectionLabel>
            <TextField
              fullWidth
              multiline
              minRows={4}
              value={seedValue}
              onChange={(event) => setSeedValue(event.target.value)}
              placeholder="Enter your seedphrase"
              sx={seedTextFieldSx(theme, isSeedVisible)}
              InputProps={{
                endAdornment: (
                  <ButtonBase
                    onClick={() => setIsSeedVisible((prev) => !prev)}
                    sx={{
                      alignSelf: 'flex-start',
                      color: 'rgba(214,221,233,0.62)',
                      mt: 1,
                    }}
                  >
                    {isSeedVisible ? <VisibilityOffIcon /> : <VisibilityIcon />}
                  </ButtonBase>
                ),
              }}
            />
          </Box>

          <Box>
            <AuthSectionLabel>Wallet password</AuthSectionLabel>
            <PasswordField
              id="wallet-import-password"
              name="wallet-import-password"
              onChange={(event) => setPassword(event.target.value)}
              suppressAutofill
              sx={{ width: '100%' }}
              value={password}
            />
          </Box>

          {seedError && (
            <Typography
              sx={{
                color: theme.palette.other.danger,
                fontSize: '0.84rem',
              }}
            >
              {seedError}
            </Typography>
          )}

          <AuthButton
            disabled={!seedValue.trim() || !password.trim() || isLoadingEncryptSeed}
            onClick={importSeedphrase}
          >
            {isLoadingEncryptSeed ? 'Importing account...' : 'Import account'}
          </AuthButton>
        </Box>
      )}
    </Box>
  );
};

const ChoiceRow = ({ icon, title, description, onClick }) => {
  const theme = useTheme();
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '8px',
        display: 'flex',
        gap: 1.2,
        justifyContent: 'space-between',
        minHeight: 88,
        px: 1.4,
        py: 1.2,
        textAlign: 'left',
        transition: 'background-color 160ms ease, border-color 160ms ease',
        '&:hover': {
          backgroundColor: 'rgba(255,255,255,0.035)',
          borderColor: 'rgba(255,255,255,0.12)',
        },
      }}
    >
      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.2 }}>
        <Box
          sx={{
            alignItems: 'center',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            color: 'rgba(214,221,233,0.74)',
            display: 'inline-flex',
            height: 42,
            justifyContent: 'center',
            width: 42,
          }}
        >
          {icon}
        </Box>
        <Box>
          <Typography sx={{ fontSize: '0.98rem', fontWeight: 700 }}>
            {title}
          </Typography>
          <Typography
            sx={{
              color: 'rgba(214,221,233,0.56)',
              fontSize: '0.84rem',
              lineHeight: 1.55,
              mt: 0.25,
            }}
          >
            {description}
          </Typography>
        </Box>
      </Box>
      <ArrowForwardRoundedIcon sx={{ color: theme.palette.text.secondary, fontSize: 18 }} />
    </ButtonBase>
  );
};

const InlineReturn = ({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) => {
  const theme = useTheme();

  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        alignItems: 'center',
        alignSelf: 'flex-start',
        color: 'rgba(214,221,233,0.62)',
        display: 'inline-flex',
        gap: 0.5,
        minWidth: 0,
        p: 0,
        '&:hover': {
          color: theme.palette.text.primary,
        },
      }}
    >
      <ArrowBackRoundedIcon sx={{ fontSize: 18 }} />
      <Typography sx={{ fontSize: '0.84rem', fontWeight: 700 }}>
        {label}
      </Typography>
    </ButtonBase>
  );
};

const WalletRow = ({
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

  useEffect(() => {
    setName(wallet?.name || '');
    setNote(wallet?.note || '');
  }, [wallet]);

  const qortalAvatarSrc =
    primaryName &&
    `${getBaseApiReactForAvatar()}/arbitrary/THUMBNAIL/${primaryName}/qortal_avatar?async=true`;
  const displayName =
    primaryName ||
    wallet?.name ||
    (wallet?.filename ? parsefilenameQortal(wallet.filename) : null) ||
    'Unnamed account';

  return (
    <Box
      ref={wallet?.address0 ? registerCardRef(wallet.address0) : undefined}
      sx={{
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        pb: isEdit ? 1.2 : 0,
        pt: 0.2,
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          backgroundColor: isEdit ? 'rgba(255,255,255,0.03)' : 'transparent',
          borderRadius: '7px',
          display: 'grid',
          gap: 1,
          gridTemplateColumns: '36px minmax(0,1fr) auto',
          minHeight: 60,
          px: 0.55,
          py: 0.5,
          transition: 'background-color 160ms ease',
          '&:hover': {
            backgroundColor: isEdit ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.035)',
          },
        }}
        onClick={() => {
          if (!isEdit) setSelectedWallet(wallet);
        }}
      >
        <Avatar alt={displayName} src={qortalAvatarSrc || undefined} sx={{ width: 34, height: 34 }}>
          <PersonIcon sx={{ fontSize: 22 }} />
        </Avatar>

        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ alignItems: 'center', display: 'inline-flex', gap: 0.35, maxWidth: '100%' }}>
            <Typography
              sx={{
                fontSize: '0.95rem',
                fontWeight: 700,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {displayName}
            </Typography>
            <IconButton
              sx={{
                color: 'rgba(214,221,233,0.48)',
                ml: 0.1,
                p: 0.35,
              }}
              onClick={(event) => {
                event.stopPropagation();
                setIsEdit((prev) => !prev);
              }}
            >
              <EditIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Box>
          <Typography
            sx={{
              color: 'rgba(214,221,233,0.56)',
              fontSize: '0.79rem',
              lineHeight: 1.35,
              mt: 0.05,
            }}
          >
            {shortenAddress(wallet?.address0)}
          </Typography>
        </Box>

        <AuthButton
          fullWidth={false}
          prominence="subtle"
          onClick={() => setSelectedWallet(wallet)}
        >
          Unlock
        </AuthButton>
      </Box>

      {isEdit && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 0.9,
            pl: { xs: 0.7, sm: 6.2 },
            pr: 0.7,
            pt: 1,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <Typography sx={inlineFieldLabelSx}>Account name</Typography>
          <Input
            placeholder="Account name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            sx={inlineInputSx}
          />

          <Typography sx={inlineFieldLabelSx}>Note</Typography>
          <Input
            placeholder="Optional note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            inputProps={{ maxLength: 100 }}
            sx={inlineInputSx}
          />

          <Box
            sx={{
              display: 'flex',
              gap: 0.8,
              justifyContent: 'flex-end',
              mt: 0.4,
            }}
          >
            <ButtonBase
              onClick={() => updateWalletItem(idx, null)}
              sx={inlineActionSx(true)}
            >
              Remove
            </ButtonBase>
            <ButtonBase
              onClick={() => {
                updateWalletItem(idx, {
                  ...wallet,
                  name,
                  note,
                });
                setIsEdit(false);
              }}
              sx={inlineActionSx(false)}
            >
              Save
            </ButtonBase>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const seedTextFieldSx = (theme, isVisible: boolean) => ({
  '& .MuiOutlinedInput-root': {
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: '8px',
    '& fieldset': {
      borderColor: 'rgba(255,255,255,0.08)',
    },
    '&:hover fieldset': {
      borderColor: 'rgba(255,255,255,0.12)',
    },
    '&.Mui-focused fieldset': {
      borderColor: 'rgba(90,136,243,0.42)',
    },
  },
  '& textarea': {
    WebkitTextSecurity: isVisible ? 'none' : 'disc',
    color: theme.palette.text.primary,
    fontSize: '0.95rem',
    lineHeight: 1.6,
  },
});

const inlineFieldLabelSx = {
  color: 'rgba(214,221,233,0.56)',
  fontSize: '0.74rem',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const inlineInputSx = {
  color: 'rgba(230,236,247,0.92)',
  fontSize: '0.92rem',
  '&:before': {
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  '&:after': {
    borderBottom: '1px solid rgba(90,136,243,0.42)',
  },
};

const inlineActionSx = (danger: boolean) => ({
  alignItems: 'center',
  backgroundColor: danger ? 'rgba(160,56,56,0.12)' : 'rgba(255,255,255,0.03)',
  border: `1px solid ${danger ? 'rgba(213,92,92,0.18)' : 'rgba(255,255,255,0.08)'}`,
  borderRadius: '8px',
  color: danger ? 'rgba(240,165,165,0.92)' : 'rgba(230,236,247,0.88)',
  display: 'inline-flex',
  fontSize: '0.84rem',
  fontWeight: 700,
  height: 34,
  justifyContent: 'center',
  minWidth: 82,
  px: 1.4,
});
