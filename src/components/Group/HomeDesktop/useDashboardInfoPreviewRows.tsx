import { Box, ButtonBase, Typography, useTheme } from '@mui/material';
import { alpha, type SxProps, type Theme } from '@mui/material/styles';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
} from 'react';
import { useAtomValue } from 'jotai';
import {
  AnimatePresence,
  motion,
} from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  balanceAtom,
  memberGroupsAtom,
  nodeInfosAtom,
  selectedNodeInfoAtom,
  userInfoAtom,
} from '../../../atoms/global';
import { getBaseApiReact } from '../../../App';
import { manifestData } from '../../NotAuthenticated';
import { executeEvent } from '../../../utils/events';
import { accountTargetBlocks } from '../../Minting/MintingStats';
import {
  GROUP_ACTIVITY_BLUE,
  getBlueTier3DotSx,
} from '../groupActivityColorSystem';
import { useHandleUserInfo } from '../../../hooks/useHandleUserInfo';
import {
  isLocalNodeUrl,
} from '../../../constants/constants';
import { nodeDisplay } from '../../../utils/helpers';
import { BlockHeightValue } from './BlockHeightValue';
import type {
  InfoPreviewPanelRows,
  InfoPreviewStatusTone,
} from './infoPreviewPanelTypes';
import {
  INFO_VALUE_COLUMN_MIN_WIDTH_PX,
} from './homeDesktopConstants';
import type { MinterInfoView, MinterProgressSnapshot } from './types';

type UseDashboardInfoPreviewRowsParams = {
  nodeMenuAnchorEl: HTMLElement | null;
  onOpenNodeMenu: (event: MouseEvent<HTMLButtonElement>) => void;
};

