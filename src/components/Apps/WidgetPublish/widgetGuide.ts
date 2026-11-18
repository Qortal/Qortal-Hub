/**
 * The guide to building a widget, shown by the publish form: a short version
 * in the (i) beside the Widget option, and the whole guide on a full page,
 * which can be copied as Markdown for notes or an AI assistant.
 *
 * The words are translations (`core:widget_guide.*`); code is not. In the
 * texts, `backticks` mark code, as in Markdown: the page shows it as code and
 * the copy keeps it as it is. It follows the widget contract in
 * docs/home-widgets.md, which Qortal GO shares.
 */

const K = 'core:widget_guide';

export type GuideBlock =
  | { kind: 'text'; key: string }
  | { kind: 'list'; keys: string[] }
  | { kind: 'code'; language: 'html' | 'js' | 'text'; code: string };

export interface GuideSection {
  id: string;
  titleKey: string;
  blocks: GuideBlock[];
}

export const WIDGET_GUIDE_TITLE_KEY = `${K}.title`;
export const WIDGET_GUIDE_LEAD_KEY = `${K}.lead`;

/** The short version, beside the Widget option. */
export const WIDGET_GUIDE_TIP_TITLE_KEY = `${K}.tip.title`;
export const WIDGET_GUIDE_TIP_KEYS = [
  `${K}.tip.first_frame`,
  `${K}.tip.any_size`,
  `${K}.tip.theme`,
  `${K}.tip.read_only`,
  `${K}.tip.request`,
];

const list = (section: string, items: string[]): GuideBlock => ({
  kind: 'list',
  keys: items.map((item) => `${K}.${section}.${item}`),
});
const text = (section: string, item: string): GuideBlock => ({
  kind: 'text',
  key: `${K}.${section}.${item}`,
});

const LOAD_URL =
  '<node>/render/APP/<name>?theme=dark&lang=en&identifier=go-widget-<slug>&goWidget=1';

const SIZE_REQUEST = `const inWidget = new URLSearchParams(location.search).get('goWidget') === '1';
if (inWidget && typeof qortalRequest === 'function') {
  Promise.race([
    qortalRequest({ action: 'GO_WIDGET_SET_SIZE', width: 'half', height: 196 }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
  ]).catch(() => {});
}`;

const MESSAGES = `addEventListener('message', ({ data }) => {
  if (data?.action === 'GO_WIDGET_VISIBILITY') setVisible(!!data.payload?.visible);
  if (data?.action === 'THEME_CHANGED') setTheme(data.theme);
  if (data?.action === 'LANGUAGE_CHANGED') setLanguage(data.language);
});`;

const OPEN_APP = `qortalRequest({
  action: 'OPEN_NEW_TAB',
  qortalLink: 'qortal://APP/YourApp/path/inside/your/app',
}).catch(() => {});`;

/**
 * A whole widget, small on purpose: the newest Q-App, in the right theme,
 * paused while hidden, refreshed every few minutes, opening the app on a tap.
 */
