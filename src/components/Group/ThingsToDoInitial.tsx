import { useEffect, useMemo, useState } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import { Box, Typography, useTheme } from '@mui/material';
import { Spacer } from '../../common/Spacer';
import { QMailMessages } from './QMailMessages';
import { executeEvent } from '../../utils/events';
import { useTranslation } from 'react-i18next';

export const ThingsToDoInitial = ({
  myAddress,
  name,
  hasGroups,
  balance,
  userInfo,
}) => {
  const [checked1, setChecked1] = useState(false);
  const [checked2, setChecked2] = useState(false);
  const { t } = useTranslation(['core', 'tutorial']);
  const theme = useTheme();

  useEffect(() => {
    if (balance && +balance >= 6) {
      setChecked1(true);
    }
  }, [balance]);

  useEffect(() => {
    if (name) setChecked2(true);
  }, [name]);

  const isLoaded = useMemo(() => {
    if (userInfo !== null) return true;
    return false;
  }, [userInfo]);

  const hasDoneNameAndBalanceAndIsLoaded = useMemo(() => {
    if (isLoaded && checked1 && checked2) return true;
    return false;
  }, [checked1, isLoaded, checked2]);

  if (hasDoneNameAndBalanceAndIsLoaded) {
    return (
      <QMailMessages
        userAddress={userInfo?.address}
        userName={userInfo?.name}
      />
    );
  }
  if (!isLoaded) return null;

  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          padding: '0px 20px',
          width: '322px',
        }}
      >
        <Typography
          sx={{
            fontSize: '1rem',
            fontWeight: 600,
          }}
        >
          {!isLoaded
            ? t('core:loading.generic', { postProcess: 'capitalizeFirstChar' })
            : t('tutorial:initial.getting_started', {
                postProcess: 'capitalizeFirstChar',
              })}
        </Typography>

        <Spacer height="10px" />
      </Box>

      <Box
        sx={{
          bgcolor: theme.palette.background.paper,
          borderRadius: '19px',
          display: 'flex',
          flexDirection: 'column',
          padding: '20px',
          width: '322px',
        }}
      >
        {isLoaded && (
          <List sx={{ width: '100%', maxWidth: 360 }}>
            <ListItem
              disablePadding
              sx={{
                marginBottom: '20px',
              }}
            >
              <ListItemButton
                sx={{
                  padding: '0px',
                }}
                disableRipple
                role={undefined}
                dense
                onClick={() => {
                  executeEvent('openBuyQortInfo', {});
                }}
              >
                <ListItemText
                  sx={{
                    '& .MuiTypography-root': {
                      fontSize: '1rem',
                      fontWeight: 400,
                    },
                  }}
                  primary={t('tutorial:initial.recommended_qort_qty', {
                    quantity: 6,
                    postProcess: 'capitalizeFirstChar',
                  })}
                />

                <ListItemIcon
                  sx={{
                    justifyContent: 'flex-end',
                  }}
                >
                  <Box
                    sx={{
                      height: '18px',
                      width: '18px',
                      borderRadius: '50%',
                      backgroundColor: checked1
                        ? 'rgba(9, 182, 232, 1)'
                        : 'transparent',
                      outline: '1px solid rgba(9, 182, 232, 1)',
                    }}
                  />
                </ListItemIcon>
              </ListItemButton>
            </ListItem>

            <ListItem
              sx={{
                marginBottom: '20px',
              }}
              disablePadding
            >
              <ListItemButton
                sx={{
                  padding: '0px',
                }}
                disableRipple
                role={undefined}
                dense
              >
                <ListItemText
                  onClick={() => {
                    executeEvent('openRegisterName', {});
                  }}
                  sx={{
                    '& .MuiTypography-root': {
                      fontSize: '1rem',
                      fontWeight: 400,
                    },
                  }}
                  primary={t('tutorial:initial.register_name', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                />
                <ListItemIcon
                  sx={{
                    justifyContent: 'flex-end',
                  }}
                >
                  <Box
                    sx={{
                      height: '18px',
                      width: '18px',
                      borderRadius: '50%',
                      backgroundColor: checked2
                        ? 'rgba(9, 182, 232, 1)'
                        : 'transparent',
                      outline: '1px solid rgba(9, 182, 232, 1)',
                    }}
                  />
                </ListItemIcon>
              </ListItemButton>
            </ListItem>
          </List>
        )}
      </Box>
    </Box>
  );
};
