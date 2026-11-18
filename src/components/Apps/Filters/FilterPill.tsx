import { type ReactNode, type Ref, useId } from 'react';
import { Box, ButtonBase } from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import {
  libraryAccent,
  libraryFocusRing,
  libraryHairline,
  libraryMuted,
  REDUCED_MOTION,
  visuallyHiddenSx,
} from '../AppsLibrary/libraryStyles';

interface FilterPillProps {
  /** What the pill sets ("Sort by"); its name starts with it. */
  label: string;
  /** What it is set to now. */
  valueLabel: ReactNode;
  icon?: ReactNode;
  /** Set to something other than "all". */
  active?: boolean;
  open: boolean;
  popupId: string;
  popupRole: 'menu' | 'dialog';
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  buttonRef?: Ref<HTMLButtonElement>;
}

/**
 * A rounded button that shows a filter's value and opens its choices. It is
 * named by both parts ("Sort by Highest rated"), so the name holds the text on
 * screen also where a narrow bar hides the label.
 */
export const FilterPill = ({
  label,
  valueLabel,
  icon,
  active = false,
  open,
  popupId,
  popupRole,
  onClick,
  buttonRef,
}: FilterPillProps) => {
  const labelId = useId();
  const valueId = useId();
  // The active tint lies over the pill's own surface, so its text keeps at
  // least 4.5:1 in both themes, also on hover and while open.
  const tint = (theme: Theme, opacity: number) =>
    `linear-gradient(${alpha(theme.palette.primary.main, opacity)}, ${alpha(
      theme.palette.primary.main,
      opacity
    )})`;
  return (
    <ButtonBase
      aria-controls={open ? popupId : undefined}
      aria-expanded={open}
      aria-haspopup={popupRole}
      aria-labelledby={`${labelId} ${valueId}`}
      disableRipple
      onClick={onClick}
      ref={buttonRef}
      sx={(theme) => ({
        backgroundColor: open
          ? theme.palette.background.paper
          : alpha(theme.palette.background.paper, 0.72),
        backgroundImage: active ? tint(theme, 0.14) : 'none',
        border: `1px solid ${
          open
            ? libraryAccent(theme)
            : active
              ? alpha(theme.palette.primary.main, 0.45)
              : libraryHairline(theme, 0.14)
        }`,
        borderRadius: '12px',
        boxSizing: 'border-box',
        color: theme.palette.text.primary,
        display: 'inline-flex',
        flexShrink: 0,
        // A <button> keeps the browser's own font unless told otherwise.
        fontFamily: 'inherit',
        fontSize: '13.5px',
        gap: 0.75,
        height: 36,
        maxWidth: 280,
        minWidth: 0,
        px: 1.5,
        transition: 'background-color 160ms, border-color 160ms',
        '&:hover': {
          backgroundColor:
            active && !open
              ? alpha(theme.palette.background.paper, 0.72)
              : theme.palette.background.paper,
          backgroundImage: active ? tint(theme, open ? 0.14 : 0.16) : 'none',
          borderColor: open
            ? libraryAccent(theme)
            : active
              ? alpha(theme.palette.primary.main, 0.6)
              : libraryHairline(theme, 0.28),
        },
        '&.Mui-focusVisible': libraryFocusRing(theme, 2),
        '& .FilterPill-icon': {
          color: active ? libraryAccent(theme) : libraryMuted(theme),
          display: 'inline-flex',
          '& .MuiSvgIcon-root, & img': { fontSize: 16 },
        },
        '@container library-bar (max-width: 560px)': {
          '& .FilterPill-label': visuallyHiddenSx,
        },
      })}
    >
      <Box
        className="FilterPill-label"
        component="span"
        id={labelId}
        sx={(theme) => ({
          color: libraryMuted(theme),
          fontWeight: 500,
          whiteSpace: 'nowrap',
        })}
      >
        {label}
      </Box>
      {icon ? (
        <Box aria-hidden className="FilterPill-icon" component="span">
          {icon}
        </Box>
      ) : null}
      <Box
        component="span"
        id={valueId}
        sx={(theme) => ({
          color: active ? libraryAccent(theme) : theme.palette.text.primary,
          fontWeight: 600,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        })}
      >
        {valueLabel}
      </Box>
      <ExpandMoreRoundedIcon
        aria-hidden
        sx={(theme) => ({
          color: libraryMuted(theme),
          flexShrink: 0,
          fontSize: 18,
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 180ms',
          [REDUCED_MOTION]: { transition: 'none' },
        })}
      />
    </ButtonBase>
  );
};
