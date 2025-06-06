# I18N Guidelines

[react-i18next](https://react.i18next.com/) is the framework used for internationalization.

## Locales

Locales are in folder `./src/i18n/locales`, one folder per language.

A single JSON file represents a namespace (group of translation).
It's a key/value structure.

Please:

- Keep the file sorted
- First letter of each value is lowercase

Translation in GUI:

- If the first letter of the translation must be uppercase, use the postProcess, for example: `t('core:advanced_users', { postProcess: 'capitalizeFirstChar' })`
- For all translation in uppercase `{ postProcess: 'capitalizeAll' }`
- See `.src/i18n/i18n.ts` for processor definition

## Namespaces

These are the current namespaces, in which all translations are organized:

- `auth`: relative to the authentication (name, addresses, keys, secrets, seedphrase, and so on...)
- `core`: all the core translation
- `group`: all translations concerning group management
- `question`: all questions to the users
- `tutorial`: dedicated to the tutorial pages

Please avoid duplication of the same translation.
In the same page the usage of translations from different namespaces is permissible.

## Missing language?

- Please open an issue on the project's github repository and specify the missing language, by clicking [New Issue](https://github.com/Qortal/Qortal-Hub/issues/new)

- You can also open a Pull Request if you like to contribute directly to the project.
