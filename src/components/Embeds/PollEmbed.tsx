import { useContext, useEffect, useState } from 'react';
import { QORTAL_APP_CONTEXT } from '../../App';
import {
  Card,
  CardContent,
  CardHeader,
  Typography,
  RadioGroup,
  Radio,
  FormControlLabel,
  Button,
  Box,
  ButtonBase,
  Divider,
  useTheme,
} from '@mui/material';
import { getNameInfo } from '../Group/Group';
import PollIcon from '@mui/icons-material/Poll';
import { getFee } from '../../background/background.ts';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Spacer } from '../../common/Spacer';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { CustomLoader } from '../../common/CustomLoader';
import { useTranslation } from 'react-i18next';
import { TIME_MINUTE_1_IN_MILLISECONDS } from '../../constants/constants.ts';

export const PollCard = ({
  poll,
  setInfoSnack,
  setOpenSnack,
  refresh,
  openExternal,
  external,
  isLoadingParent,
  errorMsg,
}) => {
  const [selectedOption, setSelectedOption] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const { show, userInfo } = useContext(QORTAL_APP_CONTEXT);
  const [isLoadingSubmit, setIsLoadingSubmit] = useState(false);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const handleVote = async () => {
    const fee = await getFee('VOTE_ON_POLL');

    await show({
      message: t('core:question.accept_vote_on_poll', {
        postProcess: 'capitalizeFirstChar',
      }),
      publishFee: fee.fee + ' QORT',
    });
    setIsLoadingSubmit(true);

    window
      .sendMessage(
        'voteOnPoll',
        {
          pollName: poll?.info?.pollName,
          optionIndex: +selectedOption,
        },
        TIME_MINUTE_1_IN_MILLISECONDS
      )
      .then((response) => {
        setIsLoadingSubmit(false);
        if (response.error) {
          setInfoSnack({
            type: 'error',
            message:
              response?.error ||
              t('core:message.error.vote', {
                postProcess: 'capitalizeFirstChar',
              }),
          });
          setOpenSnack(true);
          return;
        } else {
          setInfoSnack({
            type: 'success',
            message: t('core:message.success.voted', {
              postProcess: 'capitalizeFirstChar',
            }),
          });
          setOpenSnack(true);
        }
      })
      .catch((error) => {
        setIsLoadingSubmit(false);
        setInfoSnack({
          type: 'error',
          message:
            error?.message ||
            t('core:message.error.vote', {
              postProcess: 'capitalizeFirstChar',
            }),
        });
        setOpenSnack(true);
      });
  };

  const getName = async (owner) => {
    try {
      const res = await getNameInfo(owner);
      if (res) {
        setOwnerName(res);
      }
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    if (poll?.info?.owner) {
      getName(poll.info.owner);
    }
  }, [poll?.info?.owner]);

  return (
    <Card
      sx={{
        backgroundColor: theme.palette.background.default,
        height: isOpen ? 'auto' : '150px',
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          padding: '16px 16px 0px 16px',
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: '10px',
          }}
        >
          <PollIcon
            sx={{
              color: theme.palette.text.primary,
            }}
          />
          <Typography>
            {t('core:poll_embed', { postProcess: 'capitalizeFirstWord' })}
          </Typography>
        </Box>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <ButtonBase>
            <RefreshIcon
              onClick={refresh}
              sx={{
                fontSize: '24px',
                color: theme.palette.text.primary,
              }}
            />
          </ButtonBase>

          {external && (
            <ButtonBase>
              <OpenInNewIcon
                onClick={openExternal}
                sx={{
                  fontSize: '24px',
                  color: theme.palette.text.primary,
                }}
              />
            </ButtonBase>
          )}
        </Box>
      </Box>
      <Box
        sx={{
          padding: '8px 16px 8px 16px',
        }}
      >
        <Typography
          sx={{
            fontSize: '12px',
          }}
        >
          {t('core:message.generic.created_by', {
            owner: poll?.info?.owner,
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
      </Box>

      <Divider sx={{ borderColor: 'rgb(255 255 255 / 10%)' }} />

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
        }}
      >
        {!isOpen && !errorMsg && (
          <>
            <Spacer height="5px" />
            <Button
              size="small"
              variant="contained"
              onClick={() => {
                setIsOpen(true);
              }}
            >
              {t('core:action.show_poll', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
          </>
        )}

        {isLoadingParent && isOpen && (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              width: '100%',
            }}
          >
            <CustomLoader />
          </Box>
        )}

        {errorMsg && (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              width: '100%',
            }}
          >
            <Typography
              sx={{
                fontSize: '14px',
                color: theme.palette.other.danger,
              }}
            >
              {errorMsg}
            </Typography>
          </Box>
        )}
      </Box>

      <Box
        sx={{
          display: isOpen ? 'block' : 'none',
        }}
      >
        <CardHeader
          title={poll?.info?.pollName}
          subheader={poll?.info?.description}
          sx={{
            '& .MuiCardHeader-title': {
              fontSize: '18px', // Custom font size for title
            },
          }}
        />

        <CardContent>
          <Typography
            sx={{
              fontSize: '18px',
            }}
          >
            {t('core:option_other', { postProcess: 'capitalizeFirstChar' })}
          </Typography>

          <RadioGroup
            value={selectedOption}
            onChange={(e) => setSelectedOption(e.target.value)}
          >
            {poll?.info?.pollOptions?.map((option, index) => (
              <FormControlLabel
                key={index}
                value={index}
                control={<Radio />}
                label={option?.optionName}
                sx={{
                  '& .MuiFormControlLabel-label': {
                    fontSize: '14px',
                  },
                }}
              />
            ))}
          </RadioGroup>

          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: '20px',
            }}
          >
            <Button
              variant="contained"
              color="primary"
              disabled={!selectedOption || isLoadingSubmit}
              onClick={handleVote}
            >
              {t('core:action.vote', { postProcess: 'capitalizeFirstChar' })}
            </Button>

            <Typography
              sx={{
                fontSize: '14px',
                fontStyle: 'italic',
              }}
            >
              {poll?.votes?.totalVotes}{' '}
              {poll?.votes?.totalVotes === 1 ? ' vote' : ' votes'}
            </Typography>
          </Box>

          <Spacer height="10px" />

          <Typography
            sx={{
              fontSize: '14px',
              visibility: poll?.votes?.votes?.find(
                (item) => item?.voterPublicKey === userInfo?.publicKey
              )
                ? 'visible'
                : 'hidden',
            }}
          >
            {t('core:message.generic.already_voted', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>

          <Spacer height="10px" />

          {isLoadingSubmit && (
            <Typography
              sx={{
                fontSize: '12px',
              }}
            >
              {t('core:message.generic.processing_transaction', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          )}

          <ButtonBase
            onClick={() => {
              setShowResults((prev) => !prev);
            }}
          >
            {showResults
              ? t('core:action.hide', { postProcess: 'capitalizeFirstChar' })
              : t('core:action.close', { postProcess: 'capitalizeFirstChar' })}
          </ButtonBase>
        </CardContent>

        {showResults && <PollResults votes={poll?.votes} />}
      </Box>
    </Card>
  );
};

const PollResults = ({ votes }) => {
  const maxVotes = Math.max(
    ...votes?.voteCounts?.map((option) => option.voteCount)
  );
  const options = votes?.voteCounts;
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  return (
    <Box sx={{ width: '100%', p: 2 }}>
      {options
        .sort((a, b) => b.voteCount - a.voteCount) // Sort options by votes (highest first)
        .map((option, index) => (
          <Box key={index} sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography
                variant="body1"
                sx={{
                  fontWeight: index === 0 ? 'bold' : 'normal',
                  fontSize: '14px',
                }}
              >
                {`${index + 1}. ${option.optionName}`}
              </Typography>

              <Typography
                variant="body1"
                sx={{
                  fontWeight: index === 0 ? 'bold' : 'normal',
                  fontSize: '14px',
                }}
              >
                {t('core:vote', { count: option.voteCount })}
              </Typography>
            </Box>

            <Box
              sx={{
                backgroundColor: '#e0e0e0',
                borderRadius: 5,
                height: 10,
                mt: 1,
                overflow: 'hidden',
              }}
            >
              <Box
                sx={{
                  backgroundColor: index === 0 ? '#3f51b5' : '#f50057',
                  height: '100%',
                  transition: 'width 0.3s ease-in-out',
                  width: `${(option.voteCount / maxVotes) * 100}%`,
                }}
              />
            </Box>
          </Box>
        ))}
    </Box>
  );
};
