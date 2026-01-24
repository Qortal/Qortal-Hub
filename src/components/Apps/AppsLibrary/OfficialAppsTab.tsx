import { useMemo } from 'react';
import { Avatar, Box, ButtonBase, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
  AppCircle,
  AppCircleContainer,
  AppCircleLabel,
  AppLibrarySubTitle,
  AppsContainer,
  AppsWidthLimiter,
} from '../Apps-styles';
import { Spacer } from '../../../common/Spacer';
import { getBaseApiReact } from '../../../App';
import LogoSelected from '../../../assets/svgs/LogoSelected.svg';
import { executeEvent } from '../../../utils/events';

const officialAppList = [
  'q-tube',
  'q-blog',
  'q-share',
  'q-support',
  'q-mail',
  'q-fund',
  'q-shop',
  'q-trade',
  'q-manager',
  'q-mintership',
  'q-wallets',
  'q-search',
  'q-node',
  'names',
  'q-follow',
  'q-assets',
  'quitter',
];

interface OfficialAppsTabProps {
  availableQapps: any[];
}

export const OfficialAppsTab = ({ availableQapps }: OfficialAppsTabProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  const officialApps = useMemo(() => {
    return availableQapps.filter(
      (app) =>
        app.service === 'APP' &&
        officialAppList.includes(app?.name?.toLowerCase())
    );
  }, [availableQapps]);

  return (
    <AppsWidthLimiter>
      <AppLibrarySubTitle
        sx={{
          fontSize: '30px',
        }}
      >
        {t('core:apps_official', {
          postProcess: 'capitalizeFirstChar',
        })}
      </AppLibrarySubTitle>

      <Spacer height="45px" />

      <AppsContainer
        sx={{
          gap: '15px',
          justifyContent: 'flex-start',
        }}
      >
        {officialApps?.map((qapp) => {
          return (
            <ButtonBase
              key={`${qapp?.service}-${qapp?.name}`}
              sx={{
                width: '80px',
              }}
              onClick={() => {
                executeEvent('selectedAppInfo', {
                  data: qapp,
                });
              }}
            >
              <AppCircleContainer
                sx={{
                  gap: '10px',
                }}
              >
                <AppCircle
                  sx={{
                    border: 'none',
                  }}
                >
                  <Avatar
                    sx={{
                      height: '42px',
                      width: '42px',
                    }}
                    alt={qapp?.name}
                    src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${
                      qapp?.name
                    }/qortal_avatar?async=true`}
                  >
                    <img
                      style={{
                        width: '31px',
                        height: 'auto',
                      }}
                      src={LogoSelected}
                      alt="center-icon"
                    />
                  </Avatar>
                </AppCircle>

                <AppCircleLabel>
                  {qapp?.metadata?.title || qapp?.name}
                </AppCircleLabel>
              </AppCircleContainer>
            </ButtonBase>
          );
        })}
      </AppsContainer>
    </AppsWidthLimiter>
  );
};
