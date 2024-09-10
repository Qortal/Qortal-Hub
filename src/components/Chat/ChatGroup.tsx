import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CreateCommonSecret } from './CreateCommonSecret'
import { reusableGet } from '../../qdn/publish/pubish'
import { uint8ArrayToObject } from '../../backgroundFunctions/encryption'
import { base64ToUint8Array, objectToBase64 } from '../../qdn/encryption/group-encryption'
import {  ChatContainerComp } from './ChatContainer'
import { ChatList } from './ChatList'
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import Tiptap from './TipTap'
import { CustomButton } from '../../App-styles'
import CircularProgress from '@mui/material/CircularProgress';
import { LoadingSnackbar } from '../Snackbar/LoadingSnackbar'
import { getBaseApiReactSocket } from '../../App'
import { CustomizedSnackbars } from '../Snackbar/Snackbar'
import { PUBLIC_NOTIFICATION_CODE_FIRST_SECRET_KEY } from '../../constants/codes'





export const ChatGroup = ({selectedGroup, secretKey, setSecretKey, getSecretKey, myAddress, handleNewEncryptionNotification, hide, handleSecretKeyCreationInProgress, triedToFetchSecretKey}) => {
  const [messages, setMessages] = useState([])
  const [isSending, setIsSending] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isMoved, setIsMoved] = useState(false);
  const [openSnack, setOpenSnack] = React.useState(false);
  const [infoSnack, setInfoSnack] = React.useState(null);
  const hasInitialized = useRef(false)
  const hasInitializedWebsocket = useRef(false)
  const socketRef = useRef(null); // WebSocket reference
  const timeoutIdRef = useRef(null); // Timeout ID reference
  const groupSocketTimeoutRef = useRef(null); // Group Socket Timeout reference
  const editorRef = useRef(null);

  const setEditorRef = (editorInstance) => {
    editorRef.current = editorInstance;
  };

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

 
    const decryptMessages = (encryptedMessages: any[])=> {
      try {
        if(!secretKeyRef.current){
          checkForFirstSecretKeyNotification(encryptedMessages)
          return
        }
        return new Promise((res, rej)=> {
          chrome.runtime.sendMessage({ action: "decryptSingle", payload: {
            data: encryptedMessages,
            secretKeyObject: secretKey
        }}, (response) => {
        
            if (!response?.error) {
              res(response)
              if(hasInitialized.current){
               
                const formatted = response.map((item: any)=> {
                  return {
                    ...item,
                    id: item.signature,
                    text: item.text,
                    unread:  true
                  }
                } )
                setMessages((prev)=> [...prev, ...formatted])
              } else {
                const formatted = response.map((item: any)=> {
                  return {
                    ...item,
                    id: item.signature,
                    text: item.text,
                    unread: false
                  }
                } )
                setMessages(formatted)
                hasInitialized.current = true

              }
            }
            rej(response.error)
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
          decryptMessages(JSON.parse(e.data))
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
        console.error('WebSocket error:', error);
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
        initWebsocketMessageGroup()
        hasInitializedWebsocket.current = true
    }, [secretKey])

  
    useEffect(()=> {
      const notifications = messages.filter((message)=> message?.text?.type === 'notification')
      if(notifications.length === 0) return
      const latestNotification = notifications.reduce((latest, current) => {
        return current.timestamp > latest.timestamp ? current : latest;
      }, notifications[0]);
      handleNewEncryptionNotification(latestNotification)
      
    }, [messages])
  

  const encryptChatMessage = async (data: string, secretKeyObject: any)=> {
    try {
      return new Promise((res, rej)=> {
        chrome.runtime.sendMessage({ action: "encryptSingle", payload: {
          data,
          secretKeyObject
      }}, (response) => {
     
          if (!response?.error) {
            res(response)
          }
          rej(response.error)
        });
      })  
    } catch (error) {
        
    }
}

const sendChatGroup = async ({groupId, typeMessage = undefined, chatReference = undefined, messageText}: any)=> {
  try {
    return new Promise((res, rej)=> {
      chrome.runtime.sendMessage({ action: "sendChatGroup", payload: {
        groupId, typeMessage, chatReference, messageText
    }}, (response) => {
    
        if (!response?.error) {
          res(response)
          return
        }
        rej(response.error)
      });
    })  
  } catch (error) {
      throw new Error(error)
  }
}
const clearEditorContent = () => {
  if (editorRef.current) {
    editorRef.current.chain().focus().clearContent().run();
  }
};


    const sendMessage = async ()=> {
      try {
        if(isSending) return
        if (editorRef.current) {
          const htmlContent = editorRef.current.getHTML();
       
          if(!htmlContent?.trim() || htmlContent?.trim() === '<p></p>') return
          setIsSending(true)
        const message = htmlContent
        const secretKeyObject = await getSecretKey()
        const message64: any = await objectToBase64(message)
     
        const encryptSingle = await encryptChatMessage(message64, secretKeyObject)
        const res = await sendChatGroup({groupId: selectedGroup,messageText: encryptSingle})
   
        clearEditorContent()
        }
        // send chat message
      } catch (error) {
        setInfoSnack({
          type: "error",
          message: error,
        });
        setOpenSnack(true);
        console.error(error)
      } finally {
        setIsSending(false)
      }
    }

  useEffect(() => {
    if (hide) {
      setTimeout(() => setIsMoved(true), 500); // Wait for the fade-out to complete before moving
    } else {
      setIsMoved(false); // Reset the position immediately when showing
    }
  }, [hide]);
    
  
  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      opacity: hide ? 0 : 1,
      visibility: hide && 'hidden',
      position: hide ? 'fixed' : 'relative',
    left: hide && '-1000px',
    }}>
 
              <ChatList initialMessages={messages} myAddress={myAddress}/>

   
      <div style={{
        // position: 'fixed',
        // bottom: '0px',
        backgroundColor: "#232428",
        minHeight: '150px',
        maxHeight: '400px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        width: '100%',
        boxSizing: 'border-box',
        padding: '20px'
      }}>
      <div style={{
            display: 'flex',
            flexDirection: 'column',
            // height: '100%',
            overflow: 'auto'
      }}>

     
      <Tiptap setEditorRef={setEditorRef} onEnter={sendMessage} isChat />
      </div>
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
                flexShrink: 0
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
