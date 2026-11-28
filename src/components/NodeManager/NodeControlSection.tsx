import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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

/**
 * Core restarts and bootstraps itself through a second Java process, which
 * can fail where Hub can't see it. How long the node may go on answering as
 * before, after a restart or bootstrap asked for here, before the window says
 * it hasn't happened.
 */
export const RESTART_UP_WAIT_MS = 180_000;

/**
 * How long the node may stay away after a restart or bootstrap asked for here
 * before the window says it hasn't come back and offers Start Core (once
 * Core's process is gone too). Core's restart helper starts Core again up to
 * about 3¼ minutes after the node stops answering, and Hub's process check
 * doesn't see the helper meanwhile: so 5 minutes, as long as Core's own
 * restart says it can take.
 */
export const RESTART_DOWN_WAIT_MS = 300_000;

/** When the node started, by this PC's clock, from its answer to uptime. */
const startedAtOf = (read: {
  at: number | null;
  status: string;
  value: string | null;
}) => {
  if (read.status !== 'ok' || read.at === null || !read.value) return null;
  const uptime = Number(read.value);
  return Number.isFinite(uptime) ? read.at - uptime : null;
};

/**
 * Whether the node started again: later than before by more than a read can
 * take (a read's own delay moves the estimate that much).
 */
const startedLater = (now: number | null, before: number | null) =>
  now !== null && before !== null && now > before + READ_TIMEOUT_MS;

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
 * runs, wherever it runs from (shutting down, say: a start then does
 * nothing), `elsewhere` when its process is gone and Core isn't where Hub
 * looks. `recheck` looks again at once.
 */
