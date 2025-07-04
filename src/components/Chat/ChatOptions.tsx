import {
  Avatar,
  Box,
  ButtonBase,
  InputBase,
  MenuItem,
  Select,
  Typography,
  Tooltip,
  useTheme,
} from '@mui/material';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import SearchIcon from '@mui/icons-material/Search';
import { Spacer } from '../../common/Spacer';
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail';
import CloseIcon from '@mui/icons-material/Close';
import InsertLinkIcon from '@mui/icons-material/InsertLink';
import Highlight from '@tiptap/extension-highlight';
import Mention from '@tiptap/extension-mention';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import {
  AppsSearchContainer,
  AppsSearchLeft,
  AppsSearchRight,
} from '../Apps/Apps-styles';
import IconClearInput from '../../assets/svgs/ClearInput.svg';
import { getBaseApiReact } from '../../App';
import { MessageDisplay } from './MessageDisplay';
import { useVirtualizer } from '@tanstack/react-virtual';
import { formatTimestamp } from '../../utils/time';
import { ContextMenuMentions } from '../ContextMenuMentions';
import { convert } from 'html-to-text';
import { generateHTML } from '@tiptap/react';
import ErrorBoundary from '../../common/ErrorBoundary';
import { useTranslation } from 'react-i18next';
import { isHtmlString } from '../../utils/chat';
import TextStyle from '@tiptap/extension-text-style';

const extractTextFromHTML = (htmlString = '') => {
  return convert(htmlString, {
    wordwrap: false, // Disable word wrapping
  })?.toLowerCase();
};

