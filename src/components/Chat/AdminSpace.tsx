import { useContext, useEffect, useState } from 'react';
import { MyContext, isMobile } from '../../App';
import { Box, Typography } from '@mui/material';
import { AdminSpaceInner } from './AdminSpaceInner';

export const AdminSpace = ({
  selectedGroup,
  adminsWithNames,
  userInfo,
  secretKey,
  getSecretKey,
  isAdmin,
  myAddress,
  hide,
  defaultThread,
  setDefaultThread,
  setIsForceShowCreationKeyPopup,
}) => {
  const { rootHeight } = useContext(MyContext);
  const [isMoved, setIsMoved] = useState(false);
  useEffect(() => {
    if (hide) {
      setTimeout(() => setIsMoved(true), 300); // Wait for the fade-out to complete before moving
    } else {
      setIsMoved(false); // Reset the position immediately when showing
    }
  }, [hide]);

  return (
    <div
      style={{
        // reference to change height
        display: 'flex',
        flexDirection: 'column',
        height: isMobile ? `calc(${rootHeight} - 127px` : 'calc(100vh - 70px)',
        left: hide && '-1000px',
        opacity: hide ? 0 : 1,
        position: hide ? 'fixed' : 'relative',
        visibility: hide && 'hidden',
        width: '100%',
      }}
    >
      {!isAdmin && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            paddingTop: '25px',
            width: '100%',
          }}
        >
          <Typography>Sorry, this space is only for Admins.</Typography>
        </Box>
      )}
      {isAdmin && (
        <AdminSpaceInner
          setIsForceShowCreationKeyPopup={setIsForceShowCreationKeyPopup}
          adminsWithNames={adminsWithNames}
          selectedGroup={selectedGroup}
        />
      )}
    </div>
  );
};
