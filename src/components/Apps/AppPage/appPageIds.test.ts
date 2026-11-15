import { describe, expect, it } from 'vitest';
import { appPageIdentifier, appShotsIdentifier } from './appPageIds';

describe('app page identifiers', () => {
  it('names the page and screenshot resources per service', () => {
    expect(appPageIdentifier('APP')).toBe('qhub_app_page_v1_APP');
    expect(appPageIdentifier('website')).toBe('qhub_app_page_v1_WEBSITE');
    expect(appShotsIdentifier('APP')).toBe('qhub_app_shots_v1_APP');
  });
});
