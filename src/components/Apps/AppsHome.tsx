import {
  AppCircle,
  AppCircleContainer,
  AppCircleLabel,
  AppLibrarySubTitle,
  AppsContainer,
} from './Apps-styles';
import { ButtonBase } from '@mui/material';
import { Add } from '@mui/icons-material';
import { SortablePinnedApps } from './SortablePinnedApps';
import { Spacer } from '../../common/Spacer';

export const AppsHome = ({ setMode, myApp, myWebsite, availableQapps }) => {
  return (
    <>
      <AppsContainer
        sx={{
          justifyContent: 'flex-start',
        }}
      >
        <AppLibrarySubTitle>Apps Dashboard</AppLibrarySubTitle>
      </AppsContainer>
      <Spacer height="20px" />

      <AppsContainer>
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
              <Add>+</Add>
            </AppCircle>
            <AppCircleLabel>Library</AppCircleLabel>
          </AppCircleContainer>
        </ButtonBase>

        <SortablePinnedApps
          availableQapps={availableQapps}
          myWebsite={myWebsite}
          myApp={myApp}
        />
      </AppsContainer>
    </>
  );
};
