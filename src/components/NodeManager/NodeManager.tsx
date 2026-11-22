import { useCallback, useEffect, useId, useState } from 'react';
import {
  Box,
  ButtonBase,
  Chip,
  Dialog,
  IconButton,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  isOpenCoreSetup,
  nodeInfosAtom,
  selectedNodeInfoAtom,
} from '../../atoms/global';
import { appLockedAtom, isHubLocked } from '../../atoms/presence';
import {
  EXT_NODE_QORTAL_LINK,
  HTTPS_EXT_NODE_QORTAL_LINK,
} from '../../constants/constants';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import qortalLogoOfficial from '../../assets/sidebar/qortal-logo-official.webp';
import qortalLogoMinting from '../../assets/sidebar/qortal-logo-official-minting.webp';
import { NodeStateLogo } from '../Desktop/NodeStateLogo';
import { useNodeState } from '../Desktop/nodeState';
import mintingWatermark from '../../assets/minting/blue-grey-menu-button2-1.png';
import {
  quietSurfaceSx,
  sectionLabelSx,
  toneOf,
  windowBackdropSx,
  windowPaperSx,
} from './nodeManagerLook';
import { NodeOverview } from './NodeOverview';
import {
  isNodeManagerSection,
  nodeManagerOpenAtom,
  OPEN_NODE_MANAGER_EVENT,
  type NodeManagerSection,
} from './nodeManagerEvents';
import { formatCount } from './nodeOverview';

type NodeStatus = {
  height?: number;
  isMintingPossible?: boolean;
  isSynchronizing?: boolean;
  numberOfConnections?: number;
  syncPercent?: number;
};

/**
 * Keeps the Node Manager: opens it on `openNodeManager`, never while Hub is
 * locked, and closes it when Hub locks. Mounted by App once signed in.
 */
