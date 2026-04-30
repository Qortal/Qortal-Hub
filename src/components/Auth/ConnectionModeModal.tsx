import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  ButtonBase,
  Dialog,
  IconButton,
  Link,
  Typography,
  useTheme,
} from '@mui/material';
import ComputerRoundedIcon from '@mui/icons-material/ComputerRounded';
import CloudRoundedIcon from '@mui/icons-material/CloudRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DnsRoundedIcon from '@mui/icons-material/DnsRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import { AuthButton, AuthInput } from './AuthShell';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  isOpenCoreSetup,
  selectedNodeInfoAtom,
} from '../../atoms/global';
import {
  getDefaultLocalNodeUrl,
  HTTPS_EXT_NODE_QORTAL_LINK,
  isLocalNodeUrl,
} from '../../constants/constants';
import { useAuth } from '../../hooks/useAuth';
import type { ApiKey } from '../../types/auth';

type ConnectionModeModalProps = {
  open: boolean;
  onClose: () => void;
};

type ConnectionMode = 'local' | 'public' | 'custom';

const CUSTOM_NODE_DRAG_DATA = 'application/x-qortal-custom-node-index';

function isManualNode(url?: string | null) {
  if (!url) return false;
  return !isLocalNodeUrl(url) && url !== HTTPS_EXT_NODE_QORTAL_LINK;
}

function normalizeNodeUrl(url: string) {
  return url.trim().replace(/\/+$/, '');
}

function normalizeCustomNodes(nodes: unknown): ApiKey[] {
  if (!Array.isArray(nodes)) return [];

  return nodes
    .map((node) => ({
      url: typeof node?.url === 'string' ? normalizeNodeUrl(node.url) : '',
      apikey: typeof node?.apikey === 'string' ? node.apikey : '',
      name: typeof node?.name === 'string' ? node.name.trim() : '',
    }))
    .filter((node) => Boolean(node.url));
}

