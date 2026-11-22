/**
 * Connections as a circle (from Q-Mintership+'s ConnectionsCircle), the
 * way Connections opens: the account in the middle, the accounts it
 * received payments and transfers from on the left, those it sent them to
 * on the right (lib/explorer/circle.ts), each avatar sized by how many
 * transactions went that way and marked with their number, the most first;
 * or, with the toggle between the two headings, by the QORT that moved. An
 * account paid both ways (a Q-Asset trade's partner too) is one avatar at
 * the bottom, its ring and line green and red in proportion to what came in
 * and went out. The links that aren't transfers (reward shares, minting
 * level, names) are a row under the circle, the first 20 and then "Show
 * all"; a link with no one other account is listed under it as the list's
 * row.
 *
 * - Plain SVG lines (decoration) under HTML buttons: the avatars are lists
 *   of buttons, each side its own, in the circle's order, each named with
 *   what it stands for and reached and pressed by keyboard. Pressing one
 *   opens what links them (CircleNodeDialog): the list's evidence, its
 *   transactions counted once each as the dialog lists them.
 * - The text alternative is the list itself ("See the list" here, and the
 *   view toggle above): the same connections, with every account the circle
 *   leaves out. Nothing is listed twice here.
 * - How big it is follows the window: names beside the avatars only where
 *   they fit, fewer and smaller avatars on a phone, and as tall as it must
 *   be for nothing to overlap (circleHeight). In a window bigger than an
 *   ordinary Explorer window (full screen) it grows past Q-Mintership+'s
 *   880 px, centred on the window, with every account it may draw (up to
 *   16 a side and 8 at the bottom) and more room for the names: in the
 *   height the window shows where they fit there, else taller, the window
 *   scrolling (fitCircle). All of it from the CSS px measured and followed
 *   as they change (the window resized, full screen, Hub's zoom), and drawn
 *   at the size it was laid out for: until it is laid out again for a new
 *   size, its places and its names' room stay in step. Avatars pop in one
 *   after another, the lines fade in; never with reduced motion. Hub's
 *   palette, light and dark.
 * - What it draws is what Connections read: a list that couldn't be read
 *   stays above it with Retry, and it says what it is drawn without (a
 *   list that failed, a Refresh that couldn't read again, lists read in
 *   part). With a search typed (the circle pressed again while searching)
 *   it draws the accounts whose rows match, and says so: never "no other
 *   account is linked" over a search. The order, the account opened and
 *   "Show all" belong to the history step.
 */
import { useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Box,
  Button,
  ButtonBase,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, keyframes, useTheme } from '@mui/material/styles';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { useTranslation } from 'react-i18next';
import {
  badgeText,
  bottomNameHeight,
  bottomNames,
  circleNodes,
  fitCircle,
  isCircleOrder,
  LABEL_MARGIN,
  NARROW_LAYOUT,
  nodeRadius,
  nodeWeight,
  receivedShare,
  RING,
  TINY_LAYOUT,
  type AmountRows,
  type CircleLayout,
  type CircleNode,
  type CircleOrder,
  type CircleSide,
  type LayoutOptions,
  type PlacedNode,
} from '../../../lib/explorer/circle';
import type { Finding } from '../../../lib/explorer/findings';
import { formatCount } from '../../../lib/explorer/format';
import { wrapRows } from '../../../lib/explorer/textWidth';
import { useNearScreen, useStepState } from '../ExplorerContext';
import { ExplorerAvatar } from '../ExplorerSearchField';
import { cap, EXPLORER_WINDOW_WIDTH, isolate, mutedText } from '../parts';
import { CircleNodeDialog } from './CircleNodeDialog';
import {
  bothLines,
  nodeWords,
  ringBackground,
  shortMoved,
  sideColours,
} from './circleParts';
import {
  ConnectionRow,
  ROW_LIST_SX,
  useAccountLabel,
  whenText,
} from './ConnectionRow';

/** Around the drawing: room for the avatars at its edges (px). */
const PAD = 24;
/** Other links shown before "Show all", as the list's parts. */
const OTHERS_SHOWN = 20;

