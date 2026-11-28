import { atom } from 'jotai';
import { executeEvent } from '../../utils/events';

/**
 * Whether the Node Manager is open. The node cards on hover stay shut
 * meanwhile: a tooltip would show over the window.
 */
export const nodeManagerOpenAtom = atom(false);

/** Opens the Node Manager; App's `NodeManagerHost` listens for it. */
export const OPEN_NODE_MANAGER_EVENT = 'openNodeManager';

/** The Node Manager's sections that live in its own window. */
export type NodeManagerSection = 'overview';

export const NODE_MANAGER_SECTIONS: NodeManagerSection[] = ['overview'];

export const isNodeManagerSection = (
  value: unknown
): value is NodeManagerSection =>
  NODE_MANAGER_SECTIONS.includes(value as NodeManagerSection);

export const openNodeManager = (section: NodeManagerSection = 'overview') =>
  executeEvent(OPEN_NODE_MANAGER_EVENT, { section });
