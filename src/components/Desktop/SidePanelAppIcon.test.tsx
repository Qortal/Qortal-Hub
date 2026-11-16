import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/globalApi', () => ({
  getBaseApiReactForAvatar: () => 'http://node.test',
}));

import { SidePanelAppIcon } from './SidePanelAppIcon';

const pictures = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('img')).map(
    (img) => img.getAttribute('src') ?? ''
  );

describe('SidePanelAppIcon', () => {
  it("shows the app's picture", () => {
    const { container } = render(
      <SidePanelAppIcon name="Q-Mintership+" size={26} />
    );
    expect(pictures(container)).toEqual([
      expect.stringContaining(
        '/arbitrary/THUMBNAIL/Q-Mintership%2B/qortal_avatar'
      ),
    ]);
  });

  it('shows the Qortal logo, not a letter, for an app without a picture', () => {
    const { container } = render(
      <SidePanelAppIcon name="Q-Mintership+" size={26} />
    );
    fireEvent.error(container.querySelector('img')!);

    expect(pictures(container)).toEqual([
      expect.stringContaining('LogoSelected'),
    ]);
    expect(container.textContent).toBe('');
  });
});