export const NodeManagerHost = () => {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<NodeManagerSection>('overview');
  const isLocked = useAtomValue(appLockedAtom);

  useEffect(() => {
    const onOpen = (event: CustomEvent<{ section?: unknown }>) => {
      // Nothing opens over the lock screen or behind it.
      if (isHubLocked()) return;
      const next = event?.detail?.section;
      setSection(isNodeManagerSection(next) ? next : 'overview');
      setOpen(true);
    };
    subscribeToEvent(OPEN_NODE_MANAGER_EVENT, onOpen);
    return () => unsubscribeFromEvent(OPEN_NODE_MANAGER_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (isLocked) setOpen(false);
  }, [isLocked]);

  // Tells the node cards on hover; gone with the host (signing out).
  const setManagerOpen = useSetAtom(nodeManagerOpenAtom);
  useEffect(() => {
    setManagerOpen(open);
  }, [open, setManagerOpen]);
  useEffect(() => () => setManagerOpen(false), [setManagerOpen]);

  return (
    <NodeManager
      onClose={() => setOpen(false)}
      onSectionChange={setSection}
      open={open}
      section={section}
    />
  );
};

export const NodeManager = ({
  onClose,
  onSectionChange,
  open,
  section,
}: {
  onClose: () => void;
  onSectionChange: (section: NodeManagerSection) => void;
  open: boolean;
  section: NodeManagerSection;
}) => {
  const theme = useTheme();
  const { i18n, t } = useTranslation(['node', 'core']);
  const titleId = useId();
  const nodeState = useNodeState();
  const selectedNode = useAtomValue(selectedNodeInfoAtom);
  const status = useAtomValue(nodeInfosAtom) as NodeStatus;
  const setOpenCoreSetup = useSetAtom(isOpenCoreSetup);
  const nodeBase = selectedNode?.url || HTTPS_EXT_NODE_QORTAL_LINK;
  const isPublic = nodeBase.includes(EXT_NODE_QORTAL_LINK);
  const capitalize = { postProcess: 'capitalizeFirstChar' } as const;

  // The minting window is still its own: this one makes way for it.
  const openMinting = useCallback(() => {
    onClose();
    executeEvent('openMintingPanel', {});
  }, [onClose]);
  const setUpNode = useCallback(() => {
    onClose();
    setOpenCoreSetup(true);
  }, [onClose, setOpenCoreSetup]);

  const isSyncing =
    !!status.isSynchronizing &&
    !(typeof status.syncPercent === 'number' && status.syncPercent >= 100);
  const chipSx = (color: string) => ({
    backgroundColor: alpha(color, 0.1),
    border: `1px solid ${alpha(color, 0.24)}`,
    borderRadius: '999px',
    color,
    fontSize: '0.74rem',
    fontWeight: 700,
    height: 24,
  });

  const navItems: {
    icon: typeof DashboardRoundedIcon;
    id: NodeManagerSection | 'minting';
    label: string;
  }[] = [
    {
      icon: DashboardRoundedIcon,
      id: 'overview',
      label: t('node:manager.section.overview', capitalize),
    },
    // The minting window refuses the public node: no way in from here.
    ...(isPublic
      ? []
      : [
          {
            icon: BoltRoundedIcon,
            id: 'minting' as const,
            label: t('node:manager.section.minting', capitalize),
          },
        ]),
  ];

  return (
    <Dialog
      aria-labelledby={titleId}
      fullWidth
      maxWidth={false}
      onClose={onClose}
      open={open}
      // The minting window's frame: the two read as one family.
      BackdropProps={{ sx: windowBackdropSx }}
      PaperProps={{
        sx: {
          ...windowPaperSx(theme),
          display: 'flex',
          flexDirection: 'column',
          height: { md: 'min(86vh, 920px)', xs: 'calc(100vh - 32px)' },
          m: { md: 3, xs: 2 },
          maxHeight: 'calc(100vh - 24px)',
          maxWidth: 'none',
          overflow: 'hidden',
          width: {
            md: 'min(1180px, calc(100vw - 48px))',
            xs: 'calc(100vw - 24px)',
          },
        },
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          borderBottom: `1px solid ${alpha(theme.palette.divider, 0.42)}`,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1.5,
          justifyContent: 'space-between',
          minHeight: 60,
          px: { md: 2.75, xs: 2 },
          py: 1.1,
        }}
      >
        <Box
          sx={{ alignItems: 'center', display: 'flex', gap: 1.25, minWidth: 0 }}
        >
          <NodeStateLogo
            alt=""
            highlighted
            mintingSrc={qortalLogoMinting}
            size={30}
            src={qortalLogoOfficial}
            state={nodeState}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography
              component="h2"
              id={titleId}
              sx={{
                fontSize: '1.12rem',
                fontWeight: 800,
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
              }}
            >
              {t('node:manager.title')}
            </Typography>
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.84rem',
                mt: 0.45,
              }}
            >
              {t(`core:node_state.${nodeState}`)}
            </Typography>
          </Box>
        </Box>
        <Box
          aria-live="polite"
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0.75,
          }}
        >
          <Chip
            label={
              isSyncing
                ? t('node:manager.sync.syncing', {
                    percent: status.syncPercent ?? 0,
                  })
                : t('node:manager.sync.synced', capitalize)
            }
            size="small"
            sx={chipSx(toneOf(theme, isSyncing ? 'syncing' : 'active').accent)}
          />
          {typeof status.height === 'number' ? (
            <Chip
              label={t('node:manager.status.height', {
                height: formatCount(status.height, i18n.language),
              })}
              size="small"
              sx={chipSx(theme.palette.text.secondary)}
            />
          ) : null}
          {typeof status.numberOfConnections === 'number' ? (
            <Chip
              label={t('node:manager.status.peers', {
                peers: formatCount(status.numberOfConnections, i18n.language),
              })}
              size="small"
              sx={chipSx(theme.palette.text.secondary)}
            />
          ) : null}
          <Chip
            label={t(
              nodeState === 'minting'
                ? 'core:core.minting'
                : 'core:core.not_minting',
              capitalize
            )}
            size="small"
            sx={chipSx(
              nodeState === 'minting'
                ? theme.palette.other.minting
                : theme.palette.text.secondary
            )}
          />
          <IconButton
            aria-label={t('core:action.close', capitalize)}
            onClick={onClose}
            sx={{
              borderRadius: '8px',
              color: theme.palette.text.secondary,
              height: 34,
              ml: 0.5,
              width: 34,
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
                color: theme.palette.text.primary,
              },
            }}
          >
            <CloseIcon />
          </IconButton>
        </Box>
      </Box>

      <Box
        sx={{
          display: 'grid',
          flex: '1 1 auto',
          gridTemplateColumns: {
            md: '200px minmax(0, 1fr)',
            xs: 'minmax(0, 1fr)',
          },
          gridTemplateRows: { md: 'minmax(0, 1fr)', xs: 'auto minmax(0, 1fr)' },
          minHeight: 0,
        }}
      >
        <Box
          aria-label={t('node:manager.sections', capitalize)}
          component="nav"
          sx={{
            ...quietSurfaceSx(theme),
            borderBottom: {
              md: 'none',
              xs: `1px solid ${alpha(theme.palette.divider, 0.42)}`,
            },
            borderRight: {
              md: `1px solid ${alpha(theme.palette.divider, 0.42)}`,
              xs: 'none',
            },
            display: 'flex',
            flexDirection: { md: 'column', xs: 'row' },
            gap: 0.5,
            overflow: 'hidden',
            overflowX: { md: 'hidden', xs: 'auto' },
            p: 1.5,
            position: 'relative',
          }}
        >
          {/* The minting window's watermark, as faint. */}
          <Box
            alt=""
            aria-hidden
            component="img"
            src={mintingWatermark}
            sx={{
              bottom: -70,
              display: { md: 'block', xs: 'none' },
              filter: 'saturate(0.92) brightness(0.88)',
              left: -56,
              opacity: 0.04,
              pointerEvents: 'none',
              position: 'absolute',
              userSelect: 'none',
              width: 300,
              zIndex: 0,
            }}
          />
          <Typography
            aria-hidden
            sx={{
              ...sectionLabelSx(theme),
              display: { md: 'block', xs: 'none' },
              mb: 0.5,
              px: 1.25,
              pt: 0.5,
            }}
          >
            {t('node:manager.sections')}
          </Typography>
          {navItems.map(({ icon: Icon, id, label }) => {
            const selected = id === section;
            const opensWindow = id === 'minting';
            return (
              <ButtonBase
                aria-current={selected ? 'page' : undefined}
                // Says that it opens a window of its own, after its name.
                aria-label={
                  opensWindow
                    ? t('node:manager.section.minting_opens_window', capitalize)
                    : undefined
                }
                key={id}
                onClick={() =>
                  opensWindow ? openMinting() : onSectionChange(id)
                }
                sx={{
                  alignItems: 'center',
                  backgroundColor: selected
                    ? alpha(theme.palette.primary.main, 0.12)
                    : 'transparent',
                  border: `1px solid ${
                    selected
                      ? alpha(theme.palette.primary.main, 0.22)
                      : 'transparent'
                  }`,
                  borderRadius: '10px',
                  color: selected
                    ? theme.palette.text.primary
                    : theme.palette.text.secondary,
                  display: 'flex',
                  flexShrink: 0,
                  gap: 1.25,
                  justifyContent: 'flex-start',
                  position: 'relative',
                  px: 1.25,
                  py: 1,
                  textAlign: 'left',
                  zIndex: 1,
                  '&:hover': {
                    backgroundColor: theme.palette.action.hover,
                    color: theme.palette.text.primary,
                  },
                  '&.Mui-focusVisible': {
                    outline: `2px solid ${theme.palette.primary.main}`,
                  },
                }}
              >
                <Icon sx={{ fontSize: 20 }} />
                <Typography
                  sx={{
                    flex: 1,
                    fontSize: '0.9rem',
                    fontWeight: selected ? 700 : 600,
                  }}
                >
                  {label}
                </Typography>
                {opensWindow ? (
                  <OpenInNewRoundedIcon aria-hidden sx={{ fontSize: 16 }} />
                ) : null}
              </ButtonBase>
            );
          })}
        </Box>

        <Box
          sx={{
            minHeight: 0,
            overflowY: 'auto',
            px: { md: 2.75, xs: 2 },
            py: { md: 2.75, xs: 2.25 },
          }}
        >
          {section === 'overview' ? (
            <NodeOverview
              // A new node starts over.
              isPublic={isPublic}
              key={nodeBase}
              nodeBase={nodeBase}
              onOpenMinting={openMinting}
              onSetUpNode={setUpNode}
            />
          ) : null}
        </Box>
      </Box>
    </Dialog>
  );
};
