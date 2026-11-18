import { useEffect, useState } from 'react';
import {
  alpha,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Typography,
  useTheme,
} from '@mui/material';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import { useTranslation } from 'react-i18next';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';
import { getBaseApiReact } from '../../App';
import { appIconUrl } from './AppPage/appPageQdn';

/** A numbered part of the publish form. */
export const FormSection = ({
  number,
  title,
  hint,
  action,
  children,
}: {
  /** Left out for a form with one part. */
  number?: number;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) => {
  const theme = useTheme();
  return (
    <Paper
      component="section"
      elevation={0}
      sx={{
        backgroundColor: alpha(theme.palette.background.paper, 0.72),
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: '18px',
        mb: 2,
        p: { xs: 2, sm: 2.5 },
      }}
    >
      <Box sx={{ alignItems: 'flex-start', display: 'flex', gap: 1.5, mb: 2 }}>
        {number !== undefined && (
          <Box
            aria-hidden
            sx={{
              alignItems: 'center',
              backgroundColor: alpha(theme.palette.primary.main, 0.18),
              borderRadius: '50%',
              color:
                theme.palette.mode === 'dark'
                  ? theme.palette.primary.light
                  : theme.palette.primary.dark,
              display: 'flex',
              flexShrink: 0,
              fontSize: '13px',
              fontWeight: 700,
              height: 28,
              justifyContent: 'center',
              width: 28,
            }}
          >
            {number}
          </Box>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            component="h2"
            sx={{ fontSize: '17px', fontWeight: 650, lineHeight: '28px' }}
          >
            {title}
          </Typography>
          {hint && (
            <Typography sx={{ color: 'text.secondary', fontSize: '13px' }}>
              {hint}
            </Typography>
          )}
        </Box>
        {action}
      </Box>
      {children}
    </Paper>
  );
};

/** How the app will look in the library, as the form is filled in. */
export const PublishPreviewCard = ({
  name,
  isWebsite,
  isWidget = false,
  title,
  description,
  categoryName,
  tags,
  shotUrls,
  version,
}: {
  name: string;
  isWebsite: boolean;
  /** A widget: shown as the widget list shows it. */
  isWidget?: boolean;
  title: string;
  description: string;
  categoryName: string;
  tags: string[];
  shotUrls: string[];
  version: string;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [iconFailed, setIconFailed] = useState(false);
  useEffect(() => setIconFailed(false), [name]);

  return (
    <Paper
      elevation={0}
      sx={{
        background: `linear-gradient(160deg, ${alpha(theme.palette.primary.main, 0.16)}, ${alpha(theme.palette.background.paper, 0.85)} 55%)`,
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: '18px',
        mb: 2,
        overflow: 'hidden',
        p: 2.25,
      }}
    >
      <Typography
        sx={{
          color: 'text.secondary',
          fontSize: '12px',
          fontWeight: 700,
          letterSpacing: '0.06em',
          mb: 1.5,
          textTransform: 'uppercase',
        }}
      >
        {isWidget
          ? t('core:publish_widget.preview_title')
          : t('core:publish_form.preview_title')}
      </Typography>
      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.5 }}>
        <Box
          sx={{
            alignItems: 'center',
            backgroundColor: theme.palette.background.paper,
            border: `1px solid ${alpha(theme.palette.text.primary, 0.1)}`,
            borderRadius: '16px',
            display: 'flex',
            flexShrink: 0,
            height: 60,
            justifyContent: 'center',
            overflow: 'hidden',
            width: 60,
          }}
        >
          {name && !iconFailed ? (
            <img
              alt=""
              onError={() => setIconFailed(true)}
              src={appIconUrl(getBaseApiReact(), name)}
              style={{ height: '100%', objectFit: 'cover', width: '100%' }}
            />
          ) : (
            <img alt="" src={LogoSelected} style={{ width: '55%' }} />
          )}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            noWrap
            sx={{
              color: title ? 'text.primary' : 'text.secondary',
              fontSize: '17px',
              fontWeight: 700,
            }}
          >
            {title ||
              t('core:publish_form.preview_empty_title', {
                postProcess: 'capitalizeFirstChar',
              })}
          </Typography>
          {name && (
            <Typography
              noWrap
              sx={{
                color:
                  theme.palette.mode === 'dark'
                    ? theme.palette.primary.light
                    : theme.palette.primary.dark,
                fontSize: '13px',
              }}
            >
              {t('core:app_detail.by_developer', {
                developer: name,
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          )}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
            <Chip
              label={
                isWidget
                  ? t('core:publish_widget.type_widget', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : isWebsite
                    ? t('core:app_page.hero.type_website', {
                        postProcess: 'capitalizeFirstChar',
                      })
                    : t('core:app_page.hero.type_app')
              }
              size="small"
              sx={{ height: 20 }}
            />
            {categoryName && (
              <Chip label={categoryName} size="small" sx={{ height: 20 }} />
            )}
            {version && (
              <Chip
                label={t('core:app_page.hero.version', {
                  version,
                  postProcess: 'capitalizeFirstChar',
                })}
                size="small"
                sx={{ height: 20 }}
              />
            )}
          </Box>
        </Box>
      </Box>
      <Typography
        sx={{
          color: description ? 'text.primary' : 'text.secondary',
          display: '-webkit-box',
          fontSize: '13.5px',
          lineHeight: 1.55,
          mt: 1.5,
          overflow: 'hidden',
          overflowWrap: 'anywhere',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 3,
        }}
      >
        {description ||
          t('core:publish_form.preview_empty_description', {
            postProcess: 'capitalizeFirstChar',
          })}
      </Typography>
      {tags.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1.25 }}>
          {tags.map((tag, index) => (
            <Chip
              key={`${index}-${tag}`}
              label={tag}
              size="small"
              sx={{
                backgroundColor: alpha(theme.palette.text.primary, 0.07),
                height: 22,
              }}
            />
          ))}
        </Box>
      )}
      {shotUrls.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.75, mt: 1.5 }}>
          {shotUrls.map((url, index) => (
            <Box
              alt=""
              component="img"
              key={`${url}-${index}`}
              src={url}
              sx={{
                aspectRatio: '16 / 10',
                border: `1px solid ${alpha(theme.palette.text.primary, 0.1)}`,
                borderRadius: '8px',
                flex: 1,
                minWidth: 0,
                objectFit: 'cover',
              }}
            />
          ))}
        </Box>
      )}
    </Paper>
  );
};

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
}

