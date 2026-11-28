/**
 * What a "Transactions on Qortal" step keeps (useStepState), so Back and
 * Forward show it as it was left: the kind picked, the blocks, the order,
 * the tip it pinned, how many pages it shows, and a block typed in but not
 * shown yet. A list opened from elsewhere (the start page, one transaction's
 * block) starts from a preset.
 */
import {
  cleanBlocks,
  cleanChainFilter,
  cleanOrder,
  FROM_SPAN,
  FROM_SPANS,
  isBlockHeight,
  type ChainPreset,
  type FromSpan,
} from '../../../lib/explorer/chainTx';
import type { StepState } from '../ExplorerContext';

/** The keys of the step's state. */
export const CHAIN_STATE = {
  filter: 'chainFilter',
  blocks: 'chainBlocks',
  order: 'chainOrder',
  tip: 'chainTip',
  shown: 'chainShown',
  draft: 'chainDraft',
} as const;

/** "From a block…" while it is being filled in: the block as typed, and how many blocks. */
export interface FromDraft {
  start: string;
  span: FromSpan;
}

/** The draft as kept, made safe, or null for none. */
export function cleanDraft(value: unknown): FromDraft | null {
  const raw = (value ?? null) as Partial<FromDraft> | null;
  if (!raw || typeof raw.start !== 'string') return null;
  return {
    start: raw.start,
    span: FROM_SPANS.includes(raw.span as FromSpan)
      ? (raw.span as FromSpan)
      : FROM_SPAN,
  };
}

/** How many pages a list shows: of the list it was counted for, else one. */
export interface ChainShown {
  list: string;
  pages: number;
}

/** A new step's state from a preset, each part made safe. */
export function chainStepState(preset: ChainPreset = {}): StepState {
  const state: Record<string, unknown> = {};
  if (isBlockHeight(preset.tip)) state[CHAIN_STATE.tip] = preset.tip;
  if (preset.blocks) state[CHAIN_STATE.blocks] = cleanBlocks(preset.blocks);
  if (preset.order) state[CHAIN_STATE.order] = cleanOrder(preset.order);
  if (preset.filter)
    state[CHAIN_STATE.filter] = cleanChainFilter(preset.filter);
  return state;
}
