import { useMemo } from 'react';
import { mailsAtom, qMailLastEnteredTimestampAtom } from '../atoms/global';
import { isLessThanOneWeekOld } from './Group/qmailUtils';
import { ButtonBase, Tooltip, useTheme } from '@mui/material';
import { executeEvent } from '../utils/events';
import { Mail } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAtom } from 'jotai';

export const QMailStatus = ({ compact = false }: { compact?: boolean }) => {
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const theme = useTheme();

  const [lastEnteredTimestamp, setLastEnteredTimestamp] = useAtom(
    qMailLastEnteredTimestampAtom
  );
  const [mails, setMails] = useAtom(mailsAtom);

  const hasNewMail = useMemo(() => {
    if (mails?.length === 0) return false;
    const latestMail = mails[0];
    if (!lastEnteredTimestamp && isLessThanOneWeekOld(latestMail?.created))
      return true;
    if (
      lastEnteredTimestamp < latestMail?.created &&
      isLessThanOneWeekOld(latestMail?.created)
    )
      return true;
    return false;
  }, [lastEnteredTimestamp, mails]);

  const button = (
    <ButtonBase
      onClick={() => {
        executeEvent('addTab', { data: { service: 'APP', name: 'q-mail' } });
        executeEvent('open-apps-mode', {});
        setLastEnteredTimestamp(Date.now());
      }}
      style={{
        position: 'relative',
        ...(compact && { width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }),
      }}
    >
      {hasNewMail && (
        <div
          style={{
            backgroundColor: theme.palette.other.unread,
            borderRadius: '50%',
            height: compact ? '10px' : '15px',
            outline: '1px solid white',
            position: 'absolute',
            ...(compact ? { right: 4, top: 4 } : { right: -7, top: -7 }),
            width: compact ? '10px' : '15px',
            zIndex: 1,
          }}
        />
      )}
      <Tooltip
        title={
          <span
            style={{
              color: theme.palette.text.primary,
              fontSize: '14px',
              fontWeight: 700,
              textTransform: 'uppercase',
            }}
          >
            {t('core:q_apps.q_mail', {
              postProcess: 'capitalizeFirstChar',
            })}
          </span>
        }
        placement={compact ? 'bottom' : 'left'}
        arrow
        sx={{ fontSize: compact ? '20' : '24' }}
        slotProps={{
          tooltip: {
            sx: {
              color: theme.palette.text.primary,
              backgroundColor: theme.palette.background.paper,
            },
          },
          arrow: {
            sx: {
              color: theme.palette.text.primary,
            },
          },
        }}
      >
        <Mail
          sx={{
            color: theme.palette.text.secondary,
            fontSize: compact ? 20 : undefined,
          }}
        />
      </Tooltip>
    </ButtonBase>
  );

  if (compact) {
    return (
      <div style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {button}
      </div>
    );
  }
  return button;
};
