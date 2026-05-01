import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { nodeInfosAtom, selectedNodeInfoAtom } from '../../../atoms/global';
import { getBaseApiReact } from '../../../App';
import { useAuth } from '../../../hooks/useAuth';
import type { ApiKey } from '../../../types/auth';
import {
  getDefaultLocalNodeUrl,
  HTTPS_EXT_NODE_QORTAL_LINK,
  isLocalNodeUrl,
} from '../../../constants/constants';
import type { DashboardNodeOption } from './types';
import {
  getDashboardNodeHost,
  normalizeDashboardCustomNodes,
  normalizeDashboardNodeUrl,
} from './utils';

export function useDashboardNodeMenu() {
  const selectedNode = useAtomValue(selectedNodeInfoAtom);
  const setNodeInfos = useSetAtom(nodeInfosAtom);
  const { getBalanceFunc, handleSaveNodeInfo } = useAuth();
  const { t } = useTranslation(['core', 'group', 'tutorial', 'auth']);
  const td = useCallback(
    (key: string, defaultValue: string) =>
      t(`group:dashboard.${key}`, { defaultValue }),
    [t]
  );

  const [dashboardCustomNodes, setDashboardCustomNodes] = useState<ApiKey[]>(
    []
  );
  const [nodeMenuAnchorEl, setNodeMenuAnchorEl] = useState<HTMLElement | null>(
    null
  );
  const [isSwitchingNodeUrl, setIsSwitchingNodeUrl] = useState('');
  const [nodeSwitchError, setNodeSwitchError] = useState('');

  const selectedNodeUrl = normalizeDashboardNodeUrl(
    selectedNode?.url || getBaseApiReact()
  );
  const publicNodeUrl = normalizeDashboardNodeUrl(HTTPS_EXT_NODE_QORTAL_LINK);

  const loadDashboardCustomNodes = useCallback(async () => {
    try {
      const nodes = normalizeDashboardCustomNodes(
        await window.sendMessage('getCustomNodesFromStorage')
      );
      setDashboardCustomNodes(nodes);
      window.electronAPI?.setAllowedDomains?.(nodes.map((node) => node.url));
    } catch (error) {
      console.error(error);
      setDashboardCustomNodes([]);
    }
  }, []);

  const handleOpenNodeMenu = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      setNodeSwitchError('');
      setNodeMenuAnchorEl(event.currentTarget);
      loadDashboardCustomNodes();
    },
    [loadDashboardCustomNodes]
  );

  const handleCloseNodeMenu = useCallback(() => {
    if (isSwitchingNodeUrl) return;
    setNodeMenuAnchorEl(null);
  }, [isSwitchingNodeUrl]);

  const dashboardNodeOptions = useMemo<DashboardNodeOption[]>(() => {
    const nodes = dashboardCustomNodes.filter((node) => {
      const nodeUrl = normalizeDashboardNodeUrl(node.url);
      return nodeUrl && nodeUrl !== publicNodeUrl && !isLocalNodeUrl(nodeUrl);
    });
    const localNodeUrl = normalizeDashboardNodeUrl(getDefaultLocalNodeUrl());
    const localNodeOption: DashboardNodeOption | null = isLocalNodeUrl(
      selectedNodeUrl
    )
      ? null
      : {
          key: 'local',
          label: 'Local Node',
          node: { url: localNodeUrl, apikey: '' },
          secondary: getDashboardNodeHost(localNodeUrl),
          type: 'local',
        };

    if (
      selectedNodeUrl &&
      selectedNodeUrl !== publicNodeUrl &&
      !isLocalNodeUrl(selectedNodeUrl) &&
      !nodes.some(
        (node) => normalizeDashboardNodeUrl(node.url) === selectedNodeUrl
      )
    ) {
      nodes.unshift({
        url: selectedNodeUrl,
        apikey: selectedNode?.apikey || '',
        name: selectedNode?.name || '',
      } as ApiKey);
    }

    return [
      ...nodes.map((node) => {
        const nodeUrl = normalizeDashboardNodeUrl(node.url);
        const host = getDashboardNodeHost(nodeUrl);
        return {
          key: `custom:${nodeUrl}`,
          label: node.name || host,
          node: { ...node, url: nodeUrl },
          secondary: host,
          type: 'custom' as const,
        };
      }),
      ...(localNodeOption ? [localNodeOption] : []),
      {
        key: 'public',
        label: 'Public Node',
        node: { url: HTTPS_EXT_NODE_QORTAL_LINK, apikey: '' },
        secondary: getDashboardNodeHost(HTTPS_EXT_NODE_QORTAL_LINK),
        type: 'public' as const,
      },
    ];
  }, [
    dashboardCustomNodes,
    publicNodeUrl,
    selectedNode?.apikey,
    selectedNode?.name,
    selectedNodeUrl,
  ]);

  const handleSelectDashboardNode = useCallback(
    async (option: DashboardNodeOption) => {
      const nextUrl = normalizeDashboardNodeUrl(option.node.url);
      if (!nextUrl || isSwitchingNodeUrl) return;

      if (nextUrl === selectedNodeUrl) {
        setNodeMenuAnchorEl(null);
        return;
      }

      try {
        setNodeSwitchError('');
        setIsSwitchingNodeUrl(nextUrl);
        let nodeToSave = option.node;

        if (option.type === 'local') {
          const apiKey = window?.coreSetup?.getApiKey
            ? await window.coreSetup.getApiKey()
            : '';
          nodeToSave = { ...option.node, apikey: apiKey || '' };

          if (nextUrl.startsWith('https://')) {
            const certResult = await window.electronAPI?.ensureCertForBase?.(
              nextUrl,
              apiKey || ''
            );

            if (!certResult?.success) {
              throw new Error(
                certResult?.error || 'Unable to prepare local HTTPS certificate'
              );
            }
          }
        }

        await handleSaveNodeInfo(nodeToSave);
        setNodeInfos({});
        await getBalanceFunc();
        setNodeMenuAnchorEl(null);
      } catch (error) {
        console.error(error);
        setNodeSwitchError('Could not switch nodes right now.');
      } finally {
        setIsSwitchingNodeUrl('');
      }
    },
    [
      getBalanceFunc,
      handleSaveNodeInfo,
      isSwitchingNodeUrl,
      selectedNodeUrl,
      setNodeInfos,
    ]
  );

  useEffect(() => {
    loadDashboardCustomNodes();
  }, [loadDashboardCustomNodes]);

  return {
    dashboardNodeOptions,
    handleCloseNodeMenu,
    handleOpenNodeMenu,
    handleSelectDashboardNode,
    isSwitchingNodeUrl,
    nodeMenuAnchorEl,
    nodeSwitchError,
    selectedNodeUrl,
    td,
  };
}
