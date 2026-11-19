/**
 * Flag an answer: a report for Qortal Builders, who look after Qortino's
 * curated Qortal answers, sent by the user from Q-Mail.
 *
 * Q-Mail opens on `to/<name>`, which starts a message to that name. It
 * cannot be given a subject or a body, so the report (the question, the
 * answer and where the answer came from) goes to the clipboard first, for
 * the user to paste in.
 */
import type { TFunction } from 'i18next';
import { executeEvent } from '../utils/events';

/** Registered name that receives the reports. */
export const QORTINO_REPORT_RECIPIENT = 'Qortal Builders';

/** The Q-App the report is written in. */
export const QORTINO_REPORT_QAPP = 'Q-Mail';

/** Where an answer came from, so the right thing gets fixed. */
export type QortinoAnswerSource =
  /** A curated FAQ answer, shown as it is. */
  | { kind: 'curated'; id: string }
  /** A Q-App card from the catalog. */
  | { kind: 'catalog'; app: string }
  /**
   * Written by a model: `model` is its label when it wrote the answer, and
   * `hints` are the curated answers it was given.
   */
  | { kind: 'model'; model?: string; hints?: string[] };

export function isQortinoAnswerSource(
  value: unknown
): value is QortinoAnswerSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as Record<string, unknown>;
  if (source.kind === 'curated') return typeof source.id === 'string';
  if (source.kind === 'catalog') return typeof source.app === 'string';
  if (source.kind === 'model') {
    return (
      (source.model === undefined || typeof source.model === 'string') &&
      (source.hints === undefined ||
        (Array.isArray(source.hints) &&
          source.hints.every((hint) => typeof hint === 'string')))
    );
  }
  return false;
}

/**
 * The source of an answer `modelLabel` continued ("Continue answer"): the
 * models that wrote it, in order, and the curated answers the first one was
 * given. The model may have been switched in between.
 */
export function continuedAnswerSource(
  previous: QortinoAnswerSource | undefined,
  modelLabel: string
): QortinoAnswerSource {
  if (previous?.kind !== 'model') return { kind: 'model', model: modelLabel };
  const earlier = previous.model?.trim();
  const models =
    !earlier || earlier === modelLabel || earlier.endsWith(` + ${modelLabel}`)
      ? earlier || modelLabel
      : `${earlier} + ${modelLabel}`;
  return {
    kind: 'model',
    model: models,
    ...(previous.hints?.length ? { hints: previous.hints } : {}),
  };
}

/** Q-Mail's path for a new message to `name`. */
export function qmailComposePath(name: string): string {
  return `to/${encodeURIComponent(name.trim())}`;
}

/** Open Q-Mail in a Hub tab, writing a new message to `name`. */
export function openQmailTo(name: string = QORTINO_REPORT_RECIPIENT): void {
  executeEvent('addTab', {
    data: {
      service: 'APP',
      name: QORTINO_REPORT_QAPP,
      path: qmailComposePath(name),
      navigateIfAlreadyOpen: true,
    },
  });
  executeEvent('open-apps-mode', {});
}

export type QortinoAnswerReport = {
  question: string;
  /** The answer as shown, with its Q-App cards and links (formatAssistantBubbleForClipboard). */
  answer: string;
  /** Where it came from; for a model answer, also which model wrote it. */
  source?: QortinoAnswerSource;
};

function sourceLine(
  source: QortinoAnswerSource | undefined,
  t: TFunction
): string {
  if (!source) return t('core:qortino_agent.report.source_unknown');
  switch (source.kind) {
    case 'curated':
      return t('core:qortino_agent.report.source_curated', { id: source.id });
    case 'catalog':
      return t('core:qortino_agent.report.source_catalog', {
        app: source.app,
      });
    case 'model':
      return source.hints?.length
        ? t('core:qortino_agent.report.source_model_hints', {
            ids: source.hints.join(', '),
          })
        : t('core:qortino_agent.report.source_model');
  }
}

/** The report as plain text, in the user's language, for the Q-Mail body. */
export function buildQortinoAnswerReport(
  report: QortinoAnswerReport,
  t: TFunction
): string {
  const lines = [
    t('core:qortino_agent.report.mail_title'),
    '',
    `${t('core:qortino_agent.report.question')}:`,
    report.question.trim() || '—',
    '',
    `${t('core:qortino_agent.report.answer')}:`,
    report.answer.trim() || '—',
    '',
    // Only a model answer names its model: curated answers and Q-App cards
    // are shown as written, whichever model is chosen.
    ...(report.source?.kind === 'model' && report.source.model
      ? [`${t('core:qortino_agent.report.model')}: ${report.source.model}`]
      : []),
    `${t('core:qortino_agent.report.source')}: ${sourceLine(report.source, t)}`,
    '',
    t('core:qortino_agent.report.whats_wrong'),
    '',
  ];
  return lines.join('\n');
}
