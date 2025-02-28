import React, { useEffect, useRef, useState } from "react";
import { Box, Button, CircularProgress, Input, Typography } from "@mui/material";
import ShortUniqueId from "short-unique-id";
import CloseIcon from "@mui/icons-material/Close";

import ModalCloseSVG from "../../../assets/svgs/ModalClose.svg";

import ComposeIconSVG from "../../../assets/svgs/ComposeIcon.svg";

import {
  AttachmentContainer,
  CloseContainer,
  ComposeContainer,
  ComposeIcon,
  ComposeP,
  InstanceFooter,
  InstanceListContainer,
  InstanceListHeader,
  NewMessageAttachmentImg,
  NewMessageCloseImg,
  NewMessageHeaderP,
  NewMessageInputRow,
  NewMessageSendButton,
  NewMessageSendP,
} from "./Mail-styles";

import { ReusableModal } from "./ReusableModal";
import { Spacer } from "../../../common/Spacer";
import { formatBytes } from "../../../utils/Size";
import { CreateThreadIcon } from "../../../assets/svgs/CreateThreadIcon";
import { SendNewMessage } from "../../../assets/svgs/SendNewMessage";
import { TextEditor } from "./TextEditor";
import { MyContext, isMobile, pauseAllQueues, resumeAllQueues } from "../../../App";
import { getFee } from "../../../background";
import TipTap from "../../Chat/TipTap";
import { MessageDisplay } from "../../Chat/MessageDisplay";
import { CustomizedSnackbars } from "../../Snackbar/Snackbar";
import { saveTempPublish } from "../../Chat/GroupAnnouncements";

const uid = new ShortUniqueId({ length: 8 });

export const toBase64 = (file: File): Promise<string | ArrayBuffer | null> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => {
      reject(error);
    };
  });

export function objectToBase64(obj: any) {
  // Step 1: Convert the object to a JSON string
  const jsonString = JSON.stringify(obj);

  // Step 2: Create a Blob from the JSON string
  const blob = new Blob([jsonString], { type: "application/json" });

  // Step 3: Create a FileReader to read the Blob as a base64-encoded string
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        // Remove 'data:application/json;base64,' prefix
        const base64 = reader.result.replace(
          "data:application/json;base64,",
          ""
        );
        resolve(base64);
      } else {
        reject(new Error("Failed to read the Blob as a base64-encoded string"));
      }
    };
    reader.onerror = () => {
      reject(reader.error);
    };
    reader.readAsDataURL(blob);
  });
}

interface NewMessageProps {
  hideButton?: boolean;
  groupInfo: any;
  currentThread?: any;
  isMessage?: boolean;
  messageCallback?: (val: any) => void;
  publishCallback?: () => void;
  refreshLatestThreads?: () => void;
  members: any;
}

