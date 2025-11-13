import { Box, Rating } from '@mui/material';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getFee } from '../../background/background.ts';
import { QORTAL_APP_CONTEXT, getBaseApiReact } from '../../App';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { StarFilledIcon } from '../../assets/Icons/StarFilled';
import { StarEmptyIcon } from '../../assets/Icons/StarEmpty';
import { AppInfoUserName } from './Apps-styles';
import { Spacer } from '../../common/Spacer';
import { useTranslation } from 'react-i18next';
import { TIME_MINUTES_1_IN_MILLISECONDS } from '../../constants/constants.ts';

export const AppRating = ({ app, myName, ratingCountPosition = 'right' }) => {
  const [value, setValue] = useState(0);
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const [hasPublishedRating, setHasPublishedRating] = useState<null | boolean>(
    null
  );
  const [pollInfo, setPollInfo] = useState(null);
  const [votesInfo, setVotesInfo] = useState(null);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const hasCalledRef = useRef(false);
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const getRating = useCallback(async (name, service) => {
    try {
      hasCalledRef.current = true;
      const pollName = `app-library-${service}-rating-${name}`;
      const url = `${getBaseApiReact()}/polls/${pollName}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const responseData = await response.json();
      if (responseData?.message?.includes('POLL_NO_EXISTS')) {
        setHasPublishedRating(false);
      } else if (responseData?.pollName) {
        setPollInfo(responseData);
        setHasPublishedRating(true);
        const urlVotes = `${getBaseApiReact()}/polls/votes/${pollName}`;

        const responseVotes = await fetch(urlVotes, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        const responseDataVotes = await responseVotes.json();
        setVotesInfo(responseDataVotes);
        const voteCount = responseDataVotes.voteCounts;
        // Include initial value vote in the calculation
        const ratingVotes = voteCount.filter(
          (vote) => !vote.optionName.startsWith('initialValue-')
        );
        const initialValueVote = voteCount.find((vote) =>
          vote.optionName.startsWith('initialValue-')
        );
        if (initialValueVote) {
          // Convert "initialValue-X" to just "X" and add it to the ratingVotes array
          const initialRating = parseInt(
            initialValueVote.optionName.split('-')[1],
            10
          );
          ratingVotes.push({
            optionName: initialRating.toString(),
            voteCount: 1,
          });
        }

        // Calculate the weighted average
        let totalScore = 0;
        let totalVotes = 0;

        ratingVotes.forEach((vote) => {
          const rating = parseInt(vote.optionName, 10); // Extract rating value (1-5)
          const count = vote.voteCount;
          totalScore += rating * count; // Weighted score
          totalVotes += count; // Total number of votes
        });

        // Calculate average rating (ensure no division by zero)
        const averageRating = totalVotes > 0 ? totalScore / totalVotes : 0;
        setValue(averageRating);
      }
    } catch (error) {
      if (error?.message?.includes('POLL_NO_EXISTS')) {
        setHasPublishedRating(false);
      }
    }
  }, []);

  useEffect(() => {
    if (hasCalledRef.current) return;
    if (!app) return;
    getRating(app?.name, app?.service);
  }, [getRating, app?.name]);

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
              }
            })
            .catch((error) => {
              console.error('Failed qortalRequest', error);
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
              }
            })
            .catch((error) => {
              console.error('Failed qortalRequest', error);
            });
        });
      }
    } catch (error) {
      console.log('error', error);
      setInfoSnack({
        type: 'error',
        message:
          error?.message ||
          t('core:message.error.rate', {
            postProcess: 'capitalizeFirstChar',
          }),
      });
      setOpenSnack(true);
    }
  };

  return (
    <div>
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
              {(votesInfo?.totalVotes ?? 0) +
                (votesInfo?.voteCounts?.length === 6 ? 1 : 0)}{' '}
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
          <AppInfoUserName>
            {(votesInfo?.totalVotes ?? 0) +
              (votesInfo?.voteCounts?.length === 6 ? 1 : 0)}
          </AppInfoUserName>
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
