import { Box, Rating } from '@mui/material';
import { useContext, useState } from 'react';
import { getFee } from '../../background/background.ts';
import { QORTAL_APP_CONTEXT } from '../../App';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { StarFilledIcon } from '../../assets/Icons/StarFilled';
import { StarEmptyIcon } from '../../assets/Icons/StarEmpty';
import { AppInfoUserName } from './Apps-styles';
import { Spacer } from '../../common/Spacer';
import { useTranslation } from 'react-i18next';
import { TIME_MINUTES_1_IN_MILLISECONDS } from '../../constants/constants.ts';
import { useAppRating } from '../../hooks/useAppRatings';

export const AppRating = ({ app, myName, ratingCountPosition = 'right' }) => {
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  // Use centralized rating store with visibility-based fetching
  const { rating, containerRef, refresh } = useAppRating(
    app?.name,
    app?.service
  );

  const value = rating?.averageRating ?? 0;
  const hasPublishedRating = rating?.hasPublishedRating ?? null;
  const pollInfo = rating?.pollInfo ?? null;
  const votesInfo = rating
    ? { totalVotes: rating.totalVotes, voteCounts: rating.voteCounts }
    : null;

  const rateFunc = async (event, chosenValue, currentValue) => {
    try {
      const newValue = chosenValue || currentValue;
      if (!myName)
        throw new Error(
          t('core:message.generic.name_rate', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      if (!app?.name) return;
      const fee = await getFee('CREATE_POLL');

      await show({
        message: t('core:message.question.rate_app', {
          rate: newValue,
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });

      if (hasPublishedRating === false) {
        const pollName = `app-library-${app.service}-rating-${app.name}`;
        const pollOptions = [`1, 2, 3, 4, 5, initialValue-${newValue}`];
        const pollDescription = t('core:message.error.generic', {
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
            .then((response) => {
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
                // Refresh rating after successful submission
                refresh();
              }
            })
            .catch((error) => {
              rej(error);
            });
        });
      } else {
        const pollName = `app-library-${app.service}-rating-${app.name}`;

        const optionIndex = pollInfo?.pollOptions.findIndex(
          (option) => +option.optionName === +newValue
        );
        if (isNaN(optionIndex) || optionIndex === -1)
          throw new Error(
            t('core:message.error.rating_option', {
              postProcess: 'capitalizeFirstChar',
            })
          );
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
            .then((response) => {
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
                // Refresh rating after successful submission
                refresh();
              }
            })
            .catch((error) => {
              rej(error);
            });
        });
      }
    } catch (error) {
      console.log('error', error);
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
    <div ref={containerRef}>
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexDirection: ratingCountPosition === 'top' ? 'column' : 'row',
        }}
      >
        {ratingCountPosition === 'top' && (
          <>
            <AppInfoUserName>
              {votesInfo?.totalVotes ?? 0}
              {' RATINGS'}
            </AppInfoUserName>

            <Spacer height="6px" />

            <AppInfoUserName>{value?.toFixed(1)}</AppInfoUserName>

            <Spacer height="6px" />
          </>
        )}

        <Rating
          value={value}
          onChange={(event, rating) => rateFunc(event, rating, value)}
          precision={1}
          size="small"
          icon={<StarFilledIcon />}
          emptyIcon={<StarEmptyIcon />}
          sx={{
            display: 'flex',
            gap: '2px',
          }}
        />
        {ratingCountPosition === 'right' && (
          <AppInfoUserName>{votesInfo?.totalVotes ?? 0}</AppInfoUserName>
        )}
      </Box>

      <CustomizedSnackbars
        duration={2000}
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />
    </div>
  );
};
