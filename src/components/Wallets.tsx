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
import { alpha } from '@mui/material/styles';
import { useDropzone } from 'react-dropzone';
import EditIcon from '@mui/icons-material/Edit';
import PersonIcon from '@mui/icons-material/Person';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import VpnKeyRoundedIcon from '@mui/icons-material/VpnKeyRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { getWallets, storeWallets, walletVersion } from '../background/background.ts';
import { getPrimaryNameForAvatar } from './Group/groupApi';
import { getBaseApiReactForAvatar } from '../App';
import PhraseWallet from '../utils/generateWallet/phrase-wallet.ts';
import { decryptStoredWalletFromSeedPhrase } from '../utils/decryptWallet.ts';
import { crypto } from '../constants/decryptWallet.ts';
import { PasswordField } from './index.ts';
import { AuthButton, AuthSectionLabel } from './Auth/AuthShell';
import type { AuthUnlockTransitionSnapshot } from '../types/authTransition';

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
  onImportViewChange?: (view: 'choice' | 'backup' | 'seedphrase') => void;
  onReady?: () => void;
  onWalletUnlockStart?: (snapshot: AuthUnlockTransitionSnapshot) => void;
};

export const Wallets = ({
  setExtState,
  setRawWallet,
  mode = 'import',
  onImportViewChange,
  onReady,
  onWalletUnlockStart,
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
  const [dragOverWalletIndex, setDragOverWalletIndex] = useState<number | null>(
    null
  );
  const [editingWalletIndex, setEditingWalletIndex] = useState<number | null>(
    null
  );
  const [primaryNamesByAddress, setPrimaryNamesByAddress] = useState<
    Record<string, string>
  >({});
  const fetchingAddressesRef = useRef<Set<string>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const theme = useTheme();

  const changeImportView = useCallback(
    (view: 'choice' | 'backup' | 'seedphrase') => {
      setImportView(view);
      onImportViewChange?.(view);
    },
    [onImportViewChange]
  );

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

  const persistWallets = useCallback(async (nextWallets: any[]) => {
    setWallets(nextWallets);
    await storeWallets(nextWallets);
  }, []);

  const getLatestWallets = useCallback(async () => {
    // Import flows can outlive the initial wallet load/migration. Re-read
    // storage before merging so a stale local list cannot overwrite accounts.
    const latestWallets = await getWallets();
    return Array.isArray(latestWallets) ? latestWallets : wallets;
  }, [wallets]);

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
    if (!isLoading) {
      onReady?.();
    }
  }, [isLoading, onReady]);

  const selectedWalletFunc = (
    wallet,
    transitionSnapshot?: AuthUnlockTransitionSnapshot
  ) => {
    if (transitionSnapshot && mode === 'entry') {
      onWalletUnlockStart?.(transitionSnapshot);
      window.setTimeout(() => {
        setRawWallet(wallet);
        setExtState('wallet-dropped');
      }, 130);
      return;
    }

    setRawWallet(wallet);
    setExtState('wallet-dropped');
  };

  const updateWalletItem = (idx, wallet) => {
    if (wallet === null) {
      setEditingWalletIndex(null);
    }

    const nextWallets = [...wallets];
    if (wallet === null) {
      nextWallets.splice(idx, 1);
    } else {
      nextWallets[idx] = wallet;
    }

    void persistWallets(nextWallets).catch(console.error);
  };

  const moveWalletItem = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;

    if (fromIndex >= wallets.length || toIndex >= wallets.length) return;

    const nextWallets = [...wallets];
    const [movedWallet] = nextWallets.splice(fromIndex, 1);
    nextWallets.splice(toIndex, 0, movedWallet);

    void persistWallets(nextWallets).catch(console.error);
  }, [persistWallets, wallets]);

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
        const latestWallets = await getLatestWallets();
        const existsAlready = latestWallets.some(
          (existingWallet) => existingWallet?.address0 === wallet.address0
        );
        const nextWallets = existsAlready
          ? latestWallets
          : [
              ...latestWallets,
              {
                ...wallet,
                name: '',
              },
            ];

        if (!existsAlready) {
          await persistWallets(nextWallets);
        }
        setSeedValue('');
        setPassword('');
        changeImportView('choice');
        setBackupImportHint(
          existsAlready
            ? 'This account is already stored on this device.'
            : 'Account imported successfully.'
        );
        if (!existsAlready) {
          setExtState('not-authenticated');
        }
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

      const latestWallets = await getLatestWallets();
      const uniqueNewWallets = uniqueWallets.filter(
        (newWallet) =>
          !latestWallets.some(
            (existingWallet) => existingWallet?.address0 === newWallet?.address0
          )
      );

      if (uniqueNewWallets.length > 0) {
        const nextWallets = [...latestWallets, ...uniqueNewWallets];
        await persistWallets(nextWallets);
      }

      setBackupImportHint(
        uniqueNewWallets.length > 0
          ? `${uniqueNewWallets.length} account${
              uniqueNewWallets.length === 1 ? '' : 's'
            } imported successfully.`
          : 'These accounts are already stored on this device.'
      );
      changeImportView('choice');
      if (uniqueNewWallets.length > 0) {
        setExtState('not-authenticated');
      }
    },
  });

  if (isLoading) return null;

  const displayedWallets =
    editingWalletIndex === null
      ? wallets.map((wallet, idx) => ({ wallet, idx }))
      : wallets
          .map((wallet, idx) => ({ wallet, idx }))
          .filter(({ idx }) => idx === editingWalletIndex);

  const accountsList = (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: mode === 'entry' ? 1.4 : 0,
        maxHeight:
          mode === 'entry' && editingWalletIndex === null ? 292 : 'none',
        overflowY:
          mode === 'entry' && editingWalletIndex === null ? 'auto' : 'visible',
        pr: mode === 'entry' && editingWalletIndex === null ? 0.35 : 0,
        width: '100%',
      }}
    >
      {displayedWallets.map(({ wallet, idx }) => (
        <WalletRow
          key={wallet?.address0}
          idx={idx}
          editingWalletIndex={editingWalletIndex}
          primaryName={
            wallet?.address0 ? primaryNamesByAddress[wallet.address0] : undefined
          }
          registerCardRef={registerCardRef}
          dragOverWalletIndex={dragOverWalletIndex}
          moveWalletItem={moveWalletItem}
          mode={mode}
          setDragOverWalletIndex={setDragOverWalletIndex}
          setEditingWalletIndex={setEditingWalletIndex}
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
            onClick={() => changeImportView('backup')}
            title="Backup file"
          />
          <ChoiceRow
            description="Restore using your seedphrase."
            icon={<VpnKeyRoundedIcon sx={{ fontSize: 22 }} />}
            onClick={() => changeImportView('seedphrase')}
            title="Seedphrase"
          />
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

      {importView === 'backup' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
          <InlineReturn onClick={() => changeImportView('choice')} />
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
          <InlineReturn onClick={() => changeImportView('choice')} />

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

const InlineReturn = ({ onClick }: { onClick: () => void }) => {
  const theme = useTheme();

  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        alignItems: 'center',
        alignSelf: 'flex-start',
        color: 'rgba(214,221,233,0.62)',
        display: 'inline-flex',
        minWidth: 0,
        p: 0,
        '&:hover': {
          color: theme.palette.text.primary,
        },
      }}
    >
      <ArrowBackRoundedIcon sx={{ fontSize: 18 }} />
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
  dragOverWalletIndex,
  editingWalletIndex,
  moveWalletItem,
  mode,
  setDragOverWalletIndex,
  setEditingWalletIndex,
}) => {
  const [accountName, setAccountName] = useState('');
  const [note, setNote] = useState('');
  const isEdit = editingWalletIndex === idx;
  const addressRef = useRef<HTMLParagraphElement | null>(null);
  const avatarRef = useRef<HTMLDivElement | null>(null);
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  const editPanelRef = useRef<HTMLDivElement | null>(null);
  const nameRef = useRef<HTMLParagraphElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const theme = useTheme();

  useEffect(() => {
    setAccountName(wallet?.name || '');
    setNote(wallet?.note || '');
  }, [wallet]);

  useEffect(() => {
    if (!isEdit) return;

    const closeEditPanel = () => {
      setNote(wallet?.note || '');
      setAccountName(wallet?.name || '');
      setEditingWalletIndex(null);
    };

    const closeOnOutsidePointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;

      if (
        target &&
        (editButtonRef.current?.contains(target) ||
          editPanelRef.current?.contains(target))
      ) {
        return;
      }

      closeEditPanel();
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeEditPanel();
    };

    document.addEventListener('mousedown', closeOnOutsidePointer);
    document.addEventListener('touchstart', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePointer);
      document.removeEventListener('touchstart', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isEdit, setEditingWalletIndex, wallet]);

  const qortalAvatarSrc =
    primaryName &&
    `${getBaseApiReactForAvatar()}/arbitrary/THUMBNAIL/${primaryName}/qortal_avatar?async=true`;
  const displayName =
    primaryName ||
    wallet?.name ||
    (wallet?.filename ? parsefilenameQortal(wallet.filename) : null) ||
    'Unnamed account';
  const addressLabel = shortenAddress(wallet?.address0);
  const canEditAccountName =
    !primaryName && !wallet?.filename;

  const handleSaveEdit = () => {
    updateWalletItem(idx, {
      ...wallet,
      ...(canEditAccountName ? { name: accountName.trim() } : {}),
      note,
    });
    setEditingWalletIndex(null);
  };

  const getTransitionSnapshot = (): AuthUnlockTransitionSnapshot | undefined => {
    if (
      mode !== 'entry' ||
      !avatarRef.current ||
      !nameRef.current ||
      !addressRef.current
    ) {
      return undefined;
    }

    const rectToObject = (rect: DOMRect) => ({
      height: rect.height,
      left: rect.left,
      top: rect.top,
      width: rect.width,
    });

    return {
      addressLabel,
      addressRect: rectToObject(addressRef.current.getBoundingClientRect()),
      avatarRect: rectToObject(avatarRef.current.getBoundingClientRect()),
      avatarSrc: qortalAvatarSrc || undefined,
      displayName,
      nameRect: rectToObject(nameRef.current.getBoundingClientRect()),
      primaryName: primaryName || undefined,
      walletAddress: wallet?.address0,
    };
  };

  const handleSelectWallet = () => {
    if (isEdit || isDraggingRef.current) return;
    setSelectedWallet(wallet, getTransitionSnapshot());
  };
  const isLight = theme.palette.mode === 'light';
  const entryRowBackground = isLight
    ? 'linear-gradient(180deg, rgba(255,255,255,0.94), rgba(246,249,253,0.98))'
    : 'linear-gradient(180deg, rgba(7,12,21,0.9), rgba(4,7,12,0.94))';
  const entryRowHoverBackground = isLight
    ? 'linear-gradient(180deg, rgba(255,255,255,0.99), rgba(239,245,252,0.99))'
    : 'linear-gradient(180deg, rgba(8,14,24,0.93), rgba(5,8,14,0.96))';
  const entryEditBackground = isLight
    ? 'linear-gradient(180deg, rgba(252,253,255,0.98), rgba(244,248,252,0.99))'
    : 'linear-gradient(180deg, rgba(13,19,31,0.92), rgba(7,11,18,0.94))';

  return (
    <Box
      ref={(element: HTMLDivElement | null) => {
        rowRef.current = element;
        if (wallet?.address0) {
          registerCardRef(wallet.address0)(element);
        }
      }}
      draggable={!isEdit}
      onDragStart={(event) => {
        if (isEdit) {
          event.preventDefault();
          return;
        }

        isDraggingRef.current = true;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(idx));
      }}
      onDragOver={(event) => {
        if (isEdit) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDragOverWalletIndex(idx);
      }}
      onDragLeave={() => {
        setDragOverWalletIndex((currentIndex) =>
          currentIndex === idx ? null : currentIndex
        );
      }}
      onDrop={(event) => {
        event.preventDefault();
        const fromIndex = Number(event.dataTransfer.getData('text/plain'));
        setDragOverWalletIndex(null);

        if (Number.isInteger(fromIndex)) {
          moveWalletItem(fromIndex, idx);
        }
      }}
      onDragEnd={() => {
        window.setTimeout(() => {
          isDraggingRef.current = false;
        }, 0);
        setDragOverWalletIndex(null);
      }}
      sx={{
        borderBottom:
          mode === 'entry' ? 'none' : '1px solid rgba(255,255,255,0.06)',
        opacity: dragOverWalletIndex === idx ? 0.74 : 1,
        pb: mode === 'entry' ? 0 : isEdit ? 1.2 : 0,
        pt: mode === 'entry' ? 0 : 0.2,
        transition: 'opacity 140ms ease',
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          background:
            mode === 'entry'
              ? isEdit
                ? entryEditBackground
                : entryRowBackground
              : isEdit
                ? 'rgba(255,255,255,0.03)'
                : 'transparent',
          border:
            mode === 'entry'
              ? isLight
                ? `1px solid ${theme.palette.border.subtle}`
                : '1px solid rgba(123,145,174,0.2)'
              : 'none',
          borderRadius: mode === 'entry' ? '8px' : '7px',
          cursor: isEdit ? 'default' : 'grab',
          display: 'grid',
          gap: mode === 'entry' ? 1.3 : 1,
          gridTemplateColumns:
            mode === 'entry'
              ? '54px minmax(0,1fr) auto auto'
              : '36px minmax(0,1fr) auto',
          minHeight: mode === 'entry' ? 86 : 60,
          px: mode === 'entry' ? 1.6 : 0.55,
          py: mode === 'entry' ? 1.15 : 0.5,
          transition:
            'background 160ms ease, border-color 160ms ease, box-shadow 160ms ease',
          '&:hover': {
            background: isEdit
              ? mode === 'entry'
                ? entryEditBackground
                : 'rgba(255,255,255,0.03)'
              : mode === 'entry'
                ? entryRowHoverBackground
                : 'rgba(255,255,255,0.03)',
            borderColor:
              mode === 'entry'
                ? isLight
                  ? theme.palette.border.main
                  : 'rgba(188,213,246,0.34)'
                : undefined,
            boxShadow:
              mode === 'entry' && !isEdit
                ? isLight
                  ? '0 2px 12px rgba(45, 72, 112, 0.06)'
                  : '0 0 0 1px rgba(70,120,210,0.04)'
                : 'none',
          },
          '&:active': {
            cursor: isEdit ? 'default' : 'grabbing',
          },
        }}
        onClick={() => {
          handleSelectWallet();
        }}
      >
        <Box sx={{ position: 'relative', width: mode === 'entry' ? 46 : 34 }}>
          <Avatar
            ref={avatarRef}
            alt={displayName}
            src={qortalAvatarSrc || undefined}
            sx={{
              height: mode === 'entry' ? 46 : 34,
              width: mode === 'entry' ? 46 : 34,
            }}
          >
            <PersonIcon sx={{ fontSize: mode === 'entry' ? 27 : 22 }} />
          </Avatar>
          {mode === 'entry' && (
            <Box
              sx={{
                backgroundColor: '#62D26F',
                border: isLight
                  ? `2px solid ${theme.palette.background.paper}`
                  : '2px solid #111722',
                borderRadius: '999px',
                bottom: -1,
                height: 12,
                position: 'absolute',
                right: -1,
                width: 12,
              }}
            />
          )}
        </Box>

        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ alignItems: 'baseline', display: 'inline-flex', gap: 0.35, maxWidth: '100%' }}>
            <Typography
              ref={nameRef}
              sx={{
                color: theme.palette.text.primary,
                fontSize: mode === 'entry' ? '1rem' : '0.95rem',
                fontWeight: 700,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {displayName}
            </Typography>
            <IconButton
              ref={editButtonRef}
              sx={{
                color:
                  mode === 'entry'
                    ? alpha(theme.palette.text.secondary, 0.62)
                    : 'rgba(214,221,233,0.48)',
                ml: 0.1,
                p: 0.35,
              }}
              onClick={(event) => {
                event.stopPropagation();
                setEditingWalletIndex(isEdit ? null : idx);
              }}
            >
              <EditIcon sx={{ fontSize: 15 }} />
            </IconButton>
            {wallet?.note && (
              <Typography
                sx={{
                  color:
                    mode === 'entry'
                      ? alpha(theme.palette.text.secondary, 0.72)
                      : 'rgba(214,221,233,0.42)',
                  fontSize: '0.72rem',
                  fontStyle: 'italic',
                  fontWeight: 400,
                  lineHeight: 1,
                  maxWidth: { xs: 120, sm: 180 },
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {wallet.note}
              </Typography>
            )}
          </Box>
          <Typography
            ref={addressRef}
            sx={{
              color:
                mode === 'entry'
                  ? theme.palette.text.secondary
                  : 'rgba(214,221,233,0.56)',
              fontSize: mode === 'entry' ? '0.84rem' : '0.79rem',
              lineHeight: 1.35,
              mt: 0.05,
            }}
          >
            {addressLabel}
          </Typography>
        </Box>

        <Box onClick={(event) => event.stopPropagation()}>
          <AuthButton
            fullWidth={false}
            prominence="subtle"
            onClick={handleSelectWallet}
          >
            Unlock
          </AuthButton>
        </Box>
        {mode === 'entry' && (
          <ChevronRightRoundedIcon
            sx={{
              color:
                mode === 'entry'
                  ? alpha(theme.palette.text.secondary, 0.65)
                  : 'rgba(214,221,233,0.42)',
              fontSize: 24,
              opacity: 0.82,
            }}
          />
        )}
      </Box>

      {isEdit && (
        <Box
          ref={editPanelRef}
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
          {canEditAccountName && (
            <>
              <Typography sx={inlineFieldLabelSx}>Name</Typography>
              <Input
                autoFocus
                placeholder="Account name"
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleSaveEdit();
                  }
                }}
                inputProps={{ maxLength: 48 }}
                sx={inlineInputSx}
              />
            </>
          )}
          <Typography sx={inlineFieldLabelSx}>Note</Typography>
          <Input
            placeholder="Optional note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleSaveEdit();
              }
            }}
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
              onClick={handleSaveEdit}
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
