/**
 * The links to a set: the accounts a sponsor sponsored, and the accounts
 * whose first QORT payment came from an account. Each opens its step (a
 * step on the trail). They sit only in parts a viewer the level 5+ rule
 * lets in sees; the step itself falls back to the account for anyone
 * else (compare/SetStepView).
 */
import { Button } from '@mui/material';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useTranslation } from 'react-i18next';
import { useCompareSteps } from '../compare/compareSteps';
import { useAccountLabel } from '../connections/ConnectionRow';
import { cap, isolate } from '../parts';

const LINK_SX = {
  alignSelf: 'flex-start',
  fontWeight: 600,
  justifyContent: 'flex-start',
  minHeight: 32,
  ml: -0.75,
  textAlign: 'left',
} as const;

/** "The accounts it sponsored" (on its own page), or "The accounts Publisher sponsored". */
export function SponseesLink({
  sponsor,
  own = false,
}: {
  sponsor: string;
  own?: boolean;
}) {
  const { t } = useTranslation(['explorer']);
  const { openSponsees } = useCompareSteps();
  const { label } = useAccountLabel(sponsor, true);
  return (
    <Button
      size="small"
      endIcon={<ChevronRightRoundedIcon />}
      onClick={() => openSponsees(sponsor)}
      sx={LINK_SX}
    >
      {own
        ? t('explorer:sets.link.sponsees_own', cap)
        : t('explorer:sets.link.sponsees', { name: isolate(label), ...cap })}
    </Button>
  );
}

/** "Who got their first QORT payment from this account", or "… from Publisher". */
export function FundedLink({
  payer,
  own = false,
}: {
  payer: string;
  own?: boolean;
}) {
  const { t } = useTranslation(['explorer']);
  const { openFunded } = useCompareSteps();
  const { label } = useAccountLabel(payer, true);
  return (
    <Button
      size="small"
      endIcon={<ChevronRightRoundedIcon />}
      onClick={() => openFunded(payer)}
      sx={LINK_SX}
    >
      {own
        ? t('explorer:sets.link.funded_own', cap)
        : t('explorer:sets.link.funded', { name: isolate(label), ...cap })}
    </Button>
  );
}
