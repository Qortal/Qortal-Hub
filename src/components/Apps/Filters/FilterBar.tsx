import { Box, styled } from '@mui/material';
import { SortDropdown, SortOption } from './SortDropdown';
import { CategoryFilter } from './CategoryFilter';
import { StatusFilter, StatusFilterOption } from './StatusFilter';

const FilterBarContainer = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '16px',
  width: '100%',
  flexWrap: 'wrap',
  marginBottom: '20px',
});

const FiltersRow = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
});

interface FilterBarProps {
  sortValue: SortOption;
  onSortChange: (value: SortOption) => void;
  categoryValue: string;
  onCategoryChange: (value: string) => void;
  categories: Array<{ id: string; name: string }>;
  statusValue: StatusFilterOption;
  onStatusChange: (value: StatusFilterOption) => void;
}

export const FilterBar = ({
  sortValue,
  onSortChange,
  categoryValue,
  onCategoryChange,
  categories,
  statusValue,
  onStatusChange,
}: FilterBarProps) => {
  return (
    <FilterBarContainer>
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
