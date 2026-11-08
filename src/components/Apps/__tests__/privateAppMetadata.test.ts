import { describe, expect, it } from 'vitest';
import {
  buildMyPrivateAppsSearchUrl,
  buildPrivateAppDescription,
  parsePrivateAppGroupId,
  PRIVATE_APP_DESCRIPTION_MARKER,
  toPublishedPrivateApps,
} from '../privateAppMetadata';

describe('privateAppMetadata', () => {
  it('round-trips the group ID through the description', () => {
    const description = buildPrivateAppDescription(42);

    expect(description.startsWith(PRIVATE_APP_DESCRIPTION_MARKER)).toBe(true);
    expect(parsePrivateAppGroupId(description)).toBe(42);
  });

  it('rejects descriptions without the marker or a valid group ID', () => {
    expect(parsePrivateAppGroupId(undefined)).toBeNull();
    expect(parsePrivateAppGroupId('a normal document;groupId=4')).toBeNull();
    expect(
      parsePrivateAppGroupId(`${PRIVATE_APP_DESCRIPTION_MARKER};groupId=`)
    ).toBeNull();
    expect(
      parsePrivateAppGroupId(`${PRIVATE_APP_DESCRIPTION_MARKER};groupId=0`)
    ).toBeNull();
  });

  it('searches DOCUMENT resources for every owned name by marker', () => {
    const url = new URL(
      buildMyPrivateAppsSearchUrl('http://node:12391', ['alice', 'bob'])
    );

    expect(url.pathname).toBe('/arbitrary/resources/search');
    expect(url.searchParams.get('service')).toBe('DOCUMENT');
    expect(url.searchParams.get('description')).toBe(
      PRIVATE_APP_DESCRIPTION_MARKER
    );
    expect(url.searchParams.get('exactmatchnames')).toBe('true');
    expect(url.searchParams.get('includemetadata')).toBe('true');
    expect(url.searchParams.getAll('name')).toEqual(['alice', 'bob']);
  });

  it('keeps only marked results and prefers the updated timestamp', () => {
    const apps = toPublishedPrivateApps([
      {
        name: 'alice',
        identifier: 'my-app',
        service: 'DOCUMENT',
        created: 100,
        updated: 200,
        metadata: { description: buildPrivateAppDescription(7) },
      },
      {
        name: 'alice',
        identifier: 'notes',
        service: 'DOCUMENT',
        created: 300,
        metadata: { description: 'shopping list' },
      },
      {
        name: 'alice',
        identifier: 'no-metadata',
        service: 'DOCUMENT',
        created: 400,
      },
    ]);

    expect(apps).toEqual([
      {
        name: 'alice',
        identifier: 'my-app',
        service: 'DOCUMENT',
        groupId: 7,
        timestamp: 200,
      },
    ]);
  });

  it('returns an empty list for a non-array response', () => {
    expect(toPublishedPrivateApps(null)).toEqual([]);
    expect(toPublishedPrivateApps({} as never)).toEqual([]);
  });
});
