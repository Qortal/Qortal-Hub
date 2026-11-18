import { type ReactNode, useId } from 'react';
import LinkIcon from '@mui/icons-material/Link';
import { Box, ButtonBase, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { AppsWidthLimiter } from '../Apps-styles';
import { AppCollection } from '../AppsLibrary/AppCollection';
import { CountBadge, LibraryPanel } from '../AppsLibrary/LibrarySection';
import { LibraryViewToggle } from '../AppsLibrary/LibraryViewToggle';
import type { LauncherApp, LauncherLink } from './launcherSearch';
import { LAUNCHER_TILE_WIDTH_PX } from './LauncherTile';

const SectionTitle = ({
  children,
  count,
  id,
}: {
  children: ReactNode;
  count?: number;
  id?: string;
}) => (
  <Typography
    component="h2"
    id={id}
    sx={(theme) => ({
      alignItems: 'center',
      color: theme.palette.text.primary,
      display: 'flex',
      fontSize: '17px',
      fontWeight: 650,
      gap: 1,
      lineHeight: '28px',
      margin: 0,
    })}
  >
    {children}
    {/* Part of the heading's name: the saved tiles are no list that says
        how many it holds. */}
    {count !== undefined ? (
      <CountBadge decorative={false}>{count}</CountBadge>
    ) : null}
  </Typography>
);

interface LauncherSearchResultsProps {
  /** The search words, trimmed. */
  query: string;
  /** Set when the search box holds an address. */
  link: LauncherLink | null;
  onOpenLink: () => void;
  /** Matching apps and websites of the library, best first. */
  apps: LauncherApp[];
  /** Tiles of the saved items that match and are not in the library. */
  savedTiles: ReactNode[];
  /** Name of what Enter opens, when it opens something. */
  enterOpens: string | null;
  myName: string;
  scrollElement: HTMLElement | null;
  /** False while the results are hidden. */
  isActive: boolean;
}

/** What the launcher shows while the search box has text. */
export const LauncherSearchResults = ({
  query,
  link,
  onOpenLink,
  apps,
  savedTiles,
  enterOpens,
  myName,
  scrollElement,
  isActive,
}: LauncherSearchResultsProps) => {
  const { t } = useTranslation(['core']);
  const appsTitleId = useId();
  const appsTitle = t('core:launcher.results_apps', {
    postProcess: 'capitalizeFirstChar',
  });
  const hasNothing = !link && apps.length === 0 && savedTiles.length === 0;

  return (
    <AppsWidthLimiter sx={{ gap: '20px', paddingBottom: '32px' }}>
      {link ? (
        <ButtonBase
          focusRipple
          onClick={onOpenLink}
          sx={(theme) => ({
            backgroundColor: theme.palette.background.paper,
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: '12px',
            gap: '12px',
            justifyContent: 'flex-start',
            maxWidth: '100%',
            padding: '12px 16px',
            textAlign: 'left',
            transition: 'border-color 160ms ease',
            '&:hover, &.Mui-focusVisible': {
              borderColor: theme.palette.primary.main,
            },
          })}
        >
          <LinkIcon
            sx={(theme) => ({
              color: theme.palette.primary.main,
              flexShrink: 0,
              fontSize: 22,
            })}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={(theme) => ({
                color: theme.palette.text.primary,
                fontSize: '14px',
                fontWeight: 600,
              })}
            >
              {t('core:action.open_as_qortal_link', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
            <Typography
              sx={(theme) => ({
                color: theme.palette.text.secondary,
                fontSize: '13px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              })}
            >
              {link.link}
            </Typography>
          </Box>
        </ButtonBase>
      ) : null}

      {enterOpens ? (
        <Typography
          sx={(theme) => ({
            color: theme.palette.text.secondary,
            fontSize: '13px',
          })}
        >
          {t('core:launcher.enter_opens', {
            title: enterOpens,
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
      ) : null}

      {savedTiles.length > 0 ? (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            width: '100%',
          }}
        >
          <SectionTitle count={savedTiles.length}>
            {t('core:launcher.results_saved', {
              postProcess: 'capitalizeFirstChar',
            })}
          </SectionTitle>
          <Box
            sx={{
              display: 'grid',
              gap: '4px 8px',
              gridTemplateColumns: `repeat(auto-fill, ${LAUNCHER_TILE_WIDTH_PX}px)`,
              width: '100%',
            }}
          >
            {savedTiles}
          </Box>
        </Box>
      ) : null}

      {apps.length > 0 ? (
        <LibraryPanel labelledBy={appsTitleId}>
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px 16px',
              justifyContent: 'space-between',
              mb: 2,
            }}
          >
            <SectionTitle count={apps.length} id={appsTitleId}>
              {appsTitle}
            </SectionTitle>
            {/* The library's bar is hidden while searching. */}
            <LibraryViewToggle />
          </Box>
          <AppCollection
            active={isActive}
            apps={apps}
            label={appsTitle}
            myName={myName}
            scrollElement={scrollElement}
          />
        </LibraryPanel>
      ) : null}

      {hasNothing ? (
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            padding: '48px 16px',
            textAlign: 'center',
            width: '100%',
          }}
        >
          <Typography
            sx={(theme) => ({
              color: theme.palette.text.primary,
              fontSize: '16px',
              fontWeight: 600,
              overflowWrap: 'anywhere',
            })}
          >
            {t('core:launcher.no_matches', {
              query,
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
          <Typography
            sx={(theme) => ({
              color: theme.palette.text.secondary,
              fontSize: '14px',
            })}
          >
            {t('core:launcher.no_matches_hint', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </Box>
      ) : null}
    </AppsWidthLimiter>
  );
};
