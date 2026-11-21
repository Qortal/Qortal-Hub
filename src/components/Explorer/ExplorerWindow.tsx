/**
 * The Explorer window, in User search's place: App mounts it with the
 * same props, and every way into User search still opens it, through the
 * `openUserLookupDrawer` event ({ addressOrName }). Sent while the window
 * is open, the event opens that account in it as one more step of the
 * trail; it never opens a second window.
 *
 * The window keeps what it read (its own cache) until it closes or Hub's
 * signed-in account changes; then it starts again from its start page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Dialog,
  Divider,
  FormControlLabel,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CloseFullscreenRoundedIcon from '@mui/icons-material/CloseFullscreenRounded';
import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import TravelExploreRoundedIcon from '@mui/icons-material/TravelExploreRounded';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { userInfoAtom } from '../../atoms/global';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { createExplorerCache } from '../../lib/explorer/cache';
import {
  addRecent,
  clearRecent,
  readRecent,
  readRemember,
  writeRemember,
} from '../../lib/explorer/recent';
import { isQortAddress } from '../../lib/explorer/addresses';
import { nextTrail } from '../../lib/explorer/rules';
import type { NameMatch } from './AccountHeader';
import { ExplorerAccount } from './ExplorerAccount';
import {
  ExplorerContext,
  type ExplorerContextValue,
  type OpenAccountOptions,
} from './ExplorerContext';
import { ExplorerSearchField } from './ExplorerSearchField';
import { ExplorerStart } from './ExplorerStart';
import { cap, mutedText } from './parts';

type View =
  | { kind: 'start' }
  | {
      kind: 'account';
      who: string;
      fromExplorer: boolean;
      openedBy: NameMatch | null;
      /** The trail on screen when it was opened. */
      trailBefore: string[];
      /** Its own trail, once the account is known: Back shows it as it was. */
      trail: string[] | null;
    };

interface History {
  views: View[];
  index: number;
}

const START: History = { views: [{ kind: 'start' }], index: 0 };

/**
 * Hub's body2 is larger than its body text, and its buttons are in capitals:
 * in the Explorer, secondary lines are smaller and buttons read as written.
 */
const SMALL_TEXT = {
  '& .MuiTypography-body2': { fontSize: '0.875rem', lineHeight: 1.45 },
  '& .MuiButton-root': { textTransform: 'none' },
} as const;
/** The most steps Back can go. */
const HISTORY_MAX = 50;

export interface ExplorerWindowProps {
  isOpenDrawerLookup: boolean;
  setIsOpenDrawerLookup: (open: boolean) => void;
}

