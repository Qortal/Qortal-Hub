import { type MouseEvent, useId } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { CategoryIcon } from '../config/categoryIconComponents';
import { APP_CARD_HEIGHT, APP_ROW_HEIGHT } from '../AppsLibrary/libraryLayout';
import { cap, cardSurfaceSx, libraryMuted } from '../AppsLibrary/libraryStyles';
import {
  AppIconTile,
  DetailsButton,
  isWebsiteApp,
  LibraryActionButton,
  LibraryChip,
  OpenAppButton,
  PinToggleButton,
  WebsiteLabel,
} from './libraryCardParts';
import { LibraryRatingSummary } from './LibraryRatingSummary';

export interface LibraryAppItemProps {
  app: any;
  title: string;
  developerLine: string;
  description: string;
  categoryId?: string;
  categoryName?: string;
  tags: string[];
  isInstalled: boolean;
  isPinned: boolean;
  onOpenDetails: () => void;
  onTogglePin: (event: MouseEvent) => void;
  onOpen: (event: MouseEvent) => void;
  onUpdate?: (event: MouseEvent) => void;
}

const ellipsisSx = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

const Actions = ({
  isInstalled,
  isPinned,
  onOpen,
  onTogglePin,
  onUpdate,
  titleId,
}: Pick<
  LibraryAppItemProps,
  'isInstalled' | 'isPinned' | 'onOpen' | 'onTogglePin' | 'onUpdate'
> & { titleId: string }) => {
  const { t } = useTranslation(['core']);
  return (
    <>
      {onUpdate ? (
        // Gives way first in a tight tile ("Aktualisieren" + pin +
        // "Herunterladen" in German); Open and Download keep their width.
        <LibraryActionButton
          describedBy={titleId}
          kind="secondary"
          onClick={onUpdate}
          shrink
        >
          {t('core:developer.update', cap)}
        </LibraryActionButton>
      ) : null}
      <PinToggleButton
        describedBy={titleId}
        onClick={onTogglePin}
        pinned={isPinned}
      />
      <OpenAppButton
        describedBy={titleId}
        installed={isInstalled}
        onClick={onOpen}
      />
    </>
  );
};

const CategoryLabel = ({
  categoryId,
  categoryName,
}: Pick<LibraryAppItemProps, 'categoryId' | 'categoryName'>) =>
  categoryName ? (
    <LibraryChip
      icon={<CategoryIcon id={categoryId} size={14} />}
      label={categoryName}
      tone="accent"
    />
  ) : null;

/** An app as a card of the grid. */
export const LibraryAppTile = (props: LibraryAppItemProps) => {
  const {
    app,
    title,
    developerLine,
    description,
    categoryId,
    categoryName,
    tags,
    onOpenDetails,
  } = props;
  const titleId = useId();

  return (
    <Box
      aria-labelledby={titleId}
      component="article"
      sx={(theme) => ({
        ...cardSurfaceSx(theme),
        display: 'flex',
        flexDirection: 'column',
        height: APP_CARD_HEIGHT,
        minWidth: 0,
        p: 2,
      })}
    >
      <Box sx={{ alignItems: 'flex-start', display: 'flex', gap: 1.5 }}>
        <AppIconTile app={app} size={52} />
        <Box
          sx={{
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            gap: '2px',
            minWidth: 0,
          }}
        >
          <DetailsButton
            id={titleId}
            onClick={onOpenDetails}
            textSx={{ fontSize: '15px', fontWeight: 650, lineHeight: '21px' }}
          >
            {title}
          </DetailsButton>
          <Box
            sx={{ alignItems: 'center', display: 'flex', gap: 1, minWidth: 0 }}
          >
            <Typography
              component="span"
              sx={(theme) => ({
                ...ellipsisSx,
                color: libraryMuted(theme),
                fontSize: '12.5px',
                lineHeight: '18px',
              })}
            >
              {developerLine}
            </Typography>
            {isWebsiteApp(app) ? <WebsiteLabel /> : null}
          </Box>
          <LibraryRatingSummary name={app?.name} service={app?.service} />
        </Box>
      </Box>

      <Typography
        sx={(theme) => ({
          color: libraryMuted(theme),
          display: '-webkit-box',
          fontSize: '13px',
          height: 38,
          lineHeight: 1.45,
          mt: 1.5,
          overflow: 'hidden',
          overflowWrap: 'anywhere',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 2,
        })}
      >
        {description}
      </Typography>

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexWrap: 'nowrap',
          gap: 0.75,
          height: 22,
          minWidth: 0,
          mt: 1.25,
          overflow: 'hidden',
        }}
      >
        <CategoryLabel categoryId={categoryId} categoryName={categoryName} />
        {tags.map((tag, index) => (
          <LibraryChip key={`${tag}-${index}`} label={tag} tone="neutral" />
        ))}
      </Box>

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: 1,
          justifyContent: 'flex-end',
          minWidth: 0,
          mt: 'auto',
          pt: 1,
        }}
      >
        <Actions {...props} titleId={titleId} />
      </Box>
    </Box>
  );
};

