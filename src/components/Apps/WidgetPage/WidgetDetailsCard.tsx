import { alpha, Box, Chip, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '../../../utils/numberFunctions';
import { DetailsRow } from '../AppPage/AppDetailsCard';
import {
  formatLongDate,
  SectionCard,
  SectionTitle,
} from '../AppPage/AppPageParts';
import type { LibraryWidget } from '../AppsLibrary/widgetLibrary';

const cap = { postProcess: 'capitalizeFirstChar' } as const;

/** Where the widget lives on QDN and when it was published. */
export const WidgetDetailsCard = ({ widget }: { widget: LibraryWidget }) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core']);
  const date = (value?: number) =>
    value ? formatLongDate(value, i18n.language) : t('core:unknown', cap);
  const tags = widget.tags || [];

  return (
    <SectionCard
      aria-labelledby="widget-page-details"
      component="section"
      sx={{ mb: 2 }}
    >
      <SectionTitle id="widget-page-details">
        {t('core:app_detail.details', cap)}
      </SectionTitle>
      <DetailsRow label={t('core:app_page.details.type', cap)}>
        {t('core:widgets.type', cap)}
      </DetailsRow>
      <DetailsRow label={t('core:category', cap)}>
        {widget.categoryName || t('core:none', cap)}
      </DetailsRow>
      {tags.length > 0 && (
        <DetailsRow label={t('core:app_detail.tags', cap)}>
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
        </DetailsRow>
      )}
      <DetailsRow label={t('core:widgets.qdn_resource', cap)}>
        <Box
          component="code"
          sx={{ fontFamily: 'monospace', fontSize: '12.5px' }}
        >
          {`APP / ${widget.name}${widget.identifier ? ` / ${widget.identifier}` : ''}`}
        </Box>
      </DetailsRow>
      <DetailsRow label={t('core:app_detail.size', cap)}>
        {widget.size ? formatBytes(widget.size) : t('core:unknown', cap)}
      </DetailsRow>
      <DetailsRow label={t('core:app_detail.published', cap)}>
        {date(widget.created)}
      </DetailsRow>
      <DetailsRow label={t('core:app_detail.updated', cap)}>
        {date(widget.updated || widget.created)}
      </DetailsRow>
    </SectionCard>
  );
};
