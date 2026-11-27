import { describe, expect, it } from 'vitest';
import { buildQortalResourceLink } from './index';
import { extractComponents } from '../../components/Chat/MessageDisplay';
import { buildAppRenderRoot } from '../../components/Apps/appRenderUrl';
import { splitTextLinks } from '../../components/Apps/AppPage/appPageLink';
import {
  buildBookmarkLink,
  parseBookmarkLink,
} from '../../components/Apps/AppBookmarks/bookmarkStorage';
import { qappGuestUrlAllowed } from '../../../electron/src/qapp-guest-policy';

describe('Qortal link name round trips', () => {
  it('opens the encoded address-bar link as Qortal Together, not Qortal%20Together', () => {
    const parsed = extractComponents('qortal://APP/Qortal%20Together');
    expect(parsed?.name).toBe('Qortal Together');
    const root = buildAppRenderRoot(
      'https://core.example',
      parsed!.service,
      parsed!.name
    );
    expect(root).toBe('https://core.example/render/APP/Qortal%20Together');
    expect(root).not.toContain('%2520');
    expect(
      qappGuestUrlAllowed(root, root, { ...parsed!, tabId: 'tab' }, false)
    ).toBe(true);
  });

  it.each([
    'Qortal Together',
    'Q-Shop+',
    'Café',
    'literal%20name',
    '100%',
    'name#fragment',
    'name?query',
  ])(
    'round trips %s through copied links, bookmarks and guest rendering',
    (name) => {
      const input = {
        service: 'APP',
        name,
        path: '/file/id%2Fpart',
        identifier: 'version+1',
      };
      const copied = buildQortalResourceLink(input);
      const parsed = extractComponents(copied)!;
      expect(parsed).toEqual({
        service: 'APP',
        name,
        path: 'file/id%2Fpart',
        identifier: 'version+1',
      });
      const root = buildAppRenderRoot(
        'https://core.example',
        parsed.service,
        parsed.name
      );
      expect(decodeURIComponent(new URL(root).pathname.split('/')[3])).toBe(
        name
      );
      expect(
        qappGuestUrlAllowed(
          root,
          `${root}/${parsed.path}`,
          { ...parsed, tabId: 'tab' },
          false
        )
      ).toBe(true);
      const bookmark = buildBookmarkLink({
        service: 'APP',
        appName: name,
        path: input.path,
        identifier: input.identifier,
      });
      expect(parseBookmarkLink(bookmark)).toEqual({
        service: 'APP',
        appName: name,
        path: 'file/id%2Fpart',
        identifier: 'version+1',
      });
    }
  );

  it('decodes names once and leaves route escapes and query values intact', () => {
    const parsed = extractComponents(
      'qortal://APP/literal%2520name/path%2Fsegment?value=a%2Bb&identifier=v%2B1'
    );
    expect(parsed).toEqual({
      service: 'APP',
      name: 'literal%20name',
      path: 'path%2Fsegment?value=a%2Bb',
      identifier: 'v+1',
    });
  });

  it.each([
    ['qortal://Qortal%20Together', 'Qortal Together'],
    ['qortal://APP/Qortal Together', 'Qortal Together'],
    ['qortal://APP/Q-Shop+', 'Q-Shop+'],
    ['qortal://APP/Q-Shop%2B', 'Q-Shop+'],
    ['qortal://APP/100%', '100%'],
  ])('accepts existing raw and encoded names in %s', (link, name) => {
    expect(extractComponents(link)?.name).toBe(name);
  });

  it.each([
    'Publisher!',
    'Publisher v2.',
    'Publisher (QORT)',
    '....',
    "Publisher's Apps",
  ])("keeps %s whole in the top bar's link, also in a page's text", (name) => {
    const copied = buildQortalResourceLink({ service: 'APP', name });
    expect(extractComponents(copied)).toEqual({
      service: 'APP',
      name,
      identifier: undefined,
      path: '',
    });
    // A page's text reads links without the sentence's punctuation after
    // them, and ends one at a quote.
    const [link] = splitTextLinks(`Open ${copied}.`).filter(
      (part) => part.kind === 'link'
    );
    expect(extractComponents(link.value)?.name).toBe(name);
  });

  it.each(['v2.', 'build(2)', "it's"])(
    "keeps the identifier %s whole at the end of the top bar's link",
    (identifier) => {
      const copied = buildQortalResourceLink({
        service: 'WEBSITE',
        name: 'Opened-App',
        identifier,
      });
      expect(extractComponents(copied)?.identifier).toBe(identifier);
      const [link] = splitTextLinks(`Open ${copied}.`).filter(
        (part) => part.kind === 'link'
      );
      expect(extractComponents(link.value)?.identifier).toBe(identifier);
    }
  );

  it('escapes the name the same way with a page or an identifier after it', () => {
    expect(
      buildQortalResourceLink({
        service: 'APP',
        name: 'Publisher (QORT)',
        path: '/post/1',
      })
    ).toBe('qortal://APP/Publisher%20%28QORT%29/post/1');
    expect(
      buildQortalResourceLink({
        service: 'WEBSITE',
        name: 'Publisher v2.',
        identifier: 'v2.',
      })
    ).toBe('qortal://WEBSITE/Publisher%20v2%2E?identifier=v2%2E');
    expect(
      buildQortalResourceLink({ service: 'WEBSITE', name: 'Notes v2.0' })
    ).toBe('qortal://WEBSITE/Notes%20v2.0');
  });
});
