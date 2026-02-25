import { Avatar, useTheme } from '@mui/material';
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useMemo, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../../App';
import LogoSelected from '../../../assets/svgs/LogoSelected.svg';
import {
  isAppPinnedAtomFamily,
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../../../atoms/global';
import { executeEvent } from '../../../utils/events';
import { saveToLocalStorage } from '../AppsNavBarDesktop';
import { AppRating } from '../AppRating';
import {
  AppCardEnhancedContainer,
  AppCardHeader,
  AppCardHeaderInfo,
  AppCardTitle,
  AppCardDeveloper,
  AppCardDescription,
  AppCardTagsContainer,
  AppCardActions,
  AppButton,
  AppButtonText,
  CategoryChip,
  TagChip,
  AppCircle,
} from '../Apps-styles';

const PINNED_KEY_SEP = '\0';

interface AppCardEnhancedProps {
  app: any;
  myName: string;
  isFromCategory?: boolean;
}

const AppCardEnhancedInner = ({
  app,
  myName,
  isFromCategory = false,
}: AppCardEnhancedProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const isInstalled = app?.status?.status === 'READY';

  const pinnedKey = useMemo(
    () => `${app?.service ?? ''}${PINNED_KEY_SEP}${app?.name ?? ''}`,
    [app?.name, app?.service]
  );
  const isSelectedAppPinned = useAtomValue(isAppPinnedAtomFamily(pinnedKey));
  const setSortablePinnedApps = useSetAtom(sortablePinnedAppsAtom);
  const setSettingsLocalLastUpdated = useSetAtom(settingsLocalLastUpdatedAtom);

  const handleCardClick = useCallback(() => {
    if (isFromCategory) {
      executeEvent('selectedAppInfoCategory', { data: app });
    } else {
      executeEvent('selectedAppInfo', { data: app });
    }
  }, [app, isFromCategory]);

  const handlePinClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const name = app?.name;
      const service = app?.service;
      setSortablePinnedApps((prev) => {
        const isPinned = !!prev?.find(
          (item) => item?.name === name && item?.service === service
        );
        const updatedApps = isPinned
          ? prev.filter(
              (item) => !(item?.name === name && item?.service === service)
            )
          : [...(prev ?? []), { name, service }];
        saveToLocalStorage(
          'ext_saved_settings',
          'sortablePinnedApps',
          updatedApps
        );
        return updatedApps;
      });
      setSettingsLocalLastUpdated(Date.now());
    },
    [
      app?.name,
      app?.service,
      setSortablePinnedApps,
      setSettingsLocalLastUpdated,
    ]
  );

  const handleOpenClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      executeEvent('addTab', { data: app });
    },
    [app]
  );

  const truncatedDescription = useMemo(() => {
    const desc = app?.metadata?.description;
    if (!desc)
      return t('core:message.generic.no_description', {
        postProcess: 'capitalizeFirstChar',
      });
    return desc.length > 100 ? `${desc.substring(0, 100)}...` : desc;
  }, [app?.metadata?.description, t]);

  const tags = useMemo((): string[] => {
    const rawTags = app?.metadata?.tags;
    if (!rawTags) return [];
    if (typeof rawTags === 'string')
      return rawTags
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
        .slice(0, 3);
    return Array.isArray(rawTags) ? rawTags.slice(0, 3) : [];
  }, [app?.metadata?.tags]);

  return (
    <AppCardEnhancedContainer onClick={handleCardClick}>
      <AppCardHeader>
        <AppCircle
          sx={{
            border: 'none',
            height: '60px',
            width: '60px',
            flexShrink: 0,
          }}
        >
          <Avatar
            sx={{
              height: '40px',
              width: '40px',
              '& img': {
                objectFit: 'fill',
              },
            }}
            alt={app?.name}
            src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${app?.name}/qortal_avatar?async=true`}
          >
            <img
              style={{
                width: '28px',
                height: 'auto',
              }}
              src={LogoSelected}
              alt="app-icon"
            />
          </Avatar>
        </AppCircle>

        <AppCardHeaderInfo>
          <AppCardTitle>{app?.metadata?.title || app?.name}</AppCardTitle>
          <AppCardDeveloper>
            {t('core:app_detail.by_developer', {
              developer: app?.name,
              postProcess: 'capitalizeFirstChar',
              defaultValue: 'by @{{developer}}',
            })}
          </AppCardDeveloper>
          <AppRating app={app} myName={myName} />
        </AppCardHeaderInfo>
      </AppCardHeader>

      <AppCardDescription>{truncatedDescription}</AppCardDescription>

      <AppCardTagsContainer>
        {app?.metadata?.categoryName && (
          <CategoryChip
            label={app.metadata.categoryName}
            size="small"
            onClick={(e) => e.stopPropagation()}
          />
        )}
        {tags.map((tag: string, index: number) => (
          <TagChip
            key={`${tag}-${index}`}
            label={tag}
            size="small"
            onClick={(e) => e.stopPropagation()}
          />
        ))}
      </AppCardTagsContainer>

      <AppCardActions>
        <AppButton
          onClick={handlePinClick}
          sx={{
            backgroundColor: theme.palette.background.default,
            opacity: isSelectedAppPinned ? 0.6 : 1,
          }}
        >
          <AppButtonText>
            {isSelectedAppPinned
              ? t('core:action.unpin', { postProcess: 'capitalizeFirstChar' })
              : t('core:action.pin', { postProcess: 'capitalizeFirstChar' })}
          </AppButtonText>
        </AppButton>

        <AppButton
          onClick={handleOpenClick}
          sx={{
            backgroundColor: isInstalled
              ? theme.palette.primary.main
              : theme.palette.background.default,
            color: isInstalled
              ? theme.palette.primary.contrastText
              : theme.palette.text.primary,
          }}
        >
          <AppButtonText>
            {isInstalled
              ? t('core:action.open', { postProcess: 'capitalizeFirstChar' })
              : t('core:action.download', {
                  postProcess: 'capitalizeFirstChar',
                })}
          </AppButtonText>
        </AppButton>
      </AppCardActions>
    </AppCardEnhancedContainer>
  );
};

export const AppCardEnhanced = memo(AppCardEnhancedInner);
