import { Box, Button, CircularProgress, useTheme } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import {
  userInfoAtom,
  balanceAtom,
  memberGroupsAtom,
} from '../../atoms/global';
import { Spacer } from '../../common/Spacer';
import { GroupJoinRequests } from './GroupJoinRequests';
import { GroupInvites } from './GroupInvites';
import { ListOfGroupPromotions } from './ListOfGroupPromotions';
import { HomeProfileCard } from './HomeProfileCard';
import { HomeGettingStarted, GETTING_STARTED_LS_KEY } from './HomeGettingStarted';
import { HomeFeaturedApps } from './HomeFeaturedApps';
import { HomeFeaturedGroups } from './HomeFeaturedGroups';
import { HomeDeveloperTab } from './HomeDeveloperTab';
import { useTranslation } from 'react-i18next';

import {
  AnimatePresence,
  LazyMotion,
  domAnimation,
  useReducedMotion,
  motion,
} from 'framer-motion';

type HomeTab = 'user' | 'developer';
type ActivityTab = 'requests' | 'invites' | 'promotions';

// Temporarily hide User/Developer toggle — only User mode is shown (no option visible)
const SHOW_USER_DEVELOPER_TOGGLE = false;

// Temporarily hide Most active groups section — no render, no API calls
const SHOW_MOST_ACTIVE_GROUPS = false;

