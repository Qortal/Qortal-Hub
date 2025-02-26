import { Message } from "@chatscope/chat-ui-kit-react";
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useInView } from "react-intersection-observer";
import { MessageDisplay } from "./MessageDisplay";
import { Avatar, Box, Button, ButtonBase, List, ListItem, ListItemText, Popover, Tooltip, Typography } from "@mui/material";
import { formatTimestamp } from "../../utils/time";
import { getBaseApi } from "../../background";
import { MyContext, getBaseApiReact } from "../../App";
import { generateHTML } from "@tiptap/react";
import Highlight from "@tiptap/extension-highlight";
import Mention from "@tiptap/extension-mention";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { executeEvent } from "../../utils/events";
import { WrapperUserAction } from "../WrapperUserAction";
import ReplyIcon from "@mui/icons-material/Reply";
import { Spacer } from "../../common/Spacer";
import { ReactionPicker } from "../ReactionPicker";
import KeyOffIcon from '@mui/icons-material/KeyOff';
import EditIcon from '@mui/icons-material/Edit';
import TextStyle from '@tiptap/extension-text-style';
import { addressInfoKeySelector } from "../../atoms/global";
import { useRecoilValue } from "recoil";
import level0Img from "../../assets/badges/level-0.png"
import level1Img from "../../assets/badges/level-1.png"
import level2Img from "../../assets/badges/level-2.png"
import level3Img from "../../assets/badges/level-3.png"
import level4Img from "../../assets/badges/level-4.png"
import level5Img from "../../assets/badges/level-5.png"
import level6Img from "../../assets/badges/level-6.png"
import level7Img from "../../assets/badges/level-7.png"
import level8Img from "../../assets/badges/level-8.png"
import level9Img from "../../assets/badges/level-9.png"
import level10Img from "../../assets/badges/level-10.png"

