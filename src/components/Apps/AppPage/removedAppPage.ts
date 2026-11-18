/**
 * The small page that takes an app's place when its publisher hides it and
 * chooses to replace it too (appHidden.ts): the app's title and a line saying
 * its publisher removed it. The line is in every language Hub has, and the
 * page picks the one Hub passes (`?lang=`), else the browser's; it follows
 * `?theme=` too, else the system's. One file, nothing loaded from elsewhere.
 */

/** The page is the whole app: its start page. */
export const REMOVED_PAGE_FILE = 'index.html';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

/** JSON inside a <script>: nothing in it can end the script. */
const scriptJson = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

const RTL_LANGUAGES = ['ar'];

const STYLE = `
:root{color-scheme:light;--bg:#f3f5f9;--card:#fff;--text:#151b26;--muted:#5d6779;--line:rgba(21,27,38,.12);--accent:#2f6fd6}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){color-scheme:dark;--bg:#0e1218;--card:#161c26;--text:#eef2f8;--muted:#9aa5b8;--line:rgba(255,255,255,.1);--accent:#7aa9f0}}
:root[data-theme=dark]{color-scheme:dark;--bg:#0e1218;--card:#161c26;--text:#eef2f8;--muted:#9aa5b8;--line:rgba(255,255,255,.1);--accent:#7aa9f0}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{width:100%;max-width:420px;padding:32px 28px;border:1px solid var(--line);border-radius:20px;background:var(--card);text-align:center}
svg{width:44px;height:44px;color:var(--accent)}
h1{margin:14px 0 6px;font-size:20px;line-height:1.25;overflow-wrap:anywhere}
p{margin:0;color:var(--muted)}
`.trim();

const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>';

/**
 * The page's HTML. `messages` holds the line in each language, by language
 * code; `lang` is the one written into the page for a viewer whose language
 * isn't among them, or who has scripts off.
 */
export const buildRemovedAppPage = ({
  title,
  lang,
  messages,
}: {
  title: string;
  lang: string;
  messages: Record<string, string>;
}): string => {
  const shownLang = messages[lang] ? lang : messages.en ? 'en' : lang;
  const line = messages[shownLang] || '';
  const dir = RTL_LANGUAGES.includes(shownLang) ? 'rtl' : 'ltr';
  const script = `(function(){
var messages=${scriptJson(messages)};
var rtl=${scriptJson(RTL_LANGUAGES)};
var query=new URLSearchParams(location.search);
var theme=query.get('theme');
if(theme==='dark'||theme==='light')document.documentElement.setAttribute('data-theme',theme);
var wanted=[query.get('lang'),navigator.language];
for(var i=0;i<wanted.length;i++){
var code=String(wanted[i]||'').toLowerCase().split('-')[0];
if(!messages[code])continue;
document.getElementById('note').textContent=messages[code];
document.documentElement.lang=code;
document.documentElement.dir=rtl.indexOf(code)===-1?'ltr':'rtl';
break;
}
})();`;
  return `<!doctype html>
<html lang="${escapeHtml(shownLang)}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${ICON}
<h1>${escapeHtml(title)}</h1>
<p id="note">${escapeHtml(line)}</p>
</main>
<script>${script}</script>
</body>
</html>
`;
};

/** What `removedAppMessages` reads translations from: an i18next instance. */
interface TranslationStore {
  store?: { data?: Record<string, unknown> };
  getResource: (lng: string, ns: string, key: string) => unknown;
}

/**
 * The line in every language Hub has, by language code, read straight from
 * each language's own strings (no fallback to English).
 */
export const removedAppMessages = (
  i18n: TranslationStore,
  service: string
): Record<string, string> => {
  const key =
    String(service).toUpperCase() === 'WEBSITE'
      ? 'app_page.hide.removed_website'
      : 'app_page.hide.removed_app';
  const messages: Record<string, string> = {};
  Object.keys(i18n.store?.data ?? {}).forEach((lng) => {
    const text = i18n.getResource(lng, 'core', key);
    if (typeof text === 'string' && text.trim()) messages[lng] = text.trim();
  });
  return messages;
};