export const ChatOptions = ({
  messages: untransformedMessages,
  goToMessage,
  members,
  myName,
  selectedGroup,
  openQManager,
  isPrivate,
}) => {
  const [mode, setMode] = useState('default');
  const [searchValue, setSearchValue] = useState('');
  const [selectedMember, setSelectedMember] = useState(0);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const parentRef = useRef(null);
  const parentRefMentions = useRef(null);
  const [lastMentionTimestamp, setLastMentionTimestamp] = useState(null);
  const [debouncedValue, setDebouncedValue] = useState(''); // Debounced value

  const messages = useMemo(() => {
    return untransformedMessages?.map((item) => {
      if (item?.messageText) {
        let transformedMessage = item?.messageText;
        const isHtml = isHtmlString(item?.messageText);
        try {
          transformedMessage = isHtml
            ? item?.messageText
            : generateHTML(item?.messageText, [
                StarterKit,
                Underline,
                Highlight,
                Mention,
                TextStyle,
              ]);
          return {
            ...item,
            messageText: transformedMessage,
          };
        } catch (error) {
          console.log(error);
        }
      } else return item;
    });
  }, [untransformedMessages]);

  const getTimestampMention = async () => {
    try {
      return new Promise((res, rej) => {
        window
          .sendMessage('getTimestampMention')
          .then((response) => {
            if (!response?.error) {
              if (response && selectedGroup && response[selectedGroup]) {
                setLastMentionTimestamp(response[selectedGroup]);
              }
              res(response);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
          });
      });
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    if (mode === 'mentions' && selectedGroup) {
      window
        .sendMessage('addTimestampMention', {
          timestamp: Date.now(),
          groupId: selectedGroup,
        })
        .then((res) => {
          getTimestampMention();
        })
        .catch((error) => {
          console.error(
            'Failed to add timestamp:',
            error.message || 'An error occurred'
          );
        });
    }
  }, [mode, selectedGroup]);

  useEffect(() => {
    getTimestampMention();
  }, []);

  // Debounce logic
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(searchValue);
    }, 350);

    // Cleanup timeout if searchValue changes before the timeout completes
    return () => {
      clearTimeout(handler);
    };
  }, [searchValue]); // Runs effect when searchValue changes

  const searchedList = useMemo(() => {
    if (!debouncedValue?.trim()) {
      if (selectedMember) {
        return messages
          .filter((message) => message?.senderName === selectedMember)
          ?.sort((a, b) => b?.timestamp - a?.timestamp);
      }
      return [];
    }

    if (selectedMember) {
      return messages
        .filter(
          (message) =>
            message?.senderName === selectedMember &&
            extractTextFromHTML(
              isPrivate ? message?.messageText : message?.decryptedData?.message
            )?.includes(debouncedValue.toLowerCase())
        )
        ?.sort((a, b) => b?.timestamp - a?.timestamp);
    }

    return messages
      .filter((message) =>
        extractTextFromHTML(
          isPrivate === false
            ? message?.messageText
            : message?.decryptedData?.message
        )?.includes(debouncedValue.toLowerCase())
      )
      ?.sort((a, b) => b?.timestamp - a?.timestamp);
  }, [debouncedValue, messages, selectedMember, isPrivate]);

  const mentionList = useMemo(() => {
    if (!messages || messages.length === 0 || !myName) return [];
    if (isPrivate === false) {
      return messages
        .filter((message) =>
          extractTextFromHTML(message?.messageText)?.includes(
            `@${myName?.toLowerCase()}`
          )
        )
        ?.sort((a, b) => b?.timestamp - a?.timestamp);
    }

    return messages
      .filter((message) =>
        extractTextFromHTML(message?.decryptedData?.message)?.includes(
          `@${myName?.toLowerCase()}`
        )
      )
      ?.sort((a, b) => b?.timestamp - a?.timestamp);
  }, [messages, myName, isPrivate]);

  const rowVirtualizer = useVirtualizer({
    count: searchedList.length,
    getItemKey: React.useCallback(
      (index) => searchedList[index].signature,
      [searchedList]
    ),
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80, // Provide an estimated height of items, adjust this as needed
    overscan: 10, // Number of items to render outside the visible area to improve smoothness
  });

  const rowVirtualizerMentions = useVirtualizer({
    count: mentionList.length,
    getItemKey: React.useCallback(
      (index) => mentionList[index].signature,
      [mentionList]
    ),
    getScrollElement: () => parentRefMentions.current,
    estimateSize: () => 80, // Provide an estimated height of items, adjust this as needed
    overscan: 10, // Number of items to render outside the visible area to improve smoothness
  });

  if (mode === 'mentions') {
    return (
      <Box
        sx={{
          backgroundColor: theme.palette.background.default,
          borderBottomLeftRadius: '20px',
          borderTopLeftRadius: '20px',
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 0,
          flexShrink: 0,
          height: '100%',
          overflow: 'auto',
          width: '300px',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '10px',
          }}
        >
          <CloseIcon
            onClick={() => {
              setMode('default');
            }}
            sx={{
              cursor: 'pointer',
              color: theme.palette.text.primary,
            }}
          />
        </Box>

        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            width: '100%',
          }}
        >
          {mentionList?.length === 0 && (
            <Typography
              sx={{
                fontSize: '14px',
                fontWeight: 400,
                color: theme.palette.text.primary,
              }}
            >
              {t('core:message.generic.no_results', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          )}

          <Box
            sx={{
              display: 'flex',
              height: '100%',
              width: '100%',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                position: 'relative',
                width: '100%',
              }}
            >
              <div
                ref={parentRefMentions}
                className="List"
                style={{
                  display: 'flex',
                  flexGrow: 1,
                  height: '0px',
                  overflow: 'auto',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    height: rowVirtualizerMentions.getTotalSize(),
                    width: '100%',
                  }}
                >
                  <div
                    style={{
                      left: 0,
                      position: 'absolute',
                      top: 0,
                      width: '100%',
                    }}
                  >
                    {rowVirtualizerMentions
                      .getVirtualItems()
                      .map((virtualRow) => {
                        const index = virtualRow.index;
                        let message = mentionList[index];
                        return (
                          <div
                            data-index={virtualRow.index} //needed for dynamic row height measurement
                            ref={rowVirtualizerMentions.measureElement} //measure dynamic row height
                            key={message.signature}
                            style={{
                              alignItems: 'center',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '5px',
                              left: '50%', // Move to the center horizontally
                              overscrollBehavior: 'none',
                              padding: '10px 0',
                              position: 'absolute',
                              top: 0,
                              transform: `translateY(${virtualRow.start}px) translateX(-50%)`, // Adjust for centering
                              width: '100%', // Control width (90% of the parent)
                            }}
                          >
                            <ShowMessage
                              messages={messages}
                              goToMessage={goToMessage}
                              message={message}
                            />
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>
            </div>
          </Box>
        </Box>
      </Box>
    );
  }

  if (mode === 'search') {
    return (
      <Box
        sx={{
          backgroundColor: theme.palette.background.paper,
          borderBottomLeftRadius: '20px',
          borderTopLeftRadius: '20px',
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 0,
          flexShrink: 0,
          height: '98%',
          overflow: 'auto',
          width: '300px',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '10px',
          }}
        >
          <CloseIcon
            onClick={() => {
              setMode('default');
            }}
            sx={{
              cursor: 'pointer',
              color: theme.palette.text.primary,
            }}
          />
        </Box>

        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            width: '100%',
          }}
        >
          <AppsSearchContainer>
            <AppsSearchLeft>
              <SearchIcon
                sx={{
                  color: theme.palette.text.primary,
                }}
              />
              <InputBase
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                sx={{ ml: 1, flex: 1 }}
                placeholder={t('core:action.search_chat_text', {
                  postProcess: 'capitalizeFirstChar',
                })}
                inputProps={{
                  'aria-label': t('core:action.search_apps', {
                    postProcess: 'capitalizeFirstChar',
                  }),
                  fontSize: '16px',
                  fontWeight: 400,
                }}
              />
            </AppsSearchLeft>

            <AppsSearchRight>
              {searchValue && (
                <ButtonBase
                  onClick={() => {
                    setSearchValue('');
                  }}
                >
                  <img src={IconClearInput} />
                </ButtonBase>
              )}
            </AppsSearchRight>
          </AppsSearchContainer>

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'space-between',
              padding: '10px',
            }}
          >
            <Select
              id="demo-simple-select"
              label={t('core:sort.by_member', {
                postProcess: 'capitalizeFirstChar',
              })}
              labelId="demo-simple-select-label"
              onChange={(e) => setSelectedMember(e.target.value)}
              size="small"
              value={selectedMember}
            >
              <MenuItem value={0}>
                <em>
                  {t('core:sort.by_member', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </em>
              </MenuItem>

              {members?.map((member) => {
                return (
                  <MenuItem key={member} value={member}>
                    {member}
                  </MenuItem>
                );
              })}
            </Select>

            {!!selectedMember && (
              <CloseIcon
                onClick={() => {
                  setSelectedMember(0);
                }}
                sx={{
                  cursor: 'pointer',
                  color: theme.palette.text.primary,
                }}
              />
            )}
          </Box>

          {debouncedValue && searchedList?.length === 0 && (
            <Typography
              sx={{
                fontSize: '11px',
                fontWeight: 400,
                color: theme.palette.text.secondary,
              }}
            >
              {t('core:message.generic.no_results', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          )}

          <Box
            sx={{
              display: 'flex',
              height: '100%',
              width: '100%',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                position: 'relative',
                width: '100%',
              }}
            >
              <div
                ref={parentRef}
                className="List"
                style={{
                  display: 'flex',
                  flexGrow: 1,
                  height: '0px',
                  overflow: 'auto',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    height: rowVirtualizer.getTotalSize(),
                    width: '100%',
                  }}
                >
                  <div
                    style={{
                      left: 0,
                      position: 'absolute',
                      top: 0,
                      width: '100%',
                    }}
                  >
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const index = virtualRow.index;
                      let message = searchedList[index];
                      return (
                        <div
                          data-index={virtualRow.index} //needed for dynamic row height measurement
                          ref={rowVirtualizer.measureElement} //measure dynamic row height
                          key={message.signature}
                          style={{
                            alignItems: 'center',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '5px',
                            left: '50%', // Move to the center horizontally
                            overscrollBehavior: 'none',
                            padding: '10px 0',
                            position: 'absolute',
                            top: 0,
                            transform: `translateY(${virtualRow.start}px) translateX(-50%)`, // Adjust for centering
                            width: '100%', // Control width (90% of the parent)
                          }}
                        >
                          <ErrorBoundary
                            fallback={
                              <Typography>
                                {t('group:message.generic.invalid_data', {
                                  postProcess: 'capitalizeFirstChar',
                                })}
                              </Typography>
                            }
                          >
                            <ShowMessage
                              message={message}
                              goToMessage={goToMessage}
                              messages={messages}
                            />
                          </ErrorBoundary>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        height: '100%',
        width: '50px',
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          backgroundColor: theme.palette.background.paper,
          borderBottomLeftRadius: '20px',
          borderTopLeftRadius: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          minHeight: '200px',
          padding: '10px',
          width: '100%',
        }}
      >
        <ButtonBase
          onClick={() => {
            setMode('search');
          }}
        >
          <Tooltip
            title={
              <span
                style={{
                  color: theme.palette.text.primary,
                  fontSize: '14px',
                  fontWeight: 700,
                }}
              >
                {t('core:action.search', { postProcess: 'capitalizeAll' })}
              </span>
            }
            placement="left"
            arrow
            sx={{ fontSize: '24' }}
            slotProps={{
              tooltip: {
                sx: {
                  color: theme.palette.text.primary,
                  backgroundColor: theme.palette.background.default,
                },
              },
              arrow: {
                sx: {
                  color: theme.palette.text.secondary,
                },
              },
            }}
          >
            <SearchIcon />
          </Tooltip>
        </ButtonBase>

        <ButtonBase
          onClick={() => {
            setMode('default');
            setSearchValue('');
            setSelectedMember(0);
            openQManager();
          }}
        >
          <Tooltip
            title={
              <span
                style={{
                  color: theme.palette.text.primary,
                  fontSize: '14px',
                  fontWeight: 700,
                }}
              >
                {t('core:q_apps.q_manager', { postProcess: 'capitalizeAll' })}
              </span>
            }
            placement="left"
            arrow
            sx={{ fontSize: '24' }}
            slotProps={{
              tooltip: {
                sx: {
                  color: theme.palette.text.primary,
                  backgroundColor: theme.palette.background.default,
                },
              },
              arrow: {
                sx: {
                  color: theme.palette.text.secondary,
                },
              },
            }}
          >
            <InsertLinkIcon sx={{ color: theme.palette.text.primary }} />
          </Tooltip>
        </ButtonBase>

        <ContextMenuMentions
          getTimestampMention={getTimestampMention}
          groupId={selectedGroup}
        >
          <ButtonBase
            onClick={() => {
              setMode('mentions');
              setSearchValue('');
              setSelectedMember(0);
            }}
          >
            <Tooltip
              title={
                <span
                  style={{
                    color: theme.palette.text.primary,
                    fontSize: '14px',
                    fontWeight: 700,
                  }}
                >
                  {t('core:message.generic.mentioned', {
                    postProcess: 'capitalizeAll',
                  })}
                </span>
              }
              placement="left"
              arrow
              sx={{ fontSize: '24' }}
              slotProps={{
                tooltip: {
                  sx: {
                    color: theme.palette.text.primary,
                    backgroundColor: theme.palette.background.default,
                  },
                },
                arrow: {
                  sx: {
                    color: theme.palette.text.secondary,
                  },
                },
              }}
            >
              <AlternateEmailIcon
                sx={{
                  color:
                    mentionList?.length > 0 &&
                    (!lastMentionTimestamp ||
                      lastMentionTimestamp < mentionList[0]?.timestamp)
                      ? theme.palette.other.unread
                      : theme.palette.text.primary,
                }}
              />
            </Tooltip>
          </ButtonBase>
        </ContextMenuMentions>
      </Box>
    </Box>
  );
};

const ShowMessage = ({ message, goToMessage, messages }) => {
  const theme = useTheme();

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        padding: '0px 20px',
        width: '100%',
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          background: theme.palette.background.surface,
          display: 'flex',
          justifyContent: 'space-between',
          width: '100%',
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: '15px',
          }}
        >
          <Avatar
            sx={{
              backgroundColor: theme.palette.background.default,
              color: theme.palette.text.primary,
              height: '25px',
              width: '25px',
            }}
            alt={message?.senderName}
            src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${
              message?.senderName
            }/qortal_avatar?async=true`}
          >
            {message?.senderName?.charAt(0)}
          </Avatar>

          <Typography
            sx={{
              fontWight: 600,
              fontFamily: 'Inter',
            }}
          >
            {message?.senderName}
          </Typography>
        </Box>
      </Box>

      <Spacer height="5px" />

      <Typography
        sx={{
          fontSize: '12px',
        }}
      >
        {formatTimestamp(message.timestamp)}
      </Typography>

      <Box
        style={{
          cursor: 'pointer',
        }}
        onClick={() => {
          const findMsgIndex = messages.findIndex(
            (item) => item?.signature === message?.signature
          );
          if (findMsgIndex !== -1) {
            goToMessage(findMsgIndex);
          }
        }}
      >
        {message?.messageText && (
          <MessageDisplay htmlContent={message?.messageText} />
        )}
        {message?.decryptedData?.message && (
          <MessageDisplay
            htmlContent={message?.decryptedData?.message || '<p></p>'}
          />
        )}
      </Box>
    </Box>
  );
};
