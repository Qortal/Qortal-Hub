import { describe, expect, it, vi } from 'vitest';
import { parseReticulumEventLinks } from './ReticulumEventLinkPreview';

vi.mock('../Group/ReticulumGroupAbout', () => ({
  getReticulumGroupMetadata: vi.fn(),
}));

const eventLink =
  'qortal://APP/Q-Chat/calendar?groupId=42&eventId=14f883c2-6636-4b18-8f4b-bfd6f6f6e07c&occurrenceStart=1785708000000&timezone=Europe%2FBucharest';
const seriesLink =
  'qortal://APP/Q-Chat/calendar?groupId=42&eventId=14f883c2-6636-4b18-8f4b-bfd6f6f6e07c';
const useGroupEventLink =
  'qortal://use-group/action-calendar/groupid-42/eventid-14f883c2-6636-4b18-8f4b-bfd6f6f6e07c';

describe('parseReticulumEventLinks', () => {
  it('recognizes the built-in use-group calendar link', () => {
    expect(parseReticulumEventLinks(useGroupEventLink)).toEqual([
      {
        eventId: '14f883c2-6636-4b18-8f4b-bfd6f6f6e07c',
        groupId: 42,
        link: useGroupEventLink,
      },
    ]);
  });
  it('recognizes the compact event-series link copied by new clients', () => {
    expect(parseReticulumEventLinks(seriesLink)).toEqual([
      {
        eventId: '14f883c2-6636-4b18-8f4b-bfd6f6f6e07c',
        groupId: 42,
        link: seriesLink,
      },
    ]);
  });

  it('recognizes canonical Q-Chat calendar occurrence links', () => {
    expect(parseReticulumEventLinks(eventLink)).toEqual([
      {
        eventId: '14f883c2-6636-4b18-8f4b-bfd6f6f6e07c',
        groupId: 42,
        link: eventLink,
        occurrenceStart: 1785708000000,
        timezone: 'Europe/Bucharest',
      },
    ]);
  });

  it('keeps the legacy occurrence link format compatible', () => {
    const copiedLink =
      'qortal://APP/Q-Chat/calendar?groupId=1144&eventId=f4aab0e0-7ed1-4c6f-9eb2-e878277c20f9&occurrenceStart=1785711600000&timezone=Europe%2FBucharest';

    expect(parseReticulumEventLinks(`<p>${copiedLink}</p>`)).toEqual([
      {
        eventId: 'f4aab0e0-7ed1-4c6f-9eb2-e878277c20f9',
        groupId: 1144,
        link: copiedLink,
        occurrenceStart: 1785711600000,
        timezone: 'Europe/Bucharest',
      },
    ]);
  });

  it('does not depend on browser-specific custom-scheme URL parsing', () => {
    const originalUrl = globalThis.URL;
    class ChromiumStyleQortalUrl extends originalUrl {
      constructor(url: string | URL, base?: string | URL) {
        super(url, base);
        if (String(url).toLowerCase().startsWith('qortal://')) {
          throw new Error('The Event parser must not construct a URL object');
        }
      }
    }
    globalThis.URL = ChromiumStyleQortalUrl as typeof URL;
    try {
      expect(parseReticulumEventLinks(eventLink)).toHaveLength(1);
    } finally {
      globalThis.URL = originalUrl;
    }
  });

  it('finds an Event link in legacy and structured message payloads', () => {
    const copiedLink =
      'qortal://APP/Q-Chat/calendar?groupId=1144&eventId=f4aab0e0-7ed1-4c6f-9eb2-e878277c20f9&occurrenceStart=1785711600000&timezone=Europe%2FBucharest';
    const message = {
      messageText: 'encrypted-transport-payload',
      decryptedData: {
        message: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: copiedLink }],
            },
          ],
        },
      },
      text: `<p><a href="${copiedLink.replaceAll('&', '&amp;')}">${copiedLink}</a></p>`,
    };

    expect(parseReticulumEventLinks(message)[0]?.link).toBe(copiedLink);
  });

  it('reads HTML-escaped query separators and trims message punctuation', () => {
    const html = `<p>${eventLink.replaceAll('&', '&amp;')}).</p>`;
    expect(parseReticulumEventLinks(html)[0]?.link).toBe(eventLink);
  });

  it('ignores links in code blocks and rejects incomplete or invalid links', () => {
    expect(parseReticulumEventLinks(`<code>${eventLink}</code>`)).toEqual([]);
    expect(
      parseReticulumEventLinks(
        'qortal://APP/Q-Chat/calendar?groupId=0&eventId=nope&occurrenceStart=-1'
      )
    ).toEqual([]);
  });

  it('deduplicates links and limits large event embeds to one per message', () => {
    const second = eventLink
      .replace('groupId=42', 'groupId=43')
      .replace(
        '14f883c2-6636-4b18-8f4b-bfd6f6f6e07c',
        'ab62bc26-537d-4e38-8314-12925bc0fcbd'
      );
    expect(
      parseReticulumEventLinks(`${eventLink} ${eventLink} ${second}`)
    ).toHaveLength(1);
  });
});
