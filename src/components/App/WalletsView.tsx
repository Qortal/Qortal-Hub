import { Box, ButtonBase } from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { useTranslation } from 'react-i18next';
import { Wallets } from '../Wallets';
import { AuthScreen } from '../Auth/AuthShell';
import { useEffect, useState } from 'react';

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
  const { t } = useTranslation(['auth']);
  const [importView, setImportView] = useState<'choice' | 'backup' | 'seedphrase'>(
    'choice'
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onBack();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onBack]);

  return (
    <AuthScreen
      title={t('auth:import_account.title')}
      subtitle={t('auth:import_account.subtitle')}
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
