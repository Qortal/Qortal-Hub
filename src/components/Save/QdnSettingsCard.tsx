import type { SvgIconComponent } from '@mui/icons-material';
import { Box, Button, Paper, Slide, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { type ReactNode, useId } from 'react';

/** How long a card that says it's done stays before it goes. */
export const QDN_CARD_DONE_MS = 2500;

export type QdnCardTone = 'primary' | 'success' | 'error';

export type QdnCardAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
};

type QdnSettingsCardProps = {
  open: boolean;
  icon: SvgIconComponent;
  tone?: QdnCardTone;
  title: string;
  /** Left out when the card only says it's done. */
  text?: string;
  /** The main action, such as Save to QDN or Restore. */
  primary?: QdnCardAction;
  /** The way out, such as Not now. */
  secondary?: QdnCardAction;
};

/**
 * A card at the bottom of the page about the account's settings on QDN:
 * saving them, or taking in what another device saved. With actions it asks,
 * as a non-modal dialog; without, it only says what happened.
 */
export const QdnSettingsCard = ({
  open,
  icon: Icon,
  tone = 'primary',
  title,
  text,
  primary,
  secondary,
}: QdnSettingsCardProps) => {
  const titleId = useId();
  const textId = useId();
  const asks = !!(primary || secondary);

  return (
    <Slide direction="up" in={open} mountOnEnter unmountOnExit>
      <Paper
        aria-describedby={asks && text ? textId : undefined}
        aria-labelledby={titleId}
        aria-modal={asks ? false : undefined}
        elevation={8}
        role={asks ? 'dialog' : 'status'}
        sx={(theme) => ({
          alignItems: 'center',
          backgroundImage: 'none',
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: '16px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px 14px',
          maxWidth: 600,
          padding: '14px 16px',
          pointerEvents: 'auto',
          width: '100%',
        })}
      >
        <Box
          aria-hidden
          sx={(theme) => {
            const color = theme.palette[tone].main;
            return {
              alignItems: 'center',
              backgroundColor: alpha(color, 0.14),
              borderRadius: '50%',
              color,
              display: 'flex',
              flexShrink: 0,
              height: 40,
              justifyContent: 'center',
              width: 40,
            };
          }}
        >
          <Icon sx={{ fontSize: 22 }} />
        </Box>
        <Box sx={{ flex: '1 1 220px', minWidth: 0 }}>
          <Typography
            id={titleId}
            sx={{ fontSize: '14px', fontWeight: 600, lineHeight: 1.4 }}
          >
            {title}
          </Typography>
          {text ? (
            <Typography
              id={textId}
              sx={(theme) => ({
                color: theme.palette.text.secondary,
                fontSize: '12.5px',
                lineHeight: 1.45,
                overflowWrap: 'anywhere',
              })}
            >
              {text}
            </Typography>
          ) : null}
        </Box>
        {asks ? (
          <Box
            sx={{
              display: 'flex',
              flexShrink: 0,
              gap: '8px',
              justifyContent: 'flex-end',
              marginLeft: 'auto',
            }}
          >
            {secondary ? (
              <Button
                color="inherit"
                disabled={secondary.disabled}
                onClick={secondary.onClick}
                sx={{ textTransform: 'none' }}
              >
                {secondary.label}
              </Button>
            ) : null}
            {primary ? (
              <Button
                disableElevation
                disabled={primary.disabled}
                loading={primary.loading}
                onClick={primary.onClick}
                sx={{ borderRadius: '10px', textTransform: 'none' }}
                variant="contained"
              >
                {primary.label}
              </Button>
            ) : null}
          </Box>
        ) : null}
      </Paper>
    </Slide>
  );
};

/**
 * Where the cards sit: centred at the bottom of their container (the
 * launcher), or of the page, one above the other.
 */
export const QdnCardDock = ({
  children,
  page = false,
}: {
  children: ReactNode;
  page?: boolean;
}) => (
  <Box
    sx={(theme) => ({
      alignItems: 'center',
      bottom: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      left: 0,
      paddingInline: '16px',
      pointerEvents: 'none',
      position: page ? 'fixed' : 'absolute',
      right: 0,
      zIndex: page ? theme.zIndex.snackbar : 5,
    })}
  >
    {children}
  </Box>
);
