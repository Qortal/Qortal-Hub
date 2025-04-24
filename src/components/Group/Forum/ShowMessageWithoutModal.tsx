import { useState } from 'react';
import { Avatar, Box, IconButton } from '@mui/material';
import DOMPurify from 'dompurify';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import MoreSVG from '../../../assets/svgs/More.svg';

import {
  MoreImg,
  MoreP,
  SingleTheadMessageParent,
  ThreadInfoColumn,
  ThreadInfoColumnNameP,
  ThreadInfoColumnTime,
} from './Mail-styles';
import { Spacer } from '../../../common/Spacer';
import { formatTimestampForum } from '../../../utils/time';
import ReadOnlySlate from './ReadOnlySlate';
import { MessageDisplay } from '../../Chat/MessageDisplay';
import { getBaseApiReact } from '../../../App';
import { WrapperUserAction } from '../../WrapperUserAction';

export const ShowMessage = ({ message, openNewPostWithQuote, myName }: any) => {
  const [expandAttachments, setExpandAttachments] = useState<boolean>(false);

  let cleanHTML = '';
  if (message?.htmlContent) {
    cleanHTML = DOMPurify.sanitize(message.htmlContent);
  }

  return (
    <SingleTheadMessageParent
      sx={{
        height: 'auto',
        alignItems: 'flex-start',
        cursor: 'default',
        borderRadius: '35px 4px 4px 4px',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          width: '100%',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
          }}
        >
          <WrapperUserAction
            disabled={myName === message?.name}
            address={undefined}
            name={message?.name}
          >
            <Avatar
              sx={{
                height: '50px',
                width: '50px',
              }}
              src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${message?.name}/qortal_avatar?async=true`}
              alt={message?.name}
            >
              {message?.name?.charAt(0)}
            </Avatar>
          </WrapperUserAction>
          <ThreadInfoColumn>
            <WrapperUserAction
              disabled={myName === message?.name}
              address={undefined}
              name={message?.name}
            >
              <ThreadInfoColumnNameP>{message?.name}</ThreadInfoColumnNameP>
            </WrapperUserAction>
            <ThreadInfoColumnTime>
              {formatTimestampForum(message?.created)}
            </ThreadInfoColumnTime>
          </ThreadInfoColumn>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}
          >
            {message?.attachments?.length > 0 && (
              <Box
                sx={{
                  width: '100%',
                  marginTop: '10px',
                }}
              >
                {message?.attachments.map((file: any, index: number) => {
                  const isFirst = index === 0;
                  return (
                    <Box
                      sx={{
                        display: expandAttachments
                          ? 'flex'
                          : !expandAttachments && isFirst
                            ? 'flex'
                            : 'none',
                        alignItems: 'center',
                        justifyContent: 'flex-start',
                        width: '100%',
                      }}
                    >
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                          cursor: 'pointer',
                          width: 'auto',
                        }}
                      >
                        {/* <FileElement
                        fileInfo={{ ...file, mimeTypeSaved: file?.type }}
                        title={file?.filename}
                        mode="mail"
                        otherUser={message?.user}
                      >
                        <MailAttachmentImg src={AttachmentMailSVG} />

                        <Typography
                          sx={{
                            fontSize: "16px",
                            transition: '0.2s all',
                            "&:hover": {
                              color: 'rgba(255, 255, 255, 0.90)',
                              textDecoration: 'underline'
                            }
                          }}
                        >
                          {file?.originalFilename || file?.filename}
                        </Typography>
                      </FileElement> */}
                        {message?.attachments?.length > 1 && isFirst && (
                          <Box
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '5px',
                            }}
                            onClick={() => {
                              setExpandAttachments((prev) => !prev);
                            }}
                          >
                            <MoreImg
                              sx={{
                                marginLeft: '5px',
                                transform: expandAttachments
                                  ? 'rotate(180deg)'
                                  : 'unset',
                              }}
                              src={MoreSVG}
                            />
                            <MoreP>
                              {expandAttachments
                                ? 'hide'
                                : `(${message?.attachments?.length - 1} more)`}
                            </MoreP>
                          </Box>
                        )}
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}
          </div>
        </Box>

        <Spacer height="20px" />

        {message?.reply?.textContentV2 && (
          <>
            <Box
              sx={{
                width: '100%',
                opacity: 0.7,
                borderRadius: '5px',
                border: '1px solid gray',
                boxSizing: 'border-box',
                padding: '5px',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                }}
              >
                <Avatar
                  sx={{
                    height: '30px',
                    width: '30px',
                  }}
                  src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${message?.reply?.name}/qortal_avatar?async=true`}
                  alt={message?.reply?.name}
                >
                  {message?.reply?.name?.charAt(0)}
                </Avatar>
                <ThreadInfoColumn>
                  <ThreadInfoColumnNameP
                    sx={{
                      fontSize: '14px',
                    }}
                  >
                    {message?.reply?.name}
                  </ThreadInfoColumnNameP>
                </ThreadInfoColumn>
              </Box>
              <MessageDisplay htmlContent={message?.reply?.textContentV2} />
            </Box>
            <Spacer height="20px" />
          </>
        )}

        {message?.textContent && (
          <ReadOnlySlate content={message.textContent} mode="mail" />
        )}
        {message?.textContentV2 && (
          <MessageDisplay htmlContent={message?.textContentV2} />
        )}
        {message?.htmlContent && (
          <div dangerouslySetInnerHTML={{ __html: cleanHTML }} />
        )}
        <Box
          sx={{
            width: '100%',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <IconButton onClick={() => openNewPostWithQuote(message)}>
            <FormatQuoteIcon />
          </IconButton>
        </Box>
      </Box>
    </SingleTheadMessageParent>
  );
};
