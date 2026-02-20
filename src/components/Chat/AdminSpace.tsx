import { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { userInfoAtom, balanceAtom } from '../../atoms/global';
import { Box, Typography } from '@mui/material';
import { AdminSpaceInner } from './AdminSpaceInner';
import { useTranslation } from 'react-i18next';
import { appHeighOffset } from '../Desktop/CustomTitleBar';

export const AdminSpace = ({
  selectedGroup,
  adminsWithNames,
  secretKey,
  getSecretKey,
  isAdmin,
  myAddress,
  hide,
  defaultThread,
  setDefaultThread,
  isOwner,
}) => {
  const userInfo = useAtomValue(userInfoAtom);
  const balance = useAtomValue(balanceAtom);
  const [isMoved, setIsMoved] = useState(false);
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

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
        display: 'flex',
        flexDirection: 'column',
        height: `calc(100vh - ${70 + appHeighOffset}px)`,
        left: hide && '-1000px',
        opacity: hide ? 0 : 1,
        overflow: 'auto',
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
          <Typography>
            {t('core:message.generic.space_for_admins', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </Box>
      )}

      {isAdmin && (
        <AdminSpaceInner
          adminsWithNames={adminsWithNames}
          selectedGroup={selectedGroup}
          balance={balance}
          isOwner={isOwner}
        />
      )}
    </div>
  );
};
