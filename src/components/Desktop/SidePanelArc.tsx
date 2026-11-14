import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import { Box, IconButton, Tooltip } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  type ReactNode,
  type Ref,
  type WheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type SidePanelItem, sidePanelItemKey } from './sidePanel';

/** A button on the rim, round. */
export const ARC_ITEM_PX = 48;
/** From the half circle's centre to the buttons' centres. */
const ARC_RADIUS_PX = 122;
/** The half circle's radius: the panel is this wide and twice as tall. */
export const ARC_OUTER_PX = ARC_RADIUS_PX + ARC_ITEM_PX / 2 + 16;
/** Between two buttons on the rim. */
const ARC_STEP_DEG = 22;
/**
 * The buttons fill the rim from this far above the centre to as far below:
 * nearer the edge they'd be cut off.
 */
const ARC_SPAN_DEG = 70;
/** A divider takes half a button's room: a dot between two groups. */
const DIVIDER_WEIGHT = 0.5;
/** Scrolling this far turns the rim one button on. */
const WHEEL_STEP_PX = 40;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Where each button sits along the rim, in buttons from the first one
 * (a divider counts half), and how far the rim turns.
 */
export const arcPositions = (items: readonly SidePanelItem[]) => {
  const weights = items.map((item) =>
    item.kind === 'divider' ? DIVIDER_WEIGHT : 1
  );
  const positions: number[] = [];
  weights.forEach((weight, index) => {
    positions.push(
      index === 0 ? 0 : positions[index - 1] + (weights[index - 1] + weight) / 2
    );
  });
  const length = positions.length ? positions[positions.length - 1] : 0;
  const room = (2 * ARC_SPAN_DEG) / ARC_STEP_DEG;
  return { length, maxTurn: Math.max(0, length - room), positions, room };
};

/**
 * The angle of the button at `position` (degrees, 0 straight out, minus
 * above): centred while they all fit, else from the top, turned by `turn`.
 */
export const arcAngle = (
  position: number,
  length: number,
  room: number,
  turn: number
) =>
  length <= room
    ? (position - length / 2) * ARC_STEP_DEG
    : -ARC_SPAN_DEG + (position - turn) * ARC_STEP_DEG;

type SidePanelArcProps = {
  items: readonly SidePanelItem[];
  /** The button an item is, as the bar shows it. */
  renderItem: (item: SidePanelItem) => ReactNode;
  labelOf: (item: SidePanelItem) => string;
  shown: boolean;
  /** Its centre's height, in px from the top of the room it's placed in. */
  centerY: number;
  /** How much of its background shows, 0 to 1. */
  background: number;
  /** A bit smaller or bigger, with the buttons: 1 as designed. */
  scale?: number;
  surfaceColor: string;
  editLabel: string;
  editDisabled: boolean;
  onEdit: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** The half circle itself, to tell whether the pointer is on it. */
  panelRef?: Ref<HTMLDivElement>;
};

/**
 * The side panel as a half circle on the left edge: the buttons round its
 * rim, the edit button at its centre. Scrolling over it turns the rim, so
 * any number of buttons fit; moving the focus to a button turns it into
 * view.
 */
