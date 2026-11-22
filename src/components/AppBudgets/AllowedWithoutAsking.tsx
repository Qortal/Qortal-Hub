import {
  alpha,
  Avatar,
  Box,
  Button,
  Collapse,
  IconButton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import AppsRoundedIcon from '@mui/icons-material/AppsRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded';
import type { TFunction } from 'i18next';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  VALID_SESSION_PERMISSIONS,
  allowSessionPermissionAgain,
  revokeSessionPermission,
  turnOffAccountChoice,
  turnOffNotifications,
  turnOnAccountChoice,
  turnOnNotifications,
} from '../../qortal/qortal-requests';
import {
  SESSION_PERMISSIONS_NOT_READ,
  SESSION_PERMISSIONS_REFUSED_WITHOUT,
  SESSION_TWIN,
  isChoiceForApp,
  type AlwaysAllowChoice,
  type StoredChoice,
} from '../../qortal/alwaysAllowChoices';
import type { BudgetApp } from '../../qortal/appBudgets';
import { SidePanelAppIcon } from '../Desktop/SidePanelAppIcon';
import { isolated } from './BudgetActivity';
import {
  useAlwaysAllowChoices,
  useNotificationsChoice,
  useSessionPermissions,
} from './useAllowedWithoutAsking';

const captionSx = { fontSize: 12, fontWeight: 600, mt: 1 } as const;

/**
 * What a session permission lets the app do, in words: the hover text of its
 * chip. Every action Hub grants for a session and reads has its own; anything
 * else is named as the app asked for it.
 */
export function sessionPermissionText(t: TFunction, permission: string) {
  const capital = { postProcess: 'capitalizeFirstChar' };
  return VALID_SESSION_PERMISSIONS.includes(permission) &&
    !SESSION_PERMISSIONS_NOT_READ.has(permission)
    ? t(`core:app_budgets.allowed.session.${permission.toLowerCase()}`, capital)
    : t('core:app_budgets.allowed.session.other', {
        action: permission,
        ...capital,
      });
}

/** A small (i) that explains on hover, focus or tap, like the publish form's. */
function InfoTip({ label, text }: { label: string; text: string }) {
  return (
    <Tooltip
      arrow
      describeChild
      enterDelay={0}
      enterTouchDelay={0}
      placement="top"
      title={text}
    >
      <IconButton
        aria-label={label}
        size="small"
        sx={{ color: 'text.secondary', p: 0.25 }}
      >
        <InfoOutlinedIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Tooltip>
  );
}

/**
 * One thing remembered for the account: allowed, or turned off and still
 * listed so it can be turned on again.
 */
type Row = {
  key: string;
  label: string;
  on: boolean;
  turnOff: () => void;
  turnOn: () => void;
};

function useChoiceLabel() {
  const { t } = useTranslation(['core']);
  // The coin is as the app's request named it.
  return (choice: AlwaysAllowChoice) =>
    t(`core:app_budgets.allowed.kind_${choice.kind}`, {
      coin: isolated(choice.coin ?? ''),
      postProcess: 'capitalizeFirstChar',
    });
}

