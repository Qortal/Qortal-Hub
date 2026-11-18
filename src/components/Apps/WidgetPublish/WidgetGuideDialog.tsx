import { useId } from 'react';
import {
  Box,
  Button,
  Dialog,
  IconButton,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import WidgetsRoundedIcon from '@mui/icons-material/WidgetsRounded';
import { useTranslation } from 'react-i18next';
import { GuideCode, GuideText, useCopy } from './WidgetGuideParts';
import {
  WIDGET_GUIDE_LEAD_KEY,
  WIDGET_GUIDE_SECTIONS,
  WIDGET_GUIDE_TITLE_KEY,
  widgetGuideMarkdown,
} from './widgetGuide';
import { useLauncherTabDialog } from '../launcherTabs';

/**
 * The whole widget guide on a page of its own, over the publish form. It can
 * be copied as Markdown, for notes or for an AI assistant building a widget.
 */
export const WidgetGuideDialog = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const titleId = useId();
  const sectionIdBase = useId();
  const { state, copy } = useCopy();
  const capital = { postProcess: 'capitalizeFirstChar' };
  const accent =
    theme.palette.mode === 'dark'
      ? theme.palette.primary.light
      : theme.palette.primary.dark;
  const sectionId = (id: string) => `${sectionIdBase}-${id}`;
  const copyLabel =
    state === 'copied'
      ? t('core:action.copied', capital)
      : state === 'failed'
        ? t('core:widget_guide.copy_failed', capital)
        : t('core:widget_guide.copy_markdown', capital);

  // In a launcher tab that is hidden, the page waits for it to show.
  const shown = useLauncherTabDialog(open);

  return (
    <Dialog
      aria-labelledby={titleId}
      fullScreen
      onClose={onClose}
      {...shown}
      PaperProps={{ sx: { backgroundColor: theme.palette.background.default } }}
    >
      <Box
        component="header"
        sx={{
          alignItems: 'center',
          backgroundColor: alpha(theme.palette.background.default, 0.92),
          backdropFilter: 'blur(8px)',
          borderBottom: `1px solid ${theme.palette.divider}`,
          display: 'flex',
          flexShrink: 0,
          gap: 1.5,
          px: { xs: 2, sm: 3 },
          py: 1.5,
        }}
      >
        <Box
          aria-hidden
          sx={{
            alignItems: 'center',
            backgroundColor: alpha(theme.palette.primary.main, 0.14),
            borderRadius: '10px',
            color: accent,
            display: 'flex',
            flexShrink: 0,
            height: 36,
            justifyContent: 'center',
            width: 36,
          }}
        >
          <WidgetsRoundedIcon fontSize="small" />
        </Box>
        <Typography
          component="h1"
          id={titleId}
          noWrap
          sx={{ flex: 1, fontSize: '18px', fontWeight: 700, minWidth: 0 }}
        >
          {t(WIDGET_GUIDE_TITLE_KEY, capital)}
        </Typography>
        <Tooltip
          describeChild
          title={t('core:widget_guide.copy_hint', capital)}
        >
          <Button
            onClick={() => copy(widgetGuideMarkdown(t))}
            startIcon={
              state === 'copied' ? (
                <CheckRoundedIcon />
              ) : (
                <ContentCopyRoundedIcon />
              )
            }
            sx={{ borderRadius: '10px', flexShrink: 0, textTransform: 'none' }}
            variant="outlined"
          >
            {copyLabel}
          </Button>
        </Tooltip>
        <Tooltip title={t('core:action.close', capital)}>
          <IconButton
            aria-label={t('core:action.close', capital)}
            onClick={onClose}
          >
            <CloseRoundedIcon />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        <Box
          component="article"
          sx={{
            maxWidth: 840,
            mx: 'auto',
            pb: 8,
            pt: { xs: 3, sm: 4 },
            px: { xs: 2, sm: 3 },
          }}
        >
          <Typography
            sx={{
              color: 'text.secondary',
              fontSize: '16px',
              lineHeight: 1.6,
              mb: 2.5,
            }}
          >
            {t(WIDGET_GUIDE_LEAD_KEY, capital)}
          </Typography>

          <Box
            aria-label={t('core:widget_guide.contents', capital)}
            component="nav"
            sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 4 }}
          >
            {WIDGET_GUIDE_SECTIONS.map((section, index) => (
              <Button
                key={section.id}
                onClick={() =>
                  document
                    .getElementById(sectionId(section.id))
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
                size="small"
                sx={{
                  borderColor: theme.palette.divider,
                  borderRadius: '999px',
                  color: 'text.primary',
                  textTransform: 'none',
                }}
                variant="outlined"
              >
                <Box
                  component="span"
                  sx={{ color: accent, fontWeight: 700, mr: 0.75 }}
                >
                  {index + 1}
                </Box>
                {t(section.titleKey, capital)}
              </Button>
            ))}
          </Box>

          {WIDGET_GUIDE_SECTIONS.map((section, index) => (
            <Box
              aria-labelledby={`${sectionId(section.id)}-title`}
              component="section"
              id={sectionId(section.id)}
              key={section.id}
              sx={{ mb: 4.5, scrollMarginTop: '16px' }}
            >
              <Typography
                component="h2"
                id={`${sectionId(section.id)}-title`}
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  fontSize: '20px',
                  fontWeight: 700,
                  gap: 1.25,
                  mb: 1.5,
                }}
              >
                <Box
                  aria-hidden
                  component="span"
                  sx={{
                    alignItems: 'center',
                    backgroundColor: alpha(theme.palette.primary.main, 0.14),
                    borderRadius: '8px',
                    color: accent,
                    display: 'inline-flex',
                    fontSize: '13px',
                    height: 26,
                    justifyContent: 'center',
                    width: 26,
                  }}
                >
                  {index + 1}
                </Box>
                {t(section.titleKey, capital)}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
                {section.blocks.map((block, blockIndex) =>
                  block.kind === 'code' ? (
                    <GuideCode code={block.code} key={blockIndex} />
                  ) : block.kind === 'text' ? (
                    <Typography
                      key={blockIndex}
                      sx={{ fontSize: '14.5px', lineHeight: 1.65 }}
                    >
                      <GuideText text={t(block.key, capital)} />
                    </Typography>
                  ) : (
                    <Box
                      component="ul"
                      key={blockIndex}
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1,
                        m: 0,
                        pl: 2.5,
                        '& li::marker': { color: accent },
                      }}
                    >
                      {block.keys.map((key) => (
                        <Typography
                          component="li"
                          key={key}
                          sx={{ fontSize: '14.5px', lineHeight: 1.65 }}
                        >
                          <GuideText text={t(key, capital)} />
                        </Typography>
                      ))}
                    </Box>
                  )
                )}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Dialog>
  );
};
