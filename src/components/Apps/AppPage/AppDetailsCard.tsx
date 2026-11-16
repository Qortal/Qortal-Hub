import { alpha, Box, Chip, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../../../utils/numberFunctions';
import { formatLongDate, SectionCard, SectionTitle } from './AppPageParts';

const Row = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <Box
    sx={{
      alignItems: 'baseline',
      display: 'grid',
      gap: 1.5,
      gridTemplateColumns: 'minmax(84px, 38%) 1fr',
      py: 0.75,
    }}
  >
    <Typography sx={{ color: 'text.secondary', fontSize: '13.5px' }}>
      {label}
    </Typography>
    <Box sx={{ fontSize: '13.5px', minWidth: 0, overflowWrap: 'anywhere' }}>
      {children}
    </Box>
  </Box>
);

/** A label and its value, as the details card lays them out. */
export { Row as DetailsRow };

export const appTags = (app: any): string[] => {
  const tags = app?.metadata?.tags;
  if (!tags) return [];
  const list = typeof tags === 'string' ? tags.split(',') : tags;
  return Array.isArray(list)
    ? list.map((tag) => String(tag).trim()).filter(Boolean)
    : [];
};

export const AppDetailsCard = ({
  app,
  version,
}: {
  app: any;
  version: string;
}) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core']);
  const tags = appTags(app);
  const isInstalled = app?.status?.status === 'READY';
  const date = (value?: number) =>
    value
      ? formatLongDate(value, i18n.language)
      : t('core:unknown', { postProcess: 'capitalizeFirstChar' });

  return (
    <SectionCard
      aria-labelledby="app-page-details"
      component="section"
      sx={{ mb: 2 }}
    >
      <SectionTitle id="app-page-details">
        {t('core:app_detail.details', { postProcess: 'capitalizeFirstChar' })}
      </SectionTitle>
      <Row label={t('core:category', { postProcess: 'capitalizeFirstChar' })}>
        {app?.metadata?.categoryName ||
          t('core:none', { postProcess: 'capitalizeFirstChar' })}
      </Row>
      {tags.length > 0 && (
        <Row
          label={t('core:app_detail.tags', {
            postProcess: 'capitalizeFirstChar',
          })}
        >
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {tags.map((tag) => (
              <Chip
                key={tag}
                label={tag}
                size="small"
                sx={{
                  backgroundColor: alpha(theme.palette.text.primary, 0.07),
                  height: 22,
                }}
              />
            ))}
          </Box>
        </Row>
      )}
      <Row
        label={t('core:app_page.details.type', {
          postProcess: 'capitalizeFirstChar',
        })}
      >
        {app?.service === 'WEBSITE'
          ? t('core:app_page.hero.type_website', {
              postProcess: 'capitalizeFirstChar',
            })
          : t('core:app_page.hero.type_app')}
      </Row>
      {version && (
        <Row
          label={t('core:app_page.details.version', {
            postProcess: 'capitalizeFirstChar',
          })}
        >
          {version}
        </Row>
      )}
      <Row
        label={t('core:app_detail.size', {
          postProcess: 'capitalizeFirstChar',
        })}
      >
        {app?.size
          ? formatBytes(app.size)
          : t('core:unknown', { postProcess: 'capitalizeFirstChar' })}
      </Row>
      <Row
        label={t('core:app_detail.status', {
          postProcess: 'capitalizeFirstChar',
        })}
      >
        <Box
          component="span"
          sx={{
            alignItems: 'center',
            color: isInstalled ? theme.palette.success.main : 'text.secondary',
            display: 'inline-flex',
            gap: 0.75,
          }}
        >
          <Box
            component="span"
            sx={{
              backgroundColor: isInstalled
                ? theme.palette.success.main
                : theme.palette.text.disabled,
              borderRadius: '50%',
              height: 8,
              width: 8,
            }}
          />
          {isInstalled
            ? t('core:app_detail.status_ready', {
                postProcess: 'capitalizeFirstChar',
              })
            : t('core:app_detail.status_not_installed', {
                postProcess: 'capitalizeFirstChar',
              })}
        </Box>
      </Row>
      <Row
        label={t('core:app_detail.published', {
          postProcess: 'capitalizeFirstChar',
        })}
      >
        {date(app?.created)}
      </Row>
      <Row
        label={t('core:app_detail.updated', {
          postProcess: 'capitalizeFirstChar',
        })}
      >
        {date(app?.updated || app?.created)}
      </Row>
    </SectionCard>
  );
};
