import { useCallback, useEffect, useState } from 'react';
import { MessageDisplay } from './MessageDisplay';
import { alpha } from '@mui/material/styles';
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
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        transition: 'background-color 0.1s ease',
        '&:hover': {
          backgroundColor: alpha(theme.palette.text.primary, 0.04),
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          gap: '12px',
          padding: '10px 16px 8px',
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
              height: 40,
              width: 40,
              flexShrink: 0,
              backgroundColor: theme.palette.background.default,
              border: '2px solid',
              borderColor: 'divider',
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
            gap: '6px',
            flex: 1,
            minWidth: 0,
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <WrapperUserAction
              disabled={myName === message?.name}
              address={undefined}
              name={message?.name}
            >
              <Typography
                sx={{
                  fontWeight: 600,
                  fontFamily: 'Inter',
                  fontSize: '15px',
                  color: theme.palette.text.primary,
                }}
              >
                {message?.name}
              </Typography>
            </WrapperUserAction>
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontFamily: 'Inter',
                fontSize: '12px',
                flexShrink: 0,
              }}
            >
              {formatTimestamp(message.created)}
            </Typography>
          </Box>

          {!messageData?.decryptedData && (
            <Box
              sx={{
                width: '100%',
                display: 'flex',
                justifyContent: 'center',
                py: 1,
              }}
            >
              <CustomLoader />
            </Box>
          )}

          {messageData?.decryptedData?.message && (
            <Box
              sx={{
                '& .tiptap': {
                  fontSize: '15px',
                  lineHeight: 1.6,
                  color: theme.palette.text.primary,
                },
                '& .tiptap p': {
                  marginTop: 0,
                  marginBottom: '0.5em',
                },
                '& .tiptap p:last-child': {
                  marginBottom: 0,
                },
              }}
            >
              {messageData?.type === 'notification' ? (
                <MessageDisplay
                  htmlContent={messageData?.decryptedData?.message}
                />
              ) : (
                <MessageDisplay
                  htmlContent={messageData?.decryptedData?.message}
                />
              )}
            </Box>
          )}
        </Box>
      </Box>

      {!disableComment && (
        <Box
          sx={{
            alignItems: 'center',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            padding: '6px 16px 12px 48px',
            width: '100%',
            color: theme.palette.text.secondary,
            transition: 'color 0.15s ease',
            '&:hover': {
              color: theme.palette.primary.main,
            },
          }}
          onClick={() => setSelectedAnnouncement(message)}
        >
          <Box sx={{ alignItems: 'center', display: 'flex', gap: '6px' }}>
            <ChatBubbleIcon sx={{ fontSize: '16px' }} />
            {commentLength ? (
              <Typography
                sx={{
                  fontSize: '13px',
                  fontFamily: 'Inter',
                  fontWeight: 500,
                }}
              >{`${commentLength > 1 ? `${commentLength} comments` : `${commentLength} comment`}`}</Typography>
            ) : (
              <Typography
                sx={{
                  fontSize: '13px',
                  fontFamily: 'Inter',
                  fontWeight: 500,
                }}
              >
                {t('core:action.leave_comment', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            )}
          </Box>
          <ArrowForwardIosIcon sx={{ fontSize: '12px', flexShrink: 0 }} />
        </Box>
      )}
    </Box>
  );
};
