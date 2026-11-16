import { Box } from '@mui/material';
import type { NodeState } from './nodeState';

type NodeStateLogoProps = {
  state: NodeState;
  src: string;
  /** The same logo with its small cube in gold, shown while minting. */
  mintingSrc?: string;
  /** The logo's height in px; it keeps its own proportions. */
  size: number;
  /** Empty when a label next to it already names it. */
  alt: string;
  /** Hovered or open: a public node's logo shows its colour then. */
  highlighted?: boolean;
};

const GREY_FILTER =
  'grayscale(0.82) saturate(0.32) brightness(0.82) contrast(0.9)';
const COLOUR_FILTER = 'grayscale(0) saturate(1) brightness(1) contrast(1)';

/**
 * The Qortal logo in the colours of the node the Hub is on: grey on the
 * public node, blue on the user's own node, and blue with its small cube in
 * gold while that node mints.
 */
export const NodeStateLogo = ({
  state,
  src,
  mintingSrc,
  size,
  alt,
  highlighted = false,
}: NodeStateLogoProps) => {
  const grey = state === 'public' && !highlighted;
  return (
    <Box
      alt={alt}
      component="img"
      data-node-state={state}
      src={state === 'minting' && mintingSrc ? mintingSrc : src}
      sx={{
        display: 'block',
        filter: grey ? GREY_FILTER : COLOUR_FILTER,
        flexShrink: 0,
        height: `${size}px`,
        objectFit: 'contain',
        opacity: grey ? 0.78 : 1,
        transform: highlighted ? 'scale(1.02)' : 'scale(1)',
        transition: 'filter 0.2s ease, opacity 0.2s ease, transform 0.2s ease',
        width: 'auto',
      }}
    />
  );
};
