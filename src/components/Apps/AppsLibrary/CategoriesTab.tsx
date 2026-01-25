import { useMemo } from 'react';
import { Box, styled } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { AppLibrarySubTitle, AppsWidthLimiter } from '../Apps-styles';
import { Spacer } from '../../../common/Spacer';
import { executeEvent } from '../../../utils/events';
import { CategoryCard } from '../Categories';

interface Category {
  id: string;
  name: string;
}

interface CategoriesTabProps {
  categories: Category[];
  availableQapps: any[];
}

const CategoriesGrid = styled(Box)({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
  gap: '16px',
  width: '100%',
});

export const CategoriesTab = ({
  categories,
  availableQapps,
}: CategoriesTabProps) => {
  const { t } = useTranslation(['core']);

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

  const handleCategoryClick = (category: Category) => {
    executeEvent('selectedCategory', {
      data: category,
    });
  };

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
