import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import FlagRoundedIcon from '@mui/icons-material/FlagRounded';
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded';
import { useAtomValue } from 'jotai';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { userInfoAtom } from '../../../atoms/global';
import {
  buildQortinoAnswerReport,
  openQmailTo,
  QORTINO_REPORT_RECIPIENT,
  type QortinoAnswerReport,
} from '../../../qortinoAgent/answerReport';
import { closeQortinoAgentSheet } from '../../../qortinoAgent/qortinoSheetNav';
import { executeEvent } from '../../../utils/events';

type Props = {
  /** The answer being flagged; null when the dialog is closed. */
  report: QortinoAnswerReport | null;
  onClose: () => void;
};

function notify(type: 'success' | 'warning', message: string): void {
  executeEvent('openGlobalSnackBar', {
    type,
    message,
    dismissible: true,
    duration: 7_000,
  });
}

/**
 * Flag a wrong or odd answer: shows what will be sent, copies it, and opens
 * Q-Mail on a new message to Qortal Builders, where the user pastes it and
 * says what was wrong. Q-Mail only sends from a registered name, so an
 * account without one gets the copy alone.
 */
export function QortinoReportDialog({ report, onClose }: Props) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { t } = useTranslation(['core']);
  const userInfo = useAtomValue(userInfoAtom);
  const hasName = Boolean(userInfo?.name);
  const [working, setWorking] = useState(false);
  // The last report shown stays while the dialog fades out.
  const [shown, setShown] = useState<QortinoAnswerReport | null>(report);
  useEffect(() => {
    if (report) setShown(report);
  }, [report]);
  const text = useMemo(
    () => (shown ? buildQortinoAnswerReport(shown, t) : ''),
    [shown, t]
  );

  const copy = async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  const copyAndOpen = async () => {
    if (!report || working) return;
    setWorking(true);
    const copied = await copy();
    onClose();
    setWorking(false);
    // Said first: if Hub cannot open Q-Mail (too many tabs open), its own
    // warning comes after and stays.
    notify(
      copied ? 'success' : 'warning',
      copied
        ? t('core:qortino_agent.report.copied', {
            name: QORTINO_REPORT_RECIPIENT,
          })
        : t('core:qortino_agent.report.copy_failed')
    );
    // Q-Mail's Send button sits where the panel is.
    closeQortinoAgentSheet();
    openQmailTo(QORTINO_REPORT_RECIPIENT);
  };

  const copyOnly = async () => {
    if (!report || working) return;
    setWorking(true);
    const copied = await copy();
    onClose();
    setWorking(false);
    notify(
      copied ? 'success' : 'warning',
      copied
        ? t('core:qortino_agent.report.copied_only')
        : t('core:qortino_agent.report.copy_failed_only')
    );
  };

  return (
    <Dialog
      open={Boolean(report)}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="qortino-report-title"
      aria-describedby="qortino-report-body"
    >
      <DialogTitle
        id="qortino-report-title"
        sx={{
          alignItems: 'center',
          display: 'flex',
          fontWeight: 800,
          gap: 1,
          pb: 0.5,
        }}
      >
        <FlagRoundedIcon sx={{ color: theme.palette.warning.main }} />
        {t('core:qortino_agent.report.title')}
      </DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}
      >
        <Typography
          id="qortino-report-body"
          sx={{ fontSize: '0.88rem', lineHeight: 1.5 }}
        >
          {hasName
            ? t('core:qortino_agent.report.body', {
                name: QORTINO_REPORT_RECIPIENT,
              })
            : t('core:qortino_agent.report.body_no_name', {
                name: QORTINO_REPORT_RECIPIENT,
              })}
        </Typography>
        <Typography
          sx={{
            color: alpha(theme.palette.text.primary, 0.65),
            fontSize: '0.72rem',
            fontWeight: 800,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          {t('core:qortino_agent.report.preview')}
        </Typography>
        <Box
          component="pre"
          data-testid="qortino-report-preview"
          sx={{
            background: alpha(theme.palette.text.primary, isDark ? 0.06 : 0.04),
            border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
            borderRadius: '10px',
            fontFamily: 'inherit',
            fontSize: '0.78rem',
            lineHeight: 1.45,
            m: 0,
            maxHeight: 240,
            overflowY: 'auto',
            p: 1.25,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {text}
        </Box>
      </DialogContent>
      <DialogActions sx={{ pb: 2, px: 3 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>
          {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
        </Button>
        {hasName ? (
          <Button
            autoFocus
            disabled={working}
            onClick={() => void copyAndOpen()}
            startIcon={<MailOutlineRoundedIcon />}
            sx={{ fontWeight: 800, textTransform: 'none' }}
            variant="contained"
          >
            {t('core:qortino_agent.report.open')}
          </Button>
        ) : (
          <Button
            autoFocus
            disabled={working}
            onClick={() => void copyOnly()}
            startIcon={<ContentCopyRoundedIcon />}
            sx={{ fontWeight: 800, textTransform: 'none' }}
            variant="contained"
          >
            {t('core:qortino_agent.report.copy_only')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