/** An app as a row of the list. */
export const LibraryAppRow = (props: LibraryAppItemProps) => {
  const {
    app,
    title,
    developerLine,
    description,
    categoryId,
    categoryName,
    onOpenDetails,
  } = props;
  const titleId = useId();

  return (
    <Box
      aria-labelledby={titleId}
      component="article"
      data-library-row
      sx={(theme) => ({
        ...cardSurfaceSx(theme, { lift: 1 }),
        alignItems: 'center',
        borderRadius: '14px',
        columnGap: 1.75,
        display: 'grid',
        // Two lines beside the icon, the details right after the name; the
        // buttons stay at the end.
        gridTemplateColumns: '44px minmax(0, 1fr) auto',
        height: APP_ROW_HEIGHT,
        minWidth: 0,
        px: 1.75,
        scrollMarginBottom: '16px',
        scrollMarginTop: 'var(--library-sticky-offset, 0px)',
      })}
    >
      <AppIconTile app={app} size={44} />

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          minWidth: 0,
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            columnGap: 1,
            display: 'flex',
            // One line: a category that does not fit after the name and the
            // rating wraps below it, out of sight, instead of being cut.
            flexWrap: 'wrap',
            height: 22,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flex: '0 1 auto',
              gap: 1,
              minWidth: 0,
            }}
          >
            {/* The name gives way before the rating. */}
            <DetailsButton
              id={titleId}
              onClick={onOpenDetails}
              overlayRadius={14}
              textSx={{
                fontSize: '14.5px',
                fontWeight: 650,
                lineHeight: '20px',
              }}
            >
              {title}
            </DetailsButton>
            <Box sx={{ flexShrink: 0 }}>
              <LibraryRatingSummary name={app?.name} service={app?.service} />
            </Box>
          </Box>
          <CategoryLabel categoryId={categoryId} categoryName={categoryName} />
        </Box>

        <Box
          sx={{ alignItems: 'center', display: 'flex', gap: 0.75, minWidth: 0 }}
        >
          <Typography
            component="span"
            sx={(theme) => ({
              ...ellipsisSx,
              color: libraryMuted(theme),
              flex: '0 1 auto',
              fontSize: '12.5px',
              lineHeight: '18px',
              // A long name leaves room for the description.
              maxWidth: '45%',
            })}
          >
            {developerLine}
          </Typography>
          {isWebsiteApp(app) ? <WebsiteLabel /> : null}
          {description ? (
            <>
              <Box
                aria-hidden
                component="span"
                sx={(theme) => ({
                  color: libraryMuted(theme),
                  flexShrink: 0,
                  fontSize: '12.5px',
                  lineHeight: '18px',
                })}
              >
                ·
              </Box>
              <Typography
                component="span"
                sx={(theme) => ({
                  ...ellipsisSx,
                  color: libraryMuted(theme),
                  flex: '1 1 0%',
                  fontSize: '12.5px',
                  lineHeight: '18px',
                })}
              >
                {description}
              </Typography>
            </>
          ) : null}
        </Box>
      </Box>

      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1 }}>
        <Actions {...props} titleId={titleId} />
      </Box>
    </Box>
  );
};
