import { Box, ButtonBase } from '@mui/material';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useTranslation } from 'react-i18next';
import { CategoryIcon } from '../config/categoryIconComponents';
import {
  CATEGORY_ROW_HEIGHT,
  CATEGORY_TILE_HEIGHT,
} from '../AppsLibrary/libraryLayout';
import { CountBadge } from '../AppsLibrary/LibrarySection';
import {
  accentTileSx,
  cap,
  cardSurfaceSx,
  libraryFocusRing,
  libraryMuted,
} from '../AppsLibrary/libraryStyles';
import type { LibraryView } from '../AppsLibrary/libraryView';

interface Category {
  id: string;
  name: string;
}

interface CategoryCardProps {
  category: Category;
  appCount: number;
  onClick: (category: Category) => void;
  /** A tile of the grid, or a row of the list. */
  view?: LibraryView;
}

/** A category of the library, with how many apps it holds. */
export const CategoryCard = ({
  category,
  appCount,
  onClick,
  view = 'grid',
}: CategoryCardProps) => {
  const { t } = useTranslation(['core']);
  const isList = view === 'list';

  const displayName =
    category.id === 'all'
      ? t('core:launcher.library.all_categories', cap)
      : category.name;

  return (
    <ButtonBase
      disableRipple
      onClick={() => onClick(category)}
      sx={(theme) => ({
        ...cardSurfaceSx(theme, { lift: isList ? 1 : 2 }),
        alignItems: isList ? 'center' : 'flex-start',
        borderRadius: isList ? '14px' : '16px',
        color: theme.palette.text.primary,
        display: 'flex',
        flexDirection: isList ? 'row' : 'column',
        // A <button> keeps the browser's own font unless told otherwise.
        fontFamily: 'inherit',
        gap: 1.5,
        height: isList ? CATEGORY_ROW_HEIGHT : CATEGORY_TILE_HEIGHT,
        justifyContent: isList ? 'flex-start' : 'space-between',
        minWidth: 0,
        p: isList ? '0 14px' : '14px',
        textAlign: 'left',
        width: '100%',
        '&.Mui-focusVisible': libraryFocusRing(theme, 2),
      })}
    >
      <Box
        sx={(theme) => accentTileSx(theme, isList ? 32 : 40, isList ? 10 : 12)}
      >
        <CategoryIcon id={category.id} size={isList ? 18 : 22} />
      </Box>
      <Box
        component="span"
        sx={{
          // In a row the count follows the name; the arrow stays at the end.
          flex: isList ? '0 1 auto' : undefined,
          fontSize: '14px',
          fontWeight: 600,
          lineHeight: '18px',
          minWidth: 0,
          overflow: 'hidden',
          overflowWrap: 'anywhere',
          pr: isList ? 0 : 4,
          ...(isList
            ? { textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
            : {
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 2,
              }),
        }}
      >
        {displayName}
      </Box>
      <Box
        component="span"
        sx={
          isList
            ? { display: 'flex', flexShrink: 0 }
            : { position: 'absolute', right: 12, top: 12 }
        }
      >
        <CountBadge decorative={false}>{appCount}</CountBadge>
      </Box>
      {isList ? (
        <ChevronRightRoundedIcon
          aria-hidden
          sx={(theme) => ({
            color: libraryMuted(theme),
            flexShrink: 0,
            fontSize: 18,
            ml: 'auto',
          })}
        />
      ) : null}
    </ButtonBase>
  );
};
