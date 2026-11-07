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

  return (
    <AppsWidthLimiter>
      <SectionContainer>
        <PublishedPrivateApps myAddress={myAddress} refreshKey={refreshKey} />

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
            <PublishButton onClick={() => setAction('access')}>
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
            <PublishButton onClick={() => setAction('publish')}>
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
        onClose={() => setAction(null)}
        onPublished={() => setRefreshKey((key) => key + 1)}
      />
    </AppsWidthLimiter>
  );
};