// Content arriving, as Q-Mintership+'s: the lines fade in, the avatars pop in
// one after another. Only as they are inserted, never with reduced motion.
const fadeIn = keyframes`from { opacity: 0; }`;
const popIn = keyframes`from { opacity: 0; scale: 0.8; }`;
const enter = (name: ReturnType<typeof keyframes>, easing: string) => ({
  animation: `${name} 200ms ${easing} backwards`,
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
});
/** The widest the drawing is in an ordinary window (px, with its padding), as Q-Mintership+'s. */
const MAX_WIDTH = 880;
/** The drawing's width where its column's can't be read, not laid out (px, inside its padding). */
const UNKNOWN_WIDTH = 720;
/** The side headings and the order above the drawing, and the bottom's heading under it (px, at most). */
const HEAD_ROOM = 68;
const BOTH_HEAD_ROOM = 68;
/** The amounts under a bottom avatar (px): 0.75rem. */
const AMOUNT_PX = 12;

/**
 * The room the circle has, in CSS px, measured and followed as it changes
 * (the window resized, full screen, Hub's zoom: each changes the CSS px it
 * has): its column's width, and the window's content area (the Explorer's
 * scrolling part, `data-explorer-scroll`): how wide it is, how much of it
 * is visible in height, and how far the column is from its sides. Measured
 * once it is in the page, before it is first painted: until then nothing
 * is drawn (`measured`).
 */
interface Room {
  measured: boolean;
  column: number;
  view: { width: number; height: number; before: number; after: number } | null;
}

function sameRoom(a: Room, b: Room): boolean {
  return (
    a.measured === b.measured &&
    a.column === b.column &&
    a.view?.width === b.view?.width &&
    a.view?.height === b.view?.height &&
    a.view?.before === b.view?.before &&
    a.view?.after === b.view?.after
  );
}

