import { ButtonBase, Tooltip, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAtom, useAtomValue } from 'jotai';
import { chatWidgetClosedAtom, memberGroupsAtom } from '../../atoms/global';
import MoreRoundedIcon from '@mui/icons-material/MoreRounded';
import { Spacer } from '../../common/Spacer';

const tooltipSlotProps = (theme: any) => ({
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
});

export function ChatWidgetReopenIcon({
  inTitleBar = false,
  buttonSx = undefined,
  iconSx = undefined,
}: {
  inTitleBar?: boolean;
  buttonSx?: any;
  iconSx?: any;
} = {}) {
  const theme = useTheme();
  const { t } = useTranslation(['group']);
  const [chatWidgetClosed, setChatWidgetClosed] = useAtom(chatWidgetClosedAtom);
  const memberGroups = useAtomValue(memberGroupsAtom) ?? [];

  const show =
    chatWidgetClosed && (memberGroups?.length ?? 0) > 0;
  if (!show) return null;

  const icon = (
    <ButtonBase
      onClick={() => setChatWidgetClosed(false)}
      aria-label={t('group:group.messaging', {
        postProcess: 'capitalizeFirstChar',
      })}
      sx={{
        ...(inTitleBar
          ? {
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 1,
            }
          : {}),
        ...(buttonSx || {}),
      }}
    >
      <Tooltip
        title={
          <span
            style={{
              fontSize: '14px',
              fontWeight: 700,
              textTransform: 'uppercase',
            }}
          >
            {t('group:group.messaging', {
              postProcess: 'capitalizeFirstChar',
            })}
          </span>
        }
        placement={inTitleBar ? 'bottom' : 'left'}
        arrow
        sx={{ fontSize: inTitleBar ? '20' : '24' }}
        slotProps={tooltipSlotProps(theme)}
        >
          <MoreRoundedIcon
          sx={{
            color: theme.palette.text.secondary,
            fontSize: inTitleBar ? 20 : undefined,
            ...(iconSx || {}),
          }}
        />
      </Tooltip>
    </ButtonBase>
  );

  if (inTitleBar) {
    return icon;
  }
  return (
    <>
      <Spacer height="20px" />
      {icon}
    </>
  );
}
