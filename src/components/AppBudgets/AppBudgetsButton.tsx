import { useState, type ReactNode } from 'react';
import {
  Box,
  ButtonBase,
  Popover,
  Tooltip,
  alpha,
  useTheme,
  type SxProps,
  type Theme,
} from '@mui/material';
import SavingsOutlinedIcon from '@mui/icons-material/SavingsOutlined';
import { useTranslation } from 'react-i18next';
import {
  budgetState,
  isSameBudgetApp,
  type BudgetApp,
} from '../../qortal/appBudgets';
import { AppBudgetsPanel } from './AppBudgetsPanel';
import { useAppBudgets, useNow } from './useAppBudgets';

type AppBudgetsButtonProps = {
  /** The signed-in account; the button does nothing without one. */
  address: string | null | undefined;
  /** The Q-App or website on screen, when there is one. */
  currentApp: BudgetApp | null;
  buttonSx: SxProps<Theme>;
  tooltipTitle: (text: string) => ReactNode;
  tooltipSlotProps: object;
};

/**
 * The search bar's button for app budgets, always there. A dot shows when the
 * app on screen has a budget that is running.
 */
export function AppBudgetsButton({
  address,
  currentApp,
  buttonSx,
  tooltipTitle,
  tooltipSlotProps,
}: AppBudgetsButtonProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const budgets = useAppBudgets(address);
  // The dot goes when the budget ends, without a request to tell it.
  const now = useNow(60 * 1000);
  const currentBudget = currentApp
    ? budgets.find((budget) => isSameBudgetApp(budget, currentApp))
    : null;
  const hasRunningBudget =
    !!currentBudget && budgetState(currentBudget, now) === 'active';
  const label = t('core:app_budgets.title', {
    postProcess: 'capitalizeFirstChar',
  });
  const open = !!anchorEl && !!address;

  return (
    <>
      <Tooltip
        arrow
        placement="bottom"
        slotProps={tooltipSlotProps}
        title={tooltipTitle(label)}
      >
        <Box component="span" sx={{ display: 'inline-flex' }}>
          <ButtonBase
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label={label}
            data-testid="app-budgets-button"
            disableRipple
            disabled={!address}
            onClick={(event) => setAnchorEl(event.currentTarget)}
            sx={{
              ...(buttonSx as object),
              color: hasRunningBudget
                ? theme.palette.primary.main
                : theme.palette.text.secondary,
              position: 'relative',
            }}
          >
            <SavingsOutlinedIcon
              sx={{ display: 'block', flexShrink: 0, fontSize: 17 }}
            />
            {hasRunningBudget && (
              <Box
                aria-hidden
                data-testid="app-budgets-running"
                sx={{
                  backgroundColor: theme.palette.primary.main,
                  borderRadius: '50%',
                  boxShadow: `0 0 0 2px ${alpha(theme.palette.background.default, 0.9)}`,
                  height: 6,
                  position: 'absolute',
                  right: 3,
                  top: 3,
                  width: 6,
                }}
              />
            )}
          </ButtonBase>
        </Box>
      </Tooltip>
      <Popover
        anchorEl={anchorEl}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        onClose={() => setAnchorEl(null)}
        open={open}
        slotProps={{
          paper: {
            'aria-label': label,
            role: 'dialog',
            sx: {
              backgroundColor: theme.palette.background.paper,
              backgroundImage: 'none',
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: '16px',
              boxShadow: `0 18px 44px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.45 : 0.14)}`,
              maxHeight: 'min(640px, calc(100vh - 96px))',
              mt: 1,
              overflowX: 'hidden',
              overflowY: 'auto',
              p: 2,
              width: 'min(440px, calc(100vw - 32px))',
            },
          } as object,
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
      >
        {address && (
          <AppBudgetsPanel address={address} currentApp={currentApp} />
        )}
      </Popover>
    </>
  );
}
