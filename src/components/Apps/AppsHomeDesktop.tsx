import React, { useState } from 'react';
import {
  AppCircle,
  AppCircleContainer,
  AppCircleLabel,
  AppLibrarySubTitle,
  AppsContainer,
} from './Apps-styles';
import { Box, ButtonBase, Input } from '@mui/material';
import { Add } from '@mui/icons-material';
import { isMobile } from '../../App';
import { executeEvent } from '../../utils/events';
import { Spacer } from '../../common/Spacer';
import { SortablePinnedApps } from './SortablePinnedApps';
import { extractComponents } from '../Chat/MessageDisplay';
import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward';
import { AppsPrivate } from './AppsPrivate';
import ThemeSelector from '../../styles/ThemeSelector';
export const AppsHomeDesktop = ({
  setMode,
  myApp,
  myWebsite,
  availableQapps,
  myName,
}) => {
  const [qortalUrl, setQortalUrl] = useState('');

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
    } catch (error) {}
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
          Apps Dashboard
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
            display: 'flex',
            gap: '20px',
            alignItems: 'center',
            backgroundColor: '#1f2023',
            padding: '7px',
            borderRadius: '20px',
            width: '100%',
            maxWidth: '500px',
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
              color: 'white',
              '& .MuiInput-input::placeholder': {
                color: 'rgba(84, 84, 84, 0.70) !important',
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
                color: qortalUrl ? 'white' : 'rgba(84, 84, 84, 0.70)',
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
              gap: !isMobile ? '10px' : '5px',
            }}
          >
            <AppCircle>
              <Add>+</Add>
            </AppCircle>
            <AppCircleLabel>Library</AppCircleLabel>
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

      <ThemeSelector style={{ position: 'fixed', bottom: '1%', left: '0%' }} />
    </>
  );
};
