import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  QORTAL_APP_CONTEXT,
  getArbitrarySearchSimpleEndpointReact,
  getBaseApiReact,
  pauseAllQueues,
  resumeAllQueues,
} from '../../App';
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material';
import {
  getAllPublishesFromAdmins,
  getPublishesFromAdmins,
} from '../Group/groupApi';
import { decryptResource } from '../Group/groupDataPublishes';
import { validateSecretKey } from '../Group/groupValidation';
import { getFee } from '../../background/background.ts';
import { base64ToUint8Array } from '../../qdn/encryption/group-encryption';
import { uint8ArrayToObject } from '../../encryption/encryption.ts';
import { formatTimestampForum } from '../../utils/time';
import { Spacer } from '../../common/Spacer';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { useAtom, useSetAtom } from 'jotai';
import {
  infoSnackGlobalAtom,
  openSnackGlobalAtom,
  txListAtom,
} from '../../atoms/global';

export const getPublishesFromAdminsAdminSpace = async (
  admins: string[],
  groupId
) => {
  const queryString = admins
    .map((name) => `name=${encodeURIComponent(name)}`)
    .join('&');
  const url = `${getBaseApiReact()}${getArbitrarySearchSimpleEndpointReact()}?mode=ALL&service=DOCUMENT_PRIVATE&identifier=admins-symmetric-qchat-group-${groupId}&exactmatchnames=true&limit=0&reverse=true&${queryString}&prefix=true`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(i18next.t('core:message.error.network_generic'));
  }
  const adminData = await response.json();

  const filterId = adminData.filter(
    (data: any) => data.identifier === `admins-symmetric-qchat-group-${groupId}`
  );

  if (filterId?.length === 0) {
    return false;
  }

  const sortedData = filterId.sort((a: any, b: any) => {
    // Get the most recent date for both a and b
    const dateA = a.updated ? new Date(a.updated) : new Date(a.created);
    const dateB = b.updated ? new Date(b.updated) : new Date(b.created);

    // Sort by most recent
    return dateB.getTime() - dateA.getTime();
  });

  return sortedData[0];
};

const EMPTY_ADMINS = [];

