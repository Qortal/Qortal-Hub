import {
  Box,
  ButtonBase,
  Dialog,
  IconButton,
  Typography,
  useTheme,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import { useAuth } from '../hooks/useAuth';
import { useAtom } from 'jotai';
import {
  isOpenDialogCustomApikey,
  selectedNodeInfoAtom,
} from '../atoms/global';
import { useTranslation } from 'react-i18next';
import { ApiKey } from '../types/auth';
import { useEffect, useState } from 'react';
import { AuthButton, AuthInput, AuthSectionLabel } from './Auth/AuthShell';
import { dialogModalBackdropSx } from './App/dialogSurface';

export function CustomNodeApikeyDialog() {
  const { validateApiKey, handleSaveNodeInfo, authenticate, saveCustomNodes } =
    useAuth();
  const { t } = useTranslation(['node', 'core']);
  const theme = useTheme();

  const [apikey, setApikey] = useState('');
  const [open, setOpen] = useAtom(isOpenDialogCustomApikey);
  const [selectedNode] = useAtom(selectedNodeInfoAtom);
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const setCustomNodes = async (nodes) => {
    return window.sendMessage('setCustomNodes', nodes).catch((error) => {
      console.error(error);
    });
  };

  const getCustomNodes = async () => {
    try {
      const nodes = await window.sendMessage('getCustomNodesFromStorage');
      return nodes || [];
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    if (selectedNode) {
      setApikey(selectedNode?.apikey || '');
    }
  }, [selectedNode]);

  const closeDialog = () => {
    setMessage('');
    setOpen(false);
  };

  const handleContinue = async () => {
    if (isSubmitting) return;

    try {
      setIsSubmitting(true);
      setMessage('');
      const payload: ApiKey = {
        url: selectedNode?.url as string,
        apikey,
        name: selectedNode?.name || '',
      };
      const { isValid } = await validateApiKey(payload);
      if (isValid) {
        const customNodes = await getCustomNodes();
        const copyCustomNodes = [...customNodes];
        const findNode = copyCustomNodes.findIndex(
          (n) => n?.url === selectedNode?.url
        );
        if (findNode !== -1) {
          payload.name = payload.name || copyCustomNodes[findNode]?.name || '';
          copyCustomNodes.splice(findNode, 1, payload);
        } else {
          copyCustomNodes.push(payload);
        }
        await setCustomNodes(copyCustomNodes);

        await handleSaveNodeInfo(payload);
        await saveCustomNodes(payload);
        await authenticate();
        setMessage('');
        setOpen(false);
        return;
      }
      setMessage(
        t('node:error.invalidKey', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={closeDialog}
      fullWidth
      maxWidth="sm"
      aria-labelledby="custom-api-key-title"
      slotProps={{
        backdrop: { sx: dialogModalBackdropSx },
        paper: {
          sx: {
            backgroundColor: '#0d1117',
            backgroundImage: 'linear-gradient(180deg, #121821 0%, #0d1117 100%)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '10px',
            boxShadow: '0 24px 50px rgba(0,0,0,0.34)',
            maxWidth: '460px',
          },
        },
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          px: 2.4,
          py: 1.8,
        }}
      >
        <Box sx={{ width: 40 }} />
        <Typography
          id="custom-api-key-title"
          sx={{
            flex: 1,
            fontSize: '1.08rem',
            fontWeight: 700,
            textAlign: 'center',
          }}
        >
          {t('node:invalidKey.title', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
        <IconButton
          onClick={closeDialog}
          sx={{ color: theme.palette.text.secondary }}
        >
          <CloseRoundedIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Box>

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1.35,
          px: 2.4,
          pb: 2.4,
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            backgroundColor: 'rgba(62,107,214,0.08)',
            border: '1px solid rgba(92,145,255,0.14)',
            borderRadius: '8px',
            display: 'flex',
            gap: 1,
            px: 1.2,
            py: 1,
          }}
        >
          <KeyRoundedIcon
            sx={{ color: theme.palette.primary.main, fontSize: 20 }}
          />
          <Typography
            sx={{
              color: 'rgba(214,221,233,0.72)',
              fontSize: '0.86rem',
              lineHeight: 1.45,
            }}
          >
            {t('node:invalidKey.description', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </Box>

        <Box>
          <AuthSectionLabel>Node</AuthSectionLabel>
          <AuthInput
            value={selectedNode?.url || ''}
            disabled
            sx={{
              '& .MuiInputBase-input.Mui-disabled': {
                WebkitTextFillColor: 'rgba(214,221,233,0.46)',
              },
            }}
          />
        </Box>

        <Box>
          <AuthSectionLabel>API key</AuthSectionLabel>
          <AuthInput
            autoFocus
            value={apikey}
            onChange={(e) => setApikey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleContinue();
              }
            }}
          />
        </Box>

        {message && (
          <Typography
            sx={{
              color: '#D8BA8A',
              fontSize: '0.8rem',
              lineHeight: 1.45,
            }}
          >
            {message}
          </Typography>
        )}

        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
            mt: 0.6,
          }}
        >
          <ButtonBase
            onClick={closeDialog}
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '0.86rem',
              fontWeight: 700,
              minHeight: 34,
              px: 0.3,
              '&:hover': {
                color: theme.palette.text.primary,
              },
            }}
          >
            {t('core:action.close', {
              postProcess: 'capitalizeFirstChar',
            })}
          </ButtonBase>
          <AuthButton
            disabled={isSubmitting}
            onClick={handleContinue}
            fullWidth={false}
          >
            {t('node:actions.continue', {
              postProcess: 'capitalizeFirstChar',
            })}
          </AuthButton>
        </Box>
      </Box>
    </Dialog>
  );
}
