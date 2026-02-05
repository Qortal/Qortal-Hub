import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  styled,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

export type PageSize = 12 | 24 | 48;

interface PageSizeSelectorProps {
  value: PageSize;
  onChange: (value: PageSize) => void;
}

const StyledFormControl = styled(FormControl)(({ theme }) => ({
  minWidth: '120px',
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

const PAGE_SIZES: PageSize[] = [12, 24, 48];

export const PageSizeSelector = ({
  value,
  onChange,
}: PageSizeSelectorProps) => {
  const { t } = useTranslation(['core']);

  const handleChange = (event: SelectChangeEvent<number>) => {
    onChange(event.target.value as PageSize);
  };

  return (
    <StyledFormControl size="small">
      <InputLabel id="page-size-select-label">
        {t('core:pagination.per_page', {
          postProcess: 'capitalizeFirstChar',
        })}
      </InputLabel>
      <Select
        labelId="page-size-select-label"
        id="page-size-select"
        value={value}
        label={t('core:pagination.per_page', {
          postProcess: 'capitalizeFirstChar',
        })}
        onChange={handleChange}
      >
        {PAGE_SIZES.map((size) => (
          <MenuItem key={size} value={size}>
            {size}
          </MenuItem>
        ))}
      </Select>
    </StyledFormControl>
  );
};
