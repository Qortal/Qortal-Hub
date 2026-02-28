import { useContext, useState } from 'react';
import {
  AppCircle,
  AppCircleContainer,
  AppButton,
  AppButtonText,
  AppInfoAppName,
  AppInfoSnippetContainer,
  AppInfoSnippetLeft,
  AppInfoSnippetMiddle,
  AppInfoUserName,
  AppsBackContainer,
  AppsInfoDescription,
  AppsLibraryContainer,
  AppsWidthLimiter,
} from './Apps-styles';
import {
  Avatar,
  Box,
  Divider,
  styled,
  Typography,
  useTheme,
} from '@mui/material';
import { getBaseApiReact, QORTAL_APP_CONTEXT } from '../../App';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';
import { Spacer } from '../../common/Spacer';
import { executeEvent } from '../../utils/events';
import { AppRating } from './AppRating';
import {
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../../atoms/global';
import { saveToLocalStorage } from './AppsNavBarDesktop';
import { useAtom, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { ComposeP, ShowMessageReturnButton } from '../Group/Forum/Mail-styles';
import { ReturnIcon } from '../../assets/Icons/ReturnIcon';
import { AppRatingBreakdown } from './AppInfo/AppRatingBreakdown';
import { AppDetailsSection } from './AppInfo/AppDetailsSection';
import { getFee } from '../../background/background';
import { TIME_MINUTES_1_IN_MILLISECONDS } from '../../constants/constants';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { useAppRating } from '../../hooks/useAppRatings';

const SectionTitle = styled(Typography)(({ theme }) => ({
  fontSize: '18px',
  fontWeight: 600,
  color: theme.palette.text.primary,
  marginBottom: '16px',
}));

const SectionContainer = styled(Box)(({ theme }) => ({
  width: '100%',
  padding: '20px 0',
}));

const StyledDivider = styled(Divider)(({ theme }) => ({
  margin: '8px 0',
  backgroundColor: theme.palette.divider,
}));

export const AppInfo = ({ app, myName }) => {
  const isInstalled = app?.status?.status === 'READY';
  const [sortablePinnedApps, setSortablePinnedApps] = useAtom(
    sortablePinnedAppsAtom
  );
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState<{
    type: string;
    message: string;
  } | null>(null);

  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  // Use centralized rating store
  const { rating, refresh } = useAppRating(app?.name, app?.service);
  const hasPublishedRating = rating?.hasPublishedRating ?? null;
  const pollInfo = rating?.pollInfo ?? null;

  const isSelectedAppPinned = !!sortablePinnedApps?.find(
    (item) => item?.name === app?.name && item?.service === app?.service
  );
  const setSettingsLocalLastUpdated = useSetAtom(settingsLocalLastUpdatedAtom);

  const handleRate = async (rating: number) => {
    try {
      if (!myName) {
        throw new Error(
          t('core:message.generic.name_rate', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
      if (!app?.name) return;

      const fee = await getFee('CREATE_POLL');

      await show({
        message: t('core:message.question.rate_app', {
          rate: rating,
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });

      if (hasPublishedRating === false) {
        const pollName = `app-library-${app.service}-rating-${app.name}`;
        const pollOptions = [`1, 2, 3, 4, 5, initialValue-${rating}`];
        const pollDescription = t('core:message.generic.rating', {
          name: app.name,
          service: app.service,
          postProcess: 'capitalizeFirstChar',
        });

        await new Promise((res, rej) => {
          window
            .sendMessage(
              'createPoll',
              {
                pollName: pollName,
                pollDescription: pollDescription,
                pollOptions: pollOptions,
                pollOwnerAddress: myName,
              },
              TIME_MINUTES_1_IN_MILLISECONDS
            )
            .then((response: any) => {
              if (response.error) {
                rej(response?.message);
                return;
              } else {
                res(response);
                setInfoSnack({
                  type: 'success',
                  message: t('core:message.success.rated_app', {
                    postProcess: 'capitalizeFirstChar',
                  }),
                });
                setOpenSnack(true);
                refresh();
              }
            })
            .catch((error: any) => {
              rej(error);
            });
        });
      } else {
        const pollName = `app-library-${app.service}-rating-${app.name}`;

        const optionIndex = pollInfo?.pollOptions.findIndex(
          (option: any) => +option.optionName === +rating
        );
        if (isNaN(optionIndex) || optionIndex === -1) {
          throw new Error(
            t('core:message.error.rating_option', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        }

        await new Promise((res, rej) => {
          window
            .sendMessage(
              'voteOnPoll',
              {
                pollName: pollName,
                optionIndex,
              },
              TIME_MINUTES_1_IN_MILLISECONDS
            )
            .then((response: any) => {
              if (response.error) {
                rej(response?.message);
                return;
              } else {
                res(response);
                setInfoSnack({
                  type: 'success',
                  message: t('core:message.success.rated_app', {
                    postProcess: 'capitalizeFirstChar',
                  }),
                });
                setOpenSnack(true);
                refresh();
              }
            })
            .catch((error: any) => {
              rej(error);
            });
        });
      }
    } catch (error: any) {
      const errorMessage =
        typeof error === 'string' ? error : error?.message || '';
      let snackMessage: string;
      if (errorMessage.includes('ALREADY_VOTED_FOR_THAT_OPTION')) {
        snackMessage = t('core:message.error.app_already_voted', {
          postProcess: 'capitalizeFirstChar',
        });
      } else {
        snackMessage =
          errorMessage ||
          t('core:message.error.rate', {
            postProcess: 'capitalizeFirstChar',
          });
      }
      setInfoSnack({
        type: 'error',
        message: snackMessage,
      });
      setOpenSnack(true);
    }
  };

  return (
    <AppsLibraryContainer
      sx={{
        height: '100%',
        justifyContent: 'flex-start',
        overflow: 'auto',
      }}
    >
      <AppsBackContainer>
        <Spacer height="30px" />
        <AppsWidthLimiter
          sx={{
            justifyContent: 'space-between',
            aliginItems: 'center',
            flexDirection: 'row',
          }}
        >
          <ShowMessageReturnButton
            sx={{
              padding: '2px',
            }}
            onClick={() => {
              executeEvent('navigateBack', {});
            }}
          >
            <ReturnIcon />
            <ComposeP
              sx={{
                fontSize: '18px',
              }}
            >
              {t('core:action.return', {
                postProcess: 'capitalizeFirstChar',
              })}
            </ComposeP>
          </ShowMessageReturnButton>
        </AppsWidthLimiter>
        <Spacer height="20px" />
      </AppsBackContainer>

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          maxWidth: '600px',
          width: '90%',
          pb: 4,
        }}
      >
        <Spacer height="30px" />

        {/* App Header */}
        <AppsWidthLimiter>
          <AppInfoSnippetContainer>
            <AppInfoSnippetLeft
              sx={{
                flexGrow: 1,
                gap: '18px',
              }}
            >
              <AppCircleContainer
                sx={{
                  width: 'auto',
                }}
              >
                <AppCircle
                  sx={{
                    border: 'none',
                    height: '100px',
                    width: '100px',
                  }}
                >
                  <Avatar
                    sx={{
                      height: '50px',
                      width: '50px',
                      '& img': {
                        objectFit: 'fill',
                      },
                    }}
                    alt={app?.name}
                    src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${
                      app?.name
                    }/qortal_avatar?async=true`}
                  >
                    <img
                      style={{
                        width: '50px',
                        height: 'auto',
                      }}
                      src={LogoSelected}
                      alt="center-icon"
                    />
                  </Avatar>
                </AppCircle>
              </AppCircleContainer>

              <AppInfoSnippetMiddle>
                <AppInfoAppName
                  sx={{
                    fontSize: '24px',
                  }}
                >
                  {app?.metadata?.title || app?.name}
                </AppInfoAppName>

                <Spacer height="6px" />

                <AppInfoUserName
                  sx={{
                    fontSize: '14px',
                  }}
                >
                  {t('core:app_detail.by_developer', {
                    developer: app?.name,
                    postProcess: 'capitalizeFirstChar',
                  })}
                </AppInfoUserName>

                <Spacer height="8px" />

                <AppRating app={app} myName={myName} />
              </AppInfoSnippetMiddle>
            </AppInfoSnippetLeft>
          </AppInfoSnippetContainer>

          <Spacer height="20px" />

          {/* Action Buttons */}
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: '16px',
              width: '100%',
            }}
          >
            <AppButton
              onClick={() => {
                setSortablePinnedApps((prev) => {
                  let updatedApps;

                  if (isSelectedAppPinned) {
                    updatedApps = prev.filter(
                      (item) =>
                        !(
                          item?.name === app?.name &&
                          item?.service === app?.service
                        )
                    );
                  } else {
                    updatedApps = [
                      ...prev,
                      {
                        name: app?.name,
                        service: app?.service,
                      },
                    ];
                  }

                  saveToLocalStorage(
                    'ext_saved_settings',
                    'sortablePinnedApps',
                    updatedApps
                  );
                  return updatedApps;
                });
                setSettingsLocalLastUpdated(Date.now());
              }}
              sx={{
                backgroundColor: theme.palette.background.paper,
                height: '40px',
                flex: 1,
                opacity: isSelectedAppPinned ? 0.6 : 1,
              }}
            >
              <AppButtonText>
                {isSelectedAppPinned
                  ? t('core:action.unpin_from_dashboard', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : t('core:action.pin_to_dashboard', {
                      postProcess: 'capitalizeFirstChar',
                    })}
              </AppButtonText>
            </AppButton>

            <AppButton
              onClick={() => {
                executeEvent('addTab', {
                  data: app,
                });
              }}
              sx={{
                backgroundColor: isInstalled
                  ? theme.palette.primary.main
                  : theme.palette.background.paper,
                height: '40px',
                flex: 1,
              }}
            >
              <AppButtonText>
                {isInstalled
                  ? t('core:action.open', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : t('core:action.download', {
                      postProcess: 'capitalizeFirstChar',
                    })}
              </AppButtonText>
            </AppButton>
          </Box>
        </AppsWidthLimiter>

        <StyledDivider sx={{ my: 3 }} />

        {/* About Section */}
        <SectionContainer>
          <SectionTitle>
            {t('core:app_detail.about', {
              postProcess: 'capitalizeFirstChar',
            })}
          </SectionTitle>
          <AppsInfoDescription
            sx={{
              fontSize: '14px',
              lineHeight: 1.6,
            }}
          >
            {app?.metadata?.description ||
              t('core:message.generic.no_description', {
                postProcess: 'capitalizeFirstChar',
              })}
          </AppsInfoDescription>
        </SectionContainer>

        <StyledDivider sx={{ my: 2 }} />

        {/* Details Section */}
        <SectionContainer>
          <SectionTitle>
            {t('core:app_detail.details', {
              postProcess: 'capitalizeFirstChar',
            })}
          </SectionTitle>
          <AppDetailsSection app={app} />
        </SectionContainer>

        <StyledDivider sx={{ my: 2 }} />

        {/* Ratings Section */}
        <SectionContainer>
          <SectionTitle>
            {t('core:app_detail.ratings', {
              postProcess: 'capitalizeFirstChar',
            })}
          </SectionTitle>
          <AppRatingBreakdown app={app} myName={myName} onRate={handleRate} />
        </SectionContainer>
      </Box>

      <CustomizedSnackbars
        duration={3000}
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />
    </AppsLibraryContainer>
  );
};
