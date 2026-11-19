import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const links = vi.hoisted(() => ({ openQortalDeepLink: vi.fn() }));
vi.mock('../../../qortinoAgent/qdnAppLinks', () => links);

import { QortinoRichText } from './QortinoRichText';

describe("Qortino's answer text", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    links.openQortalDeepLink.mockClear();
  });

  it('shows names with underscores as they are written', () => {
    const { container } = render(
      <QortinoRichText text="Use OPEN_NEW_TAB or SEARCH_QDN_RESOURCES, then read qortal_avatar and my_app_config." />
    );
    expect(container.textContent).toBe(
      'Use OPEN_NEW_TAB or SEARCH_QDN_RESOURCES, then read qortal_avatar and my_app_config.'
    );
    expect(container.querySelector('em')).toBeNull();
  });

  it('still sets a word between underscores or asterisks in italics', () => {
    const { container } = render(
      <QortinoRichText text="This is _really_ and *truly* so." />
    );
    expect(
      [...container.querySelectorAll('em')].map((em) => em.textContent)
    ).toEqual(['really', 'truly']);
    expect(container.textContent).toBe('This is really and truly so.');
  });

  it('keeps the asterisks of a sum', () => {
    const { container } = render(
      <QortinoRichText text="So 2 * 3 * 4 = 24, and 5 * 2 = 10." />
    );
    expect(container.textContent).toBe('So 2 * 3 * 4 = 24, and 5 * 2 = 10.');
    expect(container.querySelector('em')).toBeNull();
  });

  it('makes a link only of what it can open', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(
      <QortinoRichText text="See [the guide](qortal://APP/Q-Tube), [the site](https://qortal.dev/docs), [settings](settings/models) and [a file](file:///etc/hosts)." />
    );
    fireEvent.click(screen.getByRole('link', { name: 'the guide' }));
    expect(links.openQortalDeepLink).toHaveBeenCalledWith(
      'qortal://APP/Q-Tube'
    );
    fireEvent.click(screen.getByRole('link', { name: 'the site' }));
    expect(open).toHaveBeenCalledWith(
      'https://qortal.dev/docs',
      '_blank',
      'noopener,noreferrer'
    );
    // Nothing a click could open: plain words, with no address to follow.
    expect(screen.queryByRole('link', { name: 'settings' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'a file' })).toBeNull();
    expect(screen.getByText(/settings/)).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
});
