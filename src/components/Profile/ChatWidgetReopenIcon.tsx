import { ButtonBase, Tooltip, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAtom, useAtomValue } from 'jotai';
import { chatWidgetClosedAtom, memberGroupsAtom } from '../../atoms/global';
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded';
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

/** Right-sidebar icon to reopen the chat widget. Subscribes to atoms; only visible when widget is closed and user has groups. */
export function ChatWidgetReopenIcon() {
  const theme = useTheme();
  const { t } = useTranslation(['group']);
  const [chatWidgetClosed, setChatWidgetClosed] = useAtom(chatWidgetClosedAtom);
  const memberGroups = useAtomValue(memberGroupsAtom) ?? [];

  const show =
    chatWidgetClosed && (memberGroups?.length ?? 0) > 0;
  if (!show) return null;

  return (
    <>
      <Spacer height="20px" />
      <ButtonBase
        onClick={() => setChatWidgetClosed(false)}
        aria-label={t('group:group.messaging', {
          postProcess: 'capitalizeFirstChar',
        })}
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
          placement="left"
          arrow
          sx={{ fontSize: '24' }}
          slotProps={tooltipSlotProps(theme)}
        >
          <ChatBubbleOutlineRoundedIcon
            sx={{ color: theme.palette.text.secondary }}
          />
        </Tooltip>
      </ButtonBase>
    </>
  );
}
