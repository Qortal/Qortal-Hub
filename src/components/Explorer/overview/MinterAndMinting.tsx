/**
 * The Overview's MINTER and Minting sections. MINTER says where the
 * account stands, from the node's own group facts, and opens Q-Mintership,
 * where its MINTER story is kept. Minting says whether it mints right now
 * (the node's list of online reward shares) and with whom, and the last
 * block its keys signed.
 */
import { useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import { useTranslation } from 'react-i18next';
import { executeEvent } from '../../../utils/events';
import { formatCount, formatDay } from '../../../lib/explorer/format';
import {
  lastSignedRead,
  type GroupOf,
  type OnlineShare,
} from '../../../lib/explorer/reads';
import { minterStandingOf, mintingNowOf } from '../../../lib/explorer/rules';
import {
  useExplorer,
  useExplorerRead,
  type ReadState,
} from '../ExplorerContext';
import { AccountRow } from '../ExplorerStart';
import {
  cap,
  LoadingLine,
  mutedText,
  panelSx,
  ReadError,
  Section,
} from '../parts';

/** The official app where MINTER's process and records are kept. */
export const MINTERSHIP_APP = 'Q-Mintership';

export function MinterSection({ read }: { read: ReadState<GroupOf[]> }) {
  const { t } = useTranslation(['core', 'explorer']);
  const { close } = useExplorer();
  const openMintership = () => {
    executeEvent('addTab', {
      data: {
        name: MINTERSHIP_APP,
        navigateIfAlreadyOpen: true,
        service: 'APP',
      },
    });
    executeEvent('open-apps-mode', {});
    close();
  };
  return (
    <Section id="explorer-minter" title={t('explorer:minter.title')}>
      <Box
        sx={(theme) => ({
          ...panelSx(theme),
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        })}
      >
        {read.status === 'error' ? (
          <ReadError
            message={t('explorer:groups.failed', cap)}
            onRetry={read.retry}
          />
        ) : !read.data ? (
          <LoadingLine label={t('core:loading.generic', cap)} />
        ) : (
          <Typography>
            {t(`explorer:minter.standing_${minterStandingOf(read.data)}`, cap)}
          </Typography>
        )}
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {t('explorer:minter.story', { app: MINTERSHIP_APP, ...cap })}
        </Typography>
        <Box>
          <Button
            size="small"
            variant="outlined"
            endIcon={<OpenInNewRoundedIcon />}
            onClick={openMintership}
          >
            {t('explorer:minter.open_app', { app: MINTERSHIP_APP, ...cap })}
          </Button>
        </Box>
      </Box>
    </Section>
  );
}

/** Accounts named in the minting line before "Show all". */
const OTHERS_SHOWN = 5;

function MintingLine({
  address,
  shares,
}: {
  address: string;
  shares: OnlineShare[];
}) {
  const { t } = useTranslation(['explorer']);
  const [all, setAll] = useState(false);
  const minting = mintingNowOf(shares, address);
  if (!minting)
    return <Typography>{t('explorer:minting.not_now', cap)}</Typography>;
  if (!minting.others.length)
    return <Typography>{t('explorer:minting.own_key', cap)}</Typography>;
  const shown = all ? minting.others : minting.others.slice(0, OTHERS_SHOWN);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Typography>
        {minting.self
          ? t('explorer:minting.own_key_and_shares', cap)
          : t('explorer:minting.shares', cap)}
      </Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {shown.map((other) => (
          <li key={other}>
            <AccountRow address={other} fromExplorer />
          </li>
        ))}
      </Box>
      {minting.others.length > OTHERS_SHOWN ? (
        <Box>
          <Button size="small" onClick={() => setAll((open) => !open)}>
            {all
              ? t('explorer:minting.show_fewer', cap)
              : t('explorer:minting.show_all', {
                  count: minting.others.length,
                  ...cap,
                })}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}

function LastSigned({ address }: { address: string }) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const signed = useExplorerRead(lastSignedRead(address));
  if (signed.status === 'error')
    return (
      <ReadError
        message={t('explorer:minting.last_signed_failed', cap)}
        onRetry={signed.retry}
      />
    );
  if (signed.data === undefined)
    return <LoadingLine label={t('core:loading.generic', cap)} />;
  if (signed.data === null)
    return (
      <Typography>{t('explorer:minting.last_signed_none', cap)}</Typography>
    );
  const block = formatCount(signed.data.height, i18n.language);
  return (
    <Typography>
      {signed.data.timestamp
        ? t('explorer:minting.last_signed', {
            date: formatDay(signed.data.timestamp, i18n.language),
            block,
            ...cap,
          })
        : t('explorer:minting.last_signed_block', { block, ...cap })}
    </Typography>
  );
}

export function MintingSection({
  address,
  hasPublicKey,
  online,
}: {
  address: string;
  hasPublicKey: boolean;
  online: ReadState<OnlineShare[]>;
}) {
  const { t } = useTranslation(['core', 'explorer']);
  return (
    <Section id="explorer-minting" title={t('explorer:minting.title', cap)}>
      <Box
        sx={(theme) => ({
          ...panelSx(theme),
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        })}
      >
        {online.status === 'error' ? (
          <ReadError
            message={t('explorer:minting.online_failed', cap)}
            onRetry={online.retry}
          />
        ) : !online.data ? (
          <LoadingLine label={t('core:loading.generic', cap)} />
        ) : (
          <MintingLine address={address} shares={online.data} />
        )}
        {hasPublicKey ? <LastSigned address={address} /> : null}
      </Box>
    </Section>
  );
}
