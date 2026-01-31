import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  styled,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

export type SortOption = 'newest' | 'oldest' | 'alphabetical';

interface SortDropdownProps {
  value: SortOption;
  onChange: (value: SortOption) => void;
}

const StyledFormControl = styled(FormControl)(({ theme }) => ({
  minWidth: '160px',
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

export const SortDropdown = ({ value, onChange }: SortDropdownProps) => {
  const { t } = useTranslation(['core']);

  const handleChange = (event: SelectChangeEvent) => {
    onChange(event.target.value as SortOption);
  };

  return (
    <StyledFormControl size="small">
      <InputLabel id="sort-select-label">
        {t('core:filter.sort_by', {
          postProcess: 'capitalizeFirstChar',
        })}
      </InputLabel>
      <Select
        labelId="sort-select-label"
        id="sort-select"
        value={value}
        label={t('core:filter.sort_by', {
          postProcess: 'capitalizeFirstChar',
        })}
        onChange={handleChange}
      >
        <MenuItem value="newest">
          {t('core:sort.newest', { postProcess: 'capitalizeFirstChar' })}
        </MenuItem>
        <MenuItem value="oldest">
          {t('core:sort.oldest', {
            postProcess: 'capitalizeFirstChar',
            defaultValue: 'Oldest',
          })}
        </MenuItem>
        <MenuItem value="alphabetical">
          {t('core:sort.alphabetical', {
            postProcess: 'capitalizeFirstChar',
          })}
        </MenuItem>
      </Select>
    </StyledFormControl>
  );
};
