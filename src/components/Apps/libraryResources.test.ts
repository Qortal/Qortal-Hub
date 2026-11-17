import { describe, expect, it } from 'vitest';
import { isNamesOwnResource, namesOwnResources } from './libraryResources';

describe('library resources', () => {
  it("keeps each name's own app, however Core reports its identifier", () => {
    expect(isNamesOwnResource({})).toBe(true);
    expect(isNamesOwnResource({ identifier: null })).toBe(true);
    expect(isNamesOwnResource({ identifier: '' })).toBe(true);
    // Core's search cache, for an app published or updated since its refill.
    expect(isNamesOwnResource({ identifier: 'default' })).toBe(true);
  });

  it('leaves out resources published under an identifier', () => {
    expect(isNamesOwnResource({ identifier: 'q-mail-attachment' })).toBe(false);
    expect(isNamesOwnResource({ identifier: 'Default' })).toBe(false);
    expect(isNamesOwnResource(null)).toBe(false);
  });

  it('lists a fresh publish like any other app, without the identifier', () => {
    const list = namesOwnResources([
      { name: 'Q-Blog', service: 'APP' },
      { name: 'Tester Hub', service: 'APP', identifier: 'default', size: 7 },
      { name: 'Q-Mail', service: 'APP', identifier: 'other' },
    ]);
    expect(list).toEqual([
      { name: 'Q-Blog', service: 'APP' },
      { name: 'Tester Hub', service: 'APP', size: 7 },
    ]);
    expect('identifier' in list[1]).toBe(false);
  });

  it('copes with a missing list', () => {
    expect(namesOwnResources(undefined)).toEqual([]);
    expect(namesOwnResources(null)).toEqual([]);
  });
});
