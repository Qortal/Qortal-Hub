import { Box, ButtonBase, styled, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { PageSizeSelector, PageSize } from './PageSizeSelector';

const PaginationContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  padding: '16px 0',
  flexWrap: 'wrap',
  gap: '16px',
}));

const PaginationControls = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
}));

const PageButton = styled(ButtonBase, {
  shouldForwardProp: (prop) => prop !== 'isActive',
})<{ isActive?: boolean }>(({ theme, isActive }) => ({
  width: '32px',
  height: '32px',
  borderRadius: '4px',
  fontSize: '14px',
  fontWeight: isActive ? 600 : 400,
  backgroundColor: isActive
    ? theme.palette.primary.main
    : theme.palette.background.paper,
  color: isActive
    ? theme.palette.primary.contrastText
    : theme.palette.text.primary,
  '&:hover': {
    backgroundColor: isActive
      ? theme.palette.primary.dark
      : theme.palette.action.hover,
  },
  '&:disabled': {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
}));

const NavButton = styled(ButtonBase)(({ theme }) => ({
  width: '32px',
  height: '32px',
  borderRadius: '4px',
  backgroundColor: theme.palette.background.paper,
  color: theme.palette.text.primary,
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
  },
  '&:disabled': {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
}));

const PageInfo = styled(Typography)(({ theme }) => ({
  fontSize: '14px',
  color: theme.palette.text.secondary,
}));

interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: PageSize;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSize) => void;
}

export const Pagination = ({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) => {
  const { t } = useTranslation(['core']);

  const totalPages = Math.ceil(totalItems / pageSize);
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  const handlePrevious = () => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNext = () => {
    if (currentPage < totalPages) {
      onPageChange(currentPage + 1);
    }
  };

  // Generate page numbers to display
  const getPageNumbers = (): (number | 'ellipsis')[] => {
    const pages: (number | 'ellipsis')[] = [];
    const maxVisiblePages = 5;

    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      if (currentPage > 3) {
        pages.push('ellipsis');
      }

      // Show pages around current page
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (currentPage < totalPages - 2) {
        pages.push('ellipsis');
      }

      // Always show last page
      if (totalPages > 1) {
        pages.push(totalPages);
      }
    }

    return pages;
  };

  return (
    <PaginationContainer>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <PageSizeSelector value={pageSize} onChange={onPageSizeChange} />
        <PageInfo>
          {t('core:pagination.showing_range', {
            start: startItem,
            end: endItem,
            total: totalItems,
            postProcess: 'capitalizeFirstChar',
            defaultValue: 'Showing {{start}}-{{end}} of {{total}}',
          })}
        </PageInfo>
      </Box>

      {totalPages > 1 && (
        <PaginationControls>
          <NavButton onClick={handlePrevious} disabled={currentPage === 1}>
            <ChevronLeftIcon fontSize="small" />
          </NavButton>

          {getPageNumbers().map((page, index) =>
            page === 'ellipsis' ? (
              <Typography
                key={`ellipsis-${index}`}
                sx={{ px: 1, color: 'text.secondary' }}
              >
                ...
              </Typography>
            ) : (
              <PageButton
                key={page}
                isActive={page === currentPage}
                onClick={() => onPageChange(page)}
              >
                {page}
              </PageButton>
            )
          )}

          <NavButton onClick={handleNext} disabled={currentPage === totalPages}>
            <ChevronRightIcon fontSize="small" />
          </NavButton>
        </PaginationControls>
      )}
    </PaginationContainer>
  );
};