export const SidePanelArc = ({
  items,
  renderItem,
  labelOf,
  shown,
  centerY,
  background,
  scale = 1,
  surfaceColor,
  editLabel,
  editDisabled,
  onEdit,
  onMouseEnter,
  onMouseLeave,
  panelRef,
}: SidePanelArcProps) => {
  const theme = useTheme();
  const { length, maxTurn, positions, room } = useMemo(
    () => arcPositions(items),
    [items]
  );
  const [turn, setTurn] = useState(0);
  const wheelRef = useRef(0);
  useEffect(() => {
    setTurn((current) => clamp(current, 0, maxTurn));
  }, [maxTurn]);

  const onWheel = (event: WheelEvent<HTMLElement>) => {
    if (maxTurn <= 0) return;
    wheelRef.current += event.deltaY;
    const steps = Math.trunc(wheelRef.current / WHEEL_STEP_PX);
    if (!steps) return;
    wheelRef.current -= steps * WHEEL_STEP_PX;
    setTurn((current) => clamp(Math.round(current) + steps, 0, maxTurn));
  };

  const ringColor = alpha(theme.palette.text.primary, 0.08 * background + 0.04);
  // All of it, the rim and its buttons too, scaled together.
  const outer = Math.round(ARC_OUTER_PX * scale);
  return (
    <Box
      data-side-panel-layout="arc"
      onMouseEnter={onMouseEnter}
      ref={panelRef}
      onMouseLeave={onMouseLeave}
      onWheel={onWheel}
      sx={{
        backdropFilter:
          background > 0 && background < 1 ? 'blur(10px)' : 'none',
        backgroundColor: alpha(surfaceColor, background),
        border: `1px solid ${alpha(theme.palette.border.subtle, background)}`,
        borderLeft: 'none',
        borderRadius: `0 ${outer}px ${outer}px 0`,
        boxShadow:
          background >= 0.5 ? `8px 0 24px ${alpha('#000', 0.18)}` : 'none',
        height: `${2 * outer}px`,
        left: 0,
        opacity: shown ? 1 : 0,
        overflow: 'hidden',
        pointerEvents: shown ? 'auto' : 'none',
        position: 'fixed',
        top: `${centerY - outer}px`,
        transform: shown ? 'translateX(0)' : 'translateX(-100%)',
        transition:
          'transform 200ms cubic-bezier(0.2, 0, 0, 1), opacity 200ms cubic-bezier(0.2, 0, 0, 1), background-color 200ms ease',
        width: `${outer}px`,
        zIndex: 9998,
      }}
    >
      <Box
        sx={{
          height: `${2 * ARC_OUTER_PX}px`,
          left: 0,
          position: 'absolute',
          top: 0,
          width: `${ARC_OUTER_PX}px`,
          zoom: scale,
        }}
      >
        {/* The rim the buttons go round on. */}
        <Box
          aria-hidden
          sx={{
            border: `1px dashed ${ringColor}`,
            borderRadius: '50%',
            height: `${2 * ARC_RADIUS_PX}px`,
            left: `${-ARC_RADIUS_PX}px`,
            pointerEvents: 'none',
            position: 'absolute',
            top: `${ARC_OUTER_PX - ARC_RADIUS_PX}px`,
            width: `${2 * ARC_RADIUS_PX}px`,
          }}
        />
        {items.map((item, index) => {
          const angle = arcAngle(positions[index], length, room, turn);
          const radians = (angle * Math.PI) / 180;
          const x = ARC_RADIUS_PX * Math.cos(radians) - ARC_ITEM_PX / 2;
          const y =
            ARC_OUTER_PX + ARC_RADIUS_PX * Math.sin(radians) - ARC_ITEM_PX / 2;
          // Past the ends of the rim they fade out and can't be clicked.
          const beyond = Math.abs(angle) - ARC_SPAN_DEG;
          const opacity = beyond <= 0 ? 1 : clamp(1 - beyond / 20, 0, 1);
          const key = sidePanelItemKey(item);
          const slot = (
            <Box
              data-angle={Math.round(angle)}
              data-side-panel-slot={key}
              key={key}
              onFocusCapture={() => {
                if (length <= room) return;
                const needed = clamp(positions[index] - room / 2, 0, maxTurn);
                if (beyond > -ARC_STEP_DEG / 2) setTurn(needed);
              }}
              sx={{
                alignItems: 'center',
                display: 'flex',
                height: `${ARC_ITEM_PX}px`,
                justifyContent: 'center',
                left: 0,
                opacity,
                pointerEvents: opacity > 0.5 ? 'auto' : 'none',
                position: 'absolute',
                top: 0,
                transform: `translate(${x}px, ${y}px)`,
                transition:
                  'transform 220ms cubic-bezier(0.2, 0, 0, 1), opacity 220ms ease',
                width: `${ARC_ITEM_PX}px`,
                // The bar's buttons, round and without their names.
                '& .sidebarItemLabel': { display: 'none' },
                '& .sidePanelItem, & .MuiButtonBase-root': {
                  borderRadius: '50%',
                  gap: 0,
                  height: `${ARC_ITEM_PX}px`,
                  justifyContent: 'center',
                  minHeight: 0,
                  p: 0,
                  width: `${ARC_ITEM_PX}px`,
                },
                '& .MuiButtonBase-root > :not(.sidebarSelectorIconWrap):not(.sidebarItemIconWrap)':
                  { display: 'none' },
              }}
            >
              {item.kind === 'divider' ? (
                <Box
                  aria-hidden
                  sx={{
                    backgroundColor: alpha(theme.palette.text.primary, 0.3),
                    borderRadius: '50%',
                    height: 6,
                    width: 6,
                  }}
                />
              ) : (
                renderItem(item)
              )}
            </Box>
          );
          // The node's button has the node's information as its tooltip.
          return item.kind === 'divider' || item.kind === 'info' ? (
            slot
          ) : (
            <Tooltip key={key} placement="right" title={labelOf(item)}>
              {slot}
            </Tooltip>
          );
        })}
        <Tooltip placement="right" title={editLabel}>
          <IconButton
            aria-label={editLabel}
            disabled={editDisabled}
            onClick={onEdit}
            size="small"
            sx={{
              color: theme.palette.text.secondary,
              left: 6,
              position: 'absolute',
              top: `${ARC_OUTER_PX - 17}px`,
            }}
          >
            <TuneRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
};