export function ConnectionModeModal({
  open,
  onClose,
}: ConnectionModeModalProps) {
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core']);
  const selectedNode = useAtomValue(selectedNodeInfoAtom);
  const setOpenCoreSetup = useSetAtom(isOpenCoreSetup);
  const { handleSaveNodeInfo } = useAuth();
  const [selectedMode, setSelectedMode] = useState<ConnectionMode>('local');
  const [showManual, setShowManual] = useState(false);
  const [localCoreStatus, setLocalCoreStatus] = useState<
    'checking' | 'running' | 'missing'
  >('checking');
  const [customNodes, setCustomNodes] = useState<ApiKey[]>([]);
  const [selectedCustomNodeUrl, setSelectedCustomNodeUrl] = useState('');
  const [manualNodeName, setManualNodeName] = useState('');
  const [manualNodeUrl, setManualNodeUrl] = useState('');
  const [manualApiKey, setManualApiKey] = useState('');
  const [editingNodeUrl, setEditingNodeUrl] = useState<string | null>(null);
  const [dragOverCustomNodeIndex, setDragOverCustomNodeIndex] = useState<
    number | null
  >(null);
  const isDraggingCustomNodeRef = useRef(false);

  const syncAllowedDomains = useCallback((nodes: ApiKey[]) => {
    if (window?.electronAPI?.setAllowedDomains) {
      window.electronAPI.setAllowedDomains(nodes.map((node) => node.url));
    }
  }, []);

  const getSelectedCustomNode = useCallback((): ApiKey | null => {
    if (!isManualNode(selectedNode?.url)) return null;

    return {
      url: normalizeNodeUrl(selectedNode?.url || ''),
      apikey: selectedNode?.apikey || '',
      name: selectedNode?.name || '',
    };
  }, [selectedNode?.apikey, selectedNode?.name, selectedNode?.url]);

  const persistCustomNodes = useCallback(
    async (nodes: ApiKey[]) => {
      const normalizedNodes = normalizeCustomNodes(nodes);
      await window.sendMessage('setCustomNodes', normalizedNodes);
      setCustomNodes(normalizedNodes);
      syncAllowedDomains(normalizedNodes);
      return normalizedNodes;
    },
    [syncAllowedDomains]
  );

  const loadCustomNodes = useCallback(async () => {
    try {
      let nodes = normalizeCustomNodes(
        await window.sendMessage('getCustomNodesFromStorage')
      );
      const selectedCustomNode = getSelectedCustomNode();

      if (
        selectedCustomNode &&
        !nodes.some((node) => node.url === selectedCustomNode.url)
      ) {
        nodes = [...nodes, selectedCustomNode];
        await window.sendMessage('setCustomNodes', nodes);
      }

      setCustomNodes(nodes);
      syncAllowedDomains(nodes);
    } catch (error) {
      console.error(error);
      setCustomNodes([]);
    }
  }, [getSelectedCustomNode, syncAllowedDomains]);

  useEffect(() => {
    if (!open) return;
    if (selectedNode?.url === HTTPS_EXT_NODE_QORTAL_LINK) {
      setSelectedMode('public');
      setSelectedCustomNodeUrl('');
    } else if (isManualNode(selectedNode?.url)) {
      const selectedUrl = normalizeNodeUrl(selectedNode?.url || '');
      setSelectedMode('custom');
      setSelectedCustomNodeUrl(selectedUrl);
      setManualNodeName(selectedNode?.name || '');
      setManualNodeUrl(selectedUrl);
      setManualApiKey(selectedNode?.apikey || '');
    } else {
      setSelectedMode('local');
      setSelectedCustomNodeUrl('');
    }
  }, [open, selectedNode]);

  useEffect(() => {
    if (!open) return;
    loadCustomNodes();
  }, [loadCustomNodes, open]);

  useEffect(() => {
    if (!open) return;
    let canceled = false;

    const detectLocal = async () => {
      setLocalCoreStatus('checking');
      try {
        if (window?.coreSetup?.isCoreRunning) {
          const running = await window.coreSetup.isCoreRunning();
          if (!canceled) {
            setLocalCoreStatus(running ? 'running' : 'missing');
          }
          return;
        }

        const response = await fetch(`${getDefaultLocalNodeUrl()}/admin/status`);
        if (!canceled) {
          setLocalCoreStatus(response.ok ? 'running' : 'missing');
        }
      } catch (error) {
        if (!canceled) {
          setLocalCoreStatus('missing');
        }
      }
    };

    detectLocal();

    return () => {
      canceled = true;
    };
  }, [open]);

  const localStatusLabel = useMemo(() => {
    if (localCoreStatus === 'running') {
      return t('auth:connection_mode.status_running');
    }
    if (localCoreStatus === 'missing') {
      return t('auth:connection_mode.status_missing');
    }
    return t('auth:connection_mode.status_checking');
  }, [localCoreStatus, t]);

  const localStatusColor = useMemo(() => {
    if (localCoreStatus === 'running') return theme.palette.other.positive;
    if (localCoreStatus === 'missing') return theme.palette.other.warning;
    return theme.palette.text.secondary;
  }, [localCoreStatus, theme.palette.other.positive, theme.palette.other.warning, theme.palette.text.secondary]);

  const saveMode = async () => {
    if (selectedMode === 'local') {
      if (localCoreStatus === 'missing') {
        onClose();
        setOpenCoreSetup(true);
        return;
      }
      await handleSaveNodeInfo({
        url: getDefaultLocalNodeUrl(),
        apikey: '',
      });
    } else if (selectedMode === 'public') {
      await handleSaveNodeInfo({
        url: HTTPS_EXT_NODE_QORTAL_LINK,
        apikey: '',
      });
    } else {
      const selectedCustomNode =
        customNodes.find((node) => node.url === selectedCustomNodeUrl) ||
        getSelectedCustomNode();

      if (!selectedCustomNode?.url) {
        setShowManual(true);
        return;
      }

      await handleSaveNodeInfo(selectedCustomNode);
    }
    onClose();
  };

  const saveManualNode = async () => {
    const normalizedUrl = normalizeNodeUrl(manualNodeUrl);
    if (!normalizedUrl) return;
    const payload = {
      url: normalizedUrl,
      apikey: manualApiKey.trim(),
      name: manualNodeName.trim(),
    };
    await handleSaveNodeInfo(payload);

    try {
      const existingNodes = normalizeCustomNodes(
        await window.sendMessage('getCustomNodesFromStorage')
      );
      const nodeToReplace = editingNodeUrl || normalizedUrl;
      const replaceIndex = existingNodes.findIndex(
        (node) => node.url === nodeToReplace
      );
      const nextNodes: ApiKey[] = [];
      let insertedPayload = false;

      existingNodes.forEach((node, index) => {
        if (index === replaceIndex) {
          nextNodes.push(payload);
          insertedPayload = true;
          return;
        }

        if (node.url === normalizedUrl || node.url === editingNodeUrl) {
          return;
        }

        nextNodes.push(node);
      });

      if (!insertedPayload) {
        nextNodes.push(payload);
      }

      await persistCustomNodes(nextNodes);
    } catch (error) {
      console.error(error);
    }

    setSelectedMode('custom');
    setSelectedCustomNodeUrl(normalizedUrl);
    setEditingNodeUrl(null);
    setShowManual(false);
    onClose();
  };

  const openAddCustomNode = () => {
    setEditingNodeUrl(null);
    setManualNodeName('');
    setManualNodeUrl('https://');
    setManualApiKey('');
    setShowManual(true);
  };

  const openEditCustomNode = (node: ApiKey) => {
    setEditingNodeUrl(node.url);
    setManualNodeName(node.name || '');
    setManualNodeUrl(node.url);
    setManualApiKey(node.apikey || '');
    setShowManual(true);
  };

  const moveCustomNodeItem = useCallback(
    async (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
      if (fromIndex >= customNodes.length || toIndex >= customNodes.length) {
        return;
      }

      const nextNodes = [...customNodes];
      const [movedNode] = nextNodes.splice(fromIndex, 1);
      nextNodes.splice(toIndex, 0, movedNode);

      try {
        await persistCustomNodes(nextNodes);
      } catch (error) {
        console.error(error);
      }
    },
    [customNodes, persistCustomNodes]
  );

  const removeCustomNode = async (nodeToRemove: ApiKey) => {
    const nextNodes = customNodes.filter(
      (node) => node.url !== nodeToRemove.url
    );

    try {
      await persistCustomNodes(nextNodes);
      if (selectedCustomNodeUrl === nodeToRemove.url) {
        setSelectedCustomNodeUrl('');
        setSelectedMode('local');
      }
      if (selectedNode?.url === nodeToRemove.url) {
        await handleSaveNodeInfo({
          url: getDefaultLocalNodeUrl(),
          apikey: '',
        });
      }
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="sm"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              background: '#0d1117',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '10px',
              boxShadow: '0 24px 50px rgba(0,0,0,0.32)',
              maxHeight: 'calc(100vh - 48px)',
              maxWidth: '712px',
            },
          },
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
            px: 3,
            pb: 0,
            pt: 2,
          }}
        >
          <Box sx={{ width: 32 }} />
          <Box sx={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
            <Typography
              sx={{
                fontSize: '1.18rem',
                fontWeight: 800,
                letterSpacing: '-0.01em',
                lineHeight: 1.2,
              }}
            >
              {t('auth:connection_mode.title')}
            </Typography>
            <Typography
              sx={{
                color: 'rgba(214,221,233,0.68)',
                fontSize: '0.88rem',
                mt: 1,
              }}
            >
              {t('auth:connection_mode.subtitle')}
            </Typography>
          </Box>
          <IconButton onClick={onClose} sx={{ color: theme.palette.text.secondary }}>
            <CloseRoundedIcon />
          </IconButton>
        </Box>

        <Box sx={{ px: 3, pb: 3, pt: 3 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <ButtonBase onClick={() => setSelectedMode('local')} sx={modeRowSx(selectedMode === 'local')}>
              <Box sx={modeRadioSx(selectedMode === 'local')}>
                <Box component="span" sx={modeRadioDotSx(selectedMode === 'local')} />
              </Box>
              <ComputerRoundedIcon sx={{ color: '#62A1FF', fontSize: 29, flexShrink: 0 }} />
              <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <Box sx={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 0.8 }}>
                  <Typography sx={modeTitleSx}>
                    {t('auth:connection_mode.local_title')}
                  </Typography>
                  <Box sx={recommendedPillSx}>
                    {t('auth:connection_mode.recommended')}
                  </Box>
                </Box>
                <Typography sx={{ ...modeCopySx, mt: 0.75 }}>
                  {t('auth:connection_mode.local_full_decentralized')}
                </Typography>
                <Typography sx={modeCopySx}>
                  {t('auth:connection_mode.local_faster')}
                </Typography>
                <Typography sx={modeCopySx}>
                  {t('auth:connection_mode.local_data_local')}
                </Typography>
              </Box>
              <Box sx={modeTrailingSx}>
                <Box sx={statusDotSx(localStatusColor)} />
                <Typography sx={statusTextSx(localStatusColor)}>
                  {localStatusLabel}
                </Typography>
                <ChevronRightRoundedIcon sx={{ color: 'rgba(214,221,233,0.7)', fontSize: 25 }} />
              </Box>
            </ButtonBase>

            <ButtonBase onClick={() => setSelectedMode('public')} sx={modeRowSx(selectedMode === 'public')}>
              <Box sx={modeRadioSx(selectedMode === 'public')}>
                <Box component="span" sx={modeRadioDotSx(selectedMode === 'public')} />
              </Box>
              <CloudRoundedIcon sx={{ color: '#9f75ff', fontSize: 30, flexShrink: 0 }} />
              <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <Typography sx={modeTitleSx}>
                  {t('auth:connection_mode.public_title')}
                </Typography>
                <Typography sx={{ ...modeCopySx, mt: 0.75 }}>
                  {t('auth:connection_mode.public_quick')}
                </Typography>
                <Typography sx={modeCopySx}>
                  {t('auth:connection_mode.public_limited_decentralization')}
                </Typography>
                <Typography sx={modeCopySx}>
                  {t('auth:connection_mode.public_shared_infrastructure')}
                </Typography>
              </Box>
              <ChevronRightRoundedIcon sx={{ color: 'rgba(214,221,233,0.7)', fontSize: 25, flexShrink: 0 }} />
            </ButtonBase>

            <Box sx={{ mt: 1.5 }}>
              <Box sx={sectionDividerSx} />
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  justifyContent: 'space-between',
                  mb: 2,
                  pt: 2.5,
                }}
              >
                <Typography sx={sectionTitleSx}>
                  {t('auth:connection_mode.section_custom_nodes')}
                </Typography>
                <ButtonBase
                  onClick={openAddCustomNode}
                  sx={addCustomNodeSx}
                >
                  <AddRoundedIcon sx={{ fontSize: 18 }} />
                  {t('auth:connection_mode.add_custom_node')}
                </ButtonBase>
              </Box>

              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1.5,
                  maxHeight: { xs: 180, sm: 260 },
                  overflowY: 'auto',
                  pr: 0.35,
                }}
              >
                {customNodes.length === 0 && (
                  <Box
                    sx={{
                      border: '1px dashed rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      color: 'rgba(214,221,233,0.48)',
                      fontSize: '0.82rem',
                      px: 1.35,
                      py: 1.1,
                    }}
                  >
                    {t('auth:connection_mode.empty_custom_nodes')}
                  </Box>
                )}

                {customNodes.map((node, index) => {
                  const isSelected =
                    selectedMode === 'custom' &&
                    selectedCustomNodeUrl === node.url;
                  const displayName = node.name?.trim() || node.url;

                  return (
                    <Box
                      key={node.url}
                      role="button"
                      tabIndex={0}
                      draggable
                      onDragStart={(event) => {
                        isDraggingCustomNodeRef.current = true;
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData(
                          CUSTOM_NODE_DRAG_DATA,
                          String(index)
                        );
                        event.dataTransfer.setData('text/plain', String(index));
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                        setDragOverCustomNodeIndex(index);
                      }}
                      onDragLeave={() => {
                        setDragOverCustomNodeIndex((currentIndex) =>
                          currentIndex === index ? null : currentIndex
                        );
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const draggedIndex =
                          event.dataTransfer.getData(CUSTOM_NODE_DRAG_DATA) ||
                          event.dataTransfer.getData('text/plain');
                        const fromIndex = Number(draggedIndex);
                        setDragOverCustomNodeIndex(null);

                        if (Number.isInteger(fromIndex)) {
                          void moveCustomNodeItem(fromIndex, index);
                        }
                      }}
                      onDragEnd={() => {
                        window.setTimeout(() => {
                          isDraggingCustomNodeRef.current = false;
                        }, 0);
                        setDragOverCustomNodeIndex(null);
                      }}
                      onClick={() => {
                        if (isDraggingCustomNodeRef.current) return;
                        setSelectedMode('custom');
                        setSelectedCustomNodeUrl(node.url);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedMode('custom');
                          setSelectedCustomNodeUrl(node.url);
                        }
                      }}
                      sx={customNodeRowSx(
                        isSelected,
                        dragOverCustomNodeIndex === index
                      )}
                    >
                      <Box
                        sx={{
                          alignItems: 'center',
                          display: 'flex',
                          gap: 1,
                          minWidth: 0,
                        }}
                      >
                        <DnsRoundedIcon
                          sx={{
                            color: isSelected
                              ? theme.palette.primary.main
                              : 'rgba(214,221,233,0.52)',
                            fontSize: 20,
                            flexShrink: 0,
                          }}
                        />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography
                            sx={{
                              fontSize: '0.88rem',
                              fontWeight: 700,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {displayName}
                          </Typography>
                          <Typography sx={modeCopySx}>{node.url}</Typography>
                        </Box>
                      </Box>

                      <Box
                        onMouseDown={(event) => event.stopPropagation()}
                        sx={{ display: 'flex', flexShrink: 0, gap: 0.6 }}
                      >
                        <IconButton
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditCustomNode(node);
                          }}
                          sx={{ color: 'rgba(214,221,233,0.54)' }}
                        >
                          <EditRoundedIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                        <IconButton
                          onClick={(event) => {
                            event.stopPropagation();
                            removeCustomNode(node);
                          }}
                          sx={{ color: 'rgba(214,221,233,0.54)' }}
                        >
                          <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </Box>

          <Box sx={modalFooterSx}>
            <Link
              component="button"
              onClick={openAddCustomNode}
              sx={manualNodeLinkSx}
            >
              {t('auth:connection_mode.manual_setup_link')}
            </Link>
            <Button
              onClick={saveMode}
              startIcon={<SaveRoundedIcon sx={{ fontSize: 18 }} />}
              sx={saveSettingsButtonSx}
              variant="contained"
            >
              {t('auth:connection_mode.save_settings')}
            </Button>
          </Box>
        </Box>
      </Dialog>

      <Dialog
        open={showManual}
        onClose={() => {
          setEditingNodeUrl(null);
          setShowManual(false);
        }}
        maxWidth="sm"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              background: '#0d1117',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '10px',
              boxShadow: '0 24px 50px rgba(0,0,0,0.32)',
              maxWidth: '460px',
            },
          },
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
            px: 2.4,
            py: 1.8,
          }}
        >
          <IconButton
            onClick={() => {
              setEditingNodeUrl(null);
              setShowManual(false);
            }}
            sx={{ color: theme.palette.text.secondary }}
          >
            <ArrowBackRoundedIcon />
          </IconButton>
          <Typography sx={{ flex: 1, fontSize: '1.06rem', fontWeight: 700, textAlign: 'center' }}>
            {editingNodeUrl
              ? t('auth:connection_mode.manual_edit_title')
              : t('auth:connection_mode.manual_add_title')}
          </Typography>
          <Box sx={{ width: 40 }} />
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.3, px: 2.4, pb: 2.4 }}>
          <Box>
            <Typography sx={fieldLabelSx}>
              {t('auth:connection_mode.field_name')}
            </Typography>
            <AuthInput
              value={manualNodeName}
              onChange={(event) => setManualNodeName(event.target.value)}
              placeholder={t('auth:connection_mode.placeholder_node_name')}
            />
          </Box>
          <Box>
            <Typography sx={fieldLabelSx}>
              {t('auth:connection_mode.field_node_url')}
            </Typography>
            <AuthInput
              value={manualNodeUrl}
              onChange={(event) => setManualNodeUrl(event.target.value)}
              placeholder={t('auth:connection_mode.placeholder_node_url')}
            />
          </Box>
          <Box>
            <Typography sx={fieldLabelSx}>
              {t('auth:connection_mode.field_api_key_optional')}
            </Typography>
            <AuthInput
              value={manualApiKey}
              onChange={(event) => setManualApiKey(event.target.value)}
              placeholder={t('auth:connection_mode.placeholder_api_key')}
            />
          </Box>

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'space-between',
              mt: 0.6,
            }}
          >
            <Link
              component="button"
              onClick={() => {
                setEditingNodeUrl(null);
                setShowManual(false);
              }}
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.86rem',
                textDecoration: 'none',
              }}
            >
              {t('core:action.return', { postProcess: 'capitalizeFirstChar' })}
            </Link>
            <AuthButton
              disabled={!manualNodeUrl.trim()}
              onClick={saveManualNode}
              fullWidth={false}
            >
              {t('core:action.save', { postProcess: 'capitalizeFirstChar' })}
            </AuthButton>
          </Box>
        </Box>
      </Dialog>
    </>
  );
}