export const AdminSpaceInner = ({
  selectedGroup,
  adminsWithNames = EMPTY_ADMINS,
  isOwner,
  compact = false,
}) => {
  const [adminGroupSecretKey, setAdminGroupSecretKey] = useState(null);
  const [isFetchingAdminGroupSecretKey, setIsFetchingAdminGroupSecretKey] =
    useState(true);
  const [isFetchingGroupSecretKey, setIsFetchingGroupSecretKey] =
    useState(true);
  const [
    adminGroupSecretKeyPublishDetails,
    setAdminGroupSecretKeyPublishDetails,
  ] = useState(null);
  const [groupSecretKeyPublishDetails, setGroupSecretKeyPublishDetails] =
    useState(null);
  const [groupKeyLoadError, setGroupKeyLoadError] = useState(false);
  const [adminKeyLoadError, setAdminKeyLoadError] = useState(false);
  const [isLoadingPublishKey, setIsLoadingPublishKey] = useState(false);
  const [groupKeyPublishSelectOpen, setGroupKeyPublishSelectOpen] =
    useState(false);
  const [groupKeyPublishList, setGroupKeyPublishList] = useState<any[]>([]);
  const [loadingGroupKeyPublishList, setLoadingGroupKeyPublishList] =
    useState(false);
  const [groupKeyPublishListError, setGroupKeyPublishListError] =
    useState(false);
  const [selectedPublishForGroupKey, setSelectedPublishForGroupKey] =
    useState(null);
  const [isPublishingGroupKey, setIsPublishingGroupKey] = useState(false);
  const [groupKeyPublishConfirmOpen, setGroupKeyPublishConfirmOpen] =
    useState(false);
  const [addNewKey, setAddNewKey] = useState(false);
  const [publishedGroupKey, setPublishedGroupKey] = useState(false);
  const operationInProgress = useRef(false);
  const groupRef = useRef(selectedGroup);
  groupRef.current = selectedGroup;
  const ownerRef = useRef(isOwner);
  ownerRef.current = isOwner;
  const adminScopeRef = useRef('');
  adminScopeRef.current = JSON.stringify(
    adminsWithNames.map((admin) => [admin?.address, admin?.name])
  );
  const mountedRef = useRef(true);
  const groupLoadRevision = useRef(0);
  const adminLoadRevision = useRef(0);
  const [txList, setTxList] = useAtom(txListAtom);
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const setInfoSnackCustom = useSetAtom(infoSnackGlobalAtom);
  const setOpenSnackGlobal = useSetAtom(openSnackGlobalAtom);
  const { t } = useTranslation(['auth', 'core', 'group', 'question']);
  const isCurrentGroup = (groupId) =>
    mountedRef.current && String(groupRef.current) === String(groupId);
  const hasPendingGroupPublish = txList.some(
    (tx) =>
      tx.type === 'created-common-secret' &&
      tx.keyType !== 'admin' &&
      String(tx.groupId) === String(selectedGroup) &&
      !tx.done
  );
  const hasPendingAdminPublish = txList.some(
    (tx) =>
      tx.type === 'created-common-secret' &&
      tx.keyType === 'admin' &&
      String(tx.groupId) === String(selectedGroup) &&
      !tx.done
  );
  const isBusy = isPublishingGroupKey || isLoadingPublishKey;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const showError = useCallback(
    (error) => {
      if (error?.isCanceled) return;
      setInfoSnackCustom({
        type: 'error',
        message:
          error?.message ||
          (typeof error === 'string' && error) ||
          t('auth:message.error.reencrypt_secret_key', {
            postProcess: 'capitalizeFirstChar',
          }),
      });
      setOpenSnackGlobal(true);
    },
    [setInfoSnackCustom, setOpenSnackGlobal, t]
  );

  const adminNames = useCallback(() => {
    const names = adminsWithNames.map((admin) => admin?.name).filter(Boolean);
    if (!selectedGroup || names.length === 0) {
      throw new Error(t('core:message.error.network_generic'));
    }
    return names;
  }, [adminsWithNames, selectedGroup, t]);

  const readKeyPublish = async (publish) => {
    const res = await fetch(
      `${getBaseApiReact()}/arbitrary/DOCUMENT_PRIVATE/${encodeURIComponent(publish.name)}/${encodeURIComponent(publish.identifier)}?encoding=base64&rebuild=true`
    );
    if (!res.ok) throw new Error(t('core:message.error.network_generic'));
    const decrypted: any = await decryptResource(await res.text());
    const key = uint8ArrayToObject(base64ToUint8Array(decrypted.data));
    if (!validateSecretKey(key) || Object.keys(key).length === 0) {
      throw new Error(
        t('auth:message.error.invalid_secret_key', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
    return key;
  };

  const getGroupSecretKey = useCallback(async () => {
    const groupId = selectedGroup;
    const revision = ++groupLoadRevision.current;
    setIsFetchingGroupSecretKey(true);
    setGroupKeyLoadError(false);
    try {
      const latest = await getPublishesFromAdmins(adminNames(), groupId);
      if (latest !== false && !latest)
        throw new Error(t('core:message.error.network_generic'));
      if (!isCurrentGroup(groupId) || revision !== groupLoadRevision.current)
        return;
      setGroupSecretKeyPublishDetails(latest);
      if (latest) setPublishedGroupKey(false);
    } catch (error) {
      if (!isCurrentGroup(groupId) || revision !== groupLoadRevision.current)
        return;
      setGroupSecretKeyPublishDetails(null);
      setGroupKeyLoadError(true);
      showError(error);
    } finally {
      if (isCurrentGroup(groupId) && revision === groupLoadRevision.current)
        setIsFetchingGroupSecretKey(false);
    }
  }, [adminNames, selectedGroup, showError]);

  const getAdminGroupSecretKey = useCallback(async () => {
    const groupId = selectedGroup;
    const revision = ++adminLoadRevision.current;
    setIsFetchingAdminGroupSecretKey(true);
    setAdminKeyLoadError(false);
    try {
      const latest = await getPublishesFromAdminsAdminSpace(
        adminNames(),
        groupId
      );
      const key = latest ? await readKeyPublish(latest) : null;
      if (!isCurrentGroup(groupId) || revision !== adminLoadRevision.current)
        return;
      setAdminGroupSecretKey(key);
      setAdminGroupSecretKeyPublishDetails(latest || null);
    } catch (error) {
      if (!isCurrentGroup(groupId) || revision !== adminLoadRevision.current)
        return;
      setAdminGroupSecretKey(null);
      setAdminGroupSecretKeyPublishDetails(null);
      setAdminKeyLoadError(true);
      showError(error);
    } finally {
      if (isCurrentGroup(groupId) && revision === adminLoadRevision.current)
        setIsFetchingAdminGroupSecretKey(false);
    }
  }, [adminNames, selectedGroup, showError]);

  useEffect(() => {
    setGroupSecretKeyPublishDetails(null);
    setAdminGroupSecretKey(null);
    setAdminGroupSecretKeyPublishDetails(null);
    setSelectedPublishForGroupKey(null);
    setGroupKeyPublishSelectOpen(false);
    setGroupKeyPublishConfirmOpen(false);
    setAddNewKey(false);
    setPublishedGroupKey(false);
    void getGroupSecretKey();
    void getAdminGroupSecretKey();
    return () => {
      groupLoadRevision.current++;
      adminLoadRevision.current++;
    };
  }, [getAdminGroupSecretKey, getGroupSecretKey]);

  const confirmFee = async () => {
    const fee = await getFee('ARBITRARY');
    await show({
      message: t('core:message.question.perform_transaction', {
        action: 'ARBITRARY',
        postProcess: 'capitalizeFirstChar',
      }),
      publishFee: fee.fee + ' QORT',
    });
  };

  const recordPublish = (response, groupId, keyType = 'group') => {
    setInfoSnackCustom({
      type: 'success',
      message: t('group:admin_space.published'),
    });
    setOpenSnackGlobal(true);
    setTxList((prev) => [
      {
        ...response,
        type: 'created-common-secret',
        keyType,
        groupId,
        done: false,
        label: t('group:message.success.published_secret_key', {
          group_id: groupId,
          postProcess: 'capitalizeFirstChar',
        }),
        labelDone: t('group:message.success.published_secret_key_label', {
          group_id: groupId,
          postProcess: 'capitalizeFirstChar',
        }),
      },
      ...prev,
    ]);
  };

  const openGroupKeyPublishSelect = async () => {
    if (
      isBusy ||
      operationInProgress.current ||
      isFetchingGroupSecretKey ||
      groupKeyLoadError
    )
      return;
    setAddNewKey(false);
    setSelectedPublishForGroupKey(null);
    if (groupSecretKeyPublishDetails === false) {
      setGroupKeyPublishConfirmOpen(true);
      return;
    }
    const groupId = selectedGroup;
    setGroupKeyPublishSelectOpen(true);
    setLoadingGroupKeyPublishList(true);
    setGroupKeyPublishListError(false);
    try {
      const list = await getAllPublishesFromAdmins(adminNames(), groupId);
      if (!isCurrentGroup(groupId)) return;
      setGroupKeyPublishList(list);
      if (list.length === 0) {
        setGroupSecretKeyPublishDetails(false);
        setGroupKeyPublishSelectOpen(false);
        setGroupKeyPublishConfirmOpen(true);
      }
    } catch (error) {
      if (!isCurrentGroup(groupId)) return;
      setGroupKeyPublishList([]);
      setGroupKeyPublishListError(true);
      showError(error);
    } finally {
      if (isCurrentGroup(groupId)) setLoadingGroupKeyPublishList(false);
    }
  };

  const publishGroupKeyFromSelection = async () => {
    if (
      operationInProgress.current ||
      groupKeyLoadError ||
      isFetchingGroupSecretKey ||
      hasPendingGroupPublish
    )
      return;
    const groupId = selectedGroup;
    const adminScope = adminScopeRef.current;
    operationInProgress.current = true;
    setIsPublishingGroupKey(true);
    let paused = false;
    try {
      const names = adminNames();
      await confirmFee();
      if (!isCurrentGroup(groupId) || adminScope !== adminScopeRef.current)
        return;
      pauseAllQueues();
      paused = true;
      // Recheck an empty state after confirmation: another admin may have
      // published in the meantime. Never discard an existing key history.
      const publish =
        selectedPublishForGroupKey ||
        (await getPublishesFromAdmins(names, groupId));
      if (publish !== false && !publish)
        throw new Error(t('core:message.error.network_generic'));
      const previousData = publish ? await readKeyPublish(publish) : null;
      if (!isCurrentGroup(groupId) || adminScope !== adminScopeRef.current)
        return;
      const response = await window.sendMessage(
        'encryptAndPublishSymmetricKeyGroupChat',
        {
          groupId,
          previousData,
          isOwner: ownerRef.current === true,
          addKey: Boolean(
            previousData && ownerRef.current === true && addNewKey
          ),
        }
      );
      if (!response || response.error)
        throw new Error(
          response?.error || t('auth:message.error.reencrypt_secret_key')
        );
      recordPublish(response, groupId);
      if (isCurrentGroup(groupId)) {
        setPublishedGroupKey(true);
        setGroupKeyPublishConfirmOpen(false);
        setGroupKeyPublishSelectOpen(false);
        setSelectedPublishForGroupKey(null);
        setAddNewKey(false);
      }
    } catch (error) {
      if (isCurrentGroup(groupId)) showError(error);
    } finally {
      if (paused) resumeAllQueues();
      operationInProgress.current = false;
      if (isCurrentGroup(groupId)) setIsPublishingGroupKey(false);
    }
  };

  const createCommonSecretForAdmins = async () => {
    if (
      operationInProgress.current ||
      adminKeyLoadError ||
      isFetchingAdminGroupSecretKey ||
      hasPendingAdminPublish
    )
      return;
    const groupId = selectedGroup;
    const adminScope = adminScopeRef.current;
    operationInProgress.current = true;
    setIsLoadingPublishKey(true);
    let paused = false;
    try {
      const names = adminNames();
      await confirmFee();
      if (!isCurrentGroup(groupId) || adminScope !== adminScopeRef.current)
        return;
      pauseAllQueues();
      paused = true;
      const publish = await getPublishesFromAdminsAdminSpace(names, groupId);
      const previousData = publish ? await readKeyPublish(publish) : null;
      if (!isCurrentGroup(groupId) || adminScope !== adminScopeRef.current)
        return;
      const response = await window.sendMessage(
        'encryptAndPublishSymmetricKeyGroupChatForAdmins',
        { groupId, previousData, admins: adminsWithNames }
      );
      if (!response || response.error)
        throw new Error(
          response?.error || t('auth:message.error.reencrypt_secret_key')
        );
      recordPublish(response, groupId, 'admin');
      if (isCurrentGroup(groupId)) void getAdminGroupSecretKey();
    } catch (error) {
      if (isCurrentGroup(groupId)) showError(error);
    } finally {
      if (paused) resumeAllQueues();
      operationInProgress.current = false;
      if (isCurrentGroup(groupId)) setIsLoadingPublishKey(false);
    }
  };

  return (
    <Box
      sx={{
        alignItems: compact ? 'stretch' : 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 1.25 : 0,
        padding: compact ? '12px' : '10px',
        width: '100%',
      }}
    >
      {!compact && (
        <Typography
          sx={{
            fontSize: '14px',
          }}
        >
          {t('auth:message.generic.publishing_key', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
      )}

      {!compact && <Spacer height="25px" />}

      <Box
        sx={{
          border: compact
            ? '1px solid rgba(255, 255, 255, 0.1)'
            : '1px solid gray',
          borderRadius: compact ? '8px' : '6px',
          display: 'flex',
          flexDirection: 'column',
          gap: compact ? 0.75 : '20px',
          maxWidth: '100%',
          padding: compact ? '12px' : '10px',
          width: compact ? '100%' : '300px',
        }}
      >
        {compact && (
          <Typography
            sx={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.01em' }}
          >
            {t('group:admin_space.gsk_title')}
          </Typography>
        )}
        {isFetchingGroupSecretKey && (
          <Typography
            sx={
              compact
                ? {
                    color: 'text.secondary',
                    fontSize: 12,
                    fontWeight: 500,
                    lineHeight: 1.4,
                  }
                : undefined
            }
          >
            {t('auth:message.generic.fetching_group_secret_key', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        )}

        {!isFetchingGroupSecretKey &&
          groupSecretKeyPublishDetails === false &&
          !publishedGroupKey &&
          !hasPendingGroupPublish && (
            <Typography
              sx={
                compact
                  ? {
                      color: 'text.secondary',
                      fontSize: 12,
                      fontWeight: 500,
                      lineHeight: 1.4,
                    }
                  : undefined
              }
            >
              {t('auth:message.generic.no_secret_key_published', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          )}

        {groupSecretKeyPublishDetails && (
          <Typography
            sx={
              compact
                ? {
                    color: 'text.secondary',
                    fontSize: 12,
                    fontWeight: 500,
                    lineHeight: 1.4,
                  }
                : undefined
            }
          >
            {t('auth:message.generic.last_encryption_date', {
              date: formatTimestampForum(
                groupSecretKeyPublishDetails?.updated ||
                  groupSecretKeyPublishDetails?.created
              ),
              name: groupSecretKeyPublishDetails?.name,
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        )}

        {groupKeyLoadError && (
          <Button onClick={getGroupSecretKey} disabled={isBusy}>
            {t('core:retry')}
          </Button>
        )}
        {(publishedGroupKey || hasPendingGroupPublish) && (
          <>
            <Typography variant="caption" color="text.secondary">
              {t('auth:message.generic.publishing_key', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
            <Button
              onClick={getGroupSecretKey}
              disabled={isBusy || isFetchingGroupSecretKey}
            >
              {t('core:action.refresh', { postProcess: 'capitalizeFirstChar' })}
            </Button>
          </>
        )}
        <Button
          onClick={openGroupKeyPublishSelect}
          loading={isPublishingGroupKey}
          disabled={
            isBusy ||
            isFetchingGroupSecretKey ||
            groupKeyLoadError ||
            groupSecretKeyPublishDetails == null ||
            publishedGroupKey ||
            hasPendingGroupPublish
          }
          size={compact ? 'small' : 'medium'}
          variant="contained"
        >
          {groupSecretKeyPublishDetails === false
            ? t('group:admin_space.create_gsk')
            : compact
              ? t('group:admin_space.publish_gsk')
              : t('auth:action.publish_group_secret_key', {
                  postProcess: 'capitalizeFirstChar',
                })}
        </Button>

        <Dialog
          open={groupKeyPublishSelectOpen}
          onClose={() => {
            if (!isPublishingGroupKey) {
              setGroupKeyPublishSelectOpen(false);
              setSelectedPublishForGroupKey(null);
            }
          }}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>
            {t('auth:message.generic.select_publish_to_update_from', {
              postProcess: 'capitalizeFirstChar',
            })}
          </DialogTitle>
          <DialogContent>
            {loadingGroupKeyPublishList ? (
              <Typography>
                {t('auth:message.generic.fetching_group_secret_key', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            ) : groupKeyPublishListError ? (
              <Typography color="error">
                {t('core:message.error.network_generic')}
              </Typography>
            ) : groupKeyPublishList.length === 0 ? (
              <Typography>
                {t('auth:message.generic.no_secret_key_published', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            ) : (
              <List dense>
                {groupKeyPublishList.map((publish) => {
                  const ts = publish?.updated ?? publish?.created ?? 0;
                  const dateNum =
                    typeof ts === 'number' ? ts : new Date(ts).getTime();
                  const label = t('auth:message.generic.last_encryption_date', {
                    date: formatTimestampForum(dateNum),
                    name: publish?.name ?? '',
                    postProcess: 'capitalizeFirstChar',
                  });
                  return (
                    <ListItemButton
                      key={`${publish.name}-${dateNum}`}
                      selected={
                        selectedPublishForGroupKey?.name === publish.name &&
                        (selectedPublishForGroupKey?.updated ??
                          selectedPublishForGroupKey?.created) === ts
                      }
                      onClick={() => setSelectedPublishForGroupKey(publish)}
                    >
                      <ListItemText primary={label} />
                    </ListItemButton>
                  );
                })}
              </List>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setGroupKeyPublishSelectOpen(false);
                setSelectedPublishForGroupKey(null);
              }}
              disabled={isPublishingGroupKey}
            >
              {t('core:action.cancel', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
            <Button
              variant="contained"
              loading={isPublishingGroupKey}
              onClick={() => setGroupKeyPublishConfirmOpen(true)}
              disabled={
                loadingGroupKeyPublishList ||
                groupKeyPublishListError ||
                !selectedPublishForGroupKey
              }
            >
              {t('core:action.publish', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={groupKeyPublishConfirmOpen}
          onClose={() =>
            !isPublishingGroupKey && setGroupKeyPublishConfirmOpen(false)
          }
        >
          <DialogTitle>
            {t('auth:message.generic.confirm_publish_group_secret_key', {
              postProcess: 'capitalizeFirstChar',
            })}
          </DialogTitle>
          <DialogContent>
            <Typography>
              {t(
                selectedPublishForGroupKey
                  ? 'auth:message.generic.confirm_publish_group_secret_key_body'
                  : 'group:admin_space.create_gsk_confirm',
                {
                  postProcess: 'capitalizeFirstChar',
                }
              )}
            </Typography>
            {selectedPublishForGroupKey && isOwner === true && (
              <>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={addNewKey}
                      disabled={isBusy}
                      onChange={(event) => setAddNewKey(event.target.checked)}
                    />
                  }
                  label={t('group:message.generic.add_new_key_option', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                >
                  {t('group:message.generic.add_new_key_sparingly', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
              </>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => setGroupKeyPublishConfirmOpen(false)}
              disabled={isPublishingGroupKey}
            >
              {t('core:action.cancel', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
            <Button
              variant="contained"
              onClick={publishGroupKeyFromSelection}
              loading={isPublishingGroupKey}
              disabled={isLoadingPublishKey}
            >
              {t('core:action.confirm', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
          </DialogActions>
        </Dialog>

        {!compact && <Spacer height="20px" />}

        <Typography
          sx={{
            color: compact ? 'text.secondary' : 'inherit',
            fontSize: compact ? '12px' : '14px',
            lineHeight: compact ? 1.45 : 'normal',
          }}
        >
          {compact
            ? t('group:admin_space.gsk_description_compact')
            : t('auth:tips.key_encrypt_group', {
                postProcess: 'capitalizeFirstChar',
              })}
        </Typography>
      </Box>

      {!compact && <Spacer height="25px" />}

      <Box
        sx={{
          border: compact
            ? '1px solid rgba(255, 255, 255, 0.1)'
            : '1px solid gray',
          borderRadius: compact ? '8px' : '6px',
          display: 'flex',
          flexDirection: 'column',
          gap: compact ? 0.75 : '20px',
          maxWidth: '100%',
          padding: compact ? '12px' : '10px',
          width: compact ? '100%' : '300px',
        }}
      >
        {compact && (
          <Typography
            sx={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.01em' }}
          >
            {t('group:admin_space.ask_title')}
          </Typography>
        )}
        {isFetchingAdminGroupSecretKey && (
          <Typography
            sx={
              compact
                ? {
                    color: 'text.secondary',
                    fontSize: 12,
                    fontWeight: 500,
                    lineHeight: 1.4,
                  }
                : undefined
            }
          >
            {t('auth:message.generic.fetching_admin_secret_key', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        )}

        {!isFetchingAdminGroupSecretKey &&
          !adminKeyLoadError &&
          !adminGroupSecretKey && (
            <Typography
              sx={
                compact
                  ? {
                      color: 'text.secondary',
                      fontSize: 12,
                      fontWeight: 500,
                      lineHeight: 1.4,
                    }
                  : undefined
              }
            >
              {t('auth:message.generic.no_secret_key_published', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          )}

        {adminGroupSecretKeyPublishDetails && (
          <Typography
            sx={
              compact
                ? {
                    color: 'text.secondary',
                    fontSize: 12,
                    fontWeight: 500,
                    lineHeight: 1.4,
                  }
                : undefined
            }
          >
            {t('auth:message.generic.last_encryption_date', {
              date: formatTimestampForum(
                adminGroupSecretKeyPublishDetails?.updated ||
                  adminGroupSecretKeyPublishDetails?.created
              ),
              name: adminGroupSecretKeyPublishDetails?.name,
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        )}

        {adminKeyLoadError && (
          <Button onClick={getAdminGroupSecretKey} disabled={isBusy}>
            {t('core:retry')}
          </Button>
        )}
        <Button
          loading={isLoadingPublishKey}
          disabled={
            isBusy ||
            isFetchingAdminGroupSecretKey ||
            adminKeyLoadError ||
            hasPendingAdminPublish
          }
          onClick={createCommonSecretForAdmins}
          size={compact ? 'small' : 'medium'}
          variant="contained"
        >
          {!adminGroupSecretKey
            ? t('group:admin_space.create_ask')
            : compact
              ? t('group:admin_space.publish_ask')
              : t('auth:action.publish_admin_secret_key', {
                  postProcess: 'capitalizeFirstChar',
                })}
        </Button>

        {!compact && <Spacer height="20px" />}

        <Typography
          sx={{
            color: compact ? 'text.secondary' : 'inherit',
            fontSize: compact ? '12px' : '14px',
            lineHeight: compact ? 1.45 : 'normal',
          }}
        >
          {compact
            ? t('group:admin_space.ask_description')
            : t('auth:tips.key_encrypt_admin', {
                postProcess: 'capitalizeFirstChar',
              })}
        </Typography>
      </Box>

      {compact && (
        <Typography
          sx={{
            color: 'text.secondary',
            fontSize: 10.5,
            lineHeight: 1.35,
            pt: 0,
          }}
        >
          {t('auth:message.generic.publishing_key', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
      )}
    </Box>
  );
};
