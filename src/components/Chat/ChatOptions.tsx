import {
  Avatar,
  Box,
  ButtonBase,
  InputBase,
  MenuItem,
  Select,
  Typography,
  Tooltip
} from "@mui/material";
import React, { useEffect, useMemo, useRef, useState } from "react";
import SearchIcon from "@mui/icons-material/Search";
import { Spacer } from "../../common/Spacer";
import AlternateEmailIcon from "@mui/icons-material/AlternateEmail";
import CloseIcon from "@mui/icons-material/Close";
import InsertLinkIcon from '@mui/icons-material/InsertLink';
import Highlight from "@tiptap/extension-highlight";
import Mention from "@tiptap/extension-mention";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import {
  AppsSearchContainer,
  AppsSearchLeft,
  AppsSearchRight,
} from "../Apps/Apps-styles";
import IconSearch from "../../assets/svgs/Search.svg";
import IconClearInput from "../../assets/svgs/ClearInput.svg";
import {
  AutoSizer,
  CellMeasurer,
  CellMeasurerCache,
  List,
} from "react-virtualized";
import { getBaseApiReact } from "../../App";
import { MessageDisplay } from "./MessageDisplay";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatTimestamp } from "../../utils/time";
import { ContextMenuMentions } from "../ContextMenuMentions";
import { convert } from 'html-to-text';
import { generateHTML } from "@tiptap/react";
import ErrorBoundary from "../../common/ErrorBoundary";

const extractTextFromHTML = (htmlString = '') => {
  return convert(htmlString, {
    wordwrap: false, // Disable word wrapping
  })?.toLowerCase();
};
const cache = new CellMeasurerCache({
  fixedWidth: true,
  defaultHeight: 50,
});

