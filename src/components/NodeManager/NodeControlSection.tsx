import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Button, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import PowerSettingsNewRoundedIcon from '@mui/icons-material/PowerSettingsNewRounded';
import CloudDownloadRoundedIcon from '@mui/icons-material/CloudDownloadRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import ArticleRoundedIcon from '@mui/icons-material/ArticleRounded';
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { nodeInfosAtom } from '../../atoms/global';
import { isLocalNodeUrl } from '../../constants/constants';
import { manifestData } from '../NotAuthenticated';
import {
  ActionButton,
  ActionNote,
  ConfirmActionDialog,
  useFailureText,
  useLastShown,
  useNodeActions,
} from './NodeActionParts';
import { CardText, OverviewCard } from './OverviewParts';
import { quietButtonSx, textButtonSx } from './nodeManagerLook';
import { formatBytes, formatCount, formatDuration } from './nodeOverview';
import {
  getNodeJson,
  getNodeText,
  READ_TIMEOUT_MS,
  useNodeRead,
  type AdminInfo,
  type SystemInfo,
} from './useNodeOverviewData';

type NodeStatus = {
  height?: number;
  isMintingPossible?: boolean;
  isSynchronizing?: boolean;
  numberOfConnections?: number;
  numberOfDataConnections?: number;
  syncPercent?: number;
};

/** How many of the newest log lines the window shows (Core allows 500). */
export const LOG_LINES = 200;

/** How long "Start Core" waits for the node to answer before saying so. */
export const START_WAIT_MS = 120_000;

type NodeChange = 'restart' | 'stop' | 'bootstrap';

const NODE_CHANGES: Record<NodeChange, { path: string; danger: boolean }> = {
  bootstrap: { danger: true, path: '/admin/bootstrap' },
  restart: { danger: false, path: '/admin/restart' },
  stop: { danger: true, path: '/admin/stop' },
};

const coreSetup = () =>
  typeof window !== 'undefined' ? window.coreSetup : undefined;

/** While the node doesn't answer, how often Hub looks for Core on this PC. */
export const CORE_CHECK_MS = 10_000;

const NOTHING_DONE: Record<NodeChange, boolean> = {
  bootstrap: false,
  restart: false,
  stop: false,
};

/**
 * Whether Hub can start Core on this PC: `stopped` when Core is where Hub
 * installs it and its process is gone, `running` while its process still
 * runs (shutting down, say: a start then does nothing), `elsewhere` when
 * Core isn't where Hub looks.
 */
