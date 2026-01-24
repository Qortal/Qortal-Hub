import { useMemo } from 'react';
import { Box, ButtonBase, Typography, styled, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { AppLibrarySubTitle, AppsWidthLimiter } from '../Apps-styles';
import { Spacer } from '../../../common/Spacer';
import { executeEvent } from '../../../utils/events';

interface Category {
  id: string;
  name: string;
}

interface CategoriesTabProps {
  categories: Category[];
  availableQapps: any[];
}

const CategoryCard = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px 16px',
  borderRadius: '12px',
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${theme.palette.divider}`,
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  minWidth: '140px',
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
    borderColor: theme.palette.primary.main,
    transform: 'translateY(-2px)',
  },
}));

const CategoryIcon = styled(Typography)({
  fontSize: '32px',
  marginBottom: '8px',
});

const CategoryName = styled(Typography)(({ theme }) => ({
  fontSize: '14px',
  fontWeight: 600,
  color: theme.palette.text.primary,
  textAlign: 'center',
}));

const CategoryCount = styled(Typography)(({ theme }) => ({
  fontSize: '12px',
  color: theme.palette.text.secondary,
  marginTop: '4px',
}));

const CategoriesGrid = styled(Box)({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
  gap: '16px',
  width: '100%',
});

// Category icon mapping
const categoryIcons: Record<string, string> = {
  games: '🎮',
  finance: '💰',
  shopping: '🛒',
  social: '📱',
  tools: '🔧',
  education: '📚',
  entertainment: '🎬',
  productivity: '📊',
  communication: '💬',
  lifestyle: '🌟',
  music: '🎵',
  news: '📰',
  photography: '📷',
  sports: '⚽',
  travel: '✈️',
  utilities: '⚙️',
  weather: '🌤️',
  other: '📦',
  all: '🌐',
};

const getCategoryIcon = (categoryId: string): string => {
  const lowerCaseId = categoryId.toLowerCase();
  return categoryIcons[lowerCaseId] || categoryIcons.other;
};

export const CategoriesTab = ({
  categories,
  availableQapps,
}: CategoriesTabProps) => {
  const theme = useTheme();
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
      <AppLibrarySubTitle
        sx={{
          fontSize: '30px',
        }}
      >
        {t('core:category_other', {
          postProcess: 'capitalizeFirstChar',
        })}
      </AppLibrarySubTitle>

      <Spacer height="30px" />

      <CategoriesGrid>
        {/* All category */}
        <ButtonBase
          onClick={() => handleCategoryClick({ id: 'all', name: 'All' })}
          sx={{ borderRadius: '12px' }}
        >
          <CategoryCard>
            <CategoryIcon>{getCategoryIcon('all')}</CategoryIcon>
            <CategoryName>
              {t('core:all', { postProcess: 'capitalizeFirstChar' })}
            </CategoryName>
            <CategoryCount>
              {categoryAppCounts.all || 0}{' '}
              {t('core:app_other', { postProcess: 'capitalizeFirstChar' })}
            </CategoryCount>
          </CategoryCard>
        </ButtonBase>

        {/* Dynamic categories */}
        {categories?.map((category) => (
          <ButtonBase
            key={category.id}
            onClick={() => handleCategoryClick(category)}
            sx={{ borderRadius: '12px' }}
          >
            <CategoryCard>
              <CategoryIcon>{getCategoryIcon(category.id)}</CategoryIcon>
              <CategoryName>{category.name}</CategoryName>
              <CategoryCount>
                {categoryAppCounts[category.id] || 0}{' '}
                {t('core:app_other', { postProcess: 'capitalizeFirstChar' })}
              </CategoryCount>
            </CategoryCard>
          </ButtonBase>
        ))}
      </CategoriesGrid>
    </AppsWidthLimiter>
  );
};
