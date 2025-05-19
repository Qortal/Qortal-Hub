import { useCallback, useEffect, useMemo, useState } from 'react';
import { DrawerUserLookup } from '../Drawer/DrawerUserLookup';
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  Card,
  Divider,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  Table,
  CircularProgress,
  useTheme,
  Autocomplete,
} from '@mui/material';
import { getAddressInfo, getNameOrAddress } from '../../background';
import { getBaseApiReact } from '../../App';
import { getNameInfo } from '../Group/Group';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import { Spacer } from '../../common/Spacer';
import { formatTimestamp } from '../../utils/time';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen';
import SearchIcon from '@mui/icons-material/Search';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { useNameSearch } from '../../hooks/useNameSearch';
import { useTranslation } from 'react-i18next';

function formatAddress(str) {
  if (str.length <= 12) return str;

  const first6 = str.slice(0, 6);
  const last6 = str.slice(-6);

  return `${first6}....${last6}`;
}

export const UserLookup = ({ isOpenDrawerLookup, setIsOpenDrawerLookup }) => {
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core', 'group']);
  const [nameOrAddress, setNameOrAddress] = useState('');
  const [inputValue, setInputValue] = useState('');
  const { results, isLoading } = useNameSearch(inputValue);
  const options = useMemo(() => results?.map((item) => item.name), [results]);
  const [errorMessage, setErrorMessage] = useState('');
  const [addressInfo, setAddressInfo] = useState(null);
  const [isLoadingUser, setIsLoadingUser] = useState(false);
  const [isLoadingPayments, setIsLoadingPayments] = useState(false);
  const [payments, setPayments] = useState([]);
  const lookupFunc = useCallback(
    async (messageAddressOrName) => {
      try {
        setErrorMessage('');
        setIsLoadingUser(true);
        setPayments([]);
        setAddressInfo(null);
        const inputAddressOrName = messageAddressOrName || nameOrAddress;

        if (!inputAddressOrName?.trim())
          throw new Error(
            t('auth:action.insert_name_address', {
              postProcess: 'capitalizeFirst',
            })
          );

        const owner = await getNameOrAddress(inputAddressOrName);
        if (!owner)
          throw new Error(
            t('auth:message.error.name_not_existing', {
              postProcess: 'capitalizeFirst',
            })
          );

        const addressInfoRes = await getAddressInfo(owner);
        if (!addressInfoRes?.publicKey) {
          throw new Error(
            t('auth:message.error.address_not_existing', {
              postProcess: 'capitalizeFirst',
            })
          );
        }

        const name = await getNameInfo(owner);
        const balanceRes = await fetch(
          `${getBaseApiReact()}/addresses/balance/${owner}`
        );

        const balanceData = await balanceRes.json();
        setAddressInfo({
          ...addressInfoRes,
          balance: balanceData,
          name,
        });
        setIsLoadingUser(false);
        setIsLoadingPayments(true);

        const getPayments = await fetch(
          `${getBaseApiReact()}/transactions/search?txType=PAYMENT&address=${owner}&confirmationStatus=CONFIRMED&limit=20&reverse=true`
        );
        const paymentsData = await getPayments.json();
        setPayments(paymentsData);
      } catch (error) {
        setErrorMessage(error?.message);
        console.error(error);
      } finally {
        setIsLoadingUser(false);
        setIsLoadingPayments(false);
      }
    },
    [nameOrAddress]
  );

  const openUserLookupDrawerFunc = useCallback(
    (e) => {
      setIsOpenDrawerLookup(true);
      const message = e.detail?.addressOrName;
      if (message) {
        lookupFunc(message);
      }
    },
    [lookupFunc, setIsOpenDrawerLookup]
  );

  useEffect(() => {
    subscribeToEvent('openUserLookupDrawer', openUserLookupDrawerFunc);

    return () => {
      unsubscribeFromEvent('openUserLookupDrawer', openUserLookupDrawerFunc);
    };
  }, [openUserLookupDrawerFunc]);

  const onClose = () => {
    setIsOpenDrawerLookup(false);
    setNameOrAddress('');
    setInputValue('');
    setErrorMessage('');
    setPayments([]);
    setIsLoadingUser(false);
    setIsLoadingPayments(false);
    setAddressInfo(null);
  };

  return (
    <DrawerUserLookup open={isOpenDrawerLookup} setOpen={setIsOpenDrawerLookup}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          overflow: 'hidden',
          padding: '15px',
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexShrink: 0,
            gap: '5px',
          }}
        >
          <Autocomplete
            value={nameOrAddress}
            onChange={(event: any, newValue: string | null) => {
              if (!newValue) {
                setNameOrAddress('');
                return;
              }
              setNameOrAddress(newValue);
              lookupFunc(newValue);
            }}
            inputValue={inputValue}
            onInputChange={(event, newInputValue) => {
              setInputValue(newInputValue);
            }}
            id="controllable-states-demo"
            loading={isLoading}
            options={options}
            sx={{ width: 300 }}
            renderInput={(params) => (
              <TextField
                autoFocus
                autoComplete="off"
                {...params}
                label={t('auth:address_name', {
                  postProcess: 'capitalizeFirst',
                })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && nameOrAddress) {
                    lookupFunc(inputValue);
                  }
                }}
              />
            )}
          />

          <ButtonBase
            sx={{
              marginLeft: 'auto',
            }}
            onClick={() => {
              onClose();
            }}
          >
            <CloseFullscreenIcon
              sx={{
                color: theme.palette.text.primary,
              }}
            />
          </ButtonBase>
        </Box>

        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            overflow: 'auto',
          }}
        >
          {!isLoadingUser && errorMessage && (
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'center',
                marginTop: '40px',
                width: '100%',
              }}
            >
              <Typography>{errorMessage}</Typography>
            </Box>
          )}

          {isLoadingUser && (
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'center',
                marginTop: '40px',
                width: '100%',
              }}
            >
              <CircularProgress
                sx={{
                  color: theme.palette.text.primary,
                }}
              />
            </Box>
          )}

          {!isLoadingUser && addressInfo && (
            <>
              <Spacer height="30px" />
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: '20px',
                  justifyContent: 'center',
                  width: '100%',
                }}
              >
                <Card
                  sx={{
                    alignItems: 'center',
                    background: theme.palette.background.default,
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: '200px',
                    minWidth: '320px',
                    padding: '15px',
                  }}
                >
                  <Typography
                    sx={{
                      textAlign: 'center',
                    }}
                  >
                    {addressInfo?.name ??
                      t('auth:message.error.name_not_registered', {
                        postProcess: 'capitalizeFirst',
                      })}
                  </Typography>

                  <Spacer height="20px" />

                  <Divider>
                    {addressInfo?.name ? (
                      <Avatar
                        sx={{
                          height: '50px',
                          width: '50px',
                          '& img': {
                            objectFit: 'fill',
                          },
                        }}
                        alt={addressInfo?.name}
                        src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${
                          addressInfo?.name
                        }/qortal_avatar?async=true`}
                      >
                        <AccountCircleIcon
                          sx={{
                            fontSize: '50px',
                          }}
                        />
                      </Avatar>
                    ) : (
                      <AccountCircleIcon
                        sx={{
                          fontSize: '50px',
                        }}
                      />
                    )}
                  </Divider>

                  <Spacer height="20px" />

                  <Typography
                    sx={{
                      textAlign: 'center',
                    }}
                  >
                    {t('core:level', { postProcess: 'capitalizeFirst' })}{' '}
                    {addressInfo?.level}
                  </Typography>
                </Card>

                <Card
                  sx={{
                    background: theme.palette.background.default,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '20px',
                    minHeight: '200px',
                    minWidth: '320px',
                    padding: '15px',
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
                    <Box
                      sx={{
                        display: 'flex',
                        flexShrink: 0,
                      }}
                    >
                      <Typography>
                        {t('auth:address', { postProcess: 'capitalizeFirst' })}
                      </Typography>
                    </Box>

                    <Tooltip
                      title={
                        <span
                          style={{
                            color: theme.palette.text.primary,
                            fontSize: '14px',
                            fontWeight: 700,
                          }}
                        >
                          {t('auth:action.copy_address', {
                            postProcess: 'capitalizeFirst',
                          })}
                        </span>
                      }
                      placement="bottom"
                      arrow
                      sx={{ fontSize: '24' }}
                      slotProps={{
                        tooltip: {
                          sx: {
                            color: theme.palette.text.primary,
                            backgroundColor: theme.palette.background.default,
                          },
                        },
                        arrow: {
                          sx: {
                            color: theme.palette.text.primary,
                          },
                        },
                      }}
                    >
                      <ButtonBase
                        onClick={() => {
                          navigator.clipboard.writeText(addressInfo?.address);
                        }}
                      >
                        <Typography
                          sx={{
                            textAlign: 'end',
                          }}
                        >
                          {addressInfo?.address}
                        </Typography>
                      </ButtonBase>
                    </Tooltip>
                  </Box>

                  <Box
                    sx={{
                      display: 'flex',
                      gap: '20px',
                      justifyContent: 'space-between',
                      width: '100%',
                    }}
                  >
                    <Typography>
                      {t('core:balance', { postProcess: 'capitalizeFirst' })}
                    </Typography>

                    <Typography>{addressInfo?.balance}</Typography>
                  </Box>

                  <Spacer height="20px" />

                  <Button
                    variant="contained"
                    onClick={() => {
                      executeEvent('openPaymentInternal', {
                        address: addressInfo?.address,
                        name: addressInfo?.name,
                      });
                    }}
                  >
                    {t('core:action.send_qort', {
                      postProcess: 'capitalizeFirst',
                    })}
                  </Button>
                </Card>
              </Box>
            </>
          )}

          <Spacer height="40px" />

          {isLoadingPayments && (
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'center',
                width: '100%',
              }}
            >
              <CircularProgress
                sx={{
                  color: theme.palette.text.primary,
                }}
              />
            </Box>
          )}
          {!isLoadingPayments && addressInfo && (
            <Card
              sx={{
                background: theme.palette.background.default,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'auto',
                padding: '15px',
              }}
            >
              <Typography>
                {t('core:message.generic.most_recent_payment', {
                  count: 20,
                  postProcess: 'capitalizeFirst',
                })}
              </Typography>

              <Spacer height="20px" />

              {!isLoadingPayments && payments?.length === 0 && (
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    width: '100%',
                  }}
                >
                  <Typography>
                    {t('core:message.generic.no_payments', {
                      postProcess: 'capitalizeFirst',
                    })}
                  </Typography>
                </Box>
              )}

              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>
                      {t('core:sender', { postProcess: 'capitalizeFirst' })}
                    </TableCell>
                    <TableCell>
                      {t('core:receiver', { postProcess: 'capitalizeFirst' })}
                    </TableCell>
                    <TableCell>
                      {t('core:amount', { postProcess: 'capitalizeFirst' })}
                    </TableCell>
                    <TableCell>
                      {t('core:time', { postProcess: 'capitalizeFirst' })}
                    </TableCell>
                  </TableRow>
                </TableHead>

                <TableBody>
                  {payments.map((payment, index) => (
                    <TableRow key={payment?.signature}>
                      <TableCell>
                        <Tooltip
                          title={
                            <span
                              style={{
                                color: theme.palette.text.primary,
                                fontSize: '14px',
                                fontWeight: 700,
                              }}
                            >
                              {t('auth:action.copy_address', {
                                postProcess: 'capitalizeFirst',
                              })}
                            </span>
                          }
                          placement="bottom"
                          arrow
                          sx={{ fontSize: '24' }}
                          slotProps={{
                            tooltip: {
                              sx: {
                                color: theme.palette.text.primary,
                                backgroundColor:
                                  theme.palette.background.default,
                              },
                            },
                            arrow: {
                              sx: {
                                color: theme.palette.text.primary,
                              },
                            },
                          }}
                        >
                          <ButtonBase
                            onClick={() => {
                              navigator.clipboard.writeText(
                                payment?.creatorAddress
                              );
                            }}
                          >
                            {formatAddress(payment?.creatorAddress)}
                          </ButtonBase>
                        </Tooltip>
                      </TableCell>

                      <TableCell>
                        <Tooltip
                          title={
                            <span
                              style={{
                                color: theme.palette.text.primary,
                                fontSize: '14px',
                                fontWeight: 700,
                              }}
                            >
                              {t('auth:action.copy_address', {
                                postProcess: 'capitalizeFirst',
                              })}
                            </span>
                          }
                          placement="bottom"
                          arrow
                          sx={{ fontSize: '24' }}
                          slotProps={{
                            tooltip: {
                              sx: {
                                color: theme.palette.text.primary,
                                backgroundColor:
                                  theme.palette.background.default,
                              },
                            },
                            arrow: {
                              sx: {
                                color: theme.palette.text.primary,
                              },
                            },
                          }}
                        >
                          <ButtonBase
                            onClick={() => {
                              navigator.clipboard.writeText(payment?.recipient);
                            }}
                          >
                            {formatAddress(payment?.recipient)}
                          </ButtonBase>
                        </Tooltip>
                      </TableCell>

                      <TableCell>{payment?.amount}</TableCell>

                      <TableCell>
                        {formatTimestamp(payment?.timestamp)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </Box>
      </Box>
    </DrawerUserLookup>
  );
};