/** `dense`: the smaller rows of a tile in the other apps' grid. */
function Rows({ dense = false, rows }: { dense?: boolean; rows: Row[] }) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {rows.map((row) => (
        <Box
          component="li"
          data-testid="always-allow-choice"
          key={row.key}
          sx={{
            alignItems: 'center',
            borderTop: `1px solid ${theme.palette.divider}`,
            display: 'flex',
            gap: dense ? 0.5 : 1,
            justifyContent: 'space-between',
            py: dense ? 0.25 : 0.5,
          }}
        >
          <Box
            sx={{
              alignItems: 'baseline',
              display: 'flex',
              gap: 0.75,
              minWidth: 0,
            }}
          >
            <Typography
              sx={{
                color: row.on ? 'text.primary' : 'text.secondary',
                fontSize: dense ? 12.5 : 13,
                minWidth: 0,
              }}
            >
              {row.label}
            </Typography>
            {!row.on && (
              <Typography
                sx={{
                  color: 'text.secondary',
                  flexShrink: 0,
                  fontSize: 11.5,
                  fontWeight: 600,
                }}
              >
                {t('core:app_budgets.allowed.off', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            )}
          </Box>
          <Button
            aria-label={t(
              row.on
                ? 'core:app_budgets.allowed.turn_off_label'
                : 'core:app_budgets.allowed.turn_on_label',
              { what: row.label, postProcess: 'capitalizeFirstChar' }
            )}
            onClick={row.on ? row.turnOff : row.turnOn}
            size="small"
            sx={{
              flexShrink: 0,
              textTransform: 'none',
              ...(dense ? { fontSize: 12, minWidth: 0, px: 0.75, py: 0 } : {}),
            }}
          >
            {t(
              row.on
                ? 'core:app_budgets.allowed.turn_off'
                : 'core:app_budgets.allowed.turn_on',
              { postProcess: 'capitalizeFirstChar' }
            )}
          </Button>
        </Box>
      ))}
    </Box>
  );
}

type AllowedForAppProps = {
  address: string;
  app: BudgetApp;
  /** The tab the app is open in, for its session permissions. */
  tabId: string | null;
};

/**
 * What the app on screen may still do without asking, besides its budget:
 * what the account allowed it for good (the boxes, notifications), and what
 * its tab was allowed until it closes.
 *
 * Turning one of the former off also takes its counterpart out of this tab's
 * session, and a counterpart isn't listed apart while the former is on: the
 * box's own use gives it back (a sign-in gives the tab its look-ups).
 *
 * Nothing turned off leaves the list: a box or the notifications stay with
 * Turn on, and what was taken back from the tab stays, greyed, with Allow
 * again, until the tab closes. A sign-in doesn't hand that back.
 */
