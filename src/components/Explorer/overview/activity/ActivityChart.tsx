/**
 * The Activity chart (from Q-Mintership+'s ActivityChart): an account's
 * transactions as bars over time, one per period (lib/explorer/activity.ts),
 * each stacked by family in its colour, from when it was first seen to now.
 * Periods not read yet are hatched, never drawn as quiet; the one holding
 * the oldest transaction read is hatched behind its bar, and says it is
 * only partly read. Its milestones stand across it as coloured lines with
 * a flag. The bars are plain SVG, stretched to the width; the dates and
 * flags are laid over it.
 *
 * - Pointing at a bar shows that period's counts, in a card that stays
 *   inside the chart; a press picks it, and the section lists its
 *   transactions.
 * - Keys: the chart takes focus; ← → move between periods (each read out),
 *   from the one picked, Home and End go to the ends, Enter or Space picks
 *   one.
 * - A flag opens what it marks; the section's milestone list and its table
 *   of periods say all of it in words, for keyboards and screen readers.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { visuallyHidden } from '@mui/utils';
import { useTranslation } from 'react-i18next';
import {
  ACTIVITY_FAMILIES,
  activityBuckets,
  axisTicks,
  bucketCount,
  hoverCardLeft,
  periodIndexOf,
  type ActivityBucket,
  type ActivityFamily,
  type ActivityMark,
} from '../../../../lib/explorer/activity';
import {
  formatCount,
  formatDay,
  formatDayTime,
  formatMonthYear,
} from '../../../../lib/explorer/format';
import type { TxRow } from '../../../../lib/explorer/reads';
import { cap, mutedText } from '../../parts';
import { familyAccent } from '../../transactions/txLook';
import { markAccent } from './activityLook';
import {
  bucketCountsText,
  bucketText,
  markText,
  periodText,
} from './activityWords';

const DAY = 86_400_000;
/** One period's width, in the drawing's own units. */
const BAR = 10;
/** The flags' row above the bars, and the dates' row under them (px). */
const FLAG_ROW = 20;
const AXIS_ROW = 24;

/** The width `node` is drawn at; 0 where the browser can't tell. */
function useWidth(node: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!node) return undefined;
    const update = () => setWidth(node.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return width;
}

