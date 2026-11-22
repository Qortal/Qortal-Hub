import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Box,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import SyncRoundedIcon from '@mui/icons-material/SyncRounded';
import HubRoundedIcon from '@mui/icons-material/HubRounded';
import StorageRoundedIcon from '@mui/icons-material/StorageRounded';
import ViewInArRoundedIcon from '@mui/icons-material/ViewInArRounded';
import WifiTetheringRoundedIcon from '@mui/icons-material/WifiTetheringRounded';
import DnsRoundedIcon from '@mui/icons-material/DnsRounded';
import VolunteerActivismRoundedIcon from '@mui/icons-material/VolunteerActivismRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { nodeInfosAtom } from '../../atoms/global';
import { isLocalNodeUrl } from '../../constants/constants';
import {
  P2P_HEALTH_RECEIVING_STABLE_MS,
  computeP2pHealth,
} from '../../lib/p2pHealth';
import { manifestData } from '../NotAuthenticated';
import { formatQortAmount } from '../../utils/numberFunctions';
import {
  CardText,
  CheckList,
  DetailRows,
  OverviewCard,
  ReadNote,
  StatusTitle,
} from './OverviewParts';
import {
  primaryButtonSx,
  quietButtonSx,
  sectionLabelSx,
  toneOf,
  windowSurfaceColor,
  type Tone,
} from './nodeManagerLook';
import {
  addHeightSample,
  averageBlockSeconds,
  defaultListenPort,
  formatAgo,
  formatBytes,
  formatCount,
  formatDuration,
  helpTheNetworkChecks,
  mintingSummary,
  signatureAsBase64,
  summarizePeers,
  syncEstimate,
  type HeightSample,
} from './nodeOverview';
import {
  useNodeOverviewData,
  useReticulumOverview,
  type NodeRead,
} from './useNodeOverviewData';

type NodeStatus = {
  height?: number;
  isMintingPossible?: boolean;
  isSynchronizing?: boolean;
  numberOfConnections?: number;
  numberOfDataConnections?: number;
  syncPercent?: number;
};

/** Re-renders every `ms`, for "made 34 seconds ago". */
const useNow = (ms: number) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
};

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const DASH = '—';

const unit = (value: number, name: string, language: string, digits = 0) => {
  const options = {
    maximumFractionDigits: digits,
    style: 'unit',
    unit: name,
    unitDisplay: 'narrow',
  } as const;
  try {
    return new Intl.NumberFormat(language, options).format(value);
  } catch {
    return new Intl.NumberFormat('en', options).format(value);
  }
};

/** "on", "off", or a dash when the node didn't say. */
const onOff = (value: boolean | null | undefined, on: string, off: string) =>
  value === true ? on : value === false ? off : DASH;