export function AllowedForApp({ address, app, tabId }: AllowedForAppProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const capital = { postProcess: 'capitalizeFirstChar' };
  const label = useChoiceLabel();
  // The boxes are kept per name: a Q-App and a website of one name share
  // them. The lists box covers every app, this one too.
  const loaded = useAlwaysAllowChoices(address);
  const notifications = useNotificationsChoice(address, app.name);
  const choices = (loaded ?? []).filter(
    (choice) => choice.app === null || isChoiceForApp(choice, app.name)
  );
  const session = useSessionPermissions(tabId, app.name);
  const muted = { color: theme.palette.text.secondary };

  // `takeBack`: the user took it back here, so it stays listed to allow
  // again. A box's counterpart goes with its box and isn't listed apart.
  const leaveSession = (permission: string | null, takeBack = false) => {
    if (permission && tabId) {
      revokeSessionPermission(tabId, app.name, permission, { takeBack });
    }
  };
  const rows: Row[] = choices.map((choice) => ({
    key: choice.key,
    label: label(choice),
    on: choice.on,
    turnOff: async () => {
      if (await turnOffAccountChoice(address, choice.key)) {
        leaveSession(SESSION_TWIN[choice.kind]);
      }
    },
    turnOn: () => void turnOnAccountChoice(address, choice.key),
  }));
  if (notifications === 'on' || notifications === 'off') {
    rows.push({
      key: 'notifications',
      label: t('core:app_budgets.allowed.kind_notifications', capital),
      on: notifications === 'on',
      turnOff: async () => {
        if (await turnOffNotifications(address, app.name)) {
          leaveSession('NOTIFICATION_PERMISSION');
        }
      },
      turnOn: () => void turnOnNotifications(address, app.name),
    });
  }
  const coveredByRows = new Set<string>(
    choices
      .filter((choice) => choice.on)
      .map((choice) => SESSION_TWIN[choice.kind])
      .filter((permission): permission is string => !!permission)
  );
  if (notifications === 'on') coveredByRows.add('NOTIFICATION_PERMISSION');
  // What the tab may do, and what was taken back from it, in one list;
  // permissions no request reads let nothing through, so they aren't in it.
  const tabOnly = [...new Set([...session.allowed, ...session.takenBack])]
    .filter(
      (permission) =>
        !coveredByRows.has(permission) &&
        !SESSION_PERMISSIONS_NOT_READ.has(permission)
    )
    .sort();
  const isAllowed = (permission: string) =>
    session.allowed.includes(permission);
  // Folded under its count until opened: most people never need the list.
  const [tabListOpen, setTabListOpen] = useState(false);
  const tabListId = useId();
  // Listed once both are read, so a counterpart never shows apart first.
  const ready = loaded !== null && notifications !== null;

  return (
    <Box data-testid="allowed-for-app" sx={{ mt: 1.5 }}>
      <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>
        {t('core:app_budgets.allowed.title', capital)}
      </Typography>
      {ready && rows.length === 0 && tabOnly.length === 0 && (
        <Typography sx={{ ...muted, fontSize: 12.5, mt: 0.25 }}>
          {t('core:app_budgets.allowed.none', capital)}
        </Typography>
      )}
      {ready && rows.length > 0 && (
        <>
          <Typography sx={{ ...captionSx, ...muted }}>
            {t('core:app_budgets.allowed.remembered', capital)}
          </Typography>
          <Rows rows={rows} />
        </>
      )}
      {ready && tabOnly.length > 0 && tabId && (
        <>
          <Box sx={{ alignItems: 'center', display: 'flex', gap: 0.25, mt: 1 }}>
            <Button
              aria-controls={tabListId}
              aria-expanded={tabListOpen}
              endIcon={
                <ExpandMoreRoundedIcon
                  sx={{
                    fontSize: 18,
                    transform: tabListOpen ? 'rotate(180deg)' : 'none',
                    transition: theme.transitions.create('transform'),
                  }}
                />
              }
              onClick={() => setTabListOpen((open) => !open)}
              size="small"
              sx={{
                ...captionSx,
                ...muted,
                minWidth: 0,
                mt: 0,
                px: 0.5,
                textTransform: 'none',
              }}
            >
              {t('core:app_budgets.allowed.until_tab_closes_count', {
                n: tabOnly.length,
                ...capital,
              })}
            </Button>
            <InfoTip
              label={t(
                'core:app_budgets.allowed.until_tab_closes_about',
                capital
              )}
              text={t(
                'core:app_budgets.allowed.until_tab_closes_info',
                capital
              )}
            />
          </Box>
          <Collapse in={tabListOpen} unmountOnExit>
            <Box
              id={tabListId}
              sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.5 }}
            >
              {tabOnly.map((permission) => {
                const allowed = isAllowed(permission);
                return (
                  <Tooltip
                    arrow
                    describeChild
                    enterDelay={0}
                    key={permission}
                    placement="top"
                    title={
                      allowed ? (
                        sessionPermissionText(t, permission)
                      ) : (
                        <>
                          <Box component="span" sx={{ display: 'block' }}>
                            {sessionPermissionText(t, permission)}
                          </Box>
                          <Box
                            component="span"
                            sx={{ display: 'block', mt: 0.5 }}
                          >
                            {t(
                              SESSION_PERMISSIONS_REFUSED_WITHOUT.has(
                                permission
                              )
                                ? 'core:app_budgets.allowed.session_off_refused'
                                : 'core:app_budgets.allowed.session_off',
                              capital
                            )}
                          </Box>
                        </>
                      )
                    }
                  >
                    <Button
                      aria-label={t(
                        allowed
                          ? 'core:app_budgets.allowed.turn_off_label'
                          : 'core:app_budgets.allowed.allow_again_label',
                        { what: permission, ...capital }
                      )}
                      data-state={allowed ? 'on' : 'off'}
                      data-testid="session-permission"
                      endIcon={
                        allowed ? (
                          <CloseRoundedIcon sx={{ fontSize: 15 }} />
                        ) : (
                          <ReplayRoundedIcon sx={{ fontSize: 15 }} />
                        )
                      }
                      onClick={() =>
                        allowed
                          ? leaveSession(permission, true)
                          : tabId &&
                            allowSessionPermissionAgain(
                              tabId,
                              app.name,
                              permission
                            )
                      }
                      size="small"
                      sx={{
                        fontFamily: 'monospace',
                        fontSize: 11.5,
                        py: 0.1,
                        textTransform: 'none',
                        ...(allowed
                          ? {}
                          : { borderStyle: 'dashed', color: 'text.secondary' }),
                      }}
                      variant="outlined"
                    >
                      {permission}
                    </Button>
                  </Tooltip>
                );
              })}
            </Box>
          </Collapse>
        </>
      )}
    </Box>
  );
}

