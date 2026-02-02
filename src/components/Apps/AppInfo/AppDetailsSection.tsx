import { Box, Chip, styled, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

interface AppDetailsSectionProps {
  app: any;
}

const DetailsContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  width: '100%',
}));

const DetailRow = styled(Box)({
  display: 'flex',
  alignItems: 'flex-start',
  gap: '12px',
});

const DetailLabel = styled(Typography)(({ theme }) => ({
  fontSize: '14px',
  fontWeight: 600,
  color: theme.palette.text.secondary,
  minWidth: '100px',
  flexShrink: 0,
}));

const DetailValue = styled(Typography)(({ theme }) => ({
  fontSize: '14px',
  color: theme.palette.text.primary,
}));

const TagsContainer = styled(Box)({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '6px',
});

const TagChip = styled(Chip)(({ theme }) => ({
  height: '24px',
  fontSize: '12px',
  backgroundColor: theme.palette.action.hover,
  '& .MuiChip-label': {
    padding: '0 8px',
  },
}));

const StatusBadge = styled(Box)<{ status: 'ready' | 'not_installed' }>(
  ({ theme, status }) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    borderRadius: '12px',
    fontSize: '13px',
    fontWeight: 500,
    backgroundColor:
      status === 'ready'
        ? theme.palette.success.main + '20'
        : theme.palette.action.hover,
    color:
      status === 'ready'
        ? theme.palette.success.main
        : theme.palette.text.secondary,
  })
);

const StatusDot = styled(Box)<{ status: 'ready' | 'not_installed' }>(
  ({ theme, status }) => ({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor:
      status === 'ready'
        ? theme.palette.success.main
        : theme.palette.text.disabled,
  })
);

export const AppDetailsSection = ({ app }: AppDetailsSectionProps) => {
  const { t } = useTranslation(['core']);

  const isInstalled = app?.status?.status === 'READY';
  const statusKey = isInstalled ? 'ready' : 'not_installed';

  // Parse tags from metadata
  const tags: string[] = app?.metadata?.tags
    ? typeof app.metadata.tags === 'string'
      ? app.metadata.tags.split(',').map((tag: string) => tag.trim())
      : app.metadata.tags
    : [];

  // Format published date
  const formatDate = (timestamp: number | undefined) => {
    if (!timestamp) return t('core:unknown', { postProcess: 'capitalizeFirstChar' });
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <DetailsContainer>
      <DetailRow>
        <DetailLabel>
          {t('core:category', { postProcess: 'capitalizeFirstChar' })}
        </DetailLabel>
        <DetailValue>
          {app?.metadata?.categoryName ||
            t('core:none', { postProcess: 'capitalizeFirstChar' })}
        </DetailValue>
      </DetailRow>

      <DetailRow>
        <DetailLabel>
          {t('core:app_detail.service', { postProcess: 'capitalizeFirstChar' })}
        </DetailLabel>
        <DetailValue>{app?.service || 'APP'}</DetailValue>
      </DetailRow>

      {tags.length > 0 && (
        <DetailRow>
          <DetailLabel>
            {t('core:app_detail.tags', { postProcess: 'capitalizeFirstChar' })}
          </DetailLabel>
          <TagsContainer>
            {tags.map((tag, index) => (
              <TagChip key={index} label={tag} size="small" />
            ))}
          </TagsContainer>
        </DetailRow>
      )}

      <DetailRow>
        <DetailLabel>
          {t('core:status', { postProcess: 'capitalizeFirstChar' })}
        </DetailLabel>
        <StatusBadge status={statusKey}>
          <StatusDot status={statusKey} />
          {isInstalled
            ? t('core:app_detail.status_ready', {
                postProcess: 'capitalizeFirstChar',
              })
            : t('core:app_detail.status_not_installed', {
                postProcess: 'capitalizeFirstChar',
              })}
        </StatusBadge>
      </DetailRow>

      <DetailRow>
        <DetailLabel>
          {t('core:app_detail.published', {
            postProcess: 'capitalizeFirstChar',
          })}
        </DetailLabel>
        <DetailValue>{formatDate(app?.created)}</DetailValue>
      </DetailRow>
    </DetailsContainer>
  );
};
