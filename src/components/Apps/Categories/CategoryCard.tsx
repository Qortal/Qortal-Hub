import { Box, ButtonBase, Typography, styled, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { getCategoryIcon } from '../config/categoryIcons';

interface Category {
  id: string;
  name: string;
}

interface CategoryCardProps {
  category: Category;
  appCount: number;
  onClick: (category: Category) => void;
}

const CardContainer = styled(Box)(({ theme }) => ({
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
  minHeight: '120px',
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
    borderColor: theme.palette.primary.main,
    transform: 'translateY(-2px)',
    boxShadow: theme.shadows[2],
  },
}));

const IconWrapper = styled(Typography)({
  fontSize: '36px',
  marginBottom: '12px',
  lineHeight: 1,
});

const CategoryName = styled(Typography)(({ theme }) => ({
  fontSize: '14px',
  fontWeight: 600,
  color: theme.palette.text.primary,
  textAlign: 'center',
  lineHeight: 1.2,
}));

const AppCount = styled(Typography)(({ theme }) => ({
  fontSize: '12px',
  color: theme.palette.text.secondary,
  marginTop: '6px',
}));

export const CategoryCard = ({
  category,
  appCount,
  onClick,
}: CategoryCardProps) => {
  const { t } = useTranslation(['core']);

  const displayName =
    category.id === 'all'
      ? t('core:all', { postProcess: 'capitalizeFirstChar' })
      : category.name;

  return (
    <ButtonBase
      onClick={() => onClick(category)}
      sx={{ borderRadius: '12px', width: '100%' }}
    >
      <CardContainer>
        <IconWrapper>{getCategoryIcon(category.id)}</IconWrapper>
        <CategoryName>{displayName}</CategoryName>
        <AppCount>
          {appCount} {t('core:app_other', { postProcess: 'capitalizeFirstChar' })}
        </AppCount>
      </CardContainer>
    </ButtonBase>
  );
};
