# I18N Guidelines

In JSON file:

- Keep the file sorted
- Always write in lowercase

In GUI:

- If the first letter of the translation must be uppercase, use the postProcess, for example: `{t_auth('advanced_users', { postProcess: 'capitalizeFirst' })}`
