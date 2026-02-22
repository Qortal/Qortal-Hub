import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  styled,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

interface CategoryFilterProps {
  value: string;
  onChange: (value: string) => void;
  categories: Array<{ id: string; name: string }>;
}

const StyledFormControl = styled(FormControl)(({ theme }) => ({
  minWidth: '140px',
  '& .MuiInputBase-root': {
    height: '36px',
    fontSize: '14px',
  },
  '& .MuiInputLabel-root': {
    fontSize: '14px',
    transform: 'translate(14px, 8px) scale(1)',
    '&.Mui-focused, &.MuiFormLabel-filled': {
      transform: 'translate(14px, -9px) scale(0.75)',
    },
  },
}));

export const CategoryFilter = ({
  value,
  onChange,
  categories,
}: CategoryFilterProps) => {
  const { t } = useTranslation(['core']);

  const handleChange = (event: SelectChangeEvent) => {
    onChange(event.target.value);
  };

  return (
    <StyledFormControl size="small">
      <InputLabel id="category-filter-label">
        {t('core:category', {
          postProcess: 'capitalizeFirstChar',
        })}
      </InputLabel>
      <Select
        labelId="category-filter-label"
        id="category-filter"
        value={value}
        label={t('core:category', {
          postProcess: 'capitalizeFirstChar',
        })}
        onChange={handleChange}
      >
        <MenuItem value="all">
          {t('core:filter.all', { postProcess: 'capitalizeFirstChar' })}
        </MenuItem>
        {categories.map((category) => (
          <MenuItem key={category.id} value={category.id}>
            {category.name}
          </MenuItem>
        ))}
      </Select>
    </StyledFormControl>
  );
};
