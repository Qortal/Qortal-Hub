import { useMemo } from 'react';
import { Box, styled } from '@mui/material';
import { AppsWidthLimiter } from '../Apps-styles';
import { executeEvent } from '../../../utils/events';
import { CategoryCard } from '../Categories';
import { AppCardEnhanced } from '../AppCard';
import { officialAppList } from '../config/officialApps';

interface Category {
  id: string;
  name: string;
}

interface CategoriesTabProps {
  categories: Category[];
  availableQapps: any[];
  myName?: string;
  searchValue?: string;
}

const CategoriesGrid = styled(Box)({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
  gap: '16px',
  width: '100%',
});

const AppsGrid = styled(Box)({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: '16px',
  width: '100%',
});

export const CategoriesTab = ({
  categories,
  availableQapps,
  myName = '',
  searchValue = '',
}: CategoriesTabProps) => {
  // Count apps per category
  const categoryAppCounts = useMemo(() => {
    const counts: Record<string, number> = { all: availableQapps.length };
    availableQapps.forEach((app) => {
      const categoryId = app?.metadata?.category;
      if (categoryId) {
        counts[categoryId] = (counts[categoryId] || 0) + 1;
      }
    });
    return counts;
  }, [availableQapps]);

  // Filtered community apps used when search is active
  const filteredCommunityApps = useMemo(() => {
    if (!searchValue) return [];
    const searchLower = searchValue.toLowerCase();
    return availableQapps.filter(
      (app) =>
        !officialAppList.includes(app?.name?.toLowerCase()) &&
        (app.name.toLowerCase().includes(searchLower) ||
          (app?.metadata?.title &&
            app.metadata.title.toLowerCase().includes(searchLower)) ||
          (app?.metadata?.description &&
            app.metadata.description.toLowerCase().includes(searchLower)))
    );
  }, [availableQapps, searchValue]);

  const handleCategoryClick = (category: Category) => {
    executeEvent('selectedCategory', {
      data: category,
    });
  };

  if (searchValue) {
    return (
      <AppsWidthLimiter>
        <AppsGrid>
          {filteredCommunityApps.map((app) => (
            <AppCardEnhanced
              key={`${app?.service}-${app?.name}`}
              app={app}
              myName={myName}
            />
          ))}
        </AppsGrid>
      </AppsWidthLimiter>
    );
  }

  return (
    <AppsWidthLimiter>
      <CategoriesGrid>
        {/* All category */}
        <CategoryCard
          category={{ id: 'all', name: 'All' }}
          appCount={categoryAppCounts.all || 0}
          onClick={handleCategoryClick}
        />

        {/* Dynamic categories */}
        {categories?.map((category) => (
          <CategoryCard
            key={category.id}
            category={category}
            appCount={categoryAppCounts[category.id] || 0}
            onClick={handleCategoryClick}
          />
        ))}
      </CategoriesGrid>
    </AppsWidthLimiter>
  );
};