export const NodeOverview = ({
  active = true,
  isPublic,
  nodeBase,
  onOpenMinting,
  onSetUpNode,
}: {
  /** False while another section is shown: nothing is read meanwhile. */
  active?: boolean;
  isPublic: boolean;
  nodeBase: string;
  onOpenMinting: () => void;
  onSetUpNode: () => void;
}) => {
  const theme = useTheme();
  const { i18n, t } = useTranslation(['node', 'core']);
  const language = i18n.language;
  const status = useAtomValue(nodeInfosAtom) as NodeStatus;
  const data = useNodeOverviewData(nodeBase, isPublic, active);
  const reticulum = useReticulumOverview();
  const now = useNow(5_000);
  const capitalize = { postProcess: 'capitalizeFirstChar' } as const;
  const count = (value: number | null | undefined) =>
    typeof value === 'number' ? formatCount(value, language) : DASH;

  // The node's own clock, as of its last answer: block ages don't depend on
  // this PC's clock being right.
  const info = data.info.value;
  const nodeNow =
    typeof info?.currentTimestamp === 'number' && data.info.at !== null
      ? info.currentTimestamp + (now - data.info.at)
      : now;

  const lastBlock = data.lastBlock.value;
  const height =
    typeof status.height === 'number' ? status.height : lastBlock?.height;

  // Recent heights, for the speed and time left while syncing.
  const [samples, setSamples] = useState<HeightSample[]>([]);
  useEffect(() => {
    if (typeof status.height !== 'number') return;
    setSamples((previous) =>
      addHeightSample(previous, { at: Date.now(), height: status.height })
    );
  }, [status.height]);

  const peers = useMemo(
    () =>
      summarizePeers(data.peers.value, {
        height: lastBlock?.height ?? null,
        lastBlockSignature: signatureAsBase64(lastBlock?.signature),
        version: info?.buildVersion ?? null,
      }),
    [
      data.peers.value,
      info?.buildVersion,
      lastBlock?.height,
      lastBlock?.signature,
    ]
  );
  const dataPeers = useMemo(
    () =>
      summarizePeers(data.dataPeers.value, {
        version: info?.buildVersion ?? null,
      }),
    [data.dataPeers.value, info?.buildVersion]
  );

  const isSyncing =
    !!status.isSynchronizing &&
    !(typeof status.syncPercent === 'number' && status.syncPercent >= 100);
  const behind =
    typeof height === 'number' && typeof peers.highestHeight === 'number'
      ? Math.max(0, peers.highestHeight - height)
      : null;
  const estimate = isSyncing
    ? syncEstimate(samples, peers.highestHeight)
    : null;

  // The last good answer counts; "unknown" only once a read has failed.
  const minting = mintingSummary({
    isMintingPossible: status.isMintingPossible,
    isPublic,
    isSynchronizing: status.isSynchronizing,
    keyCount: data.mintingKeys.value,
    syncPercent: status.syncPercent,
  });
  // The minting window's status colours: green minting, blue syncing, rose
  // for a key that doesn't mint; the rest plain.
  const mintingTone: Tone | undefined =
    minting === 'minting'
      ? 'active'
      : minting === 'syncing'
        ? 'syncing'
        : minting === 'key_not_minting'
          ? 'inactive'
          : undefined;
  const mintingStillLoading =
    minting === 'unknown' && data.mintingKeys.status === 'loading';
  // Until the peers are read, nothing is known about their versions.
  const newerPeers =
    data.peers.value !== null && peers.newer ? peers.newer : null;

  const settings = data.settings.value;
  const help = helpTheNetworkChecks({
    dataPeers:
      data.dataPeers.status === 'ok'
        ? (data.dataPeers.value?.length ?? 0)
        : null,
    inbound: data.peers.status === 'ok' ? peers.inbound : null,
    isMintingPossible:
      typeof status.isMintingPossible === 'boolean'
        ? status.isMintingPossible
        : null,
    newerPeers: newerPeers ? newerPeers.count : null,
    relayMode: settings?.relayModeEnabled ?? null,
    uptimeMs: typeof info?.uptime === 'number' ? info.uptime : null,
  });
  const helpText = (id: string, state: string) => {
    if (state === 'unknown' && id !== 'reachable')
      return t('node:manager.help.unknown');
    const values = {
      duration:
        typeof info?.uptime === 'number'
          ? formatDuration(info.uptime, language)
          : DASH,
      inbound: count(peers.inbound),
      peers: count(newerPeers?.count),
      total: count(data.dataPeers.value?.length),
      version: newerPeers?.highest ?? DASH,
    };
    if (id === 'reachable' && state === 'todo') {
      const port = settings?.listenPort ?? defaultListenPort(info?.isTestNet);
      return t(
        settings?.uPnPEnabled === false
          ? 'node:manager.help.reachable_todo_upnp_off'
          : 'node:manager.help.reachable_todo',
        { port: String(port) }
      );
    }
    return t(`node:manager.help.${id}_${state}`, values);
  };

  const averageSeconds = averageBlockSeconds(lastBlock, data.dayOldBlock.value);

  const nodeKind = isPublic
    ? t('node:manager.node_kind.public')
    : isLocalNodeUrl(nodeBase)
      ? t('node:manager.node_kind.local')
      : t('node:manager.node_kind.custom', { host: hostOf(nodeBase) });

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 330px), 1fr))',
      }}
    >
      {isPublic ? (
        <OverviewCard
          icon={<PublicRoundedIcon />}
          id="public"
          title={t('node:manager.public.title')}
          wide
        >
          <CardText>{t('node:manager.public.body')}</CardText>
          <Box>
            <Button
              onClick={onSetUpNode}
              sx={primaryButtonSx(theme)}
              variant="contained"
            >
              {t('node:manager.public.set_up', capitalize)}
            </Button>
          </Box>
        </OverviewCard>
      ) : null}

      <OverviewCard
        icon={<SyncRoundedIcon />}
        id="sync"
        title={t('node:manager.sync.title', capitalize)}
        tone={isSyncing ? 'syncing' : 'active'}
      >
        <StatusTitle tone={isSyncing ? 'syncing' : 'active'}>
          {isSyncing
            ? t('node:manager.sync.syncing', {
                percent: status.syncPercent ?? 0,
              })
            : t('node:manager.sync.synced', capitalize)}
        </StatusTitle>
        <DetailRows
          rows={[
            [t('node:manager.sync.height', capitalize), count(height)],
            [
              t('node:manager.sync.highest_peer', capitalize),
              count(peers.highestHeight),
            ],
            [t('node:manager.sync.behind', capitalize), count(behind)],
            [
              t('node:manager.sync.last_block', capitalize),
              typeof lastBlock?.timestamp === 'number'
                ? formatAgo(lastBlock.timestamp, language, nodeNow)
                : DASH,
            ],
            ...(estimate
              ? ([
                  [
                    t('node:manager.sync.speed', capitalize),
                    formatCount(
                      Math.round(estimate.blocksPerMinute * 10) / 10,
                      language
                    ),
                  ],
                  [
                    t('node:manager.sync.time_left', capitalize),
                    estimate.minutesLeft !== null
                      ? formatDuration(estimate.minutesLeft * 60_000, language)
                      : DASH,
                  ],
                ] as [string, string][])
              : []),
            ...(peers.sameHeight
              ? ([
                  [
                    t('node:manager.sync.agreement', capitalize),
                    t('node:manager.sync.agreement_value', {
                      agreeing: formatCount(
                        peers.sameHeight.agreeing,
                        language
                      ),
                      total: formatCount(peers.sameHeight.total, language),
                    }),
                  ],
                ] as [string, string][])
              : []),
          ]}
        />
        <ReadNote read={data.lastBlock} />
      </OverviewCard>

      <OverviewCard
        action={
          isPublic ? null : (
            <Button
              onClick={onOpenMinting}
              size="small"
              sx={quietButtonSx(theme)}
              variant="outlined"
            >
              {t('node:manager.minting.open', capitalize)}
            </Button>
          )
        }
        icon={<BoltRoundedIcon />}
        id="minting"
        title={t('node:manager.minting.title', capitalize)}
        tone={mintingTone}
      >
        {mintingStillLoading ? null : (
          <Typography
            sx={{
              color: mintingTone
                ? toneOf(theme, mintingTone).accent
                : theme.palette.text.primary,
              fontSize: '1.05rem',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              lineHeight: 1.3,
            }}
          >
            {t(`node:manager.minting.${minting}`)}
          </Typography>
        )}
        {isPublic ? null : (
          <>
            <DetailRows
              rows={[
                [
                  t('node:manager.minting.keys', capitalize),
                  data.mintingKeys.value === null
                    ? DASH
                    : count(data.mintingKeys.value),
                ],
              ]}
            />
            <ReadNote read={data.mintingKeys} />
          </>
        )}
      </OverviewCard>

      <OverviewCard
        icon={<HubRoundedIcon />}
        id="peers"
        title={t('node:manager.peers.title', capitalize)}
      >
        {data.peers.status === 'ok' && peers.total === 0 ? (
          <CardText>{t('node:manager.peers.none')}</CardText>
        ) : (
          <DetailRows
            rows={[
              [
                t('node:manager.peers.connected', capitalize),
                data.peers.value === null
                  ? DASH
                  : t('core:core.p2p_peers_out_in', {
                      in: formatCount(peers.inbound, language),
                      out: formatCount(peers.outbound, language),
                    }),
              ],
              ...(peers.connecting > 0
                ? ([
                    [
                      t('node:manager.peers.connecting', capitalize),
                      count(peers.connecting),
                    ],
                  ] as [string, string][])
                : []),
              [
                t('node:manager.peers.heights', capitalize),
                data.peers.value === null ||
                typeof lastBlock?.height !== 'number'
                  ? DASH
                  : t('node:manager.peers.heights_value', {
                      ahead: formatCount(peers.ahead, language),
                      behind: formatCount(peers.behind, language),
                      same: formatCount(peers.same, language),
                    }),
              ],
              [
                t('node:manager.peers.ping', capitalize),
                peers.medianPingMs === null
                  ? DASH
                  : unit(peers.medianPingMs, 'millisecond', language),
              ],
              ...(peers.tooDivergent > 0
                ? ([
                    [
                      t('node:manager.peers.far', capitalize),
                      count(peers.tooDivergent),
                    ],
                  ] as [string, string][])
                : []),
            ]}
          />
        )}
        <VersionList versions={peers.versions} />
        <ReadNote read={data.peers} />
      </OverviewCard>

      <OverviewCard
        icon={<StorageRoundedIcon />}
        id="data_peers"
        title={t('node:manager.data_peers.title')}
      >
        <CardText>{t('node:manager.data_peers.intro')}</CardText>
        <DetailRows
          rows={[
            [
              t('node:manager.peers.connected', capitalize),
              data.dataPeers.value === null
                ? DASH
                : t('core:core.p2p_peers_out_in', {
                    in: formatCount(dataPeers.inbound, language),
                    out: formatCount(dataPeers.outbound, language),
                  }),
            ],
            ...(isPublic
              ? []
              : ([
                  [
                    t('node:manager.data_peers.limit', capitalize),
                    count(settings?.maxDataPeers),
                  ],
                ] as [string, string][])),
          ]}
        />
        <VersionList versions={dataPeers.versions} />
        <ReadNote read={data.dataPeers} />
      </OverviewCard>

      <BlocksCard
        averageSeconds={averageSeconds}
        lastBlock={data.lastBlock}
        minterName={data.minterName}
        nodeNow={nodeNow}
        onlineMinters={data.onlineMinters}
        recent={data.recentBlocks}
      />

      <ReticulumCard reticulum={reticulum} />

      {isPublic ? null : (
        <OverviewCard
          icon={<VolunteerActivismRoundedIcon />}
          id="help"
          title={t('node:manager.help.title', capitalize)}
        >
          <CardText>{t('node:manager.help.intro')}</CardText>
          <CheckList
            items={help.map(({ id, state }) => ({
              id,
              state,
              text: helpText(id, state),
            }))}
          />
        </OverviewCard>
      )}

      <OverviewCard
        icon={<DnsRoundedIcon />}
        id="node"
        title={t('node:manager.node.title', capitalize)}
        wide
      >
        <Box
          sx={{
            columnGap: 4,
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
            rowGap: 1.5,
          }}
        >
          <DetailRows
            rows={[
              [t('node:manager.node.kind', capitalize), nodeKind],
              [t('node:manager.node.address', capitalize), nodeBase],
              [
                t('node:manager.node.type', capitalize),
                info?.type === 'lite'
                  ? t('node:manager.node.type_lite')
                  : info?.type === 'full'
                    ? t('node:manager.node.type_full')
                    : DASH,
              ],
              [
                t('node:manager.node.network', capitalize),
                typeof info?.isTestNet === 'boolean'
                  ? info.isTestNet
                    ? t('node:manager.node.testnet')
                    : t('node:manager.node.mainnet')
                  : DASH,
              ],
              [
                t('node:manager.node.node_id', capitalize),
                info?.nodeId || DASH,
              ],
              [
                t('node:manager.node.uptime', capitalize),
                typeof info?.uptime === 'number'
                  ? formatDuration(info.uptime, language)
                  : DASH,
              ],
            ]}
          />
          <DetailRows
            rows={[
              [t('core:core.version', capitalize), info?.buildVersion || DASH],
              [
                t('node:manager.node.built', capitalize),
                typeof info?.buildTimestamp === 'number'
                  ? new Date(
                      info.buildTimestamp < 1e12
                        ? info.buildTimestamp * 1000
                        : info.buildTimestamp
                    ).toLocaleDateString(language)
                  : DASH,
              ],
              [
                t('node:manager.node.newer_core', capitalize),
                !newerPeers
                  ? DASH
                  : newerPeers.count > 0
                    ? t('node:manager.node.newer_core_value', {
                        peers: formatCount(newerPeers.count, language),
                        version: newerPeers.highest,
                      })
                    : t('node:manager.node.newer_core_none'),
              ],
              ...(isPublic
                ? []
                : ([
                    [
                      t('node:manager.node.auto_update', capitalize),
                      onOff(
                        settings?.autoUpdateEnabled,
                        t('node:manager.on'),
                        t('node:manager.off')
                      ),
                    ],
                    [
                      t('node:manager.node.api_whitelist', capitalize),
                      onOff(
                        settings?.apiWhitelistEnabled,
                        t('node:manager.on'),
                        t('node:manager.off')
                      ),
                    ],
                  ] as [string, string][])),
              [t('core:ui.version', capitalize), manifestData.version],
            ]}
          />
          <DetailRows
            rows={[
              ...(isPublic
                ? []
                : ([
                    [
                      t('node:manager.node.memory', capitalize),
                      typeof data.system.value?.memoryInUse === 'number' &&
                      typeof data.system.value?.maxMemory === 'number'
                        ? t('node:manager.node.memory_value', {
                            max: formatBytes(
                              data.system.value.maxMemory,
                              language
                            ),
                            used: formatBytes(
                              data.system.value.memoryInUse,
                              language
                            ),
                          })
                        : DASH,
                    ],
                    [
                      t('node:manager.node.processors', capitalize),
                      count(data.system.value?.availableProcessors),
                    ],
                  ] as [string, string][])),
              [
                t('node:manager.node.day_blocks', capitalize),
                count(data.activity.value?.blockCount),
              ],
              [
                t('node:manager.node.day_transactions', capitalize),
                count(data.activity.value?.totalTransactionCount),
              ],
              [
                t('node:manager.node.day_names', capitalize),
                count(data.activity.value?.namesRegistered),
              ],
            ]}
          />
        </Box>
        {!isPublic && settings?.apiWhitelistEnabled === false ? (
          <CardText>{t('node:manager.node.api_whitelist_off')}</CardText>
        ) : null}
        <ReadNote read={data.info} />
      </OverviewCard>
    </Box>
  );
};

