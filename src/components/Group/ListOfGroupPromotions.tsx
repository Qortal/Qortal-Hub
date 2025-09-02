import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  Popover,
  Select,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { LoadingButton } from '@mui/lab';
import LockIcon from '@mui/icons-material/Lock';
import NoEncryptionGmailerrorredIcon from '@mui/icons-material/NoEncryptionGmailerrorred';
import {
  QORTAL_APP_CONTEXT,
  getArbitraryEndpointReact,
  getBaseApiReact,
} from '../../App';
import { Spacer } from '../../common/Spacer';
import { CustomLoader } from '../../common/CustomLoader';
import { RequestQueueWithPromise } from '../../utils/queue/queue';
import {
  myGroupsWhereIAmAdminAtom,
  promotionTimeIntervalAtom,
  promotionsAtom,
  txListAtom,
} from '../../atoms/global';
import ShortUniqueId from 'short-unique-id';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { getGroupNames } from './UserListOfInvites';
import { useVirtualizer } from '@tanstack/react-virtual';
import ErrorBoundary from '../../common/ErrorBoundary';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { getFee } from '../../background/background.ts';
import { useAtom, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Label } from '../../styles/App-styles.ts';
import {
  TIME_WEEK_1_IN_MILLISECONDS,
  TIME_MINUTES_30_IN_MILLISECONDS,
} from '../../constants/constants.ts';

const uid = new ShortUniqueId({ length: 8 });

export const requestQueuePromos = new RequestQueueWithPromise(3);

export function utf8ToBase64(inputString: string): string {
  // Encode the string as UTF-8
  const utf8String = encodeURIComponent(inputString).replace(
    /%([0-9A-F]{2})/g,
    (match, p1) => String.fromCharCode(Number('0x' + p1))
  );

  // Convert the UTF-8 encoded string to base64
  const base64String = btoa(utf8String);
  return base64String;
}

export function getGroupId(str) {
  const match = str.match(/group-(\d+)-/);
  return match ? match[1] : null;
}

