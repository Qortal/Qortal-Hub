import * as React from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { useAuth } from '../hooks/useAuth';
import { useAtom } from 'jotai';
import {
  isOpenDialogCustomApikey,
  selectedNodeInfoAtom,
} from '../atoms/global';
import { Label } from '../styles/App-styles';
import { Spacer } from '../common/Spacer';
import { useTranslation } from 'react-i18next';

export function CustomNodeApikeyDialog() {
  const { validateApiKey, handleSaveNodeInfo, authenticate } = useAuth();
  const { t } = useTranslation(['node', 'core']);

  const [apikey, setApikey] = React.useState('');
  const [open, setOpen] = useAtom(isOpenDialogCustomApikey);
  const [selectedNode, setSelectedNode] = useAtom(selectedNodeInfoAtom);
  const [message, setMessage] = React.useState('');
  const setCustomNodes = (nodes) => {
    window.sendMessage('setCustomNodes', nodes).catch((error) => {
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

  React.useEffect(() => {
    if (selectedNode) {
      setApikey(selectedNode?.apikey || '');
    }
  }, [selectedNode]);

  const handleContinue = async () => {
    try {
      setMessage('');
      const payload = {
        url: selectedNode?.url,
        apikey,
      };
      const { isValid } = await validateApiKey(payload);
      if (isValid) {
        const customNodes = await getCustomNodes();
        const copyCustomNodes = [...customNodes];
        const findNode = copyCustomNodes.findIndex(
          (n) => n?.url === selectedNode?.url
        );
        if (findNode !== -1) {
          copyCustomNodes.splice(findNode, 1, payload);
          setCustomNodes(copyCustomNodes);
        }

        await handleSaveNodeInfo(payload);
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
    }
  };
  return (
    <Dialog
      open={open}
      fullWidth
      maxWidth="sm"
      aria-labelledby="core-setup-title"
    >
      <DialogTitle id="core-setup-title">
        {t('node:invalidKey.title', {
          postProcess: 'capitalizeFirstChar',
        })}
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body1" gutterBottom>
          {t('node:invalidKey.description', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
        <Spacer height="20px" />
        <Label>Node</Label>
        <TextField value={selectedNode?.url} disabled={true} />
        <Spacer height="20px" />
        <Label>apikey</Label>
        <TextField value={apikey} onChange={(e) => setApikey(e.target.value)} />
        <Spacer height="40px" />
        {message && <Typography>Error: {message}</Typography>}
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button onClick={() => setOpen(false)} variant="text">
          {t('core:action.close', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>

        <Button
          onClick={() => {
            handleContinue();
          }}
          color="success"
          variant="contained"
        >
          {t('node:actions.continue', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