const modeRowSx = (active: boolean) => ({
  alignItems: 'center',
  background: active
    ? 'linear-gradient(180deg, rgba(13,22,37,0.82), rgba(12,19,29,0.82))'
    : 'rgba(255,255,255,0.012)',
  border: active
    ? '1px solid rgba(69, 132, 255, 0.95)'
    : '1px solid rgba(255,255,255,0.075)',
  borderRadius: '8px',
  boxShadow: active ? '0 0 0 1px rgba(69,132,255,0.08)' : 'none',
  display: 'flex',
  gap: { xs: 2, sm: 2.5 },
  justifyContent: 'space-between',
  minHeight: { xs: 116, sm: 118 },
  px: { xs: 1.75, sm: 2.5 },
  py: { xs: 2, sm: 2.15 },
  textAlign: 'left',
  transition:
    'background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease',
  width: '100%',
  '&:hover': {
    backgroundColor: active ? undefined : 'rgba(255,255,255,0.025)',
    borderColor: active ? 'rgba(69,132,255,0.95)' : 'rgba(255,255,255,0.12)',
  },
});

const modeRadioSx = (active: boolean) => ({
  alignItems: 'center',
  border: `2px solid ${active ? '#3E82FF' : 'rgba(214,221,233,0.22)'}`,
  borderRadius: '999px',
  display: 'inline-flex',
  flexShrink: 0,
  height: 24,
  justifyContent: 'center',
  width: 24,
});