const getBadgeImg = (level)=> {
  switch(level?.toString()){

    case '0': return level0Img
    case '1': return level1Img
    case '2': return level2Img
    case '3': return level3Img
    case '4': return level4Img
    case '5': return level5Img
    case '6': return level6Img
    case '7': return level7Img
    case '8': return level8Img
    case '9': return level9Img
    case '10': return level10Img
    default: return level0Img
  }
}
export const MessageItem = React.memo(({
  message,
  onSeen,
  isLast,
  isTemp,
  myAddress,
  onReply,
  isShowingAsReply,
  reply,
  replyIndex,
  scrollToItem,
  handleReaction,
  reactions,
  isUpdating,
  lastSignature,
  onEdit,
  isPrivate
}) => {

const {getIndividualUserInfo} = useContext(MyContext)
  const [anchorEl, setAnchorEl] = useState(null);
  const [selectedReaction, setSelectedReaction] = useState(null);
  const [userInfo, setUserInfo] = useState(null)


useEffect(()=> {
  const getInfo = async ()=> {
    if(!message?.sender) return
    try {
      const res =  await getIndividualUserInfo(message?.sender)
    if(!res) return null
    setUserInfo(res)
    } catch (error) {
      //
    }
  }

   getInfo()
}, [message?.sender, getIndividualUserInfo])

const htmlText = useMemo(()=> {
  
  if(message?.messageText){
    return generateHTML(message?.messageText, [
      StarterKit,
      Underline,
      Highlight,
      Mention,
      TextStyle
    ])
  }
  
}, [])



const htmlReply = useMemo(()=> {
  
  if(reply?.messageText){
    return generateHTML(reply?.messageText, [
      StarterKit,
      Underline,
      Highlight,
      Mention,
      TextStyle
    ])
  }
  
}, [])

const userAvatarUrl = useMemo(()=> {
  return message?.senderName ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${
    message?.senderName
  }/qortal_avatar?async=true` : ''
}, [])

const onSeenFunc = useCallback(()=> {
  onSeen(message.id);
}, [message?.id])


  return (
    <MessageWragger lastMessage={lastSignature === message?.signature} isLast={isLast} onSeen={onSeenFunc}>

    {message?.divide && (
     <div className="unread-divider" id="unread-divider-id">
     Unread messages below
   </div>
    )}
    <div
      style={{
        padding: "10px",
        backgroundColor: "#232428",
        borderRadius: "7px",
        width: "95%",
        display: "flex",
        gap: "7px",
        opacity: (isTemp || isUpdating) ? 0.5 : 1,
      }}
      id={message?.signature}
    >
      {isShowingAsReply ? (
        <ReplyIcon
          sx={{
            fontSize: "30px",
          }}
        />
      ) : (
        <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          alignItems: 'center'
        }}>
        <WrapperUserAction
          disabled={myAddress === message?.sender}
          address={message?.sender}
          name={message?.senderName}
        >
          
          <Avatar
            sx={{
              backgroundColor: "#27282c",
              color: "white",
              height: '40px',
              width: '40px'
            }}
            alt={message?.senderName}
            src={userAvatarUrl}
          >
            {message?.senderName?.charAt(0)}
          </Avatar>
          
          
        </WrapperUserAction>
        <Tooltip disableFocusListener title={`level ${userInfo}`}>
            
         
            <img style={{
              visibility: userInfo !== undefined ? 'visible' : 'hidden',
              width: '30px',
              height: 'auto'
            }} src={getBadgeImg(userInfo)} /> 
        </Tooltip>
        </Box>
      )}

      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: "7px",
          width: "100%",
          height: isShowingAsReply && "40px",
        }}
      >
        <Box
          sx={{
            display: "flex",
            width: "100%",
            justifyContent: "space-between",
          }}
        >
          <WrapperUserAction
            disabled={myAddress === message?.sender}
            address={message?.sender}
            name={message?.senderName}
          >
            <Typography
              sx={{
                fontWight: 600,
                fontFamily: "Inter",
                color: "cadetBlue",
              }}
            >
              {message?.senderName || message?.sender}
            </Typography>
            
          </WrapperUserAction>
          <Box sx={{
            display: 'flex',
            gap: '10px',
            alignItems: 'center'
          }}>
           {message?.sender === myAddress && (!message?.isNotEncrypted || isPrivate === false) && (
            <ButtonBase
              onClick={() => {
                onEdit(message);
              }}
            >
              <EditIcon />
            </ButtonBase>
          )}
          {!isShowingAsReply && (
            <ButtonBase
              onClick={() => {
                onReply(message);
              }}
            >
              <ReplyIcon />
            </ButtonBase>
          )}
          {!isShowingAsReply && handleReaction && (
            <ReactionPicker onReaction={(val)=> {
              
              if(reactions && reactions[val] && reactions[val]?.find((item)=> item?.sender === myAddress)){
                handleReaction(val, message, false)
              } else {
                handleReaction(val, message, true)
              }
              
            }} />
          )}
          </Box>
        </Box>
        {reply && (
          <>
          <Spacer height="20px" />
          <Box
            sx={{
              width: "100%",
              borderRadius: "5px",
              backgroundColor: "var(--bg-primary)",
              overflow: 'hidden',
              display: 'flex',
              gap: '20px',
              maxHeight: '90px',
              cursor: 'pointer'
            }}
            onClick={()=> {
              scrollToItem(replyIndex)
              
              
            }}
          >
            <Box sx={{
              height: '100%',
              width: '5px',
              background: 'white'
            }} />
            <Box sx={{
              padding: '5px'
            }}>
              <Typography sx={{
                fontSize: '12px',
                fontWeight: 600
              }}>Replied to {reply?.senderName || reply?.senderAddress}</Typography>
              {reply?.messageText && (
                <MessageDisplay
                  htmlContent={htmlReply}
                />
              )}
              {reply?.decryptedData?.type === "notification" ? (
                <MessageDisplay htmlContent={reply.decryptedData?.data?.message} />
              ) : (
                <MessageDisplay isReply htmlContent={reply.text} />
              )}
            </Box>
          </Box>
          </>
        )}
      
          <MessageDisplay
            htmlContent={htmlText}
          />
      
        {message?.decryptedData?.type === "notification" ? (
          <MessageDisplay htmlContent={message.decryptedData?.data?.message} />
        ) : (
          <MessageDisplay htmlContent={message.text} />
        )}
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px'
          }}>
            {reactions && Object.keys(reactions).map((reaction)=> {
              const numberOfReactions = reactions[reaction]?.length
              // const myReaction = reactions
              if(numberOfReactions === 0) return null
              return (
                <ButtonBase key={reaction} sx={{
                  height: '30px',
                  minWidth:  '45px',
                  background: 'var(--bg-2)',
                  borderRadius: '7px'
                }} onClick={(event) => {
                    event.stopPropagation(); // Prevent event bubbling
                    setAnchorEl(event.currentTarget);
                    setSelectedReaction(reaction);
                }}>
               <div style={{
                fontSize: '16px'
               }}>{reaction}</div>  {numberOfReactions > 1 && (
                <Typography sx={{
                  marginLeft: '4px'
                }}>{' '} {numberOfReactions}</Typography>
               )}
                </ButtonBase>
              )
            })}
          </Box>
          {selectedReaction && (
            <Popover
              open={Boolean(anchorEl)}
              anchorEl={anchorEl}
              onClose={() => {
                setAnchorEl(null);
                setSelectedReaction(null);
              }}
              anchorOrigin={{
                vertical: "top",
                horizontal: "center",
              }}
              transformOrigin={{
                vertical: "bottom",
                horizontal: "center",
              }}
              PaperProps={{
                style: {
                  backgroundColor: "#232428",
                  color: "white",
                },
              }}
            >
              <Box sx={{ p: 2 }}>
                <Typography variant="subtitle1" sx={{ marginBottom: 1 }}>
                  People who reacted with {selectedReaction}
                </Typography>
                <List sx={{
                  overflow: 'auto',
                  maxWidth: '300px',
                  maxHeight: '300px'
                }}>
                  {reactions[selectedReaction]?.map((reactionItem) => (
                    <ListItem key={reactionItem.sender}>
                      <ListItemText
                        primary={reactionItem.senderName || reactionItem.sender}
                      />
                    </ListItem>
                  ))}
                </List>
                <Button
                  variant="contained"
                  color="primary"
                  onClick={() => {
                    if (
                      reactions[selectedReaction]?.find(
                        (item) => item?.sender === myAddress
                      )
                    ) {
                      handleReaction(selectedReaction, message, false); // Remove reaction
                    } else {
                      handleReaction(selectedReaction, message, true); // Add reaction
                    }
                    setAnchorEl(null);
                    setSelectedReaction(null);
                  }}
                  sx={{ marginTop: 2 }}
                >
                  {reactions[selectedReaction]?.find(
                    (item) => item?.sender === myAddress
                  )
                    ? "Remove Reaction"
                    : "Add Reaction"}
                </Button>
              </Box>
            </Popover>
          )}
          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '15px'
          }}>
          {message?.isNotEncrypted && isPrivate && (
              <KeyOffIcon sx={{
                color: 'white',
                marginLeft: '10px'
              }} />
            )}
       
          {isUpdating ? (
            <Typography
              sx={{
                fontSize: "14px",
                color:  "gray",
                fontFamily: "Inter",
              }}
            >
              {message?.status === 'failed-permanent' ? 'Failed to update' : 'Updating...'} 
            </Typography>
          ) : isTemp ? (
            <Typography
              sx={{
                fontSize: "14px",
                color:  "gray",
                fontFamily: "Inter",
              }}
            >
              {message?.status === 'failed-permanent' ? 'Failed to send' : 'Sending...'}
            </Typography>
          ) : (
            <>
            {message?.isEdit && (
              <Typography
              sx={{
                fontSize: "14px",
                color: "gray",
                fontFamily: "Inter",
                fontStyle: 'italic'
              }}
            >
              Edited
            </Typography>
            )}
            <Typography
              sx={{
                fontSize: "14px",
                color: "gray",
                fontFamily: "Inter",
              }}
            >
              {formatTimestamp(message.timestamp)}
            </Typography>
            </>
          )}
             </Box>
        </Box>
      </Box>

 
    </div>
    </MessageWragger>
  );
});


export const ReplyPreview = ({message, isEdit})=> {

  return (
    <Box
            sx={{
              marginTop: '20px',
              width: "100%",
              borderRadius: "5px",
              backgroundColor: "var(--bg-primary)",
              overflow: 'hidden',
              display: 'flex',
              gap: '20px',
              maxHeight: '90px',
              cursor: 'pointer'
            }}
          >
            <Box sx={{
              height: '100%',
              width: '5px',
              background: 'white'
            }} />
            <Box sx={{
              padding: '5px'
            }}>
              {isEdit ? (
                    <Typography sx={{
                      fontSize: '12px',
                      fontWeight: 600
                    }}>Editing Message</Typography>
              ) : (
                    <Typography sx={{
                      fontSize: '12px',
                      fontWeight: 600
                    }}>Replied to {message?.senderName || message?.senderAddress}</Typography>
              )}
          
              {message?.messageText && (
                <MessageDisplay
                  htmlContent={generateHTML(message?.messageText, [
                    StarterKit,
                    Underline,
                    Highlight,
                    Mention,
                    TextStyle
                  ])}
                />
              )}
              {message?.decryptedData?.type === "notification" ? (
                <MessageDisplay htmlContent={message.decryptedData?.data?.message} />
              ) : (
                <MessageDisplay isReply htmlContent={message.text} />
              )}
            </Box>
          </Box>
          
  )
}

const MessageWragger = ({lastMessage, onSeen, isLast, children})=> {

  if(lastMessage){
    return (
      <WatchComponent onSeen={onSeen} isLast={isLast}>{children}</WatchComponent>
    ) 
  }
  return children
}

const WatchComponent = ({onSeen, isLast, children})=> {
  const { ref, inView } = useInView({
    threshold: 0.7, // Fully visible
    triggerOnce: true, // Only trigger once when it becomes visible
  });

  useEffect(() => {
    if (inView && isLast && onSeen) {
      onSeen();
    }
  }, [inView, isLast, onSeen]);

  return <div ref={ref} style={{
    width: '100%',
    display: 'flex',
    justifyContent: 'center'
  }}>
    {children}
  </div>

}