export function ExplorerWindow({
  isOpenDrawerLookup,
  setIsOpenDrawerLookup,
}: ExplorerWindowProps) {
  const { t } = useTranslation(['core', 'explorer']);
  const userInfo = useAtomValue(userInfoAtom);
  const viewer =
    typeof userInfo?.address === 'string' && isQortAddress(userInfo.address)
      ? userInfo.address
      : null;

  const [cache, setCache] = useState(() => createExplorerCache());
  const [version, setVersion] = useState(0);
  const [history, setHistory] = useState<History>(START);
  const [recent, setRecent] = useState<string[]>(() => readRecent(viewer));
  const [remember, setRemember] = useState(() => readRemember(viewer));
  const [full, setFull] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const view = history.views[history.index] ?? START.views[0];

  /** Start again: nothing read, nothing on the trail, the start page. */
  const reset = useCallback(() => {
    setCache(createExplorerCache());
    setHistory(START);
    setMenuAnchor(null);
  }, []);

  // Another Hub account: its own recent list, and nothing left from the last one.
  const viewerRef = useRef(viewer);
  useEffect(() => {
    if (viewerRef.current === viewer) return;
    viewerRef.current = viewer;
    reset();
    setRecent(readRecent(viewer));
    setRemember(readRemember(viewer));
  }, [viewer, reset]);

  const close = useCallback(() => {
    setIsOpenDrawerLookup(false);
  }, [setIsOpenDrawerLookup]);

  const openAccount = useCallback(
    (who: string, options: OpenAccountOptions = {}) => {
      const trimmed = who.trim();
      if (!trimmed) return;
      setMenuAnchor(null);
      setHistory((current) => {
        const here = current.views[current.index];
        // Already on screen: not a step more.
        if (here?.kind === 'account' && here.who === trimmed) return current;
        const next: View = {
          kind: 'account',
          who: trimmed,
          fromExplorer: Boolean(options.fromExplorer),
          openedBy: null,
          trailBefore: here?.kind === 'account' ? (here.trail ?? []) : [],
          trail: null,
        };
        const views = [
          ...current.views.slice(0, current.index + 1),
          next,
        ].slice(-HISTORY_MAX);
        return { views, index: views.length - 1 };
      });
    },
    []
  );

  // A name, now known: show its owner's address in its place (not a new step).
  const onNameResolved = useCallback((owner: string, match: NameMatch) => {
    setHistory((current) => {
      const here = current.views[current.index];
      if (here?.kind !== 'account' || here.who !== match.typed) return current;
      const views = [...current.views];
      views[current.index] = { ...here, who: owner, openedBy: match };
      return { ...current, views };
    });
  }, []);

  // An account on screen: its step gets its trail (once), and Recent explorations take it.
  const onShown = useCallback(
    (address: string) => {
      setHistory((current) => {
        const here = current.views[current.index];
        if (here?.kind !== 'account' || here.who !== address || here.trail)
          return current;
        const views = [...current.views];
        views[current.index] = {
          ...here,
          trail: nextTrail(here.trailBefore, address, here.fromExplorer),
        };
        return { ...current, views };
      });
      if (viewer) setRecent(addRecent(viewer, address));
    },
    [viewer]
  );

  const refresh = useCallback(
    (address: string) => {
      cache.forget(
        (key) =>
          key.endsWith(`:${address}`) ||
          key === 'online' ||
          key === 'nodetiming'
      );
      setVersion((n) => n + 1);
    },
    [cache]
  );

  // Every way into User search: open the window, or a step more in it.
  const openRef = useRef(isOpenDrawerLookup);
  openRef.current = isOpenDrawerLookup;
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const who =
        typeof detail?.addressOrName === 'string'
          ? detail.addressOrName.trim()
          : '';
      const alreadyOpen = openRef.current;
      if (!alreadyOpen) {
        // A second event before the window has opened is a step more in it.
        openRef.current = true;
        setIsOpenDrawerLookup(true);
      }
      if (who) openAccount(who, { fromExplorer: alreadyOpen });
    };
    subscribeToEvent('openUserLookupDrawer', onOpen);
    return () => unsubscribeFromEvent('openUserLookupDrawer', onOpen);
  }, [openAccount, setIsOpenDrawerLookup]);

  const context = useMemo<ExplorerContextValue>(
    () => ({ cache, version, viewer, openAccount, refresh, close }),
    [cache, version, viewer, openAccount, refresh, close]
  );

  const canBack = history.index > 0;
  const canForward = history.index < history.views.length - 1;
  const goTo = (index: number) =>
    setHistory((current) => ({ ...current, index }));

  const toggleRemember = (on: boolean) => {
    if (!viewer) return;
    writeRemember(viewer, on);
    setRemember(readRemember(viewer));
    setRecent(readRecent(viewer));
  };
  const forgetRecent = () => {
    if (!viewer) return;
    clearRecent(viewer);
    setRecent([]);
    setMenuAnchor(null);
  };

  const accountAddress =
    view.kind === 'account' && isQortAddress(view.who) ? view.who : null;

  return (
    <Dialog
      open={isOpenDrawerLookup}
      onClose={close}
      fullScreen={full}
      fullWidth
      maxWidth={false}
      aria-labelledby="explorer-window-title"
      slotProps={{
        // Closed from anywhere (here, or Hub's own toggle): start again next
        // time, once it has faded out, so the closing window never turns into
        // the start page (or reads for it) on its way out.
        transition: { onExited: reset },
        backdrop: {
          sx: (theme) => ({
            backdropFilter: 'blur(12px)',
            backgroundColor: alpha(theme.palette.common.black, 0.6),
          }),
        },
        paper: {
          sx: (theme) => ({
            backgroundColor: theme.palette.background.default,
            backgroundImage: 'none',
            ...(full
              ? {}
              : {
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: '16px',
                  height: {
                    xs: 'calc(100vh - 32px)',
                    md: 'min(84vh, 900px)',
                  },
                  margin: { xs: 2, md: 3 },
                  maxHeight: 'calc(100vh - 24px)',
                  width: 'min(1140px, calc(100vw - 48px))',
                }),
            overflow: 'hidden',
          }),
        },
      }}
    >
      <ExplorerContext.Provider value={context}>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
            ...SMALL_TEXT,
          }}
        >
          <Box
            sx={(theme) => ({
              alignItems: 'center',
              borderBottom: `1px solid ${theme.palette.divider}`,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1,
              px: { xs: 1.5, md: 2.5 },
              py: 1,
            })}
          >
            <Box sx={{ alignItems: 'center', display: 'flex', gap: 0.25 }}>
              <IconButton
                size="small"
                aria-label={t('core:action.back', cap)}
                disabled={!canBack}
                onClick={() => goTo(history.index - 1)}
              >
                <ArrowBackRoundedIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                aria-label={t('explorer:window.forward', cap)}
                disabled={!canForward}
                onClick={() => goTo(history.index + 1)}
              >
                <ArrowForwardRoundedIcon fontSize="small" />
              </IconButton>
            </Box>
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                gap: 1,
                minWidth: 0,
              }}
            >
              <TravelExploreRoundedIcon
                aria-hidden
                sx={(theme) => ({
                  color: theme.palette.primary.main,
                  fontSize: '1.2rem',
                })}
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  id="explorer-window-title"
                  component="h1"
                  sx={{ fontSize: '1rem', fontWeight: 700, lineHeight: 1.2 }}
                >
                  {t('core:account_lookup.dialog_title', cap)}
                </Typography>
                {view.kind === 'start' ? (
                  <Typography
                    variant="body2"
                    sx={(theme) => ({
                      color: mutedText(theme),
                      lineHeight: 1.3,
                    })}
                  >
                    {t('explorer:window.subtitle', cap)}
                  </Typography>
                ) : null}
              </Box>
            </Box>
            {/* Never narrower than its content: the bar wraps rather than overlap the title. */}
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flex: 1,
                gap: 0.5,
                justifyContent: 'flex-end',
              }}
            >
              {view.kind === 'account' ? (
                <Box sx={{ flex: 1, maxWidth: 320, minWidth: 140 }}>
                  <ExplorerSearchField
                    compact
                    onLookUp={(who) => openAccount(who)}
                  />
                </Box>
              ) : null}
              {accountAddress ? (
                <Tooltip title={t('core:action.refresh', cap)}>
                  <IconButton
                    size="small"
                    aria-label={t('core:action.refresh', cap)}
                    onClick={() => refresh(accountAddress)}
                  >
                    <RefreshRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : null}
              {viewer ? (
                <Tooltip title={t('explorer:settings.title', cap)}>
                  <IconButton
                    size="small"
                    aria-label={t('explorer:settings.title', cap)}
                    aria-haspopup="true"
                    aria-expanded={menuAnchor ? 'true' : undefined}
                    onClick={(event) => setMenuAnchor(event.currentTarget)}
                  >
                    <SettingsRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : null}
              <Tooltip
                title={
                  full
                    ? t('explorer:window.leave_full', cap)
                    : t('explorer:window.full', cap)
                }
              >
                <IconButton
                  size="small"
                  aria-label={
                    full
                      ? t('explorer:window.leave_full', cap)
                      : t('explorer:window.full', cap)
                  }
                  aria-pressed={full}
                  onClick={() => setFull((on) => !on)}
                >
                  {full ? (
                    <CloseFullscreenRoundedIcon fontSize="small" />
                  ) : (
                    <OpenInFullRoundedIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
              <Tooltip title={t('core:action.close', cap)}>
                <IconButton
                  size="small"
                  aria-label={t('core:action.close', cap)}
                  onClick={close}
                >
                  <CloseRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              px: { xs: 1.5, sm: 2.5, md: 3.5 },
              py: { xs: 2, md: 3 },
            }}
          >
            <Box sx={{ margin: '0 auto', maxWidth: 1080, minWidth: 0 }}>
              {view.kind === 'start' ? (
                <ExplorerStart recent={recent} onClearRecent={forgetRecent} />
              ) : (
                <ExplorerAccount
                  key={view.who}
                  who={view.who}
                  openedBy={view.openedBy}
                  trail={view.trail ?? []}
                  onNameResolved={onNameResolved}
                  onShown={onShown}
                />
              )}
            </Box>
          </Box>
        </Box>

        <Menu
          anchorEl={menuAnchor}
          open={Boolean(menuAnchor)}
          onClose={() => setMenuAnchor(null)}
          slotProps={{ paper: { sx: SMALL_TEXT } }}
        >
          <Box sx={{ maxWidth: 340, px: 2, py: 1 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={remember}
                  onChange={(event) => toggleRemember(event.target.checked)}
                />
              }
              label={t('explorer:settings.remember', cap)}
            />
            <Typography
              variant="body2"
              sx={(theme) => ({ color: mutedText(theme), mt: 0.5 })}
            >
              {t('explorer:settings.remember_hint', cap)}
            </Typography>
          </Box>
          <Divider />
          <MenuItem disabled={!recent.length} onClick={forgetRecent}>
            <ListItemText>{t('explorer:start.clear_recent', cap)}</ListItemText>
          </MenuItem>
        </Menu>
      </ExplorerContext.Provider>
    </Dialog>
  );
}