const modeRadioDotSx = (active: boolean) => ({
  backgroundColor: active ? '#3E82FF' : 'transparent',
  borderRadius: '999px',
  display: 'block',
  height: 12,
  width: 12,
});

const modeTitleSx = {
  color: 'rgba(246,248,252,0.96)',
  fontSize: '0.98rem',
  fontWeight: 800,
  lineHeight: 1.25,
};

const recommendedPillSx = {
  backgroundColor: 'rgba(62,130,255,0.18)',
  borderRadius: '999px',
  color: '#5390FF',
  fontSize: '0.72rem',
  fontWeight: 700,
  lineHeight: 1,
  px: 1,
  py: 0.52,
};

const modeCopySx = {
  color: 'rgba(214,221,233,0.72)',
  fontSize: '0.82rem',
  lineHeight: 1.62,
};

const modeTrailingSx = {
  alignItems: 'center',
  display: { xs: 'none', sm: 'inline-flex' },
  flexShrink: 0,
  gap: 1,
  justifyContent: 'flex-end',
  ml: 1,
};

const statusDotSx = (color: string) => ({
  backgroundColor: color,
  borderRadius: '999px',
  height: 8,
  width: 8,
});

const statusTextSx = (color: string) => ({
  color,
  fontSize: '0.82rem',
  fontWeight: 800,
  whiteSpace: 'nowrap',
});

