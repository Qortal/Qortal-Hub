import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { Box, ButtonBase, CircularProgress, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { ReactNode } from 'react';

type QAppWidgetContainerProps = {
  children?: ReactNode;
  emptyMessage?: string | null;
  emptyTitle?: string;
  error?: string | null;
  errorMessage?: string | null;
  errorTitle?: string;
  hasContent?: boolean;
  isEmpty?: boolean;
  isLoading?: boolean;
  loadingLabel?: string;
  loadingMessage?: string | null;
  onRetry?: () => void;
  onSecondaryAction?: () => void;
  retryLabel?: string;
  secondaryActionLabel?: string;
  stateVerticalOffset?: number | string;
};

export const QAppWidgetStatePanel = ({
  description,
  loadingLabel,
  onRetry,
  onSecondaryAction,
  retryLabel = 'Retry',
  secondaryActionLabel,
  title,
  verticalOffset = 0,
}: {
  description?: string | null;
  loadingLabel?: string;
  onRetry?: () => void;
  onSecondaryAction?: () => void;
  retryLabel?: string;
  secondaryActionLabel?: string;
  title: string;
  verticalOffset?: number | string;
}) => {
  const theme = useTheme();
  const translateValue =
    typeof verticalOffset === 'number' ? `${verticalOffset}px` : verticalOffset;

  return (
    <Box
      sx={{
        alignItems: 'center',
        color: theme.palette.text.secondary,
        display: 'flex',
        flex: '1 1 auto',
        flexDirection: 'column',
        gap: '9px',
        justifyContent: 'center',
        minHeight: 0,
        px: 2.5,
        py: 3.5,
        textAlign: 'center',
        transform:
          translateValue && translateValue !== '0' && translateValue !== '0px'
            ? `translateY(${translateValue})`
            : undefined,
      }}
    >
      {loadingLabel ? (
        <CircularProgress
          size={24}
          sx={{
            color:
              theme.palette.mode === 'dark'
                ? alpha(theme.palette.common.white, 0.78)
                : alpha(theme.palette.text.primary, 0.72),
          }}
        />
      ) : null}
      <Typography
        sx={{
          color: theme.palette.text.primary,
          fontSize: '0.95rem',
          fontWeight: 600,
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </Typography>
      {description ? (
        <Typography
          sx={{
            fontSize: '0.8rem',
            lineHeight: 1.55,
            maxWidth: '28ch',
          }}
        >
          {description}
        </Typography>
      ) : null}
      {onRetry || onSecondaryAction ? (
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            justifyContent: 'center',
            mt: '2px',
          }}
        >
          {onRetry ? (
            <ButtonBase
              onClick={onRetry}
              sx={{
                alignItems: 'center',
                border: `1px solid ${alpha(theme.palette.border.main, theme.palette.mode === 'dark' ? 0.34 : 0.2)}`,
                borderRadius: '999px',
                color: theme.palette.text.primary,
                display: 'inline-flex',
                gap: '7px',
                px: 1.6,
                py: 0.8,
                transition:
                  'background-color 140ms ease, border-color 140ms ease, transform 120ms ease',
                '&:hover': {
                  backgroundColor:
                    theme.palette.mode === 'dark'
                      ? alpha(theme.palette.common.white, 0.06)
                      : alpha(theme.palette.text.primary, 0.05),
                  borderColor: alpha(theme.palette.border.main, theme.palette.mode === 'dark' ? 0.5 : 0.3),
                  transform: 'translateY(-1px)',
                },
                '&:active': {
                  transform: 'translateY(0)',
                },
              }}
            >
              <RefreshRoundedIcon sx={{ fontSize: '1rem' }} />
              <Typography sx={{ fontSize: '0.76rem', fontWeight: 700 }}>
                {retryLabel}
              </Typography>
            </ButtonBase>
          ) : null}
          {onSecondaryAction && secondaryActionLabel ? (
            <ButtonBase
              onClick={onSecondaryAction}
              sx={{
                alignItems: 'center',
                border: `1px solid ${alpha(theme.palette.border.main, theme.palette.mode === 'dark' ? 0.22 : 0.14)}`,
                borderRadius: '999px',
                color: theme.palette.text.secondary,
                display: 'inline-flex',
                px: 1.45,
                py: 0.8,
                transition:
                  'background-color 140ms ease, border-color 140ms ease, color 140ms ease, transform 120ms ease',
                '&:hover': {
                  backgroundColor:
                    theme.palette.mode === 'dark'
                      ? alpha(theme.palette.common.white, 0.035)
                      : alpha(theme.palette.text.primary, 0.035),
                  borderColor: alpha(theme.palette.border.main, theme.palette.mode === 'dark' ? 0.34 : 0.2),
                  color: theme.palette.text.primary,
                  transform: 'translateY(-1px)',
                },
                '&:active': {
                  transform: 'translateY(0)',
                },
              }}
            >
              <Typography sx={{ fontSize: '0.74rem', fontWeight: 700 }}>
                {secondaryActionLabel}
              </Typography>
            </ButtonBase>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
};

export const QAppWidgetContainer = ({
  children,
  emptyMessage = 'Nothing to show right now.',
  emptyTitle = 'No items yet',
  error = null,
  errorMessage,
  errorTitle = 'Unable to load this widget',
  hasContent,
  isEmpty = false,
  isLoading = false,
  loadingLabel = 'Loading',
  loadingMessage = 'Pulling the latest public data from the default Qortal node.',
  onRetry,
  onSecondaryAction,
  retryLabel = 'Retry',
  secondaryActionLabel,
  stateVerticalOffset = 0,
}: QAppWidgetContainerProps) => {
  const theme = useTheme();
  const resolvedHasContent = hasContent ?? (!!children && !isEmpty);

  let state: ReactNode = null;

  if (isLoading && !resolvedHasContent) {
    state = (
      <QAppWidgetStatePanel
        description={loadingMessage}
        loadingLabel={loadingLabel}
        retryLabel={retryLabel}
        title={loadingLabel}
        verticalOffset={stateVerticalOffset}
      />
    );
  } else if (error && !resolvedHasContent) {
    state = (
      <QAppWidgetStatePanel
        description={errorMessage !== undefined ? errorMessage : error}
        onRetry={onRetry}
        onSecondaryAction={onSecondaryAction}
        retryLabel={retryLabel}
        secondaryActionLabel={secondaryActionLabel}
        title={errorTitle}
        verticalOffset={stateVerticalOffset}
      />
    );
  } else if (isEmpty) {
    state = (
      <QAppWidgetStatePanel
        description={emptyMessage}
        onRetry={onRetry}
        retryLabel={retryLabel}
        title={emptyTitle}
        verticalOffset={stateVerticalOffset}
      />
    );
  }

  return (
    <Box
      sx={{
        backgroundColor: 'transparent',
        display: 'flex',
        flex: '1 1 auto',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
    >
      {state ? (
        state
      ) : (
        <Box
          sx={{
            display: 'flex',
            flex: '1 1 auto',
            flexDirection: 'column',
            gap: '10px',
            height: '100%',
            minHeight: 0,
            overflow: 'hidden',
            p: '8px',
          }}
        >
          {children}
        </Box>
      )}
    </Box>
  );
};
