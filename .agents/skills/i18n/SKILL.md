---
name: i18n
description: Rules for user-visible text in Qortal Hub. Read BEFORE writing or editing any component, dialog, menu, toast, tooltip, aria-label, placeholder, or error message. Every user-facing string must go through i18next — never hardcode English. Triggers on any UI work, any new component, any string a user could read.
---

# i18n is mandatory for every user-visible string

Qortal Hub ships in 12 languages. A hardcoded English literal is a bug, not a
shortcut. This applies to **new code and to any line you touch in existing code**.

## What counts as user-visible

Translate all of these — the last three are the ones most often missed:

- JSX text content, `Typography`, `Button`, `MenuItem` children
- `label`, `placeholder`, `title`, `helperText`, `alt`
- **`aria-label` and every other accessibility string**
- **Error and status messages**, including ones thrown/rejected from async code
- **Strings built in plain `.ts` helper modules** that end up on screen

Do NOT translate: log messages, event names passed to `executeEvent` /
`subscribeToEvent`, API field names, test fixtures, `data-*` attributes.

## The pattern in components

```tsx
import { useTranslation } from 'react-i18next';

const { t } = useTranslation(['auth', 'core', 'group', 'question']);

<Button>
  {t('core:action.close', { postProcess: 'capitalizeFirstChar' })}
</Button>;
```

Declare only the namespaces the component actually uses. Always prefix the key
with its namespace (`core:`, `group:`, …) — the default namespace is `core`, but
be explicit anyway.

## The pattern outside components

Non-React modules import the instance directly rather than using the hook:

```ts
import i18n from '../i18n/i18n';

throw new Error(
  i18n.t('auth:message.error.invalid_uint8', {
    postProcess: 'capitalizeFirstChar',
  })
);
```

For pure helper modules that return display text (see
`src/components/QortalLand/games/gameDialogText.ts` for the anti-pattern), prefer
**taking `t` as a parameter** so the caller's namespaces and language reactivity
apply. Return a key + params object instead of a sentence when that is cleaner.

## Casing

**A value may start uppercase or lowercase** — both are accepted (see
`docs/i18n_languages.md`). Pick per case:

- **lowercase source + `postProcess`** for short reusable labels, so one key can
  render as `Close`, `CLOSE` or `close` depending on the call site
- **natural capitalization** for full sentences shown only one way

Be consistent within a subtree. Never do `t(...).toUpperCase()` in JSX — use a
post-processor, so other languages capitalize by their own rules.

Available processors (see `src/i18n/processors.ts`):

| Processor                  | Effect                                     |
| -------------------------- | ------------------------------------------ |
| `capitalizeFirstChar`      | `close` → `Close` — the default choice     |
| `capitalizeFirstWord`      | first word uppercased entirely             |
| `capitalizeEachFirstChar`  | Title Case                                 |
| `capitalizeSentenceStarts` | capitalizes after `.`/`!`/`?` and newlines |
| `capitalizeAll`            | ALL CAPS — for stat labels and similar     |

## Never hand-edit 12 locale files

Every locale operation has a script, and they ship with this skill in
`.agents/skills/i18n/`. Editing the JSON by hand is how keys go missing
from one language, so reach for these instead:

| Task                              | Command                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------- |
| Find what needs migrating         | `python3 .agents/skills/i18n/i18n_scan_hardcoded.py <path>`                  |
| Seed new keys into all 12 locales | `python3 .agents/skills/i18n/i18n_add_keys.py <ns> <patch.json>`             |
| Apply the translations            | `python3 .agents/skills/i18n/i18n_apply_translations.py <translations.json>` |
| Check nothing is left             | `python3 .agents/skills/i18n/i18n_apply_translations.py --audit`             |
| Sort / verify sorting             | `python3 .agents/skills/i18n/i18n_sort.py [--check]`                         |

All four run from the repo root and take `--help`. They locate the locales
themselves, so the working directory only matters for the paths you pass in.
`.claude/skills/i18n/…` works too — it is the same folder through the
symlink — but prefer the `.agents/` path, which exists in a fresh clone.

**Locale files are sorted alphabetically at every nesting level, and that is
mandatory.** `i18n_add_keys.py` and `i18n_apply_translations.py` re-sort the file
they write, so following the workflow keeps it true automatically. If you ever
edit a locale file by hand, run `i18n_sort.py` afterwards; `--check` exits 1 on
anything unsorted and is what CI should call.

## The workflow

### 1. Find the strings

```bash
python3 .agents/skills/i18n/i18n_scan_hardcoded.py src/components/Chat          # summary per file
python3 .agents/skills/i18n/i18n_scan_hardcoded.py --detail <file>              # every hit
python3 .agents/skills/i18n/i18n_scan_hardcoded.py -o /tmp/hits.json src/       # machine-readable
```

Hits are candidates, not confirmed defects — CSS values and API field names show
up too. Read them before acting.

### 2. Seed the keys

Write a patch file mirroring the locale structure, values in English:

```json
{
  "expiry": {
    "no_expiry": "no expiry",
    "maximum": "maximum {{duration}}"
  }
}
```

Then seed all 12 locales at once:

