import { Box } from '@mui/material';
import { Return } from '../../assets/Icons/Return.tsx';
import { Spacer } from '../../common/Spacer';
import { Wallets } from '../Wallets';

type WalletsViewProps = {
  onBack: () => void;
  setRawWallet: (wallet: any) => void;
  setExtState: (state: any) => void;
  rawWallet: any;
};

export function WalletsView({
  onBack,
  setRawWallet,
  setExtState,
  rawWallet,
}: WalletsViewProps) {
  return (
    <>
      <Spacer height="22px" />
      <Box
        sx={{
          boxSizing: 'border-box',
          display: 'flex',
          justifyContent: 'flex-start',
          alignItems: 'center',
          maxWidth: '700px',
          paddingLeft: '22px',
          paddingRight: '22px',
          width: '100%',
          marginBottom: 4,
        }}
      >
        <Return
          style={{
            cursor: 'pointer',
            height: '24px',
            width: 'auto',
          }}
          onClick={onBack}
        />
      </Box>
      <Wallets
        setRawWallet={setRawWallet}
        setExtState={setExtState}
        rawWallet={rawWallet}
      />
    </>
  );
}
