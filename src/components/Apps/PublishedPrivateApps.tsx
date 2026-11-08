import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import LockIcon from '@mui/icons-material/Lock';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../App';
import { memberGroupsAtom } from '../../atoms/global';
import { useHandlePrivateApps } from '../../hooks/useHandlePrivateApps';
import { formatTimestamp } from '../../utils/time';
import {
  buildMyPrivateAppsSearchUrl,
  PublishedPrivateApp,
  toPublishedPrivateApps,
} from './privateAppMetadata';
import { EmptyStateBox, SectionTitle } from './AppsLibrary/LibraryTab-styles';

interface PublishedPrivateAppsProps {
  myAddress: string;
  refreshKey?: number;
}

export const PublishedPrivateApps = ({
  myAddress,
  refreshKey = 0,
}: PublishedPrivateAppsProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core', 'group']);
  const { openApp } = useHandlePrivateApps();
  const memberGroups = useAtomValue(memberGroupsAtom);
  const [apps, setApps] = useState<PublishedPrivateApp[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  const groupNames = useMemo(() => {
    const map = new Map<number, string>();
    (memberGroups ?? []).forEach((group) => {
      if (group?.groupId != null && group?.groupName) {
        map.set(Number(group.groupId), group.groupName);
      }
    });
    return map;
  }, [memberGroups]);

  const loadApps = useCallback(async () => {
    if (!myAddress) {
      setApps([]);
      return;
    }
    setIsLoading(true);
    setHasError(false);
    try {
      const namesResponse = await fetch(
        `${getBaseApiReact()}/names/address/${myAddress}?limit=0`
      );
      const namesData = await namesResponse.json();
      const names: string[] = Array.isArray(namesData)
        ? namesData.map((item) => item?.name).filter(Boolean)
        : [];
      if (!names.length) {
        setApps([]);
        return;
      }
      const response = await fetch(
        buildMyPrivateAppsSearchUrl(getBaseApiReact(), names)
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setApps(toPublishedPrivateApps(await response.json()));
    } catch (error) {
      console.error(error);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, [myAddress]);

  useEffect(() => {
    loadApps();
  }, [loadApps, refreshKey]);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        width: '100%',
        maxWidth: '720px',
      }}
    >
      <SectionTitle>
        <LockIcon sx={{ fontSize: '20px' }} />
        {t('core:private_apps.published_title', {
          postProcess: 'capitalizeFirstChar',
        })}

        <Tooltip
          title={t('core:action.refresh', {
            postProcess: 'capitalizeFirstChar',
          })}
        >
          <span>
            <IconButton
              aria-label={t('core:action.refresh', {
                postProcess: 'capitalizeFirstChar',
              })}
              disabled={isLoading}
              onClick={loadApps}
              size="small"
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </SectionTitle>

      <Typography
        sx={{ color: theme.palette.text.secondary, fontSize: '13px' }}
      >
        {t('core:private_apps.listing_hint', {
          postProcess: 'capitalizeFirstChar',
        })}
      </Typography>

      {isLoading && (
        <Box
          sx={{ display: 'flex', justifyContent: 'center', padding: '16px' }}
        >
          <CircularProgress size={24} />
        </Box>
      )}

      {!isLoading && hasError && (
        <Typography sx={{ color: theme.palette.error.main }}>
          {t('core:private_apps.load_error', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
      )}

      {!isLoading && !hasError && apps.length === 0 && (
        <EmptyStateBox>
          <LockIcon sx={{ fontSize: '48px', color: 'text.disabled', mb: 2 }} />
          <Typography
            sx={{ fontSize: '16px', color: theme.palette.text.secondary }}
          >
            {t('core:private_apps.empty', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </EmptyStateBox>
      )}

      {!isLoading &&
        !hasError &&
        apps.map((app) => (
          <Box
            key={`${app.name}/${app.service}/${app.identifier}`}
            sx={{
              alignItems: 'center',
              backgroundColor: theme.palette.background.paper,
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: '12px',
              display: 'flex',
              gap: '12px',
              padding: '12px 16px',
            }}
          >
            <LockIcon sx={{ color: theme.palette.text.secondary }} />

            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography noWrap sx={{ fontWeight: 600 }}>
                {app.identifier}
              </Typography>

              <Typography
                noWrap
                sx={{ color: theme.palette.text.secondary, fontSize: '13px' }}
              >
                {t('core:private_apps.details', {
                  name: app.name,
                  group:
                    groupNames.get(app.groupId) ??
                    t('core:private_apps.group_id', { groupId: app.groupId }),
                  postProcess: 'capitalizeFirstChar',
                })}
                {app.timestamp ? ` · ${formatTimestamp(app.timestamp)}` : ''}
              </Typography>
            </Box>

            <Button
              variant="contained"
              size="small"
              onClick={() =>
                openApp(
                  {
                    name: app.name,
                    service: app.service,
                    identifier: app.identifier,
                    groupId: app.groupId,
                  },
                  true,
                  undefined
                )
              }
            >
              {t('core:action.open', { postProcess: 'capitalizeFirstChar' })}
            </Button>
          </Box>
        ))}
    </Box>
  );
};
