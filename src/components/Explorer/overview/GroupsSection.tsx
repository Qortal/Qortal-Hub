/**
 * The groups an account is in, as cards: the group's avatar and name, open
 * or closed, members, its part (owner, admin) and the group's own
 * description. Listed MINTER first, by name, by members, or its own groups
 * first. MINTER's card has an (i) saying what MINTER is. Past 25, the first
 * 25 of that order show until "Show all". The step keeps the order and the
 * fold, for Back and Forward.
 *
 * For anyone signed in (not only a viewer the level 5+ rule lets in), a
 * group the Hub account isn't in has Join, "Ask to join" for a closed one
 * (not on Qortal's own groups, MINTER and the dev group). It opens Hub's
 * own join window over the Explorer, which shows the group, asks for the
 * fee and sends the join: the Explorer signs and sends nothing
 * (lib/explorer/groupJoin.ts says what each card offers). Which groups the
 * account is in comes from the read the level 5+ rule already makes, and
 * Hub's own state says what it sent and where the account is now.
 *
 * A card's picture, under its owner's name as the node sends it with the
 * group, is read only once the card nears the screen; until the picture is
 * in, and for good when there is none, it shows the group's initial.
 */
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import GroupAddRoundedIcon from '@mui/icons-material/GroupAddRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import HourglassTopRoundedIcon from '@mui/icons-material/HourglassTopRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../../App';
import { memberGroupsAtom, txListAtom } from '../../../atoms/global';
import { formatCount } from '../../../lib/explorer/format';
import {
  groupAvatarPath,
  groupIdsOf,
  groupInitial,
  joinOfferFor,
  joinsSentOf,
  type JoinContext,
  type JoinOffer,
  type JoinSent,
} from '../../../lib/explorer/groupJoin';
import {
  groupsOfRead,
  MINTER_GROUP_ID,
  type GroupOf,
} from '../../../lib/explorer/reads';
import {
  GROUP_SORTS,
  isGroupSort,
  sortGroups,
  type GroupSort,
} from '../../../lib/explorer/rules';
import { executeEvent } from '../../../utils/events';
import {
  useExplorer,
  useExplorerRead,
  useNearScreen,
  useStepState,
  type ReadState,
} from '../ExplorerContext';
import { MINTERSHIP_APP } from './MinterAndMinting';
import {
  cap,
  isolate,
  LoadingLine,
  mutedText,
  panelSx,
  ReadError,
  Section,
  StatusChip,
  tileSx,
} from '../parts';

const AVATAR_SIZE = 32;

/**
 * The group's initial (a groups icon for a name with none), and its
 * picture over it once the picture has loaded: never a broken image.
 * Hidden from screen readers: the group's name is beside it.
 */