const useCoreOnThisPc = (enabled: boolean) => {
  const [state, setState] = useState<
    'unknown' | 'running' | 'stopped' | 'elsewhere'
  >('unknown');
  useEffect(() => {
    if (!enabled) {
      setState('unknown');
      return;
    }
    let alive = true;
    const check = async () => {
      const setup = coreSetup();
      try {
        const installed = setup?.isCoreInstalledOnSystem
          ? await setup.isCoreInstalledOnSystem()
          : true;
        const running = setup?.isCoreRunningOnSystem
          ? await setup.isCoreRunningOnSystem()
          : false;
        if (alive)
          setState(
            installed === false ? 'elsewhere' : running ? 'running' : 'stopped'
          );
      } catch {
        // Can't tell: Hub's own start still checks before it starts.
        if (alive) setState('stopped');
      }
    };
    void check();
    const timer = setInterval(() => void check(), CORE_CHECK_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [enabled]);
  return state;
};

export const NodeControlSection = ({
  active = true,
  nodeBase,
}: {
  /** False while another section is shown: nothing is read meanwhile. */
  active?: boolean;
  nodeBase: string;
}) => {
  const { t } = useTranslation(['node', 'core']);
  const capitalize = { postProcess: 'capitalizeFirstChar' } as const;
  const failureText = useFailureText();
  const status = useAtomValue(nodeInfosAtom) as NodeStatus;
  const { run, states } = useNodeActions(nodeBase);
  const [pending, setPending] = useState<NodeChange | null>(null);
  const [done, setDone] = useState<Record<NodeChange, boolean>>(NOTHING_DONE);
  // Whether the node answers at all, and how long it has run.
  const answers = useNodeRead<string>(
    nodeBase,
    active
      ? (base, signal) => getNodeText(base, '/admin/uptime', signal)
      : null,
    10_000
  );
  const canStartCore =
    isLocalNodeUrl(nodeBase) && typeof coreSetup()?.startCore === 'function';
  const [starting, setStarting] = useState<
    'idle' | 'running' | 'waiting' | 'failed'
  >('idle');
  const shownPending = useLastShown(pending);

  // Hub's API key for this node, checked once the section opens.
  useEffect(() => {
    void run('key', '/admin/apikey/test');
  }, [run]);
  const key = states.key;

  // The node is back (it answers after it didn't, or its uptime started
  // over): what was said about stopping, restarting or starting it is over,
  // and the key is checked again.
  const seen = useRef<{ down: boolean; uptime: number | null }>({
    down: false,
    uptime: null,
  });
  useEffect(() => {
    if (answers.status === 'error') {
      seen.current.down = true;
      return;
    }
    if (answers.status !== 'ok') return;
    const uptime = Number(answers.value);
    const known = Number.isFinite(uptime) ? uptime : null;
    const restarted =
      known !== null &&
      seen.current.uptime !== null &&
      known < seen.current.uptime;
    seen.current.uptime = known;
    if (!seen.current.down && !restarted) return;
    seen.current.down = false;
    setDone(NOTHING_DONE);
    setStarting('idle');
    void run('key', '/admin/apikey/test');
  }, [answers.at, answers.status, answers.value, run]);

  // Hub's start gives no answer of its own: the node answering is the sign.
  useEffect(() => {
    if (starting !== 'waiting') return;
    const timer = setTimeout(() => setStarting('failed'), START_WAIT_MS);
    return () => clearTimeout(timer);
  }, [starting]);

  const confirm = async () => {
    const change = pending;
    setPending(null);
    if (!change) return;
    const result = await run(change, NODE_CHANGES[change].path);
    if (result.status === 'done')
      setDone((previous) => ({ ...previous, [change]: true }));
  };

  const startCore = async () => {
    setStarting('running');
    try {
      await coreSetup()?.startCore?.();
      setStarting('waiting');
    } catch {
      setStarting('failed');
    }
  };

  const changeCard = (
    change: NodeChange,
    icon: ReactNode,
    extra?: ReactNode
  ) => {
    const state = states[change];
    return (
      <OverviewCard
        icon={icon}
        id={`control_${change}`}
        title={t(`node:manager.control.${change}_title`, capitalize)}
      >
        <CardText>{t(`node:manager.control.${change}_body`)}</CardText>
        <Box>
          <ActionButton
            busy={state?.status === 'running'}
            color={NODE_CHANGES[change].danger ? 'error' : 'primary'}
            onClick={() => setPending(change)}
            variant="contained"
          >
            {t(`node:manager.control.${change}`, capitalize)}
          </ActionButton>
        </Box>
        {state?.status === 'failed' ? (
          <ActionNote tone="error">{failureText(state.reason)}</ActionNote>
        ) : done[change] ? (
          <ActionNote tone="success">
            {t(`node:manager.control.${change}_done`)}
          </ActionNote>
        ) : null}
        {extra}
      </OverviewCard>
    );
  };

  // Offered only once the node on this PC stopped answering and isn't
  // coming back by itself: not during a restart or bootstrap asked for
  // here, and not while Core's process still runs.
  const nodeDown = answers.status === 'error';
  const offerStart =
    canStartCore && nodeDown && !done.restart && !done.bootstrap;
  const coreOnPc = useCoreOnThisPc(offerStart && active);
  const startCoreCard = !offerStart ? null : starting === 'idle' &&
    coreOnPc === 'running' ? (
    <ActionNote>{t('node:manager.control.start_still_running')}</ActionNote>
  ) : starting === 'idle' && coreOnPc !== 'stopped' ? null : (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <CardText>{t('node:manager.control.start_body')}</CardText>
      <Box>
        <ActionButton
          busy={starting === 'running' || starting === 'waiting'}
          onClick={() => void startCore()}
          variant="contained"
        >
          {t('node:manager.control.start', capitalize)}
        </ActionButton>
      </Box>
      {starting === 'waiting' ? (
        <ActionNote>{t('node:manager.control.start_done')}</ActionNote>
      ) : starting === 'failed' ? (
        <ActionNote tone="error">
          {t('node:manager.control.start_failed')}
        </ActionNote>
      ) : null}
    </Box>
  );

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 330px), 1fr))',
      }}
    >
      {changeCard('restart', <RestartAltRoundedIcon />)}
      {changeCard('stop', <PowerSettingsNewRoundedIcon />, startCoreCard)}
      {changeCard('bootstrap', <CloudDownloadRoundedIcon />)}

      <OverviewCard
        action={
          <Button
            disabled={key?.status === 'running'}
            onClick={() => void run('key', '/admin/apikey/test')}
            size="small"
            sx={textButtonSx}
            variant="text"
          >
            {t('node:manager.control.key_check', capitalize)}
          </Button>
        }
        icon={<KeyRoundedIcon />}
        id="control_key"
        title={t('node:manager.control.key_title')}
      >
        {key?.status === 'done' && key.answer === 'true' ? (
          <ActionNote tone="success">
            {t('node:manager.control.key_ok')}
          </ActionNote>
        ) : key?.status === 'failed' ? (
          <ActionNote tone="error">{failureText(key.reason)}</ActionNote>
        ) : key?.status === 'done' ? (
          <ActionNote tone="error">{failureText('refused')}</ActionNote>
        ) : (
          <CardText>{t('core:message.generic.loading', capitalize)}</CardText>
        )}
      </OverviewCard>

      <SupportStatusCard nodeBase={nodeBase} status={status} />

      <LogCard nodeBase={nodeBase} />

      <ConfirmActionDialog
        body={
          shownPending ? t(`node:manager.control.${shownPending}_body`) : ''
        }
        confirmLabel={
          shownPending
            ? t(`node:manager.control.${shownPending}`, capitalize)
            : ''
        }
        danger={shownPending ? NODE_CHANGES[shownPending].danger : false}
        onCancel={() => setPending(null)}
        onConfirm={() => void confirm()}
        open={pending !== null}
        title={
          shownPending ? t(`node:manager.control.${shownPending}_confirm`) : ''
        }
      />
    </Box>
  );
};

