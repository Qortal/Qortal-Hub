import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import HubRoundedIcon from '@mui/icons-material/HubRounded';
import StorageRoundedIcon from '@mui/icons-material/StorageRounded';
import { useTranslation } from 'react-i18next';
import {
  ActionButton,
  ActionNote,
  ConfirmActionDialog,
  useFailureText,
  useLastShown,
  useNodeActions,
} from './NodeActionParts';
import { CardText, OverviewCard, ReadNote } from './OverviewParts';
import {
  quietButtonSx,
  sectionLabelSx,
  textButtonSx,
  windowBackdropSx,
  windowPaperSx,
  windowSurfaceColor,
} from './nodeManagerLook';
import { parsePeerAddress } from './nodeAdmin';
import {
  formatCount,
  formatDuration,
  type ConnectedPeer,
} from './nodeOverview';
import { getNodeJson, useNodeRead } from './useNodeOverviewData';

type PeerRow = ConnectedPeer & {
  address?: string;
  connectedWhen?: number;
};

/** A force sync keeps syncing until the node is level: minutes, not seconds. */
export const FORCE_SYNC_TIMEOUT_MS = 10 * 60_000;

/** Core's sync results that have words of their own. */
const SYNC_RESULTS = new Set([
  'NOTHING_TO_DO',
  'NO_COMMON_BLOCK',
  'TOO_DIVERGENT',
  'NO_REPLY',
  'INFERIOR_CHAIN',
  'NO_BLOCKCHAIN_LOCK',
  'SHUTTING_DOWN',
  'CHAIN_TIP_TOO_OLD',
]);

const DASH = '—';

type Pending =
  | { kind: 'remove' | 'remove_data' | 'force_sync'; address: string }
  | { kind: 'forget_all' };

const readList =
  (path: string) =>
  async (base: string, signal: AbortSignal): Promise<PeerRow[]> => {
    const list = await getNodeJson<unknown>(base, path, signal);
    if (!Array.isArray(list)) throw new Error('Not a list');
    return list as PeerRow[];
  };