const sectionDividerSx = {
  borderTop: '1px solid rgba(255,255,255,0.055)',
};

const sectionTitleSx = {
  color: 'rgba(246,248,252,0.96)',
  fontSize: '0.98rem',
  fontWeight: 800,
};

const addCustomNodeSx = {
  alignItems: 'center',
  alignSelf: 'center',
  color: '#5390FF',
  display: 'inline-flex',
  fontSize: '0.86rem',
  fontWeight: 600,
  gap: 0.45,
  lineHeight: 1,
  minHeight: 26,
  p: 0,
  '&:hover': {
    color: '#7FAAFF',
  },
};

const customNodeRowSx = (active: boolean, isDragOver = false) => ({
  alignItems: 'center',
  backgroundColor: isDragOver
    ? 'rgba(118,165,255,0.08)'
    : active
      ? 'rgba(255,255,255,0.032)'
      : 'rgba(255,255,255,0.012)',
  border: `1px solid ${
    isDragOver
      ? 'rgba(118,165,255,0.4)'
      : active
        ? 'rgba(92,145,255,0.3)'
        : 'rgba(255,255,255,0.075)'
  }`,
  borderRadius: '8px',
  cursor: 'grab',
  display: 'flex',
  gap: 1.5,
  justifyContent: 'space-between',
  minHeight: 84,
  outline: 'none',
  opacity: isDragOver ? 0.78 : 1,
  px: 2,
  py: 2,
  transition:
    'background-color 160ms ease, border-color 160ms ease, opacity 140ms ease',
  '&:active': {
    cursor: 'grabbing',
  },
  '&:hover': {
    backgroundColor: 'rgba(255,255,255,0.032)',
    borderColor: active ? 'rgba(92,145,255,0.34)' : 'rgba(255,255,255,0.12)',
  },
  '&:focus-visible': {
    borderColor: 'rgba(118,165,255,0.42)',
  },
});