export const publishGroupEncryptedResource = async ({
  encryptedData,
  identifier,
}) => {
  return new Promise((res, rej) => {
    window.sendMessage("publishGroupEncryptedResource", {
      encryptedData,
      identifier,
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
    
  });
};

export const encryptSingleFunc = async (data: string, secretKeyObject: any) => {
  try {
    return new Promise((res, rej) => {
      window.sendMessage("encryptSingle", {
        data,
        secretKeyObject,
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
      
    });
  } catch (error) {}
};
export const NewThread = ({
  groupInfo,
  members,
  currentThread,
  isMessage = false,
  publishCallback,
  userInfo,
  getSecretKey,
  closeCallback,
  postReply,
  myName,
  setPostReply,
  isPrivate
}: NewMessageProps) => {
  const { show } = React.useContext(MyContext);

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [value, setValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [threadTitle, setThreadTitle] = useState<string>("");
  const [openSnack, setOpenSnack] = React.useState(false);
  const [infoSnack, setInfoSnack] = React.useState(null);
  const editorRef = useRef(null);
  const setEditorRef = (editorInstance) => {
    editorRef.current = editorInstance;
  };

  useEffect(() => {
    if (postReply) {
      setIsOpen(true);
    }
  }, [postReply]);

  const closeModal = () => {
    setIsOpen(false);
    setValue("");
    if(setPostReply){
      setPostReply(null)
    }
   
  };

  async function publishQDNResource() {
    try {
      pauseAllQueues()
      if(isSending) return
      setIsSending(true)
      let name: string = "";
      let errorMsg = "";

      name = userInfo?.name || "";

      const missingFields: string[] = [];

      if (!isMessage && !threadTitle) {
        errorMsg = "Please provide a thread title";
      }

      if (!name) {
        errorMsg = "Cannot send a message without a access to your name";
      }
      if (!groupInfo) {
        errorMsg = "Cannot access group information";
      }

      // if (!description) missingFields.push('subject')
      if (missingFields.length > 0) {
        const missingFieldsString = missingFields.join(", ");
        const errMsg = `Missing: ${missingFieldsString}`;
        errorMsg = errMsg;
      }

     
      if (errorMsg) {
        // dispatch(
        //   setNotification({
        //     msg: errorMsg,
        //     alertType: "error",
        //   })
        // );
        throw new Error(errorMsg);
      }

      const htmlContent = editorRef.current.getHTML();
      
      if (!htmlContent?.trim() || htmlContent?.trim() === "<p></p>")
        throw new Error("Please provide a first message to the thread");
      const fee = await getFee("ARBITRARY");
      let feeToShow = fee.fee;
      if (!isMessage) {
        feeToShow = +feeToShow * 2;
      }
      await show({
        message: "Would you like to perform a ARBITRARY transaction?",
        publishFee: feeToShow + " QORT",
      });

      let reply = null;
      if (postReply) {
        reply = { ...postReply };
        if (reply.reply) {
          delete reply.reply;
        }
      }
      const mailObject: any = {
        createdAt: Date.now(),
        version: 1,
        textContentV2: htmlContent,
        name,
        threadOwner: currentThread?.threadData?.name || name,
        reply,
      };
    
      const secretKey = isPrivate === false ? null : await getSecretKey(false, true);
      if (!secretKey && isPrivate) {
        throw new Error("Cannot get group secret key");
      }
    
      if (!isMessage) {
        const idThread = uid.rnd();
        const idMsg = uid.rnd();
        const messageToBase64 = await objectToBase64(mailObject);
        const encryptSingleFirstPost = isPrivate === false ? messageToBase64 :  await encryptSingleFunc(
          messageToBase64,
          secretKey
        );
        const threadObject = {
          title: threadTitle,
          groupId: groupInfo.id,
          createdAt: Date.now(),
          name,
        };
        const threadToBase64 = await objectToBase64(threadObject);

        const encryptSingleThread = isPrivate === false ? threadToBase64 :  await encryptSingleFunc(
          threadToBase64,
          secretKey
        );
        let identifierThread = `grp-${groupInfo.groupId}-thread-${idThread}`;
        await publishGroupEncryptedResource({
          identifier: identifierThread,
          encryptedData: encryptSingleThread,
        });

        let identifierPost = `thmsg-${identifierThread}-${idMsg}`;
        await publishGroupEncryptedResource({
          identifier: identifierPost,
          encryptedData: encryptSingleFirstPost,
        });
        const dataToSaveToStorage = {
          name: myName,
          identifier: identifierThread,
          service: 'DOCUMENT',
          tempData: threadObject,
          created: Date.now(),
          groupId: groupInfo.groupId
        }
        const dataToSaveToStoragePost = {
          name: myName,
          identifier: identifierPost,
          service: 'DOCUMENT',
          tempData: mailObject,
          created: Date.now(),
          threadId: identifierThread
        }
        await saveTempPublish({data: dataToSaveToStorage, key: 'thread'})
        await saveTempPublish({data: dataToSaveToStoragePost, key: 'thread-post'})
        setInfoSnack({
          type: "success",
          message: "Successfully created thread. It may take some time for the publish to propagate",
        });
        setOpenSnack(true)

        // dispatch(
        //   setNotification({
        //     msg: "Message sent",
        //     alertType: "success",
        //   })
        // );
        if (publishCallback) {
          publishCallback()
    
        }
        closeModal();
      } else {
      
        if (!currentThread) throw new Error("unable to locate thread Id");
        const idThread = currentThread.threadId;
        const messageToBase64 = await objectToBase64(mailObject);
        const encryptSinglePost = isPrivate === false ? messageToBase64 :  await encryptSingleFunc(
          messageToBase64,
          secretKey
        );
        const idMsg = uid.rnd();
        let identifier = `thmsg-${idThread}-${idMsg}`;
        const res = await publishGroupEncryptedResource({
          identifier: identifier,
          encryptedData: encryptSinglePost,
        });
    
        const dataToSaveToStoragePost = {
          threadId: idThread,
          name: myName,
          identifier: identifier,
          service: 'DOCUMENT',
          tempData: mailObject,
          created: Date.now()
        }
        await saveTempPublish({data: dataToSaveToStoragePost, key: 'thread-post'})
        // await qortalRequest(multiplePublishMsg);
        // dispatch(
        //   setNotification({
        //     msg: "Message sent",
        //     alertType: "success",
        //   })
        // );
        setInfoSnack({
          type: "success",
          message: "Successfully created post. It may take some time for the publish to propagate",
        });
        setOpenSnack(true)
        if(publishCallback){
          publishCallback()
        }
        // messageCallback({
        //   identifier,
        //   id: identifier,
        //   name,
        //   service: MAIL_SERVICE_TYPE,
        //   created: Date.now(),
        //   ...mailObject,
        // });
      }

      closeModal();
    } catch (error: any) {
      if(error?.message){
        setInfoSnack({
          type: "error",
          message: error?.message,
        });
        setOpenSnack(true)
      }
      
    } finally {
      setIsSending(false);
      resumeAllQueues()
    }
  }

  const sendMail = () => {
    publishQDNResource();
  };
  return (
    <Box
      sx={{
        display: "flex",
      }}
    >
      <ComposeContainer
        sx={{
          padding: isMobile ? '5px' : "15px",
          justifyContent: isMobile ? 'flex-start' : 'revert'
        }}
        onClick={() => setIsOpen(true)}
      >
        <ComposeIcon src={ComposeIconSVG} />
        <ComposeP>{currentThread ? "New Post" : "New Thread"}</ComposeP>
      </ComposeContainer>

      <ReusableModal
        open={isOpen}
        customStyles={{
          maxHeight: isMobile ? '95svh' : "95vh",
          maxWidth: "950px",
          height: "700px",
          borderRadius: "12px 12px 0px 0px",
          background: "#434448",
          padding: "0px",
          gap: "0px",
        }}
      >
        <InstanceListHeader
          sx={{
            height: isMobile ? 'auto' : "50px",
            padding: isMobile ? '5px' : "20px 42px",
            flexDirection: "row",
            alignItems: 'center',
            justifyContent: "space-between",
            backgroundColor: "#434448",
          }}
        >
          <NewMessageHeaderP>
            {isMessage ? "Post Message" : "New Thread"}
          </NewMessageHeaderP>
          <CloseContainer sx={{
            height: '40px'
          }} onClick={closeModal}>
            <NewMessageCloseImg src={ModalCloseSVG} />
          </CloseContainer>
        </InstanceListHeader>
        <InstanceListContainer
          sx={{
            backgroundColor: "#434448",
            padding: isMobile ? '5px' : "20px 42px",
            height: "calc(100% - 165px)",
            flexShrink: 0,
          }}
        >
          {!isMessage && (
            <>
              <Spacer height="10px" />
              <NewMessageInputRow>
                <Input
                  id="standard-adornment-name"
                  value={threadTitle}
                  onChange={(e) => {
                    setThreadTitle(e.target.value);
                  }}
                  placeholder="Thread Title"
                  disableUnderline
                  autoComplete="off"
                  autoCorrect="off"
                  sx={{
                    width: "100%",
                    color: "white",
                    "& .MuiInput-input::placeholder": {
                      color: "rgba(255,255,255, 0.70) !important",
                      fontSize: isMobile ? '14px' : "20px",
                      fontStyle: "normal",
                      fontWeight: 400,
                      lineHeight: "120%", // 24px
                      letterSpacing: "0.15px",
                      opacity: 1,
                    },
                    "&:focus": {
                      outline: "none",
                    },
                    // Add any additional styles for the input here
                  }}
                />
              </NewMessageInputRow>
            </>
          )}

          {postReply && postReply.textContentV2 && (
            <Box
              sx={{
                width: "100%",
                maxHeight: "120px",
                overflow: "auto",
              }}
            >
              <MessageDisplay htmlContent={postReply?.textContentV2} />
            </Box>
          )}
          {!isMobile && (
                      <Spacer height="30px" />

          )}
          <Box
            sx={{
              maxHeight: "40vh",
            }}
          >
            <TipTap
              setEditorRef={setEditorRef}
              onEnter={sendMail}
              disableEnter
              overrideMobile
              customEditorHeight="240px"
            />
            {/* <TextEditor
              inlineContent={value}
              setInlineContent={(val: any) => {
                setValue(val);
              }}
            /> */}
          </Box>
        </InstanceListContainer>
        <InstanceFooter
          sx={{
            backgroundColor: "#434448",
            padding: isMobile ? '5px' :  "20px 42px",
            alignItems: "center",
            height: isMobile ? 'auto' :  "90px",
          }}
        >
          <NewMessageSendButton onClick={sendMail}>
            {isSending && (
              <Box sx={{height: '100%', position: 'absolute', width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center'}}>
                <CircularProgress sx={{

                }} size={'12px'} />
              </Box>
            )}
            <NewMessageSendP>
              {isMessage ? "Post" : "Create Thread"}
            </NewMessageSendP>
            {isMessage ? (
              <SendNewMessage
                opacity={1}
                height="25px"
                width="25px"
              />
            ) : (
              <CreateThreadIcon
                opacity={1}
                height="25px"
                width="25px"
              />
            )}
          </NewMessageSendButton>
        </InstanceFooter>
      
      </ReusableModal>
      <CustomizedSnackbars open={openSnack} setOpen={setOpenSnack} info={infoSnack} setInfo={setInfoSnack}  />
    </Box>
  );
};
