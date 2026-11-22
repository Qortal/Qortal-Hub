import { useId, useState } from 'react';
import { Box, ButtonBase, Collapse, Typography, useTheme } from '@mui/material';
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import HowToVoteOutlinedIcon from '@mui/icons-material/HowToVoteOutlined';
import { useTranslation } from 'react-i18next';
import { qortText, type AppBudgetAction } from '../../qortal/appBudgets';

export const formatActionTime = (time: number, language: string): string => {
  try {
    return new Intl.DateTimeFormat(language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(time);
  } catch {
    return new Date(time).toLocaleString();
  }
};

const ICONS = {
  publish: CloudUploadOutlinedIcon,
  vote: HowToVoteOutlinedIcon,
  chat: ChatBubbleOutlineRoundedIcon,
};

// Marks that set or end a direction (embeddings, overrides, isolates, and
// the left-to-right, right-to-left and Arabic letter marks).
const DIRECTION_MARKS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * A part the app named (an identifier, a poll, a recipient, a coin) in an
 * isolate of its own, without the direction marks it held: none of them can
 * end the isolate early or turn the words around it.
 */
export const isolated = (text: string | undefined): string =>
  `\u2068${(text ?? '').replace(DIRECTION_MARKS, '')}\u2069`;

type BudgetActivityProps = {
  /** The budget's last actions, oldest first, as saved. */
  actions: AppBudgetAction[];
  defaultOpen?: boolean;
};

/** A budget's last actions, newest first: what each was, when, and its fee. */
export function BudgetActivity({
  actions,
  defaultOpen = false,
}: BudgetActivityProps) {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core']);
  const capital = { postProcess: 'capitalizeFirstChar' };
  const [open, setOpen] = useState(defaultOpen);
  const listId = useId();
  const newestFirst = [...actions].reverse();

  const what = (action: AppBudgetAction) => {
    if (action.kind === 'publish') {
      return t('core:app_budgets.activity.publish', {
        identifier: isolated(action.identifier),
        service: isolated(action.service),
        ...capital,
      });
    }
    if (action.kind === 'vote') {
      return t('core:app_budgets.activity.vote', {
        poll: isolated(action.poll),
        ...capital,
      });
    }
    if (action.groupId !== undefined) {
      return t('core:app_budgets.activity.chat_group', {
        group: action.groupId,
        ...capital,
      });
    }
    return action.recipient
      ? t('core:app_budgets.activity.chat_direct', {
          recipient: isolated(action.recipient),
          ...capital,
        })
      : t('core:app_budgets.activity.chat_direct_unnamed', capital);
  };

  return (
    <Box>
      <ButtonBase
        aria-controls={listId}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        sx={{
          alignItems: 'center',
          borderRadius: '8px',
          color: theme.palette.text.secondary,
          display: 'flex',
          fontSize: 12.5,
          fontWeight: 600,
          gap: 0.5,
          justifyContent: 'flex-start',
          py: 0.25,
        }}
      >
        {t('core:app_budgets.activity.title', {
          total: actions.length,
          ...capital,
        })}
        <ExpandMoreRoundedIcon
          sx={{
            fontSize: 18,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 160ms ease',
          }}
        />
      </ButtonBase>
      <Collapse in={open} unmountOnExit>
        {newestFirst.length === 0 ? (
          <Typography
            id={listId}
            sx={{
              color: theme.palette.text.secondary,
              fontSize: 12.5,
              mt: 0.5,
            }}
          >
            {t('core:app_budgets.activity.none', capital)}
          </Typography>
        ) : (
          <Box
            component="ol"
            id={listId}
            sx={{
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: '10px',
              listStyle: 'none',
              m: 0,
              maxHeight: 260,
              mt: 0.5,
              overflowY: 'auto',
              p: 0,
            }}
          >
            {newestFirst.map((action, index) => {
              const Icon = ICONS[action.kind];
              return (
                <Box
                  component="li"
                  data-testid="budget-activity-item"
                  key={`${action.at}-${index}`}
                  sx={{
                    alignItems: 'flex-start',
                    borderTop:
                      index === 0
                        ? 'none'
                        : `1px solid ${theme.palette.divider}`,
                    display: 'flex',
                    gap: 1,
                    px: 1.25,
                    py: 0.75,
                  }}
                >
                  <Icon
                    aria-hidden
                    sx={{
                      color: theme.palette.text.secondary,
                      flexShrink: 0,
                      fontSize: 17,
                      mt: '2px',
                    }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 13, overflowWrap: 'anywhere' }}>
                      {what(action)}
                    </Typography>
                    <Typography
                      sx={{ color: theme.palette.text.secondary, fontSize: 12 }}
                    >
                      {formatActionTime(action.at, i18n.language)}
                      {' · '}
                      {action.kind === 'chat'
                        ? t('core:app_budgets.activity.no_fee')
                        : t('core:app_budgets.activity.fee', {
                            amount: qortText(action.fee),
                          })}
                    </Typography>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Collapse>
    </Box>
  );
}
