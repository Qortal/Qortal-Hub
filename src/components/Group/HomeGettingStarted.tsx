import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
  useTheme,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { userInfoAtom, balanceAtom } from '../../atoms/global';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import {
  getBaseApiReact,
  getArbitraryEndpointReact,
} from '../../App';

const GET_QORTS_URL = 'https://www.example.com';
const AVATAR_SERVICE = 'THUMBNAIL';
const AVATAR_IDENTIFIER = 'qortal_avatar';
const MIN_BALANCE_FOR_QORTS = 6;

export const HomeGettingStarted = () => {
  const { t } = useTranslation(['tutorial']);
  const theme = useTheme();
  const userInfo = useAtomValue(userInfoAtom);
  const balance = useAtomValue(balanceAtom);

  const [hasAvatar, setHasAvatar] = useState(false);
  const [checkingAvatar, setCheckingAvatar] = useState(false);
  const [openQortsDialog, setOpenQortsDialog] = useState(false);

  const name = userInfo?.name;

  // Step completion flags
  const hasQorts = balance != null && Number(balance) >= MIN_BALANCE_FOR_QORTS;
  const hasName = Boolean(name);
  const hasExplored = false; // always actionable

  // Check avatar existence via API (same approach as MainAvatar)
  const checkAvatar = useCallback(async () => {
    if (!name) return;
    try {
      setCheckingAvatar(true);
      const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=${AVATAR_SERVICE}&identifier=${AVATAR_IDENTIFIER}&limit=1&name=${name}&includemetadata=false&prefix=true`;
      const res = await fetch(url);
      const data = await res.json();
      setHasAvatar(Array.isArray(data) && data.length > 0);
    } catch {
      // leave hasAvatar as false
    } finally {
      setCheckingAvatar(false);
    }
  }, [name]);

  useEffect(() => {
    checkAvatar();
  }, [checkAvatar]);

  // Re-check avatar after a successful upload
  useEffect(() => {
    const onUploaded = () => checkAvatar();
    subscribeToEvent('avatarUploaded', onUploaded);
    return () => unsubscribeFromEvent('avatarUploaded', onUploaded);
  }, [checkAvatar]);

  const completedCount = useMemo(
    () => [hasQorts, hasName, hasAvatar, hasExplored].filter(Boolean).length,
    [hasQorts, hasName, hasAvatar, hasExplored]
  );

  const steps = useMemo(
    () => [
      {
        key: 'get_six_qorts',
        label: t('tutorial:home.get_six_qorts'),
        done: hasQorts,
        onAction: () => setOpenQortsDialog(true),
      },
      {
        key: 'register_name',
        label: t('tutorial:home.register_name'),
        done: hasName,
        onAction: () => executeEvent('openRegisterName', {}),
      },
      {
        key: 'load_avatar',
        label: t('tutorial:home.load_avatar'),
        done: hasAvatar,
        loading: checkingAvatar,
        onAction: () => executeEvent('openAvatarUpload', {}),
      },
      {
        key: 'explore_apps',
        label: t('tutorial:home.explore_apps'),
        done: hasExplored,
        onAction: () => executeEvent('open-apps-mode', {}),
      },
    ],
    [t, hasQorts, hasName, hasAvatar, checkingAvatar, hasExplored]
  );

  return (
    <>
      <Box
        sx={{
          bgcolor: theme.palette.background.paper,
          borderRadius: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          padding: '16px 20px',
          width: '100%',
        }}
      >
        {/* Header */}
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
            mb: '8px',
          }}
        >
          <Typography
            sx={{
              color: theme.palette.text.primary,
              fontSize: '1rem',
              fontWeight: 600,
            }}
          >
            {t('tutorial:home.getting_started')}
          </Typography>
          <Typography
            sx={{ color: theme.palette.text.secondary, fontSize: '0.82rem' }}
          >
            {t('tutorial:home.progress', {
              completed: completedCount,
              total: steps.length,
            })}
          </Typography>
        </Box>

        {/* Steps */}
        {steps.map((step, index) => (
          <Box
            key={step.key}
            sx={{
              alignItems: 'center',
              bgcolor: theme.palette.background.default,
              borderRadius: '8px',
              display: 'flex',
              gap: '12px',
              justifyContent: 'space-between',
              padding: '10px 14px',
            }}
          >
            {/* Step number or check */}
            <Box
              sx={{
                alignItems: 'center',
                color: step.done
                  ? theme.palette.success.main
                  : theme.palette.text.secondary,
                display: 'flex',
                flexShrink: 0,
              }}
            >
              {step.done ? (
                <CheckCircleIcon sx={{ fontSize: '1.2rem' }} />
              ) : (
                <Typography
                  sx={{
                    border: `1px solid ${theme.palette.text.secondary}`,
                    borderRadius: '50%',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    height: '20px',
                    lineHeight: '20px',
                    textAlign: 'center',
                    width: '20px',
                  }}
                >
                  {index + 1}
                </Typography>
              )}
            </Box>

            {/* Label */}
            <Typography
              sx={{
                color: step.done
                  ? theme.palette.text.secondary
                  : theme.palette.text.primary,
                flex: 1,
                fontSize: '0.9rem',
                opacity: step.done ? 0.7 : 1,
              }}
            >
              {step.label}
            </Typography>

            {/* Action button */}
            {step.loading ? (
              <CircularProgress size={20} />
            ) : (
              <Button
                disabled={step.done}
                onClick={step.onAction}
                size="small"
                variant={step.done ? 'text' : 'outlined'}
                sx={{
                  flexShrink: 0,
                  fontSize: '0.78rem',
                  minWidth: '60px',
                  opacity: step.done ? 0.5 : 1,
                }}
              >
                {step.done
                  ? t('tutorial:home.done')
                  : t('tutorial:home.open')}
              </Button>
            )}
          </Box>
        ))}
      </Box>

      {/* Get QORT dialog */}
      <Dialog
        open={openQortsDialog}
        onClose={() => setOpenQortsDialog(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle
          sx={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          {t('tutorial:home.get_six_qorts')}
          <IconButton onClick={() => setOpenQortsDialog(false)} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ height: '70vh', padding: 0 }}>
          <iframe
            src={GET_QORTS_URL}
            style={{ border: 'none', height: '100%', width: '100%' }}
            title={t('tutorial:home.get_six_qorts')}
          />
        </DialogContent>
      </Dialog>
    </>
  );
};
