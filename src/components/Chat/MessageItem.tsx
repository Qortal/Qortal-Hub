import { Message } from "@chatscope/chat-ui-kit-react";
import React, { useEffect } from "react";
import { useInView } from "react-intersection-observer";
import { MessageDisplay } from "./MessageDisplay";
import { Avatar, Box, ButtonBase, Typography } from "@mui/material";
import { formatTimestamp } from "../../utils/time";
import { getBaseApi } from "../../background";
import { getBaseApiReact } from "../../App";
import { generateHTML } from "@tiptap/react";
import Highlight from "@tiptap/extension-highlight";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { executeEvent } from "../../utils/events";
import { WrapperUserAction } from "../WrapperUserAction";
import ReplyIcon from "@mui/icons-material/Reply";
import { Spacer } from "../../common/Spacer";
import { ReactionPicker } from "../ReactionPicker";
import KeyOffIcon from '@mui/icons-material/KeyOff';
export const MessageItem = ({
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
  lastSignature
}) => {
  const { ref, inView } = useInView({
    threshold: 0.7, // Fully visible
    triggerOnce: false, // Only trigger once when it becomes visible
  });

  useEffect(() => {
    if (inView && isLast && onSeen) {
      onSeen(message.id);
    }
  }, [inView, message.id, isLast]);


  return (
    <div
      ref={lastSignature === message?.signature ? ref : null}
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
        <WrapperUserAction
          disabled={myAddress === message?.sender}
          address={message?.sender}
          name={message?.senderName}
        >
          <Avatar
            sx={{
              backgroundColor: "#27282c",
              color: "white",
            }}
            alt={message?.senderName}
            src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${
              message?.senderName
            }/qortal_avatar?async=true`}
          >
            {message?.senderName?.charAt(0)}
          </Avatar>
        </WrapperUserAction>
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
                  htmlContent={generateHTML(reply?.messageText, [
                    StarterKit,
                    Underline,
                    Highlight,
                  ])}
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
        {message?.messageText && (
          <MessageDisplay
            htmlContent={generateHTML(message?.messageText, [
              StarterKit,
              Underline,
              Highlight,
            ])}
          />
        )}
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
                <ButtonBase sx={{
                  height: '30px',
                  minWidth:  '45px',
                  background: 'var(--bg-2)',
                  borderRadius: '7px'
                }} onClick={()=> {
                  if(reactions[reaction] && reactions[reaction]?.find((item)=> item?.sender === myAddress)){
                    handleReaction(reaction, message, false)
                  } else {
                    handleReaction(reaction, message, true)
                  }
                }}>
               <div>{reaction}</div>  {numberOfReactions > 1 && (
                <Typography sx={{
                  marginLeft: '4px'
                }}>{' '} {numberOfReactions}</Typography>
               )}
                </ButtonBase>
              )
            })}
          </Box>
          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '15px'
          }}>
          {message?.isNotEncrypted && (
              <KeyOffIcon sx={{
                color: 'white',
                marginLeft: '10px'
              }} />
            )}
       
          {isUpdating ? (
            <Typography
              sx={{
                fontSize: "14px",
                color: "gray",
                fontFamily: "Inter",
              }}
            >
              Updating...
            </Typography>
          ) : isTemp ? (
            <Typography
              sx={{
                fontSize: "14px",
                color: "gray",
                fontFamily: "Inter",
              }}
            >
              Sending...
            </Typography>
          ) : (
            <Typography
              sx={{
                fontSize: "14px",
                color: "gray",
                fontFamily: "Inter",
              }}
            >
              {formatTimestamp(message.timestamp)}
            </Typography>
          )}
             </Box>
        </Box>
      </Box>

      {/* <Message
      model={{
        direction: 'incoming',
        message: message.text,
        position: 'single',
        sender: message.senderName,
        sentTime: message.timestamp
      }}
      
    ></Message> */}
      {/* {!message.unread && <span style={{ color: 'green' }}> Seen</span>} */}
    </div>
  );
};


export const ReplyPreview = ({message})=> {

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
              <Typography sx={{
                fontSize: '12px',
                fontWeight: 600
              }}>Replied to {message?.senderName || message?.senderAddress}</Typography>
              {message?.messageText && (
                <MessageDisplay
                  htmlContent={generateHTML(message?.messageText, [
                    StarterKit,
                    Underline,
                    Highlight,
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