export const ListOfGroupPromotions = () => {
  const [popoverAnchor, setPopoverAnchor] = useState(null);
  const [openPopoverIndex, setOpenPopoverIndex] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isShowModal, setIsShowModal] = useState(false);
  const [text, setText] = useState('');
  const [myGroupsWhereIAmAdmin, setMyGroupsWhereIAmAdmin] = useAtom(
    myGroupsWhereIAmAdminAtom
  );
  const [promotions, setPromotions] = useAtom(promotionsAtom);
  const [promotionTimeInterval, setPromotionTimeInterval] = useAtom(
    promotionTimeIntervalAtom
  );
  const [isExpanded, setIsExpanded] = useState(false);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const [fee, setFee] = useState(null);
  const [isLoadingJoinGroup, setIsLoadingJoinGroup] = useState(false);
  const [isLoadingPublish, setIsLoadingPublish] = useState(false);
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const setTxList = useSetAtom(txListAtom);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const listRef = useRef(null);
  const rowVirtualizer = useVirtualizer({
    count: promotions.length,
    getItemKey: useCallback(
      (index) => promotions[index]?.identifier,
      [promotions]
    ),
    getScrollElement: () => listRef.current,
    estimateSize: () => 80, // Provide an estimated height of items, adjust this as needed
    overscan: 10, // Number of items to render outside the visible area to improve smoothness
  });

  useEffect(() => {
    try {
      (async () => {
        const feeRes = await getFee('ARBITRARY');
        setFee(feeRes?.fee);
      })();
    } catch (error) {
      console.log(error);
    }
  }, []);

  const getPromotions = useCallback(async () => {
    try {
      setPromotionTimeInterval(Date.now());
      const identifier = `group-promotions-ui24-`;
      const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=DOCUMENT&identifier=${identifier}&limit=100&includemetadata=false&reverse=true&prefix=true`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const responseData = await response.json();
      const data: any[] = [];
      const uniqueGroupIds = new Set();
      const oneWeekAgo = Date.now() - TIME_WEEK_1_IN_MILLISECONDS;

      const getPromos = responseData?.map(async (promo: any) => {
        if (promo?.size < 200 && promo.created > oneWeekAgo) {
          await requestQueuePromos.enqueue(async () => {
            const url = `${getBaseApiReact()}/arbitrary/${promo.service}/${
              promo.name
            }/${promo.identifier}`;
            const response = await fetch(url, {
              method: 'GET',
            });

            try {
              const responseData = await response.text();
              if (responseData) {
                const groupId = getGroupId(promo.identifier);

                // Check if this groupId has already been processed
                if (!uniqueGroupIds.has(groupId)) {
                  // Add the groupId to the set
                  uniqueGroupIds.add(groupId);

                  // Push the item to data
                  data.push({
                    data: responseData,
                    groupId,
                    ...promo,
                  });
                }
              }
            } catch (error) {
              console.error('Error fetching promo:', error);
            }
          });
        }

        return true;
      });

      await Promise.all(getPromos);
      const groupWithInfo = await getGroupNames(
        data.sort((a, b) => b.created - a.created)
      );
      setPromotions(groupWithInfo);
    } catch (error) {
      console.error(error);
    }
  }, []);

  useEffect(() => {
    const now = Date.now();

    const timeSinceLastFetch = now - promotionTimeInterval;
    const initialDelay =
      timeSinceLastFetch >= TIME_MINUTES_30_IN_MILLISECONDS
        ? 0
        : TIME_MINUTES_30_IN_MILLISECONDS - timeSinceLastFetch;
    const initialTimeout = setTimeout(() => {
      getPromotions();

      // Start a 30-minute interval
      const interval = setInterval(() => {
        getPromotions();
      }, TIME_MINUTES_30_IN_MILLISECONDS);

      return () => clearInterval(interval);
    }, initialDelay);

    return () => clearTimeout(initialTimeout);
  }, [getPromotions, promotionTimeInterval]);

  const handlePopoverOpen = (event, index) => {
    setPopoverAnchor(event.currentTarget);
    setOpenPopoverIndex(index);
  };

  const handlePopoverClose = () => {
    setPopoverAnchor(null);
    setOpenPopoverIndex(null);
  };

  const publishPromo = async () => {
    try {
      setIsLoadingPublish(true);

      const data = utf8ToBase64(text);
      const identifier = `group-promotions-ui24-group-${selectedGroup}-${uid.rnd()}`;

      await new Promise((res, rej) => {
        window
          .sendMessage('publishOnQDN', {
            data: data,
            identifier: identifier,
            service: 'DOCUMENT',
            uploadType: 'base64',
          })
          .then((response) => {
            if (!response?.error) {
              res(response);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
          });
      });
      setInfoSnack({
        type: 'success',
        message: t('group:message.success.group_promotion', {
          postProcess: 'capitalizeFirstChar',
        }),
      });
      setOpenSnack(true);
      setText('');
      setSelectedGroup(null);
      setIsShowModal(false);
    } catch (error) {
      setInfoSnack({
        type: 'error',
        message:
          error?.message ||
          t('group:message.error.group_promotion', {
            postProcess: 'capitalizeFirstChar',
          }),
      });
      setOpenSnack(true);
    } finally {
      setIsLoadingPublish(false);
    }
  };

  const handleJoinGroup = async (group, isOpen) => {
    try {
      const groupId = group.groupId;
      const fee = await getFee('JOIN_GROUP');

      await show({
        message: t('core:message.question.perform_transaction', {
          action: 'JOIN_GROUP',
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });

      setIsLoadingJoinGroup(true);
      await new Promise((res, rej) => {
        window
          .sendMessage('joinGroup', {
            groupId,
          })
          .then((response) => {
            if (!response?.error) {
              setInfoSnack({
                type: 'success',
                message: t('group:message.success.group_join', {
                  postProcess: 'capitalizeFirstChar',
                }),
              });

              if (isOpen) {
                setTxList((prev) => [
                  {
                    ...response,
                    type: 'joined-group',
                    label: t('group:message.success.group_join_label', {
                      group_name: group?.groupName,
                      postProcess: 'capitalizeFirstChar',
                    }),
                    labelDone: t('group:message.success.group_join_label', {
                      group_name: group?.groupName,
                      postProcess: 'capitalizeFirstChar',
                    }),
                    done: false,
                    groupId,
                  },
                  ...prev,
                ]);
              } else {
                setTxList((prev) => [
                  {
                    ...response,
                    type: 'joined-group-request',
                    label: t('group:message.success.group_join_request', {
                      group_name: group?.groupName,
                      postProcess: 'capitalizeFirstChar',
                    }),
                    labelDone: t('group:message.success.group_join_outcome', {
                      group_name: group?.groupName,
                      postProcess: 'capitalizeFirstChar',
                    }),
                    done: false,
                    groupId,
                  },
                  ...prev,
                ]);
              }
              setOpenSnack(true);
              handlePopoverClose();
              res(response);
              return;
            } else {
              setInfoSnack({
                type: 'error',
                message: response?.error,
              });
              setOpenSnack(true);
              rej(response.error);
            }
          })
          .catch((error) => {
            setInfoSnack({
              type: 'error',
              message:
                error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                }),
            });
            setOpenSnack(true);
            rej(error);
          });
      });
      setIsLoadingJoinGroup(false);
    } catch (error) {
      console.log(error);
    } finally {
      setIsLoadingJoinGroup(false);
    }
  };

  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        marginTop: '20px',
        width: '100%',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          gap: '20px',
          justifyContent: 'space-between',
          width: '100%',
        }}
      >
        <ButtonBase
          sx={{
            alignSelf: isExpanded && 'flex-start',
            display: 'flex',
            flexDirection: 'row',
            gap: '10px',
            justifyContent: 'flex-start',
            padding: `0px ${isExpanded ? '24px' : '20px'}`,
          }}
          onClick={() => setIsExpanded((prev) => !prev)}
        >
          <Typography
            sx={{
              fontSize: '1rem',
            }}
          >
            {t('group:group.promotions', {
              postProcess: 'capitalizeFirstChar',
            })}{' '}
            {promotions.length > 0 && ` (${promotions.length})`}
          </Typography>

          {isExpanded ? (
            <ExpandLessIcon
              sx={{
                marginLeft: 'auto',
              }}
            />
          ) : (
            <ExpandMoreIcon
              sx={{
                marginLeft: 'auto',
              }}
            />
          )}
        </ButtonBase>

        <Box
          style={{
            width: '330px',
          }}
        />
      </Box>

      <Collapse in={isExpanded} timeout="auto" unmountOnExit>
        <>
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              maxWidth: '90%',
              padding: '0px 20px',
              width: '750px',
            }}
          >
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                justifyContent: 'space-between',
                width: '100%',
              }}
            >
              <Typography
                sx={{
                  fontSize: '13px',
                  fontWeight: 600,
                }}
              ></Typography>

              <Button
                variant="contained"
                onClick={() => setIsShowModal(true)}
                sx={{
                  fontSize: '12px',
                }}
              >
                {t('group:action.add_promotion', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Button>
            </Box>

            <Spacer height="10px" />
          </Box>

          <Box
            sx={{
              bgcolor: 'background.paper',
              borderRadius: '19px',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '700px',
              maxWidth: '90%',
              padding: '20px 0px',
              width: '750px',
            }}
          >
            {loading && promotions.length === 0 && (
              <Box
                sx={{
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'center',
                }}
              >
                <CustomLoader />
              </Box>
            )}

            {!loading && promotions.length === 0 && (
              <Box
                sx={{
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  height: '100%',
                }}
              >
                <Typography
                  sx={{
                    fontSize: '11px',
                    fontWeight: 400,
                    color: 'rgba(255, 255, 255, 0.2)',
                  }}
                >
                  {t('group:message.generic.no_display', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
              </Box>
            )}

            <div
              style={{
                height: '600px',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
              }}
            >
              <div
                ref={listRef}
                className="scrollable-container"
                style={{
                  flexGrow: 1,
                  overflow: 'auto',
                  position: 'relative',
                  display: 'flex',
                  height: '0px',
                }}
              >
                <div
                  style={{
                    height: rowVirtualizer.getTotalSize(),
                    width: '100%',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                    }}
                  >
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const index = virtualRow.index;
                      const promotion = promotions[index];
                      return (
                        <div
                          data-index={virtualRow.index} //needed for dynamic row height measurement
                          ref={rowVirtualizer.measureElement} //measure dynamic row height
                          key={promotion?.identifier}
                          style={{
                            alignItems: 'center',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '5px',
                            left: '50%', // Move to the center horizontally
                            overscrollBehavior: 'none',
                            padding: '10px 0',
                            position: 'absolute',
                            top: 0,
                            transform: `translateY(${virtualRow.start}px) translateX(-50%)`, // Adjust for centering
                            width: '100%', // Control width (90% of the parent)
                          }}
                        >
                          <ErrorBoundary
                            fallback={
                              <Typography>
                                {t('group:message.generic.invalid_data', {
                                  postProcess: 'capitalizeFirstChar',
                                })}
                              </Typography>
                            }
                          >
                            <Box
                              sx={{
                                display: 'flex',
                                flexDirection: 'column',
                                width: '100%',
                                padding: '0px 20px',
                              }}
                            >
                              <Popover
                                open={openPopoverIndex === promotion?.groupId}
                                anchorEl={popoverAnchor}
                                onClose={(reason) => {
                                  if (reason === 'backdropClick') {
                                    // Prevent closing on backdrop click
                                    return;
                                  }
                                  handlePopoverClose(); // Close only on other events like Esc key press
                                }}
                                anchorOrigin={{
                                  vertical: 'top',
                                  horizontal: 'center',
                                }}
                                transformOrigin={{
                                  vertical: 'bottom',
                                  horizontal: 'center',
                                }}
                                style={{ marginTop: '8px' }}
                              >
                                <Box
                                  sx={{
                                    width: '325px',
                                    height: 'auto',
                                    maxHeight: '400px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    gap: '10px',
                                    padding: '10px',
                                  }}
                                >
                                  <Typography
                                    sx={{
                                      fontSize: '13px',
                                      fontWeight: 600,
                                    }}
                                  >
                                    {t('group:group.name', {
                                      postProcess: 'capitalizeFirstChar',
                                    })}
                                    : {` ${promotion?.groupName}`}
                                  </Typography>

                                  <Typography
                                    sx={{
                                      fontSize: '13px',
                                      fontWeight: 600,
                                    }}
                                  >
                                    {t('group:group.member_number', {
                                      postProcess: 'capitalizeFirstChar',
                                    })}
                                    : {` ${promotion?.memberCount}`}
                                  </Typography>

                                  {promotion?.description && (
                                    <Typography
                                      sx={{
                                        fontSize: '13px',
                                        fontWeight: 600,
                                      }}
                                    >
                                      {promotion?.description}
                                    </Typography>
                                  )}

                                  {promotion?.isOpen === false && (
                                    <Typography
                                      sx={{
                                        fontSize: '13px',
                                        fontWeight: 600,
                                      }}
                                    >
                                      {t('group:message.generic.closed_group', {
                                        postProcess: 'capitalizeFirstChar',
                                      })}
                                    </Typography>
                                  )}

                                  <Spacer height="5px" />

                                  <Box
                                    sx={{
                                      display: 'flex',
                                      gap: '20px',
                                      alignItems: 'center',
                                      width: '100%',
                                      justifyContent: 'center',
                                    }}
                                  >
                                    <LoadingButton
                                      loading={isLoadingJoinGroup}
                                      loadingPosition="start"
                                      variant="contained"
                                      onClick={handlePopoverClose}
                                    >
                                      {t('core:action.close', {
                                        postProcess: 'capitalizeFirstChar',
                                      })}
                                    </LoadingButton>

                                    <LoadingButton
                                      loading={isLoadingJoinGroup}
                                      loadingPosition="start"
                                      variant="contained"
                                      onClick={() =>
                                        handleJoinGroup(
                                          promotion,
                                          promotion?.isOpen
                                        )
                                      }
                                    >
                                      {t('core:action.join', {
                                        postProcess: 'capitalizeFirstChar',
                                      })}
                                    </LoadingButton>
                                  </Box>
                                </Box>
                              </Popover>

                              <Box
                                sx={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  width: '100%',
                                }}
                              >
                                <Box
                                  sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '15px',
                                  }}
                                >
                                  <Avatar
                                    sx={{
                                      backgroundColor: '#27282c',
                                      color: theme.palette.text.primary,
                                    }}
                                    alt={promotion?.name}
                                    src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${
                                      promotion?.name
                                    }/qortal_avatar?async=true`}
                                  >
                                    {promotion?.name?.charAt(0)}
                                  </Avatar>

                                  <Typography
                                    sx={{
                                      fontWight: 600,
                                      fontFamily: 'Inter',
                                    }}
                                  >
                                    {promotion?.name}
                                  </Typography>
                                </Box>

                                <Typography
                                  sx={{
                                    fontWight: 600,
                                    fontFamily: 'Inter',
                                  }}
                                >
                                  {promotion?.groupName}
                                </Typography>
                              </Box>

                              <Spacer height="20px" />

                              <Box
                                sx={{
                                  display: 'flex',
                                  gap: '20px',
                                  alignItems: 'center',
                                }}
                              >
                                {promotion?.isOpen === false && (
                                  <LockIcon
                                    sx={{
                                      color: theme.palette.other.positive,
                                    }}
                                  />
                                )}

                                {promotion?.isOpen === true && (
                                  <NoEncryptionGmailerrorredIcon
                                    sx={{
                                      color: theme.palette.other.danger,
                                    }}
                                  />
                                )}

                                <Typography
                                  sx={{
                                    fontSize: '15px',
                                    fontWeight: 600,
                                  }}
                                >
                                  {promotion?.isOpen
                                    ? t('group:group.public', {
                                        postProcess: 'capitalizeFirstChar',
                                      })
                                    : t('group:group.private', {
                                        postProcess: 'capitalizeFirstChar',
                                      })}
                                </Typography>
                              </Box>

                              <Spacer height="20px" />

                              <Typography
                                sx={{
                                  fontWight: 600,
                                  fontFamily: 'Inter',
                                }}
                              >
                                {promotion?.data}
                              </Typography>

                              <Spacer height="20px" />

                              <Box
                                sx={{
                                  display: 'flex',
                                  justifyContent: 'center',
                                  width: '100%',
                                }}
                              >
                                <Button
                                  // variant="contained"
                                  onClick={(event) =>
                                    handlePopoverOpen(event, promotion?.groupId)
                                  }
                                  sx={{
                                    fontSize: '12px',
                                    color: theme.palette.text.primary,
                                  }}
                                >
                                  {t('group:action.join_group', {
                                    postProcess: 'capitalizeFirstChar',
                                  })}
                                  : {` ${promotion?.groupName}`}
                                </Button>
                              </Box>
                            </Box>

                            <Spacer height="50px" />
                          </ErrorBoundary>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </Box>
        </>
      </Collapse>

      <Spacer height="20px" />

      <Dialog
        open={isShowModal}
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
      >
        <DialogTitle
          id="alert-dialog-title"
          sx={{
            textAlign: 'center',
            color: theme.palette.text.primary,
            fontWeight: 'bold',
            opacity: 1,
          }}
        >
          {t('group:action.promote_group', {
            postProcess: 'capitalizeFirstChar',
          })}
        </DialogTitle>

        <DialogContent>
          <DialogContentText id="alert-dialog-description">
            {t('group:message.generic.latest_promotion', {
              postProcess: 'capitalizeFirstChar',
            })}
          </DialogContentText>

          <DialogContentText id="alert-dialog-description2">
            {t('group:message.generic.max_chars', {
              postProcess: 'capitalizeFirstChar',
            })}
            : {fee && fee} {' QORT'}
          </DialogContentText>

          <Spacer height="20px" />

          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: '5px',
            }}
          >
            <Label>
              {t('group:action.select_group', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Label>

            <Label>
              {t('group:message.generic.admin_only', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Label>

            <Select
              labelId="demo-simple-select-label"
              id="demo-simple-select"
              value={selectedGroup}
              label={t('group:group.groups_admin', {
                postProcess: 'capitalizeFirstChar',
              })}
              onChange={(e) => setSelectedGroup(e.target.value)}
              variant="outlined"
            >
              {myGroupsWhereIAmAdmin?.map((group) => {
                return (
                  <MenuItem key={group?.groupId} value={group?.groupId}>
                    {group?.groupName}
                  </MenuItem>
                );
              })}
            </Select>
          </Box>

          <Spacer height="20px" />

          <TextField
            label={t('core:message.promotion_text', {
              postProcess: 'capitalizeFirstChar',
            })}
            variant="filled"
            fullWidth
            value={text}
            onChange={(e) => setText(e.target.value)}
            inputProps={{
              maxLength: 200,
            }}
            multiline={true}
            sx={{
              '& .MuiFormLabel-root': {
                color: theme.palette.text.primary,
              },
              '& .MuiFormLabel-root.Mui-focused': {
                color: theme.palette.text.primary,
              },
            }}
          />
        </DialogContent>

        <DialogActions>
          <Button
            disabled={isLoadingPublish}
            variant="contained"
            onClick={() => setIsShowModal(false)}
          >
            {t('core:action.close', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
          <Button
            disabled={!text.trim() || !selectedGroup || isLoadingPublish}
            variant="contained"
            onClick={publishPromo}
            autoFocus
          >
            {t('core:action.publish', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
        </DialogActions>
      </Dialog>

      <CustomizedSnackbars
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />
    </Box>
  );
};
