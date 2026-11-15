import { type ReactNode, useId } from 'react';
import { Box, Typography } from '@mui/material';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import { useTranslation } from 'react-i18next';
import { formatTimestamp } from '../../../utils/time';
import { LibraryActionButton } from '../AppCard/libraryCardParts';
import type { PublishedPrivateApp } from '../privateAppMetadata';
import {
  fittedColumnsTemplate,
  GRID_GAP,
  LIST_GAP,
  LIST_MAX_COLUMNS,
  PRIVATE_ROW_HEIGHT,
  PRIVATE_ROW_MIN_WIDTH,
  PRIVATE_TILE_HEIGHT,
  PRIVATE_TILE_MIN_WIDTH,
} from './libraryLayout';
import {
  accentTileSx,
  cap,
  cardSurfaceSx,
  libraryFadeInSx,
  libraryMuted,
} from './libraryStyles';
import type { LibraryView } from './libraryView';

interface PrivateAppItemProps {
  app: PublishedPrivateApp;
  groupName: string;
  view: LibraryView;
  onOpen: () => void;
  /** More buttons, before Open (Update, for the account's own apps). */
  actions?: ReactNode;
}

const lineSx = (theme: any) => ({
  color: libraryMuted(theme),
  fontSize: '12.5px',
  lineHeight: '18px',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

/** A private app the account published, as a tile or a row. */
export const PrivateAppItem = ({
  app,
  groupName,
  view,
  onOpen,
  actions,
}: PrivateAppItemProps) => {
  const { t } = useTranslation(['core']);
  const titleId = useId();
  const details = t('core:private_apps.details', {
    group: groupName,
    name: app.name,
    postProcess: 'capitalizeFirstChar',
  });
  const date = app.timestamp ? formatTimestamp(app.timestamp) : '';
  const isList = view === 'list';

  const title = (
    <Typography
      component="h3"
      id={titleId}
      sx={{
        fontSize: isList ? '14.5px' : '15px',
        fontWeight: 650,
        lineHeight: '20px',
        m: 0,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
      title={app.identifier}
    >
      {app.identifier}
    </Typography>
  );

  const buttons = (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        gap: 1,
        justifyContent: 'flex-end',
      }}
    >
      {actions}
      <LibraryActionButton
        describedBy={titleId}
        kind="primary"
        onClick={onOpen}
      >
        {t('core:action.open', cap)}
      </LibraryActionButton>
    </Box>
  );

  if (isList) {
    return (
      <Box
        aria-labelledby={titleId}
        component="article"
        sx={(theme) => ({
          ...cardSurfaceSx(theme, { interactive: false }),
          alignItems: 'center',
          borderRadius: '14px',
          columnGap: 1.5,
          display: 'grid',
          // As the library's rows: the name, then its details and date on
          // the line below; the buttons at the end.
          gridTemplateColumns: '40px minmax(0, 1fr) auto',
          height: PRIVATE_ROW_HEIGHT,
          minWidth: 0,
          px: 1.75,
        })}
      >
        <Box aria-hidden sx={(theme) => accentTileSx(theme, 40, 12)}>
          <LockRoundedIcon sx={{ fontSize: 20 }} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          {title}
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: 0.75,
              minWidth: 0,
            }}
          >
            <Typography component="span" sx={lineSx}>
              {details}
            </Typography>
            {date ? (
              <>
                <Box
                  aria-hidden
                  component="span"
                  sx={(theme) => ({ ...lineSx(theme), flexShrink: 0 })}
                >
                  ·
                </Box>
                {/* The details give way first: the date stays whole. */}
                <Typography
                  className="libraryPrivateDate"
                  component="span"
                  sx={(theme) => ({ ...lineSx(theme), flexShrink: 0 })}
                >
                  {date}
                </Typography>
              </>
            ) : null}
          </Box>
        </Box>
        {buttons}
      </Box>
    );
  }

  return (
    <Box
      aria-labelledby={titleId}
      component="article"
      sx={(theme) => ({
        ...cardSurfaceSx(theme, { interactive: false }),
        display: 'flex',
        flexDirection: 'column',
        height: PRIVATE_TILE_HEIGHT,
        minWidth: 0,
        p: 2,
      })}
    >
      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.5 }}>
        <Box aria-hidden sx={(theme) => accentTileSx(theme, 44, 12)}>
          <LockRoundedIcon sx={{ fontSize: 22 }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {title}
          <Typography sx={lineSx}>{details}</Typography>
          {date ? <Typography sx={lineSx}>{date}</Typography> : null}
        </Box>
      </Box>
      <Box sx={{ mt: 'auto' }}>{buttons}</Box>
    </Box>
  );
};

/** Lays private apps out as tiles or rows. A short list, so not virtual. */
export const PrivateAppList = ({
  view,
  label,
  children,
}: {
  view: LibraryView;
  label: string;
  children: ReactNode;
}) => (
  <Box
    aria-label={label}
    key={view}
    role="list"
    sx={{
      containerName: 'library',
      containerType: 'inline-size',
      display: 'grid',
      gap: `${view === 'list' ? LIST_GAP : GRID_GAP}px`,
      gridTemplateColumns:
        view === 'list'
          ? fittedColumnsTemplate(
              PRIVATE_ROW_MIN_WIDTH,
              LIST_GAP,
              LIST_MAX_COLUMNS
            )
          : fittedColumnsTemplate(PRIVATE_TILE_MIN_WIDTH, GRID_GAP),
      width: '100%',
      ...libraryFadeInSx(),
    }}
  >
    {children}
  </Box>
);
