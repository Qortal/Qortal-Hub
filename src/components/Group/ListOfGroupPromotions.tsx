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
  memberGroupsAtom,
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
  TIME_WEEKS_1_IN_MILLISECONDS,
  TIME_MINUTES_30_IN_MILLISECONDS,
} from '../../constants/constants.ts';

const uid = new ShortUniqueId({ length: 8 });

export const requestQueuePromos = new RequestQueueWithPromise(8);

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

export const ListOfGroupPromotions = ({
  compact = false,
  onCountChange,
}: {
  compact?: boolean;
  onCountChange?: (count: number) => void;
} = {}) => {
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
  const [memberGroups] = useAtom(memberGroupsAtom);
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
    estimateSize: () => 130,
    overscan: 8,
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
      setLoading(true);
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
      const oneWeekAgo = Date.now() - TIME_WEEKS_1_IN_MILLISECONDS;
      const abortController = new AbortController();

      const getPromos = responseData?.map(async (promo: any) => {
        if (promo?.size < 200 && promo.created > oneWeekAgo) {
          await requestQueuePromos.enqueue(async () => {
            const url = `${getBaseApiReact()}/arbitrary/${promo.service}/${
              promo.name
            }/${promo.identifier}`;
            const response = await fetch(url, {
              method: 'GET',
              signal: abortController.signal,
            });

            try {
              const responseData = await response.text();
              if (responseData) {
                const groupId = getGroupId(promo.identifier);

                // Check if this groupId has already been processed
                if (!uniqueGroupIds.has(groupId)) {
                  uniqueGroupIds.add(groupId);
                  data.push({
                    data: responseData,
                    groupId,
                    ...promo,
                  });
                }
              }
            } catch (error) {
              if ((error as Error)?.name !== 'AbortError') {
                console.error('Error fetching promo:', error);
              }
            }
          });
        }

        return true;
      });

      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          abortController.abort();
          resolve();
        }, 5000);
      });

      await Promise.race([Promise.all(getPromos), timeoutPromise]);
      const groupWithInfo = await getGroupNames(
        data.sort((a, b) => b.created - a.created)
      );
      // One promotion per unique name (promoter): keep the latest by created
      const sorted = [...groupWithInfo].sort(
        (a, b) => (b.created || 0) - (a.created || 0)
      );
      const latestByName = new Map();
      for (const p of sorted) {
        const n = p?.name;
        if (n != null && !latestByName.has(n)) latestByName.set(n, p);
      }
      setPromotions(Array.from(latestByName.values()));
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
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

  // Report count to parent when in compact mode
  useEffect(() => {
    onCountChange?.(promotions.length);
  }, [promotions.length, onCountChange]);

  const promotionsList = (
    <Box
      sx={{
        bgcolor: 'background.paper',
        borderRadius: compact ? 0 : '16px',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: compact ? undefined : '700px',
        maxWidth: compact ? '100%' : '90%',
        padding: compact ? '16px 0' : '24px 0',
        width: compact ? '100%' : '750px',
        border: compact
          ? 'none'
          : `1px solid ${theme.palette.border?.subtle ?? 'rgba(255,255,255,0.08)'}`,
      }}
    >
      {loading && promotions.length === 0 && (
        <Box
          sx={{
            width: '100%',
            display: 'flex',
            justifyContent: 'center',
            py: 4,
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
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            py: 6,
            px: 2,
          }}
        >
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ textAlign: 'center' }}
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
                const isMember =
                  memberGroups?.some(
                    (g: { groupId?: number }) =>
                      +g?.groupId === +promotion?.groupId
                  ) ?? false;
                return (
                  <div
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    key={promotion?.identifier}
                    style={{
                      left: '50%',
                      overscrollBehavior: 'none',
                      padding: '6px 20px',
                      position: 'absolute',
                      top: 0,
                      transform: `translateY(${virtualRow.start}px) translateX(-50%)`,
                      width: '100%',
                    }}
                  >
                    <ErrorBoundary
                      fallback={
                        <Typography variant="body2" color="text.secondary">
                          {t('group:message.generic.invalid_data', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </Typography>
                      }
                    >
                      <Box
                        sx={{
                          width: '100%',
                          borderRadius: '12px',
                          border: `1px solid ${theme.palette.border?.subtle ?? 'rgba(255,255,255,0.08)'}`,
                          bgcolor:
                            theme.palette.background?.surface ??
                            'rgba(255,255,255,0.04)',
                          p: 1.75,
                          transition: 'border-color 0.2s, box-shadow 0.2s',
                          '&:hover': {
                            borderColor:
                              theme.palette.border?.main ??
                              'rgba(255,255,255,0.12)',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                          },
                        }}
                      >
                        <Popover
                          open={openPopoverIndex === promotion?.groupId}
                          anchorEl={popoverAnchor}
                          onClose={(reason) => {
                            if (reason === 'backdropClick') return;
                            handlePopoverClose();
                          }}
                          anchorOrigin={{
                            vertical: 'top',
                            horizontal: 'center',
                          }}
                          transformOrigin={{
                            vertical: 'bottom',
                            horizontal: 'center',
                          }}
                          slotProps={{
                            paper: {
                              sx: {
                                mt: 1,
                                borderRadius: '16px',
                                overflow: 'hidden',
                                boxShadow: '0 12px 40px rgba(0,0,0,0.28)',
                                border: `1px solid ${theme.palette.border?.subtle ?? 'rgba(255,255,255,0.08)'}`,
                              },
                            },
                          }}
                        >
                          <Box sx={{ width: 360, overflow: 'hidden' }}>
                            <Box
                              sx={{
                                px: 2.5,
                                pt: 2.5,
                                pb: 1.5,
                                bgcolor:
                                  theme.palette.background?.default ??
                                  'rgba(0,0,0,0.2)',
                                borderBottom: `1px solid ${theme.palette.border?.subtle ?? 'rgba(255,255,255,0.08)'}`,
                              }}
                            >
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ display: 'block', mb: 0.5 }}
                              >
                                {t('group:group.name', {
                                  postProcess: 'capitalizeFirstChar',
                                })}
                              </Typography>
                              <Typography
                                variant="h6"
                                fontWeight={700}
                                sx={{ lineHeight: 1.3 }}
                              >
                                {promotion?.groupName}
                              </Typography>
                              <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ mt: 0.75 }}
                              >
                                {t('group:group.member_number', {
                                  postProcess: 'capitalizeFirstChar',
                                })}
                                : {promotion?.memberCount ?? 0}
                              </Typography>
                              {isMember && (
                                <Typography
                                  variant="caption"
                                  sx={{
                                    display: 'block',
                                    mt: 1,
                                    color: theme.palette.other.positive,
                                    fontWeight: 600,
                                  }}
                                >
                                  {t('group:message.generic.already_in_group', {
                                    postProcess: 'capitalizeFirstChar',
                                  })}
                                </Typography>
                              )}
                            </Box>
                            <Box sx={{ px: 2.5, py: 2 }}>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{
                                  display: 'block',
                                  mb: 0.75,
                                  fontWeight: 600,
                                }}
                              >
                                {t('group:group.description', {
                                  postProcess: 'capitalizeFirstChar',
                                  defaultValue: 'Description',
                                })}
                              </Typography>
                              <Typography
                                variant="body2"
                                sx={{
                                  color: theme.palette.text.secondary,
                                  lineHeight: 1.5,
                                  minHeight: '2.5em',
                                  display: '-webkit-box',
                                  WebkitLineClamp: 4,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                }}
                              >
                                {promotion?.description ||
                                  promotion?.data ||
                                  t('group:message.generic.no_description', {
                                    postProcess: 'capitalizeFirstChar',
                                    defaultValue: 'No description',
                                  })}
                              </Typography>
                              {promotion?.isOpen === false && (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{ display: 'block', mt: 1 }}
                                >
                                  {t('group:message.generic.closed_group', {
                                    postProcess: 'capitalizeFirstChar',
                                  })}
                                </Typography>
                              )}
                            </Box>
                            <Box
                              sx={{
                                px: 2.5,
                                pb: 2.5,
                                pt: 0,
                                display: 'flex',
                                gap: 1.5,
                                justifyContent: 'flex-end',
                              }}
                            >
                              <Button
                                variant="outlined"
                                onClick={handlePopoverClose}
                                sx={{ textTransform: 'none', fontWeight: 600 }}
                              >
                                {t('core:action.close', {
                                  postProcess: 'capitalizeFirstChar',
                                })}
                              </Button>
                              {!isMember && (
                                <LoadingButton
                                  loading={isLoadingJoinGroup}
                                  loadingPosition="start"
                                  variant="contained"
                                  onClick={() =>
                                    handleJoinGroup(promotion, promotion?.isOpen)
                                  }
                                  sx={{ textTransform: 'none', fontWeight: 600 }}
                                >
                                  {t('core:action.join', {
                                    postProcess: 'capitalizeFirstChar',
                                  })}
                                </LoadingButton>
                              )}
                            </Box>
                          </Box>
                        </Popover>

                        {/* Card header: avatar + owner + group + badge + member count + Join */}
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            justifyContent: 'space-between',
                            gap: 1,
                            mb: 1,
                          }}
                        >
                          <Box
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 1.25,
                              minWidth: 0,
                              flex: 1,
                            }}
                          >
                            <Avatar
                              sx={{
                                width: 40,
                                height: 40,
                                backgroundColor: theme.palette.background.paper,
                                color: theme.palette.text.primary,
                                border: `1px solid ${theme.palette.border?.subtle ?? 'rgba(255,255,255,0.08)'}`,
                                flexShrink: 0,
                              }}
                              alt={promotion?.name}
                              src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${promotion?.name}/qortal_avatar?async=true`}
                            >
                              {promotion?.name?.charAt(0)}
                            </Avatar>
                            <Box sx={{ minWidth: 0, flex: 1 }}>
                              <Typography
                                sx={{
                                  fontWeight: 600,
                                  fontSize: '0.9rem',
                                  lineHeight: 1.3,
                                }}
                              >
                                {promotion?.name}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ display: 'block' }}
                              >
                                {promotion?.groupName}
                              </Typography>
                              {promotion?.memberCount != null && (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{ display: 'block', mt: 0.25 }}
                                >
                                  {t('group:group.member_number', {
                                    postProcess: 'capitalizeFirstChar',
                                  })}
                                  : {promotion.memberCount}
                                </Typography>
                              )}
                            </Box>
                          </Box>
                          <Box
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.75,
                              flexShrink: 0,
                            }}
                          >
<Box
                            sx={{
                              px: 1,
                              py: 0.35,
                              borderRadius: '6px',
                              bgcolor: promotion?.isOpen
                                ? `${theme.palette.other.danger}18`
                                : `${theme.palette.other.positive}18`,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.4,
                            }}
                          >
                            {promotion?.isOpen === true ? (
                              <NoEncryptionGmailerrorredIcon
                                sx={{
                                  fontSize: 14,
                                  color: theme.palette.other.danger,
                                }}
                              />
                            ) : (
                              <LockIcon
                                sx={{
                                  fontSize: 14,
                                  color: theme.palette.other.positive,
                                }}
                              />
                            )}
                              <Typography
                                variant="caption"
                                fontWeight={600}
                                sx={{ fontSize: '0.7rem', color: 'inherit' }}
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
                            {isMember ? (
                              <Typography
                                variant="caption"
                                fontWeight={600}
                                sx={{
                                  fontSize: '0.7rem',
                                  color: theme.palette.other.positive,
                                  px: 1,
                                  py: 0.5,
                                  borderRadius: '6px',
                                  bgcolor: `${theme.palette.other.positive}18`,
                                }}
                              >
                                {t('group:message.generic.already_in_group', {
                                  postProcess: 'capitalizeFirstChar',
                                })}
                              </Typography>
                            ) : (
                              <Button
                                variant="outlined"
                                size="small"
                                onClick={(e) =>
                                  handlePopoverOpen(e, promotion?.groupId)
                                }
                                sx={{
                                  textTransform: 'none',
                                  fontWeight: 600,
                                  fontSize: '0.8rem',
                                  py: 0.5,
                                  px: 1.25,
                                  borderRadius: '8px',
                                  minWidth: 'auto',
                                }}
                              >
                                {t('core:action.join', {
                                  postProcess: 'capitalizeFirstChar',
                                })}
                              </Button>
                            )}
                          </Box>
                        </Box>

                        {/* Description / URL */}
                        {promotion?.data && (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{
                              fontSize: '0.8125rem',
                              lineHeight: 1.4,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                            }}
                          >
                            {promotion?.data}
                          </Typography>
                        )}
                      </Box>
                    </ErrorBoundary>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </Box>
  );

  return (
    <Box
      sx={{
        alignItems: compact ? 'stretch' : 'center',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        marginTop: compact ? '0' : '20px',
        width: '100%',
      }}
    >
      {!compact && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
          }}
        >
          <ButtonBase
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              py: 0.75,
              px: 1,
              borderRadius: '8px',
              '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' },
            }}
            onClick={() => setIsExpanded((prev) => !prev)}
          >
            <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600 }}>
              {t('group:group.promotions', {
                postProcess: 'capitalizeFirstChar',
              })}
              {promotions.length > 0 && (
                <Typography
                  component="span"
                  color="text.secondary"
                  sx={{ ml: 0.5, fontWeight: 500 }}
                >
                  ({promotions.length})
                </Typography>
              )}
            </Typography>
            {isExpanded ? (
              <ExpandLessIcon fontSize="small" />
            ) : (
              <ExpandMoreIcon fontSize="small" />
            )}
          </ButtonBase>
        </Box>
      )}

      {compact && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '0 20px',
            mb: 1.5,
          }}
        >
          <Button
            variant="contained"
            onClick={() => setIsShowModal(true)}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              borderRadius: '10px',
              px: 2,
              py: 1,
              boxShadow: 'none',
              '&:hover': { boxShadow: '0 2px 12px rgba(0,0,0,0.2)' },
            }}
          >
            {t('group:action.add_promotion', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
        </Box>
      )}

      {compact ? (
        promotionsList
      ) : (
        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
          <>
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                maxWidth: '90%',
                padding: '0 20px',
                width: '750px',
              }}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  width: '100%',
                  mb: 1.5,
                }}
              >
                <Button
                  variant="contained"
                  onClick={() => setIsShowModal(true)}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 600,
                    borderRadius: '10px',
                    px: 2,
                    py: 1,
                    boxShadow: 'none',
                    '&:hover': { boxShadow: '0 2px 12px rgba(0,0,0,0.2)' },
                  }}
                >
                  {t('group:action.add_promotion', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>
              </Box>
            </Box>
            {promotionsList}
          </>
        </Collapse>
      )}

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