function AvatarCircle({
  src,
  initial,
}: {
  src: string | null;
  initial: string | null;
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>(
    'loading'
  );
  const picture = src !== null && state !== 'failed';
  const loaded = picture && state === 'loaded';
  return (
    <Box
      component="span"
      aria-hidden
      data-avatar={loaded ? 'picture' : 'initial'}
      sx={(theme) => ({
        alignItems: 'center',
        backgroundColor: alpha(theme.palette.primary.main, 0.22),
        borderRadius: '50%',
        color: 'text.primary',
        display: 'inline-flex',
        flexShrink: 0,
        fontSize: AVATAR_SIZE * 0.42,
        fontWeight: 600,
        height: AVATAR_SIZE,
        justifyContent: 'center',
        lineHeight: 1,
        overflow: 'hidden',
        position: 'relative',
        width: AVATAR_SIZE,
      })}
    >
      {loaded ? null : (initial ?? <GroupsRoundedIcon sx={{ fontSize: 18 }} />)}
      {picture ? (
        <Box
          component="img"
          src={src}
          alt=""
          draggable={false}
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
          sx={{
            height: '100%',
            inset: 0,
            objectFit: 'cover',
            opacity: loaded ? 1 : 0,
            position: 'absolute',
            width: '100%',
          }}
        />
      ) : null}
    </Box>
  );
}

/**
 * A group's avatar: the THUMBNAIL its owner published for it, under the
 * owner's name as the node sends it with the group (none for an owner
 * without a name), loaded once the card is near.
 */
function GroupAvatar({ group, near }: { group: GroupOf; near: boolean }) {
  const name = group.ownerName ?? null;
  const path = near && name ? groupAvatarPath(name, group.groupId) : null;
  const src = path ? `${getBaseApiReact()}${path}` : null;
  // Another picture starts again from the initial.
  return (
    <AvatarCircle
      key={src ?? ''}
      src={src}
      initial={groupInitial(group.groupName)}
    />
  );
}

const SENT_WORDS: Record<
  Exclude<JoinSent, 'changed'>,
  { text: string; named: string }
> = {
  joining: {
    text: 'explorer:groups.joining',
    named: 'explorer:groups.joining_named',
  },
  asked: {
    text: 'explorer:groups.asked',
    named: 'explorer:groups.asked_named',
  },
};

/**
 * Join (Ask to join for a closed group), which opens Hub's own join window
 * for the group; once Hub has sent it, what was sent, in the same place.
 */
function JoinControl({
  groupId,
  label,
  offer,
}: {
  groupId: number;
  label: string;
  offer: JoinOffer;
}) {
  const { t } = useTranslation(['explorer']);
  if (!offer || offer.kind === 'unknown') return null;
  const sent = offer.kind !== 'join';
  const words =
    offer.kind !== 'join'
      ? SENT_WORDS[offer.kind]
      : offer.closed
        ? { text: 'explorer:groups.ask', named: 'explorer:groups.ask_named' }
        : { text: 'explorer:groups.join', named: 'explorer:groups.join_named' };
  return (
    // One button throughout: when Hub has sent the join, it stays where it
    // was (only saying so), so a keyboard's focus stays on it too.
    <Button
      size="small"
      variant="outlined"
      aria-disabled={sent || undefined}
      aria-label={t(words.named, { group: isolate(label) })}
      disableRipple={sent}
      startIcon={sent ? <HourglassTopRoundedIcon /> : <GroupAddRoundedIcon />}
      onClick={
        sent
          ? undefined
          : () =>
              executeEvent('globalActionJoinGroup', {
                groupId: String(groupId),
              })
      }
      sx={(theme) => ({
        flexShrink: 0,
        whiteSpace: 'nowrap',
        ...(sent
          ? {
              borderColor: theme.palette.divider,
              color: mutedText(theme),
              cursor: 'default',
              '&:hover': {
                backgroundColor: 'transparent',
                borderColor: theme.palette.divider,
              },
            }
          : {}),
      })}
    >
      {t(words.text, cap)}
    </Button>
  );
}

/**
 * What MINTER is, on its card: an (i) the keyboard reaches, its words on
 * hover and focus, and read out as its label.
 */
function MinterInfo() {
  const { t } = useTranslation(['explorer']);
  const words = t('explorer:groups.minter_info', {
    app: MINTERSHIP_APP,
    ...cap,
  });
  return (
    <Tooltip title={words}>
      <Box
        component="span"
        tabIndex={0}
        role="img"
        aria-label={words}
        sx={(theme) => ({
          color: mutedText(theme),
          display: 'inline-flex',
          flexShrink: 0,
          '&:focus-visible': {
            borderRadius: '50%',
            outline: `2px solid ${theme.palette.primary.main}`,
          },
        })}
      >
        <InfoOutlinedIcon sx={{ fontSize: 16 }} />
      </Box>
    </Tooltip>
  );
}

function GroupCard({
  group,
  address,
  offer,
}: {
  group: GroupOf;
  address: string;
  offer: JoinOffer;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const [node, setNode] = useState<HTMLElement | null>(null);
  const near = useNearScreen(node);
  const owner = group.owner === address;
  const label =
    group.groupName ||
    t('explorer:groups.unnamed', { id: group.groupId, ...cap });
  return (
    <Box
      component="li"
      ref={setNode}
      sx={(theme) => ({
        ...tileSx(theme),
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
      })}
    >
      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1, minWidth: 0 }}>
        <GroupAvatar group={group} near={near} />
        {/* Join goes under the name when the two don't fit on one line. */}
        <Box
          sx={{
            alignItems: 'center',
            columnGap: 1,
            display: 'flex',
            flex: '1 1 0',
            flexWrap: 'wrap',
            minWidth: 0,
            rowGap: 0.5,
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flex: '1 1 auto',
              gap: 0.75,
              minWidth: 0,
            }}
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
              <bdi dir="auto">{label}</bdi>
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
            {group.groupId === MINTER_GROUP_ID ? <MinterInfo /> : null}
          </Box>
          <JoinControl groupId={group.groupId} label={label} offer={offer} />
        </Box>
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

/** Shown before "Show all": the rest aren't drawn, nor read, until then. */
const GROUPS_SHOWN = 25;

export function GroupsSection({
  address,
  read,
}: {
  address: string;
  read: ReadState<GroupOf[]>;
}) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const { viewer } = useExplorer();
  // The order and the fold are kept with the step, so Back and Forward show
  // the page as it was left; another account starts at MINTER first, folded.
  const [sort, setSort] = useStepState<GroupSort>('groups:sort', 'minter');
  const [all, setAll] = useStepState('groups:all', false);
  const listId = useId();
  const showAll = useRef<HTMLButtonElement>(null);
  // Show fewer: the focus stays on the button, brought into view, so a long
  // list folding away doesn't leave the page far below it.
  const folded = useRef(false);
  useLayoutEffect(() => {
    if (all || !folded.current) return;
    folded.current = false;
    showAll.current?.focus({ preventScroll: true });
    showAll.current?.scrollIntoView?.({ block: 'nearest' });
  }, [all]);
  // The signed-in account's groups: the read the level 5+ rule makes,
  // through the cache.
  const mine = useExplorerRead(viewer ? groupsOfRead(viewer) : null);
  const hubGroups = useAtomValue(memberGroupsAtom);
  const records = useAtomValue(txListAtom);
  const context = useMemo<JoinContext>(
    () => ({
      viewer,
      viewerGroups: mine.data ? groupIdsOf(mine.data) : undefined,
      hubGroups: groupIdsOf(hubGroups),
      sent: viewer ? joinsSentOf(records, viewer) : new Map(),
    }),
    [viewer, mine.data, hubGroups, records]
  );
  const groups = read.data;
  // The chosen order over all of them first, then the first ones of it.
  const ordered = groups ? sortGroups(groups, sort, address) : [];
  const shown = all ? ordered : ordered.slice(0, GROUPS_SHOWN);
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
        <Box
          sx={{
            containerType: 'inline-size',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          {/* Which ones the account is in couldn't be read: no Join. */}
          {mine.status === 'error' ? (
            <Box sx={tileSx}>
              <ReadError
                message={t('explorer:groups.membership_failed', cap)}
                onRetry={mine.retry}
              />
            </Box>
          ) : null}
          <Box
            component="ul"
            id={listId}
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
            {shown.map((group) => (
              <GroupCard
                key={group.groupId}
                group={group}
                address={address}
                offer={joinOfferFor(group, context)}
              />
            ))}
          </Box>
          {groups.length > GROUPS_SHOWN ? (
            <Button
              ref={showAll}
              size="small"
              aria-expanded={all}
              aria-controls={listId}
              onClick={() => {
                folded.current = all;
                setAll(!all);
              }}
              sx={{ alignSelf: 'flex-start' }}
            >
              {all
                ? t('explorer:groups.show_fewer', cap)
                : t('explorer:groups.show_all', {
                    count: groups.length,
                    shown: formatCount(groups.length, i18n.language),
                    ...cap,
                  })}
            </Button>
          ) : null}
        </Box>
      )}
    </Section>
  );
}
