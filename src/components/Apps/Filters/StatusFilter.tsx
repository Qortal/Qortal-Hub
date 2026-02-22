import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  styled,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

export type StatusFilterOption = 'all' | 'installed' | 'not_installed';

interface StatusFilterProps {
  value: StatusFilterOption;
  onChange: (value: StatusFilterOption) => void;
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

export const StatusFilter = ({ value, onChange }: StatusFilterProps) => {
  const { t } = useTranslation(['core']);

  const handleChange = (event: SelectChangeEvent) => {
    onChange(event.target.value as StatusFilterOption);
  };

  return (
    <StyledFormControl size="small">
      <InputLabel id="status-filter-label">
        {t('core:filter.status', {
          postProcess: 'capitalizeFirstChar',
        })}
      </InputLabel>
      <Select
        labelId="status-filter-label"
        id="status-filter"
        value={value}
        label={t('core:filter.status', {
          postProcess: 'capitalizeFirstChar',
        })}
        onChange={handleChange}
      >
        <MenuItem value="all">
          {t('core:filter.all', { postProcess: 'capitalizeFirstChar' })}
        </MenuItem>
        <MenuItem value="installed">
          {t('core:filter.installed', { postProcess: 'capitalizeFirstChar' })}
        </MenuItem>
        <MenuItem value="not_installed">
          {t('core:filter.not_installed', {
            postProcess: 'capitalizeFirstChar',
          })}
        </MenuItem>
      </Select>
    </StyledFormControl>
  );
};
