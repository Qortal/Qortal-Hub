import { useContext, useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { userInfoAtom } from '../../../atoms/global';
import { Box, CircularProgress, Input, useTheme } from '@mui/material';
import ShortUniqueId from 'short-unique-id';
import {
  CloseContainer,
  ComposeContainer,
  ComposeP,
  InstanceListContainer,
  NewMessageHeaderP,
  NewMessageInputRow,
  NewMessageSendButton,
  NewMessageSendP,
} from './Mail-styles';
import { ReusableModal } from './ReusableModal';
import { Spacer } from '../../../common/Spacer';
import { CreateThreadIcon } from '../../../assets/Icons/CreateThreadIcon';
import { SendNewMessage } from '../../../assets/Icons/SendNewMessage';
import {
  QORTAL_APP_CONTEXT,
  pauseAllQueues,
  resumeAllQueues,
} from '../../../App';
import { getFee } from '../../../background/background';
import TipTap from '../../Chat/TipTap';
import '../../Chat/chat.css';
import { MessageDisplay } from '../../Chat/MessageDisplay';
import { CustomizedSnackbars } from '../../Snackbar/Snackbar';
import { saveTempPublish } from '../../Chat/GroupAnnouncements';
import { useTranslation } from 'react-i18next';
import { ComposeIcon } from '../../../assets/Icons/ComposeIcon';
import CloseIcon from '@mui/icons-material/Close';

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
  const blob = new Blob([jsonString], { type: 'application/json' });

  // Step 3: Create a FileReader to read the Blob as a base64-encoded string
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        // Remove 'data:application/json;base64,' prefix
        const base64 = reader.result.replace(
          'data:application/json;base64,',
          ''
        );
        resolve(base64);
      } else {
        reject(new Error('Failed to read the Blob as a base64-encoded string'));
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
    window
      .sendMessage('publishGroupEncryptedResource', {
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
        rej(error.message || 'An error occurred');
      });
  });
};

export const encryptSingleFunc = async (data: string, secretKeyObject: any) => {
  try {
    return new Promise((res, rej) => {
      window
        .sendMessage('encryptSingle', {
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
          rej(error.message || 'An error occurred');
        });
    });
  } catch (error) {
    console.log(error);
  }
};

