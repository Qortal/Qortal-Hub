import { Box, Divider, Typography, useTheme } from '@mui/material';
import React from 'react';
import { Spacer } from '../../common/Spacer';
import { ThingsToDoInitial } from './ThingsToDoInitial';
import { GroupJoinRequests } from './GroupJoinRequests';
import { GroupInvites } from './GroupInvites';
import { ListOfGroupPromotions } from './ListOfGroupPromotions';
import { QortPrice } from '../Home/QortPrice';
import ExploreIcon from '@mui/icons-material/Explore';
import { Explore } from '../Explore/Explore';
import { NewUsersCTA } from '../Home/NewUsersCTA';
import { useTranslation } from 'react-i18next';

export const HomeDesktop = ({
  refreshHomeDataFunc,
  myAddress,
  name,
  isLoadingGroups,
  balance,
  userInfo,
  groups,
  setGroupSection,
  setSelectedGroup,
  getTimestampEnterChat,
  setOpenManageMembers,
  setOpenAddGroup,
  setMobileViewMode,
  setDesktopViewMode,
  desktopViewMode,
}) => {
  const [checked1, setChecked1] = React.useState(false);
  const [checked2, setChecked2] = React.useState(false);

  const { t } = useTranslation(['core']);
  const theme = useTheme();

  React.useEffect(() => {
    if (balance && +balance >= 6) {
      setChecked1(true);
    }
  }, [balance]);

  React.useEffect(() => {
    if (name) setChecked2(true);
  }, [name]);

  const isLoaded = React.useMemo(() => {
    if (userInfo !== null) return true;
    return false;
  }, [userInfo]);

  const hasDoneNameAndBalanceAndIsLoaded = React.useMemo(() => {
    if (isLoaded && checked1 && checked2) return true;
    return false;
  }, [checked1, isLoaded, checked2]);

  return (
    <Box
      sx={{
        alignItems: 'center',
        display: desktopViewMode === 'home' ? 'flex' : 'none',
        flexDirection: 'column',
        height: '100%',
        overflow: 'auto',
        width: '100%',
      }}
    >
      <Spacer height="20px" />

      <Box
        sx={{
          alignItems: 'flex-start',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          maxWidth: '1036px',
          width: '100%',
        }}
      >
        <Typography
          sx={{
            color: theme.palette.text.primary,
            fontWeight: 400,
            fontSize: userInfo?.name?.length > 15 ? '16px' : '20px',
            padding: '10px',
          }}
        >
          {t('core:welcome', { postProcess: 'capitalize' })}
          {userInfo?.name ? (
            <span
              style={{
                fontStyle: 'italic',
              }}
            >{`, ${userInfo?.name}`}</span>
          ) : null}
        </Typography>

        <Spacer height="30px" />

        {!isLoadingGroups && (
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '20px',
              justifyContent: 'center',
              width: '100%',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                flexWrap: 'wrap',
                gap: '20px',
              }}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  justifyContent: 'center',
                  width: '330px',
                }}
              >
                <ThingsToDoInitial
                  balance={balance}
                  myAddress={myAddress}
                  name={userInfo?.name}
                  userInfo={userInfo}
                  hasGroups={
                    groups?.filter((item) => item?.groupId !== '0').length !== 0
                  }
                />
              </Box>

              {desktopViewMode === 'home' && (
                <>
                  {/* <Box sx={{
            width: '330px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
          <ListOfThreadPostsWatched />
          </Box> */}
                  {hasDoneNameAndBalanceAndIsLoaded && (
                    <>
                      <Box
                        sx={{
                          alignItems: 'center',
                          display: 'flex',
                          justifyContent: 'center',
                          width: '330px',
                        }}
                      >
                        <GroupJoinRequests
                          setGroupSection={setGroupSection}
                          setSelectedGroup={setSelectedGroup}
                          getTimestampEnterChat={getTimestampEnterChat}
                          setOpenManageMembers={setOpenManageMembers}
                          myAddress={myAddress}
                          groups={groups}
                          setMobileViewMode={setMobileViewMode}
                          setDesktopViewMode={setDesktopViewMode}
                        />
                      </Box>

                      <Box
                        sx={{
                          alignItems: 'center',
                          display: 'flex',
                          justifyContent: 'center',
                          width: '330px',
                        }}
                      >
                        <GroupInvites
                          setOpenAddGroup={setOpenAddGroup}
                          myAddress={myAddress}
                          groups={groups}
                          setMobileViewMode={setMobileViewMode}
                        />
                      </Box>
                    </>
                  )}
                </>
              )}
            </Box>
            <QortPrice />
          </Box>
        )}

        {!isLoadingGroups && (
          <>
            <Spacer height="60px" />

            <Divider
              color="secondary"
              sx={{
                width: '100%',
              }}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: '10px',
                }}
              >
                <ExploreIcon
                  sx={{
                    ccolor: theme.palette.text.primary,
                  }}
                />{' '}
                <Typography
                  sx={{
                    fontSize: '1rem',
                  }}
                >
                  {t('tutorial:initial.explore', { postProcess: 'capitalize' })}
                </Typography>{' '}
              </Box>
            </Divider>

            {!hasDoneNameAndBalanceAndIsLoaded && <Spacer height="40px" />}
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '20px',
                justifyContent: 'center',
                width: '100%',
              }}
            >
              {hasDoneNameAndBalanceAndIsLoaded && <ListOfGroupPromotions />}

              <Explore setDesktopViewMode={setDesktopViewMode} />
            </Box>

            <NewUsersCTA balance={balance} />
          </>
        )}
      </Box>

      <Spacer height="26px" />

      {/* <Box
                sx={{
                  display: "flex",
                  width: "100%",
                  justifyContent: "flex-start",
                }}
              >
                <Button
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={refreshHomeDataFunc}
                  sx={{
                    color: "white",
                  }}
                >
                  Refresh home data
                </Button>
              </Box> */}

      <Spacer height="180px" />
    </Box>
  );
};