export const WIDGET_STARTER = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      :root { color-scheme: dark; --fg: #f2f4f8; --muted: rgba(242, 244, 248, 0.62); }
      :root[data-theme='light'] { color-scheme: light; --fg: #15181e; --muted: rgba(21, 24, 30, 0.6); }
      html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; color: var(--fg); font: 14px/1.3 system-ui, sans-serif; }
      button { all: unset; box-sizing: border-box; cursor: pointer; display: block; width: 100%; height: 100%; padding: 10px 12px; border-radius: 12px; }
      button:focus-visible { outline: 2px solid currentColor; outline-offset: -2px; }
      .label { display: block; color: var(--muted); font-size: 12px; }
      .title { display: block; font-size: 16px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    </style>
  </head>
  <body>
    <button id="widget" type="button">
      <span class="label" id="label"></span>
      <span class="title" id="title"></span>
    </button>
    <script>
      const params = new URLSearchParams(location.search);
      const inWidget = params.get('goWidget') === '1';
      const KEY = 'yourname.go-widget-newest.v1'; // start every key with your name
      const EVERY = 5 * 60_000;
      const TEXT = {
        en: { label: 'Newest Q-App', error: "Can't load this right now." },
        de: { label: 'Neueste Q-App', error: 'Gerade nicht ladbar.' },
      };
      let item = null;
      let failed = false;
      let lastLoad = 0;
      let visible = true;
      let timer = 0;
      try { item = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}

      const setTheme = (theme) => {
        document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
      };
      let lang = 'en';
      const setLanguage = (code) => {
        lang = String(code || 'en').toLowerCase().split(/[-_]/)[0];
        document.documentElement.lang = lang;
      };
      const text = (key) => (TEXT[lang] || TEXT.en)[key];
      setTheme(params.get('theme'));
      setLanguage(params.get('lang'));

      // Core's qortalRequest is a global name, not window.qortalRequest.
      const ask = (request, ms = 3000) =>
        typeof qortalRequest !== 'function'
          ? Promise.reject(new Error('no Core'))
          : Promise.race([
              qortalRequest(request),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
            ]);

      function draw() {
        document.getElementById('label').textContent = text('label');
        document.getElementById('title').textContent =
          item ? item.title : failed ? text('error') : '…';
      }

      async function refresh() {
        try {
          const found = await ask(
            { action: 'SEARCH_QDN_RESOURCES', service: 'APP', includeMetadata: true, excludeBlocked: true, reverse: true, limit: 10 },
            30000
          );
          // An app's own resource, not a widget beside it; size 32 is deleted.
          const newest = (Array.isArray(found) ? found : []).find(
            (r) => (!r.identifier || r.identifier === 'default') && r.size !== 32
          );
          if (newest) {
            item = { name: newest.name, title: newest.metadata?.title || newest.name };
            try { localStorage.setItem(KEY, JSON.stringify(item)); } catch {}
          }
          failed = false;
        } catch {
          failed = true; // keep what is shown
        }
        lastLoad = Date.now();
        draw();
        plan();
      }

      // Loads when due, and only while the widget can be seen.
      function plan() {
        clearTimeout(timer);
        if (!visible || document.visibilityState === 'hidden') return;
        timer = setTimeout(refresh, Math.max(0, lastLoad + EVERY - Date.now()));
      }

      addEventListener('message', ({ data }) => {
        if (data?.action === 'GO_WIDGET_VISIBILITY') { visible = !!data.payload?.visible; plan(); }
        if (data?.action === 'THEME_CHANGED') setTheme(data.theme);
        if (data?.action === 'LANGUAGE_CHANGED') { setLanguage(data.language); draw(); }
      });
      document.addEventListener('visibilitychange', plan);
      document.getElementById('widget').onclick = () => {
        if (item) ask({ action: 'OPEN_NEW_TAB', qortalLink: 'qortal://APP/' + encodeURIComponent(item.name) }).catch(() => {});
      };

      draw();
      plan();
      if (inWidget) ask({ action: 'GO_WIDGET_SET_SIZE', width: 'half', height: 92 }).catch(() => {});
    </script>
  </body>
</html>`;

export const WIDGET_GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'look',
    titleKey: `${K}.look.title`,
    blocks: [
      list('look', ['one_job', 'fit', 'background', 'fast', 'input', 'open']),
    ],
  },
  {
    id: 'publish',
    titleKey: `${K}.publish.title`,
    blocks: [
      list('publish', [
        'ids',
        'name',
        'listing',
        'bundle',
        'update',
        'own_app',
      ]),
    ],
  },
  {
    id: 'start',
    titleKey: `${K}.start.title`,
    blocks: [
      { kind: 'code', language: 'text', code: LOAD_URL },
      list('start', ['param', 'theme', 'request', 'storage']),
    ],
  },
  {
    id: 'size',
    titleKey: `${K}.size.title`,
    blocks: [
      list('size', ['grid', 'ask']),
      { kind: 'code', language: 'js', code: SIZE_REQUEST },
      list('size', ['values', 'only_widget']),
    ],
  },
  {
    id: 'messages',
    titleKey: `${K}.messages.title`,
    blocks: [
      list('messages', ['visibility', 'theme', 'poll']),
      { kind: 'code', language: 'js', code: MESSAGES },
    ],
  },
  {
    id: 'requests',
    titleKey: `${K}.requests.title`,
    blocks: [
      list('requests', ['read', 'always', 'screen', 'never', 'web']),
      text('requests', 'open'),
      { kind: 'code', language: 'js', code: OPEN_APP },
    ],
  },
  {
    id: 'test',
    titleKey: `${K}.test.title`,
    blocks: [list('test', ['tab', 'widget', 'update'])],
  },
  {
    id: 'starter',
    titleKey: `${K}.starter.title`,
    blocks: [
      text('starter', 'intro'),
      { kind: 'code', language: 'html', code: WIDGET_STARTER },
    ],
  },
];

/** Every translated key of the guide, for checks. */
export const widgetGuideKeys = (): string[] => [
  WIDGET_GUIDE_TITLE_KEY,
  WIDGET_GUIDE_LEAD_KEY,
  WIDGET_GUIDE_TIP_TITLE_KEY,
  ...WIDGET_GUIDE_TIP_KEYS,
  ...WIDGET_GUIDE_SECTIONS.flatMap((section) => [
    section.titleKey,
    ...section.blocks.flatMap((block) =>
      block.kind === 'text'
        ? [block.key]
        : block.kind === 'list'
          ? block.keys
          : []
    ),
  ]),
];

type Translate = (key: string, options?: Record<string, unknown>) => string;

const capital = { postProcess: 'capitalizeFirstChar' };

/** The whole guide as Markdown, in the language `t` speaks. */
export const widgetGuideMarkdown = (t: Translate): string => {
  const parts = [
    `# ${t(WIDGET_GUIDE_TITLE_KEY, capital)}`,
    t(WIDGET_GUIDE_LEAD_KEY, capital),
  ];
  WIDGET_GUIDE_SECTIONS.forEach((section) => {
    parts.push(`## ${t(section.titleKey, capital)}`);
    section.blocks.forEach((block) => {
      if (block.kind === 'text') parts.push(t(block.key, capital));
      else if (block.kind === 'list') {
        parts.push(block.keys.map((key) => `- ${t(key, capital)}`).join('\n'));
      } else {
        parts.push(`\`\`\`${block.language}\n${block.code}\n\`\`\``);
      }
    });
  });
  return `${parts.join('\n\n')}\n`;
};

/** The pieces of `text` in turn: plain words, and code between backticks. */
export const splitCode = (
  text: string
): Array<{ code: boolean; text: string }> => {
  const pieces: Array<{ code: boolean; text: string }> = [];
  const pattern = /`([^`]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) {
      pieces.push({ code: false, text: text.slice(last, match.index) });
    }
    pieces.push({ code: true, text: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) pieces.push({ code: false, text: text.slice(last) });
  return pieces;
};

/** The code spans of a text, in order: translations must keep them as they are. */
export const codeSpans = (text: string): string[] =>
  splitCode(text)
    .filter((piece) => piece.code)
    .map((piece) => piece.text);
