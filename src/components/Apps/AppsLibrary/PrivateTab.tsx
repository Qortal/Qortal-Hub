import { useState } from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import PublishIcon from '@mui/icons-material/Publish';
import AddIcon from '@mui/icons-material/Add';
import { AppsWidthLimiter } from '../Apps-styles';
import { Spacer } from '../../../common/Spacer';
import { AppsPrivate, PrivateAppAction } from '../AppsPrivate';
import { PublishedPrivateApps } from '../PublishedPrivateApps';
import type { PublishedPrivateApp } from '../privateAppMetadata';
import {
  PublishButton,
  PublishNewContainer,
  SectionContainer,
  SectionTitle,
  StyledDivider,
} from './LibraryTab-styles';

interface PrivateTabProps {
  myName: string;
  myAddress: string;
}

export const PrivateTab = ({ myName, myAddress }: PrivateTabProps) => {
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
    <AppsWidthLimiter>
      <SectionContainer>
        <PublishedPrivateApps
          myAddress={myAddress}
          onUpdate={(app) => open('update', app)}
          refreshKey={refreshKey}
        />

        <StyledDivider />

        <Box>
          <SectionTitle>
            <AddIcon sx={{ fontSize: '20px' }} />
            {t('core:private_apps.actions_title', {
              postProcess: 'capitalizeFirstChar',
            })}
          </SectionTitle>
          <Spacer height="16px" />
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
        </Box>
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
