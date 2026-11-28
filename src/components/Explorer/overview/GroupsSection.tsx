/**
 * The groups an account is in, as cards: name, open or closed, members,
 * its part (owner, admin) and the group's own description. Listed MINTER
 * first, by name, by members, or its own groups first.
 */
import { useState } from 'react';
import { Box, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import { useTranslation } from 'react-i18next';
import { formatCount } from '../../../lib/explorer/format';
import type { GroupOf } from '../../../lib/explorer/reads';
import {
  GROUP_SORTS,
  isGroupSort,
  sortGroups,
  type GroupSort,
} from '../../../lib/explorer/rules';
import type { ReadState } from '../ExplorerContext';
import {
  cap,
  LoadingLine,
  mutedText,
  panelSx,
  ReadError,
  Section,
  StatusChip,
  tileSx,
} from '../parts';

function GroupCard({ group, address }: { group: GroupOf; address: string }) {
  const { t, i18n } = useTranslation(['explorer']);
  const owner = group.owner === address;
  return (
    <Box
      component="li"
      sx={(theme) => ({
        ...tileSx(theme),
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
      })}
    >
      <Box
        sx={{ alignItems: 'center', display: 'flex', gap: 0.75, minWidth: 0 }}
      >
        <Typography
          component="span"
          sx={{
            fontWeight: 700,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          <bdi dir="auto">
            {group.groupName ||
              t('explorer:groups.unnamed', { id: group.groupId, ...cap })}
          </bdi>
        </Typography>
        {group.isOpen === null ? null : (
          <Tooltip
            title={
              group.isOpen
                ? t('explorer:groups.open', cap)
                : t('explorer:groups.closed', cap)
            }
          >
            <Box
              component="span"
              role="img"
              aria-label={
                group.isOpen
                  ? t('explorer:groups.open', cap)
                  : t('explorer:groups.closed', cap)
              }
              sx={(theme) => ({
                color: mutedText(theme),
                display: 'inline-flex',
              })}
            >
              {group.isOpen ? (
                <PublicRoundedIcon sx={{ fontSize: 16 }} />
              ) : (
                <LockRoundedIcon sx={{ fontSize: 16 }} />
              )}
            </Box>
          </Tooltip>
        )}
      </Box>
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 0.75,
        }}
      >
        {group.memberCount !== null ? (
          <Typography
            component="span"
            variant="body2"
            sx={(theme) => ({ color: mutedText(theme) })}
          >
            {t('explorer:groups.members', {
              count: group.memberCount,
              members: formatCount(group.memberCount, i18n.language),
              ...cap,
            })}
          </Typography>
        ) : null}
        {owner ? (
          <StatusChip kind="owner" label={t('explorer:groups.owner', cap)} />
        ) : null}
        {group.isAdmin ? (
          <StatusChip kind="admin" label={t('explorer:groups.admin', cap)} />
        ) : null}
      </Box>
      {group.description ? (
        <Typography
          variant="body2"
          sx={{
            display: '-webkit-box',
            overflow: 'hidden',
            overflowWrap: 'anywhere',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
          }}
        >
          <bdi dir="auto">{group.description}</bdi>
        </Typography>
      ) : null}
    </Box>
  );
}

export function GroupsSection({
  address,
  read,
}: {
  address: string;
  read: ReadState<GroupOf[]>;
}) {
  const { t } = useTranslation(['core', 'explorer']);
  const [sort, setSort] = useState<GroupSort>('minter');
  const groups = read.data;
  const title = groups
    ? t('explorer:groups.title_count', { n: groups.length, ...cap })
    : t('explorer:groups.title', cap);
  return (
    <Section
      id="explorer-groups"
      title={title}
      action={
        groups && groups.length > 1 ? (
          <TextField
            select
            size="small"
            label={t('explorer:groups.sort', cap)}
            value={sort}
            onChange={(event) => {
              if (isGroupSort(event.target.value)) setSort(event.target.value);
            }}
            sx={{ minWidth: 180 }}
          >
            {GROUP_SORTS.map((option) => (
              <MenuItem key={option} value={option}>
                {t(`explorer:groups.sort_${option}`, cap)}
              </MenuItem>
            ))}
          </TextField>
        ) : null
      }
    >
      {read.status === 'error' ? (
        <Box sx={panelSx}>
          <ReadError
            message={t('explorer:groups.failed', cap)}
            onRetry={read.retry}
          />
        </Box>
      ) : !groups ? (
        <Box sx={panelSx}>
          <LoadingLine label={t('core:loading.generic', cap)} />
        </Box>
      ) : groups.length === 0 ? (
        <Box sx={panelSx}>
          <Typography variant="body2">
            {t('explorer:groups.none', cap)}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ containerType: 'inline-size' }}>
          <Box
            component="ul"
            sx={{
              display: 'grid',
              gap: 1,
              gridTemplateColumns: 'minmax(0, 1fr)',
              listStyle: 'none',
              m: 0,
              p: 0,
              '@container (min-width: 520px)': {
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              },
              '@container (min-width: 820px)': {
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              },
            }}
          >
            {sortGroups(groups, sort, address).map((group) => (
              <GroupCard key={group.groupId} group={group} address={address} />
            ))}
          </Box>
        </Box>
      )}
    </Section>
  );
}
