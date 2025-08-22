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
  isOpenDialogResetApikey,
  selectedNodeInfoAtom,
} from '../atoms/global';
import { Label } from '../styles/App-styles';
import { Spacer } from '../common/Spacer';

export function CustomNodeApikeyDialog() {
  const { validateApiKey, handleSaveNodeInfo, authenticate } = useAuth();
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
        console.log('findNode', findNode);
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
      setMessage('Invalid apikey');
      console.log('isValid', isValid);
    } catch (error) {}
  };
  return (
    <Dialog
      open={open}
      fullWidth
      maxWidth="sm"
      aria-labelledby="core-setup-title"
    >
      <DialogTitle id="core-setup-title">Invalid apikey</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body1" gutterBottom>
          Your apikey is invalid for this node. Please insert the valid apikey.
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
          close
        </Button>

        <Button
          onClick={() => {
            handleContinue();
          }}
          color="success"
          variant="contained"
        >
          Continue
        </Button>
      </DialogActions>
    </Dialog>
  );
}
