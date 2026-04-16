import { Box, ButtonBase, CircularProgress, IconButton, Popover, Typography, useTheme } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import ShoppingBagRoundedIcon from '@mui/icons-material/ShoppingBagRounded';
import SouthWestRoundedIcon from '@mui/icons-material/SouthWestRounded';
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { alpha } from '@mui/material/styles';
import { useEffect, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { balanceAtom, groupInvitesCacheAtom, joinRequestsCacheAtom, memberGroupsAtom, nodeInfosAtom, userInfoAtom } from '../../atoms/global';
import { Spacer } from '../../common/Spacer';
import { GroupJoinRequests } from './GroupJoinRequests';
import { GroupInvites } from './GroupInvites';
import { ListOfGroupPromotions } from './ListOfGroupPromotions';
import { HomeProfileCard } from './HomeProfileCard';
import { GETTING_STARTED_LS_KEY, HomeGettingStarted } from './HomeGettingStarted';
import { HomeFeaturedApps } from './HomeFeaturedApps';
import { HomeFeaturedGroups } from './HomeFeaturedGroups';
import { HomeDeveloperTab } from './HomeDeveloperTab';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-qr-code';
import { AnimatePresence, LazyMotion, domAnimation, motion, useReducedMotion } from 'framer-motion';
import { getBaseApiReact } from '../../App';
import { manifestData } from '../NotAuthenticated';
import { executeEvent, subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { dashboardPanelSx, handleDashboardPanelPointerLeave, handleDashboardPanelPointerMove } from './dashboardPanelEffects';
import { useHandleUserInfo } from '../../hooks/useHandleUserInfo';

type HomeTab = 'user' | 'developer';
type ActivityTab = 'requests' | 'invites' | 'promotions';

const SHOW_USER_DEVELOPER_TOGGLE = false;
const SHOW_MOST_ACTIVE_GROUPS = false;

const DashboardUtilityPanel = ({ title, children, theme, sx = undefined, titleSx = undefined }) => (
  <Box sx={{ ...dashboardPanelSx(theme), borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px 16px', width: '100%', ...sx }} onMouseMove={handleDashboardPanelPointerMove} onMouseLeave={handleDashboardPanelPointerLeave}>
    <Typography sx={{ color: theme.palette.text.primary, fontSize: '1rem', fontWeight: 600, ...titleSx }}>{title}</Typography>
    {children}
  </Box>
);

const sepSx = (theme) => ({ borderBottom: `1px solid ${theme.palette.border.subtle}` });

const WalletActionButton = ({ icon, label, onClick, theme }) => (
  <ButtonBase onClick={onClick} sx={{ alignItems: 'center', bgcolor: theme.palette.background.surface, border: `1px solid ${theme.palette.border.subtle}`, borderRadius: '10px', display: 'flex', gap: '9px', height: '44px', justifyContent: 'center', px: 1.4, transition: 'background-color 140ms ease, border-color 140ms ease, transform 120ms ease', width: '100%', '&:hover': { bgcolor: theme.palette.background.elevated, borderColor: theme.palette.border.main, transform: 'translateY(-1px)' }, '&:active': { transform: 'translateY(0)' } }}>
    <Box sx={{ color: theme.palette.text.secondary, display: 'inline-flex' }}>{icon}</Box>
    <Typography sx={{ color: theme.palette.text.primary, fontSize: '0.8rem', fontWeight: 600 }}>{label}</Typography>
  </ButtonBase>
);

export const HomeDesktop = ({ myAddress, setGroupSection, setSelectedGroup, getTimestampEnterChat, setOpenManageMembers, setOpenAddGroup, setMobileViewMode, setDesktopViewMode, desktopViewMode }) => {
  const userInfo = useAtomValue(userInfoAtom);
  const balance = useAtomValue(balanceAtom);
  const groups = useAtomValue(memberGroupsAtom);
  const nodeInfos = useAtomValue(nodeInfosAtom);
  const [activeTab, setActiveTab] = useState<HomeTab>('user');
  const [activityTab, setActivityTab] = useState<ActivityTab>('promotions');
  const [requestsCount, setRequestsCount] = useState(0);
  const [invitesCount, setInvitesCount] = useState(0);
  const [promotionsCount, setPromotionsCount] = useState(0);
  const [showMostActiveGroups, setShowMostActiveGroups] = useState(() => localStorage.getItem(GETTING_STARTED_LS_KEY) === 'completed');
  const [isOnboardingComplete, setIsOnboardingComplete] = useState(false);
  const [requestsCountLoading, setRequestsCountLoading] = useState(true);
  const [invitesCountLoading, setInvitesCountLoading] = useState(true);
  const [qrAnchorEl, setQrAnchorEl] = useState<HTMLElement | null>(null);
  const [minterLevel, setMinterLevel] = useState<number | null>(null);
  const [minterPreviewMode, setMinterPreviewMode] = useState<'off' | 'on'>(() => {
    const saved = localStorage.getItem('dashboardMinterPreviewMode');
    return saved === 'on' ? 'on' : 'off';
  });
  const reduce = useReducedMotion();
  const { t } = useTranslation(['core', 'group', 'tutorial', 'auth']);
  const theme = useTheme();
  const setGroupInvitesCache = useSetAtom(groupInvitesCacheAtom);
  const setJoinRequestsCache = useSetAtom(joinRequestsCacheAtom);
  const getIndividualUserInfo = useHandleUserInfo();
  const userAddress = userInfo?.address;

  useEffect(() => {
    if (!userAddress) { setIsOnboardingComplete(false); return; }
    setIsOnboardingComplete(localStorage.getItem(`${GETTING_STARTED_LS_KEY}_${userAddress}`) === 'completed');
  }, [userAddress]);

  useEffect(() => {
    let active = true;
    if (!userAddress) { setMinterLevel(null); return; }
    getIndividualUserInfo(userAddress).then((level) => {
      if (active) setMinterLevel(typeof level === 'number' ? level : null);
    }).catch(() => {
      if (active) setMinterLevel(null);
    });
    return () => { active = false; };
  }, [getIndividualUserInfo, userAddress]);

  useEffect(() => {
    if (localStorage.getItem('dashboardMinterPreviewMode')) return;
    setMinterPreviewMode(minterLevel && minterLevel > 0 ? 'on' : 'off');
  }, [minterLevel]);

  useEffect(() => {
    const handleSetDashboardMinterPreview = (e: CustomEvent) => {
      const mode = e.detail?.data?.mode === 'on' ? 'on' : 'off';
      setMinterPreviewMode(mode);
      localStorage.setItem('dashboardMinterPreviewMode', mode);
    };

    subscribeToEvent('setDashboardMinterPreview', handleSetDashboardMinterPreview);
    return () => {
      unsubscribeFromEvent('setDashboardMinterPreview', handleSetDashboardMinterPreview);
    };
  }, []);

  const handleRefreshGroupActivity = () => {
    setGroupInvitesCache(null);
    setJoinRequestsCache(null);
  };

  const balanceLabel = balance != null ? `${Number(balance).toFixed(2)} QORT` : '—';
  const nodeStatusValue = nodeInfos?.isSynchronizing && nodeInfos?.syncPercent !== 100 ? `Syncing ${Math.round(nodeInfos?.syncPercent || 0)}%` : 'Fully Synced';
  const peersLabel = `${nodeInfos?.numberOfConnections || 0}`;
  const blockHeightLabel = `${nodeInfos?.height || '—'}`;
  const hubVersionLabel = manifestData.version || '—';
  const minterDotsFilled = minterPreviewMode === 'on' ? 5 : 0;
  const isMinterOn = minterPreviewMode === 'on';
  const infoRows = [
    ['QORT Balance', balanceLabel, <AccountBalanceWalletOutlinedIcon sx={{ color: theme.palette.text.secondary, fontSize: '0.92rem' }} />],
    ['Node Status', nodeStatusValue, <HubOutlinedIcon sx={{ color: theme.palette.text.secondary, fontSize: '0.92rem' }} />],
    ['Connected Peers', peersLabel, <GroupOutlinedIcon sx={{ color: theme.palette.text.secondary, fontSize: '0.92rem' }} />],
    ['Block Height', blockHeightLabel, <LayersOutlinedIcon sx={{ color: theme.palette.text.secondary, fontSize: '0.92rem' }} />],
    ['Hub Version', hubVersionLabel, <InfoOutlinedIcon sx={{ color: theme.palette.text.secondary, fontSize: '0.92rem' }} />],
  ] as const;

  const sharedGroupNavProps = { getTimestampEnterChat, setDesktopViewMode, setGroupSection, setMobileViewMode, setSelectedGroup };

  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence mode="wait">
        {desktopViewMode === 'home' && (
          <motion.div key="home" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} custom={reduce} style={{ alignItems: 'center', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', width: '100%', willChange: 'transform, opacity', backfaceVisibility: 'hidden' }}>
            <Spacer height="20px" />
            <Box sx={{ alignItems: 'flex-start', display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: { xs: '1320px', xl: '1520px' }, padding: '0 20px', width: '100%' }}>
              <Box sx={{ display: 'grid', gap: '20px', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) minmax(320px, 360px)', xl: 'minmax(0, 1fr) minmax(360px, 400px)' }, alignItems: 'start', width: '100%' }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0, width: '100%' }}>
                  <Box sx={{ color: theme.palette.text.secondary, fontSize: '0.74rem', fontWeight: 700, letterSpacing: '0.055em', textTransform: 'uppercase' }}>Qortal Hub</Box>
                  <HomeProfileCard />
                  <Box sx={{ display: 'grid', gap: '20px', gridTemplateColumns: { xs: '1fr', md: isOnboardingComplete ? 'minmax(0, 1fr)' : 'minmax(285px, 330px) minmax(0, 1fr)', xl: isOnboardingComplete ? 'minmax(0, 1fr)' : 'minmax(310px, 360px) minmax(0, 1fr)' }, alignItems: 'stretch', width: '100%' }}>
                    <Box sx={{ display: isOnboardingComplete ? 'none' : 'block', minWidth: 0, '& > *': { height: '100%' } }}>
                      <HomeGettingStarted onGettingStartedComplete={() => { setShowMostActiveGroups(true); setIsOnboardingComplete(true); }} />
                    </Box>
                    <Box sx={{ display: 'flex', minWidth: 0, width: '100%', '& > *': { width: '100%' } }}>
                      <HomeFeaturedApps />
                    </Box>
                  </Box>
                </Box>
                <Box sx={{ alignContent: 'start', display: 'grid', gap: '16px', gridTemplateColumns: '1fr', gridTemplateRows: 'auto auto', minWidth: 0, pt: { lg: '22px' } }}>
                  <DashboardUtilityPanel title="Info" theme={theme} sx={{ gap: '8px', padding: '12px 16px' }}>
                    <Box sx={{ ...sepSx(theme), pb: 1.05 }}>
                      <Box sx={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                        <Box sx={{ alignItems: 'center', color: theme.palette.text.primary, display: 'inline-flex', gap: '8px' }}>
                          <AccountBalanceWalletOutlinedIcon sx={{ color: theme.palette.text.secondary, fontSize: '0.92rem' }} />
                          <Typography sx={{ fontSize: '0.78rem', fontWeight: 600 }}>QORT Balance</Typography>
                        </Box>
                        <Typography sx={{ color: theme.palette.text.primary, fontSize: '0.92rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{balanceLabel}</Typography>
                      </Box>
                    </Box>
                    <Box sx={{ ...sepSx(theme), alignItems: 'center', display: 'flex', justifyContent: 'space-between', gap: '12px', py: 0.8 }}>
                      <Box sx={{ alignItems: 'center', color: theme.palette.text.primary, display: 'inline-flex', gap: '8px', minWidth: 0 }}>
                        <AutoAwesomeOutlinedIcon sx={{ color: theme.palette.text.secondary, fontSize: '0.92rem' }} />
                        <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          Minter Level
                        </Typography>
                      </Box>
                      {isMinterOn ? (
                        <Box sx={{ alignItems: 'center', display: 'inline-flex', flexShrink: 0, gap: '6px' }}>
                          <Box sx={{ alignItems: 'center', display: 'inline-flex', gap: '5px' }}>
                            {Array.from({ length: 8 }).map((_, index) => (
                              <Box key={index} sx={{ bgcolor: index < minterDotsFilled ? theme.palette.primary.main : alpha(theme.palette.text.secondary, 0.28), borderRadius: '50%', boxShadow: index < minterDotsFilled ? `0 0 0 1px ${alpha(theme.palette.primary.main, 0.18)}` : 'none', height: '8px', width: '8px' }} />
                            ))}
                          </Box>
                        </Box>
                      ) : (
                        <ButtonBase onClick={() => { executeEvent('addTab', { data: { service: 'APP', name: 'q-mintership' } }); executeEvent('open-apps-mode', {}); }} sx={{ bgcolor: theme.palette.background.surface, border: `1px solid ${theme.palette.border.subtle}`, borderRadius: '999px', color: theme.palette.text.secondary, fontSize: '0.72rem', fontWeight: 600, px: 1.2, py: 0.45 }}>
                          Apply
                        </ButtonBase>
                      )}
                    </Box>
                    {infoRows.slice(1).map(([label, value, icon], index, array) => (
                      <Box key={label} sx={{ ...(index < array.length - 1 ? sepSx(theme) : {}), alignItems: 'center', display: 'flex', justifyContent: 'space-between', gap: '12px', py: 0.8 }}>
                        <Box sx={{ alignItems: 'center', color: theme.palette.text.primary, display: 'inline-flex', gap: '8px' }}>
                          {icon}
                          <Typography sx={{ color: theme.palette.text.primary, fontSize: '0.78rem', fontWeight: 600 }}>{label}</Typography>
                        </Box>
                        <Typography sx={{ color: theme.palette.text.primary, fontSize: '0.82rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{value}</Typography>
                      </Box>
                    ))}
                  </DashboardUtilityPanel>
                  <DashboardUtilityPanel title="Wallet Activity" theme={theme}>
                    <Box sx={{ ...sepSx(theme), alignItems: 'center', display: 'flex', justifyContent: 'space-between', pb: 1.15 }}>
                      <Typography sx={{ color: theme.palette.text.secondary, fontSize: '0.72rem' }}>Last activity</Typography>
                      <Typography sx={{ color: theme.palette.text.secondary, fontSize: '0.72rem' }}>2 days ago</Typography>
                    </Box>
                    <Box sx={{ display: 'grid', gap: '8px', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', pt: 0.2 }}>
                      <WalletActionButton icon={<SendRoundedIcon sx={{ fontSize: '16px' }} />} label="Send" onClick={() => executeEvent('openPaymentInternal', {})} theme={theme} />
                      <WalletActionButton icon={<SouthWestRoundedIcon sx={{ fontSize: '16px' }} />} label="Receive" onClick={(event) => setQrAnchorEl(event.currentTarget)} theme={theme} />
                      <WalletActionButton icon={<ShoppingBagRoundedIcon sx={{ fontSize: '16px' }} />} label="Buy" onClick={() => { executeEvent('addTab', { data: { service: 'APP', name: 'q-trade' } }); executeEvent('open-apps-mode', {}); }} theme={theme} />
                    </Box>
                    <Typography sx={{ color: theme.palette.text.secondary, fontSize: '0.66rem', lineHeight: 1.45 }}>
                      Use these shortcuts for your most common wallet actions directly from your Hub Dashboard
                    </Typography>
                  </DashboardUtilityPanel>
                </Box>
              </Box>

              {SHOW_USER_DEVELOPER_TOGGLE && (
                <Box sx={{ alignSelf: 'center', bgcolor: theme.palette.background.paper, borderRadius: '50px', display: 'flex', gap: '4px', padding: '4px' }}>
                  {(['user', 'developer'] as HomeTab[]).map((tab) => (
                    <ButtonBase key={tab} onClick={() => setActiveTab(tab)} sx={{ bgcolor: activeTab === tab ? theme.palette.primary.main : 'transparent', borderRadius: '50px', color: activeTab === tab ? theme.palette.primary.contrastText : theme.palette.text.secondary, fontSize: '0.85rem', fontWeight: activeTab === tab ? 600 : 400, minWidth: '100px', px: 2, py: 1, textTransform: 'none' }}>
                      {t(`tutorial:home.tab_${tab}`, { postProcess: 'capitalizeFirstChar' })}
                    </ButtonBase>
                  ))}
                </Box>
              )}

              {activeTab === 'user' && (
                <>
                  {SHOW_MOST_ACTIVE_GROUPS && showMostActiveGroups && <HomeFeaturedGroups {...sharedGroupNavProps} />}
                  <Box sx={{ ...dashboardPanelSx(theme), borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px 20px', width: '100%' }} onMouseMove={handleDashboardPanelPointerMove} onMouseLeave={handleDashboardPanelPointerLeave}>
                    <Box sx={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <Box>
                        <Box sx={{ color: theme.palette.text.primary, fontSize: '1rem', fontWeight: 600 }}>{t('tutorial:home.group_activity', { postProcess: 'capitalizeFirstChar' })}</Box>
                        <Typography sx={{ color: theme.palette.text.secondary, fontSize: '0.78rem', mt: '3px' }}>
                          Keep up with promotions, invites, and membership requests.
                        </Typography>
                      </Box>
                      <IconButton aria-label={t('core:action.refresh', { postProcess: 'capitalizeFirstChar', defaultValue: 'Refresh' })} onClick={handleRefreshGroupActivity} size="small" sx={{ color: theme.palette.text.secondary }}>
                        <RefreshIcon fontSize="small" />
                      </IconButton>
                    </Box>
                    <Box sx={{ alignSelf: 'center', bgcolor: theme.palette.background.default, borderRadius: '50px', display: 'flex', gap: '4px', justifyContent: 'center', minWidth: 'fit-content', padding: '4px' }}>
                      {([
                        { key: 'requests' as ActivityTab, label: t('group:join_requests', { postProcess: 'capitalizeFirstChar' }), count: requestsCount, countLoading: requestsCountLoading },
                        { key: 'promotions' as ActivityTab, label: t('group:group.promotions', { postProcess: 'capitalizeFirstChar' }), count: promotionsCount, countLoading: false },
                        { key: 'invites' as ActivityTab, label: t('group:group.invites', { postProcess: 'capitalizeFirstChar' }), count: invitesCount, countLoading: invitesCountLoading },
                      ]).map(({ key, label, count, countLoading }) => (
                        <ButtonBase key={key} onClick={() => setActivityTab(key)} sx={{ bgcolor: activityTab === key ? theme.palette.primary.main : 'transparent', borderRadius: '50px', color: activityTab === key ? theme.palette.primary.contrastText : theme.palette.text.secondary, fontSize: '0.82rem', fontWeight: activityTab === key ? 600 : 400, px: 2, py: 0.8, textTransform: 'none', whiteSpace: 'nowrap', '&:hover': { bgcolor: activityTab === key ? theme.palette.primary.dark : theme.palette.action.hover } }}>
                          {label}
                          {countLoading ? <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', ml: '6px' }}><CircularProgress size={14} thickness={4} sx={{ color: activityTab === key ? 'rgba(255,255,255,0.9)' : theme.palette.primary.contrastText }} /></Box> : count > 0 ? <Box component="span" sx={{ bgcolor: activityTab === key ? 'rgba(255,255,255,0.25)' : theme.palette.primary.main, borderRadius: '50px', color: theme.palette.primary.contrastText, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 700, height: '18px', lineHeight: 1, ml: '6px', minWidth: '18px', px: '6px' }}>{count}</Box> : null}
                        </ButtonBase>
                      ))}
                    </Box>
                    <Box sx={{ display: activityTab === 'requests' ? 'block' : 'none' }}>
                      <GroupJoinRequests compact onCountChange={setRequestsCount} onLoadingChange={setRequestsCountLoading} setGroupSection={setGroupSection} setSelectedGroup={setSelectedGroup} getTimestampEnterChat={getTimestampEnterChat} setOpenManageMembers={setOpenManageMembers} myAddress={myAddress} groups={groups} setMobileViewMode={setMobileViewMode} setDesktopViewMode={setDesktopViewMode} />
                    </Box>
                    <Box sx={{ display: activityTab === 'invites' ? 'block' : 'none' }}>
                      <GroupInvites compact onCountChange={setInvitesCount} onLoadingChange={setInvitesCountLoading} setOpenAddGroup={setOpenAddGroup} myAddress={myAddress} />
                    </Box>
                    <Box sx={{ display: activityTab === 'promotions' ? 'block' : 'none' }}>
                      <ListOfGroupPromotions compact onCountChange={setPromotionsCount} />
                    </Box>
                  </Box>
                </>
              )}

              {activeTab === 'developer' && <HomeDeveloperTab {...sharedGroupNavProps} />}
            </Box>

            <Popover open={Boolean(qrAnchorEl)} anchorEl={qrAnchorEl} onClose={() => setQrAnchorEl(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
              <Box sx={{ bgcolor: theme.palette.background.paper, border: `1px solid ${theme.palette.border.subtle}`, borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '12px', p: 2, width: '220px' }}>
                <Typography sx={{ color: theme.palette.text.primary, fontSize: '0.9rem', fontWeight: 600, textAlign: 'center' }}>Wallet QR</Typography>
                <Box sx={{ alignItems: 'center', bgcolor: '#ffffff', borderRadius: '12px', display: 'flex', justifyContent: 'center', p: 1.5 }}>
                  <QRCode value={userAddress ?? ''} size={150} level="M" bgColor="#FFFFFF" fgColor="#000000" />
                </Box>
                <Typography sx={{ color: theme.palette.text.secondary, fontFamily: 'monospace', fontSize: '0.72rem', textAlign: 'center', wordBreak: 'break-all' }}>{userAddress ?? '—'}</Typography>
              </Box>
            </Popover>

            <Spacer height="120px" />
          </motion.div>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
};
