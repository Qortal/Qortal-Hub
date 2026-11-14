import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/i18n';

const events = vi.hoisted(() => ({ executeEvent: vi.fn() }));
vi.mock('../../utils/events', () => events);

import {
  buildQortinoAnswerReport,
  continuedAnswerSource,
  isQortinoAnswerSource,
  openQmailTo,
  qmailComposePath,
  QORTINO_REPORT_RECIPIENT,
} from '../answerReport';

const t = i18n.t.bind(i18n);

describe('Reporting a Qortino answer', () => {
  beforeEach(() => {
    events.executeEvent.mockClear();
  });

  it('opens Q-Mail on a new message to Qortal Builders', () => {
    expect(QORTINO_REPORT_RECIPIENT).toBe('Qortal Builders');
    expect(qmailComposePath('Qortal Builders')).toBe('to/Qortal%20Builders');
    openQmailTo();
    expect(events.executeEvent).toHaveBeenCalledWith('addTab', {
      data: {
        service: 'APP',
        name: 'Q-Mail',
        path: 'to/Qortal%20Builders',
        navigateIfAlreadyOpen: true,
      },
    });
    expect(events.executeEvent).toHaveBeenCalledWith('open-apps-mode', {});
  });

  it('keeps a name from walking out of the Q-Mail path', () => {
    expect(qmailComposePath('../../evil?x=1#y')).toBe(
      'to/..%2F..%2Fevil%3Fx%3D1%23y'
    );
  });

  it('writes the question, the answer and where the answer came from', () => {
    const text = buildQortinoAnswerReport(
      {
        question: ' How do I mint? ',
        answer: 'Get a reward share.',
        source: { kind: 'curated', id: 'mint-081' },
      },
      t
    );
    expect(text).toContain('Qortino AI · answer report');
    expect(text).toContain('Question:\nHow do I mint?');
    expect(text).toContain("Qortino's answer:\nGet a reward share.");
    expect(text).toContain('Source: curated answer mint-081');
    // A curated answer is shown as written: no model to blame.
    expect(text).not.toContain('Model:');
    expect(text.trimEnd()).toMatch(
      /What is wrong, and the right answer if you know it:$/
    );
  });

  it('names each kind of source', () => {
    const line = (source) =>
      buildQortinoAnswerReport({ question: 'q', answer: 'a', source }, t)
        .split('\n')
        .find((l) => l.startsWith('Source:'));
    expect(line({ kind: 'catalog', app: 'Q-Tube' })).toBe(
      'Source: Q-App catalog (Q-Tube)'
    );
    expect(line({ kind: 'model' })).toBe('Source: written by the model');
    expect(line({ kind: 'model', hints: ['qdn-001', 'qdn-002'] })).toBe(
      'Source: written by the model, with curated answers qdn-001, qdn-002'
    );
    expect(line(undefined)).toBe('Source: not recorded');
  });

  it('names the model that wrote the answer, not the one chosen now', () => {
    const text = buildQortinoAnswerReport(
      {
        question: 'q',
        answer: 'a',
        source: { kind: 'model', model: 'Phi-4 mini Instruct', hints: [] },
      },
      t
    );
    expect(text).toContain('Model: Phi-4 mini Instruct');
  });

  it('credits every model that wrote a continued answer', () => {
    const first = {
      kind: 'model' as const,
      model: 'Qwen3 4B Instruct 2507',
      hints: ['names-009'],
    };
    // Same model: nothing changes.
    expect(continuedAnswerSource(first, 'Qwen3 4B Instruct 2507')).toEqual(
      first
    );
    // Switched in between: both, in order, hints kept.
    const both = continuedAnswerSource(first, 'Phi-4 mini Instruct');
    expect(both).toEqual({
      kind: 'model',
      model: 'Qwen3 4B Instruct 2507 + Phi-4 mini Instruct',
      hints: ['names-009'],
    });
    // Continued again by the last one: not added twice.
    expect(continuedAnswerSource(both, 'Phi-4 mini Instruct')).toEqual(both);
    // An old answer with no source, or an instant one: the continuing model.
    expect(continuedAnswerSource(undefined, 'Phi')).toEqual({
      kind: 'model',
      model: 'Phi',
    });
    expect(
      continuedAnswerSource({ kind: 'curated', id: 'qdn-001' }, 'Phi')
    ).toEqual({ kind: 'model', model: 'Phi' });
  });

  it('fills in a dash for a missing question', () => {
    const text = buildQortinoAnswerReport({ question: '  ', answer: 'a' }, t);
    expect(text).toContain('Question:\n—');
  });

  it('only trusts a saved source of a known shape', () => {
    expect(isQortinoAnswerSource({ kind: 'curated', id: 'x' })).toBe(true);
    expect(isQortinoAnswerSource({ kind: 'catalog', app: 'Q-Mail' })).toBe(
      true
    );
    expect(isQortinoAnswerSource({ kind: 'model' })).toBe(true);
    expect(isQortinoAnswerSource({ kind: 'model', hints: ['a'] })).toBe(true);
    expect(isQortinoAnswerSource({ kind: 'model', model: 'Phi' })).toBe(true);
    for (const bad of [
      null,
      'curated',
      { kind: 'curated' },
      { kind: 'catalog', app: 3 },
      { kind: 'model', hints: [1] },
      { kind: 'model', model: 4 },
      { kind: 'other' },
    ]) {
      expect(isQortinoAnswerSource(bad)).toBe(false);
    }
  });
});
