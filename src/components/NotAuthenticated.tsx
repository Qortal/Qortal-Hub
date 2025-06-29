import {
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Spacer } from '../common/Spacer';
import { CustomButton, TextP, TextSpan } from '../styles/App-styles';
import {
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Input,
  styled,
  Switch,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import Logo1Dark from '../assets/svgs/Logo1Dark.svg';
import HelpIcon from '@mui/icons-material/Help';
import { CustomizedSnackbars } from './Snackbar/Snackbar';
import { cleanUrl, gateways } from '../background/background.ts';
import Tooltip, { TooltipProps, tooltipClasses } from '@mui/material/Tooltip';
import { useTranslation } from 'react-i18next';
import { QORTAL_APP_CONTEXT } from '../App';

export const manifestData = {
  version: '0.5.4',
};

export const HtmlTooltip = styled(({ className, ...props }: TooltipProps) => (
  <Tooltip {...props} classes={{ popper: className }} />
))(({ theme }) => ({
  [`& .${tooltipClasses.tooltip}`]: {
    backgroundColor: theme.palette.background.paper,
    color: theme.palette.text.primary,
    maxWidth: 320,
    padding: '20px',
    fontSize: theme.typography.pxToRem(12),
  },
}));

function removeTrailingSlash(url) {
  return url.replace(/\/+$/, '');
}

export const NotAuthenticated = ({
  getRootProps,
  getInputProps,
  setExtstate,
  apiKey,
  setApiKey,
  globalApiKey,
  handleSetGlobalApikey,
  currentNode,
  setCurrentNode,
  useLocalNode,
  setUseLocalNode,
}) => {
  const [isValidApiKey, setIsValidApiKey] = useState<boolean | null>(null);
  const [hasLocalNode, setHasLocalNode] = useState<boolean | null>(null);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const [show, setShow] = useState(false);
  const [mode, setMode] = useState('list');
  const [customNodes, setCustomNodes] = useState(null);
  const [importedApiKey, setImportedApiKey] = useState(null);
  const [url, setUrl] = useState('https://');
  const [customApikey, setCustomApiKey] = useState('');
  const [showSelectApiKey, setShowSelectApiKey] = useState(false);
  const [enteredApiKey, setEnteredApiKey] = useState('');
  const [customNodeToSaveIndex, setCustomNodeToSaveIndex] = useState(null);
  const { showTutorial, hasSeenGettingStarted } =
    useContext(QORTAL_APP_CONTEXT);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const importedApiKeyRef = useRef(null);
  const currentNodeRef = useRef(null);
  const hasLocalNodeRef = useRef(null);
  const isLocal = cleanUrl(currentNode?.url) === '127.0.0.1:12391';
  const handleFileChangeApiKey = (event) => {
    setShowSelectApiKey(false);
    const file = event.target.files[0]; // Get the selected file
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result; // Get the file content

        setImportedApiKey(text); // Store the file content in the state
        if (customNodes) {
          setCustomNodes((prev) => {
            const copyPrev = [...prev];
            const findLocalIndex = copyPrev?.findIndex(
              (item) => item?.url === 'http://127.0.0.1:12391'
            );
            if (findLocalIndex === -1) {
              copyPrev.unshift({
                url: 'http://127.0.0.1:12391',
                apikey: text,
              });
            } else {
              copyPrev[findLocalIndex] = {
                url: 'http://127.0.0.1:12391',
                apikey: text,
              };
            }
            window.sendMessage('setCustomNodes', copyPrev).catch((error) => {
              console.error(
                'Failed to set custom nodes:',
                error.message ||
                  t('core:message.error.generic', {
                    postProcess: 'capitalizeFirstChar',
                  })
              );
            });
            return copyPrev;
          });
        }
      };
      reader.readAsText(file); // Read the file as text
    }
  };

  const checkIfUserHasLocalNode = useCallback(async () => {
    try {
      const url = `http://127.0.0.1:12391/admin/status`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const data = await response.json();
      if (data?.height) {
        setHasLocalNode(true);
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }, []);

  useEffect(() => {
    checkIfUserHasLocalNode();
  }, []);

  useEffect(() => {
    window
      .sendMessage('getCustomNodesFromStorage')
      .then((response) => {
        setCustomNodes(response || []);
        if (window?.electronAPI?.setAllowedDomains) {
          window.electronAPI.setAllowedDomains(
            response?.map((node) => node.url)
          );
        }
        if (Array.isArray(response)) {
          const findLocal = response?.find(
            (item) => item?.url === 'http://127.0.0.1:12391'
          );
          if (findLocal && findLocal?.apikey) {
            setImportedApiKey(findLocal?.apikey);
          }
        }
      })
      .catch((error) => {
        console.error(
          'Failed to get custom nodes from storage:',
          error.message ||
            t('core:message.error.generic', {
              postProcess: 'capitalizeFirstChar',
            })
        );
      });
  }, []);

  useEffect(() => {
    importedApiKeyRef.current = importedApiKey;
  }, [importedApiKey]);

  useEffect(() => {
    currentNodeRef.current = currentNode;
  }, [currentNode]);

  useEffect(() => {
    hasLocalNodeRef.current = hasLocalNode;
  }, [hasLocalNode]);

  const validateApiKey = useCallback(async (key, fromStartUp) => {
    try {
      if (key === 'isGateway') return;
      const isLocalKey = cleanUrl(key?.url) === '127.0.0.1:12391';
      if (
        fromStartUp &&
        key?.url &&
        key?.apikey &&
        !isLocalKey &&
        !gateways.some((gateway) => key?.url?.includes(gateway))
      ) {
        setCurrentNode({
          url: key?.url,
          apikey: key?.apikey,
        });

        let isValid = false;

        const url = `${key?.url}/admin/settings/localAuthBypassEnabled`;
        const response = await fetch(url);

        // Assuming the response is in plain text and will be 'true' or 'false'
        const data = await response.text();
        if (data && data === 'true') {
          isValid = true;
        } else {
          const url2 = `${key?.url}/admin/apikey/test?apiKey=${key?.apikey}`;
          const response2 = await fetch(url2);

          // Assuming the response is in plain text and will be 'true' or 'false'
          const data2 = await response2.text();
          if (data2 === 'true') {
            isValid = true;
          }
        }

        if (isValid) {
          setIsValidApiKey(true);
          setUseLocalNode(true);
          return;
        }
      }
      if (!currentNodeRef.current) return;
      const stillHasLocal = await checkIfUserHasLocalNode();

      if (isLocalKey && !stillHasLocal && !fromStartUp) {
        throw new Error(
          t('auth:message.generic.turn_local_node', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
      //check custom nodes
      // !gateways.some(gateway => apiKey?.url?.includes(gateway))
      const isCurrentNodeLocal =
        cleanUrl(currentNodeRef.current?.url) === '127.0.0.1:12391';
      if (isLocalKey && !isCurrentNodeLocal) {
        setIsValidApiKey(false);
        setUseLocalNode(false);
        return;
      }
      let payload = {};

      if (currentNodeRef.current?.url === 'http://127.0.0.1:12391') {
        payload = {
          apikey: importedApiKeyRef.current || key?.apikey,
          url: currentNodeRef.current?.url,
        };
        if (!payload?.apikey) {
          try {
            const generateUrl = 'http://127.0.0.1:12391/admin/apikey/generate';
            const generateRes = await fetch(generateUrl, {
              method: 'POST',
            });
            let res;
            try {
              res = await generateRes.clone().json();
            } catch (e) {
              res = await generateRes.text();
            }
            if (res != null && !res.error && res.length >= 8) {
              payload = {
                apikey: res,
                url: currentNodeRef.current?.url,
              };

              setImportedApiKey(res); // Store the file content in the state

              setCustomNodes((prev) => {
                const copyPrev = [...prev];
                const findLocalIndex = copyPrev?.findIndex(
                  (item) => item?.url === 'http://127.0.0.1:12391'
                );
                if (findLocalIndex === -1) {
                  copyPrev.unshift({
                    url: 'http://127.0.0.1:12391',
                    apikey: res,
                  });
                } else {
                  copyPrev[findLocalIndex] = {
                    url: 'http://127.0.0.1:12391',
                    apikey: res,
                  };
                }
                window
                  .sendMessage('setCustomNodes', copyPrev)
                  .catch((error) => {
                    console.error(
                      'Failed to set custom nodes:',
                      error.message ||
                        t('core:message.error.generic', {
                          postProcess: 'capitalizeFirstChar',
                        })
                    );
                  });
                return copyPrev;
              });
            }
          } catch (error) {
            console.error(error);
          }
        }
      } else if (currentNodeRef.current) {
        payload = currentNodeRef.current;
      }

      let isValid = false;

      const url = `${payload?.url}/admin/settings/localAuthBypassEnabled`;
      const response = await fetch(url);

      // Assuming the response is in plain text and will be 'true' or 'false'
      const data = await response.text();
      if (data && data === 'true') {
        isValid = true;
      } else {
        const url2 = `${payload?.url}/admin/apikey/test?apiKey=${payload?.apikey}`;
        const response2 = await fetch(url2);

        // Assuming the response is in plain text and will be 'true' or 'false'
        const data2 = await response2.text();
        if (data2 === 'true') {
          isValid = true;
        }
      }

      if (isValid) {
        window
          .sendMessage('setApiKey', payload)
          .then((response) => {
            if (response) {
              handleSetGlobalApikey(payload);
              setIsValidApiKey(true);
              setUseLocalNode(true);
              if (!fromStartUp) {
                setApiKey(payload);
              }
            }
          })
          .catch((error) => {
            console.error(
              t('auth:message.error.set_apikey', {
                postProcess: 'capitalizeFirstChar',
              }),
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
          });
      } else {
        setIsValidApiKey(false);
        setUseLocalNode(false);
        if (!fromStartUp) {
          setInfoSnack({
            type: 'error',
            message: t('auth:apikey.select_valid', {
              postProcess: 'capitalizeFirstChar',
            }),
          });
          setOpenSnack(true);
        }
      }
    } catch (error) {
      setIsValidApiKey(false);
      setUseLocalNode(false);
      if (fromStartUp) {
        setCurrentNode({
          url: 'http://127.0.0.1:12391',
        });
        window
          .sendMessage('setApiKey', 'isGateway')
          .then((response) => {
            if (response) {
              setApiKey(null);
              handleSetGlobalApikey(null);
            }
          })
          .catch((error) => {
            console.error(
              t('auth:message.error.set_apikey', {
                postProcess: 'capitalizeFirstChar',
              }),
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
          });
        return;
      }
      if (!fromStartUp) {
        setInfoSnack({
          type: 'error',
          message:
            error?.message ||
            t('auth:apikey.select_valid', {
              postProcess: 'capitalizeFirstChar',
            }),
        });
        setOpenSnack(true);
      }
      console.error('Error validating API key:', error);
    }
  }, []);

  useEffect(() => {
    if (apiKey) {
      validateApiKey(apiKey, true);
    }
  }, [apiKey]);

  const addCustomNode = () => {
    setMode('add-node');
  };

  const saveCustomNodes = (myNodes, isFullListOfNodes) => {
    let nodes = [...(myNodes || [])];
    if (!isFullListOfNodes && customNodeToSaveIndex !== null) {
      nodes.splice(customNodeToSaveIndex, 1, {
        url: removeTrailingSlash(url),
        apikey: customApikey,
      });
    } else if (!isFullListOfNodes && url) {
      nodes.push({
        url: removeTrailingSlash(url),
        apikey: customApikey,
      });
    }

    setCustomNodes(nodes);

    setCustomNodeToSaveIndex(null);
    if (!nodes) return;
    window
      .sendMessage('setCustomNodes', nodes)
      .then((response) => {
        if (response) {
          setMode('list');
          setUrl('https://');
          setCustomApiKey('');
          if (window?.electronAPI?.setAllowedDomains) {
            window.electronAPI.setAllowedDomains(
              nodes?.map((node) => node.url)
            );
          }
          // add alert if needed
        }
      })
      .catch((error) => {
        console.error(
          'Failed to set custom nodes:',
          error.message ||
            t('core:message.error.generic', {
              postProcess: 'capitalizeFirstChar',
            })
        );
      });
  };

  return (
    <>
      <Spacer height="35px" />

      <Box
        className="image-container"
        style={{
          width: '136px',
          height: '154px',
        }}
      >
        <img src={Logo1Dark} className="base-image" />
      </Box>

      <Spacer height="30px" />

      <TextP
        sx={{
          textAlign: 'center',
          lineHeight: 1.2,
          fontSize: '18px',
        }}
      >
        {t('auth:welcome', { postProcess: 'capitalizeFirstChar' })}
        <TextSpan
          sx={{
            fontSize: '18px',
          }}
        >
          {' '}
          QORTAL
        </TextSpan>
      </TextP>

      <Spacer height="30px" />

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: '10px',
        }}
      >
        <HtmlTooltip
          disableHoverListener={hasSeenGettingStarted === true}
          placement="left"
          title={
            <Fragment>
              <Typography
                color="inherit"
                sx={{
                  fontSize: '16px',
                }}
              >
                {t('auth:tips.digital_id', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </Fragment>
          }
        >
          <CustomButton onClick={() => setExtstate('wallets')}>
            {t('auth:account.account_many', {
              postProcess: 'capitalizeFirstChar',
            })}
          </CustomButton>
        </HtmlTooltip>
      </Box>

      <Spacer height="6px" />

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: '10px',
        }}
      >
        <HtmlTooltip
          disableHoverListener={hasSeenGettingStarted === true}
          placement="right"
          title={
            <Fragment>
              <Typography
                color="inherit"
                sx={{
                  fontWeight: 'bold',
                  fontSize: '18px',
                }}
              >
                {t('auth:tips.new_users', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>

              <Spacer height="10px" />

              <Typography
                color="inherit"
                sx={{
                  fontSize: '16px',
                }}
              >
                {t('auth:tips.new_account', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </Fragment>
          }
        >
          <CustomButton
            onClick={() => {
              setExtstate('create-wallet');
            }}
            sx={{
              backgroundColor:
                hasSeenGettingStarted === false && theme.palette.other.positive,
              color:
                hasSeenGettingStarted === false && theme.palette.text.primary,
              '&:hover': {
                backgroundColor:
                  hasSeenGettingStarted === false && theme.palette.other.unread,
                color:
                  hasSeenGettingStarted === false && theme.palette.text.primary,
              },
            }}
          >
            {t('auth:action.create_account', {
              postProcess: 'capitalizeFirstChar',
            })}
          </CustomButton>
        </HtmlTooltip>
      </Box>

      <Spacer height="15px" />

      <Typography
        sx={{
          fontSize: '12px',
          visibility: !useLocalNode && 'hidden',
        }}
      >
        {t('auth:node.using', { postProcess: 'capitalizeFirstChar' })}:{' '}
        {currentNode?.url}
      </Typography>

      <>
        <Spacer height="15px" />

        <Box
          sx={{
            alignItems: 'center',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            outlineStyle: 'solid',
            outlineWidth: '0.5px',
            padding: '20px 30px',
          }}
        >
          <>
            <Typography
              sx={{
                textDecoration: 'underline',
              }}
            >
              {t('auth:advanced_users', { postProcess: 'capitalizeFirstChar' })}
            </Typography>

            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                gap: '10px',
                justifyContent: 'center',
                width: '100%',
              }}
            >
              <FormControlLabel
                sx={{
                  '& .MuiFormControlLabel-label': {
                    fontSize: '14px',
                  },
                }}
                control={
                  <Switch
                    checked={useLocalNode}
                    onChange={(event) => {
                      if (event.target.checked) {
                        validateApiKey(currentNode);
                      } else {
                        setCurrentNode({
                          url: 'http://127.0.0.1:12391',
                        });
                        setUseLocalNode(false);
                        window
                          .sendMessage('setApiKey', null)
                          .then((response) => {
                            if (response) {
                              setApiKey(null);
                              handleSetGlobalApikey(null);
                            }
                          })
                          .catch((error) => {
                            console.error(
                              t('auth:message.error.set_apikey', {
                                postProcess: 'capitalizeFirstChar',
                              }),
                              error.message ||
                                t('core:message.error.generic', {
                                  postProcess: 'capitalizeFirstChar',
                                })
                            );
                          });
                      }
                    }}
                    disabled={false}
                  />
                }
                label={
                  isLocal
                    ? t('auth:node.use_local', {
                        postProcess: 'capitalizeFirstChar',
                      })
                    : t('auth:node.use_custom', {
                        postProcess: 'capitalizeFirstChar',
                      })
                }
              />
            </Box>
            {currentNode?.url === 'http://127.0.0.1:12391' && (
              <>
                <Button
                  onClick={() => setShowSelectApiKey(true)}
                  size="small"
                  variant="contained"
                  component="label"
                >
                  {apiKey
                    ? t('auth:node.use_local', {
                        postProcess: 'capitalizeFirstChar',
                      })
                    : t('auth:apikey.import', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                </Button>

                <Typography
                  sx={{
                    fontSize: '12px',
                    visibility: importedApiKey ? 'visible' : 'hidden',
                  }}
                >
                  {t('auth:apikey.key', { postProcess: 'capitalizeFirstChar' })}
                  : {importedApiKey}
                </Typography>
              </>
            )}

            <Button
              size="small"
              onClick={() => {
                setShow(true);
              }}
              variant="contained"
              component="label"
            >
              {t('auth:node.choose', { postProcess: 'capitalizeFirstChar' })}
            </Button>
          </>

          <Typography
            sx={{
              color: theme.palette.text.primary,
              fontSize: '12px',
            }}
          >
            {t('auth:build_version', { postProcess: 'capitalizeFirstChar' })}:
            {manifestData?.version}
          </Typography>
        </Box>
      </>

      <CustomizedSnackbars
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />

      {show && (
        <Dialog
          open={show}
          aria-labelledby="alert-dialog-title"
          aria-describedby="alert-dialog-description"
          fullWidth
        >
          <DialogTitle
            id="alert-dialog-title"
            sx={{
              fontWeight: 'bold',
              opacity: 1,
              textAlign: 'center',
            }}
          >
            {t('auth:node.custom_many', { postProcess: 'capitalizeAll' })}
          </DialogTitle>

          <DialogContent>
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '60vh',
                overflow: 'auto',
                width: '100% !important',
              }}
            >
              {mode === 'list' && (
                <Box
                  sx={{
                    gap: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      gap: '10px',
                      flexDirection: 'column',
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: '14px',
                      }}
                    >
                      http://127.0.0.1:12391
                    </Typography>

                    <Box
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        gap: '10px',
                        justifyContent: 'space-between',
                      }}
                    >
                      <Button
                        disabled={currentNode?.url === 'http://127.0.0.1:12391'}
                        size="small"
                        onClick={() => {
                          setCurrentNode({
                            url: 'http://127.0.0.1:12391',
                          });
                          setMode('list');
                          setShow(false);
                          setUseLocalNode(false);
                          window
                            .sendMessage('setApiKey', null)
                            .then((response) => {
                              if (response) {
                                setApiKey(null);
                                handleSetGlobalApikey(null);
                              }
                            })
                            .catch((error) => {
                              console.error(
                                t('auth:message.error.set_apikey', {
                                  postProcess: 'capitalizeFirstChar',
                                }),
                                error.message ||
                                  t('core:message.error.generic', {
                                    postProcess: 'capitalizeFirstChar',
                                  })
                              );
                            });
                        }}
                        variant="contained"
                      >
                        {t('core:action.choose', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Button>
                    </Box>
                  </Box>

                  {customNodes?.map((node, index) => {
                    return (
                      <Box
                        key={index}
                        sx={{
                          display: 'flex',
                          gap: '10px',
                          flexDirection: 'column',
                        }}
                      >
                        <Typography
                          sx={{
                            fontSize: '14px',
                          }}
                        >
                          {node?.url}
                        </Typography>

                        <Box
                          sx={{
                            alignItems: 'center',
                            display: 'flex',
                            gap: '10px',
                            justifyContent: 'space-between',
                          }}
                        >
                          <Button
                            disabled={currentNode?.url === node?.url}
                            size="small"
                            onClick={() => {
                              setCurrentNode({
                                url: node?.url,
                                apikey: node?.apikey,
                              });
                              setMode('list');
                              setShow(false);
                              setIsValidApiKey(false);
                              setUseLocalNode(false);
                              window
                                .sendMessage('setApiKey', null)
                                .then((response) => {
                                  if (response) {
                                    setApiKey(null);
                                    handleSetGlobalApikey(null);
                                  }
                                })
                                .catch((error) => {
                                  console.error(
                                    t('auth:message.error.set_apikey', {
                                      postProcess: 'capitalizeFirstChar',
                                    }),
                                    error.message ||
                                      t('core:message.error.generic', {
                                        postProcess: 'capitalizeFirstChar',
                                      })
                                  );
                                });
                            }}
                            variant="contained"
                          >
                            {t('core:action.choose', {
                              postProcess: 'capitalizeFirstChar',
                            })}
                          </Button>

                          <Button
                            size="small"
                            onClick={() => {
                              setCustomApiKey(node?.apikey);
                              setUrl(node?.url);
                              setMode('add-node');
                              setCustomNodeToSaveIndex(index);
                            }}
                            variant="contained"
                          >
                            {t('core:action.edit', {
                              postProcess: 'capitalizeFirstChar',
                            })}
                          </Button>

                          <Button
                            size="small"
                            onClick={() => {
                              const nodesToSave = [
                                ...(customNodes || []),
                              ].filter((item) => item?.url !== node?.url);
                              saveCustomNodes(nodesToSave, true);
                            }}
                            variant="contained"
                          >
                            {t('core:action.remove', {
                              postProcess: 'capitalizeFirstChar',
                            })}
                          </Button>
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              )}

              {mode === 'add-node' && (
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    gap: '10px',
                    justifyContent: 'space-between',
                  }}
                >
                  <Input
                    placeholder={t('core:url', {
                      postProcess: 'capitalizeAll',
                    })}
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                    }}
                  />

                  <Input
                    placeholder={t('auth:apikey.key', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    value={customApikey}
                    onChange={(e) => {
                      setCustomApiKey(e.target.value);
                    }}
                  />
                </Box>
              )}
            </Box>
          </DialogContent>

          <DialogActions>
            {mode === 'list' && (
              <Button variant="contained" onClick={addCustomNode}>
                {t('core:action.add', { postProcess: 'capitalizeFirstChar' })}
              </Button>
            )}

            {mode === 'list' && (
              <>
                <Button
                  variant="contained"
                  onClick={() => {
                    setShow(false);
                  }}
                  autoFocus
                >
                  {t('core:action.close', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>
              </>
            )}

            {mode === 'add-node' && (
              <>
                <Button
                  variant="contained"
                  onClick={() => {
                    setMode('list');
                    setCustomNodeToSaveIndex(null);
                  }}
                >
                  {t('auth:action.return_to_list', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>

                <Button
                  variant="contained"
                  disabled={!url}
                  onClick={() => saveCustomNodes(customNodes)}
                  autoFocus
                >
                  {t('core:action.save', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>
              </>
            )}
          </DialogActions>
        </Dialog>
      )}

      {showSelectApiKey && (
        <Dialog
          open={showSelectApiKey}
          aria-labelledby="alert-dialog-title"
          aria-describedby="alert-dialog-description"
        >
          <DialogTitle
            id="alert-dialog-title"
            sx={{
              textAlign: 'center',
              fontWeight: 'bold',
              opacity: 1,
            }}
          >
            {t('auth:apikey.enter', { postProcess: 'capitalizeFirstChar' })}
          </DialogTitle>

          <DialogContent>
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
              }}
            >
              <TextField
                value={enteredApiKey}
                onChange={(e) => setEnteredApiKey(e.target.value)}
              />
              <Button
                disabled={!!enteredApiKey}
                variant="contained"
                component="label"
              >
                {t('auth:apikey.alternative', {
                  postProcess: 'capitalizeFirstChar',
                })}
                <input
                  type="file"
                  accept=".txt"
                  hidden
                  onChange={handleFileChangeApiKey} // File input handler
                />
              </Button>
            </Box>
          </DialogContent>

          <DialogActions>
            <Button
              variant="contained"
              disabled={!enteredApiKey}
              onClick={() => {
                try {
                  setImportedApiKey(enteredApiKey); // Store the file content in the state
                  if (customNodes) {
                    setCustomNodes((prev) => {
                      const copyPrev = [...prev];
                      const findLocalIndex = copyPrev?.findIndex(
                        (item) => item?.url === 'http://127.0.0.1:12391'
                      );
                      if (findLocalIndex === -1) {
                        copyPrev.unshift({
                          url: 'http://127.0.0.1:12391',
                          apikey: enteredApiKey,
                        });
                      } else {
                        copyPrev[findLocalIndex] = {
                          url: 'http://127.0.0.1:12391',
                          apikey: enteredApiKey,
                        };
                      }
                      window
                        .sendMessage('setCustomNodes', copyPrev)
                        .catch((error) => {
                          console.error(
                            'Failed to set custom nodes:',
                            error.message ||
                              t('core:message.error.generic', {
                                postProcess: 'capitalizeFirstChar',
                              })
                          );
                        });
                      return copyPrev;
                    });
                  }
                  setUseLocalNode(false);
                  setShowSelectApiKey(false);
                  setEnteredApiKey('');
                } catch (error) {
                  console.error(error);
                }
              }}
              autoFocus
            >
              {t('core:action.save', { postProcess: 'capitalizeFirstChar' })}
            </Button>

            <Button
              variant="contained"
              onClick={() => {
                setEnteredApiKey('');
                setShowSelectApiKey(false);
              }}
            >
              {t('core:action.close', { postProcess: 'capitalizeFirstChar' })}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      <ButtonBase
        onClick={() => {
          showTutorial('create-account', true);
        }}
        sx={{
          position: 'fixed',
          bottom: '25px',
          right: '25px',
        }}
      >
        <HelpIcon
          sx={{
            color: theme.palette.other.unread,
          }}
        />
      </ButtonBase>
    </>
  );
};