function useRoom(node: HTMLElement | null): Room {
  const [room, setRoom] = useState<Room>({
    measured: false,
    column: 0,
    view: null,
  });
  useLayoutEffect(() => {
    if (!node) return undefined;
    const scroller = node.closest<HTMLElement>('[data-explorer-scroll]');
    const update = () => {
      const column = node.clientWidth;
      let view: Room['view'] = null;
      if (scroller) {
        const style = window.getComputedStyle(scroller);
        const px = (value: string) => parseFloat(value) || 0;
        const left = px(style.paddingLeft);
        const width = scroller.clientWidth - left - px(style.paddingRight);
        const height =
          scroller.clientHeight -
          px(style.paddingTop) -
          px(style.paddingBottom);
        // Where the column sits in the content area, left to right.
        const before =
          node.getBoundingClientRect().left -
          scroller.getBoundingClientRect().left -
          scroller.clientLeft -
          left;
        if (width > 0 && height > 0)
          view = {
            width,
            height,
            before,
            after: width - before - column,
          };
      }
      const next = { measured: true, column, view };
      setRoom((was) => (sameRoom(was, next) ? was : next));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    if (scroller) observer.observe(scroller);
    return () => observer.disconnect();
  }, [node]);
  return room;
}

/** Under the drawing (px): room for the names under the bottom avatars, taller where their amounts wrap. */
function bottomPadOf(
  layout: CircleLayout,
  options: LayoutOptions,
  width: number,
  height: number,
  rows: AmountRows
): number {
  const bottom = layout.placed.filter((node) => node.side === 'both');
  if (!options.named || !bottom.length) return PAD;
  const names = bottomNames(bottom, width, height, rows, options.bottomNameMax);
  return (
    16 +
    Math.max(
      36,
      ...bottom.map((node) => bottomNameHeight(names.get(node.key)?.rows ?? 1))
    )
  );
}

function Lines({
  placed,
  order,
  active,
}: {
  placed: PlacedNode[];
  order: CircleOrder;
  active: string | null;
}) {
  const theme = useTheme();
  const colours = sideColours(theme);
  const maxWeight = Math.max(
    order === 'qort' ? 0 : 1,
    ...placed.map((node) => nodeWeight(node, order))
  );
  return (
    <Box
      component="svg"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
      sx={{
        ...enter(fadeIn, 'ease-out'),
        height: '100%',
        inset: 0,
        overflow: 'visible',
        position: 'absolute',
        width: '100%',
      }}
    >
      {placed.map((node) => {
        const width =
          1 +
          2.5 *
            Math.sqrt(maxWeight > 0 ? nodeWeight(node, order) / maxWeight : 0);
        // Paid both ways: green from the middle for the share received, red for the rest.
        const share = receivedShare(node);
        const mx = 50 + (node.x - 50) * share;
        const my = 50 + (node.y - 50) * share;
        const common = {
          strokeWidth: width,
          strokeLinecap: 'butt' as const,
          vectorEffect: 'non-scaling-stroke' as const,
        };
        return (
          <g
            key={node.key}
            data-line={node.key}
            style={{
              opacity: active === null ? 0.45 : active === node.key ? 1 : 0.12,
              transition: 'opacity 150ms ease',
            }}
          >
            {share > 0 ? (
              <line
                x1={50}
                y1={50}
                x2={mx}
                y2={my}
                stroke={colours.in}
                {...common}
              />
            ) : null}
            {share < 1 ? (
              <line
                x1={mx}
                y1={my}
                x2={node.x}
                y2={node.y}
                stroke={colours.out}
                {...common}
              />
            ) : null}
          </g>
        );
      })}
    </Box>
  );
}

/**
 * How many transactions an avatar stands for, or the QORT that moved, on
 * its corner. Drawn by CSS: the button's name already says it.
 */
function CountBadge({ text, side }: { text: string; side: CircleSide }) {
  return (
    <Box
      aria-hidden
      data-count={text}
      sx={(theme) => {
        const colours = sideColours(theme);
        return {
          alignItems: 'center',
          backgroundColor: theme.palette.background.paper,
          border: `1.5px solid ${
            side === 'in'
              ? colours.in
              : side === 'out'
                ? colours.out
                : side === 'both'
                  ? theme.palette.text.secondary
                  : colours.other
          }`,
          borderRadius: '10px',
          bottom: -4,
          color: theme.palette.text.primary,
          display: 'flex',
          fontSize: 12,
          fontWeight: 700,
          height: 20,
          justifyContent: 'center',
          lineHeight: 1,
          minWidth: 20,
          position: 'absolute',
          px: 0.5,
          right: -4,
          '&::after': { content: 'attr(data-count)' },
        };
      }}
    />
  );
}

function CircleNodeButton({
  node,
  index,
  order,
  named,
  room,
  near,
  onActive,
  onPick,
}: {
  node: PlacedNode;
  /** Its place in its side's list: when it pops in. */
  index: number;
  order: CircleOrder;
  /** Its name beside it (on the outer side), or under it at the bottom. */
  named: boolean;
  /** How wide its name may be (px). */
  room: number;
  near: boolean;
  onActive: (key: string | null) => void;
  onPick: (node: CircleNode) => void;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const theme = useTheme();
  const { name, label } = useAccountLabel(node.address, near);
  const words = nodeWords(node, t, language);
  const below = node.side === 'both';
  const badge = badgeText(node, order, language);
  const moved = below ? null : shortMoved(node, language);
  const lines = below ? bothLines(node, t, language) : [];
  const target = nodeRadius(node.size) * 2;
  return (
    <Box
      component="li"
      sx={{
        left: `${node.x}%`,
        listStyle: 'none',
        position: 'absolute',
        top: `${node.y}%`,
        translate: '-50% -50%',
        zIndex: 1,
      }}
    >
      <Box
        sx={{
          ...enter(popIn, 'cubic-bezier(0.2, 0, 0, 1)'),
          position: 'relative',
        }}
        style={{ animationDelay: `${Math.min(index, 24) * 30}ms` }}
      >
        <Tooltip
          disableInteractive
          title={
            <>
              <bdi dir="auto">{label}</bdi>
              <br />
              {words}
            </>
          }
        >
          <ButtonBase
            onClick={() => onPick(node)}
            aria-label={t('explorer:circle.node.open', {
              name: isolate(label),
              words,
            })}
            onMouseEnter={() => onActive(node.key)}
            onMouseLeave={() => onActive(null)}
            onFocus={() => onActive(node.key)}
            onBlur={() => onActive(null)}
            sx={{
              alignItems: 'center',
              borderRadius: '50%',
              display: 'flex',
              height: target,
              justifyContent: 'center',
              width: target,
              '& [data-ring]': { transition: 'scale 150ms ease' },
              '&:hover [data-ring], &.Mui-focusVisible [data-ring]': {
                scale: '1.12',
              },
              '&.Mui-focusVisible': {
                outline: `2px solid ${theme.palette.primary.main}`,
                outlineOffset: 2,
              },
            }}
          >
            <Box
              data-ring=""
              data-received={receivedShare(node).toFixed(2)}
              sx={{
                background: ringBackground(node, sideColours(theme)),
                borderRadius: '50%',
                display: 'flex',
                p: `${RING - 2}px`,
                position: 'relative',
              }}
            >
              <Box
                sx={{
                  backgroundColor: 'background.paper',
                  borderRadius: '50%',
                  display: 'flex',
                  p: '2px',
                }}
              >
                <ExplorerAvatar name={name ?? null} size={node.size} />
              </Box>
              {badge ? <CountBadge text={badge} side={node.side} /> : null}
            </Box>
          </ButtonBase>
        </Tooltip>
        {named ? (
          <Box
            aria-hidden
            sx={{
              alignItems: below ? 'center' : 'baseline',
              display: 'flex',
              flexDirection: below
                ? 'column'
                : node.side === 'in'
                  ? 'row-reverse'
                  : 'row',
              fontSize: '0.875rem',
              fontWeight: 600,
              gap: below ? 0 : 0.5,
              lineHeight: 1.2,
              maxWidth: `${Math.max(0, Math.floor(room))}px`,
              pointerEvents: 'none',
              position: 'absolute',
              whiteSpace: 'nowrap',
              width: 'max-content',
              ...(below
                ? { left: '50%', top: '100%', translate: '-50% 0' }
                : {
                    top: '50%',
                    translate: '0 -50%',
                    ...(node.side === 'in'
                      ? { right: '100%', mr: `${LABEL_MARGIN}px` }
                      : { left: '100%', ml: `${LABEL_MARGIN}px` }),
                  }),
            }}
          >
            <Box
              component="bdi"
              dir="auto"
              sx={(theme) => ({
                backgroundColor: below
                  ? theme.palette.background.surface
                  : undefined,
                borderRadius: '6px',
                maxWidth: '100%',
                minWidth: 0,
                overflow: 'hidden',
                px: below ? 0.5 : 0,
                textOverflow: 'ellipsis',
              })}
            >
              {label}
            </Box>
            {moved ? (
              <Box
                component="span"
                sx={(theme) => ({
                  color: mutedText(theme),
                  flexShrink: 0,
                  fontWeight: 500,
                })}
              >
                {t('explorer:circle.side_amount', { amount: moved })}
              </Box>
            ) : null}
            {lines.length ? (
              <Box
                component="span"
                sx={(theme) => ({
                  color: mutedText(theme),
                  display: 'flex',
                  flexDirection: 'column',
                  fontSize: `${AMOUNT_PX / 16}rem`,
                  fontWeight: 500,
                  lineHeight: 1.25,
                  // On one line where it fits; else wrapped, the room under it made for that.
                  overflowWrap: 'anywhere',
                  textAlign: 'center',
                  whiteSpace: 'normal',
                })}
              >
                {lines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </Box>
            ) : null}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

/** A link that isn't a transfer, in the row under the circle. */
function OtherChip({
  node,
  near,
  onPick,
}: {
  node: CircleNode;
  near: boolean;
  onPick: (node: CircleNode) => void;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const { name, label } = useAccountLabel(node.address, near);
  const words = nodeWords(node, t, i18n.language);
  return (
    <Box component="li" sx={{ listStyle: 'none', minWidth: 0 }}>
      <ButtonBase
        onClick={() => onPick(node)}
        aria-label={t('explorer:circle.node.open', {
          name: isolate(label),
          words,
        })}
        sx={(theme) => ({
          alignItems: 'center',
          border: `1.5px solid ${alpha(theme.palette.primary.main, 0.6)}`,
          borderRadius: '22px',
          display: 'inline-flex',
          gap: 1,
          maxWidth: '100%',
          minHeight: 44,
          pl: 0.5,
          pr: 1.5,
          '&:hover': { backgroundColor: theme.palette.action.hover },
          '&.Mui-focusVisible': {
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: 2,
          },
        })}
      >
        <ExplorerAvatar name={name ?? null} size={32} />
        <Box
          component="bdi"
          dir="auto"
          aria-hidden
          sx={{
            fontWeight: 600,
            maxWidth: 160,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </Box>
        <Box
          component="span"
          aria-hidden
          sx={(theme) => ({ color: mutedText(theme), fontSize: '0.85rem' })}
        >
          {formatCount(node.count, i18n.language)}
        </Box>
      </ButtonBase>
    </Box>
  );
}

const ORDER_BUTTON = {
  fontSize: '0.875rem',
  minHeight: 44,
  px: 1.25,
  textTransform: 'none',
  whiteSpace: 'nowrap',
} as const;

/** The most transactions first, or the most QORT. */
function OrderToggle({
  order,
  onOrder,
}: {
  order: CircleOrder;
  onOrder: (order: CircleOrder) => void;
}) {
  const { t } = useTranslation(['explorer']);
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={order}
      onChange={(_event, value: unknown) => {
        if (isCircleOrder(value)) onOrder(value);
      }}
      aria-label={t('explorer:circle.order_label', cap)}
    >
      <ToggleButton value="count" sx={ORDER_BUTTON}>
        {t('explorer:circle.order_count', cap)}
      </ToggleButton>
      <ToggleButton value="qort" sx={ORDER_BUTTON}>
        {t('explorer:circle.order_qort', cap)}
      </ToggleButton>
    </ToggleButtonGroup>
  );
}

const SIDE_TITLE: Record<Exclude<CircleSide, 'other'>, string> = {
  in: 'explorer:connections.payments.received_from',
  out: 'explorer:connections.payments.sent_to',
  both: 'explorer:circle.side.both',
};

function SideHeading({
  side,
  accounts,
  more,
  searched,
}: {
  side: Exclude<CircleSide, 'other'>;
  accounts: number;
  more: number;
  /** A search is typed: the accounts are those that match it. */
  searched: boolean;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const theme = useTheme();
  const colours = sideColours(theme);
  const align =
    side === 'in' ? 'flex-start' : side === 'out' ? 'flex-end' : 'center';
  return (
    <Box
      sx={{
        alignItems: align,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        textAlign: side === 'in' ? 'left' : side === 'out' ? 'right' : 'center',
      }}
    >
      <Typography
        component="h4"
        sx={{
          alignItems: 'center',
          display: 'flex',
          fontSize: '0.95rem',
          fontWeight: 700,
          gap: 0.75,
          m: 0,
        }}
      >
        <Box
          aria-hidden
          component="span"
          sx={{
            background:
              side === 'both'
                ? `linear-gradient(90deg, ${colours.in} 50%, ${colours.out} 50%)`
                : colours[side],
            borderRadius: '2px',
            flexShrink: 0,
            height: 4,
            width: 18,
          }}
        />
        {t(SIDE_TITLE[side], cap)}
      </Typography>
      <Typography variant="body2" sx={{ color: mutedText(theme) }}>
        {accounts
          ? t(
              searched
                ? 'explorer:circle.side_found'
                : 'explorer:circle.side_accounts',
              {
                count: accounts,
                shown: formatCount(accounts, i18n.language),
              }
            )
          : t(
              searched
                ? 'explorer:circle.side_none_found'
                : 'explorer:circle.side_none',
              cap
            )}
      </Typography>
      {more ? (
        <Typography variant="body2" sx={{ color: mutedText(theme) }}>
          {t('explorer:circle.side_more', {
            count: more,
            shown: formatCount(more, i18n.language),
          })}
        </Typography>
      ) : null}
    </Box>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return (
    <Typography
      component="h4"
      sx={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.3, m: 0 }}
    >
      {children}
    </Typography>
  );
}

/** What the circle is drawn without, each said in its own words. */
export interface CircleGaps {
  /** Some list couldn't be read (said above it, with Retry). */
  failed: boolean;
  /** A Refresh couldn't read some list again: its rows are from before it. */
  refreshFailed: boolean;
  /** Some list was read only in part: older transactions may link more accounts. */
  short: boolean;
}

export function ConnectionsCircle({
  address,
  recorded,
  tagsOf,
  actionOf,
  searched,
  gaps,
  onShowList,
}: {
  address: string;
  /** What was recorded between them, as the list has it (the search's rows when one is typed). */
  recorded: readonly Finding[];
  /** A row's tags, as the list shows them ("its sponsor", "now level 0"). */
  tagsOf: (finding: Finding) => Array<string | null>;
  /** What a row of a link with no one other account offers, as the list's row does. */
  actionOf?: (finding: Finding) => ReactNode;
  /** The search typed (isolated), when one filters what is drawn; null for none. */
  searched: string | null;
  gaps: CircleGaps;
  /** Show the same connections as the list, in the circle's order. */
  onShowList: (order: CircleOrder) => void;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const [storedOrder, setOrder] = useStepState<CircleOrder>(
    'circleOrder',
    'count'
  );
  const order: CircleOrder = isCircleOrder(storedOrder) ? storedOrder : 'count';
  const [pickedKey, setPickedKey] = useStepState<string | null>(
    'circlePicked',
    null
  );
  const [othersAll, setOthersAll] = useStepState<boolean>(
    'circleOthersAll',
    false
  );
  const [active, setActive] = useState<string | null>(null);
  const [outer, setOuter] = useState<HTMLElement | null>(null);
  const near = useNearScreen(outer);
  const room = useRoom(outer);
  const groups = useMemo(() => circleNodes(recorded, order), [recorded, order]);
  // The rows a bottom avatar's amounts take in a name so wide: a line wider wraps.
  const rows: AmountRows = useMemo(
    () => (node, width) =>
      bothLines(node, t, language).reduce(
        (sum, line) => sum + wrapRows(line, width, AMOUNT_PX),
        0
      ),
    [t, language]
  );
  // In an ordinary window, as wide as its column, at most Q-Mintership+'s;
  // in a bigger one (full screen), as wide and as detailed as fits in what
  // the window shows (fitCircle), centred on it.
  const ordinary = room.column
    ? Math.min(room.column, MAX_WIDTH) - 2 * PAD
    : UNKNOWN_WIDTH;
  const { view } = room;
  const widest =
    view && view.width > EXPLORER_WINDOW_WIDTH
      ? room.column + 2 * Math.max(0, Math.min(view.before, view.after))
      : 0;
  const fit = useMemo(
    () =>
      fitCircle(
        groups,
        order,
        {
          ordinary,
          big:
            view && widest > ordinary + 2 * PAD
              ? { width: widest - 2 * PAD, height: view.height }
              : null,
        },
        (layout, options, width, height) =>
          HEAD_ROOM +
          PAD +
          bottomPadOf(layout, options, width, height, rows) +
          (layout.placed.some((node) => node.side === 'both')
            ? BOTH_HEAD_ROOM
            : 0)
      ),
    [groups, order, ordinary, widest, view, rows]
  );
  const { options, layout, width, height } = fit;
  const { placed, rest } = layout;
  const left = placed.filter((node) => node.side === 'in');
  const right = placed.filter((node) => node.side === 'out');
  const bottom = placed.filter((node) => node.side === 'both');
  const named = options.named;
  const names = bottomNames(bottom, width, height, rows, options.bottomNameMax);
  const roomOf = (node: PlacedNode) =>
    node.side === 'both'
      ? (names.get(node.key)?.room ?? options.bottomNameMax)
      : ((node.side === 'out' ? 100 - node.x : node.x) / 100) * width +
        PAD -
        nodeRadius(node.size) -
        LABEL_MARGIN;
  const bottomPad = bottomPadOf(layout, options, width, height, rows);
  const drawnWidth = width + 2 * PAD;
  const all = [...groups.in, ...groups.out, ...groups.both, ...groups.other];
  const picked = pickedKey
    ? (all.find((node) => node.key === pickedKey) ?? null)
    : null;
  const accounts = new Set(all.map((node) => node.address)).size;
  const notDrawn = rest.in + rest.out + rest.both;
  // The other links: the first ones, then "Show all"; only those shown read their names.
  const othersShown = othersAll
    ? groups.other
    : groups.other.slice(0, OTHERS_SHOWN);
  const searching = searched !== null;
  const { name: myName, label: me } = useAccountLabel(address, near);
  const sideList = (side: Exclude<CircleSide, 'other'>, list: PlacedNode[]) =>
    list.length ? (
      <Box
        key={side}
        component="ul"
        aria-label={t(
          order === 'qort'
            ? 'explorer:circle.list_by_qort'
            : 'explorer:circle.list_by_count',
          { side: t(SIDE_TITLE[side], cap), ...cap }
        )}
        sx={{ m: 0, p: 0 }}
      >
        {list.map((node, index) => (
          <CircleNodeButton
            key={node.key}
            node={node}
            index={index}
            order={order}
            named={named}
            room={roomOf(node)}
            near={near}
            onActive={setActive}
            onPick={(next) => setPickedKey(next.key)}
          />
        ))}
      </Box>
    ) : null;
  // What it is drawn without, each in its own words.
  const gapNotes = [
    gaps.failed ? t('explorer:circle.partial_failed', cap) : null,
    gaps.refreshFailed ? t('explorer:circle.partial_refresh', cap) : null,
    gaps.short ? t('explorer:circle.partial', cap) : null,
  ].filter(Boolean);

  if (!placed.length && !groups.other.length && !groups.unplaced.length) {
    const partial = gaps.failed || gaps.refreshFailed || gaps.short;
    return (
      <Typography
        ref={setOuter}
        role="status"
        variant="body2"
        sx={(theme) => ({ color: mutedText(theme) })}
      >
        {searching
          ? t(
              partial
                ? 'explorer:circle.empty_found_partial'
                : 'explorer:circle.empty_found',
              { typed: searched, ...cap }
            )
          : partial
            ? t('explorer:circle.empty_partial', cap)
            : t('explorer:circle.empty', cap)}
      </Typography>
    );
  }
  return (
    <Box
      ref={setOuter}
      sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}
    >
      {searching ? (
        <Typography
          role="status"
          variant="body2"
          sx={(theme) => ({
            color: mutedText(theme),
            overflowWrap: 'anywhere',
          })}
        >
          {t('explorer:circle.found', {
            count: accounts,
            shown: formatCount(accounts, language),
            typed: searched,
            ...cap,
          })}
        </Typography>
      ) : null}
      {/* Drawn once its room is measured: never first at a width it doesn't have. */}
      {placed.length && room.measured ? (
        <Box
          data-circle-size={`${Math.round(drawnWidth)}`}
          sx={
            fit.big
              ? {
                  // Wider than its column, centred on it (and so on the window).
                  flexShrink: 0,
                  maxWidth: 'none',
                  minWidth: 0,
                  mx: `${(room.column - drawnWidth) / 2}px`,
                  width: `${drawnWidth}px`,
                }
              : { maxWidth: MAX_WIDTH, minWidth: 0, mx: 'auto', width: '100%' }
          }
        >
          <Box
            sx={{
              alignItems: 'center',
              columnGap: 2,
              display: 'grid',
              gridTemplateAreas: named
                ? '"in order out"'
                : '"in out" "order order"',
              gridTemplateColumns: named ? '1fr auto 1fr' : '1fr 1fr',
              px: named ? 2 : 0.5,
              rowGap: 1.5,
            }}
          >
            <Box sx={{ gridArea: 'order', justifySelf: 'center' }}>
              <OrderToggle order={order} onOrder={setOrder} />
            </Box>
            <Box sx={{ gridArea: 'in', minWidth: 0 }}>
              <SideHeading
                side="in"
                accounts={groups.in.length}
                more={rest.in}
                searched={searching}
              />
            </Box>
            <Box sx={{ gridArea: 'out', minWidth: 0 }}>
              <SideHeading
                side="out"
                accounts={groups.out.length}
                more={rest.out}
                searched={searching}
              />
            </Box>
          </Box>
          <Box
            component="figure"
            aria-label={
              searching
                ? t('explorer:circle.figure_label_found', {
                    name: isolate(me),
                    count: accounts,
                    shown: formatCount(accounts, language),
                    typed: searched,
                  })
                : t('explorer:circle.figure_label', {
                    name: isolate(me),
                    count: accounts,
                    shown: formatCount(accounts, language),
                  })
            }
            sx={{
              boxSizing: 'border-box',
              m: 0,
              pb: `${bottomPad}px`,
              pt: `${PAD}px`,
              px: `${PAD}px`,
              width: '100%',
            }}
          >
            <Box
              data-layout={
                fit.big
                  ? 'big'
                  : options === TINY_LAYOUT
                    ? 'phone'
                    : options === NARROW_LAYOUT
                      ? 'narrow'
                      : 'wide'
              }
              sx={{
                height: `${height}px`,
                position: 'relative',
                // The width it was laid out for, not its column's: while a
                // new size waits to be laid out, the places (% of this) and
                // the names' room (px) stay in step.
                width: `${width}px`,
              }}
            >
              <Lines placed={placed} order={order} active={active} />
              {/* The account itself, in the middle. */}
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.5,
                  left: '50%',
                  position: 'absolute',
                  top: '50%',
                  translate: `-50% -${options.centerSize / 2 + 4}px`,
                  zIndex: 2,
                }}
              >
                <Box
                  sx={(theme) => ({
                    backgroundColor: theme.palette.background.paper,
                    borderRadius: '50%',
                    boxShadow: `0 0 0 3px ${theme.palette.primary.main}, 0 6px 24px ${theme.palette.action.hover}`,
                    display: 'flex',
                    p: '4px',
                  })}
                >
                  <ExplorerAvatar
                    name={myName ?? null}
                    size={options.centerSize}
                  />
                </Box>
                <Box
                  component="bdi"
                  dir="auto"
                  sx={(theme) => ({
                    backgroundColor: theme.palette.background.surface,
                    borderRadius: '6px',
                    fontWeight: 700,
                    maxWidth: options.centerLabel,
                    overflow: 'hidden',
                    px: 0.75,
                    textAlign: 'center',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  })}
                >
                  {me}
                </Box>
              </Box>
              {sideList('in', left)}
              {sideList('out', right)}
              {sideList('both', bottom)}
            </Box>
          </Box>
          {groups.both.length ? (
            <SideHeading
              side="both"
              accounts={groups.both.length}
              more={rest.both}
              searched={searching}
            />
          ) : null}
        </Box>
      ) : null}
      {groups.other.length ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <SubHeading>{t('explorer:circle.side.other', cap)}</SubHeading>
          <Box
            component="ul"
            aria-label={t('explorer:circle.side.other', cap)}
            sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, m: 0, p: 0 }}
          >
            {othersShown.map((node) => (
              <OtherChip
                key={node.key}
                node={node}
                near={near}
                onPick={(next) => setPickedKey(next.key)}
              />
            ))}
          </Box>
          {othersShown.length < groups.other.length ? (
            <Button
              size="small"
              onClick={() => setOthersAll(true)}
              sx={{ alignSelf: 'flex-start' }}
            >
              {t('explorer:connections.show_all', {
                count: groups.other.length,
                shown: formatCount(groups.other.length, language),
                ...cap,
              })}
            </Button>
          ) : null}
        </Box>
      ) : null}
      {groups.unplaced.length ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <SubHeading>{t('explorer:circle.unplaced', cap)}</SubHeading>
          <Box
            component="ul"
            aria-label={t('explorer:circle.unplaced', cap)}
            sx={ROW_LIST_SX}
          >
            {groups.unplaced.map((finding) => (
              <ConnectionRow
                key={finding.key}
                address={address}
                rowKey={`circle:${finding.key}`}
                other={finding.other}
                sentence={finding.sentence}
                when={whenText(finding, t, language)}
                tags={tagsOf(finding)}
                evidence={{
                  kind: finding.evidenceKind,
                  txs: finding.evidence,
                  signatures: finding.evidenceSignatures,
                }}
                action={actionOf?.(finding)}
              />
            ))}
          </Box>
        </Box>
      ) : null}
      {placed.length || groups.other.length ? (
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme), textAlign: 'center' })}
        >
          {/* Sizes and lines only where avatars are drawn. */}
          {[
            placed.length
              ? order === 'qort'
                ? t('explorer:circle.legend_qort', cap)
                : t('explorer:circle.legend_count', cap)
              : null,
            bottom.length ? t('explorer:circle.legend_both', cap) : null,
            t('explorer:circle.legend_press', cap),
          ]
            .filter(Boolean)
            .join(' ')}
        </Typography>
      ) : null}
      {gapNotes.length ? (
        <Typography
          role="note"
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme), textAlign: 'center' })}
        >
          {gapNotes.join(' ')}
        </Typography>
      ) : null}
      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        {/* The text alternative: the list, in the circle's order. */}
        <Button
          onClick={() => onShowList(order)}
          endIcon={<ExpandMoreRoundedIcon aria-hidden />}
          sx={{ minHeight: 44, textTransform: 'none' }}
        >
          {notDrawn
            ? t(
                order === 'qort'
                  ? 'explorer:circle.see_list_more_qort'
                  : 'explorer:circle.see_list_more_count',
                {
                  count: notDrawn,
                  shown: formatCount(notDrawn, language),
                  ...cap,
                }
              )
            : t('explorer:circle.see_list', cap)}
        </Button>
      </Box>
      <CircleNodeDialog
        node={picked}
        address={address}
        tagsOf={tagsOf}
        onClose={() => setPickedKey(null)}
      />
    </Box>
  );
}
