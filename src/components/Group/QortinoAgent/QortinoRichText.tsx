import { Box, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { MouseEvent, ReactNode } from 'react';
import { openQortalDeepLink } from '../../../qortinoAgent/qdnAppLinks';
import { parkQortinoAgentSheet } from '../../../qortinoAgent/qortinoSheetNav';

/** A link label, as typed: "100%" or a broken escape is shown raw, not thrown. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

type Props = {
  text: string;
  fontSize?: string;
};

/**
 * Lightweight markup for Qortino answers: headings, bold/italic, lists,
 * fenced/code, links, and section dividers (———).
 */
export function QortinoRichText({ text, fontSize = '0.92rem' }: Props) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const blocks = splitBlocks(text);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0.85,
        mt: 1,
        '& a': {
          color: isDark ? '#7EB6FF' : '#1A6FD4',
          fontWeight: 700,
          textDecoration: 'underline',
          textUnderlineOffset: '2px',
        },
        '& code': {
          background: alpha(theme.palette.text.primary, isDark ? 0.1 : 0.06),
          borderRadius: '4px',
          color: alpha(theme.palette.text.primary, 0.55),
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '0.68em',
          fontWeight: 500,
          px: 0.35,
          py: 0.05,
        },
      }}
    >
      {blocks.map((block, i) => renderBlock(block, i, fontSize, isDark))}
    </Box>
  );
}

type Block =
  | { type: 'p'; text: string }
  | { type: 'h'; level: 1 | 2 | 3; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'hr' }
  | { type: 'pre'; text: string };

function splitBlocks(raw: string): Block[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }
    // "——— Character ———" style section titles (keep the label).
    const section = trimmed.match(/^———\s*(.+?)\s*———$/);
    if (section?.[1]) {
      out.push({ type: 'h', level: 3, text: section[1].trim() });
      i += 1;
      continue;
    }
    if (
      /^———/.test(trimmed) ||
      /^---+$/.test(trimmed) ||
      /^\*\*\*+$/.test(trimmed)
    ) {
      out.push({ type: 'hr' });
      i += 1;
      continue;
    }
    if (trimmed.startsWith('```')) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) {
        buf.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1;
      out.push({ type: 'pre', text: buf.join('\n') });
      continue;
    }
    const h = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      out.push({
        type: 'h',
        level: Math.min(3, h[1]!.length) as 1 | 2 | 3,
        text: h[2]!,
      });
      i += 1;
      continue;
    }
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test((lines[i] || '').trim())) {
        items.push((lines[i] || '').trim().replace(/^[-*•]\s+/, ''));
        i += 1;
      }
      out.push({ type: 'ul', items });
      continue;
    }
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test((lines[i] || '').trim())) {
        items.push((lines[i] || '').trim().replace(/^\d+[.)]\s+/, ''));
        i += 1;
      }
      out.push({ type: 'ol', items });
      continue;
    }
    const para: string[] = [trimmed];
    i += 1;
    while (
      i < lines.length &&
      (lines[i] || '').trim() &&
      !/^———/.test((lines[i] || '').trim()) &&
      !/^#{1,3}\s+/.test((lines[i] || '').trim()) &&
      !/^[-*•]\s+/.test((lines[i] || '').trim()) &&
      !/^\d+[.)]\s+/.test((lines[i] || '').trim()) &&
      !(lines[i] || '').trim().startsWith('```')
    ) {
      para.push((lines[i] || '').trim());
      i += 1;
    }
    out.push({ type: 'p', text: para.join(' ') });
  }
  return out;
}

function openRichLink(href: string, e: MouseEvent): void {
  e.preventDefault();
  if (/^qortal:\/\//i.test(href)) {
    openQortalDeepLink(href);
    return;
  }
  if (/^https?:\/\//i.test(href)) {
    parkQortinoAgentSheet();
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}

function renderInline(text: string): ReactNode[] {
  // Order: code, markdown links, bare qortal://, bold, italic
  const nodes: ReactNode[] = [];
  const re =
    /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(qortal:\/\/[^\s)]+)|(https?:\/\/[^\s)]+)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) {
      nodes.push(text.slice(last, m.index));
    }
    const tok = m[0];
    if (tok.startsWith('`')) {
      nodes.push(<code key={key++}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('[')) {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (lm) {
        const href = lm[2]!;
        nodes.push(
          <a
            key={key++}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => openRichLink(href, e)}
          >
            {lm[1]}
          </a>
        );
      } else nodes.push(tok);
    } else if (/^(qortal:\/\/|https?:\/\/)/i.test(tok)) {
      const href = tok.replace(/[.,;:!?]+$/, '');
      const label = href.startsWith('qortal://')
        ? safeDecode(href.replace(/^qortal:\/\/(APP|WEBSITE)\//i, '')).slice(
            0,
            48
          )
        : href.replace(/^https?:\/\//i, '');
      nodes.push(
        <a
          key={key++}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => openRichLink(href, e)}
        >
          {label}
        </a>
      );
    } else if (tok.startsWith('**') || tok.startsWith('__')) {
      nodes.push(
        <Box component="strong" key={key++} sx={{ fontWeight: 800 }}>
          {tok.slice(2, -2)}
        </Box>
      );
    } else {
      nodes.push(
        <Box component="em" key={key++} sx={{ fontStyle: 'italic' }}>
          {tok.slice(1, -1)}
        </Box>
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderBlock(
  block: Block,
  i: number,
  fontSize: string,
  isDark: boolean
): ReactNode {
  if (block.type === 'hr') {
    return (
      <Typography
        key={i}
        sx={{
          color: alpha('#7EB6FF', isDark ? 0.7 : 0.85),
          fontSize: '0.72rem',
          fontWeight: 800,
          letterSpacing: '0.04em',
          mt: 0.35,
          textTransform: 'uppercase',
        }}
      >
        {block.type === 'hr' ? '———' : null}
      </Typography>
    );
  }
  if (block.type === 'h') {
    const size =
      block.level === 1 ? '1.05rem' : block.level === 2 ? '0.98rem' : '0.9rem';
    return (
      <Typography
        key={i}
        sx={{
          color:
            block.level >= 3 ? alpha('#7EB6FF', isDark ? 0.95 : 1) : 'inherit',
          fontSize: size,
          fontWeight: 800,
          letterSpacing: block.level >= 3 ? '0.03em' : undefined,
          lineHeight: 1.35,
          mt: block.level >= 3 ? 0.35 : 0,
          textTransform: block.level >= 3 ? 'uppercase' : undefined,
        }}
      >
        {renderInline(block.text)}
      </Typography>
    );
  }
  if (block.type === 'pre') {
    return (
      <Box
        key={i}
        component="pre"
        sx={{
          background: alpha('#000', isDark ? 0.35 : 0.06),
          borderRadius: '10px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '0.78rem',
          lineHeight: 1.45,
          m: 0,
          overflowX: 'auto',
          p: 1,
          whiteSpace: 'pre-wrap',
        }}
      >
        {block.text}
      </Box>
    );
  }
  if (block.type === 'ul' || block.type === 'ol') {
    const Tag = block.type === 'ul' ? 'ul' : 'ol';
    return (
      <Box
        key={i}
        component={Tag}
        sx={{
          m: 0,
          pl: 2.2,
          '& li': { fontSize, lineHeight: 1.45, mb: 0.35 },
        }}
      >
        {block.items.map((item, j) => (
          <li key={j}>{renderInline(item)}</li>
        ))}
      </Box>
    );
  }
  return (
    <Typography key={i} sx={{ fontSize, lineHeight: 1.45 }}>
      {renderInline(block.text)}
    </Typography>
  );
}