export function ActivityChart({
  rows,
  from,
  to,
  readFrom,
  hidden,
  marks,
  height,
  picked,
  onPick,
  onOpenMark,
  label,
}: {
  rows: readonly TxRow[];
  from: number;
  to: number;
  /** The oldest transaction read, when older ones exist: before it is unread. */
  readFrom: number | null;
  hidden: ReadonlySet<ActivityFamily>;
  marks: readonly ActivityMark[];
  /** The bars' height, px. */
  height: number;
  /** The period picked, by its start. */
  picked: number | null;
  onPick: (bucket: ActivityBucket) => void;
  onOpenMark: (mark: ActivityMark) => void;
  /** What the chart is, for screen readers (whose activity, and how to use it). */
  label: string;
}) {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const hatchId = `${useId()}-hatch`;
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const width = useWidth(node);
  const count = bucketCount(width);
  const buckets = useMemo(
    () => activityBuckets(rows, { from, to, count, readFrom, hidden }),
    [rows, from, to, count, readFrom, hidden]
  );
  const max = Math.max(1, ...buckets.map((bucket) => bucket.total));
  const ticks = useMemo(
    () => axisTicks(from, to, width || 640),
    [from, to, width]
  );
  const [hover, setHover] = useState<{ i: number; x: number } | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const span = Math.max(1, to - from);
  const pct = (at: number) =>
    Math.max(0, Math.min(100, ((at - from) / span) * 100));
  const tickText = (at: number) =>
    span / Math.max(1, ticks.length - 1) < DAY
      ? formatDayTime(at, language)
      : span > 400 * DAY
        ? formatMonthYear(at, language)
        : formatDay(at, language);

  /** The period picked: by its start, or (drawn anew since) the one holding it. */
  const pickedIndex = periodIndexOf(buckets, picked);

  // The hover card's width, so it can stand inside the chart.
  const card = useRef<HTMLDivElement | null>(null);
  const [cardWidth, setCardWidth] = useState(200);
  useLayoutEffect(() => {
    const width = card.current?.offsetWidth;
    if (width && width !== cardWidth) setCardWidth(width);
  });

  const indexAt = (clientX: number): number | null => {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    if (!rect.width) return null;
    const i = Math.floor(((clientX - rect.left) / rect.width) * count);
    return Math.max(0, Math.min(count - 1, i));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = count - 1;
    const current = focusIndex ?? (pickedIndex >= 0 ? pickedIndex : last);
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = Math.max(0, current - 1);
    else if (event.key === 'ArrowRight') next = Math.min(last, current + 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const bucket = buckets[Math.min(last, current)];
      if (bucket && !bucket.unread) onPick(bucket);
      return;
    } else return;
    event.preventDefault();
    setFocusIndex(next);
  };

  const focused =
    focusIndex !== null ? buckets[Math.min(count - 1, focusIndex)] : null;
  const hovered = hover ? buckets[hover.i] : null;
  const gap = count > 120 ? 0 : 1;
  const hatch = alpha(theme.palette.text.primary, 0.14);

  return (
    <Box sx={{ minWidth: 0, position: 'relative' }}>
      {/* Milestones' flags, above the bars. */}
      <Box aria-hidden sx={{ height: FLAG_ROW, position: 'relative' }}>
        {marks.map((mark) => (
          <Tooltip
            key={mark.key}
            title={`${markText(mark, t, language)} · ${formatDay(mark.at, language)}`}
          >
            <Box
              data-mark={mark.kind}
              onClick={() => onOpenMark(mark)}
              sx={{
                backgroundColor: markAccent(theme, mark.kind),
                borderRadius: '50%',
                boxShadow: `0 0 0 2px ${theme.palette.background.surface}`,
                cursor: 'pointer',
                height: 12,
                left: `${pct(mark.at)}%`,
                position: 'absolute',
                top: 4,
                transition: 'scale 120ms ease',
                translate: '-6px 0',
                width: 12,
                '&:hover': { scale: '1.3' },
              }}
            />
          </Tooltip>
        ))}
      </Box>
      <Box
        ref={setNode}
        role="group"
        tabIndex={0}
        aria-label={label}
        data-activity-chart=""
        onKeyDown={onKeyDown}
        onBlur={() => setFocusIndex(null)}
        onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
          const i = indexAt(event.clientX);
          const rect = node?.getBoundingClientRect();
          if (i !== null && rect) setHover({ i, x: event.clientX - rect.left });
        }}
        onPointerLeave={() => setHover(null)}
        onClick={(event) => {
          const i = indexAt(event.clientX);
          if (i !== null && !buckets[i].unread) onPick(buckets[i]);
        }}
        sx={{
          borderBottom: `1px solid ${theme.palette.divider}`,
          cursor: 'pointer',
          height,
          outline: 'none',
          position: 'relative',
          // A narrow window: lower bars, so the page around them still shows.
          '@container (max-width: 480px)': {
            height: Math.round(height * 0.75),
          },
          '&:focus-visible': {
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: 2,
          },
        }}
      >
        <svg
          aria-hidden
          focusable="false"
          width="100%"
          height="100%"
          viewBox={`0 0 ${count * BAR} ${height}`}
          preserveAspectRatio="none"
          style={{ display: 'block' }}
        >
          <defs>
            <pattern
              id={hatchId}
              width={6}
              height={6}
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line
                x1={0}
                y1={0}
                x2={0}
                y2={6}
                stroke={hatch}
                strokeWidth={3}
              />
            </pattern>
          </defs>
          {buckets.map((bucket, i) => {
            const x = i * BAR + gap / 2;
            const w = BAR - gap;
            const isPicked = picked !== null && bucket.start === picked;
            const hatched = bucket.unread || bucket.partial;
            const isFocused = focusIndex === i;
            const ground =
              isPicked || isFocused
                ? alpha(theme.palette.primary.main, isPicked ? 0.18 : 0.1)
                : hover?.i === i
                  ? theme.palette.action.hover
                  : null;
            let y = height;
            return (
              <g
                key={i}
                data-unread={bucket.unread ? '' : undefined}
                data-partial={bucket.partial ? '' : undefined}
              >
                {ground ? (
                  <rect x={x} y={0} width={w} height={height} fill={ground} />
                ) : null}
                {hatched ? (
                  <rect
                    x={x}
                    y={0}
                    width={w}
                    height={height}
                    fill={`url(#${hatchId})`}
                  />
                ) : null}
                {bucket.unread
                  ? null
                  : ACTIVITY_FAMILIES.map((family) => {
                      const n = bucket.byFamily[family];
                      if (!n) return null;
                      const h = Math.max(2, (n / max) * (height - 2));
                      y -= h;
                      return (
                        <rect
                          key={family}
                          data-family={family}
                          x={x}
                          y={y}
                          width={w}
                          height={h}
                          fill={familyAccent(theme, family)}
                        />
                      );
                    })}
              </g>
            );
          })}
          {marks.map((mark) => {
            const x = (pct(mark.at) / 100) * count * BAR;
            return (
              <line
                key={mark.key}
                x1={x}
                x2={x}
                y1={0}
                y2={height}
                stroke={markAccent(theme, mark.kind)}
                strokeOpacity={0.85}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
      </Box>
      {/* The dates under the bars. */}
      <Box aria-hidden sx={{ height: AXIS_ROW, position: 'relative' }}>
        {ticks.map((at, i) => (
          <Typography
            key={i}
            component="span"
            variant="body2"
            sx={(themed) => ({
              color: mutedText(themed),
              fontSize: '0.75rem',
              left: `${pct(at)}%`,
              position: 'absolute',
              top: 4,
              translate:
                i === 0 ? '0 0' : i === ticks.length - 1 ? '-100% 0' : '-50% 0',
              whiteSpace: 'nowrap',
            })}
          >
            {tickText(at)}
          </Typography>
        ))}
      </Box>

      {/* One card for the period under the pointer. */}
      {hovered && hover ? (
        <Box
          ref={card}
          aria-hidden
          data-hover-card=""
          sx={(themed) => ({
            backgroundColor: themed.palette.background.elevated,
            border: `1px solid ${themed.palette.divider}`,
            borderRadius: '10px',
            boxShadow: themed.shadows[6],
            boxSizing: 'border-box',
            left: hoverCardLeft(hover.x, node?.clientWidth ?? 0, cardWidth),
            maxWidth: 'min(260px, calc(100% - 8px))',
            minWidth: 'min(170px, calc(100% - 8px))',
            p: 1.25,
            pointerEvents: 'none',
            position: 'absolute',
            top: FLAG_ROW + 8,
            zIndex: 3,
          })}
        >
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {periodText(hovered, language)}
          </Typography>
          {hovered.unread ? (
            <Typography
              variant="body2"
              sx={(themed) => ({ color: mutedText(themed) })}
            >
              {t('explorer:activity.not_read', cap)}
            </Typography>
          ) : (
            <>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                {t('explorer:activity.period_count', {
                  count: hovered.total,
                  shown: formatCount(hovered.total, language),
                  ...cap,
                })}
              </Typography>
              {ACTIVITY_FAMILIES.filter(
                (family) => hovered.byFamily[family]
              ).map((family) => (
                <Box
                  key={family}
                  sx={{ alignItems: 'center', display: 'flex', gap: 0.75 }}
                >
                  <Box
                    sx={{
                      backgroundColor: familyAccent(theme, family),
                      borderRadius: '2px',
                      flexShrink: 0,
                      height: 10,
                      width: 10,
                    }}
                  />
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {t(`explorer:tx_family.${family}`, cap)}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {formatCount(hovered.byFamily[family] ?? 0, language)}
                  </Typography>
                </Box>
              ))}
              {hovered.partial ? (
                <Typography
                  variant="body2"
                  sx={(themed) => ({ color: mutedText(themed), mt: 0.5 })}
                >
                  {t('explorer:activity.partly_read', cap)}
                </Typography>
              ) : null}
            </>
          )}
        </Box>
      ) : null}

      {/* What the keys moved to, read out. */}
      <Box role="status" sx={visuallyHidden}>
        {focused ? bucketText(focused, t, language) : ''}
      </Box>
      <PeriodsTable buckets={buckets} />
    </Box>
  );
}

/**
 * The chart in words, for screen readers: the stretch not read yet, then
 * each period with transactions, its count and their kinds (the one only
 * partly read says so). It is hidden inside a 1 px box: a table can't be
 * made that small itself, and laid out at its own width it would make a
 * narrower window scroll sideways.
 */
function PeriodsTable({ buckets }: { buckets: readonly ActivityBucket[] }) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const unread = buckets.filter((bucket) => bucket.unread);
  const rows = buckets.filter((bucket) => !bucket.unread && bucket.total);
  return (
    <Box sx={visuallyHidden}>
      <table>
        <caption>{t('explorer:activity.table_caption', cap)}</caption>
        <thead>
          <tr>
            <th scope="col">{t('explorer:activity.table_period', cap)}</th>
            <th scope="col">
              {t('explorer:activity.table_transactions', cap)}
            </th>
          </tr>
        </thead>
        <tbody>
          {unread.length ? (
            <tr>
              <td>
                {periodText(
                  {
                    start: unread[0].start,
                    end: unread[unread.length - 1].end,
                  },
                  language
                )}
              </td>
              <td>{t('explorer:activity.not_read_short', cap)}</td>
            </tr>
          ) : null}
          {rows.map((bucket) => (
            <tr key={bucket.start}>
              <td>{periodText(bucket, language)}</td>
              <td>{bucketCountsText(bucket, t, language)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
}
