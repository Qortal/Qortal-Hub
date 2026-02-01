import { Box, ButtonBase, InputBase, styled, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import SearchIcon from '@mui/icons-material/Search';
import IconClearInput from '../../../assets/svgs/ClearInput.svg';
import { SortDropdown, SortOption } from './SortDropdown';
import { CategoryFilter } from './CategoryFilter';
import { StatusFilter, StatusFilterOption } from './StatusFilter';

const FilterBarContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '16px',
  width: '100%',
  flexWrap: 'wrap',
  marginBottom: '20px',
}));

const SearchContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  backgroundColor: theme.palette.background.paper,
  borderRadius: '8px',
  padding: '0 12px',
  height: '36px',
  width: '300px',
  minWidth: '200px',
}));

const FiltersRow = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
  paddingTop: '8px',
});

interface FilterBarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  sortValue: SortOption;
  onSortChange: (value: SortOption) => void;
  categoryValue: string;
  onCategoryChange: (value: string) => void;
  categories: Array<{ id: string; name: string }>;
  statusValue: StatusFilterOption;
  onStatusChange: (value: StatusFilterOption) => void;
}

export const FilterBar = ({
  searchValue,
  onSearchChange,
  sortValue,
  onSortChange,
  categoryValue,
  onCategoryChange,
  categories,
  statusValue,
  onStatusChange,
}: FilterBarProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  return (
    <FilterBarContainer>
      <SearchContainer>
        <SearchIcon sx={{ color: theme.palette.text.secondary }} />
        <InputBase
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          sx={{
            flex: 1,
            ml: 1,
            fontSize: '14px',
          }}
          placeholder={t('core:action.search_apps', {
            postProcess: 'capitalizeFirstChar',
          })}
        />
        {searchValue && (
          <ButtonBase onClick={() => onSearchChange('')}>
            <img src={IconClearInput} alt="clear" />
          </ButtonBase>
        )}
      </SearchContainer>

      <FiltersRow>
        <SortDropdown value={sortValue} onChange={onSortChange} />
        <CategoryFilter
          value={categoryValue}
          onChange={onCategoryChange}
          categories={categories}
        />
        <StatusFilter value={statusValue} onChange={onStatusChange} />
      </FiltersRow>
    </FilterBarContainer>
  );
};
