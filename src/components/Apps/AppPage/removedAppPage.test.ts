import { describe, expect, it } from 'vitest';
import { buildRemovedAppPage, removedAppMessages } from './removedAppPage';

const messages = {
  en: 'Its publisher removed this Q-App.',
  de: 'Der Herausgeber hat diese Q-App entfernt.',
  ar: 'أزال الناشر تطبيق Q-App هذا.',
};

describe('the page that takes a removed app’s place', () => {
  it('shows the title and the line in the publisher’s language', () => {
    const html = buildRemovedAppPage({ title: 'Q-Blog', lang: 'de', messages });
    expect(html).toContain('<title>Q-Blog</title>');
    expect(html).toContain('<h1>Q-Blog</h1>');
    expect(html).toContain(`<p id="note">${messages.de}</p>`);
    expect(html).toContain('<html lang="de" dir="ltr">');
  });

  it('falls back to English, and writes Arabic right to left', () => {
    expect(buildRemovedAppPage({ title: 'X', lang: 'xx', messages })).toContain(
      `<p id="note">${messages.en}</p>`
    );
    expect(buildRemovedAppPage({ title: 'X', lang: 'ar', messages })).toContain(
      '<html lang="ar" dir="rtl">'
    );
  });

  it('carries every language, for the viewer’s own', () => {
    const html = buildRemovedAppPage({ title: 'X', lang: 'en', messages });
    expect(html).toContain('"de":"Der Herausgeber hat diese Q-App entfernt."');
    expect(html).toContain("query.get('lang')");
    expect(html).toContain("query.get('theme')");
  });

  it('keeps a title or a line from breaking out of the page', () => {
    const html = buildRemovedAppPage({
      title: '<img src=x onerror=alert(1)>',
      lang: 'en',
      messages: { en: '</script><script>alert(1)</script>' },
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    // Inside the script the line can't close it.
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it('loads nothing from anywhere else', () => {
    const html = buildRemovedAppPage({ title: 'X', lang: 'en', messages });
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/\ssrc=/);
  });
});

describe('the line in every language', () => {
  const store = {
    store: { data: { en: {}, de: {}, fi: {} } },
    getResource: (lng: string, _ns: string, key: string) =>
      ({
        en: {
          'app_page.hide.removed_app': 'Its publisher removed this Q-App.',
          'app_page.hide.removed_website':
            'Its publisher removed this website.',
        },
        de: {
          'app_page.hide.removed_app':
            ' Der Herausgeber hat diese Q-App entfernt. ',
        },
      })[lng]?.[key],
  };

  it('reads each language’s own line, without falling back to English', () => {
    expect(removedAppMessages(store, 'APP')).toEqual({
      en: 'Its publisher removed this Q-App.',
      de: 'Der Herausgeber hat diese Q-App entfernt.',
    });
    expect(removedAppMessages(store, 'website')).toEqual({
      en: 'Its publisher removed this website.',
    });
  });
});
