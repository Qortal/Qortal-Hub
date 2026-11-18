import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WIDGET_GUIDE_SECTIONS,
  WIDGET_STARTER,
  codeSpans,
  splitCode,
  widgetGuideKeys,
  widgetGuideMarkdown,
} from './widgetGuide';

const LOCALES = join(__dirname, '../../../i18n/locales');

const lookup = (tree: unknown, dotted: string): unknown =>
  dotted
    .split('.')
    .reduce(
      (node, part) =>
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      tree
    );

const coreOf = (language: string) =>
  JSON.parse(readFileSync(join(LOCALES, language, 'core.json'), 'utf8'));

/** Every string with code in it: the guide's and the form's widget note. */
const keysWithCode = () => [...widgetGuideKeys(), 'core:publish_widget.note'];

describe('widget guide', () => {
  it('splits code out of a text', () => {
    expect(splitCode('Use `OPEN_NEW_TAB` with `qortal://APP/x`.')).toEqual([
      { code: false, text: 'Use ' },
      { code: true, text: 'OPEN_NEW_TAB' },
      { code: false, text: ' with ' },
      { code: true, text: 'qortal://APP/x' },
      { code: false, text: '.' },
    ]);
    expect(splitCode('no code')).toEqual([{ code: false, text: 'no code' }]);
    // A lone backtick stays text.
    expect(codeSpans('a ` b')).toEqual([]);
  });

  it('copies as Markdown: title, sections, lists and code blocks', () => {
    const markdown = widgetGuideMarkdown((key) => `[${key}]`);
    expect(markdown.startsWith('# [core:widget_guide.title]\n\n')).toBe(true);
    WIDGET_GUIDE_SECTIONS.forEach((section) => {
      expect(markdown).toContain(`\n## [${section.titleKey}]\n`);
    });
    expect(markdown).toContain('\n- [core:widget_guide.look.one_job]\n');
    expect(markdown).toContain('```html\n<!doctype html>');
    expect(markdown).toContain(`${WIDGET_STARTER}\n\`\`\``);
  });

  it('starter: a widget that follows the contract', () => {
    expect(WIDGET_STARTER).toContain("params.get('goWidget') === '1'");
    expect(WIDGET_STARTER).toContain('background: transparent');
    expect(WIDGET_STARTER).toContain('GO_WIDGET_VISIBILITY');
    expect(WIDGET_STARTER).toContain('THEME_CHANGED');
    expect(WIDGET_STARTER).toContain('LANGUAGE_CHANGED');
    expect(WIDGET_STARTER).toContain("action: 'OPEN_NEW_TAB'");
    expect(WIDGET_STARTER).toContain("typeof qortalRequest !== 'function'");
    expect(WIDGET_STARTER).not.toContain('window.qortalRequest(');
    expect(WIDGET_STARTER).not.toContain('LINK_TO_QDN_RESOURCE');
    expect(WIDGET_STARTER).not.toMatch(/https?:\/\//);
  });

  it('has every key in English', () => {
    const en = coreOf('en');
    keysWithCode().forEach((key) => {
      const value = lookup(en, key.replace(/^core:/, ''));
      expect(typeof value, key).toBe('string');
      expect((value as string).length, key).toBeGreaterThan(0);
    });
  });

  it('keeps the code of every text in every language', () => {
    const en = coreOf('en');
    const languages = readdirSync(LOCALES).filter(
      (language) => language !== 'en'
    );
    expect(languages.length).toBe(11);
    languages.forEach((language) => {
      const locale = coreOf(language);
      keysWithCode().forEach((key) => {
        const path = key.replace(/^core:/, '');
        const english = lookup(en, path) as string;
        const translated = lookup(locale, path);
        expect(typeof translated, `${language} ${key}`).toBe('string');
        expect(
          codeSpans(translated as string).sort(),
          `${language} ${key}`
        ).toEqual(codeSpans(english).sort());
      });
    });
  });
});