/** The Core versions peers run, most first: four at most. */
const VersionList = ({
  versions,
}: {
  versions: { version: string; count: number }[];
}) => {
  const theme = useTheme();
  const { i18n, t } = useTranslation(['node']);
  if (!versions.length) return null;
  return (
    <Box>
      <Typography sx={{ ...sectionLabelSx(theme), mb: 0.75 }}>
        {t('node:manager.peers.versions', {
          postProcess: 'capitalizeFirstChar',
        })}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
        {versions.slice(0, 4).map(({ version, count }) => (
          <Box
            data-version={version}
            key={version}
            sx={{
              backgroundColor: alpha(theme.palette.primary.main, 0.1),
              border: `1px solid ${alpha(theme.palette.primary.main, 0.25)}`,
              borderRadius: '999px',
              color: theme.palette.text.primary,
              display: 'inline-flex',
              fontSize: '0.76rem',
              fontVariantNumeric: 'tabular-nums',
              gap: 0.75,
              px: 1,
              py: 0.25,
            }}
          >
            <span>{version}</span>
            <Box component="span" sx={{ color: theme.palette.text.secondary }}>
              {formatCount(count, i18n.language)}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

const BlocksCard = ({
  averageSeconds,
  lastBlock,
  minterName,
  nodeNow,
  onlineMinters,
  recent,
}: {
  averageSeconds: number | null;
  lastBlock: ReturnType<typeof useNodeOverviewData>['lastBlock'];
  minterName: string | null;
  nodeNow: number;
  onlineMinters: ReturnType<typeof useNodeOverviewData>['onlineMinters'];
  recent: ReturnType<typeof useNodeOverviewData>['recentBlocks'];
}) => {
  const theme = useTheme();
  const { i18n, t } = useTranslation(['node', 'core']);
  const language = i18n.language;
  const capitalize = { postProcess: 'capitalizeFirstChar' } as const;
  const block = lastBlock.value;
  const count = (value: number | undefined) =>
    typeof value === 'number' ? formatCount(value, language) : DASH;
  const minter = block?.minterAddress
    ? minterName ||
      `${block.minterAddress.slice(0, 6)}…${block.minterAddress.slice(-4)}`
    : DASH;
  const cellSx = {
    borderColor: alpha(theme.palette.divider, 0.14),
    color: theme.palette.text.primary,
    fontSize: '0.84rem',
    fontVariantNumeric: 'tabular-nums',
    px: 1,
    py: 0.75,
  } as const;
  const headSx = {
    ...cellSx,
    ...sectionLabelSx(theme),
    backgroundColor: windowSurfaceColor(theme),
    display: 'table-cell',
  } as const;
  const blocks = recent.value ?? [];

  return (
    <OverviewCard
      icon={<ViewInArRoundedIcon />}
      id="blocks"
      title={t('node:manager.blocks.title', capitalize)}
      wide
    >
      <Box
        sx={{
          columnGap: 4,
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
          rowGap: 2,
        }}
      >
        <Box>
          <DetailRows
            rows={[
              [
                t('node:manager.blocks.height', capitalize),
                count(block?.height),
              ],
              [
                t('node:manager.blocks.made', capitalize),
                typeof block?.timestamp === 'number'
                  ? formatAgo(block.timestamp, language, nodeNow)
                  : DASH,
              ],
              [
                t('node:manager.blocks.minter', capitalize),
                typeof block?.minterLevel === 'number'
                  ? t('node:manager.blocks.minter_value', {
                      level: formatCount(block.minterLevel, language),
                      name: minter,
                    })
                  : minter,
              ],
              [
                t('node:manager.blocks.online_minters', capitalize),
                count(onlineMinters.value ?? undefined),
              ],
              [
                t('node:manager.blocks.transactions', capitalize),
                count(block?.transactionCount),
              ],
              [
                t('node:manager.blocks.fees', capitalize),
                block?.totalFees !== undefined &&
                formatQortAmount(block.totalFees, language) !== null
                  ? t('node:manager.blocks.fees_value', {
                      amount: formatQortAmount(block.totalFees, language),
                    })
                  : DASH,
              ],
              [
                t('node:manager.blocks.average', capitalize),
                averageSeconds === null
                  ? DASH
                  : unit(averageSeconds, 'second', language, 1),
              ],
            ]}
          />
          <ReadNote read={lastBlock} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ ...sectionLabelSx(theme), mb: 0.75 }}>
            {t('node:manager.blocks.recent', capitalize)}
          </Typography>
          {blocks.length ? (
            <Table
              aria-label={t('node:manager.blocks.recent', capitalize)}
              size="small"
            >
              <TableHead>
                <TableRow>
                  <TableCell sx={headSx}>
                    {t('node:manager.blocks.height', capitalize)}
                  </TableCell>
                  <TableCell sx={headSx}>
                    {t('node:manager.blocks.made', capitalize)}
                  </TableCell>
                  <TableCell align="right" sx={headSx}>
                    {t('node:manager.blocks.transactions', capitalize)}
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {blocks.map((row) => (
                  <TableRow key={row.signature ?? row.height}>
                    <TableCell sx={cellSx}>{count(row.height)}</TableCell>
                    <TableCell sx={cellSx}>
                      {typeof row.timestamp === 'number'
                        ? formatAgo(row.timestamp, language, nodeNow)
                        : DASH}
                    </TableCell>
                    <TableCell align="right" sx={cellSx}>
                      {count(row.transactionCount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <ReadNote read={recent as NodeRead<unknown>} />
          )}
        </Box>
      </Box>
    </OverviewCard>
  );
};

const ReticulumCard = ({
  reticulum,
}: {
  reticulum: ReturnType<typeof useReticulumOverview>;
}) => {
  const theme = useTheme();
  const { i18n, t } = useTranslation(['node', 'core']);
  const language = i18n.language;
  const capitalize = { postProcess: 'capitalizeFirstChar' } as const;
  const count = (value: number | undefined) =>
    typeof value === 'number' ? formatCount(value, language) : DASH;

  let body: ReactNode;
  if (reticulum.state === 'off' || reticulum.state === 'unavailable') {
    body = (
      <CardText>{t(`node:manager.reticulum.${reticulum.state}`)}</CardText>
    );
  } else if (reticulum.state === 'loading' || !reticulum.status) {
    body = <CardText>{t('core:message.generic.loading', capitalize)}</CardText>;
  } else {
    const status = reticulum.status;
    const health = computeP2pHealth({
      onlineRemoteHubInterfaces: status.onlineRemoteHubInterfaces ?? 0,
      p2pActiveOverlayPeers: status.p2pActiveOverlayPeers ?? 0,
      p2pInboundOverlayPeers: status.p2pInboundOverlayPeers,
      p2pOutboundOverlayPeers: status.p2pOutboundOverlayPeers,
      p2pReceivingOverlayPeers: status.p2pReceivingOverlayPeers,
      p2pReceivingOverlayPeersStableMs: status.p2pReceivingOverlayPeersStableMs,
    });
    const healthColor =
      health === 'bad'
        ? theme.palette.error.main
        : health === 'low'
          ? theme.palette.warning.main
          : theme.palette.success.main;
    const reach = status.reachability
      ? t(
          `node:manager.reticulum.reach_${status.reachability.replace('-', '_')}`
        )
      : DASH;
    body = (
      <>
        <DetailRows
          rows={[
            [
              t('node:manager.reticulum.state', capitalize),
              status.running
                ? t('node:manager.reticulum.running')
                : t('node:manager.reticulum.stopped'),
            ],
            [
              t('node:manager.reticulum.mode', capitalize),
              status.mode
                ? t(`node:manager.reticulum.mode_${status.mode}`)
                : DASH,
            ],
            [
              t('node:manager.reticulum.bridge', capitalize),
              status.bridgeState
                ? t(`node:manager.reticulum.bridge_${status.bridgeState}`)
                : DASH,
            ],
            [t('node:manager.reticulum.reachability', capitalize), reach],
            [
              t('node:manager.reticulum.transport', capitalize),
              onOff(
                status.transportEnabled,
                t('node:manager.on'),
                t('node:manager.off')
              ),
            ],
            [
              t('node:manager.reticulum.hubs', capitalize),
              t('node:manager.reticulum.of_online', {
                configured: count(status.configuredHubInterfaces),
                online: count(status.onlineHubInterfaces),
              }),
            ],
            [
              t('node:manager.reticulum.remote_hubs', capitalize),
              t('node:manager.reticulum.of_online', {
                configured: count(status.configuredRemoteHubInterfaces),
                online: count(status.onlineRemoteHubInterfaces),
              }),
            ],
            [
              t('node:manager.reticulum.overlay', capitalize),
              t('core:core.p2p_peers_out_in', {
                in: count(status.p2pInboundOverlayPeers),
                out: count(status.p2pOutboundOverlayPeers),
              }),
            ],
            [
              t('node:manager.reticulum.active', capitalize),
              count(status.p2pActiveOverlayPeers),
            ],
            [
              t('node:manager.reticulum.receiving', capitalize),
              typeof status.p2pReceivingOverlayPeers === 'number' &&
              status.p2pReceivingOverlayPeers > 0 &&
              typeof status.p2pReceivingOverlayPeersStableMs === 'number'
                ? t('node:manager.reticulum.receiving_value', {
                    duration: formatDuration(
                      status.p2pReceivingOverlayPeersStableMs,
                      language
                    ),
                    peers: count(status.p2pReceivingOverlayPeers),
                  })
                : count(status.p2pReceivingOverlayPeers),
            ],
            [
              t('node:manager.reticulum.verified', capitalize),
              count(status.verifiedOverlayPeerCount),
            ],
            [
              t('core:core.p2p_health', capitalize),
              <Box
                component="span"
                key="health"
                sx={{ color: healthColor, fontWeight: 700 }}
              >
                {t(`core:core.p2p_health_${health}`, capitalize)}
              </Box>,
            ],
          ]}
        />
        <CardText>
          {health === 'good'
            ? t('node:manager.reticulum.health_rule', {
                duration: formatDuration(
                  P2P_HEALTH_RECEIVING_STABLE_MS,
                  language
                ),
              })
            : t(`node:manager.reticulum.health_${health}`, {
                duration: formatDuration(
                  P2P_HEALTH_RECEIVING_STABLE_MS,
                  language
                ),
              })}
        </CardText>
      </>
    );
  }

  return (
    <OverviewCard
      icon={<WifiTetheringRoundedIcon />}
      id="reticulum"
      title={t('node:manager.reticulum.title')}
    >
      {body}
    </OverviewCard>
  );
};