export const NewThread = ({
  groupInfo,
  members,
  currentThread,
  isMessage = false,
  publishCallback,
  getSecretKey,
  closeCallback,
  postReply,
  setPostReply,
  isPrivate,
}: NewMessageProps) => {
  const userInfo = useAtomValue(userInfoAtom);
  const myName = userInfo?.name;
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [value, setValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [threadTitle, setThreadTitle] = useState<string>('');
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const editorRef = useRef(null);
  const theme = useTheme();
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
    setValue('');
    if (setPostReply) {
      setPostReply(null);
    }
  };

  async function publishQDNResource() {
    try {
      pauseAllQueues();
      if (isSending) return;
      setIsSending(true);
      let name: string = '';
      let errorMsg = '';

      name = userInfo?.name || '';

      const missingFields: string[] = [];

      if (!isMessage && !threadTitle) {
        errorMsg = t('core:message.question.provide_thread', {
          postProcess: 'capitalizeFirstChar',
        });
      }

      if (!name) {
        errorMsg = t('group:message.error.access_name', {
          postProcess: 'capitalizeFirstChar',
        });
      }

      if (!groupInfo) {
        errorMsg = t('group:message.error.group_info', {
          postProcess: 'capitalizeFirstChar',
        });
      }

      // if (!description) missingFields.push('subject')
      if (missingFields.length > 0) {
        const missingFieldsString = missingFields.join(', ');
        const errMsg = t('core:message.error.missing_fields', {
          field: missingFieldsString,
          postProcess: 'capitalizeFirstChar',
        });
        errorMsg = errMsg;
      }

      if (errorMsg) {
        throw new Error(errorMsg);
      }

      const htmlContent = editorRef.current.getHTML();

      if (!htmlContent?.trim() || htmlContent?.trim() === '<p></p>') {
        const errMsg = t('group:message.generic.provide_message', {
          postProcess: 'capitalizeFirstChar',
        });
        throw new Error(errMsg);
      }

      const fee = await getFee('ARBITRARY');
      let feeToShow = fee.fee;

      if (!isMessage) {
        feeToShow = +feeToShow * 2;
      }
      await show({
        message: t('core:message.question.perform_transaction', {
          action: 'ARBITRARY',
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: feeToShow + ' QORT',
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

      const secretKey =
        isPrivate === false ? null : await getSecretKey(false, true);
      if (!secretKey && isPrivate) {
        const errMsg = t('group:message.error.group_secret_key', {
          postProcess: 'capitalizeFirstChar',
        });
        throw new Error(errMsg);
      }

      if (!isMessage) {
        const idThread = uid.rnd();
        const idMsg = uid.rnd();
        const messageToBase64 = await objectToBase64(mailObject);
        const encryptSingleFirstPost =
          isPrivate === false
            ? messageToBase64
            : await encryptSingleFunc(messageToBase64, secretKey);
        const threadObject = {
          title: threadTitle,
          groupId: groupInfo.id,
          createdAt: Date.now(),
          name,
        };
        const threadToBase64 = await objectToBase64(threadObject);

        const encryptSingleThread =
          isPrivate === false
            ? threadToBase64
            : await encryptSingleFunc(threadToBase64, secretKey);
        const identifierThread = `grp-${groupInfo.groupId}-thread-${idThread}`;
        await publishGroupEncryptedResource({
          identifier: identifierThread,
          encryptedData: encryptSingleThread,
        });

        const identifierPost = `thmsg-${identifierThread}-${idMsg}`;
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
          groupId: groupInfo.groupId,
        };

        const dataToSaveToStoragePost = {
          name: myName,
          identifier: identifierPost,
          service: 'DOCUMENT',
          tempData: mailObject,
          created: Date.now(),
          threadId: identifierThread,
        };

        await saveTempPublish({ data: dataToSaveToStorage, key: 'thread' });
        await saveTempPublish({
          data: dataToSaveToStoragePost,
          key: 'thread-post',
        });
        setInfoSnack({
          type: 'success',
          message: t('group:message.success.thread_creation', {
            postProcess: 'capitalizeFirstChar',
          }),
        });
        setOpenSnack(true);

        if (publishCallback) {
          publishCallback();
        }
        closeModal();
      } else {
        if (!currentThread) {
          const errMsg = t('group:message.error.thread_id', {
            postProcess: 'capitalizeFirstChar',
          });
          throw new Error(errMsg);
        }
        const idThread = currentThread.threadId;
        const messageToBase64 = await objectToBase64(mailObject);
        const encryptSinglePost =
          isPrivate === false
            ? messageToBase64
            : await encryptSingleFunc(messageToBase64, secretKey);

        const idMsg = uid.rnd();
        const identifier = `thmsg-${idThread}-${idMsg}`;
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
          created: Date.now(),
        };
        await saveTempPublish({
          data: dataToSaveToStoragePost,
          key: 'thread-post',
        });
        setInfoSnack({
          type: 'success',
          message: t('group:message.success.post_creation', {
            postProcess: 'capitalizeFirstChar',
          }),
        });
        setOpenSnack(true);
        if (publishCallback) {
          publishCallback();
        }
      }
      closeModal();
    } catch (error: any) {
      if (error?.message) {
        setInfoSnack({
          type: 'error',
          message: error?.message,
        });
        setOpenSnack(true);
      }
    } finally {
      setIsSending(false);
      resumeAllQueues();
    }
  }

  const sendMail = () => {
    publishQDNResource();
  };

  return (
    <Box
      sx={{
        display: 'flex',
      }}
    >
      <ComposeContainer
        sx={{
          padding: '15px',
          justifyContent: 'revert',
        }}
        onClick={() => setIsOpen(true)}
      >
        <ComposeIcon />
        <ComposeP>
          {currentThread
            ? t('core:action.new.post', {
                postProcess: 'capitalizeFirstChar',
              })
            : t('core:action.new.thread', {
                postProcess: 'capitalizeFirstChar',
              })}
        </ComposeP>
      </ComposeContainer>

      <ReusableModal
        open={isOpen}
        customStyles={{
          maxHeight: '90vh',
          maxWidth: '640px',
          width: '90%',
          borderRadius: '16px',
          backgroundColor: theme.palette.background.paper,
          padding: 0,
          gap: 0,
          boxShadow: theme.shadows[24],
          border: '1px solid',
          borderColor: theme.palette.divider,
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            borderBottom: '1px solid',
            borderColor: theme.palette.divider,
            display: 'flex',
            justifyContent: 'space-between',
            padding: '16px 24px',
          }}
        >
          <NewMessageHeaderP>
            {isMessage
              ? t('core:action.post_message', {
                  postProcess: 'capitalizeFirstChar',
                })
              : t('core:action.new.thread', {
                  postProcess: 'capitalizeFirstChar',
                })}
          </NewMessageHeaderP>

          <CloseContainer onClick={closeModal}>
            <CloseIcon
              sx={{ color: theme.palette.text.secondary, fontSize: 22 }}
            />
          </CloseContainer>
        </Box>

        <InstanceListContainer
          sx={{
            backgroundColor: theme.palette.background.paper,
            padding: '24px',
            flex: '1 1 auto',
            minHeight: 0,
            overflow: 'auto',
          }}
        >
          {!isMessage && (
            <>
              <Spacer height="8px" />
              <NewMessageInputRow>
                <Input
                  id="standard-adornment-name"
                  value={threadTitle}
                  onChange={(e) => setThreadTitle(e.target.value)}
                  placeholder={t('core:thread_title', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                  disableUnderline
                  autoComplete="off"
                  autoCorrect="off"
                  sx={{
                    width: '100%',
                    fontFamily: 'Inter',
                    fontSize: '18px',
                    '& .MuiInput-input::placeholder': {
                      opacity: 0.7,
                    },
                    '&:focus': { outline: 'none' },
                  }}
                />
              </NewMessageInputRow>
            </>
          )}

          {postReply?.textContentV2 && (
            <Box
              sx={{
                width: '100%',
                maxHeight: '120px',
                overflow: 'auto',
                mt: 1,
              }}
            >
              <MessageDisplay htmlContent={postReply.textContentV2} />
            </Box>
          )}

          <Spacer height="20px" />

          <Box
            sx={{
              minHeight: '200px',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <TipTap
              setEditorRef={setEditorRef}
              onEnter={sendMail}
              disableEnter
              overrideMobile
              customEditorHeight={240}
              composerStyle
              maxHeightOffset={120}
            />
          </Box>
        </InstanceListContainer>

        <Box
          sx={{
            alignItems: 'center',
            borderTop: '1px solid',
            borderColor: theme.palette.divider,
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '16px 24px',
          }}
        >
          <NewMessageSendButton
            onClick={sendMail}
            aria-busy={isSending}
            sx={{ opacity: isSending ? 0.8 : 1 }}
          >
            {isSending && (
              <CircularProgress
                size={20}
                sx={{
                  color: theme.palette.text.secondary,
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  marginTop: '-10px',
                  marginLeft: '-10px',
                }}
              />
            )}
            <NewMessageSendP
              sx={{ visibility: isSending ? 'hidden' : 'visible' }}
            >
              {isMessage
                ? t('core:action.post', { postProcess: 'capitalizeFirstChar' })
                : t('core:action.create_thread', {
                    postProcess: 'capitalizeFirstChar',
                  })}
            </NewMessageSendP>
            {!isSending &&
              (isMessage ? (
                <SendNewMessage />
              ) : (
                <CreateThreadIcon
                  color={theme.palette.text.primary}
                  opacity={1}
                  height="20px"
                  width="20px"
                />
              ))}
          </NewMessageSendButton>
        </Box>
      </ReusableModal>

      <CustomizedSnackbars
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />
    </Box>
  );
};
