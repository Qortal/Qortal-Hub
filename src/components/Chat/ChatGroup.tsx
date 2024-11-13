import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { CreateCommonSecret } from './CreateCommonSecret'
import { reusableGet } from '../../qdn/publish/pubish'
import { uint8ArrayToObject } from '../../backgroundFunctions/encryption'
import { base64ToUint8Array, decodeBase64ForUIChatMessages, objectToBase64 } from '../../qdn/encryption/group-encryption'
import {  ChatContainerComp } from './ChatContainer'
import { ChatList } from './ChatList'
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import Tiptap from './TipTap'
import { CustomButton } from '../../App-styles'
import CircularProgress from '@mui/material/CircularProgress';
import { LoadingSnackbar } from '../Snackbar/LoadingSnackbar'
import { getBaseApiReact, getBaseApiReactSocket, isMobile, pauseAllQueues, resumeAllQueues } from '../../App'
import { CustomizedSnackbars } from '../Snackbar/Snackbar'
import { PUBLIC_NOTIFICATION_CODE_FIRST_SECRET_KEY } from '../../constants/codes'
import { useMessageQueue } from '../../MessageQueueContext'
import { executeEvent } from '../../utils/events'
import { Box, ButtonBase } from '@mui/material'
import ShortUniqueId from "short-unique-id";
import { ReplyPreview } from './MessageItem'
import { ExitIcon } from '../../assets/Icons/ExitIcon'
import { RESOURCE_TYPE_NUMBER_GROUP_CHAT_REACTIONS } from '../../constants/resourceTypes'
import { isExtMsg } from '../../background'

const uid = new ShortUniqueId({ length: 5 });