export const ChatOptions = ({ messages : untransformedMessages, goToMessage, members, myName, selectedGroup, openQManager, isPrivate }) => {
  const [mode, setMode] = useState("default");
  const [searchValue, setSearchValue] = useState("");
  const [selectedMember, setSelectedMember] = useState(0);

  const parentRef = useRef();
  const parentRefMentions = useRef();
  const [lastMentionTimestamp, setLastMentionTimestamp] = useState(null)
  const [debouncedValue, setDebouncedValue] = useState(""); // Debounced value
  const messages = useMemo(()=> {
    return untransformedMessages?.map((item)=> {
      if(item?.messageText){
        let transformedMessage = item?.messageText
        try {
            transformedMessage = generateHTML(item?.messageText, [
              StarterKit,
              Underline,
              Highlight,
              Mention
            ])
            return {
              ...item,
              messageText: transformedMessage
            }
        } catch (error) {
          // error
        }
      } else return item
    })
  }, [untransformedMessages])
  const getTimestampMention = async () => {
    try {
      return new Promise((res, rej) => {
        window.sendMessage("getTimestampMention")
  .then((response) => {
    if (!response?.error) {
      if(response && selectedGroup && response[selectedGroup]){
        setLastMentionTimestamp(response[selectedGroup])
        
     
        

      
      }
    
      res(response);
      return;
    }
    rej(response.error);
  })
  .catch((error) => {
    rej(error.message || "An error occurred");
  });

      });
    } catch (error) {}
  };

  useEffect(()=> {
    if(mode === 'mentions' && selectedGroup){
      window.sendMessage("addTimestampMention", {
        timestamp: Date.now(),
        groupId: selectedGroup
      }).then((res)=> {
        getTimestampMention()
      }).catch((error) => {
          console.error("Failed to add timestamp:", error.message || "An error occurred");
        });
    }
  }, [mode, selectedGroup])

  useEffect(()=> {
    getTimestampMention()
  }, [])

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
            extractTextFromHTML(isPrivate ? message?.messageText : message?.decryptedData?.message)?.includes(
              debouncedValue.toLowerCase()
            )
        )
        ?.sort((a, b) => b?.timestamp - a?.timestamp);
    }
    return messages
      .filter((message) =>
      extractTextFromHTML(isPrivate === false ? message?.messageText : message?.decryptedData?.message)?.includes(debouncedValue.toLowerCase())
      )
      ?.sort((a, b) => b?.timestamp - a?.timestamp);
  }, [debouncedValue, messages, selectedMember, isPrivate]);

  const mentionList = useMemo(() => {
    if(!messages || messages.length === 0 || !myName) return []
    if(isPrivate === false){
      return messages
      .filter((message) =>
      extractTextFromHTML(message?.messageText)?.includes(`@${myName?.toLowerCase()}`)
      )
      ?.sort((a, b) => b?.timestamp - a?.timestamp);
      
    }
    return messages
      .filter((message) =>
      extractTextFromHTML(message?.decryptedData?.message)?.includes(`@${myName?.toLowerCase()}`)
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



  if (mode === "mentions") {
    return (
      <Box
        sx={{
          width: "300px",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          // alignItems: 'center',
          backgroundColor: "#1F2023",
          borderBottomLeftRadius: "20px",
          borderTopLeftRadius: "20px",
          overflow: "auto",
          flexShrink: 0,
          flexGrow: 0,
        }}
      >
        <Box
          sx={{
            padding: "10px",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <CloseIcon
            onClick={() => {
              setMode("default");
            }}
            sx={{
              cursor: "pointer",
              color: "white",
            }}
          />
        </Box>
        <Box
          sx={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
      
     
        
          {mentionList?.length === 0 && (
            <Typography
              sx={{
                fontSize: "11px",
                fontWeight: 400,
                color: "rgba(255, 255, 255, 0.2)",
              }}
            >
              No results
            </Typography>
          )}
          <Box
            sx={{
              display: "flex",
              width: "100%",
              height: "100%",
            }}
          >
            <div
              style={{
                height: "100%",
                position: "relative",
                display: "flex",
                flexDirection: "column",
                width: "100%",
              }}
            >
              <div
                ref={parentRefMentions}
                className="List"
                style={{
                  flexGrow: 1,
                  overflow: "auto",
                  position: "relative",
                  display: "flex",
                  height: "0px",
                }}
              >
                <div
                  style={{
                    height: rowVirtualizerMentions.getTotalSize(),
                    width: "100%",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                    }}
                  >
                    {rowVirtualizerMentions.getVirtualItems().map((virtualRow) => {
                      const index = virtualRow.index;
                      let message = mentionList[index];
                      return (
                        <div
                          data-index={virtualRow.index} //needed for dynamic row height measurement
                          ref={rowVirtualizerMentions.measureElement} //measure dynamic row height
                          key={message.signature}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: "50%", // Move to the center horizontally
                            transform: `translateY(${virtualRow.start}px) translateX(-50%)`, // Adjust for centering
                            width: "100%", // Control width (90% of the parent)
                            padding: "10px 0",
                            display: "flex",
                            alignItems: "center",
                            overscrollBehavior: "none",
                            flexDirection: "column",
                            gap: "5px",
                          }}
                        >
                          <ShowMessage messages={messages} goToMessage={goToMessage} message={message} />
                         
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

  if (mode === "search") {
    return (
      <Box
        sx={{
          width: "300px",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          // alignItems: 'center',
          backgroundColor: "#1F2023",
          borderBottomLeftRadius: "20px",
          borderTopLeftRadius: "20px",
          overflow: "auto",
          flexShrink: 0,
          flexGrow: 0,
        }}
      >
        <Box
          sx={{
            padding: "10px",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <CloseIcon
            onClick={() => {
              setMode("default");
            }}
            sx={{
              cursor: "pointer",
              color: "white",
            }}
          />
        </Box>
        <Box
          sx={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <AppsSearchContainer>
            <AppsSearchLeft>
              <img src={IconSearch} />
              <InputBase
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                sx={{ ml: 1, flex: 1 }}
                placeholder="Search chat text"
                inputProps={{
                  "aria-label": "Search for apps",
                  fontSize: "16px",
                  fontWeight: 400,
                }}
              />
            </AppsSearchLeft>
            <AppsSearchRight>
              {searchValue && (
                <ButtonBase
                  onClick={() => {
                    setSearchValue("");
                  }}
                >
                  <img src={IconClearInput} />
                </ButtonBase>
              )}
            </AppsSearchRight>
          </AppsSearchContainer>
          <Box
          sx={{
            padding: "10px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: 'center'
          }}
        >
              <Select
            size="small"
            labelId="demo-simple-select-label"
            id="demo-simple-select"
            value={selectedMember}
            label="By member"
            onChange={(e) => setSelectedMember(e.target.value)}
          >
            <MenuItem value={0}>
              <em>By member</em>
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
              cursor: "pointer",
              color: "white",
            }}
          />
          )}
          
        </Box>
        
          {debouncedValue && searchedList?.length === 0 && (
            <Typography
              sx={{
                fontSize: "11px",
                fontWeight: 400,
                color: "rgba(255, 255, 255, 0.2)",
              }}
            >
              No results
            </Typography>
          )}
          <Box
            sx={{
              display: "flex",
              width: "100%",
              height: "100%",
            }}
          >
            <div
              style={{
                height: "100%",
                position: "relative",
                display: "flex",
                flexDirection: "column",
                width: "100%",
              }}
            >
              <div
                ref={parentRef}
                className="List"
                style={{
                  flexGrow: 1,
                  overflow: "auto",
                  position: "relative",
                  display: "flex",
                  height: "0px",
                }}
              >
                <div
                  style={{
                    height: rowVirtualizer.getTotalSize(),
                    width: "100%",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
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
                            position: "absolute",
                            top: 0,
                            left: "50%", // Move to the center horizontally
                            transform: `translateY(${virtualRow.start}px) translateX(-50%)`, // Adjust for centering
                            width: "100%", // Control width (90% of the parent)
                            padding: "10px 0",
                            display: "flex",
                            alignItems: "center",
                            overscrollBehavior: "none",
                            flexDirection: "column",
                            gap: "5px",
                          }}
                        >
                              <ErrorBoundary
                        fallback={
                          <Typography>
                            Error loading content: Invalid Data
                          </Typography>
                        }
                      >
                          <ShowMessage message={message} goToMessage={goToMessage} messages={messages} />
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
        width: "50px",
        height: "100%",
        gap: "20px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <Box
        sx={{
          width: "100%",
          padding: "10px",
          gap: "20px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          backgroundColor: "#1F2023",
          borderBottomLeftRadius: "20px",
          borderTopLeftRadius: "20px",
          minHeight: "200px",
        }}
      >
        <ButtonBase onClick={() => {
            setMode("search")
        }}>
          <Tooltip
            title={<span style={{ color: "white", fontSize: "14px", fontWeight: 700 }}>SEARCH</span>} 
            placement="left"
            arrow
            sx={{ fontSize: "24" }}
            slotProps={{
              tooltip: {
                sx: {
                  color: "#ffffff",
                  backgroundColor: "#444444",
                },
              },
              arrow: {
                sx: {
                  color: "#444444",
                },
              },
            }}
          >
            <SearchIcon />
          </Tooltip>
        </ButtonBase>
        <ButtonBase onClick={() => {
            setMode("default")
            setSearchValue('')
            setSelectedMember(0)
            openQManager()
        }}>
          <Tooltip
            title={<span style={{ color: "white", fontSize: "14px", fontWeight: 700 }}>Q-MANAGER</span>} 
            placement="left"
            arrow
            sx={{ fontSize: "24" }}
            slotProps={{
              tooltip: {
                sx: {
                  color: "#ffffff",
                  backgroundColor: "#444444",
                },
              },
              arrow: {
                sx: {
                  color: "#444444",
                },
              },
            }}
          >
            <InsertLinkIcon sx={{ color: 'white' }} />
          </Tooltip>
        </ButtonBase>
        <ContextMenuMentions getTimestampMention={getTimestampMention} groupId={selectedGroup}>
        <ButtonBase onClick={() => {
            setMode("mentions")
            setSearchValue('')
            setSelectedMember(0)
        }}>
          <Tooltip
            title={<span style={{ color: "white", fontSize: "14px", fontWeight: 700 }}>MENTIONED</span>} 
            placement="left"
            arrow
            sx={{ fontSize: "24" }}
            slotProps={{
              tooltip: {
                sx: {
                  color: "#ffffff",
                  backgroundColor: "#444444",
                },
              },
              arrow: {
                sx: {
                  color: "#444444",
                },
              },
            }}
          >
            <AlternateEmailIcon sx={{
              color: mentionList?.length > 0 && (!lastMentionTimestamp || lastMentionTimestamp < mentionList[0]?.timestamp) ? 'var(--unread)' : 'white'
            }} />
          </Tooltip>
        </ButtonBase>
      
        </ContextMenuMentions>
       
        
      </Box>
    </Box>
  );
};


const ShowMessage = ({message, goToMessage, messages})=> {

  return (
<Box
                            sx={{
                              display: "flex",
                              flexDirection: "column",
                              width: "100%",
                              padding: "0px 20px",
                            }}
                          >
                            <Box
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                width: "100%",
                              }}
                            >
                              <Box
                                sx={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "15px",
                                }}
                              >
                                <Avatar
                                  sx={{
                                    backgroundColor: "#27282c",
                                    color: "white",
                                    height: "25px",
                                    width: "25px",
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
                                    fontFamily: "Inter",
                                    color: "cadetBlue",
                                  }}
                                >
                                  {message?.senderName}
                                </Typography>
                              </Box>
                            </Box>
                            <Spacer height="5px" />
                            <Typography sx={{
                                fontSize: '12px'
                            }}>{formatTimestamp(message.timestamp)}</Typography>
                            <Box
                              style={{
                                cursor: "pointer",
                              }}
                              onClick={() => {
                                const findMsgIndex = messages.findIndex(
                                  (item) =>
                                    item?.signature === message?.signature
                                );
                                if (findMsgIndex !== -1) {
                                  goToMessage(findMsgIndex);
                                }
                              }}
                            >
                              {message?.messageText && (
                                  <MessageDisplay
                                htmlContent={message?.messageText}
                                  />
                                )}
                          {message?.decryptedData?.message && (
                             <MessageDisplay
                             htmlContent={
                               message?.decryptedData?.message || "<p></p>"
                             }
                           />
                          )}
                             
                            </Box>
                          </Box>
  )
}