import { type ReactNode, useCallback } from 'react';
import LinkIcon from '@mui/icons-material/Link';
import { Box, ButtonBase, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { AppCardEnhanced } from '../AppCard';
import { AppsWidthLimiter } from '../Apps-styles';
import { VirtualAppGrid } from '../AppsLibrary/VirtualAppGrid';
import type { LauncherApp, LauncherLink } from './launcherSearch';
import { LAUNCHER_TILE_WIDTH_PX } from './LauncherTile';

const CARD_MIN_WIDTH = 320;
const CARD_HEIGHT = 220;
const GRID_GAP = 16;

const getAppKey = (app: LauncherApp) => `${app?.service}-${app?.name}`;

const SectionTitle = ({
  children,
  count,
}: {
  children: ReactNode;
  count?: number;
}) => (
  <Typography
    component="h2"
    sx={(theme) => ({
      color: theme.palette.text.primary,
      fontSize: '15px',
      fontWeight: 600,
      lineHeight: 1.3,
      margin: 0,
    })}
  >
    {children}
    {count !== undefined ? (
      <Box
        component="span"
        sx={(theme) => ({
          color: theme.palette.text.secondary,
          fontWeight: 400,
          marginLeft: '8px',
        })}
      >
        {count}
      </Box>
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
  const renderApp = useCallback(
    (app: LauncherApp) => <AppCardEnhanced app={app} myName={myName} />,
    [myName]
  );
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
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            width: '100%',
          }}
        >
          <SectionTitle count={apps.length}>
            {t('core:launcher.results_apps', {
              postProcess: 'capitalizeFirstChar',
            })}
          </SectionTitle>
          <VirtualAppGrid
            active={isActive}
            gap={GRID_GAP}
            getKey={getAppKey}
            items={apps}
            minColumnWidth={CARD_MIN_WIDTH}
            renderItem={renderApp}
            rowHeight={CARD_HEIGHT}
            scrollElement={scrollElement}
          />
        </Box>
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
