import { Box, IconButton, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  deleteAllQortinoChats,
  hasSavedQortinoChats,
} from '../../../qortinoAgent/chatHistoryStore';
import QortinoLlm from '../../../qortinoAgent/qortinoLlm';
import { removeQortinoFromComputer } from '../../../qortinoAgent/removeFromComputer';
import type { QortinoInstallState } from '../../../qortinoAgent/store';
import { executeEvent } from '../../../utils/events';
import { QORTINO_CHATS_CLEARED_EVENT } from './qortinoChatEvents';
import { QortinoModelsSection } from './QortinoModelsSection';
import { QortinoSettingsSection } from './QortinoSettingsSection';

type Props = {
  install: QortinoInstallState;
  onBack: () => void;
  /** Qortino's own model was removed from this computer. */
  onRemoved: () => void;
};

/** Qortino's settings and models, slid over its panel. */
export function QortinoSettingsView({ install, onBack, onRemoved }: Props) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { t } = useTranslation(['core']);
  const [hasChats, setHasChats] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void hasSavedQortinoChats().then((value) => {
      if (!cancelled) setHasChats(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDeleteAllChats = useCallback(async () => {
    await QortinoLlm.cancel().catch(() => undefined);
    const session = await deleteAllQortinoChats();
    executeEvent(QORTINO_CHATS_CLEARED_EVENT, { session });
    setHasChats(false);
  }, []);

  const handleRemoveQortino = useCallback(async () => {
    await QortinoLlm.cancel().catch(() => undefined);
    await removeQortinoFromComputer();
    onRemoved();
  }, [onRemoved]);

  return (
    <Box
      role="dialog"
      aria-label={t('core:qortino_agent.settings.title')}
      sx={{
        background: isDark ? '#0f131b' : '#f5f8fc',
        display: 'flex',
        flexDirection: 'column',
        inset: 0,
        position: 'absolute',
        zIndex: 30,
        '@keyframes qortinoSettingsIn': {
          from: { opacity: 0, transform: 'translateX(28px)' },
          to: { opacity: 1, transform: 'translateX(0)' },
        },
        animation: 'qortinoSettingsIn 170ms ease-out',
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          borderBottom: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
          display: 'flex',
          flexShrink: 0,
          gap: 0.75,
          px: 1,
          py: 1,
        }}
      >
        <IconButton
          aria-label={t('core:qortino_agent.aria.back')}
          autoFocus
          onClick={onBack}
          size="small"
          title={t('core:qortino_agent.aria.back')}
        >
          <ArrowBackRoundedIcon fontSize="small" />
        </IconButton>
        <Typography component="h2" sx={{ fontSize: '1rem', fontWeight: 800 }}>
          {t('core:qortino_agent.settings.title')}
        </Typography>
      </Box>
      <Box
        sx={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          gap: 1.25,
          minHeight: 0,
          overflowY: 'auto',
          p: 1.25,
        }}
      >
        <QortinoModelsSection install={install} onUseQortino={onBack} />
        <QortinoSettingsSection
          install={install}
          hasChats={hasChats}
          onDeleteAllChats={handleDeleteAllChats}
          onRemoveQortino={handleRemoveQortino}
        />
      </Box>
    </Box>
  );
}
