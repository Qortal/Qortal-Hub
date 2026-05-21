import { useAtomValue } from 'jotai';
import { balanceAtom } from '../../atoms/global';
import { Box, Typography } from '@mui/material';
import { AdminSpaceInner } from './AdminSpaceInner';
import { useTranslation } from 'react-i18next';

export const AdminSpace = ({
  selectedGroup,
  adminsWithNames,
  isAdmin,
  hide,
  isOwner,
}) => {
  const balance = useAtomValue(balanceAtom);
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  return (
    <Box
      sx={{
        display: 'flex',
        flex: hide ? 0 : 1,
        flexDirection: 'column',
        left: hide ? '-1000px' : undefined,
        minHeight: 0,
        opacity: hide ? 0 : 1,
        overflowY: 'auto',
        position: hide ? 'fixed' : 'relative',
        visibility: hide ? 'hidden' : 'visible',
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
    </Box>
  );
};