const useCoreOnThisPc = (enabled: boolean) => {
  const [state, setState] = useState<
    'unknown' | 'running' | 'stopped' | 'elsewhere'
  >('unknown');
  const [round, setRound] = useState(0);
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
            running ? 'running' : installed === false ? 'elsewhere' : 'stopped'
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
  }, [enabled, round]);
  const recheck = useCallback(() => setRound((count) => count + 1), []);
  return { recheck, state };
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
  // The restart or bootstrap asked for here that the node hasn't come back
  // from, with when the node had started by then: a new object for each one
  // asked, so its wait starts over.
  const [awaiting, setAwaiting] = useState<{
    change: 'restart' | 'bootstrap';
    startedAt: number | null;
  } | null>(null);
  // The wait for the node's present state (answering or not) since then.
  const [wait, setWait] = useState<{
    down: boolean;
    for: object;
    over: boolean;
    since: number;
  } | null>(null);
  const [choosingFolder, setChoosingFolder] = useState(false);
  const [noCoreInFolder, setNoCoreInFolder] = useState(false);
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

  // The node is back (it answers after it didn't, or it started again, also
  // while this section was hidden): what was said about stopping, restarting
  // or starting it is over, and the key is checked again. `episode` counts
  // the times it came back.
  const seen = useRef<{
    down: boolean;
    episode: number;
    startedAt: number | null;
  }>({
    down: false,
    episode: 0,
    startedAt: null,
  });
  const startedAt = startedAtOf(answers);
  useEffect(() => {
    if (answers.status === 'error') {
      seen.current.down = true;
      return;
    }
    if (answers.status !== 'ok') return;
    const restarted = startedLater(startedAt, seen.current.startedAt);
    if (startedAt !== null) seen.current.startedAt = startedAt;
    if (!seen.current.down && !restarted) return;
    seen.current.down = false;
    seen.current.episode += 1;
    setDone(NOTHING_DONE);
    setAwaiting(null);
    setStarting('idle');
    setNoCoreInFolder(false);
    void run('key', '/admin/apikey/test');
  }, [answers.at, answers.status, run, startedAt]);

  // Hub's start gives no answer of its own: the node answering is the sign.
  useEffect(() => {
    if (starting !== 'waiting') return;
    const timer = setTimeout(() => setStarting('failed'), START_WAIT_MS);
    return () => clearTimeout(timer);
  }, [starting]);

  const nodeDown = answers.status === 'error';

  // A restart or bootstrap asked for here gets a wait in each state the node
  // is in, answering as before or not answering, started again whenever that
  // changes.
  useEffect(() => {
    if (!awaiting) {
      setWait(null);
      return;
    }
    const down = nodeDown;
    const since = Date.now();
    setWait({ down, for: awaiting, over: false, since });
    const timer = setTimeout(
      () => setWait({ down, for: awaiting, over: true, since }),
      down ? RESTART_DOWN_WAIT_MS : RESTART_UP_WAIT_MS
    );
    return () => clearTimeout(timer);
  }, [awaiting, nodeDown]);

  const confirm = async () => {
    const change = pending;
    setPending(null);
    if (!change) return;
    const result = await run(change, NODE_CHANGES[change].path);
    if (result.status !== 'done') return;
    if (change === 'stop') {
      // A stop ends what a restart or bootstrap asked for earlier said: one
      // that never happened would otherwise keep Start from being offered.
      setDone({ ...NOTHING_DONE, stop: true });
      setAwaiting(null);
      return;
    }
    // The newest restart or bootstrap is the one the cards speak of.
    setDone({ ...NOTHING_DONE, [change]: true });
    setAwaiting({ change, startedAt: seen.current.startedAt });
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

  // The wait for the node's present state since the restart or bootstrap
  // asked for here, once it's over: never a wait for an earlier state or an
  // earlier request, even in the render before the wait starts again.
  const waited =
    awaiting && wait?.over && wait.for === awaiting && wait.down === nodeDown
      ? wait
      : null;
  // Offered only once the node on this PC stopped answering and isn't
  // coming back by itself (a restart or bootstrap asked for here waits
  // first), and not while Core's process still runs.
  const offerStart = canStartCore && nodeDown && (!awaiting || !!waited);
  const { recheck: recheckCore, state: coreOnPc } = useCoreOnThisPc(
    offerStart && active
  );
  const canChooseFolder =
    typeof coreSetup()?.pickQortalDirectory === 'function';

  // Core setup's own folder picker: it keeps the folder only when Core is in
  // it, and answers false when it isn't (null when nothing was chosen).
  const chooseFolder = async () => {
    const episode = seen.current.episode;
    setNoCoreInFolder(false);
    setChoosingFolder(true);
    try {
      const answer = await coreSetup()?.pickQortalDirectory?.();
      if (answer === false && seen.current.episode === episode)
        setNoCoreInFolder(true);
    } catch {
      // Nothing was kept: Hub looks where it did before.
    } finally {
      setChoosingFolder(false);
      recheckCore();
    }
  };

  // A restart or bootstrap asked for here that's late. Still answering: said
  // once a read after the wait shows the node that ran when it was asked.
  // Not answering: once Core's process is gone too (while it runs, Core is
  // still on its way back).
  const lateState: 'still_up' | 'not_back' | null = !waited
    ? null
    : !nodeDown
      ? (answers.at ?? 0) >= waited.since + RESTART_UP_WAIT_MS &&
        !startedLater(startedAt, awaiting?.startedAt ?? null)
        ? 'still_up'
        : null
      : offerStart && (coreOnPc === 'stopped' || coreOnPc === 'elsewhere')
        ? 'not_back'
        : null;

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
        ) : lateState && awaiting?.change === change ? (
          <ActionNote tone="error">
            {t(`node:manager.control.${change}_${lateState}`)}
          </ActionNote>
        ) : done[change] ? (
          <ActionNote tone="success">
            {t(`node:manager.control.${change}_done`)}
          </ActionNote>
        ) : null}
        {extra}
      </OverviewCard>
    );
  };

  const startCoreCard = !offerStart ? null : starting === 'idle' &&
    coreOnPc === 'running' ? (
    // After a restart or bootstrap, a Core process means it's on its way.
    awaiting ? null : (
      <ActionNote>{t('node:manager.control.start_still_running')}</ActionNote>
    )
  ) : starting === 'idle' && coreOnPc === 'elsewhere' ? (
    canChooseFolder ? (
      <Box sx={{ display: 'grid', gap: 1 }}>
        <CardText>{t('node:manager.control.start_elsewhere')}</CardText>
        <Box>
          <ActionButton
            busy={choosingFolder}
            onClick={() => void chooseFolder()}
          >
            {t('node:manager.control.start_choose_folder', capitalize)}
          </ActionButton>
        </Box>
        {noCoreInFolder ? (
          <ActionNote tone="error">
            {t('node:error.noJar', capitalize)}
          </ActionNote>
        ) : null}
      </Box>
    ) : null
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
  // Start shows in the card of what took the node down.
  const startIn = (change: NodeChange) =>
    change === (awaiting?.change ?? 'stop') ? startCoreCard : null;

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 330px), 1fr))',
      }}
    >
      {changeCard('restart', <RestartAltRoundedIcon />, startIn('restart'))}
      {changeCard('stop', <PowerSettingsNewRoundedIcon />, startIn('stop'))}
      {changeCard(
        'bootstrap',
        <CloudDownloadRoundedIcon />,
        startIn('bootstrap')
      )}

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
