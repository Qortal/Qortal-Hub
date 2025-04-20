import React, { useMemo, useRef, useState } from 'react';
import TipTap from './TipTap';
import {
  AuthenticatedContainerInnerTop,
  CustomButton,
} from '../../styles/App-styles';
import { Box, CircularProgress, useTheme } from '@mui/material';
import { objectToBase64 } from '../../qdn/encryption/group-encryption';
import ShortUniqueId from 'short-unique-id';
import { LoadingSnackbar } from '../Snackbar/LoadingSnackbar';
import { getBaseApi, getFee } from '../../background';
import {
  decryptPublishes,
  getTempPublish,
  handleUnencryptedPublishes,
  saveTempPublish,
} from './GroupAnnouncements';
import { AnnouncementList } from './AnnouncementList';
import { Spacer } from '../../common/Spacer';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import {
  getArbitraryEndpointReact,
  getBaseApiReact,
  pauseAllQueues,
  resumeAllQueues,
} from '../../App';

const tempKey = 'accouncement-comment';

const uid = new ShortUniqueId({ length: 8 });
export const AnnouncementDiscussion = ({
  getSecretKey,
  encryptChatMessage,
  selectedAnnouncement,
  secretKey,
  setSelectedAnnouncement,
  show,
  myName,
  isPrivate,
}) => {
  const theme = useTheme();
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isFocusedParent, setIsFocusedParent] = useState(false);

  const [comments, setComments] = useState([]);
  const [tempPublishedList, setTempPublishedList] = useState([]);
  const firstMountRef = useRef(false);
  const [data, setData] = useState({});
  const editorRef = useRef(null);
  const setEditorRef = (editorInstance) => {
    editorRef.current = editorInstance;
  };

  const clearEditorContent = () => {
    if (editorRef.current) {
      editorRef.current.chain().focus().clearContent().run();
    }
  };

  const getData = async ({ identifier, name }, isPrivate) => {
    try {
      const res = await fetch(
        `${getBaseApiReact()}/arbitrary/DOCUMENT/${name}/${identifier}?encoding=base64`
      );
      if (!res?.ok) return;
      const data = await res.text();
      const response =
        isPrivate === false
          ? handleUnencryptedPublishes([data])
          : await decryptPublishes([{ data }], secretKey);

      const messageData = response[0];
      setData((prev) => {
        return {
          ...prev,
          [`${identifier}-${name}`]: messageData,
        };
      });
    } catch (error) {
      console.log(error);
    }
  };

  const publishAnc = async ({ encryptedData, identifier }: any) => {
    try {
      if (!selectedAnnouncement) return;

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
    } catch (error) {
      console.log(error);
    }
  };

  const setTempData = async () => {
    try {
      const getTempAnnouncements = await getTempPublish();
      if (getTempAnnouncements[tempKey]) {
        let tempData = [];
        Object.keys(getTempAnnouncements[tempKey] || {}).map((key) => {
          const value = getTempAnnouncements[tempKey][key];
          if (value.data?.announcementId === selectedAnnouncement.identifier) {
            tempData.push(value.data);
          }
        });
        setTempPublishedList(tempData);
      }
    } catch (error) {
      console.log(error);
    }
  };

  const publishComment = async () => {
    try {
      pauseAllQueues();
      const fee = await getFee('ARBITRARY');
      await show({
        message: 'Would you like to perform a ARBITRARY transaction?',
        publishFee: fee.fee + ' QORT',
      });
      if (isSending) return;
      if (editorRef.current) {
        const htmlContent = editorRef.current.getHTML();

        if (!htmlContent?.trim() || htmlContent?.trim() === '<p></p>') return;
        setIsSending(true);
        const message = {
          version: 1,
          extra: {},
          message: htmlContent,
        };
        const secretKeyObject =
          isPrivate === false ? null : await getSecretKey(false, true);
        const message64: any = await objectToBase64(message);

        const encryptSingle =
          isPrivate === false
            ? message64
            : await encryptChatMessage(message64, secretKeyObject);
        const randomUid = uid.rnd();
        const identifier = `cm-${selectedAnnouncement.identifier}-${randomUid}`;
        const res = await publishAnc({
          encryptedData: encryptSingle,
          identifier,
        });

        const dataToSaveToStorage = {
          name: myName,
          identifier,
          service: 'DOCUMENT',
          tempData: message,
          created: Date.now(),
          announcementId: selectedAnnouncement.identifier,
        };
        await saveTempPublish({ data: dataToSaveToStorage, key: tempKey });
        setTempData();

        clearEditorContent();
      }
      // send chat message
    } catch (error) {
      console.error(error);
    } finally {
      resumeAllQueues();
      setIsSending(false);
    }
  };

  const getComments = React.useCallback(
    async (selectedAnnouncement, isPrivate) => {
      try {
        setIsLoading(true);

        const offset = 0;

        // dispatch(setIsLoadingGlobal(true))
        const identifier = `cm-${selectedAnnouncement.identifier}`;
        const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=DOCUMENT&identifier=${identifier}&limit=20&includemetadata=false&offset=${offset}&reverse=true&prefix=true`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        const responseData = await response.json();
        setTempData();
        setComments(responseData);
        setIsLoading(false);
        for (const data of responseData) {
          getData({ name: data.name, identifier: data.identifier }, isPrivate);
        }
      } catch (error) {
        console.log(error);
      } finally {
        setIsLoading(false);

        // dispatch(setIsLoadingGlobal(false))
      }
    },
    [secretKey]
  );

  const loadMore = async () => {
    try {
      setIsLoading(true);

      const offset = comments.length;
      const identifier = `cm-${selectedAnnouncement.identifier}`;
      const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=DOCUMENT&identifier=${identifier}&limit=20&includemetadata=false&offset=${offset}&reverse=true&prefix=true`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const responseData = await response.json();

      setComments((prev) => [...prev, ...responseData]);
      setIsLoading(false);
      for (const data of responseData) {
        getData({ name: data.name, identifier: data.identifier }, isPrivate);
      }
    } catch (error) {
      console.log(error);
    }
  };

  const combinedListTempAndReal = useMemo(() => {
    // Combine the two lists
    const combined = [...tempPublishedList, ...comments];

    // Remove duplicates based on the "identifier"
    const uniqueItems = new Map();
    combined.forEach((item) => {
      uniqueItems.set(item.identifier, item); // This will overwrite duplicates, keeping the last occurrence
    });

    // Convert the map back to an array and sort by "created" timestamp in descending order
    const sortedList = Array.from(uniqueItems.values()).sort(
      (a, b) => b.created - a.created
    );

    return sortedList;
  }, [tempPublishedList, comments]);

  React.useEffect(() => {
    if (!secretKey && isPrivate) return;
    if (selectedAnnouncement && !firstMountRef.current && isPrivate !== null) {
      getComments(selectedAnnouncement, isPrivate);
      firstMountRef.current = true;
    }
  }, [selectedAnnouncement, secretKey, isPrivate]);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          position: 'relative',
          width: '100%',
        }}
      >
        <AuthenticatedContainerInnerTop
          sx={{
            height: '20px',
          }}
        >
          <ArrowBackIcon
            onClick={() => setSelectedAnnouncement(null)}
            sx={{
              cursor: 'pointer',
            }}
          />
        </AuthenticatedContainerInnerTop>

        <Spacer height="20px" />
      </div>
      <AnnouncementList
        announcementData={data}
        initialMessages={combinedListTempAndReal}
        setSelectedAnnouncement={() => {}}
        disableComment
        showLoadMore={comments.length > 0 && comments.length % 20 === 0}
        loadMore={loadMore}
        myName={myName}
      />
      <div
        style={{
          backgroundColor: theme.palette.background.default,
          bottom: isFocusedParent ? '0px' : 'unset',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          maxHeight: '400px',
          minHeight: '150px',
          overflow: 'hidden',
          padding: '20px',
          position: isFocusedParent ? 'fixed' : 'relative',
          top: isFocusedParent ? '0px' : 'unset',
          width: '100%',
          zIndex: isFocusedParent ? 5 : 'unset',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            overflow: 'auto',
          }}
        >
          <TipTap
            setEditorRef={setEditorRef}
            onEnter={publishComment}
            disableEnter
            maxHeightOffset="60px"
            isFocusedParent={isFocusedParent}
            setIsFocusedParent={setIsFocusedParent}
          />
        </div>
        <Box
          sx={{
            display: 'flex',
            flexShrink: 0,
            gap: '10px',
            justifyContent: 'center',
            position: 'relative',
            width: '100&',
          }}
        >
          {isFocusedParent && (
            <CustomButton
              onClick={() => {
                if (isSending) return;
                setIsFocusedParent(false);
                clearEditorContent();
                // Unfocus the editor
              }}
              style={{
                alignSelf: 'center',
                background: 'red',
                cursor: isSending ? 'default' : 'pointer',
                flexShrink: 0,
                fontSize: '14px',
                marginTop: 'auto',
                padding: '5px',
              }}
            >
              {` Close`}
            </CustomButton>
          )}
          <CustomButton
            onClick={() => {
              if (isSending) return;
              publishComment();
            }}
            style={{
              alignSelf: 'center',
              background: theme.palette.background.default,
              cursor: isSending ? 'default' : 'pointer',
              flexShrink: 0,
              fontSize: '14px',
              marginTop: 'auto',
              padding: '5px',
            }}
          >
            {isSending && (
              <CircularProgress
                size={18}
                sx={{
                  color: theme.palette.text.primary,
                  left: '50%',
                  marginLeft: '-12px',
                  marginTop: '-12px',
                  position: 'absolute',
                  top: '50%',
                }}
              />
            )}
            {` Publish Comment`}
          </CustomButton>
        </Box>
      </div>

      <LoadingSnackbar
        open={isLoading}
        info={{
          message: 'Loading comments... please wait.',
        }}
      />
    </div>
  );
};
