import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from 'react';
import {
  Avatar,
  Badge,
  Box,
  ButtonBase,
  IconButton,
  Input,
  InputAdornment,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useDropzone } from 'react-dropzone';
import { useTranslation } from 'react-i18next';
import EditIcon from '@mui/icons-material/Edit';
import PersonIcon from '@mui/icons-material/Person';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import VpnKeyRoundedIcon from '@mui/icons-material/VpnKeyRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import ClearRoundedIcon from '@mui/icons-material/ClearRounded';
import ManageSearchRoundedIcon from '@mui/icons-material/ManageSearchRounded';
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

/** Keeps Enter Qortal list height stable while filtering/scrolling */
const ENTRY_WALLET_SCROLL_HEIGHT_PX = 292;

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
  const { t } = useTranslation(['auth']);
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
  /** Insertion slot index in the wallet list — line appears before wallets[idx] when idx < length */
  const [walletDropGapBeforeIndex, setWalletDropGapBeforeIndex] = useState<
    number | null
  >(null);
  /** Row being dragged — dim original while reordering */
  const [walletReorderDragSourceIndex, setWalletReorderDragSourceIndex] =
    useState<number | null>(null);
  const [editingWalletIndex, setEditingWalletIndex] = useState<number | null>(
    null
  );
  const [primaryNamesByAddress, setPrimaryNamesByAddress] = useState<
    Record<string, string>
  >({});
  const [walletEntrySearchOpen, setWalletEntrySearchOpen] = useState(false);
  const [walletEntryFilterQuery, setWalletEntryFilterQuery] = useState('');
  const fetchingAddressesRef = useRef<Set<string>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const accountsScrollRef = useRef<HTMLDivElement | null>(null);
  /** True while reordering wallets; dragover hits header/footer/etc. unless we listen on document */
  const walletReorderDragActiveRef = useRef(false);
  const entryModeRef = useRef(mode);
  const editingWalletIndexRef = useRef(editingWalletIndex);
  entryModeRef.current = mode;
  editingWalletIndexRef.current = editingWalletIndex;
  const theme = useTheme();

  /** HTML5 drag: scroll only when cursor is above/below the list clip (header/footer overlap), never from inside */
  useEffect(() => {
    const onDocumentDragOver = (event: globalThis.DragEvent) => {
      if (!walletReorderDragActiveRef.current) return;
      if (entryModeRef.current !== 'entry' || editingWalletIndexRef.current !== null)
        return;
      const el = accountsScrollRef.current;
      if (!el || el.scrollHeight <= el.clientHeight) return;

      const rect = el.getBoundingClientRect();
      const x = event.clientX;
      const y = event.clientY;
      const horizontalPad = 80;
      if (x < rect.left - horizontalPad || x > rect.right + horizontalPad) return;

      /** Only past the clipped top/bottom — no scrolling from the interior of the list */
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      let delta = 0;

      if (el.scrollTop > 0 && y < rect.top) {
        const depthPx = rect.top - y;
        const t = Math.min(1, depthPx / 100);
        delta -= Math.round((8 + 28) * (0.25 + 0.75 * t));
      }
      if (el.scrollTop < maxScroll && y > rect.bottom) {
        const depthPx = y - rect.bottom;
        const t = Math.min(1, depthPx / 100);
        delta += Math.round((8 + 28) * (0.25 + 0.75 * t));
      }

      if (delta !== 0) {
        event.preventDefault();
        el.scrollTop = Math.min(maxScroll, Math.max(0, el.scrollTop + delta));
      }
    };

    document.addEventListener('dragover', onDocumentDragOver);
    return () => document.removeEventListener('dragover', onDocumentDragOver);
  }, []);

  const registerReorderDragActive = useCallback(
    (active: boolean) => {
      walletReorderDragActiveRef.current = active;
    },
    []
  );

  const handleWalletReorderDragStart = useCallback((sourceIdx: number) => {
    setWalletReorderDragSourceIndex(sourceIdx);
  }, []);

  const handleWalletReorderDragEnd = useCallback(() => {
    setWalletReorderDragSourceIndex(null);
    setWalletDropGapBeforeIndex(null);
  }, []);

  const handleWalletReorderHover = useCallback(
    (rowIdx: number, event: ReactDragEvent<HTMLElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const gapBeforeIdx =
        event.clientY < bounds.top + bounds.height / 2 ? rowIdx : rowIdx + 1;
      setWalletDropGapBeforeIndex(gapBeforeIdx);
    },
    []
  );

  const handleWalletReorderHoverLeave = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      const nextTarget = event.relatedTarget as Node | null;
      if (
        nextTarget instanceof Node &&
        event.currentTarget.contains(nextTarget)
      ) {
        return;
      }
      setWalletDropGapBeforeIndex(null);
    },
    []
  );

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

  useEffect(() => {
    if (wallets.length <= 8) {
      setWalletEntrySearchOpen(false);
      setWalletEntryFilterQuery('');
    }
  }, [wallets.length]);

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

  /** `gapBeforeIndex` is visual slot index in the pre-move ordering (0..wallets.length) */
  const finalizeWalletReorder = useCallback(
    (fromIndex: number, gapBeforeIndex: number) => {
      const n = wallets.length;
      if (
        !Number.isInteger(fromIndex) ||
        !Number.isInteger(gapBeforeIndex) ||
        fromIndex < 0 ||
        fromIndex >= n ||
        gapBeforeIndex < 0 ||
        gapBeforeIndex > n
      )
        return;

      const nextWallets = [...wallets];
      const [movedWallet] = nextWallets.splice(fromIndex, 1);
      const rawInsert =
        gapBeforeIndex > fromIndex ? gapBeforeIndex - 1 : gapBeforeIndex;
      const insertAt = Math.max(0, Math.min(rawInsert, nextWallets.length));
      nextWallets.splice(insertAt, 0, movedWallet);

      const unchanged =
        wallets.length === nextWallets.length &&
        wallets.every(
          (walletItem, walletIdx) =>
            walletItem?.address0 === nextWallets[walletIdx]?.address0
        );
      if (unchanged) return;

      void persistWallets(nextWallets).catch(console.error);
    },
    [persistWallets, wallets]
  );

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
            ? t('auth:entry.seed_import_duplicate')
            : t('auth:entry.seed_import_success')
        );
        if (!existsAlready) {
          setExtState('not-authenticated');
        }
      } else {
        setSeedError(t('auth:entry.seed_import_error'));
      }
    } catch (error: any) {
      setSeedError(error?.message || t('auth:entry.seed_import_error'));
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
            reader.onabort = () =>
              reject(new Error(t('auth:entry.import_file_read_aborted')));
            reader.onerror = () =>
              reject(new Error(t('auth:entry.import_file_read_failed')));
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
          ? t('auth:entry.import_backup_success', {
              count: uniqueNewWallets.length,
            })
          : t('auth:entry.import_backup_duplicate')
      );
      changeImportView('choice');
      if (uniqueNewWallets.length > 0) {
        setExtState('not-authenticated');
      }
    },
  });

  const displayedWallets = useMemo(() => {
    const base =
      editingWalletIndex === null
        ? wallets.map((wallet, idx) => ({ wallet, idx }))
        : wallets
            .map((wallet, idx) => ({ wallet, idx }))
            .filter(({ idx: rowIdx }) => rowIdx === editingWalletIndex);

    if (
      mode !== 'entry' ||
      editingWalletIndex !== null ||
      wallets.length <= 8
    ) {
      return base;
    }

    const q = walletEntryFilterQuery.trim().toLowerCase();
    if (!q) return base;

    return base.filter(({ wallet }) => {
      const address = String(wallet?.address0 || '').toLowerCase();
      const primary = String(
        wallet?.address0 ? primaryNamesByAddress[wallet.address0] || '' : ''
      ).toLowerCase();
      const name = String(wallet?.name || '').toLowerCase();
      const note = String(wallet?.note || '').toLowerCase();
      const fileLabel =
        wallet?.filename != null
          ? String(parsefilenameQortal(wallet.filename)).toLowerCase()
          : '';
      return (
        address.includes(q) ||
        primary.includes(q) ||
        name.includes(q) ||
        note.includes(q) ||
        fileLabel.includes(q)
      );
    });
  }, [
    editingWalletIndex,
    mode,
    primaryNamesByAddress,
    walletEntryFilterQuery,
    wallets,
  ]);

  if (isLoading) return null;

  const showsEntryWalletFilter =
    mode === 'entry' && editingWalletIndex === null && wallets.length > 8;

  const entryFilteredNoMatches =
    showsEntryWalletFilter &&
    walletEntryFilterQuery.trim().length > 0 &&
    displayedWallets.length === 0;

  const entryListFixedViewport =
    mode === 'entry' && editingWalletIndex === null;

  const accountsList = (
    <Box
      ref={accountsScrollRef}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: mode === 'entry' ? 1.4 : 0,
        ...(entryListFixedViewport
          ? {
              maxHeight: ENTRY_WALLET_SCROLL_HEIGHT_PX,
              minHeight: ENTRY_WALLET_SCROLL_HEIGHT_PX,
              overflowY: 'auto',
              pr: 0.35,
            }
          : {
              maxHeight: 'none',
              overflowY: 'visible',
              pr: 0,
            }),
        width: '100%',
      }}
    >
      {entryFilteredNoMatches ? (
        <Box
          sx={{
            alignItems: 'center',
            alignSelf: 'stretch',
            display: 'flex',
            flexGrow: 1,
            justifyContent: 'center',
            minHeight: 0,
            px: 1,
          }}
        >
          <Typography
            sx={{
              color: 'rgba(214,221,233,0.56)',
              fontSize: '0.9rem',
              lineHeight: 1.55,
              textAlign: 'center',
            }}
          >
            {t('auth:entry.filter_no_results')}
          </Typography>
        </Box>
      ) : (
        <>
          {displayedWallets.map(({ wallet, idx }) => (
        <Fragment key={wallet?.address0}>
          {walletDropGapBeforeIndex !== null &&
            walletReorderDragSourceIndex !== null &&
            walletDropGapBeforeIndex === idx && (
              <Box
                aria-hidden
                sx={{
                  alignSelf: 'stretch',
                  backgroundColor: theme.palette.primary.main,
                  borderRadius: '999px',
                  boxShadow:
                    theme.palette.mode === 'light'
                      ? `0 0 0 1px ${alpha(theme.palette.primary.dark, 0.12)}, 0 3px 16px ${alpha(theme.palette.primary.main, 0.38)}`
                      : `0 0 0 1px ${alpha(theme.palette.primary.light, 0.28)}, 0 0 20px ${alpha(theme.palette.primary.main, 0.45)}`,
                  flexShrink: 0,
                  height: mode === 'entry' ? 5 : 4,
                  mx: mode === 'entry' ? 0.85 : 0,
                }}
              />
            )}
          <WalletRow
            idx={idx}
            editingWalletIndex={editingWalletIndex}
            finalizeWalletReorder={finalizeWalletReorder}
            mode={mode}
            onReorderDragEnd={handleWalletReorderDragEnd}
            onReorderDragStart={handleWalletReorderDragStart}
            primaryName={
              wallet?.address0 ? primaryNamesByAddress[wallet.address0] : undefined
            }
            registerCardRef={registerCardRef}
            registerReorderDragActive={
              mode === 'entry' && editingWalletIndex === null
                ? registerReorderDragActive
                : undefined
            }
            reorderDragHover={handleWalletReorderHover}
            reorderDragHoverLeave={handleWalletReorderHoverLeave}
            reorderDragSourceIndex={walletReorderDragSourceIndex}
            setEditingWalletIndex={setEditingWalletIndex}
            setSelectedWallet={selectedWalletFunc}
            updateWalletItem={updateWalletItem}
            wallet={wallet}
          />
        </Fragment>
      ))}
      {walletDropGapBeforeIndex !== null &&
        walletReorderDragSourceIndex !== null &&
        walletDropGapBeforeIndex === wallets.length && (
          <Box
            aria-hidden
            sx={{
              alignSelf: 'stretch',
              backgroundColor: theme.palette.primary.main,
              borderRadius: '999px',
              boxShadow:
                theme.palette.mode === 'light'
                  ? `0 0 0 1px ${alpha(theme.palette.primary.dark, 0.12)}, 0 3px 16px ${alpha(theme.palette.primary.main, 0.38)}`
                  : `0 0 0 1px ${alpha(theme.palette.primary.light, 0.28)}, 0 0 20px ${alpha(theme.palette.primary.main, 0.45)}`,
              flexShrink: 0,
              height: mode === 'entry' ? 5 : 4,
              mx: mode === 'entry' ? 0.85 : 0,
            }}
          />
        )}
        </>
      )}
    </Box>
  );

  const entryAccountListColumn = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, width: '100%' }}>
      {showsEntryWalletFilter && (
        <Box sx={{ alignItems: 'center', display: 'flex', gap: 0.75, width: '100%' }}>
          <Tooltip placement="top" title={t('auth:entry.filter_accounts_aria')}>
            <IconButton
              aria-expanded={walletEntrySearchOpen}
              aria-label={t('auth:entry.filter_accounts_aria')}
              size="small"
              tabIndex={walletEntrySearchOpen ? 0 : -1}
              onClick={() => setWalletEntrySearchOpen((open) => !open)}
              sx={{
                '&:hover': {
                  backgroundColor: alpha(theme.palette.primary.main, 0.1),
                },
                border: `1px solid ${
                  walletEntrySearchOpen || walletEntryFilterQuery.trim()
                    ? alpha(theme.palette.primary.main, 0.45)
                    : alpha(theme.palette.text.primary, 0.12)
                }`,
                borderRadius: '9px',
                color: theme.palette.text.secondary,
                flexShrink: 0,
                height: 34,
                width: 34,
              }}
            >
              <Badge
                color="primary"
                invisible={!walletEntryFilterQuery.trim()}
                variant="dot"
              >
                <ManageSearchRoundedIcon sx={{ fontSize: 21 }} />
              </Badge>
            </IconButton>
          </Tooltip>
          {walletEntrySearchOpen && (
            <TextField
              autoFocus
              fullWidth
              placeholder={t('auth:entry.filter_placeholder')}
              size="small"
              value={walletEntryFilterQuery}
              variant="outlined"
              InputProps={{
                endAdornment: walletEntryFilterQuery ? (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={t('auth:entry.filter_clear')}
                      edge="end"
                      size="small"
                      sx={{ color: theme.palette.text.secondary }}
                      onClick={() => setWalletEntryFilterQuery('')}
                    >
                      <ClearRoundedIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </InputAdornment>
                ) : undefined,
              }}
              onChange={(e) => setWalletEntryFilterQuery(e.target.value)}
              sx={{
                '& .MuiOutlinedInput-root': {
                  backgroundColor: alpha(theme.palette.background.paper, 0.45),
                  borderRadius: '9px',
                  fontSize: '0.875rem',
                  minHeight: 36,
                },
                minWidth: 0,
              }}
            />
          )}
        </Box>
      )}
      {accountsList}
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
        {t('auth:entry.no_accounts')}
      </Typography>
    ) : (
      entryAccountListColumn
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
            description={t('auth:entry.import_choice_backup_description')}
            icon={<DescriptionRoundedIcon sx={{ fontSize: 22 }} />}
            onClick={() => changeImportView('backup')}
            title={t('auth:entry.import_choice_backup_title')}
          />
          <ChoiceRow
            description={t('auth:entry.import_choice_seed_description')}
            icon={<VpnKeyRoundedIcon sx={{ fontSize: 22 }} />}
            onClick={() => changeImportView('seedphrase')}
            title={t('auth:entry.import_choice_seed_title')}
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
              {t('auth:entry.import_backup_heading')}
            </Typography>
            <Typography
              sx={{
                color: 'rgba(214,221,233,0.56)',
                fontSize: '0.88rem',
                lineHeight: 1.6,
                maxWidth: 300,
              }}
            >
              {t('auth:entry.import_backup_drop_hint')}
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
            <AuthSectionLabel>
              {t('auth:entry.import_seed_label')}
            </AuthSectionLabel>
            <TextField
              fullWidth
              multiline
              minRows={4}
              value={seedValue}
              onChange={(event) => setSeedValue(event.target.value)}
              placeholder={t('auth:entry.import_seed_placeholder')}
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
            <AuthSectionLabel>
              {t('auth:entry.import_wallet_password')}
            </AuthSectionLabel>
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
            {isLoadingEncryptSeed
              ? t('auth:entry.importing_account')
              : t('auth:entry.import_account')}
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
  const { t } = useTranslation(['core']);

  return (
    <ButtonBase
      aria-label={t('core:action.back', {
        postProcess: 'capitalizeFirstChar',
      })}
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
  finalizeWalletReorder,
  registerReorderDragActive,
  reorderDragSourceIndex,
  reorderDragHover,
  reorderDragHoverLeave,
  onReorderDragStart,
  onReorderDragEnd,
  editingWalletIndex,
  mode,
  setEditingWalletIndex,
}) => {
  const { t } = useTranslation(['auth', 'core']);
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
    t('auth:authentication_form.unnamed_account');
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
        registerReorderDragActive?.(true);
        onReorderDragStart?.(idx);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(idx));
      }}
      onDragOver={(event) => {
        if (isEdit) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        reorderDragHover?.(idx, event);
      }}
      onDragLeave={(event) => {
        reorderDragHoverLeave?.(event);
      }}
      onDrop={(event) => {
        event.preventDefault();
        const fromIndex = Number(event.dataTransfer.getData('text/plain'));

        const bounds = (
          event.currentTarget as HTMLElement
        ).getBoundingClientRect();
        const gapBeforeIndex =
          event.clientY < bounds.top + bounds.height / 2 ? idx : idx + 1;

        if (Number.isInteger(fromIndex)) {
          finalizeWalletReorder(fromIndex, gapBeforeIndex);
        }
        onReorderDragEnd?.();
      }}
      onDragEnd={() => {
        registerReorderDragActive?.(false);
        onReorderDragEnd?.();
        window.setTimeout(() => {
          isDraggingRef.current = false;
        }, 0);
      }}
      sx={{
        borderBottom:
          mode === 'entry' ? 'none' : '1px solid rgba(255,255,255,0.06)',
        opacity:
          reorderDragSourceIndex !== null && reorderDragSourceIndex === idx ? 0.46 : 1,
        pb: mode === 'entry' ? 0 : isEdit ? 1.2 : 0,
        pt: mode === 'entry' ? 0 : 0.2,
        transition: 'opacity 160ms ease',
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
        <Box sx={{ width: mode === 'entry' ? 46 : 34 }}>
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
              aria-label={
                isEdit
                  ? t('core:action.close', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : t('auth:entry.wallet_edit_aria_label')
              }
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
            {t('auth:authentication_form.unlock')}
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
              <Typography sx={inlineFieldLabelSx}>
                {t('auth:entry.wallet_edit_name_label')}
              </Typography>
              <Input
                autoFocus
                placeholder={t(
                  'auth:entry.wallet_edit_account_name_placeholder'
                )}
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
          <Typography sx={inlineFieldLabelSx}>
            {t('auth:entry.wallet_edit_note_label')}
          </Typography>
          <Input
            placeholder={t('auth:entry.wallet_edit_note_placeholder')}
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
              {t('auth:entry.wallet_edit_remove')}
            </ButtonBase>
            <ButtonBase
              onClick={handleSaveEdit}
              sx={inlineActionSx(false)}
            >
              {t('auth:entry.wallet_edit_save')}
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
