import { useState } from 'react';
import { Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import LockOpenRoundedIcon from '@mui/icons-material/LockOpenRounded';
import PublishIcon from '@mui/icons-material/Publish';
import { AppsWidthLimiter } from '../Apps-styles';
import { AppsPrivate, PrivateAppAction } from '../AppsPrivate';
import { PublishedPrivateApps } from '../PublishedPrivateApps';
import { LibrarySection } from './LibrarySection';
import { cap } from './libraryStyles';
import type { PublishedPrivateApp } from '../privateAppMetadata';
import {
  PublishButton,
  PublishNewContainer,
  SectionContainer,
} from './LibraryTab-styles';

interface PrivateTabProps {
  myName: string;
  myAddress: string;
  /** Changes when the library's refresh button is pressed. */
  libraryRefreshKey?: number;
}

export const PrivateTab = ({
  myName,
  myAddress,
  libraryRefreshKey = 0,
}: PrivateTabProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [refreshKey, setRefreshKey] = useState(0);
  const [action, setAction] = useState<PrivateAppAction | null>(null);
  const [updateTarget, setUpdateTarget] = useState<PublishedPrivateApp | null>(
    null
  );

  const open = (next: PrivateAppAction, target?: PublishedPrivateApp) => {
    setUpdateTarget(target ?? null);
    setAction(next);
  };

  return (
    <AppsWidthLimiter sx={{ alignItems: 'stretch' }}>
      <SectionContainer>
        <PublishedPrivateApps
          myAddress={myAddress}
          onUpdate={(app) => open('update', app)}
          refreshKey={refreshKey + libraryRefreshKey}
        />

        <LibrarySection
          hint={t('core:launcher.library.private_actions_hint', cap)}
          icon={<LockOpenRoundedIcon />}
          title={t('core:private_apps.actions_title', cap)}
        >
          <PublishNewContainer>
            <PublishButton onClick={() => open('access')}>
              <LockOpenIcon
                sx={{ fontSize: '32px', color: theme.palette.primary.main }}
              />
              <Typography
                sx={{
                  fontSize: '14px',
                  fontWeight: 500,
                  color: theme.palette.text.primary,
                }}
              >
                {t('core:action.access_app', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </PublishButton>
            <PublishButton onClick={() => open('publish')}>
              <PublishIcon
                sx={{ fontSize: '32px', color: theme.palette.secondary.main }}
              />
              <Typography
                sx={{
                  fontSize: '14px',
                  fontWeight: 500,
                  color: theme.palette.text.primary,
                }}
              >
                {t('core:action.publish_app', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </PublishButton>
          </PublishNewContainer>
        </LibrarySection>
      </SectionContainer>

      <AppsPrivate
        myName={myName}
        myAddress={myAddress}
        action={action}
        updateTarget={updateTarget}
        onClose={() => {
          setAction(null);
          setUpdateTarget(null);
        }}
        onPublished={() => setRefreshKey((key) => key + 1)}
      />
    </AppsWidthLimiter>
  );
};