export function useDashboardInfoPreviewRows({
  nodeMenuAnchorEl,
  onOpenNodeMenu,
}: UseDashboardInfoPreviewRowsParams): InfoPreviewPanelRows {
  const theme = useTheme();
  const balance = useAtomValue(balanceAtom);
  const memberGroups = useAtomValue(memberGroupsAtom);
  const nodeInfos = useAtomValue(nodeInfosAtom);
  const selectedNode = useAtomValue(selectedNodeInfoAtom);
  const userInfo = useAtomValue(userInfoAtom);
  const userAddress = userInfo?.address;
  const { t } = useTranslation(['core', 'group', 'tutorial', 'auth']);
  const td = useCallback(
    (
      key: string,
      defaultValue: string,
      options?: Record<string, string | number>
    ) =>
      String(
        t(`group:dashboard.${key}`, {
          defaultValue,
          ...options,
        })
      ),
    [t]
  );

  const [coreVersionLabel, setCoreVersionLabel] = useState('—');
  const [minterLevel, setMinterLevel] = useState<number | null>(null);
  const [minterProgress, setMinterProgress] =
    useState<MinterProgressSnapshot | null>(null);
  const [isMinterFieldHovered, setIsMinterFieldHovered] = useState(false);

  const getIndividualUserInfo = useHandleUserInfo();

  const filledBlueDotSx = getBlueTier3DotSx(theme, true);
  const emptyBlueDotSx = getBlueTier3DotSx(theme, false);

  useEffect(() => {
    let active = true;
    if (!userAddress) {
      setMinterLevel(null);
      return;
    }
    getIndividualUserInfo(userAddress)
      .then((level) => {
        if (active) setMinterLevel(typeof level === 'number' ? level : null);
      })
      .catch(() => {
        if (active) setMinterLevel(null);
      });
    return () => {
      active = false;
    };
  }, [getIndividualUserInfo, userAddress]);

  useEffect(() => {
    let active = true;

    const loadMinterProgress = async () => {
      if (!userAddress) {
        if (active) setMinterProgress(null);
        return;
      }

      try {
        const response = await fetch(
          `${getBaseApiReact()}/addresses/${userAddress}`
        );
        if (!response.ok) {
          throw new Error('network error');
        }

        const data = await response.json();
        if (!active) return;

        const currentLevel =
          typeof data?.level === 'number' && Number.isFinite(data.level)
            ? data.level
            : null;
        const mintedBlocks =
          typeof data?.blocksMinted === 'number' &&
          Number.isFinite(data.blocksMinted)
            ? data.blocksMinted
            : 0;
        const mintedAdjustment =
          typeof data?.blocksMintedAdjustment === 'number' &&
          Number.isFinite(data.blocksMintedAdjustment)
            ? data.blocksMintedAdjustment
            : 0;
        const currentBlocks = Math.max(0, mintedBlocks + mintedAdjustment);
        const requiredBlocks =
          currentLevel != null
            ? currentLevel >= 10
              ? currentBlocks
              : accountTargetBlocks(currentLevel)
            : undefined;

        if (currentLevel == null || requiredBlocks == null) {
          setMinterProgress(null);
          return;
        }

        setMinterProgress({
          currentBlocks,
          currentLevel,
          progressRatio:
            requiredBlocks > 0
              ? Math.max(0, Math.min(1, currentBlocks / requiredBlocks))
              : 0,
          requiredBlocks,
        });
      } catch {
        if (active) {
          setMinterProgress(null);
        }
      }
    };

    loadMinterProgress();
    const interval = window.setInterval(loadMinterProgress, 30000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [userAddress]);

  useEffect(() => {
    let active = true;

    const loadCoreInfo = async () => {
      try {
        const response = await fetch(`${getBaseApiReact()}/admin/info`, {
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'GET',
        });
        const data = await response.json();
        if (!active) return;
        setCoreVersionLabel(
          data?.buildVersion ? String(data.buildVersion).substring(0, 20) : '—'
        );
      } catch {
        if (active) {
          setCoreVersionLabel('—');
        }
      }
    };

    loadCoreInfo();
    const interval = window.setInterval(loadCoreInfo, 30000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const balanceLabel =
    balance != null ? `${Number(balance).toFixed(2)} QORT` : '—';

  const hasLiveNodeConnection = nodeInfos?.height != null;
  const liveSyncPercent =
    hasLiveNodeConnection &&
    nodeInfos?.isSynchronizing &&
    nodeInfos?.syncPercent !== 100
      ? Math.round(nodeInfos?.syncPercent || 0)
      : 100;
  const nodeStatusValue = hasLiveNodeConnection
    ? td('sync_percent', '{{percent}}% Synced', {
        percent: liveSyncPercent,
      })
    : td('node_unavailable', 'Node unavailable');
  const peersLabel = `${nodeInfos?.numberOfConnections || 0}`;
  const blockHeightLabel = `${nodeInfos?.height || '—'}`;
  const hubVersionLabel = manifestData.version || '—';
  const qdnPeersLabel = `${nodeInfos?.numberOfDataConnections || 0}`;

  const nodeBase = getBaseApiReact();
  const nodeHostLabel = (() => {
    try {
      return new URL(nodeBase).host;
    } catch {
      return nodeDisplay(nodeBase);
    }
  })();
  const customNodeDashboardLabel =
    selectedNode?.name?.trim() || selectedNode?.url?.trim() || '';
  const nodeTypeLabel = isLocalNodeUrl(nodeBase)
    ? td('local_node', 'Local node')
    : nodeBase.includes('ext-node.qortal.link')
      ? td('public_node', 'Public node')
      : customNodeDashboardLabel ||
        td('custom_node', 'Custom node');
  const isSystemOperational =
    hasLiveNodeConnection &&
    !(nodeInfos?.isSynchronizing && nodeInfos?.syncPercent !== 100);
  const resolvedInfoStatusLabel = isSystemOperational
    ? td('fully_operational', 'Fully operational')
    : td('not_operational', 'Not operational');
  const resolvedIsSystemOperational = isSystemOperational;
  const resolvedInfoStatusTone: InfoPreviewStatusTone =
    nodeInfos?.isSynchronizing && nodeInfos?.syncPercent !== 100
      ? 'syncing'
      : resolvedIsSystemOperational
        ? 'operational'
        : 'issue';

  const resolvedCoreVersionLabel = coreVersionLabel;
  const isMinterOn = useMemo(
    () =>
      !!memberGroups?.find((item: any) => item?.groupId?.toString() === '694'),
    [memberGroups]
  );
  const minterDotsFilled = isMinterOn
    ? Math.max(1, Math.min(9, minterLevel ?? 5))
    : 0;
  const formattedMinterCurrentBlocks =
    minterProgress?.currentBlocks != null
      ? minterProgress.currentBlocks.toLocaleString()
      : null;
  const formattedMinterRequiredBlocks =
    minterProgress?.requiredBlocks != null
      ? minterProgress.requiredBlocks.toLocaleString()
      : null;
  const hasMinterProgressSummary =
    minterProgress != null &&
    formattedMinterCurrentBlocks != null &&
    formattedMinterRequiredBlocks != null;
  const resolvedMinterDefaultView: MinterInfoView = 'dots';
  const minterHoverView: MinterInfoView =
    resolvedMinterDefaultView === 'dots' ? 'progress' : 'dots';
  const isShowingMinterHoverView =
    hasMinterProgressSummary && isMinterFieldHovered;
  const activeMinterInfoView: MinterInfoView = isShowingMinterHoverView
    ? minterHoverView
    : resolvedMinterDefaultView;

  const minterValue = useMemo(
    () => (
      <MinterInfoValue
        activeMinterInfoView={activeMinterInfoView}
        emptyBlueDotSx={emptyBlueDotSx}
        filledBlueDotSx={filledBlueDotSx}
        formattedMinterCurrentBlocks={formattedMinterCurrentBlocks}
        formattedMinterRequiredBlocks={formattedMinterRequiredBlocks}
        hasMinterProgressSummary={hasMinterProgressSummary}
        isMinterOn={isMinterOn}
        minterDotsFilled={minterDotsFilled}
        minterProgress={minterProgress}
        onHoverMinterChange={setIsMinterFieldHovered}
        td={td}
        theme={theme}
      />
    ),
    [
      activeMinterInfoView,
      emptyBlueDotSx,
      filledBlueDotSx,
      formattedMinterCurrentBlocks,
      formattedMinterRequiredBlocks,
      hasMinterProgressSummary,
      isMinterOn,
      minterDotsFilled,
      minterProgress,
      td,
      theme,
    ]
  );

  const coreVersionMetricLabel =
    resolvedCoreVersionLabel && resolvedCoreVersionLabel !== '—'
      ? resolvedCoreVersionLabel.replace(/^qortal-/i, '').split('-')[0] ||
        resolvedCoreVersionLabel
      : '—';

  return {
    status: {
      isOperational: resolvedIsSystemOperational,
      label: resolvedInfoStatusLabel,
      tone: resolvedInfoStatusTone,
    },
    primaryItems: [
      {
        emphasize: true,
        label: td('qort_balance', 'QORT Balance'),
        value: balanceLabel,
      },
      {
        label: nodeTypeLabel,
        pillTone:
          nodeStatusValue === td('node_unavailable', 'Node unavailable')
            ? 'negative'
            : nodeStatusValue ===
                td('sync_percent', '{{percent}}% Synced', { percent: 100 })
              ? 'positive'
              : 'warning',
        value: nodeStatusValue,
        variant: 'pill',
      },
      {
        label: td('minter_level', 'Minter Level'),
        valueNode: minterValue,
      },
    ],
    metricItems: [
      {
        accent: 'blue',
        label: td('peers', 'Peers'),
        value: peersLabel,
      },
      {
        accent: 'blue',
        label: td('qdn', 'QDN'),
        value: qdnPeersLabel,
      },
      {
        accent: 'green',
        label: td('core', 'Core'),
        value: coreVersionMetricLabel,
      },
      {
        accent: 'violet',
        label: td('hub', 'Hub'),
        value: hubVersionLabel,
      },
    ],
    footerSections: [
      {
        variant: 'node',
        title: td('node', 'Node'),
        offsetTopPx: 10,
        items: [
          {
            label: td('using_node', 'Using Node'),
            labelAction: {
              ariaLabel: td('change_node', 'Change node'),
              isOpen: Boolean(nodeMenuAnchorEl),
              onClick: onOpenNodeMenu,
              tooltip: td('change_node', 'Change node'),
            },
            value: nodeHostLabel,
          },
          {
            label: td('node_type', 'Node Type'),
            value: nodeTypeLabel,
          },
          {
            label: td('node_height', 'Node Height'),
            value: blockHeightLabel,
            valueNode: (
              <BlockHeightValue theme={theme} value={blockHeightLabel} />
            ),
          },
        ],
      },
    ],
  };
}

function MinterInfoValue({
  activeMinterInfoView,
  emptyBlueDotSx,
  filledBlueDotSx,
  formattedMinterCurrentBlocks,
  formattedMinterRequiredBlocks,
  hasMinterProgressSummary,
  isMinterOn,
  minterDotsFilled,
  minterProgress,
  onHoverMinterChange,
  td,
  theme,
}: {
  activeMinterInfoView: MinterInfoView;
  emptyBlueDotSx: SxProps<Theme>;
  filledBlueDotSx: SxProps<Theme>;
  formattedMinterCurrentBlocks: string | null;
  formattedMinterRequiredBlocks: string | null;
  hasMinterProgressSummary: boolean;
  isMinterOn: boolean;
  minterDotsFilled: number;
  minterProgress: MinterProgressSnapshot | null;
  onHoverMinterChange: (hovered: boolean) => void;
  td: (
    key: string,
    defaultValue: string,
    options?: Record<string, string | number>
  ) => string;
  theme: Theme;
}) {
  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'inline-flex',
        height: '22px',
        justifyContent: 'flex-end',
        minWidth: `${INFO_VALUE_COLUMN_MIN_WIDTH_PX}px`,
        width: '100%',
      }}
    >
      <AnimatePresence initial={false} mode="wait">
        {isMinterOn ? (
          <motion.div
            key="minter-level"
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
            style={{
              alignItems: 'center',
              display: 'flex',
              height: '22px',
              justifyContent: 'flex-end',
              width: '100%',
            }}
          >
            <Box
              onMouseEnter={
                hasMinterProgressSummary
                  ? () => onHoverMinterChange(true)
                  : undefined
              }
              onMouseLeave={
                hasMinterProgressSummary
                  ? () => onHoverMinterChange(false)
                  : undefined
              }
              onFocusCapture={
                hasMinterProgressSummary
                  ? () => onHoverMinterChange(true)
                  : undefined
              }
              onBlurCapture={
                hasMinterProgressSummary
                  ? (event) => {
                      const nextFocusedElement = event.relatedTarget;

                      if (
                        !(nextFocusedElement instanceof Node) ||
                        !event.currentTarget.contains(nextFocusedElement)
                      ) {
                        onHoverMinterChange(false);
                      }
                    }
                  : undefined
              }
              sx={{
                alignItems: 'center',
                display: 'inline-flex',
                height: '22px',
                justifyContent: 'flex-end',
                maxWidth: '100%',
                minWidth: '180px',
                width: '180px',
              }}
            >
              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  key={activeMinterInfoView}
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -3 }}
                  transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
                  style={{
                    alignItems: 'center',
                    display: 'flex',
                    gap: '8px',
                    height: '22px',
                    justifyContent: 'flex-end',
                    width: '100%',
                  }}
                >
                  {activeMinterInfoView === 'progress' &&
                  hasMinterProgressSummary ? (
                    <Box
                      sx={{
                        alignItems: 'center',
                        display: 'inline-flex',
                        gap: '8px',
                        justifyContent: 'flex-end',
                        minWidth: 0,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <Box
                        sx={{
                          background:
                            theme.palette.mode === 'dark'
                              ? 'rgba(255,255,255,0.08)'
                              : 'rgba(15,23,42,0.08)',
                          borderRadius: '999px',
                          flexShrink: 0,
                          height: '6px',
                          overflow: 'hidden',
                          width: '56px',
                        }}
                      >
                        <Box
                          sx={{
                            background: GROUP_ACTIVITY_BLUE.primary,
                            borderRadius: '999px',
                            height: '100%',
                            transition: 'width 180ms ease',
                            width: `${Math.max(
                              0,
                              Math.min(
                                100,
                                (minterProgress?.progressRatio ?? 0) * 100
                              )
                            )}%`,
                          }}
                        />
                      </Box>
                      <Typography
                        sx={{
                          color: alpha(theme.palette.text.primary, 0.84),
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          letterSpacing: '0.01em',
                          lineHeight: 1,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {formattedMinterCurrentBlocks} /{' '}
                        {formattedMinterRequiredBlocks}
                      </Typography>
                    </Box>
                  ) : (
                    <Box
                      sx={{
                        alignItems: 'center',
                        display: 'inline-flex',
                        gap: '4px',
                        height: '18px',
                        justifyContent: 'flex-end',
                      }}
                    >
                      {Array.from({ length: 9 }).map((_, index) => (
                        <Box
                          key={index}
                          sx={{
                            ...(index < minterDotsFilled
                              ? filledBlueDotSx
                              : emptyBlueDotSx),
                            borderRadius: '50%',
                            height: '11px',
                            width: '11px',
                          }}
                        />
                      ))}
                    </Box>
                  )}
                </motion.div>
              </AnimatePresence>
            </Box>
          </motion.div>
        ) : (
          <motion.div
            key="minter-apply"
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
            style={{
              alignItems: 'center',
              display: 'flex',
              height: '22px',
              justifyContent: 'flex-end',
              width: '100%',
            }}
          >
            <ButtonBase
              onClick={() => {
                executeEvent('addTab', {
                  data: { service: 'APP', name: 'q-mintership', path: '' },
                });
                executeEvent('open-apps-mode', {});
              }}
              sx={{
                alignItems: 'center',
                backgroundColor: 'transparent',
                display: 'inline-flex',
                justifyContent: 'center',
                minWidth: 0,
                ml: 'auto',
                px: 0,
                py: 0,
                transition:
                  'color 140ms ease, text-shadow 140ms ease, transform 120ms ease',
                whiteSpace: 'nowrap',
                '&:hover': {
                  '& .minter-apply-text': {
                    color:
                      theme.palette.mode === 'dark'
                        ? alpha(GROUP_ACTIVITY_BLUE.gradientTop, 1)
                        : alpha(GROUP_ACTIVITY_BLUE.hover, 0.98),
                    textShadow: `0 0 10px ${alpha(
                      GROUP_ACTIVITY_BLUE.primary,
                      theme.palette.mode === 'dark' ? 0.18 : 0.12
                    )}`,
                  },
                  transform: 'translateY(-1px)',
                },
                '&:active': {
                  transform: 'translateY(0)',
                },
              }}
            >
              <Box
                component="span"
                sx={{
                  alignItems: 'center',
                  display: 'inline-flex',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  lineHeight: 1,
                  textTransform: 'uppercase',
                }}
              >
                <Box
                  component="span"
                  sx={{
                    color: alpha(theme.palette.text.secondary, 0.52),
                  }}
                >
                  [
                </Box>
                <Box
                  component="span"
                  className="minter-apply-text"
                  sx={{
                    color:
                      theme.palette.mode === 'dark'
                        ? alpha(GROUP_ACTIVITY_BLUE.gradientTop, 0.94)
                        : alpha(GROUP_ACTIVITY_BLUE.pressed, 0.9),
                    px: '4px',
                    transition: 'color 140ms ease, text-shadow 140ms ease',
                  }}
                >
                  {td('apply', 'Apply')}
                </Box>
                <Box
                  component="span"
                  sx={{
                    color: alpha(theme.palette.text.secondary, 0.52),
                  }}
                >
                  ]
                </Box>
              </Box>
            </ButtonBase>
          </motion.div>
        )}
      </AnimatePresence>
    </Box>
  );
}
