import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from '@mui/material';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { userInfoAtom } from '../../atoms/global';
import { appLockedAtom } from '../../atoms/presence';
import {
  APP_BUDGET_NOTICE_AT,
  markAppBudgetNoticeSeen,
  unseenAppBudgetNotices,
  type AppBudget,
} from '../../qortal/appBudgets';
import { QdnSettingsCard } from '../Save/QdnSettingsCard';
import { AppBudgetCard } from './AppBudgetCard';
import { useAppBudgets, useNow } from './useAppBudgets';

/**
 * Says so when an app's budget let many actions through in a day: once a day
 * per app, for the signed-in account, and never while Hub is locked. "See
 * them" opens that budget with its list of actions.
 */
export function AppBudgetNotices() {
  const { t } = useTranslation(['core']);
  const capital = { postProcess: 'capitalizeFirstChar' };
  const address = useAtomValue(userInfoAtom)?.address ?? null;
  const locked = useAtomValue(appLockedAtom);
  const budgets = useAppBudgets(address);
  const now = useNow();
  const next = unseenAppBudgetNotices(budgets)[0] ?? null;
  // What the card says while it slides away.
  const [lastShown, setLastShown] = useState<AppBudget | null>(null);
  useEffect(() => {
    if (next) setLastShown(next);
  }, [next]);
  const [openId, setOpenId] = useState<string | null>(null);
  // The budget's window doesn't stay for another account or a locked Hub.
  useEffect(() => {
    setOpenId(null);
  }, [address]);
  useEffect(() => {
    if (locked) setOpenId(null);
  }, [locked]);

  if (!address) return null;
  const shown = next ?? lastShown;
  const opened = openId ? (budgets.find((b) => b.id === openId) ?? null) : null;
  const seen = () => {
    if (next) markAppBudgetNoticeSeen(address, next.id);
  };

  return (
    <>
      <QdnSettingsCard
        icon={InsightsOutlinedIcon}
        open={!!next && !locked}
        primary={{
          label: t('core:app_budgets.notice.show', capital),
          onClick: () => {
            if (!next) return;
            setOpenId(next.id);
            seen();
          },
        }}
        secondary={{
          label: t('core:app_budgets.notice.dismiss', capital),
          onClick: seen,
        }}
        text={t('core:app_budgets.notice.text', capital)}
        title={t('core:app_budgets.notice.title', {
          name: shown?.name ?? '',
          threshold: APP_BUDGET_NOTICE_AT,
        })}
      />
      <Dialog
        fullWidth
        maxWidth="xs"
        onClose={() => setOpenId(null)}
        open={!!opened && !locked}
      >
        <DialogTitle sx={{ fontSize: 17, fontWeight: 700 }}>
          {t('core:app_budgets.title', capital)}
        </DialogTitle>
        <DialogContent>
          {opened && (
            <AppBudgetCard
              activityOpen
              address={address}
              app={opened}
              budget={opened}
              now={now}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setOpenId(null)}
            sx={{ textTransform: 'none' }}
          >
            {t('core:action.close', capital)}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
