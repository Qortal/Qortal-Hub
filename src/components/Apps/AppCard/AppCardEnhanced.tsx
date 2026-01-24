import { Avatar, ButtonBase, useTheme } from '@mui/material';
import { useAtom, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../../App';
import LogoSelected from '../../../assets/svgs/LogoSelected.svg';
import {
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
  AppDownloadButton,
  AppDownloadButtonText,
  CategoryChip,
  TagChip,
  AppCircle,
} from '../Apps-styles';

interface AppCardEnhancedProps {
  app: any;
  myName: string;
  isFromCategory?: boolean;
}

export const AppCardEnhanced = ({
  app,
  myName,
  isFromCategory = false,
}: AppCardEnhancedProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const isInstalled = app?.status?.status === 'READY';

  const [sortablePinnedApps, setSortablePinnedApps] = useAtom(
    sortablePinnedAppsAtom
  );
  const setSettingsLocalLastUpdated = useSetAtom(settingsLocalLastUpdatedAtom);

  const isSelectedAppPinned = !!sortablePinnedApps?.find(
    (item) => item?.name === app?.name && item?.service === app?.service
  );

  const handleCardClick = () => {
    if (isFromCategory) {
      executeEvent('selectedAppInfoCategory', { data: app });
    } else {
      executeEvent('selectedAppInfo', { data: app });
    }
  };

  const handlePinClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSortablePinnedApps((prev) => {
      let updatedApps;

      if (isSelectedAppPinned) {
        updatedApps = prev.filter(
          (item) =>
            !(item?.name === app?.name && item?.service === app?.service)
        );
      } else {
        updatedApps = [
          ...prev,
          {
            name: app?.name,
            service: app?.service,
          },
        ];
      }

      saveToLocalStorage('ext_saved_settings', 'sortablePinnedApps', updatedApps);
      return updatedApps;
    });
    setSettingsLocalLastUpdated(Date.now());
  };

  const handleOpenClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    executeEvent('addTab', { data: app });
  };

  // Truncate description to 100 characters
  const truncatedDescription = app?.metadata?.description
    ? app.metadata.description.length > 100
      ? `${app.metadata.description.substring(0, 100)}...`
      : app.metadata.description
    : t('core:message.generic.no_description', {
        postProcess: 'capitalizeFirstChar',
      });

  // Get tags (max 3)
  const tags = app?.metadata?.tags?.slice(0, 3) || [];

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
        <AppDownloadButton
          onClick={handlePinClick}
          sx={{
            backgroundColor: theme.palette.background.default,
            opacity: isSelectedAppPinned ? 0.6 : 1,
          }}
        >
          <AppDownloadButtonText>
            {isSelectedAppPinned
              ? t('core:action.unpin', { postProcess: 'capitalizeFirstChar' })
              : t('core:action.pin', { postProcess: 'capitalizeFirstChar' })}
          </AppDownloadButtonText>
        </AppDownloadButton>

        <AppDownloadButton
          onClick={handleOpenClick}
          sx={{
            backgroundColor: isInstalled
              ? theme.palette.primary.main
              : theme.palette.background.default,
          }}
        >
          <AppDownloadButtonText>
            {isInstalled
              ? t('core:action.open', { postProcess: 'capitalizeFirstChar' })
              : t('core:action.download', {
                  postProcess: 'capitalizeFirstChar',
                })}
          </AppDownloadButtonText>
        </AppDownloadButton>
      </AppCardActions>
    </AppCardEnhancedContainer>
  );
};