export const PeersSection = ({
  active = true,
  isPublic,
  nodeBase,
}: {
  /** False while another section is shown: nothing is read meanwhile. */
  active?: boolean;
  isPublic: boolean;
  nodeBase: string;
}) => {
  const theme = useTheme();
  const { i18n, t } = useTranslation(['node', 'core']);
  const language = i18n.language;
  const capitalize = { postProcess: 'capitalizeFirstChar' } as const;
  const failureText = useFailureText();
  const peers = useNodeRead<PeerRow[]>(
    nodeBase,
    active ? readList('/peers') : null,
    15_000
  );
  const dataPeers = useNodeRead<PeerRow[]>(
    nodeBase,
    active ? readList('/peers/data') : null,
    30_000
  );
  const known = useNodeRead<number>(
    nodeBase,
    isPublic || !active
      ? null
      : async (base, signal) =>
          (await readList('/peers/known')(base, signal)).length,
    0
  );
  const { clear, run, states } = useNodeActions(nodeBase);
  const [pending, setPending] = useState<Pending | null>(null);
  const [adding, setAdding] = useState<'peer' | 'data' | null>(null);
  const [note, setNote] = useState<{
    text: string;
    tone: 'info' | 'error' | 'success';
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const tell = (text: string, tone: 'info' | 'error' | 'success') =>
    setNote({ text, tone });

  const confirmPending = async () => {
    const action = pending;
    setPending(null);
    if (!action) return;
    if (action.kind === 'forget_all') {
      const result = await run('forget_all', '/peers/known', {
        method: 'DELETE',
      });
      if (result.status === 'done') {
        tell(t('node:manager.peers.forgot_all'), 'success');
        // Core drops its connections with them.
        peers.retry();
        known.retry();
      } else if (result.status === 'failed') {
        tell(failureText(result.reason), 'error');
      }
      return;
    }
    const { address, kind } = action;
    if (kind === 'force_sync') {
      tell(t('node:manager.peers.syncing', { address }), 'info');
      const result = await run(`sync:${address}`, '/admin/forcesync', {
        body: address,
        method: 'POST',
        timeoutMs: FORCE_SYNC_TIMEOUT_MS,
      });
      if (result.status === 'done') {
        const code = result.answer.toUpperCase();
        tell(
          SYNC_RESULTS.has(code)
            ? t(`node:manager.peers.sync.${code.toLowerCase()}`)
            : t('node:manager.peers.sync.other', { result: result.answer }),
          code === 'NOTHING_TO_DO' ? 'success' : 'info'
        );
        peers.retry();
      } else if (result.status === 'failed') {
        // Core answers INVALID_DATA when the peer is no longer connected.
        tell(
          result.reason === 'invalid'
            ? t('node:manager.peers.sync.not_connected')
            : failureText(result.reason),
          'error'
        );
        peers.retry();
      }
      return;
    }
    const data = kind === 'remove_data';
    const result = await run(
      `${kind}:${address}`,
      data ? '/peers/data' : '/peers',
      { body: address, method: 'DELETE' }
    );
    if (result.status === 'done') {
      // Core disconnects the peer either way; "false" only means it wasn't
      // on the known list (an inbound peer's port, say).
      tell(t('node:manager.peers.removed', { address }), 'success');
      if (data) {
        dataPeers.retry();
      } else {
        peers.retry();
        known.retry();
      }
    } else if (result.status === 'failed') {
      tell(failureText(result.reason), 'error');
    }
  };

  const addPeer = async (address: string, data: boolean) => {
    const result = await run(
      data ? 'add_data' : 'add',
      data ? '/peers/data' : '/peers',
      { body: address, method: 'POST' }
    );
    if (result.status === 'done') {
      setAdding(null);
      const added = result.answer === 'true';
      // A data peer is "false" when the node knew it and couldn't connect.
      tell(
        data
          ? added
            ? t('node:manager.peers.added_data', { address })
            : t('node:manager.peers.data_not_connected', { address })
          : added
            ? t('node:manager.peers.added', { address })
            : t('node:manager.peers.already_known', { address }),
        data && !added ? 'info' : 'success'
      );
      if (data) {
        dataPeers.retry();
      } else {
        peers.retry();
        known.retry();
      }
    }
    return result;
  };

  const busy = (id: string) => states[id]?.status === 'running';
  const shownPending = useLastShown(pending);
  const addId = adding === 'data' ? 'add_data' : 'add';
  const addState = adding ? states[addId] : undefined;
  const headSx = {
    ...sectionLabelSx(theme),
    backgroundColor: windowSurfaceColor(theme),
    borderColor: alpha(theme.palette.divider, 0.14),
    display: 'table-cell',
    px: 1,
    py: 0.9,
    whiteSpace: 'nowrap',
  } as const;
  const cellSx = {
    borderColor: alpha(theme.palette.divider, 0.14),
    color: theme.palette.text.primary,
    fontSize: '0.84rem',
    fontVariantNumeric: 'tabular-nums',
    px: 1,
    py: 0.6,
  } as const;
  const age = (peer: PeerRow) =>
    typeof peer.connectedWhen === 'number'
      ? formatDuration(Math.max(0, now - peer.connectedWhen), language)
      : DASH;
  const direction = (peer: PeerRow) =>
    peer.direction === 'INBOUND'
      ? t('node:manager.peers.in')
      : peer.direction === 'OUTBOUND'
        ? t('node:manager.peers.out')
        : DASH;
  const version = (peer: PeerRow) =>
    typeof peer.version === 'string'
      ? peer.version.replace(/^qortal-/, '').replace(/-.*$/, '')
      : DASH;

  const sortedPeers = useMemo(
    () =>
      [...(peers.value ?? [])].sort(
        (a, b) => (b.lastHeight ?? -1) - (a.lastHeight ?? -1)
      ),
    [peers.value]
  );

  const table = (
    rows: PeerRow[],
    columns: { label: string; render: (peer: PeerRow) => ReactNode }[],
    actions: (peer: PeerRow) => ReactNode
  ) => (
    <Box sx={{ maxHeight: 380, overflow: 'auto' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {columns.map(({ label }) => (
              <TableCell key={label} sx={headSx}>
                {label}
              </TableCell>
            ))}
            {isPublic ? null : (
              <TableCell align="right" sx={headSx}>
                {t('node:manager.peers.col_actions', capitalize)}
              </TableCell>
            )}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((peer, index) => (
            <TableRow
              data-peer={peer.address ?? index}
              key={peer.address ?? index}
            >
              {columns.map(({ label, render }) => (
                <TableCell key={label} sx={cellSx}>
                  {render(peer)}
                </TableCell>
              ))}
              {isPublic ? null : (
                <TableCell
                  align="right"
                  sx={{ ...cellSx, whiteSpace: 'nowrap' }}
                >
                  {actions(peer)}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {isPublic ? (
        <CardText>{t('node:manager.peers.public_readonly')}</CardText>
      ) : null}
      {note ? <ActionNote tone={note.tone}>{note.text}</ActionNote> : null}

      <OverviewCard
        action={
          isPublic ? null : (
            <Button
              onClick={() => setAdding('peer')}
              size="small"
              startIcon={<AddRoundedIcon />}
              sx={quietButtonSx(theme)}
              variant="outlined"
            >
              {t('node:manager.peers.add', capitalize)}
            </Button>
          )
        }
        icon={<HubRoundedIcon />}
        id="peer_list"
        title={t('node:manager.peers.title', capitalize)}
        wide
      >
        {peers.value && peers.value.length === 0 ? (
          <CardText>{t('node:manager.peers.none')}</CardText>
        ) : peers.value ? (
          table(
            sortedPeers,
            [
              {
                label: t('node:manager.peers.col_address', capitalize),
                render: (peer) => peer.address ?? DASH,
              },
              {
                label: t('node:manager.peers.col_direction', capitalize),
                render: direction,
              },
              {
                label: t('node:manager.blocks.height', capitalize),
                render: (peer) =>
                  peer.handshakeStatus !== 'COMPLETED'
                    ? t('node:manager.peers.connecting')
                    : typeof peer.lastHeight === 'number'
                      ? formatCount(peer.lastHeight, language)
                      : DASH,
              },
              {
                label: t('node:manager.peers.col_version', capitalize),
                render: version,
              },
              {
                label: t('node:manager.peers.col_ping', capitalize),
                render: (peer) =>
                  typeof peer.lastPing === 'number'
                    ? formatCount(peer.lastPing, language)
                    : DASH,
              },
              {
                label: t('node:manager.peers.col_connected', capitalize),
                render: age,
              },
            ],
            (peer) =>
              peer.address ? (
                <Box sx={{ display: 'inline-flex', gap: 0.5 }}>
                  <ActionButton
                    busy={busy(`sync:${peer.address}`)}
                    disabled={peer.handshakeStatus !== 'COMPLETED'}
                    onClick={() =>
                      setPending({ address: peer.address, kind: 'force_sync' })
                    }
                    variant="text"
                  >
                    {t('node:manager.peers.force_sync', capitalize)}
                  </ActionButton>
                  <ActionButton
                    busy={busy(`remove:${peer.address}`)}
                    color="error"
                    onClick={() =>
                      setPending({ address: peer.address, kind: 'remove' })
                    }
                    variant="text"
                  >
                    {t('core:action.remove', capitalize)}
                  </ActionButton>
                </Box>
              ) : null
          )
        ) : null}
        <ReadNote read={peers} />
      </OverviewCard>

      <OverviewCard
        action={
          isPublic ? null : (
            <Button
              onClick={() => setAdding('data')}
              size="small"
              startIcon={<AddRoundedIcon />}
              sx={quietButtonSx(theme)}
              variant="outlined"
            >
              {t('node:manager.peers.add_data', capitalize)}
            </Button>
          )
        }
        icon={<StorageRoundedIcon />}
        id="data_peer_list"
        title={t('node:manager.data_peers.title')}
        wide
      >
        {dataPeers.value && dataPeers.value.length === 0 ? (
          <CardText>{t('node:manager.help.data_peers_todo')}</CardText>
        ) : dataPeers.value ? (
          table(
            dataPeers.value,
            [
              {
                label: t('node:manager.peers.col_address', capitalize),
                render: (peer) => peer.address ?? DASH,
              },
              {
                label: t('node:manager.peers.col_direction', capitalize),
                render: direction,
              },
              {
                label: t('node:manager.peers.col_version', capitalize),
                render: version,
              },
              {
                label: t('node:manager.peers.col_connected', capitalize),
                render: age,
              },
            ],
            (peer) =>
              peer.address ? (
                <ActionButton
                  busy={busy(`remove_data:${peer.address}`)}
                  color="error"
                  onClick={() =>
                    setPending({ address: peer.address, kind: 'remove_data' })
                  }
                  variant="text"
                >
                  {t('core:action.remove', capitalize)}
                </ActionButton>
              ) : null
          )
        ) : null}
        <ReadNote read={dataPeers} />
      </OverviewCard>

      {isPublic ? null : (
        <OverviewCard
          id="known_peers"
          title={t('node:manager.peers.known_title', capitalize)}
          wide
        >
          <CardText>
            {t('node:manager.peers.known_body', {
              known:
                known.value === null
                  ? DASH
                  : formatCount(known.value, language),
            })}
          </CardText>
          <Box>
            <ActionButton
              busy={busy('forget_all')}
              color="error"
              onClick={() => setPending({ kind: 'forget_all' })}
              variant="contained"
            >
              {t('node:manager.peers.forget_all', capitalize)}
            </ActionButton>
          </Box>
        </OverviewCard>
      )}

      <AddPeerDialog
        busy={busy(addId)}
        error={
          addState?.status === 'failed' ? failureText(addState.reason) : null
        }
        kind={adding}
        onAdd={(address) => addPeer(address, adding === 'data')}
        onClose={() => {
          if (adding) clear(addId);
          setAdding(null);
        }}
        onEdit={() => {
          if (addState?.status === 'failed') clear(addId);
        }}
      />

      <ConfirmActionDialog
        body={
          shownPending?.kind === 'force_sync'
            ? t('node:manager.peers.force_sync_body')
            : shownPending?.kind === 'forget_all'
              ? t('node:manager.peers.forget_all_body')
              : t('node:manager.peers.remove_body')
        }
        confirmLabel={
          shownPending?.kind === 'force_sync'
            ? t('node:manager.peers.force_sync', capitalize)
            : shownPending?.kind === 'forget_all'
              ? t('node:manager.peers.forget_all', capitalize)
              : t('core:action.remove', capitalize)
        }
        danger
        onCancel={() => setPending(null)}
        onConfirm={() => void confirmPending()}
        open={pending !== null}
        title={
          shownPending?.kind === 'force_sync'
            ? t('node:manager.peers.force_sync_title', {
                address: shownPending.address,
              })
            : shownPending?.kind === 'forget_all'
              ? t('node:manager.peers.forget_all_title')
              : shownPending
                ? t('node:manager.peers.remove_title', {
                    address: shownPending.address,
                  })
                : ''
        }
      />
    </Box>
  );
};

/** The address field for a new peer or QDN data peer, checked as typed. */
const AddPeerDialog = ({
  busy,
  error,
  kind,
  onAdd,
  onClose,
  onEdit,
}: {
  busy: boolean;
  error: string | null;
  kind: 'peer' | 'data' | null;
  onAdd: (address: string) => Promise<unknown>;
  onClose: () => void;
  /** The address changed: an earlier refusal no longer applies. */
  onEdit: () => void;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['node', 'core']);
  const capitalize = { postProcess: 'capitalizeFirstChar' } as const;
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!kind) {
      setValue('');
      setTouched(false);
    }
  }, [kind]);
  const shownKind = useLastShown(kind);
  const address = parsePeerAddress(value);
  const showInvalid = touched && value.trim() !== '' && !address;
  // While the node works on an add, the dialog stays as it is: the answer
  // belongs to the address shown.
  const close = () => {
    if (!busy) onClose();
  };
  const submit = () => {
    setTouched(true);
    if (address && !busy) void onAdd(address);
  };
  return (
    <Dialog
      aria-labelledby="node-manager-add-peer-title"
      BackdropProps={{ sx: windowBackdropSx }}
      onClose={close}
      open={kind !== null}
      PaperProps={{
        sx: { ...windowPaperSx(theme), maxWidth: 480, width: '100%' },
      }}
    >
      <DialogTitle
        id="node-manager-add-peer-title"
        sx={{ fontSize: '1.05rem', fontWeight: 800, letterSpacing: '-0.02em' }}
      >
        {shownKind === 'data'
          ? t('node:manager.peers.add_data_title')
          : t('node:manager.peers.add_title')}
      </DialogTitle>
      <DialogContent>
        <Typography
          sx={{
            color: theme.palette.text.secondary,
            fontSize: '0.9rem',
            mb: 2,
          }}
        >
          {shownKind === 'data'
            ? t('node:manager.peers.add_data_intro')
            : t('node:manager.peers.add_intro')}
        </Typography>
        <TextField
          autoFocus
          disabled={busy}
          error={showInvalid || !!error}
          fullWidth
          helperText={
            showInvalid ? t('node:manager.peers.address_invalid') : error || ' '
          }
          label={t('node:manager.peers.col_address', capitalize)}
          onBlur={() => setTouched(true)}
          onChange={(event) => {
            setValue(event.target.value);
            onEdit();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
          size="small"
          value={value}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          disabled={busy}
          onClick={close}
          sx={textButtonSx}
          variant="text"
        >
          {t('core:action.cancel', capitalize)}
        </Button>
        <ActionButton
          busy={busy}
          disabled={!address}
          onClick={submit}
          variant="contained"
        >
          {t('core:action.add', capitalize)}
        </ActionButton>
      </DialogActions>
    </Dialog>
  );
};
