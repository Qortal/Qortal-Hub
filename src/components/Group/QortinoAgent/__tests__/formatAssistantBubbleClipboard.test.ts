import { describe, expect, it } from 'vitest';
import i18n from '../../../../i18n/i18n';
import { formatAssistantBubbleForClipboard } from '../formatAssistantBubbleClipboard';
import { matchQAppCatalog } from '../../../../qortinoAgent/qAppCatalog';

describe('formatAssistantBubbleForClipboard', () => {
  it('copies the answer text', () => {
    expect(
      formatAssistantBubbleForClipboard(
        { content: '  Boil for one minute.  ' },
        i18n.t.bind(i18n)
      )
    ).toBe('Boil for one minute.');
  });

  it('adds the Q-App cards and guide links shown under the answer', () => {
    const app = matchQAppCatalog('what is Q-Assets');
    expect(app).not.toBeNull();
    const text = formatAssistantBubbleForClipboard(
      {
        content: 'Q-Assets manages native assets.',
        apps: [app!],
        links: [
          {
            id: 'guide',
            label: 'Q-Minter Guide',
            service: 'WEBSITE',
            name: 'Q-Minter',
          },
          { id: 'web', label: 'qortal.dev', href: 'https://qortal.dev' },
        ],
      },
      i18n.t.bind(i18n)
    );
    expect(text).toContain('Q-Assets manages native assets.');
    expect(text).toContain('Q-Apps:\n• Q-Assets');
    expect(text).toContain('• Q-Minter Guide: qortal://WEBSITE/Q-Minter');
    expect(text).toContain('• qortal.dev: https://qortal.dev');
    expect(text).toContain('Links:\n• Q-Minter Guide');
  });

  it("writes the headings in the user's language", async () => {
    await i18n.changeLanguage('de');
    try {
      const text = formatAssistantBubbleForClipboard(
        {
          content: 'x',
          links: [
            { id: 'web', label: 'qortal.dev', href: 'https://qortal.dev' },
          ],
        },
        i18n.t.bind(i18n)
      );
      expect(text).toContain('Links:\n• qortal.dev');
      await i18n.changeLanguage('es');
      expect(
        formatAssistantBubbleForClipboard(
          {
            content: 'x',
            links: [
              { id: 'web', label: 'qortal.dev', href: 'https://qortal.dev' },
            ],
          },
          i18n.t.bind(i18n)
        )
      ).toContain('Enlaces:\n• qortal.dev');
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
