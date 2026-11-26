import { describe, expect, it } from 'vitest';
import { reticulumVisibleSearchTextFromPayload } from './reticulumSearchText';

describe('reticulumVisibleSearchTextFromPayload', () => {
  it('indexes reply message text without internal routing metadata', () => {
    const text = reticulumVisibleSearchTextFromPayload({
      repliedTo: '9994e676-5287-402e-8772-14e3e793c639',
      specialId: 'QLyi2',
      mentionedAddresses: ['QinternalMentionAddress'],
      messageText: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'sup' }],
          },
        ],
      },
    });

    expect(text).toBe('sup');
  });

  it('includes visible text and attachment names', () => {
    expect(
      reticulumVisibleSearchTextFromPayload({
        message: '<p>release notes</p>',
        attachments: [{ fileName: 'qortalHub.log' }, { name: 'report.pdf' }],
      })
    ).toBe('release notes qortalHub.log report.pdf');
  });
});
