import { useLayoutEffect, useRef, useState } from 'react';
import {
  alpha,
  Box,
  Button,
  Chip,
  Skeleton,
  Typography,
  useTheme,
} from '@mui/material';
import LanguageRoundedIcon from '@mui/icons-material/LanguageRounded';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded';
import NewReleasesRoundedIcon from '@mui/icons-material/NewReleasesRounded';
import { useTranslation } from 'react-i18next';
import {
  formatLongDate,
  LinkifiedText,
  SectionCard,
  SectionTitle,
} from './AppPageParts';
import { openPageTextLink } from './appPageLink';
import { APP_LINK_KINDS, AppLinkKind, AppPageData } from './appPageData';

const LINK_ICONS: Record<AppLinkKind, React.ReactElement> = {
  website: <LanguageRoundedIcon fontSize="small" />,
  source: <CodeRoundedIcon fontSize="small" />,
  support: <SupportAgentRoundedIcon fontSize="small" />,
};

/** Long text, folded after a few lines with a "Read more". */
const Expandable = ({ text, lines = 6 }: { text: string; lines?: number }) => {
  const { t } = useTranslation(['core']);
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || open) return;
    setOverflows(element.scrollHeight > element.clientHeight + 2);
  }, [text, open]);

  return (
    <Box>
      <Box
        ref={ref}
        sx={
          open
            ? {}
            : {
                display: '-webkit-box',
                overflow: 'hidden',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: lines,
              }
        }
      >
        <LinkifiedText text={text} />
      </Box>
      {(overflows || open) && (
        <Button
          onClick={() => setOpen((value) => !value)}
          size="small"
          sx={{ mt: 0.5, px: 0, textTransform: 'none' }}
        >
          {open
            ? t('core:app_page.about.read_less', {
                postProcess: 'capitalizeFirstChar',
              })
            : t('core:app_page.about.read_more', {
                postProcess: 'capitalizeFirstChar',
              })}
        </Button>
      )}
    </Box>
  );
};

export const AppAboutSection = ({
  description,
  page,
  loading,
  versionCurrent,
}: {
  description: string;
  page: AppPageData | null;
  loading: boolean;
  versionCurrent: boolean;
}) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core']);
  const about = page?.about?.trim() || '';
  const whatsNew = page?.whatsNew?.trim() || '';
  const links = APP_LINK_KINDS.filter((kind) => page?.links?.[kind]);

  return (
    <>
      <SectionCard
        component="section"
        aria-labelledby="app-page-about"
        sx={{ mb: 2 }}
      >
        <SectionTitle id="app-page-about">
          {t('core:app_detail.about', { postProcess: 'capitalizeFirstChar' })}
        </SectionTitle>
        {description ? (
          <Typography
            sx={{
              fontSize: '15.5px',
              fontWeight: 500,
              lineHeight: 1.6,
              mb: about ? 1.5 : 0,
              overflowWrap: 'anywhere',
            }}
          >
            {description}
          </Typography>
        ) : (
          !about &&
          !loading && (
            <Typography sx={{ color: 'text.secondary', fontSize: '14px' }}>
              {t('core:message.generic.no_description', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          )
        )}
        {loading && !page ? (
          <Box>
            <Skeleton width="92%" />
            <Skeleton width="85%" />
            <Skeleton width="60%" />
          </Box>
        ) : (
          about && <Expandable text={about} />
        )}
        {links.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2 }}>
            {links.map((kind) => (
              <Chip
                clickable
                icon={LINK_ICONS[kind]}
                key={kind}
                label={t(`core:app_page.links.${kind}`, {
                  postProcess: 'capitalizeFirstChar',
                })}
                onClick={() => void openPageTextLink(page!.links[kind]!)}
                sx={{
                  backgroundColor: alpha(theme.palette.primary.main, 0.12),
                  fontWeight: 600,
                  '&:hover': {
                    backgroundColor: alpha(theme.palette.primary.main, 0.2),
                  },
                }}
                title={page!.links[kind]}
              />
            ))}
          </Box>
        )}
      </SectionCard>

      {whatsNew && (
        <SectionCard
          component="section"
          aria-labelledby="app-page-whats-new"
          sx={{ mb: 2 }}
        >
          <SectionTitle
            action={
              page?.version ? (
                <Chip
                  icon={<NewReleasesRoundedIcon sx={{ fontSize: 16 }} />}
                  label={t('core:app_page.hero.version', {
                    version: page.version,
                    postProcess: 'capitalizeFirstChar',
                  })}
                  size="small"
                  sx={{ fontWeight: 600 }}
                />
              ) : undefined
            }
            id="app-page-whats-new"
          >
            {t('core:app_page.whats_new.title', {
              postProcess: 'capitalizeFirstChar',
            })}
          </SectionTitle>
          {page?.updated ? (
            <Typography
              sx={{ color: 'text.secondary', fontSize: '13px', mb: 1 }}
            >
              {formatLongDate(page.updated, i18n.language)}
            </Typography>
          ) : null}
          <Expandable lines={5} text={whatsNew} />
          {!versionCurrent && (
            <Typography
              sx={{ color: 'text.secondary', fontSize: '12.5px', mt: 1.5 }}
            >
              {t('core:app_page.version_older', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          )}
        </SectionCard>
      )}
    </>
  );
};
