import {
  alpha,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { getBaseApiReact } from '../../App';

import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import InfoIcon from '@mui/icons-material/Info';
import LabelOutlinedIcon from '@mui/icons-material/LabelOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';

import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { validateAddress } from '../../utils/validateAddress';
import { getNameInfo, requestQueueMemberNames } from './Group';
import { useModal } from '../../hooks/useModal';
import { useBlockedAddresses } from '../../hooks/useBlockUsers';
import {
  blockedAddressesAtom,
  blockedNamesAtom,
  infoSnackGlobalAtom,
  isOpenBlockedModalAtom,
  openSnackGlobalAtom,
} from '../../atoms/global';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  dialogActionsSx,
  dialogContentSx,
  dialogContentTextSx,
  dialogModalBackdropSx,
  dialogTitleSx,
  getDialogPaperSx,
  getDialogPrimaryButtonSx,
  getDialogSecondaryButtonSx,
} from '../App/dialogSurface';

const blockedListRowSx = (theme: ReturnType<typeof useTheme>) => ({
  alignItems: 'flex-start',
  backgroundColor: alpha('#FFFFFF', 0.035),
  border: '1px solid rgba(169,188,216,0.11)',
  borderRadius: '12px',
  display: 'flex',
  gap: 1.5,
  justifyContent: 'space-between',
  px: 1.5,
  py: 1.2,
});

const unblockButtonSx = (theme: ReturnType<typeof useTheme>) => ({
  ...getDialogSecondaryButtonSx(theme),
  flexShrink: 0,
  fontSize: '0.8rem',
  minHeight: 36,
  minWidth: 92,
  mt: '-2px',
  px: 1.4,
});

