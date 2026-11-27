import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildAppPageLink } from '../Apps/AppPage/appPageLink';
import { MessageDisplay } from './MessageDisplay';

describe('a page link in a chat message', () => {
  let pagesShown: unknown[] = [];
  const onPage = (event: Event) => {
    pagesShown.push((event as CustomEvent).detail?.data);
  };

  beforeEach(() => {
    pagesShown = [];
    document.addEventListener('selectedAppInfo', onPage);
  });

  afterEach(() => {
    document.removeEventListener('selectedAppInfo', onPage);
  });

  it.each(['Publisher!', 'Publisher v2.', 'Publisher (QORT)'])(
    'opens the page of %s, with the sentence around it',
    async (name) => {
      // As copied from the page's Share menu, then written into a sentence.
      const link = buildAppPageLink('APP', name);
      const { container } = render(
        <MessageDisplay htmlContent={`<p>Have a look: ${link}!</p>`} />
      );
      const shown = container.querySelector<HTMLElement>('[data-url]');
      expect(shown?.getAttribute('data-url')).toBe(`${link}!`);

      fireEvent.click(shown!);
      // The page is asked for once the apps view shows (a 0 ms timer).
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(pagesShown).toEqual([{ name, service: 'APP' }]);
    }
  );
});
