import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CategoryIcon } from './categoryIconComponents';

// Every category Core sends (/arbitrary/categories).
const CORE_CATEGORY_IDS = [
  'ART',
  'AUTOMOTIVE',
  'BEAUTY',
  'BOOKS',
  'BUSINESS',
  'COMMUNICATIONS',
  'CRYPTOCURRENCY',
  'CULTURE',
  'DATING',
  'DESIGN',
  'ENTERTAINMENT',
  'EVENTS',
  'FAITH',
  'FASHION',
  'FINANCE',
  'FOOD',
  'GAMING',
  'GEOGRAPHY',
  'HEALTH',
  'HISTORY',
  'HOME',
  'KNOWLEDGE',
  'LANGUAGE',
  'LIFESTYLE',
  'MANUFACTURING',
  'MAPS',
  'MUSIC',
  'NEWS',
  'OTHER',
  'PETS',
  'PHILOSOPHY',
  'PHOTOGRAPHY',
  'POLITICS',
  'PRODUCE',
  'PRODUCTIVITY',
  'PSYCHOLOGY',
  'QORTAL',
  'SCIENCE',
  'SELF_CARE',
  'SELF_SUFFICIENCY',
  'SHOPPING',
  'SOCIAL',
  'SOFTWARE',
  'SPIRITUALITY',
  'SPORTS',
  'STORYTELLING',
  'TECHNOLOGY',
  'TOOLS',
  'TRAVEL',
  'UNCATEGORIZED',
  'VIDEO',
  'WEATHER',
];

const iconOf = (id?: string) => {
  const { container, unmount } = render(<CategoryIcon id={id} />);
  const svg = container.querySelector('svg');
  const testId = svg?.getAttribute('data-testid') ?? null;
  const img = container.querySelector('img');
  unmount();
  return { testId, img };
};

describe('CategoryIcon', () => {
  it('has an icon of its own for each of Core’s 52 categories', () => {
    expect(CORE_CATEGORY_IDS).toHaveLength(52);
    CORE_CATEGORY_IDS.forEach((id) => {
      const { testId, img } = iconOf(id);
      if (id === 'QORTAL') {
        expect(img).not.toBeNull();
        return;
      }
      expect(testId, id).not.toBeNull();
      expect(testId, id).not.toBe('CategoryRoundedIcon');
    });
  });

  it('shows a distributed network for cryptocurrency and blockchain', () => {
    expect(iconOf('CRYPTOCURRENCY').testId).toBe('HubRoundedIcon');
  });

  it('matches ids in any case', () => {
    expect(iconOf('gaming').testId).toBe('SportsEsportsRoundedIcon');
  });

  it('shows every category for "all", and a generic icon otherwise', () => {
    expect(iconOf('all').testId).toBe('AppsRoundedIcon');
    expect(iconOf('SOMETHING_NEW').testId).toBe('CategoryRoundedIcon');
    expect(iconOf(undefined).testId).toBe('CategoryRoundedIcon');
  });

  it('shows the Qortal logo for the Qortal category, without a name', () => {
    const { img } = iconOf('QORTAL');
    expect(img).toHaveAttribute('alt', '');
  });
});
