import { useAtomValue } from 'jotai';
import { nodeInfosAtom, selectedNodeInfoAtom } from '../../atoms/global';
import {
  EXT_NODE_QORTAL_LINK,
  HTTPS_EXT_NODE_QORTAL_LINK,
} from '../../constants/constants';

/**
 * Which node the Hub is on, as the Qortal logo shows it:
 * - `public`: the public node (the gateway), grey;
 * - `own`: a node of the user's own (local or chosen), blue;
 * - `minting`: the user's own node minting, blue with a gold ring.
 */
export type NodeState = 'public' | 'own' | 'minting';

/**
 * The node state for the selected node's address and its status. The
 * public node never counts as minting: the Hub can't mint there. Without a
 * node chosen, the Hub uses the public one.
 */
export const nodeStateFor = (
  nodeUrl: string | null | undefined,
  nodeStatus: { isMintingPossible?: boolean } | null | undefined
): NodeState => {
  const url = nodeUrl || HTTPS_EXT_NODE_QORTAL_LINK;
  if (url.includes(EXT_NODE_QORTAL_LINK)) return 'public';
  return nodeStatus?.isMintingPossible ? 'minting' : 'own';
};

/** The node state now, following the node chosen and its status. */
export const useNodeState = (): NodeState => {
  const selectedNode = useAtomValue(selectedNodeInfoAtom);
  const nodeInfos = useAtomValue(nodeInfosAtom) as {
    isMintingPossible?: boolean;
  };
  return nodeStateFor(selectedNode?.url, nodeInfos);
};