export const HomeDesktop = ({
  refreshHomeDataFunc,
  myAddress,
  isLoadingGroups,
  setGroupSection,
  setSelectedGroup,
  getTimestampEnterChat,
  setOpenManageMembers,
  setOpenAddGroup,
  setMobileViewMode,
  setDesktopViewMode,
  desktopViewMode,
}) => {
  const userInfo = useAtomValue(userInfoAtom);
  const balance = useAtomValue(balanceAtom);
  const groups = useAtomValue(memberGroupsAtom);
  const name = userInfo?.name;

  const [activeTab, setActiveTab] = useState<HomeTab>('user');
  const [activityTab, setActivityTab] = useState<ActivityTab>('promotions');
  const [requestsCount, setRequestsCount] = useState(0);
  const [invitesCount, setInvitesCount] = useState(0);
  const [promotionsCount, setPromotionsCount] = useState(0);
  const [checked1, setChecked1] = useState(false);
  const [checked2, setChecked2] = useState(false);
  const [showMostActiveGroups, setShowMostActiveGroups] = useState(
    () => localStorage.getItem(GETTING_STARTED_LS_KEY) === 'completed'
  );
  const [requestsCountLoading, setRequestsCountLoading] = useState(true);
  const [invitesCountLoading, setInvitesCountLoading] = useState(true);

  const reduce = useReducedMotion();
  const { t } = useTranslation(['core', 'group', 'tutorial']);
  const theme = useTheme();

  useEffect(() => {
    if (balance && +balance >= 4.5) setChecked1(true);
  }, [balance]);

  useEffect(() => {
    if (name) setChecked2(true);
  }, [name]);

  const isLoaded = useMemo(() => userInfo !== null, [userInfo]);

  const hasDoneNameAndBalanceAndIsLoaded = useMemo(
    () => isLoaded && checked1 && checked2,
    [checked1, isLoaded, checked2]
  );

  const sharedGroupNavProps = {
    getTimestampEnterChat,
    setDesktopViewMode,
    setGroupSection,
    setMobileViewMode,
    setSelectedGroup,
  };

  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence mode="wait">
        {desktopViewMode === 'home' && (
          <motion.div
            key="home"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            custom={reduce}
            style={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              overflow: 'auto',
              width: '100%',
              willChange: 'transform, opacity',
              backfaceVisibility: 'hidden',
            }}
          >
            <Spacer height="20px" />

            <Box
              sx={{
                alignItems: 'flex-start',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                height: '100%',
                maxWidth: '1036px',
                padding: '0 10px',
                width: '100%',
              }}
            >
              {/* Profile card — always visible */}
              <HomeProfileCard />

              {/* Tab switcher — temporarily hidden when SHOW_USER_DEVELOPER_TOGGLE is false */}
              {SHOW_USER_DEVELOPER_TOGGLE && (
                <Box
                  sx={{
                    alignSelf: 'center',
                    bgcolor: theme.palette.background.paper,
                    borderRadius: '50px',
                    display: 'flex',
                    gap: '4px',
                    padding: '4px',
                  }}
                >
                  {(['user', 'developer'] as HomeTab[]).map((tab) => (
                    <Button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      size="small"
                      disableElevation
                      sx={{
                        bgcolor:
                          activeTab === tab
                            ? theme.palette.primary.main
                            : 'transparent',
                        borderRadius: '50px',
                        color:
                          activeTab === tab
                            ? theme.palette.primary.contrastText
                            : theme.palette.text.secondary,
                        fontSize: '0.85rem',
                        fontWeight: activeTab === tab ? 600 : 400,
                        minWidth: '100px',
                        px: 2,
                        textTransform: 'none',
                        '&:hover': {
                          bgcolor:
                            activeTab === tab
                              ? theme.palette.primary.dark
                              : theme.palette.action.hover,
                        },
                      }}
                    >
                      {t(`tutorial:home.tab_${tab}`, {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Button>
                  ))}
                </Box>
              )}

              {/* ── USER TAB ── */}
              {activeTab === 'user' && (
                <>
                  <HomeGettingStarted onGettingStartedComplete={() => setShowMostActiveGroups(true)} />
                  <HomeFeaturedApps />
                  {SHOW_MOST_ACTIVE_GROUPS && showMostActiveGroups && <HomeFeaturedGroups {...sharedGroupNavProps} />}

                  {/* ── GROUP ACTIVITY SECTION ── */}
                  {!isLoadingGroups && hasDoneNameAndBalanceAndIsLoaded && (
                    <Box
                      sx={{
                        bgcolor: theme.palette.background.paper,
                        borderRadius: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                        padding: '16px 20px',
                        width: '100%',
                      }}
                    >
                      {/* Section title */}
                      <Box
                        sx={{
                          color: theme.palette.text.primary,
                          fontSize: '1rem',
                          fontWeight: 600,
                        }}
                      >
                        {t('tutorial:home.group_activity', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Box>

                      {/* Tab bar */}
                      <Box
                        sx={{
                          alignSelf: 'center',
                          bgcolor: theme.palette.background.default,
                          borderRadius: '50px',
                          display: 'flex',
                          gap: '4px',
                          padding: '4px',
                        }}
                      >
                        {(
                          [
                            {
                              key: 'requests' as ActivityTab,
                              label: t('group:join_requests', { postProcess: 'capitalizeFirstChar' }),
                              count: requestsCount,
                              countLoading: requestsCountLoading,
                            },
                            {
                              key: 'invites' as ActivityTab,
                              label: t('group:group.invites', { postProcess: 'capitalizeFirstChar' }),
                              count: invitesCount,
                              countLoading: invitesCountLoading,
                            },
                            {
                              key: 'promotions' as ActivityTab,
                              label: t('group:group.promotions', { postProcess: 'capitalizeFirstChar' }),
                              count: promotionsCount,
                              countLoading: false,
                            },
                          ]
                        ).map(({ key, label, count, countLoading }) => (
                          <Button
                            key={key}
                            onClick={() => setActivityTab(key)}
                            size="small"
                            disableElevation
                            sx={{
                              bgcolor:
                                activityTab === key
                                  ? theme.palette.primary.main
                                  : 'transparent',
                              borderRadius: '50px',
                              color:
                                activityTab === key
                                  ? theme.palette.primary.contrastText
                                  : theme.palette.text.secondary,
                              fontSize: '0.82rem',
                              fontWeight: activityTab === key ? 600 : 400,
                              px: 2,
                              textTransform: 'none',
                              whiteSpace: 'nowrap',
                              '&:hover': {
                                bgcolor:
                                  activityTab === key
                                    ? theme.palette.primary.dark
                                    : theme.palette.action.hover,
                              },
                            }}
                          >
                            {label}
                            {countLoading ? (
                              <Box
                                component="span"
                                sx={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  ml: '6px',
                                }}
                              >
                                <CircularProgress
                                  size={14}
                                  thickness={4}
                                  sx={{
                                    color:
                                      activityTab === key
                                        ? 'rgba(255,255,255,0.9)'
                                        : theme.palette.primary.contrastText,
                                  }}
                                />
                              </Box>
                            ) : (
                              count > 0 && (
                                <Box
                                  component="span"
                                  sx={{
                                    bgcolor:
                                      activityTab === key
                                        ? 'rgba(255,255,255,0.25)'
                                        : theme.palette.primary.main,
                                    borderRadius: '50px',
                                    color:
                                      activityTab === key
                                        ? theme.palette.primary.contrastText
                                        : theme.palette.primary.contrastText,
                                    display: 'inline-block',
                                    fontSize: '0.72rem',
                                    fontWeight: 700,
                                    lineHeight: 1,
                                    ml: '6px',
                                    px: '6px',
                                    py: '2px',
                                  }}
                                >
                                  {count}
                                </Box>
                              )
                            )}
                          </Button>
                        ))}
                      </Box>

                      {/* Tab content: mount all so each can report its count; hide inactive */}
                      <Box sx={{ display: activityTab === 'requests' ? 'block' : 'none' }}>
                        <GroupJoinRequests
                          compact
                          onCountChange={setRequestsCount}
                          onLoadingChange={setRequestsCountLoading}
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
                      <Box sx={{ display: activityTab === 'invites' ? 'block' : 'none' }}>
                        <GroupInvites
                          compact
                          onCountChange={setInvitesCount}
                          onLoadingChange={setInvitesCountLoading}
                          setOpenAddGroup={setOpenAddGroup}
                          myAddress={myAddress}
                        />
                      </Box>
                      <Box sx={{ display: activityTab === 'promotions' ? 'block' : 'none' }}>
                        <ListOfGroupPromotions
                          compact
                          onCountChange={setPromotionsCount}
                        />
                      </Box>
                    </Box>
                  )}

                </>
              )}

              {/* ── DEVELOPER TAB ── */}
              {activeTab === 'developer' && (
                <HomeDeveloperTab {...sharedGroupNavProps} />
              )}
            </Box>

            <Spacer height="180px" />
          </motion.div>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
};
