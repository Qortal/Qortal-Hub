"""Merge new translation keys into every locale file.

Adds a nested patch of keys to all 12 locales under src/i18n/locales/ so no
locale is ever left with a missing key. Existing values are never overwritten,
so this is safe to re-run.

The English text is written into every locale as a temporary placeholder. Those
placeholders must then be translated -- see i18n_apply_translations.py. A key
still holding English in a non-English locale is unfinished work, not a valid
default.

Usage:
    python3 .agents/skills/i18n/i18n_add_keys.py <namespace> <patch.json>
    python3 .agents/skills/i18n/i18n_add_keys.py group /tmp/new-chat-keys.json

The patch file mirrors the locale file structure, with values in English:

    {
      "reticulum": {
        "expiry": {
          "no_expiry": "no expiry",
          "maximum": "maximum {{duration}}"
        }
      }
    }
"""

import argparse
import json
import sys
from pathlib import Path

# .agents/skills/i18n/<this file> -> repo root
def _find_repo_root(start: Path) -> Path:
    for parent in [start, *start.parents]:
        if (parent / 'src' / 'i18n' / 'locales').is_dir():
            return parent
    return start.parents[2]


REPO_ROOT = _find_repo_root(Path(__file__).resolve().parent)
LOCALES = REPO_ROOT / 'src' / 'i18n' / 'locales'
LANGS = ['ar', 'de', 'en', 'es', 'et', 'fi', 'fr', 'it', 'ja', 'pt', 'ru', 'zh']
NAMESPACES = ['auth', 'core', 'explorer', 'group', 'node', 'question', 'reticulum']


def sort_node(node):
    """Recursively sort dict keys — locale files are kept alphabetical at every
    level so keys are findable by eye and appends do not collide. See
    .agents/skills/i18n/i18n_sort.py."""
    if isinstance(node, dict):
        return {k: sort_node(node[k]) for k in sorted(node, key=str.lower)}
    if isinstance(node, list):
        return [sort_node(item) for item in node]
    return node


def merge(dst, src, added, path=''):
    """Deep-merge src into dst without overwriting. Records added key paths."""
    for key, value in src.items():
        full = f'{path}.{key}' if path else key
        if isinstance(value, dict):
            if not isinstance(dst.get(key), dict):
                dst[key] = {}
            merge(dst[key], value, added, full)
        elif key not in dst:
            dst[key] = value
            added.append(full)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('namespace', choices=NAMESPACES)
    parser.add_argument('patch', help='JSON file of new keys, values in English')
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='report what would change without writing',
    )
    args = parser.parse_args()

    patch = json.loads(Path(args.patch).read_text(encoding='utf-8'))

    added_en = []
    for lang in LANGS:
        path = LOCALES / lang / f'{args.namespace}.json'
        if not path.exists():
            sys.exit(f'missing locale file: {path}')

        data = json.loads(path.read_text(encoding='utf-8'))
        added = []
        merge(data, patch, added)

        if lang == 'en':
            added_en = added
        if added and not args.dry_run:
            path.write_text(
                json.dumps(sort_node(data), ensure_ascii=False, indent=2) + '\n',
                encoding='utf-8',
            )

    for key in added_en:
        print(f'  + {args.namespace}:{key}')

    verb = 'would be added' if args.dry_run else 'added'
    print(f'\n{len(added_en)} keys {verb} to {args.namespace}.json across {len(LANGS)} locales')
    if added_en and not args.dry_run:
        print('Next: translate them with i18n_apply_translations.py')


if __name__ == '__main__':
    main()