/** A plain summary for a help chat: no addresses, names, IPs or keys. */
const SupportStatusCard = ({
  nodeBase,
  status,
}: {
  nodeBase: string;
  status: NodeStatus;
}) => {
  const { i18n, t } = useTranslation(['node', 'core']);
  const language = i18n.language;
  const capitalize = { postProcess: 'capitalizeFirstChar' } as const;
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'failed'>(
    'idle'
  );
  // A node that takes the reads but never answers can't hold the copy up:
  // it waits as long as the window's other reads, and stops with the window.
  const reading = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      reading.current?.abort();
    };
  }, []);

  const copy = async () => {
    setState('copying');
    const controller = new AbortController();
    reading.current = controller;
    const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
    const read = <T,>(path: string) =>
      getNodeJson<T>(nodeBase, path, controller.signal).catch(() => null);
    const [info, system] = await Promise.all([
      read<AdminInfo>('/admin/info'),
      read<SystemInfo>('/admin/systeminfo'),
    ]);
    clearTimeout(timer);
    // Nothing goes to the clipboard once the window is gone.
    if (!alive.current) return;
    const dash = '—';
    const kind = isLocalNodeUrl(nodeBase)
      ? t('node:manager.node_kind.local')
      : t('node:manager.node_kind.custom_short');
    // Without Hub's status for the node (its websocket closed, say), the
    // sync state isn't known.
    const synced =
      typeof status.isSynchronizing !== 'boolean'
        ? null
        : status.isSynchronizing &&
            !(
              typeof status.syncPercent === 'number' &&
              status.syncPercent >= 100
            )
          ? t('node:manager.sync.syncing', {
              percent: status.syncPercent ?? 0,
            })
          : t('node:manager.sync.synced', capitalize);
    const lines = [
      `${t('core:ui.version', capitalize)}: ${manifestData.version}`,
      `${t('core:core.version', capitalize)}: ${info?.buildVersion || dash}`,
      `${t('node:manager.node.kind', capitalize)}: ${kind}`,
      `${t('node:manager.node.uptime', capitalize)}: ${
        typeof info?.uptime === 'number'
          ? formatDuration(info.uptime, language)
          : dash
      }`,
      `${t('node:manager.sync.height', capitalize)}: ${
        typeof status.height === 'number'
          ? formatCount(status.height, language)
          : dash
      }${synced ? ` (${synced})` : ''}`,
      t('node:manager.status.peers', {
        peers:
          typeof status.numberOfConnections === 'number'
            ? formatCount(status.numberOfConnections, language)
            : dash,
      }),
      `${t('node:manager.data_peers.title')}: ${
        typeof status.numberOfDataConnections === 'number'
          ? formatCount(status.numberOfDataConnections, language)
          : dash
      }`,
      `${t('node:manager.minting.title', capitalize)}: ${t(
        status.isMintingPossible ? 'core:core.minting' : 'core:core.not_minting'
      )}`,
      `${t('node:manager.node.memory', capitalize)}: ${
        typeof system?.memoryInUse === 'number' &&
        typeof system?.maxMemory === 'number'
          ? t('node:manager.node.memory_value', {
              max: formatBytes(system.maxMemory, language),
              used: formatBytes(system.memoryInUse, language),
            })
          : dash
      }`,
      `${t('node:manager.node.processors', capitalize)}: ${
        typeof system?.availableProcessors === 'number'
          ? formatCount(system.availableProcessors, language)
          : dash
      }`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  return (
    <OverviewCard
      icon={<SupportAgentRoundedIcon />}
      id="control_support"
      title={t('node:manager.control.support_title', capitalize)}
    >
      <CardText>{t('node:manager.control.support_body')}</CardText>
      <Box>
        <ActionButton busy={state === 'copying'} onClick={() => void copy()}>
          {t('node:manager.control.support_copy', capitalize)}
        </ActionButton>
      </Box>
      {state === 'copied' ? (
        <ActionNote tone="success">
          {t('core:action.copied', capitalize)}
        </ActionNote>
      ) : state === 'failed' ? (
        <ActionNote tone="error">
          {t('node:manager.control.copy_failed')}
        </ActionNote>
      ) : null}
    </OverviewCard>
  );
};

/** The node's newest log lines, on request, read like the other actions. */
const LogCard = ({ nodeBase }: { nodeBase: string }) => {
  const theme = useTheme();
  const { t } = useTranslation(['node', 'core']);
  const capitalize = { postProcess: 'capitalizeFirstChar' } as const;
  const failureText = useFailureText();
  const { run, states } = useNodeActions(nodeBase);
  const state = states.log;
  // The last log read, kept on screen while a refresh runs.
  const [text, setText] = useState<string | null>(null);
  // The newest lines come last: open the box at them.
  const logBox = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    const box = logBox.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [text]);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const read = async () => {
    setCopied('idle');
    const result = await run('log', `/admin/logs?limit=${LOG_LINES}&tail=true`);
    if (result.status === 'done') setText(result.answer);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text ?? '');
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  };
  const asked = state !== undefined;

  return (
    <OverviewCard
      action={
        asked ? (
          <Box sx={{ display: 'inline-flex', gap: 0.5 }}>
            <Button
              disabled={state?.status === 'running'}
              onClick={() => void read()}
              size="small"
              sx={textButtonSx}
              variant="text"
            >
              {t('core:action.refresh', capitalize)}
            </Button>
            <Button
              disabled={!text}
              onClick={() => void copy()}
              size="small"
              sx={textButtonSx}
              variant="text"
            >
              {t('node:manager.control.log_copy', capitalize)}
            </Button>
          </Box>
        ) : null
      }
      icon={<ArticleRoundedIcon />}
      id="control_log"
      title={t('node:manager.control.log_title', capitalize)}
      wide
    >
      <CardText>{t('node:manager.control.log_note')}</CardText>
      {!asked ? (
        <Box>
          <Button
            onClick={() => void read()}
            size="small"
            sx={quietButtonSx(theme)}
            variant="outlined"
          >
            {t('node:manager.control.log_show', {
              lines: String(LOG_LINES),
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
        </Box>
      ) : null}
      {state?.status === 'failed' ? (
        <ActionNote tone="error">{failureText(state.reason)}</ActionNote>
      ) : null}
      {text !== null ? (
        <Box
          aria-label={t('node:manager.control.log_title', capitalize)}
          component="pre"
          ref={logBox}
          sx={{
            backgroundColor: alpha(
              theme.palette.common.black,
              theme.palette.mode === 'dark' ? 0.22 : 0.03
            ),
            border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
            borderRadius: '10px',
            color: theme.palette.text.primary,
            fontFamily: 'monospace',
            fontSize: '0.74rem',
            m: 0,
            maxHeight: 360,
            overflow: 'auto',
            p: 1.25,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
          tabIndex={0}
        >
          {text || t('node:manager.control.log_empty')}
        </Box>
      ) : state?.status === 'running' ? (
        <CardText>{t('core:message.generic.loading', capitalize)}</CardText>
      ) : null}
      {copied === 'copied' ? (
        <ActionNote tone="success">
          {t('core:action.copied', capitalize)}
        </ActionNote>
      ) : copied === 'failed' ? (
        <ActionNote tone="error">
          {t('node:manager.control.copy_failed')}
        </ActionNote>
      ) : null}
    </OverviewCard>
  );
};
