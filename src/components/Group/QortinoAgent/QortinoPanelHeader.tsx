import { Box, IconButton, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CloseFullscreenRoundedIcon from '@mui/icons-material/CloseFullscreenRounded';
import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import qortinoHeadUrl from '../../../assets/svgs/QortinoHead.svg';

type Props = {
  subtitle?: string;
  onClose: () => void;
  onOpenSettings?: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Buttons before the name (the chat list). */
  leading?: ReactNode;
  /** Buttons after the name, before settings (new chat). */
  actions?: ReactNode;
};

/** The top of Qortino's panel: who he is, which model, and the panel's buttons. */
export function QortinoPanelHeader({
  subtitle,
  onClose,
  onOpenSettings,
  expanded,
  onToggleExpanded,
  leading,
  actions,
}: Props) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const isDark = theme.palette.mode === 'dark';
  const expandLabel = expanded
    ? t('core:qortino_agent.aria.narrow')
    : t('core:qortino_agent.aria.widen');

  return (
    <Box
      sx={{
        alignItems: 'center',
        borderBottom: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
        display: 'flex',
        flexShrink: 0,
        gap: 0.5,
        position: 'relative',
        px: 1,
        py: 0.85,
        zIndex: 1,
      }}
    >
      {leading}
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flex: 1,
          gap: 1,
          minWidth: 0,
          pl: leading ? 0.25 : 0.5,
        }}
      >
        <Box
          aria-hidden
          sx={{
            alignItems: 'center',
            background: `radial-gradient(circle at 35% 30%, ${alpha('#7EB6FF', isDark ? 0.32 : 0.26)} 0%, ${alpha('#7EB6FF', 0.06)} 70%)`,
            border: `1px solid ${alpha('#7EB6FF', 0.35)}`,
            borderRadius: '12px',
            display: 'flex',
            flexShrink: 0,
            height: 34,
            justifyContent: 'center',
            width: 34,
          }}
        >
          <Box
            component="img"
            alt=""
            src={qortinoHeadUrl}
            sx={{ height: 24, objectFit: 'contain', width: 24 }}
          />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            component="h2"
            sx={{ fontSize: '0.98rem', fontWeight: 800, lineHeight: 1.2 }}
          >
            {t('core:qortino_agent.name')}
          </Typography>
          {subtitle ? (
            <Typography
              noWrap
              sx={{
                color: alpha(theme.palette.text.primary, 0.62),
                fontSize: '0.72rem',
              }}
              title={subtitle}
            >
              {subtitle}
            </Typography>
          ) : null}
        </Box>
      </Box>
      {actions}
      {onOpenSettings ? (
        <IconButton
          aria-label={t('core:qortino_agent.aria.settings')}
          onClick={onOpenSettings}
          size="small"
          title={t('core:qortino_agent.aria.settings')}
        >
          <TuneRoundedIcon fontSize="small" />
        </IconButton>
      ) : null}
      <IconButton
        aria-label={expandLabel}
        onClick={onToggleExpanded}
        size="small"
        title={expandLabel}
      >
        {expanded ? (
          <CloseFullscreenRoundedIcon fontSize="small" />
        ) : (
          <OpenInFullRoundedIcon fontSize="small" />
        )}
      </IconButton>
      <IconButton
        aria-label={t('core:qortino_agent.aria.close')}
        onClick={onClose}
        size="small"
        title={t('core:qortino_agent.aria.close')}
      >
        <CloseRoundedIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}
