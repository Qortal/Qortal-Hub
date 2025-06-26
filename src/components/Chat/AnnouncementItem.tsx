import { useCallback, useEffect, useState } from 'react';
import { MessageDisplay } from './MessageDisplay';
import { Avatar, Box, Typography, useTheme } from '@mui/material';
import { formatTimestamp } from '../../utils/time';
import ChatBubbleIcon from '@mui/icons-material/ChatBubble';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import { requestQueueCommentCount } from './GroupAnnouncements';
import { CustomLoader } from '../../common/CustomLoader';
import { getArbitraryEndpointReact, getBaseApiReact } from '../../App';
import { WrapperUserAction } from '../WrapperUserAction';
import { useTranslation } from 'react-i18next';

export const AnnouncementItem = ({
  message,
  messageData,
  setSelectedAnnouncement,
  disableComment,
  myName,
}) => {
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const [commentLength, setCommentLength] = useState(0);

  const getNumberOfComments = useCallback(async () => {
    try {
      const offset = 0;
      const identifier = `cm-${message.identifier}`;
      const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=DOCUMENT&identifier=${identifier}&limit=0&includemetadata=false&offset=${offset}&reverse=true&prefix=true`;

      const response = await requestQueueCommentCount.enqueue(() => {
        return fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
      });
      const responseData = await response.json();

      setCommentLength(responseData?.length);
    } catch (error) {
      console.log(error);
    }
  }, []);

  useEffect(() => {
    if (disableComment) return;
    getNumberOfComments();
  }, []);

  return (
    <div
      style={{
        backgroundColor: theme.palette.background.paper,
        borderRadius: '7px',
        display: 'flex',
        flexDirection: 'column',
        gap: '7px',
        padding: '10px',
        width: '95%',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          gap: '7px',
          width: '100%',
          wordBreak: 'break-word',
        }}
      >
        <WrapperUserAction
          disabled={myName === message?.name}
          address={undefined}
          name={message?.name}
        >
          <Avatar
            sx={{
              backgroundColor: theme.palette.background.default,
              color: theme.palette.text.primary,
            }}
            alt={message?.name}
            src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${message?.name}/qortal_avatar?async=true`}
          >
            {message?.name?.charAt(0)}
          </Avatar>
        </WrapperUserAction>

        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: '7px',
            width: '100%',
          }}
        >
          <WrapperUserAction
            disabled={myName === message?.name}
            address={undefined}
            name={message?.name}
          >
            <Typography
              sx={{
                fontWight: 600,
                fontFamily: 'Inter',
              }}
            >
              {message?.name}
            </Typography>
          </WrapperUserAction>

          {!messageData?.decryptedData && (
            <Box
              sx={{
                width: '100%',
                display: 'flex',
                justifyContent: 'center',
              }}
            >
              <CustomLoader />
            </Box>
          )}

          {messageData?.decryptedData?.message && (
            <>
              {messageData?.type === 'notification' ? (
                <MessageDisplay
                  htmlContent={messageData?.decryptedData?.message}
                />
              ) : (
                <MessageDisplay
                  htmlContent={messageData?.decryptedData?.message}
                />
              )}
            </>
          )}

          <Box
            sx={{
              display: 'flex',
              justifyContent: 'flex-end',
              width: '100%',
            }}
          >
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontFamily: 'Inter',
                fontSize: '14px',
              }}
            >
              {formatTimestamp(message.created)}
            </Typography>
          </Box>
        </Box>
      </Box>

      {!disableComment && (
        <Box
          sx={{
            alignItems: 'center',
            borderTop: '1px solid white',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            opacity: 0.4,
            padding: '20px',
            width: '100%',
          }}
          onClick={() => setSelectedAnnouncement(message)}
        >
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: '25px',
              width: '100%',
            }}
          >
            <ChatBubbleIcon
              sx={{
                fontSize: '20px',
              }}
            />
            {commentLength ? (
              <Typography
                sx={{
                  fontSize: '14px',
                }}
              >{`${commentLength > 1 ? `${commentLength} comments` : `${commentLength} comment`}`}</Typography>
            ) : (
              <Typography
                sx={{
                  fontSize: '14px',
                }}
              >
                {t('core:action.leave_comment', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            )}
          </Box>

          <ArrowForwardIosIcon
            sx={{
              fontSize: '20px',
            }}
          />
        </Box>
      )}
    </div>
  );
};
