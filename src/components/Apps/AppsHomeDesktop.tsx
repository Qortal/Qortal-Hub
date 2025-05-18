import { useState } from 'react';
import {
  AppCircle,
  AppCircleContainer,
  AppCircleLabel,
  AppLibrarySubTitle,
  AppsContainer,
} from './Apps-styles';
import { Box, ButtonBase, Input, useTheme } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { executeEvent } from '../../utils/events';
import { Spacer } from '../../common/Spacer';
import { SortablePinnedApps } from './SortablePinnedApps';
import { extractComponents } from '../Chat/MessageDisplay';
import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward';
import { AppsPrivate } from './AppsPrivate';
import ThemeSelector from '../Theme/ThemeSelector';
import LanguageSelector from '../Language/LanguageSelector';
import { useTranslation } from 'react-i18next';

export const AppsHomeDesktop = ({
  setMode,
  myApp,
  myWebsite,
  availableQapps,
  myName,
}) => {
  const [qortalUrl, setQortalUrl] = useState('');
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core', 'group']);

  const openQortalUrl = () => {
    try {
      if (!qortalUrl) return;
      const res = extractComponents(qortalUrl);
      if (res) {
        const { service, name, identifier, path } = res;
        executeEvent('addTab', { data: { service, name, identifier, path } });
        executeEvent('open-apps-mode', {});
        setQortalUrl('qortal://');
      }
    } catch (error) {
      console.log(error);
    }
  };

  return (
    <>
      <AppsContainer
        sx={{
          justifyContent: 'flex-start',
        }}
      >
        <AppLibrarySubTitle
          sx={{
            fontSize: '30px',
          }}
        >
          {t('core:apps_dashboard', { postProcess: 'capitalizeFirst' })}
        </AppLibrarySubTitle>
      </AppsContainer>

      <Spacer height="20px" />

      <AppsContainer
        sx={{
          justifyContent: 'flex-start',
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            backgroundColor: theme.palette.background.paper,
            borderRadius: '20px',
            display: 'flex',
            gap: '20px',
            maxWidth: '500px',
            padding: '7px',
            width: '100%',
          }}
        >
          <Input
            id="standard-adornment-name"
            value={qortalUrl}
            onChange={(e) => {
              setQortalUrl(e.target.value);
            }}
            disableUnderline
            autoComplete="off"
            autoCorrect="off"
            placeholder="qortal://"
            sx={{
              width: '100%',
              color: theme.palette.text.primary,
              '& .MuiInput-input::placeholder': {
                color: theme.palette.text.secondary,
                fontSize: '20px',
                fontStyle: 'normal',
                fontWeight: 400,
                lineHeight: '120%', // 24px
                letterSpacing: '0.15px',
                opacity: 1,
              },
              '&:focus': {
                outline: 'none',
              },
              // Add any additional styles for the input here
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && qortalUrl) {
                openQortalUrl();
              }
            }}
          />
          <ButtonBase onClick={() => openQortalUrl()}>
            <ArrowOutwardIcon
              sx={{
                color: qortalUrl
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary,
              }}
            />
          </ButtonBase>
        </Box>
      </AppsContainer>

      <Spacer height="45px" />

      <AppsContainer
        sx={{
          gap: '50px',
          justifyContent: 'flex-start',
        }}
      >
        <ButtonBase
          onClick={() => {
            setMode('library');
          }}
        >
          <AppCircleContainer
            sx={{
              gap: '10px',
            }}
          >
            <AppCircle>
              <AddIcon />
            </AppCircle>

            <AppCircleLabel>
              {t('core:library', { postProcess: 'capitalizeFirst' })}
            </AppCircleLabel>
          </AppCircleContainer>
        </ButtonBase>

        <AppsPrivate myName={myName} />

        <SortablePinnedApps
          isDesktop={true}
          availableQapps={availableQapps}
          myWebsite={myWebsite}
          myApp={myApp}
        />
      </AppsContainer>

      <LanguageSelector />
      <ThemeSelector />
    </>
  );
};