export const ChatGroup = ({selectedGroup, secretKey, setSecretKey, getSecretKey, myAddress, handleNewEncryptionNotification, hide, handleSecretKeyCreationInProgress, triedToFetchSecretKey, myName, balance}) => {
  const [messages, setMessages] = useState([])
  const [chatReferences, setChatReferences] = useState({})
  const [isSending, setIsSending] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isMoved, setIsMoved] = useState(false);
  const [openSnack, setOpenSnack] = React.useState(false);
  const [infoSnack, setInfoSnack] = React.useState(null);
  const hasInitialized = useRef(false)
  const [isFocusedParent, setIsFocusedParent] = useState(false);
  const [replyMessage, setReplyMessage] = useState(null)

  const hasInitializedWebsocket = useRef(false)
  const socketRef = useRef(null); // WebSocket reference
  const timeoutIdRef = useRef(null); // Timeout ID reference
  const groupSocketTimeoutRef = useRef(null); // Group Socket Timeout reference
  const editorRef = useRef(null);
  const { queueChats, addToQueue, processWithNewMessages } = useMessageQueue();
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  const triggerRerender = () => {
    forceUpdate(); // Trigger re-render by updating the state
  };
  const setEditorRef = (editorInstance) => {
    editorRef.current = editorInstance;
  };

  const tempMessages = useMemo(()=> {
    if(!selectedGroup) return []
    if(queueChats[selectedGroup]){
      return queueChats[selectedGroup]?.filter((item)=> !item?.chatReference)
    }
    return []
  }, [selectedGroup, queueChats])
  const tempChatReferences = useMemo(()=> {
    if(!selectedGroup) return []
    if(queueChats[selectedGroup]){
      return queueChats[selectedGroup]?.filter((item)=> !!item?.chatReference)
    }
    return []
  }, [selectedGroup, queueChats])

  const secretKeyRef = useRef(null)

  useEffect(()=> {
    if(secretKey){
      secretKeyRef.current = secretKey
    }
  }, [secretKey])

    // const getEncryptedSecretKey = useCallback(()=> {
    //     const response = getResource()
    //     const decryptResponse = decryptResource()
    //     return
    // }, [])

   
   const checkForFirstSecretKeyNotification = (messages)=> {
    messages?.forEach((message)=> {
      try {
        const decodeMsg =  atob(message.data);
    
        if(decodeMsg === PUBLIC_NOTIFICATION_CODE_FIRST_SECRET_KEY){
          handleSecretKeyCreationInProgress()
          return
        }
      } catch (error) {
        
      }
    })
   }

   const middletierFunc = async (data: any, groupId: string) => {
    try {
      if (hasInitialized.current) {
        decryptMessages(data, true);
        return;
      }
      hasInitialized.current = true;
      const url = `${getBaseApiReact()}/chat/messages?txGroupId=${groupId}&encoding=BASE64&limit=0&reverse=false`;
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

 
    const decryptMessages = (encryptedMessages: any[], isInitiated: boolean )=> {
      try {
        if(!secretKeyRef.current){
          checkForFirstSecretKeyNotification(encryptedMessages)
          return
        }
        return new Promise((res, rej)=> {
          window.sendMessage("decryptSingle", {
            data: encryptedMessages,
            secretKeyObject: secretKey,
          })
            .then((response) => {
              if (!response?.error) {
                const filterUIMessages = encryptedMessages.filter((item) => !isExtMsg(item.data));
                const decodedUIMessages = decodeBase64ForUIChatMessages(filterUIMessages);
          
                const combineUIAndExtensionMsgs = [...decodedUIMessages, ...response];
                processWithNewMessages(
                  combineUIAndExtensionMsgs.map((item) => ({
                    ...item,
                    ...(item?.decryptedData || {}),
                  })),
                  selectedGroup
                );
                res(combineUIAndExtensionMsgs);
          
                if (isInitiated) {
                  const formatted = combineUIAndExtensionMsgs
                    .filter((rawItem) => !rawItem?.chatReference)
                    .map((item) => ({
                      ...item,
                      id: item.signature,
                      text: item?.decryptedData?.message || "",
                      repliedTo: item?.repliedTo || item?.decryptedData?.repliedTo,
                      unread: item?.sender === myAddress ? false : !!item?.chatReference ? false : true,
                      isNotEncrypted: !!item?.messageText,
                    }));
                  setMessages((prev) => [...prev, ...formatted]);
          
                  setChatReferences((prev) => {
                    const organizedChatReferences = { ...prev };
          
                    combineUIAndExtensionMsgs
                      .filter((rawItem) => rawItem && rawItem.chatReference && rawItem.decryptedData?.type === "reaction")
                      .forEach((item) => {
                        try {
                          const content = item.decryptedData?.content;
                          const sender = item.sender;
                          const newTimestamp = item.timestamp;
                          const contentState = item.decryptedData?.contentState;
          
                          if (!content || typeof content !== "string" || !sender || typeof sender !== "string" || !newTimestamp) {
                            console.warn("Invalid content, sender, or timestamp in reaction data", item);
                            return;
                          }
          
                          organizedChatReferences[item.chatReference] = {
                            ...(organizedChatReferences[item.chatReference] || {}),
                            reactions: organizedChatReferences[item.chatReference]?.reactions || {},
                          };
          
                          organizedChatReferences[item.chatReference].reactions[content] =
                            organizedChatReferences[item.chatReference].reactions[content] || [];
          
                          let latestTimestampForSender = null;
          
                          organizedChatReferences[item.chatReference].reactions[content] = 
                            organizedChatReferences[item.chatReference].reactions[content].filter((reaction) => {
                              if (reaction.sender === sender) {
                                latestTimestampForSender = Math.max(latestTimestampForSender || 0, reaction.timestamp);
                              }
                              return reaction.sender !== sender;
                            });
          
                          if (latestTimestampForSender && newTimestamp < latestTimestampForSender) {
                            return;
                          }
          
                          if (contentState !== false) {
                            organizedChatReferences[item.chatReference].reactions[content].push(item);
                          }
          
                          if (organizedChatReferences[item.chatReference].reactions[content].length === 0) {
                            delete organizedChatReferences[item.chatReference].reactions[content];
                          }
                        } catch (error) {
                          console.error("Error processing reaction item:", error, item);
                        }
                      });
          
                    return organizedChatReferences;
                  });
                } else {
                  const formatted = combineUIAndExtensionMsgs
                    .filter((rawItem) => !rawItem?.chatReference)
                    .map((item) => ({
                      ...item,
                      id: item.signature,
                      text: item?.decryptedData?.message || "",
                      repliedTo: item?.repliedTo || item?.decryptedData?.repliedTo,
                      isNotEncrypted: !!item?.messageText,
                      unread: false,
                    }));
                  setMessages(formatted);
          
                  setChatReferences((prev) => {
                    const organizedChatReferences = { ...prev };
          
                    combineUIAndExtensionMsgs
                      .filter((rawItem) => rawItem && rawItem.chatReference && rawItem.decryptedData?.type === "reaction")
                      .forEach((item) => {
                        try {
                          const content = item.decryptedData?.content;
                          const sender = item.sender;
                          const newTimestamp = item.timestamp;
                          const contentState = item.decryptedData?.contentState;
          
                          if (!content || typeof content !== "string" || !sender || typeof sender !== "string" || !newTimestamp) {
                            console.warn("Invalid content, sender, or timestamp in reaction data", item);
                            return;
                          }
          
                          organizedChatReferences[item.chatReference] = {
                            ...(organizedChatReferences[item.chatReference] || {}),
                            reactions: organizedChatReferences[item.chatReference]?.reactions || {},
                          };
          
                          organizedChatReferences[item.chatReference].reactions[content] =
                            organizedChatReferences[item.chatReference].reactions[content] || [];
          
                          let latestTimestampForSender = null;
          
                          organizedChatReferences[item.chatReference].reactions[content] = 
                            organizedChatReferences[item.chatReference].reactions[content].filter((reaction) => {
                              if (reaction.sender === sender) {
                                latestTimestampForSender = Math.max(latestTimestampForSender || 0, reaction.timestamp);
                              }
                              return reaction.sender !== sender;
                            });
          
                          if (latestTimestampForSender && newTimestamp < latestTimestampForSender) {
                            return;
                          }
          
                          if (contentState !== false) {
                            organizedChatReferences[item.chatReference].reactions[content].push(item);
                          }
          
                          if (organizedChatReferences[item.chatReference].reactions[content].length === 0) {
                            delete organizedChatReferences[item.chatReference].reactions[content];
                          }
                        } catch (error) {
                          console.error("Error processing reaction item:", error, item);
                        }
                      });
          
                    return organizedChatReferences;
                  });
                }
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
  
    const pingGroupSocket = () => {
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
  }
    const initWebsocketMessageGroup = () => {
 

      let socketLink = `${getBaseApiReactSocket()}/websockets/chat/messages?txGroupId=${selectedGroup}&encoding=BASE64&limit=100`
      socketRef.current  = new WebSocket(socketLink)

    
      socketRef.current.onopen = () => {
        setTimeout(pingGroupSocket, 50)
      }
      socketRef.current.onmessage = (e) => {
        try {
          if (e.data === 'pong') {
            clearTimeout(timeoutIdRef.current);
            groupSocketTimeoutRef.current = setTimeout(pingGroupSocket, 45000); // Ping every 45 seconds
          } else {
            middletierFunc(JSON.parse(e.data), selectedGroup)
          setIsLoading(false)
          }
        } catch (error) {
          
        }
      
        
      }
      socketRef.current.onclose = () => {
        clearTimeout(groupSocketTimeoutRef.current);
          clearTimeout(timeoutIdRef.current);
          console.warn(`WebSocket closed: ${event.reason || 'unknown reason'}`);
          if (event.reason !== 'forced' && event.code !== 1000) {
            setTimeout(() => initWebsocketMessageGroup(), 1000); // Retry after 10 seconds
          }
      }
      socketRef.current.onerror = (e) => {
        clearTimeout(groupSocketTimeoutRef.current);
        clearTimeout(timeoutIdRef.current);
        if (socketRef.current) {
          socketRef.current.close();
        }
      }
    }

    useEffect(()=> {
      if(hasInitializedWebsocket.current) return
      if(triedToFetchSecretKey && !secretKey){
        forceCloseWebSocket()
        setMessages([])
        setIsLoading(true)
        initWebsocketMessageGroup()
      }  
    }, [triedToFetchSecretKey, secretKey])

    useEffect(()=> {
      if(!secretKey || hasInitializedWebsocket.current) return
      forceCloseWebSocket()
      setMessages([])
      setIsLoading(true)
      pauseAllQueues()
      setTimeout(() => {
        resumeAllQueues()
      }, 6000);
        initWebsocketMessageGroup()
        hasInitializedWebsocket.current = true
    }, [secretKey])

  
    useEffect(()=> {
      const notifications = messages.filter((message)=> message?.decryptedData
      ?.type === 'notification')
      if(notifications.length === 0) return
      const latestNotification = notifications.reduce((latest, current) => {
        return current.timestamp > latest.timestamp ? current : latest;
      }, notifications[0]);
      handleNewEncryptionNotification(latestNotification)
      
    }, [messages])
  

  const encryptChatMessage = async (data: string, secretKeyObject: any, reactiontypeNumber?: number)=> {
    try {
      return new Promise((res, rej)=> {
        window.sendMessage("encryptSingle", {
          data,
          secretKeyObject,
          typeNumber: reactiontypeNumber,
        })
          .then((response) => {
            if (!response?.error) {
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
        
    }
}

const sendChatGroup = async ({groupId, typeMessage = undefined, chatReference = undefined, messageText}: any)=> {
  try {
    return new Promise((res, rej)=> {
      window.sendMessage("sendChatGroup", {
        groupId,
        typeMessage,
        chatReference,
        messageText,
      })
        .then((response) => {
          if (!response?.error) {
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
        if(isSending) return
        if(+balance < 4) throw new Error('You need at least 4 QORT to send a message')
        pauseAllQueues()
        if (editorRef.current) {
          const htmlContent = editorRef.current.getHTML();
       
          if(!htmlContent?.trim() || htmlContent?.trim() === '<p></p>') return
          setIsSending(true)
        const message = htmlContent
        const secretKeyObject = await getSecretKey(false, true)

        let repliedTo = replyMessage?.signature

				if (replyMessage?.chatReference) {
					repliedTo = replyMessage?.chatReference
				}
        const otherData = {
          specialId: uid.rnd(),
          repliedTo
        }
        const objectMessage = {
          message,
          ...(otherData || {})
        }
        const message64: any = await objectToBase64(objectMessage)
     
        const encryptSingle = await encryptChatMessage(message64, secretKeyObject)
        // const res = await sendChatGroup({groupId: selectedGroup,messageText: encryptSingle})
       
        const sendMessageFunc = async () => {
          await sendChatGroup({groupId: selectedGroup,messageText: encryptSingle})
        };
  
        // Add the function to the queue
        const messageObj = {
          message: {
            text: message,
            timestamp: Date.now(),
          senderName: myName,
          sender: myAddress,
             ...(otherData || {})
          },
         
        }
        addToQueue(sendMessageFunc, messageObj, 'chat',
        selectedGroup );
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
          message: errorMsg,
        });
        setOpenSnack(true);
        console.error(error)
      } finally {
        setIsSending(false)
        resumeAllQueues()
      }
    }

  useEffect(() => {
    if (hide) {
      setTimeout(() => setIsMoved(true), 500); // Wait for the fade-out to complete before moving
    } else {
      setIsMoved(false); // Reset the position immediately when showing
    }
  }, [hide]);
    
  const onReply = useCallback((message)=> {
    setReplyMessage(message)
  }, [])

  const handleReaction = useCallback(async (reaction, chatMessage, reactionState = true)=> {
    try {
      
      if(isSending) return
      if(+balance < 4) throw new Error('You need at least 4 QORT to send a message')
      pauseAllQueues()
   
     
        setIsSending(true)
      const message = ''
      const secretKeyObject = await getSecretKey(false, true)

     
      const otherData = {
        specialId: uid.rnd(),
        type: 'reaction',
        content: reaction,
        contentState: reactionState
      }
      const objectMessage = {
        message,
        ...(otherData || {})
      }
      const message64: any = await objectToBase64(objectMessage)
      const reactiontypeNumber = RESOURCE_TYPE_NUMBER_GROUP_CHAT_REACTIONS
      const encryptSingle = await encryptChatMessage(message64, secretKeyObject, reactiontypeNumber)
      // const res = await sendChatGroup({groupId: selectedGroup,messageText: encryptSingle})
     
      const sendMessageFunc = async () => {
        await sendChatGroup({groupId: selectedGroup,messageText: encryptSingle, chatReference: chatMessage.signature})
      };

      // Add the function to the queue
      const messageObj = {
        message: {
          text: message,
          timestamp: Date.now(),
        senderName: myName,
        sender: myAddress,
           ...(otherData || {})
        },
       chatReference: chatMessage.signature
      }
      addToQueue(sendMessageFunc, messageObj, 'chat-reaction',
      selectedGroup );
      // setTimeout(() => {
      //   executeEvent("sent-new-message-group", {})
      // }, 150);
      // clearEditorContent()
      // setReplyMessage(null)

      // send chat message
    } catch (error) {
      const errorMsg = error?.message || error
      setInfoSnack({
        type: "error",
        message: errorMsg,
      });
      setOpenSnack(true);
      console.error(error)
    } finally {
      setIsSending(false)
      resumeAllQueues()
    }
  }, [])
  
  return (
    <div style={{
      height: isMobile ? '100%' : '100%',
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      opacity: hide ? 0 : 1,
      position: hide ? 'absolute' : 'relative',
    left: hide && '-100000px',
    }}>
 
              <ChatList onReply={onReply} chatId={selectedGroup} initialMessages={messages} myAddress={myAddress} tempMessages={tempMessages} handleReaction={handleReaction} chatReferences={chatReferences} tempChatReferences={tempChatReferences}/>

   
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
     
     
      <Tiptap setEditorRef={setEditorRef} onEnter={sendMessage} isChat disableEnter={isMobile ? true : false} isFocusedParent={isFocusedParent} setIsFocusedParent={setIsFocusedParent} />
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
                padding: isMobile && '5px',
                
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
      {/* <button onClick={sendMessage}>send</button> */}
      </div>
      {/* <ChatContainerComp messages={formatMessages} /> */}
      <LoadingSnackbar open={isLoading} info={{
        message: "Loading chat... please wait."
      }} />
             <CustomizedSnackbars open={openSnack} setOpen={setOpenSnack} info={infoSnack} setInfo={setInfoSnack}  />

    </div>
  )
}
