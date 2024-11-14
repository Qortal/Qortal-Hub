import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'

import {  objectToBase64 } from '../../qdn/encryption/group-encryption'
import { ChatList } from './ChatList'
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import Tiptap from './TipTap'
import { CustomButton } from '../../App-styles'
import CircularProgress from '@mui/material/CircularProgress';
import { Box, ButtonBase, Input, Typography } from '@mui/material';
import { LoadingSnackbar } from '../Snackbar/LoadingSnackbar';
import { getNameInfo } from '../Group/Group';
import { Spacer } from '../../common/Spacer';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { getBaseApiReact, getBaseApiReactSocket, isMobile, pauseAllQueues, resumeAllQueues } from '../../App';
import { getPublicKey } from '../../background';
import { useMessageQueue } from '../../MessageQueueContext';
import { executeEvent, subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ShortUniqueId from "short-unique-id";
import { ReturnIcon } from '../../assets/Icons/ReturnIcon';
import { ExitIcon } from '../../assets/Icons/ExitIcon';
import { MessageItem, ReplyPreview } from './MessageItem';


const uid = new ShortUniqueId({ length: 5 });


export const ChatDirect = ({ myAddress, isNewChat, selectedDirect, setSelectedDirect, setNewChat, getTimestampEnterChat, myName, balance, close, setMobileViewModeKeepOpen}) => {
  const { queueChats, addToQueue, processWithNewMessages} = useMessageQueue();
    const [isFocusedParent, setIsFocusedParent] = useState(false);

  const [messages, setMessages] = useState([])
  const [isSending, setIsSending] = useState(false)
  const [directToValue, setDirectToValue] = useState('')
  const hasInitialized = useRef(false)
  const [isLoading, setIsLoading] = useState(false)
  const [openSnack, setOpenSnack] = React.useState(false);
  const [infoSnack, setInfoSnack] = React.useState(null);
  const [publicKeyOfRecipient, setPublicKeyOfRecipient] = React.useState("")
  const hasInitializedWebsocket = useRef(false)
  const editorRef = useRef(null);
  const socketRef = useRef(null);
  const timeoutIdRef = useRef(null);
  const groupSocketTimeoutRef = useRef(null);
  const [replyMessage, setReplyMessage] = useState(null)
  const setEditorRef = (editorInstance) => {
    editorRef.current = editorInstance;
  };
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  const triggerRerender = () => {
    forceUpdate(); // Trigger re-render by updating the state
  };
  const publicKeyOfRecipientRef = useRef(null)
  const getPublicKeyFunc = async (address)=> {
    try {
      const publicKey = await getPublicKey(address)
      if(publicKeyOfRecipientRef.current !== selectedDirect?.address) return
      setPublicKeyOfRecipient(publicKey)
    } catch (error) {
      
    }
  }

  const tempMessages = useMemo(()=> {
    if(!selectedDirect?.address) return []
    if(queueChats[selectedDirect?.address]){
      return queueChats[selectedDirect?.address]
    }
    return []
  }, [selectedDirect?.address, queueChats])
  useEffect(()=> {
    if(selectedDirect?.address){
      publicKeyOfRecipientRef.current = selectedDirect?.address
      getPublicKeyFunc(publicKeyOfRecipientRef.current)
    }
  }, [selectedDirect?.address])
 

  const middletierFunc = async (data: any, selectedDirectAddress: string, myAddress: string) => {
    try {
      if (hasInitialized.current) {
        decryptMessages(data, true);
        return;
      }
      hasInitialized.current = true;
      const url = `${getBaseApiReact()}/chat/messages?involving=${selectedDirectAddress}&involving=${myAddress}&encoding=BASE64&limit=0&reverse=false`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });
      const responseData = await response.json();
      decryptMessages(responseData, false);
    } catch (error) {
      console.error(error);
    }
 }

    const decryptMessages = (encryptedMessages: any[], isInitiated: boolean)=> {
      try {
        return new Promise((res, rej)=> {
          window.sendMessage("decryptDirect", {
            data: encryptedMessages,
            involvingAddress: selectedDirect?.address,
          })
            .then((response) => {
              if (!response?.error) {
                processWithNewMessages(response, selectedDirect?.address);
                res(response);
          
                if (isInitiated) {
                  const formatted = response.map((item) => ({
                    ...item,
                    id: item.signature,
                    text: item.message,
                    unread: item?.sender === myAddress ? false : true,
                  }));
                  setMessages((prev) => [...prev, ...formatted]);
                } else {
                  const formatted = response.map((item) => ({
                    ...item,
                    id: item.signature,
                    text: item.message,
                    unread: false,
                  }));
                  setMessages(formatted);
                  hasInitialized.current = true;
                }
                return;
              }
              rej(response.error);
            })
            .catch((error) => {
              rej(error.message || "An error occurred");
            });
          
        })  
      } catch (error) {
          
      }
    }

    const forceCloseWebSocket = () => {
      if (socketRef.current) {
        clearTimeout(timeoutIdRef.current);
        clearTimeout(groupSocketTimeoutRef.current);
        socketRef.current.close(1000, 'forced');
        socketRef.current = null;
      }
    };
  
    const pingWebSocket = () => {
      try {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send('ping');
          timeoutIdRef.current = setTimeout(() => {
            if (socketRef.current) {
              socketRef.current.close();
              clearTimeout(groupSocketTimeoutRef.current);
            }
          }, 5000); // Close if no pong in 5 seconds
        }
      } catch (error) {
        console.error('Error during ping:', error);
      }
    };
  

    const initWebsocketMessageGroup = () => {
      forceCloseWebSocket(); // Close any existing connection
  
      if (!selectedDirect?.address || !myAddress) return;
  
      const socketLink = `${getBaseApiReactSocket()}/websockets/chat/messages?involving=${selectedDirect?.address}&involving=${myAddress}&encoding=BASE64&limit=100`;
      socketRef.current = new WebSocket(socketLink);
  
      socketRef.current.onopen = () => {
        setTimeout(pingWebSocket, 50); // Initial ping
      };
  
      socketRef.current.onmessage = (e) => {
        try {
          if (e.data === 'pong') {
            clearTimeout(timeoutIdRef.current);
            groupSocketTimeoutRef.current = setTimeout(pingWebSocket, 45000); // Ping every 45 seconds
          } else {
            middletierFunc(JSON.parse(e.data), selectedDirect?.address, myAddress)

            setIsLoading(false);
          }
        } catch (error) {
          console.error('Error handling WebSocket message:', error);
        }
      };
  
      socketRef.current.onclose = (event) => {
        clearTimeout(groupSocketTimeoutRef.current);
        clearTimeout(timeoutIdRef.current);
        console.warn(`WebSocket closed: ${event.reason || 'unknown reason'}`);
        if (event.reason !== 'forced' && event.code !== 1000) {
          setTimeout(() => initWebsocketMessageGroup(), 10000); // Retry after 10 seconds
        }
      };
  
      socketRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        clearTimeout(groupSocketTimeoutRef.current);
        clearTimeout(timeoutIdRef.current);
        if (socketRef.current) {
          socketRef.current.close();
        }
      };
    };

    const setDirectChatValueFunc = async (e)=> {
      setDirectToValue(e.detail.directToValue)
    }
    useEffect(() => {
      subscribeToEvent("setDirectToValueNewChat", setDirectChatValueFunc);
  
      return () => {
        unsubscribeFromEvent("setDirectToValueNewChat", setDirectChatValueFunc);
      };
    }, []);
  
    useEffect(() => {
      if (hasInitializedWebsocket.current || isNewChat) return;
      setIsLoading(true);
      initWebsocketMessageGroup();
      hasInitializedWebsocket.current = true;
  
      return () => {
        forceCloseWebSocket(); // Clean up WebSocket on component unmount
      };
    }, [selectedDirect?.address, myAddress, isNewChat]);



