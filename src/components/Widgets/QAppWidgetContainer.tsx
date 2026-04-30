import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { Box, ButtonBase, CircularProgress, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

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
  secondaryActionVariant?: 'button' | 'link';
  stateVerticalOffset?: number | string;
};

export const QAppWidgetStatePanel = ({
  description,
  loadingLabel,
  onRetry,
  onSecondaryAction,
  retryLabel,
  secondaryActionLabel,
  secondaryActionVariant = 'button',
  title,
  verticalOffset = 0,
}: {
  description?: string | null;
  loadingLabel?: string;
  onRetry?: () => void;
  onSecondaryAction?: () => void;
  retryLabel?: string;
  secondaryActionLabel?: string;
  secondaryActionVariant?: 'button' | 'link';
  title: string;
  verticalOffset?: number | string;
}) => {
  const theme = useTheme();
  const { t } = useTranslation('core');
  const resolvedRetryLabel = retryLabel ?? t('widget_container.retry');
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
                {resolvedRetryLabel}
              </Typography>
            </ButtonBase>
          ) : null}
          {onSecondaryAction && secondaryActionLabel ? (
            <ButtonBase
              onClick={onSecondaryAction}
              sx={{
                alignItems: 'center',
                border:
                  secondaryActionVariant === 'button'
                    ? `1px solid ${alpha(theme.palette.border.main, theme.palette.mode === 'dark' ? 0.22 : 0.14)}`
                    : 'none',
                borderRadius:
                  secondaryActionVariant === 'button' ? '999px' : '8px',
                color:
                  secondaryActionVariant === 'button'
                    ? theme.palette.text.secondary
                    : theme.palette.primary.light,
                display: 'inline-flex',
                gap: secondaryActionVariant === 'button' ? 0 : '2px',
                px: secondaryActionVariant === 'button' ? 1.45 : 0.35,
                py: secondaryActionVariant === 'button' ? 0.8 : 0.25,
                transition:
                  'background-color 140ms ease, border-color 140ms ease, color 140ms ease, transform 120ms ease',
                '&:hover': {
                  backgroundColor:
                    secondaryActionVariant === 'button'
                      ? theme.palette.mode === 'dark'
                        ? alpha(theme.palette.common.white, 0.035)
                        : alpha(theme.palette.text.primary, 0.035)
                      : 'transparent',
                  borderColor:
                    secondaryActionVariant === 'button'
                      ? alpha(theme.palette.border.main, theme.palette.mode === 'dark' ? 0.34 : 0.2)
                      : 'transparent',
                  color:
                    secondaryActionVariant === 'button'
                      ? theme.palette.text.primary
                      : theme.palette.primary.main,
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
              {secondaryActionVariant === 'link' ? (
                <ChevronRightRoundedIcon sx={{ fontSize: '1rem' }} />
              ) : null}
            </ButtonBase>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
};

export const QAppWidgetContainer = ({
  children,
  emptyMessage,
  emptyTitle,
  error = null,
  errorMessage,
  errorTitle,
  hasContent,
  isEmpty = false,
  isLoading = false,
  loadingLabel,
  loadingMessage,
  onRetry,
  onSecondaryAction,
  retryLabel,
  secondaryActionLabel,
  secondaryActionVariant = 'button',
  stateVerticalOffset = 0,
}: QAppWidgetContainerProps) => {
  const { t } = useTranslation('core');
  const resolvedRetryLabel = retryLabel ?? t('widget_container.retry');
  const resolvedEmptyTitle = emptyTitle ?? t('widget_container.empty_title');
  const resolvedEmptyMessage =
    emptyMessage === undefined ? t('widget_container.empty_message') : emptyMessage;
  const resolvedErrorTitle = errorTitle ?? t('widget_container.error_title');
  const resolvedLoadingLabel = loadingLabel ?? t('widget_container.loading');
  const resolvedLoadingMessage =
    loadingMessage === undefined ? t('widget_container.loading_message') : loadingMessage;
  const resolvedHasContent = hasContent ?? (!!children && !isEmpty);

  let state: ReactNode = null;

  if (isLoading && !resolvedHasContent) {
    state = (
      <QAppWidgetStatePanel
        description={resolvedLoadingMessage}
        loadingLabel={resolvedLoadingLabel}
        retryLabel={resolvedRetryLabel}
        title={resolvedLoadingLabel}
        verticalOffset={stateVerticalOffset}
      />
    );
  } else if (error && !resolvedHasContent) {
    state = (
      <QAppWidgetStatePanel
        description={errorMessage !== undefined ? errorMessage : error}
        onRetry={onRetry}
        onSecondaryAction={onSecondaryAction}
        retryLabel={resolvedRetryLabel}
        secondaryActionLabel={secondaryActionLabel}
        secondaryActionVariant={secondaryActionVariant}
        title={resolvedErrorTitle}
        verticalOffset={stateVerticalOffset}
      />
    );
  } else if (isEmpty) {
    state = (
      <QAppWidgetStatePanel
        description={resolvedEmptyMessage}
        onRetry={onRetry}
        onSecondaryAction={onSecondaryAction}
        retryLabel={resolvedRetryLabel}
        secondaryActionLabel={secondaryActionLabel}
        secondaryActionVariant={secondaryActionVariant}
        title={resolvedEmptyTitle}
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