/**
 * The boxes ticked for the other apps, by app, and (with no app on screen)
 * the one that covers every app. Nothing when there are none. Their tabs
 * aren't known here: turning one off leaves the box only.
 */
export function AllowedForOtherApps({
  address,
  except,
  sectionSx,
}: {
  address: string;
  /** The app on screen: its boxes, and the every-app one, are above. */
  except: BudgetApp | null;
  sectionSx: object;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const capital = { postProcess: 'capitalizeFirstChar' };
  const label = useChoiceLabel();
  // Boxes turned off here stay listed, with Turn on, while the panel is open.
  const [turnedOffHere, setTurnedOffHere] = useState<string[]>([]);
  const choices = (useAlwaysAllowChoices(address) ?? []).filter(
    (choice) =>
      (choice.on || turnedOffHere.includes(choice.key)) &&
      (!except || (choice.app !== null && !isChoiceForApp(choice, except.name)))
  );
  if (choices.length === 0) return null;
  const byApp = new Map<string, StoredChoice[]>();
  for (const choice of choices) {
    const name = choice.app ?? '';
    byApp.set(name, [...(byApp.get(name) ?? []), choice]);
  }

  return (
    <Box data-testid="allowed-for-other-apps">
      <Typography component="h3" sx={sectionSx}>
        {t('core:app_budgets.allowed.other_apps', capital)}
      </Typography>
      {/* A small tile per app, two to a row in the panel's width. */}
      <Box
        sx={{
          display: 'grid',
          gap: 0.75,
          gridTemplateColumns: 'repeat(auto-fill, minmax(176px, 1fr))',
        }}
      >
        {[...byApp.entries()].map(([name, appChoices]) => (
          <Box
            aria-label={
              name || t('core:app_budgets.allowed.every_app', capital)
            }
            data-testid="allowed-other-app"
            key={name || '*'}
            role="group"
            sx={{
              backgroundColor: alpha(
                theme.palette.background.elevated ??
                  theme.palette.background.paper,
                0.5
              ),
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: '10px',
              minWidth: 0,
              px: 1,
              py: 0.75,
            }}
          >
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                gap: 0.75,
                mb: 0.5,
                minWidth: 0,
              }}
            >
              {name ? (
                <SidePanelAppIcon name={name} size={20} />
              ) : (
                <Avatar
                  sx={{
                    bgcolor: alpha(theme.palette.text.primary, 0.08),
                    color: 'text.secondary',
                    height: 20,
                    width: 20,
                  }}
                >
                  <AppsRoundedIcon sx={{ fontSize: 14 }} />
                </Avatar>
              )}
              <Typography
                sx={{
                  fontSize: 13,
                  fontWeight: 700,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  unicodeBidi: 'isolate',
                  whiteSpace: 'nowrap',
                }}
              >
                {name || t('core:app_budgets.allowed.every_app', capital)}
              </Typography>
            </Box>
            <Rows
              dense
              rows={appChoices.map((choice) => ({
                key: choice.key,
                label: label(choice),
                on: choice.on,
                turnOff: async () => {
                  if (await turnOffAccountChoice(address, choice.key)) {
                    setTurnedOffHere((keys) =>
                      keys.includes(choice.key) ? keys : [...keys, choice.key]
                    );
                  }
                },
                turnOn: () => void turnOnAccountChoice(address, choice.key),
              }))}
            />
          </Box>
        ))}
      </Box>
    </Box>
  );
}
