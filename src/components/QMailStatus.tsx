import { useMemo } from 'react';
import { useRecoilState } from 'recoil';
import { mailsAtom, qMailLastEnteredTimestampAtom } from '../atoms/global';
import { isLessThanOneWeekOld } from './Group/QMailMessages';
import { ButtonBase, Tooltip, useTheme } from '@mui/material';
import { executeEvent } from '../utils/events';
import { Mail } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

export const QMailStatus = () => {
  const { t } = useTranslation(['core']);
  const theme = useTheme();

  const [lastEnteredTimestamp, setLastEnteredTimestamp] = useRecoilState(
    qMailLastEnteredTimestampAtom
  );
  const [mails, setMails] = useRecoilState(mailsAtom);

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

  return (
    <ButtonBase
      onClick={() => {
        executeEvent('addTab', { data: { service: 'APP', name: 'q-mail' } });
        executeEvent('open-apps-mode', {});
        setLastEnteredTimestamp(Date.now());
      }}
      style={{
        position: 'relative',
      }}
    >
      {hasNewMail && (
        <div
          style={{
            backgroundColor: theme.palette.other.unread,
            borderRadius: '50%',
            height: '15px',
            outline: '1px solid white',
            position: 'absolute',
            right: '-7px',
            top: '-7px',
            width: '15px',
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
            {t('core:q_mail', {
              postProcess: 'capitalize',
            })}
          </span>
        }
        placement="left"
        arrow
        sx={{ fontSize: '24' }}
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
          }}
        />
      </Tooltip>
    </ButtonBase>
  );
};