const modalFooterSx = {
  alignItems: 'center',
  borderTop: '1px solid rgba(255,255,255,0.055)',
  display: 'flex',
  justifyContent: 'space-between',
  mt: 2.75,
  pt: 3,
};

const manualNodeLinkSx = {
  color: '#5390FF',
  fontSize: '0.86rem',
  fontWeight: 500,
  textDecoration: 'none',
  '&:hover': {
    color: '#7FAAFF',
  },
};

const saveSettingsButtonSx = {
  alignItems: 'center',
  background: 'linear-gradient(180deg, rgba(62,107,214,0.98), rgba(39,83,184,0.98))',
  border: '1px solid rgba(92,145,255,0.24)',
  borderRadius: '6px',
  color: '#f6f8fc',
  display: 'inline-flex',
  fontSize: '0.86rem',
  fontWeight: 600,
  letterSpacing: 0,
  lineHeight: 1.75,
  minHeight: 40,
  minWidth: 174,
  px: 2.4,
  textTransform: 'none',
  transition: 'background 160ms ease, border-color 160ms ease, transform 160ms ease',
  '& .MuiButton-startIcon': {
    mr: 0.8,
  },
  '&:hover': {
    background: 'linear-gradient(180deg, rgba(69,115,224,1), rgba(44,90,193,1))',
    borderColor: 'rgba(118,165,255,0.3)',
    transform: 'translateY(-1px)',
  },
};

const fieldLabelSx = {
  color: 'rgba(214,221,233,0.62)',
  fontSize: '0.74rem',
  fontWeight: 700,
  letterSpacing: '0.08em',
  mb: 0.75,
  textTransform: 'uppercase',
};
