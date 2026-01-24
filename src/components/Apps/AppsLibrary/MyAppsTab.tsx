import { Box, ButtonBase, Typography, styled, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import AppsIcon from '@mui/icons-material/Apps';
import LanguageIcon from '@mui/icons-material/Language';
import {
  AppLibrarySubTitle,
  AppsWidthLimiter,
  PublishQAppCTAButton,
  PublishQAppCTALeft,
  PublishQAppCTAParent,
  PublishQAppCTARight,
  PublishQAppDotsBG,
} from '../Apps-styles';
import { QappDevelopText } from '../../../assets/Icons/QappDevelopText';
import { Spacer } from '../../../common/Spacer';

interface MyAppsTabProps {
  myName: string;
  hasPublishApp: boolean;
  hasPublishWebsite?: boolean;
  setMode: (mode: string) => void;
}

const SectionContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: '20px',
  width: '100%',
}));

const EmptyStateBox = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '40px',
  borderRadius: '12px',
  backgroundColor: theme.palette.background.paper,
  border: `1px dashed ${theme.palette.divider}`,
  textAlign: 'center',
}));

export const MyAppsTab = ({
  myName,
  hasPublishApp,
  hasPublishWebsite = false,
  setMode,
}: MyAppsTabProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  if (!myName) {
    return (
      <AppsWidthLimiter>
        <EmptyStateBox>
          <Typography
            sx={{
              fontSize: '18px',
              fontWeight: 500,
              marginBottom: '12px',
            }}
          >
            {t('core:message.generic.name_publish', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
          <Typography
            sx={{
              fontSize: '14px',
              color: theme.palette.text.secondary,
            }}
          >
            {t('core:message.generic.register_name', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </EmptyStateBox>
      </AppsWidthLimiter>
    );
  }

  return (
    <AppsWidthLimiter>
      <SectionContainer>
        {/* Publish/Update App Section */}
        <Box>
          <AppLibrarySubTitle
            sx={{
              fontSize: '24px',
              marginBottom: '16px',
            }}
          >
            {hasPublishApp
              ? t('core:action.update_app', {
                  postProcess: 'capitalizeFirstChar',
                })
              : t('core:action.publish_app', {
                  postProcess: 'capitalizeFirstChar',
                })}
          </AppLibrarySubTitle>

          <PublishQAppCTAParent
            sx={{
              gap: '25px',
              borderRadius: '12px',
              padding: '16px',
            }}
          >
            <PublishQAppCTALeft>
              <PublishQAppDotsBG>
                <AppsIcon fontSize="large" />
              </PublishQAppDotsBG>
              <Spacer width="29px" />
              <QappDevelopText />
            </PublishQAppCTALeft>

            <PublishQAppCTARight
              onClick={() => {
                setMode('publish');
              }}
            >
              <PublishQAppCTAButton>
                {hasPublishApp
                  ? t('core:action.update', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : t('core:action.publish', {
                      postProcess: 'capitalizeFirstChar',
                    })}
              </PublishQAppCTAButton>
              <Spacer width="20px" />
            </PublishQAppCTARight>
          </PublishQAppCTAParent>
        </Box>

        <Spacer height="20px" />

        {/* Developer Info */}
        <Box
          sx={{
            padding: '20px',
            borderRadius: '12px',
            backgroundColor: theme.palette.background.paper,
          }}
        >
          <Typography
            sx={{
              fontSize: '14px',
              color: theme.palette.text.secondary,
              fontStyle: 'italic',
            }}
          >
            {t('core:message.generic.one_app_per_name', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </Box>
      </SectionContainer>
    </AppsWidthLimiter>
  );
};