```bash
python3 .agents/skills/i18n/i18n_add_keys.py reticulum /tmp/new-keys.json --dry-run   # preview
python3 .agents/skills/i18n/i18n_add_keys.py reticulum /tmp/new-keys.json
```

It never overwrites an existing value, so it is safe to re-run as the patch
grows, and it re-sorts the file on write — never hand-append a key to the end of
a block. Nest values by topic. Pick the namespace by domain:
`core` for shared UI vocabulary and generic messages, `reticulum` for the
Reticulum Q-Chat surface (channels, calls, invites, image viewer, user card,
chat settings), `group` for everything else about Qortal groups and the
onboarding/home dashboard, `auth`, `node`, `question` for their own areas.
A _new_ namespace also has to be registered in the `namespaces` array in
`src/i18n/i18n.ts` and in `NAMESPACES` in `i18n_add_keys.py`.

At this point all 12 locales hold English. That is a deliberate, temporary state
— it keeps the key set complete so nothing crashes mid-task. Keep the list of
keys you added; step 4 needs it.

### 3. Migrate the components

Replace the literals with `t()` calls. Do not stop to translate — that fragments
the work and produces inconsistent wording across a feature.

### 4. Translate, in one batch, at the end

**Every value must be written in the language of its folder.** `de/core.json`
holds German, `ja/core.json` Japanese, `ar/core.json` Arabic. English sitting in
a non-English locale is an unfinished key, not a valid placeholder — it renders
as English to that user, which is the exact bug this skill exists to prevent.

Translate the whole set in one pass, language by language — that is what keeps
terminology consistent, so the same button label is not rendered three different
ways in one locale. Write them as namespace → language → dotted key → value:

```json
{
  "reticulum": {
    "de": { "expiry.no_expiry": "kein ablauf" },
    "fi": { "expiry.no_expiry": "ei vanhenemista" }
  }
}
```

```bash
python3 .agents/skills/i18n/i18n_apply_translations.py /tmp/translations.json
```

It aborts before writing anything if a value drops or renames a `{{placeholder}}`,
is empty, or names a key that does not exist. Casing is not checked — see below.

The task is not finished while any non-English locale still holds English for a
key you introduced.

#### Translation rules

- Casing follows the English source's style for that key. Do not force lowercase
  on languages that capitalize by rule — German nouns, for instance.
- Preserve every `{{placeholder}}` name exactly; reorder them freely within the
  sentence to suit the target language's word order.
- Leave proper nouns and protocol terms untranslated: `Qortal`, `QORT`, `QDN`,
  `Reticulum`, `Q-App`, `Q-Tube`, `Quitter`, `LXMF`.
- `ar` is right-to-left; write natural Arabic and let the UI handle direction.
- For `ja` and `zh`, do not insert spaces between characters the way the English
  source has them.
- Match the register of the existing translations in that file rather than
  translating word for word — check a neighbouring key before inventing a term.

### 5. Verify

```bash
python3 .agents/skills/i18n/i18n_apply_translations.py --audit
```

Lists values still identical to English. It compares against `en`, so genuine
cognates (`message` and `microphone` in French, `level` in German) appear as
false positives — confirm before "fixing" them.

## Key naming

Follow the existing shape in the JSON files:

- Actions: `core:action.close`, `core:action.add_reaction`
- Errors: `core:message.error.generic`, `group:message.error.qortals_required`
- Questions/confirms: `core:message.question.delete_chat_image`
- Plurals: base key plus `_other` (`core:admin` / `core:admin_other`) — i18next
  selects via the `count` option.

Use `snake_case`, no abbreviations, name by meaning rather than by the English
wording so the key survives a copy edit.

## Interpolation

```tsx
t('group:message.error.qortals_required', {
  quantity: 4,
  postProcess: 'capitalizeFirstChar',
});
```

Never concatenate translated fragments to build a sentence — word order differs
across languages. Put the whole sentence in one key with placeholders.

## Known gaps — do not imitate the neighbours

Large parts of the newer UI were written **without** i18n and are being migrated:

- Most `Reticulum*` components in `src/components/Chat/`
- The whole of `src/components/QortalLand/` (including `games/` and `proximity/`)
- Leftover literals inside otherwise-translated files such as `ChatGroup.tsx`
  and `MessageItem.tsx`

"Match the surrounding code" does not apply here. When editing these files, use
`t()` for the lines you touch, and mention any remaining hardcoded strings you
noticed rather than silently leaving them.

Run the scanner over the file you are about to touch to see what you are walking
into:

```bash
python3 .agents/skills/i18n/i18n_scan_hardcoded.py --detail src/components/Chat/ChatGroup.tsx
```

## Before you finish

Both of these must come back clean — they are the definition of done:

```bash
python3 .agents/skills/i18n/i18n_scan_hardcoded.py --detail <file>   # no user-readable English left
python3 .agents/skills/i18n/i18n_apply_translations.py --audit       # no English in non-English locales
python3 .agents/skills/i18n/i18n_sort.py --check                     # locale files still sorted
```

Anything the first returns that a user can read must become a `t()` call. Any key
you added that the second still reports means the batch translation is unfinished
— and so is the task. Also run `npx vitest run <dir>` and
`npx eslint <changed files>` before reporting.
