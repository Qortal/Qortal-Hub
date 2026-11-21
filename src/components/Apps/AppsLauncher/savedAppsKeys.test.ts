import { describe, expect, it } from 'vitest';
import { bookmarkKeyOf, pinKeyOf, resourceKey } from './savedAppsKeys';

describe('saved app keys', () => {
  it('reads every way of writing the default resource as one', () => {
    const keys = [undefined, null, '', ' ', 'null', 'default'].map(
      (identifier) => resourceKey('app', 'Q-Mail', identifier)
    );
    expect(new Set(keys)).toEqual(new Set(['APP|q-mail|']));
  });

  it('keeps any other identifier exactly', () => {
    expect(resourceKey('DOCUMENT', 'Publisher', 'My Tool')).toBe(
      'DOCUMENT|publisher|My Tool'
    );
    expect(resourceKey('DOCUMENT', 'Publisher', 'Default')).toBe(
      'DOCUMENT|publisher|Default'
    );
  });

  it('tells two services of one name apart', () => {
    expect(resourceKey('APP', 'Publisher')).not.toBe(
      resourceKey('WEBSITE', 'Publisher')
    );
  });

  it("doesn't let a '|' in a name run into the next part", () => {
    expect(resourceKey('APP', 'a|b', '')).not.toBe(
      resourceKey('APP', 'a', 'b')
    );
    expect(resourceKey('APP', 'a|b', '')).toBe('APP|a%7Cb|');
    expect(resourceKey('APP', '50%', '')).toBe('APP|50%25|');
  });

  it('keys a name with spaces and capitals the same way every time', () => {
    expect(pinKeyOf({ name: ' Opened App ', service: 'APP' })).toBe(
      pinKeyOf({ name: 'opened app', service: 'app' })
    );
  });

  it('keys a private app by its encrypted resource', () => {
    expect(
      pinKeyOf({
        isPrivate: true,
        privateAppProperties: {
          name: 'Publisher',
          service: 'DOCUMENT',
          identifier: 'my-tool',
          groupId: 12,
        },
      })
    ).toBe('DOCUMENT|publisher|my-tool');
  });

  it('keys a bookmark by the page it opens', () => {
    const page = (path: string, identifier?: string) =>
      bookmarkKeyOf({ service: 'APP', appName: 'Q-Blog', identifier, path });
    expect(page('/blog/post-1/')).toBe('APP|q-blog||blog/post-1');
    expect(page('blog/post-1?x=1#top')).toBe(page('blog/post-1'));
    expect(page('blog/post-1', 'default')).toBe(page('blog/post-1'));
    expect(page('Blog/post-1')).not.toBe(page('blog/post-1'));
    expect(page('')).toBe('APP|q-blog||');
  });
});