const sendChatDirect = async ({ chatReference = undefined, messageText, otherData}: any, address, publicKeyOfRecipient, isNewChatVar)=> {
  try {
    const directTo = isNewChatVar ? directToValue : address
 
    if(!directTo) return
    return new Promise((res, rej)=> {
      window.sendMessage("sendChatDirect", {
        directTo,
        chatReference,
        messageText,
        otherData,
        publicKeyOfRecipient,
        address: directTo,
      })
        .then(async (response) => {
          if (!response?.error) {
            if (isNewChatVar) {
              let getRecipientName = null;
              try {
                getRecipientName = await getNameInfo(response.recipient);
              } catch (error) {
                console.error("Error fetching recipient name:", error);
              }
              setSelectedDirect({
                address: response.recipient,
                name: getRecipientName,
                timestamp: Date.now(),
                sender: myAddress,
                senderName: myName,
              });
              setNewChat(null);
      
              window.sendMessage("addTimestampEnterChat", {
                timestamp: Date.now(),
                groupId: response.recipient,
              }).catch((error) => {
                console.error("Failed to add timestamp:", error.message || "An error occurred");
              });
      
              setTimeout(() => {
                getTimestampEnterChat();
              }, 400);
            }
            res(response);
            return;
          }
          rej(response.error);
        })
        .catch((error) => {
          rej(error.message || "An error occurred");
        });
      
    })  
  } catch (error) {
      throw new Error(error)
  } finally {
  }
}
const clearEditorContent = () => {
  if (editorRef.current) {
    editorRef.current.chain().focus().clearContent().run();
    if(isMobile){
      setTimeout(() => {
        editorRef.current?.chain().blur().run(); 
        setIsFocusedParent(false)
        executeEvent("sent-new-message-group", {})
        setTimeout(() => {
          triggerRerender();
         }, 300);
      }, 200);
    }
  }
};


    const sendMessage = async ()=> {
      try {

        
        if(+balance < 4) throw new Error('You need at least 4 QORT to send a message')
        if(isSending) return
        if (editorRef.current) {
          const htmlContent = editorRef.current.getHTML();
     
          if(!htmlContent?.trim() || htmlContent?.trim() === '<p></p>') return
          setIsSending(true)
          pauseAllQueues()
        const message = JSON.stringify(htmlContent)
       
      
        if(isNewChat){
          await sendChatDirect({ messageText: htmlContent}, null, null, true)
          return
        }
        let repliedTo = replyMessage?.signature

				if (replyMessage?.chatReference) {
					repliedTo = replyMessage?.chatReference
				}
        const otherData = {
          specialId: uid.rnd(),
          repliedTo
        }
        const sendMessageFunc = async () => {
          await sendChatDirect({ chatReference: undefined, messageText: htmlContent, otherData}, selectedDirect?.address, publicKeyOfRecipient, false)
        };

        
  
        // Add the function to the queue
        const messageObj = {
          message: {
            text: htmlContent,
            timestamp: Date.now(),
          senderName: myName,
          sender: myAddress,
          ...(otherData || {})
          },
         
        }
        addToQueue(sendMessageFunc, messageObj, 'chat-direct',
        selectedDirect?.address );
        setTimeout(() => {
          executeEvent("sent-new-message-group", {})
        }, 150);
        clearEditorContent()
        setReplyMessage(null)
        }
        // send chat message
      } catch (error) {
        const errorMsg = error?.message || error
        setInfoSnack({
          type: "error",
          message: errorMsg === 'invalid signature' ? 'You need at least 4 QORT to send a message' :  errorMsg,
        });
        setOpenSnack(true);
        console.error(error)
      } finally {
        setIsSending(false)
        resumeAllQueues()
      }
    }

  const onReply = useCallback((message)=> {
    setReplyMessage(message)
    editorRef?.current?.chain().focus()

  }, [])

    
  return (
    <div style={{
      height: isMobile ? '100%' : '100vh',
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      background: !isMobile && 'var(--bg-2)'
    }}>
      {!isMobile && (
         <Box onClick={close} sx={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          cursor: 'pointer',
          padding: '4px 6px',
          width: 'fit-content',
          borderRadius: '3px',
          background: 'rgb(35, 36, 40)',
          margin: '10px 0px',
          alignSelf: 'center'
        }}>
          <ArrowBackIcon sx={{
            color: 'white',
            fontSize: isMobile ? '20px' : '20px'
          }}/>
          <Typography sx={{
            color: 'white',
            fontSize: isMobile ? '14px' : '14px'
          }}>Close Direct Chat</Typography>
        </Box>
      )}
       {isMobile && (
         <Box
         sx={{
           display: "flex",
           alignItems: "center",
           width: "100%",
           marginTop: "14px",
           justifyContent: "center",
           height: "15px",
         }}
       >
         <Box
           sx={{
             display: "flex",
             alignItems: "center",
             justifyContent: "space-between",
             width: "320px",
           }}
         >
           <Box
             sx={{
               display: "flex",
               alignItems: "center",
               width: "50px",
             }}
           >
             <ButtonBase
               onClick={() => {
                 close()
               }}
             >
               <ReturnIcon />
             </ButtonBase>
           </Box>
           <Typography
             sx={{
               fontSize: "14px",
               fontWeight: 600,
             }}
           >
             {isNewChat ? '' : selectedDirect?.name || (selectedDirect?.address?.slice(0,10) + '...')}
           </Typography>
           <Box
             sx={{
               display: "flex",
               alignItems: "center",
               width: "50px",
               justifyContent: "flex-end",
             }}
           >
               <ButtonBase
               onClick={() => {
                 setSelectedDirect(null)
                 setMobileViewModeKeepOpen('')
                 setNewChat(false)
               }}
             >
             <ExitIcon />
             </ButtonBase>
           </Box>
         </Box>
       </Box>
       )}
      {isNewChat && (
        <>
        <Spacer height="30px" />
                <Input sx={{
                  fontSize: '18px',
                  padding: '5px'
                }} placeholder='Name or address' value={directToValue} onChange={(e)=> setDirectToValue(e.target.value)} />

        </>
      )}
      
              <ChatList onReply={onReply} chatId={selectedDirect?.address} initialMessages={messages} myAddress={myAddress} tempMessages={tempMessages}/>

   
      <div style={{
        // position: 'fixed',
        // bottom: '0px',
        backgroundColor: "#232428",
        minHeight: isMobile ? '0px' : '150px',
        maxHeight: isMobile ? 'auto' : '400px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        width: '100%',
        boxSizing: 'border-box',
        padding: isMobile ? '10px' : '20px',
        position: isFocusedParent ? 'fixed' : 'relative',
        bottom: isFocusedParent ? '0px' : 'unset',
        top: isFocusedParent ? '0px' : 'unset',
        zIndex: isFocusedParent ? 5 : 'unset',
        flexShrink: 0
      }}>
      <div style={{
            display: 'flex',
            flexDirection: 'column',
            flexGrow: isMobile && 1,
            overflow: !isMobile &&  "auto",
            flexShrink: 0
      }}>
      {replyMessage && (
        <Box sx={{
          display: 'flex',
          gap: '5px',
          alignItems: 'flex-start',
          width: '100%'
        }}>
                  <ReplyPreview message={replyMessage} />

           <ButtonBase
               onClick={() => {
                setReplyMessage(null)
               }}
             >
             <ExitIcon />
             </ButtonBase>
        </Box>
      )}
     
      <Tiptap isFocusedParent={isFocusedParent} setEditorRef={setEditorRef} onEnter={sendMessage} isChat disableEnter={isMobile ? true : false} setIsFocusedParent={setIsFocusedParent}/>
      </div>
      <Box sx={{
        display: 'flex',
        width: '100&',
        gap: '10px',
        justifyContent: 'center',
        flexShrink: 0,
        position: 'relative',
      }}>
         {isFocusedParent && (
               <CustomButton
               onClick={()=> {
                 if(isSending) return
                 setIsFocusedParent(false)
                 clearEditorContent()
                 // Unfocus the editor
               }}
               style={{
                 marginTop: 'auto',
                 alignSelf: 'center',
                 cursor: isSending ? 'default' : 'pointer',
                 background: 'red',
                 flexShrink: 0,
                 padding: isMobile && '5px'
               }}
             >
               
               {` Close`}
             </CustomButton>
           
            )}
      <CustomButton
              onClick={()=> {
                if(isSending) return
                sendMessage()
              }}
              style={{
                marginTop: 'auto',
                alignSelf: 'center',
                cursor: isSending ? 'default' : 'pointer',
                background: isSending && 'rgba(0, 0, 0, 0.8)',
                flexShrink: 0,
                padding: isMobile && '5px'
              }}
            >
              {isSending && (
                <CircularProgress
                size={18}
                sx={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  marginTop: '-12px',
                  marginLeft: '-12px',
                  color: 'white'
                }}
              />
              )}
              {` Send`}
            </CustomButton>
           
              </Box>
      </div>
      <LoadingSnackbar open={isLoading} info={{
        message: "Loading chat... please wait."
      }} />
       <CustomizedSnackbars open={openSnack} setOpen={setOpenSnack} info={infoSnack} setInfo={setInfoSnack}  />
    </div>
  )
}
