import { memo } from 'react';
import { Box, Button, ButtonBase, CircularProgress, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Spacer } from '../../common/Spacer';
import {
  AddressBox,
  AuthenticatedContainerInnerLeft,
  CustomButton,
  TextP,
} from '../../styles/App-styles.ts';
import { MainAvatar } from '../MainAvatar';
import { AddressQRCode } from '../AddressQRCode';
import { CopyIcon } from '../../assets/Icons/CopyIcon.tsx';
import RefreshIcon from '@mui/icons-material/Refresh';
import { executeEvent } from '../../utils/events';

export type ProfileLeftProps = {
  userInfo: { name?: string; address?: string } | null;
  balance: number;
  rawWallet: { address0?: string } | null;
  qortBalanceLoading: boolean;
  setOpenSnack: (open: boolean) => void;
  setInfoSnack: (info: { type: string; message: string } | null) => void;
  onRefreshBalance: () => void;
  onOpenSendQort: () => void;
  onOpenRegisterName: () => void;
  onCloseDrawer?: () => void;
};

export const ProfileLeft = memo(function ProfileLeft({
  userInfo,
  balance,
  rawWallet,
  qortBalanceLoading,
  setOpenSnack,
  setInfoSnack,
  onRefreshBalance,
  onOpenSendQort,
  onOpenRegisterName,
  onCloseDrawer,
}: ProfileLeftProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  const handleOpenSendQort = () => {
    onOpenSendQort();
    onCloseDrawer?.();
  };

  return (
    <AuthenticatedContainerInnerLeft
      sx={{
        minWidth: '225px',
        overflowY: 'auto',
        padding: '0px 20px',
      }}
    >
      <Spacer height="20px" />
      <Spacer height="48px" />

      <>
        <MainAvatar
          setOpenSnack={setOpenSnack}
          setInfoSnack={setInfoSnack}
          myName={userInfo?.name}
          balance={balance}
        />

        <Spacer height="32px" />

        <TextP
          sx={{
            fontSize: '20px',
            lineHeight: '24px',
            textAlign: 'center',
          }}
        >
          {userInfo?.name}
        </TextP>

        <Spacer height="10px" />

        <ButtonBase
          onClick={() => {
            if (rawWallet?.address0) {
              navigator.clipboard
                .writeText(rawWallet.address0)
                .catch((err) => {
                  console.error('Failed to copy address:', err);
                });
            }
          }}
        >
          <AddressBox>
            {rawWallet?.address0?.slice(0, 6)}...
            {rawWallet?.address0?.slice(-4)}{' '}
            <CopyIcon color={theme.palette.text.primary} />
          </AddressBox>
        </ButtonBase>

        <Spacer height="10px" />

        {qortBalanceLoading && <CircularProgress color="success" size={16} />}

        {!qortBalanceLoading && balance >= 0 && (
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: '10px',
            }}
          >
            <TextP
              sx={{
                fontSize: '20px',
                fontWeight: 700,
                lineHeight: '24px',
                textAlign: 'center',
              }}
            >
              {balance?.toFixed(2)} QORT
            </TextP>

            <RefreshIcon
              onClick={onRefreshBalance}
              sx={{
                fontSize: '16px',
                cursor: 'pointer',
              }}
            />
          </Box>
        )}

        <Spacer height="35px" />

        {userInfo && !userInfo?.name && (
          <Button
            variant={'contained'}
            sx={{
              backgroundColor: 'red',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: 500,
              lineHeight: 1.2,
              marginTop: '10px',
              textAlign: 'center',
            }}
            onClick={onOpenRegisterName}
          >
            {t('core:action.register_name', {
              postProcess: 'capitalizeAll',
            })}
          </Button>
        )}

        <Spacer height="20px" />

        <CustomButton onClick={handleOpenSendQort}>
          {t('core:action.transfer_qort', {
            postProcess: 'capitalizeFirstChar',
          })}
        </CustomButton>
        <AddressQRCode targetAddress={rawWallet?.address0} />
      </>

      <TextP
        sx={{
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: 500,
          lineHeight: '24px',
          marginTop: '10px',
          textAlign: 'center',
          textDecoration: 'underline',
        }}
        onClick={async () => {
          executeEvent('addTab', {
            data: { service: 'APP', name: 'q-trade' },
          });
          executeEvent('open-apps-mode', {});
        }}
      >
        {t('core:action.get_qort_trade', {
          postProcess: 'capitalizeFirstChar',
        })}
      </TextP>
    </AuthenticatedContainerInnerLeft>
  );
});
