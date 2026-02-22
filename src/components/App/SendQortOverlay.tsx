import { Box } from '@mui/material';
import { Return } from '../../assets/Icons/Return.tsx';
import { Spacer } from '../../common/Spacer';
import { QortPayment } from '../QortPayment';

type SendQortOverlayProps = {
  balance: number;
  paymentTo: string;
  onReturn: () => void;
  onSuccess: () => void;
  show: (data: any) => Promise<unknown>;
};

export function SendQortOverlay({
  balance,
  paymentTo,
  onReturn,
  onSuccess,
  show,
}: SendQortOverlayProps) {
  return (
    <Box
      sx={{
        alignItems: 'center',
        background: (theme) => theme.palette.background.default,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        position: 'fixed',
        width: '100%',
        zIndex: 10000,
      }}
    >
      <Spacer height="22px" />
      <Box
        sx={{
          boxSizing: 'border-box',
          display: 'flex',
          justifyContent: 'flex-start',
          maxWidth: '700px',
          paddingLeft: '22px',
          width: '100%',
        }}
      >
        <Return
          style={{
            cursor: 'pointer',
            height: '24px',
            width: 'auto',
          }}
          onClick={onReturn}
        />
      </Box>
      <Spacer height="35px" />
      <QortPayment
        balance={balance}
        show={show}
        onSuccess={onSuccess}
        defaultPaymentTo={paymentTo}
      />
    </Box>
  );
}
