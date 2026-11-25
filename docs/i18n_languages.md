# I18N Guidelines

[react-i18next](https://react.i18next.com/) is the framework used for
internationalization. Setup lives in `src/i18n/i18n.ts`.

**Every user-visible string must go through i18next** — including `aria-label`,
placeholders, tooltips, and error messages. A hardcoded English literal is a bug.

## Locales

Locales are in `./src/i18n/locales`, one folder per language. A single JSON file
represents a namespace (a group of translations), nested by topic.

Twelve languages ship:

| code | language | code | language  |
| ---- | -------- | ---- | --------- |
| `en` | English  | `it` | Italiano  |
| `ar` | العربية  | `ja` | 日本語    |
| `de` | Deutsch  | `pt` | Português |
| `es` | Español  | `ru` | Русский   |
| `et` | Eesti    | `zh` | 中文      |
| `fi` | Suomi    | `fr` | Français  |

`en` is the baseline. **Every key must exist in all twelve folders**, and its
value must be written in the language of the folder it sits in — `de/core.json`
holds German, `ja/core.json` Japanese. English text left in a non-English locale
is an unfinished key, not an acceptable placeholder: it renders as English to
that user.

**Keys are sorted alphabetically at every nesting level.** This is mandatory, not
cosmetic: it makes a key findable by eye, keeps siblings together, and stops two
people appending to the same spot from conflicting. The tooling sorts on write,
so you rarely need to think about it — but never hand-append a key to the end of
a block.

```bash
python3 .agents/skills/i18n/i18n_sort.py           # sort every locale file
python3 .agents/skills/i18n/i18n_sort.py --check   # exit 1 if anything is unsorted (CI)
```

## Namespaces

| namespace  | contents                                                     |
| ---------- | ------------------------------------------------------------ |
| `auth`     | authentication — names, addresses, keys, secrets, seedphrase |
| `core`     | shared UI vocabulary and generic messages                    |
| `group`    | group management, chat and Reticulum features                |
| `node`     | node setup and connection                                    |
| `question` | questions put to the user                                    |

Always prefix a key with its namespace — `t('core:action.close')`. `core` is the
default namespace, but be explicit anyway. Using several namespaces on one page
is fine.

Please avoid duplicating the same translation across keys; reuse the existing one.

Adding a _new_ namespace also requires registering it in the `namespaces` array
in `src/i18n/i18n.ts` — the locale files are glob-loaded, but the namespace list
is explicit.

## Casing

**A value may start uppercase or lowercase.** Both appear in the codebase and
both are acceptable. What matters is that the string renders correctly where it
is used.

Two workable styles:

- **lowercase source + `postProcess`** — best for short, reusable labels, so the
  same key can render as `Close`, `CLOSE` or `close` depending on the call site:

  ```tsx
  t('core:action.close', { postProcess: 'capitalizeFirstChar' });
  ```

- **natural capitalization in the source** — reasonable for full sentences and
  prose, where the string is only ever shown one way.

Be consistent within a subtree, and never do `t(...).toUpperCase()` in JSX —
use a post-processor so other languages capitalize by their own rules.

Available processors (defined in `src/i18n/processors.ts`, registered in
`src/i18n/i18n.ts`):

| Processor                  | Effect                                     |
| -------------------------- | ------------------------------------------ |
| `capitalizeFirstChar`      | `close` → `Close` — the usual choice       |
| `capitalizeFirstWord`      | uppercases the whole first word            |
| `capitalizeEachFirstChar`  | Title Case                                 |
| `capitalizeSentenceStarts` | capitalizes after `.` `!` `?` and newlines |
| `capitalizeAll`            | ALL CAPS — for stat labels and similar     |

## Interpolation

```tsx
t('group:message.error.qortals_required', { quantity: 4 });
```

- Keep every `{{placeholder}}` name identical to the English source. Reorder them
  freely within the sentence to suit the target language's word order.
- Both `{{name}}` and `{{ name }}` work — i18next trims. Both spacing styles
  exist in the files; match whichever the neighbouring keys use.
- Never build a sentence by concatenating translated fragments — word order
  differs across languages. Put the whole sentence in one key with placeholders.

## Plurals

Use a base key plus i18next's plural suffixes; i18next selects on the `count`
option:

```json
{ "thread_one": "{{count}} thread", "thread_other": "{{count}} threads" }
```

English needs only `_one` and `_other`. **Other languages may legitimately carry
extra categories** that English does not — `ru` uses `_few`, and Arabic may use
`_zero` and `_two`. These extra keys are correct and must not be deleted by
parity tooling. A translation may also omit `{{count}}` where the language does
not repeat the numeral (Arabic `_one`, for example).

## Leave untranslated

Proper nouns and protocol terms stay as they are in every language: `Qortal`,
`QORT`, `QDN`, `Reticulum`, `LXMF`, `Q-App`, `Q-Chat`, `Q-Mail`, `Q-Tube`,
`Quitter`. The same goes for URLs and API field names.

Some short words are genuine cognates and correctly identical to English —
`message` and `microphone` in French, `level` in German. Do not "fix" those.

## Tooling

Never hand-edit twelve locale files; that is how a key goes missing from one
language. The scripts live with the `i18n` agent skill in
`.agents/skills/i18n/`, all run from the repo root and take `--help`:

| Task                               | Command                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------- |
| Find hardcoded strings             | `python3 .agents/skills/i18n/i18n_scan_hardcoded.py <path>`             |
| Add new keys to all twelve locales | `python3 .agents/skills/i18n/i18n_add_keys.py <namespace> <patch.json>` |
| Apply reviewed translations        | `python3 .agents/skills/i18n/i18n_apply_translations.py <file.json>`    |
| Audit for English left behind      | `python3 .agents/skills/i18n/i18n_apply_translations.py --audit`        |
| Sort / verify sorting              | `python3 .agents/skills/i18n/i18n_sort.py [--check]`                    |

`i18n_add_keys.py` seeds a key into every locale and never overwrites an existing
value. Both it and `i18n_apply_translations.py` re-sort the file they write, so
the alphabetical order is maintained automatically. `i18n_apply_translations.py` refuses to write if a translation drops or
renames a placeholder, or names a key that does not exist.

Agents working in this repo should follow the `i18n` skill in
`.agents/skills/i18n/`, which describes the full migrate-then-translate workflow.

## Missing language?

- Please open an issue on the project's GitHub repository and specify the missing
  language, by clicking [New Issue](https://github.com/Qortal/Qortal-Hub/issues/new)
- You can also open a Pull Request if you would like to contribute directly.