export const BlockedUsersModal = () => {
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const [isOpenBlockedModal, setIsOpenBlockedModal] = useAtom(
    isOpenBlockedModalAtom
  );
  const [hasChanged, setHasChanged] = useState(false);
  const [value, setValue] = useState('');
  const [addressesWithNames, setAddressesWithNames] = useState<
    Record<string, string>
  >({});
  const { isShow, onCancel, onOk, show, message } = useModal();
  const { removeBlockFromList, addToBlockList, refreshBlockedUsers } =
    useBlockedAddresses(true);
  const blockedAddresses = useAtomValue(blockedAddressesAtom);
  const blockedNames = useAtomValue(blockedNamesAtom);
  const setOpenSnackGlobal = useSetAtom(openSnackGlobalAtom);
  const setInfoSnackCustom = useSetAtom(infoSnackGlobalAtom);

  const addressKeys = Object.keys(blockedAddresses || {});
  const nameKeys = Object.keys(blockedNames || {});

  const handleCloseMain = () => {
    if (hasChanged) {
      executeEvent('updateChatMessagesWithBlocks', true);
    }
    setIsOpenBlockedModal(false);
  };

  const getNames = async () => {
    const addresses = Object.keys(blockedAddresses || {});
    const addressNames: Record<string, string> = {};

    const getMemNames = addresses.map(async (address) => {
      const name = await requestQueueMemberNames.enqueue(() => {
        return getNameInfo(address);
      });
      if (name) {
        addressNames[address] = name;
      }

      return true;
    });

    await Promise.all(getMemNames);

    setAddressesWithNames(addressNames);
  };

  const blockUser = async (e, user?: string) => {
    try {
      const valUser = user || value;
      if (!valUser) return;
      const isAddress = validateAddress(valUser);
      let userName = null;
      let userAddress = null;
      if (isAddress) {
        userAddress = valUser;
        const name = await getNameInfo(valUser);
        if (name) {
          userName = name;
        }
      }
      if (!isAddress) {
        const response = await fetch(`${getBaseApiReact()}/names/${valUser}`);
        const data = await response.json();
        if (!data?.owner)
          throw new Error(
            t('auth:message.error.name_not_existing', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        if (data?.owner) {
          userAddress = data.owner;
          userName = valUser;
        }
      }
      if (!userName) {
        await addToBlockList(userAddress, null);
        setHasChanged(true);
        executeEvent('updateChatMessagesWithBlocks', true);
        setValue('');
        return;
      }
      const responseModal = await show({
        userName,
        userAddress,
      });
      if (responseModal === 'both') {
        await addToBlockList(userAddress, userName);
      } else if (responseModal === 'address') {
        await addToBlockList(userAddress, null);
      } else if (responseModal === 'name') {
        await addToBlockList(null, userName);
      }
      setHasChanged(true);
      setValue('');
      if (user) {
        setIsOpenBlockedModal(false);
      }
      if (responseModal === 'both' || responseModal === 'address') {
        executeEvent('updateChatMessagesWithBlocks', true);
      }
    } catch (error) {
      if (error?.isCanceled) {
        // user pressed Escape or canceled — do nothing
        return;
      }
      setOpenSnackGlobal(true);
      setInfoSnackCustom({
        type: 'error',
        message:
          error?.message ||
          t('auth:message.error.block_user', {
            postProcess: 'capitalizeFirstChar',
          }),
      });
    }
  };

  const blockUserRef = useRef(blockUser);
  blockUserRef.current = blockUser;

  useEffect(() => {
    const handler = (e: Event) => {
      const user = (e as CustomEvent<{ user?: string }>).detail?.user;
      setIsOpenBlockedModal(true);
      void blockUserRef.current(null, user);
    };
    subscribeToEvent('blockUserFromOutside', handler);
    return () => {
      unsubscribeFromEvent('blockUserFromOutside', handler);
    };
  }, [setIsOpenBlockedModal]);

  useEffect(() => {
    if (!isOpenBlockedModal) return;

    setAddressesWithNames({});
    refreshBlockedUsers().catch((error) => {
      console.error('Unable to refresh blocked users.', error);
    });
  }, [isOpenBlockedModal, refreshBlockedUsers]);

  const paperSx = {
    ...getDialogPaperSx(theme, { maxWidth: 544 }),
    maxHeight: 'min(620px, calc(100vh - 48px))',
    width: 'calc(100% - 40px)',
  };

  const textFieldSx = {
    '& .MuiOutlinedInput-root': {
      backgroundColor: alpha('#FFFFFF', 0.04),
      borderRadius: '11px',
      '& fieldset': {
        borderColor: 'rgba(169,188,216,0.16)',
      },
      '&:hover fieldset': {
        borderColor: 'rgba(169,188,216,0.24)',
      },
      '&.Mui-focused fieldset': {
        borderColor: alpha(theme.palette.primary.main, 0.55),
      },
    },
  };

  const sectionHeadingSx = {
    alignItems: 'center',
    color: 'rgba(214,221,233,0.78)',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 0.75,
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.06em',
    lineHeight: 1.35,
    mb: 0.85,
    textTransform: 'uppercase',
  };

  const sectionSubtitleSx = {
    ...dialogContentTextSx,
    fontSize: '0.82rem',
    lineHeight: 1.55,
    mb: 1.15,
    mt: 0,
    opacity: 0.92,
  };

  return (
    <>
      <Dialog
        aria-describedby="blocked-users-description"
        aria-labelledby="blocked-users-title"
        open={isOpenBlockedModal}
        onClose={handleCloseMain}
        slotProps={{
          backdrop: {
            sx: dialogModalBackdropSx,
          },
          paper: {
            sx: paperSx,
          },
        }}
        fullWidth
        maxWidth="sm"
      >
        <Box
          sx={{
            alignItems: 'center',
            borderBottom: '1px solid rgba(169,188,216,0.1)',
            display: 'flex',
            justifyContent: 'space-between',
            pl: 1,
            position: 'relative',
            pr: 1,
            py: 1.5,
          }}
        >
          <Box sx={{ width: 40 }} />
          <Typography
            component="h2"
            id="blocked-users-title"
            sx={{
              flex: 1,
              fontSize: '1.05rem',
              fontWeight: 700,
              letterSpacing: '-0.01em',
              lineHeight: 1.25,
              px: 1,
              textAlign: 'center',
            }}
          >
            {t('auth:blocked_users', { postProcess: 'capitalizeAll' })}
          </Typography>
          <IconButton
            aria-label={t('core:action.close', {
              postProcess: 'capitalizeFirstChar',
            })}
            edge="end"
            onClick={handleCloseMain}
            size="small"
            sx={{
              color: theme.palette.text.secondary,
              mr: -0.5,
              '&:hover': {
                color: theme.palette.text.primary,
              },
            }}
          >
            <CloseRoundedIcon sx={{ fontSize: 22 }} />
          </IconButton>
        </Box>

        <DialogContent sx={{ ...dialogContentSx, pt: 2.5, pb: 1.75 }}>
          <Typography
            id="blocked-users-description"
            sx={{ ...dialogContentTextSx, mb: 1.35 }}
          >
            {t('auth:message.generic.block_list_intro', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>

          <Box sx={{ alignItems: 'stretch', display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1.25 }}>
            <TextField
              fullWidth
              placeholder={t('auth:message.generic.name_address', {
                postProcess: 'capitalizeFirstChar',
              })}
              size="small"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  blockUser(e);
                }
              }}
              sx={textFieldSx}
            />
            <Button
              sx={{
                ...getDialogPrimaryButtonSx(theme),
                flexShrink: 0,
                minHeight: 40,
                px: 2.4,
                width: { xs: '100%', sm: 'auto' },
              }}
              variant="contained"
              onClick={blockUser}
            >
              {t('auth:action.block', { postProcess: 'capitalizeFirstChar' })}
            </Button>
          </Box>

          {(addressKeys.length > 0 || nameKeys.length > 0) && (
            <Divider
              sx={{
                borderColor: 'rgba(169,188,216,0.1)',
                my: 2.25,
              }}
            />
          )}

          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1.25,
              maxHeight: addressKeys.length + nameKeys.length > 6 ? 280 : 'none',
              overflowY: addressKeys.length + nameKeys.length > 6 ? 'auto' : 'visible',
              pr: addressKeys.length + nameKeys.length > 6 ? 0.5 : 0,
            }}
          >
            {addressKeys.length > 0 && (
              <Box>
                <Typography component="div" sx={sectionHeadingSx}>
                  <ShieldOutlinedIcon sx={{ fontSize: 17, opacity: 0.85 }} />
                  {t('auth:message.generic.blocked_addresses', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
                <Typography sx={sectionSubtitleSx}>
                  {t('auth:message.generic.blocked_addresses_hint', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>

                <Button
                  sx={{
                    ...getDialogSecondaryButtonSx(theme),
                    fontSize: '0.82rem',
                    mb: 1,
                    minHeight: 38,
                    py: 0.75,
                  }}
                  variant="contained"
                  onClick={getNames}
                >
                  {t('auth:action.fetch_names', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.85 }}>
                  {addressKeys.map((key) => (
                    <Box key={key} sx={blockedListRowSx(theme)}>
                      <Box sx={{ flex: '1 1 auto', minWidth: 0, pt: '3px' }}>
                        <Typography
                          sx={{
                            fontFamily:
                              addressesWithNames[key]
                                ? 'inherit'
                                : 'ui-monospace, monospace',
                            fontSize: addressesWithNames[key]
                              ? '0.93rem'
                              : '0.78rem',
                            fontWeight: 600,
                            lineHeight: 1.45,
                            wordBreak: 'break-all',
                          }}
                        >
                          {addressesWithNames[key] || key}
                        </Typography>
                        {addressesWithNames[key] && (
                          <Typography
                            sx={{
                              color: 'rgba(214,221,233,0.55)',
                              fontFamily: 'ui-monospace, monospace',
                              fontSize: '0.72rem',
                              lineHeight: 1.4,
                              mt: 0.35,
                              wordBreak: 'break-all',
                            }}
                          >
                            {key}
                          </Typography>
                        )}
                      </Box>
                      <Button
                        sx={unblockButtonSx(theme)}
                        variant="contained"
                        onClick={async () => {
                          try {
                            await removeBlockFromList(key, undefined);
                            setHasChanged(true);
                            setValue('');
                          } catch (error) {
                            console.error(error);
                          }
                        }}
                      >
                        {t('auth:action.unblock', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Button>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}

            {addressKeys.length > 0 && nameKeys.length > 0 && (
              <Divider sx={{ borderColor: 'rgba(169,188,216,0.08)' }} />
            )}

            {nameKeys.length > 0 && (
              <Box>
                <Typography component="div" sx={sectionHeadingSx}>
                  <LabelOutlinedIcon sx={{ fontSize: 17, opacity: 0.85 }} />
                  {t('auth:message.generic.blocked_names', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
                <Typography sx={sectionSubtitleSx}>
                  {t('auth:message.generic.blocked_names_hint', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.85 }}>
                  {nameKeys.map((key) => (
                    <Box key={key} sx={blockedListRowSx(theme)}>
                      <Typography
                        sx={{
                          flex: '1 1 auto',
                          fontSize: '0.93rem',
                          fontWeight: 600,
                          lineHeight: 1.45,
                          minWidth: 0,
                          pt: '3px',
                          wordBreak: 'break-word',
                        }}
                      >
                        {key}
                      </Typography>
                      <Button
                        sx={unblockButtonSx(theme)}
                        variant="contained"
                        onClick={async () => {
                          try {
                            await removeBlockFromList(undefined, key);
                            setHasChanged(true);
                          } catch (error) {
                            console.error(error);
                          }
                        }}
                      >
                        {t('auth:action.unblock', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Button>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </Box>

          {addressKeys.length === 0 && nameKeys.length === 0 && (
            <Box
              sx={{
                alignItems: 'center',
                backgroundColor: alpha('#FFFFFF', 0.035),
                border: '1px dashed rgba(169,188,216,0.18)',
                borderRadius: '12px',
                color: 'rgba(214,221,233,0.72)',
                display: 'flex',
                fontSize: '0.86rem',
                justifyContent: 'center',
                lineHeight: 1.55,
                mt: 2,
                px: 2,
                py: 2.25,
                textAlign: 'center',
              }}
            >
              <Typography sx={{ fontSize: 'inherit', lineHeight: 'inherit' }}>
                {t('auth:message.generic.no_blocked_users', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={dialogActionsSx}>
          <Button
            sx={getDialogSecondaryButtonSx(theme)}
            variant="contained"
            onClick={handleCloseMain}
          >
            {t('core:action.close', { postProcess: 'capitalizeFirstChar' })}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        aria-describedby="decide-block-description"
        aria-labelledby="decide-block-title"
        open={isShow}
        onClose={onCancel}
        slotProps={{
          backdrop: {
            sx: dialogModalBackdropSx,
          },
          paper: {
            sx: {
              ...getDialogPaperSx(theme, { maxWidth: 440 }),
              position: 'relative',
              width: 'calc(100% - 40px)',
            },
          },
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle
          id="decide-block-title"
          sx={{
            ...dialogTitleSx,
            pr: 6,
            textAlign: 'center',
          }}
        >
          {t('auth:message.generic.decide_block', {
            postProcess: 'capitalizeAll',
          })}
        </DialogTitle>
        <IconButton
          aria-label={t('core:action.close', {
            postProcess: 'capitalizeFirstChar',
          })}
          onClick={onCancel}
          sx={{
            color: theme.palette.text.secondary,
            position: 'absolute',
            right: 10,
            top: 14,
            '&:hover': {
              color: theme.palette.text.primary,
            },
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: 22 }} />
        </IconButton>
        <DialogContent sx={dialogContentSx}>
          <DialogContentText
            id="decide-block-description"
            sx={dialogContentTextSx}
          >
            {t('auth:message.generic.blocking', {
              name: message?.userName || message?.userAddress,
              postProcess: 'capitalizeFirstChar',
            })}
          </DialogContentText>

          <Box
            sx={{
              alignItems: 'flex-start',
              backgroundColor: '#1A212C',
              border: '1px solid rgba(169,188,216,0.13)',
              borderRadius: '12px',
              display: 'flex',
              gap: 1.2,
              mt: 2,
              px: 1.45,
              py: 1.25,
            }}
          >
            <InfoIcon
              sx={{
                color: theme.palette.primary.main,
                flexShrink: 0,
                fontSize: 22,
                mt: '1px',
              }}
            />
            <Typography sx={{ ...dialogContentTextSx, fontSize: '0.88rem' }}>
              {t('auth:message.generic.choose_block', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </Box>
        </DialogContent>

        <DialogActions
          sx={{
            ...dialogActionsSx,
            flexWrap: 'wrap',
            justifyContent: 'stretch',
          }}
        >
          <Button
            fullWidth
            sx={getDialogSecondaryButtonSx(theme)}
            variant="contained"
            onClick={() => {
              onOk('address');
            }}
          >
            {t('auth:action.block_txs', { postProcess: 'capitalizeFirstChar' })}
          </Button>
          <Button
            fullWidth
            sx={getDialogSecondaryButtonSx(theme)}
            variant="contained"
            onClick={() => {
              onOk('name');
            }}
          >
            {t('auth:action.block_data', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
          <Button
            fullWidth
            sx={getDialogPrimaryButtonSx(theme)}
            variant="contained"
            onClick={() => {
              onOk('both');
            }}
          >
            {t('auth:action.block_all', { postProcess: 'capitalizeFirstChar' })}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
