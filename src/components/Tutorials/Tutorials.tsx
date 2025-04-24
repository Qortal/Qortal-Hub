import { useContext, useState } from 'react';
import { GlobalContext } from '../../App';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Tab,
  Tabs,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { VideoPlayer } from '../Embeds/VideoPlayer';
import { useTranslation } from 'react-i18next';

export const Tutorials = () => {
  const { openTutorialModal, setOpenTutorialModal } = useContext(GlobalContext);
  const [multiNumber, setMultiNumber] = useState(0);
  const theme = useTheme();
  const { t } = useTranslation(['core', 'tutorial']);

  const handleClose = () => {
    setOpenTutorialModal(null);
    setMultiNumber(0);
  };

  if (!openTutorialModal) return null;

  if (openTutorialModal?.multi) {
    const selectedTutorial = openTutorialModal?.multi[multiNumber];
    return (
      <Dialog
        onClose={handleClose}
        aria-labelledby="customized-dialog-title"
        open={!!openTutorialModal}
        fullWidth={true}
        maxWidth="xl"
      >
        <Tabs
          sx={{
            '& .MuiTabs-indicator': {
              backgroundColor: theme.palette.background.default,
            },
          }}
          value={multiNumber}
          onChange={(e, value) => setMultiNumber(value)}
          aria-label="basic tabs example"
        >
          {openTutorialModal?.multi?.map((item, index) => {
            return (
              <Tab
                sx={{
                  '&.Mui-selected': {
                    color: theme.palette.text.primary,
                  },
                }}
                label={item?.title}
                value={index}
              />
            );
          })}
        </Tabs>

        <DialogTitle sx={{ m: 0, p: 2 }}>{selectedTutorial?.title}</DialogTitle>

        <IconButton
          aria-label="close"
          onClick={handleClose}
          sx={{
            position: 'absolute',
            right: 8,
            top: 8,
            color: theme.palette.text.primary,
          }}
        >
          <CloseIcon />
        </IconButton>

        <DialogContent
          dividers
          sx={{
            height: '85vh',
          }}
        >
          <VideoPlayer
            node="https://ext-node.qortal.link"
            {...(selectedTutorial?.resource || {})}
          />
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={handleClose}>
            {t('core:action.close', { postProcess: 'capitalize' })}
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog
        onClose={handleClose}
        aria-labelledby="customized-dialog-title"
        open={!!openTutorialModal}
        fullWidth={true}
        maxWidth="xl"
      >
        <DialogTitle sx={{ m: 0, p: 2 }}>
          {openTutorialModal?.title} {` Tutorial`}
        </DialogTitle>

        <IconButton
          aria-label="close"
          onClick={handleClose}
          sx={{
            position: 'absolute',
            right: 8,
            top: 8,
            color: theme.palette.text.primary,
          }}
        >
          <CloseIcon />
        </IconButton>

        <DialogContent
          dividers
          sx={{
            height: '85vh',
          }}
        >
          <VideoPlayer
            node="https://ext-node.qortal.link"
            {...(openTutorialModal?.resource || {})}
          />
        </DialogContent>

        <DialogActions>
          <Button variant="contained" onClick={handleClose}>
            {t('core:action.close', { postProcess: 'capitalize' })}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