export interface PublishPart {
  key: string;
  label: string;
  detail?: string;
}

/** What's still missing, what will be published, the fee and Publish. */
export const PublishSummaryCard = ({
  checklist,
  parts,
  unitFee,
  busy,
  disabled,
  publishLabel,
  onPublish,
}: {
  checklist: ChecklistItem[];
  parts: PublishPart[];
  unitFee: number | null;
  busy: boolean;
  disabled: boolean;
  publishLabel: string;
  onPublish: () => void;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const missing = checklist.filter((item) => !item.done);

  return (
    <Paper
      elevation={0}
      sx={{
        backgroundColor: alpha(theme.palette.background.paper, 0.85),
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: '18px',
        p: 2.25,
      }}
    >
      <Typography sx={{ fontSize: '16px', fontWeight: 650, mb: 1 }}>
        {t('core:publish_form.summary_title', {
          postProcess: 'capitalizeFirstChar',
        })}
      </Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {checklist.map((item) => (
          <Box
            component="li"
            key={item.key}
            sx={{
              alignItems: 'center',
              color: item.done ? 'text.primary' : 'text.secondary',
              display: 'flex',
              fontSize: '13.5px',
              gap: 1,
              py: 0.4,
            }}
          >
            {/* Read out too: the icon is the only sign of done or not. */}
            {item.done ? (
              <CheckCircleRoundedIcon
                sx={{ color: theme.palette.success.main, fontSize: 18 }}
                titleAccess={t('core:publish_form.check_done', {
                  postProcess: 'capitalizeFirstChar',
                })}
              />
            ) : (
              <RadioButtonUncheckedRoundedIcon
                sx={{ fontSize: 18 }}
                titleAccess={t('core:publish_form.check_open', {
                  postProcess: 'capitalizeFirstChar',
                })}
              />
            )}
            {item.label}
          </Box>
        ))}
      </Box>
      <Divider sx={{ my: 1.5 }} />
      <Typography sx={{ color: 'text.secondary', fontSize: '12.5px', mb: 0.5 }}>
        {t('core:publish_form.summary_parts', {
          postProcess: 'capitalizeFirstChar',
        })}
      </Typography>
      {parts.map((part) => (
        <Box
          key={part.key}
          sx={{
            alignItems: 'baseline',
            display: 'flex',
            fontSize: '13.5px',
            gap: 1,
            justifyContent: 'space-between',
            py: 0.3,
          }}
        >
          <Typography sx={{ fontSize: 'inherit' }}>{part.label}</Typography>
          <Typography
            sx={{
              color: 'text.secondary',
              fontSize: '12.5px',
              textAlign: 'end',
            }}
          >
            {part.detail ||
              (unitFee !== null ? `${unitFee.toFixed(2)} QORT` : '')}
          </Typography>
        </Box>
      ))}
      {unitFee !== null && (
        <Box
          sx={{
            alignItems: 'baseline',
            display: 'flex',
            fontWeight: 700,
            justifyContent: 'space-between',
            mt: 0.75,
          }}
        >
          <Typography sx={{ fontSize: '14px', fontWeight: 700 }}>
            {t('core:publish_form.summary_fee', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
          <Typography sx={{ fontSize: '14px', fontWeight: 700 }}>
            {`${(unitFee * parts.length).toFixed(2)} QORT`}
          </Typography>
        </Box>
      )}
      <Button
        disableElevation
        disabled={disabled || busy}
        fullWidth
        onClick={onPublish}
        size="large"
        startIcon={
          busy ? (
            <CircularProgress color="inherit" size={16} />
          ) : (
            <CloudUploadRoundedIcon />
          )
        }
        sx={{
          borderRadius: '14px',
          fontWeight: 700,
          mt: 2,
          py: 1.25,
          textTransform: 'none',
        }}
        variant="contained"
      >
        {publishLabel}
      </Button>
      {missing.length > 0 && (
        <Typography
          sx={{
            color: 'text.secondary',
            fontSize: '12px',
            mt: 1,
            textAlign: 'center',
          }}
        >
          {t('core:publish_form.missing_hint', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
      )}
    </Paper>
  );
};
