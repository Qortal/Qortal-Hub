import { Box, ButtonBase } from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { Wallets } from '../Wallets';
import { AuthScreen } from '../Auth/AuthShell';
import { useState } from 'react';

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
  const [importView, setImportView] = useState<'choice' | 'backup' | 'seedphrase'>(
    'choice'
  );

  return (
    <AuthScreen
      title="Import account"
      subtitle="Choose how you want to restore your account."
      maxWidth={420}
    >
      {importView === 'choice' && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
          <ButtonBase
            onClick={onBack}
            sx={{
              color: 'rgba(214,221,233,0.62)',
              minWidth: 0,
              p: 0,
              '&:hover': {
                color: 'rgba(230,236,247,0.92)',
              },
            }}
          >
            <ArrowBackRoundedIcon sx={{ fontSize: 18 }} />
          </ButtonBase>
        </Box>
      )}

      <Wallets
        setRawWallet={setRawWallet}
        setExtState={setExtState}
        rawWallet={rawWallet}
        mode="import"
        onImportViewChange={setImportView}
      />
    </AuthScreen>
  );
}
