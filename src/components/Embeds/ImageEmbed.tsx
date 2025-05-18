import { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Box,
  ButtonBase,
  Divider,
  Dialog,
  IconButton,
  useTheme,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { CustomLoader } from '../../common/CustomLoader';
import ImageIcon from '@mui/icons-material/Image';
import CloseIcon from '@mui/icons-material/Close';
import { decodeIfEncoded } from '../../utils/decode';
import { useTranslation } from 'react-i18next';

export const ImageCard = ({
  image,
  fetchImage,
  owner,
  refresh,
  openExternal,
  external,
  isLoadingParent,
  errorMsg,
  encryptionType,
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core', 'group']);
  const [isOpen, setIsOpen] = useState(true);
  const [height, setHeight] = useState('400px');

  useEffect(() => {
    if (isOpen) {
      fetchImage();
    }
  }, [isOpen]);

  return (
    <Card
      sx={{
        backgroundColor: theme.palette.background.default,
        height: height,
        transition: 'height 0.6s ease-in-out',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 16px 0px 16px',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <ImageIcon
            sx={{
              color: theme.palette.text.primary,
            }}
          />
          <Typography>
            {t('core:image_embed', { postProcess: 'capitalizeFirstWord' })}
          </Typography>
        </Box>

        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: '10px',
          }}
        >
          <ButtonBase>
            <RefreshIcon
              onClick={refresh}
              sx={{
                fontSize: '24px',
                color: theme.palette.text.primary,
              }}
            />
          </ButtonBase>

          {external && (
            <ButtonBase>
              <OpenInNewIcon
                onClick={openExternal}
                sx={{
                  fontSize: '24px',
                  color: theme.palette.text.primary,
                }}
              />
            </ButtonBase>
          )}
        </Box>
      </Box>

      <Box
        sx={{
          padding: '8px 16px 8px 16px',
        }}
      >
        <Typography
          sx={{
            fontSize: '12px',
          }}
        >
          {t('core:message.error.created_by', {
            owner: decodeIfEncoded(owner),
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>

        <Typography
          sx={{
            fontSize: '12px',
          }}
        >
          {encryptionType === 'private'
            ? t('core:message.generic.encrypted', {
                postProcess: 'capitalizeAll',
              })
            : encryptionType === 'group'
              ? t('group:message.generic.group_encrypted', {
                  postProcess: 'capitalizeAll',
                })
              : t('core:message.generic.encrypted_not', {
                  postProcess: 'capitalizeFirstChar',
                })}
        </Typography>
      </Box>

      <Divider sx={{ borderColor: 'rgb(255 255 255 / 10%)' }} />

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
        }}
      >
        {isLoadingParent && isOpen && (
          <Box
            sx={{
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <CustomLoader />
          </Box>
        )}

        {errorMsg && (
          <Box
            sx={{
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            {' '}
            <Typography
              sx={{
                fontSize: '14px',
                color: theme.palette.other.danger,
              }}
            >
              {errorMsg}
            </Typography>
          </Box>
        )}
      </Box>

      <Box>
        <CardContent>
          <ImageViewer src={image} />
        </CardContent>
      </Box>
    </Card>
  );
};

export function ImageViewer({ src, alt = '' }) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleOpenFullscreen = () => setIsFullscreen(true);
  const handleCloseFullscreen = () => setIsFullscreen(false);
  const theme = useTheme();
  return (
    <>
      {/* Image in container */}
      <Box
        sx={{
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'center',
          maxWidth: '100%', // Prevent horizontal overflow
        }}
        onClick={handleOpenFullscreen}
      >
        <img
          src={src}
          alt={alt}
          style={{
            maxWidth: '100%',
            maxHeight: '450px', // Adjust max height for small containers
            objectFit: 'contain', // Preserve aspect ratio
          }}
        />
      </Box>

      {/* Fullscreen Viewer */}
      <Dialog
        open={isFullscreen}
        onClose={handleCloseFullscreen}
        maxWidth="lg"
        fullWidth
        fullScreen
        sx={{
          '& .MuiDialog-paper': {
            margin: 0,
            maxWidth: '100%',
            width: '100%',
            height: '100vh',
            overflow: 'hidden', // Prevent scrollbars
          },
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            backgroundColor: theme.palette.background.paper, // Optional: dark background for fullscreen mode
            display: 'flex',
            height: '100%',
            justifyContent: 'center',
            position: 'relative',
            width: '100%',
          }}
        >
          {/* Close Button */}
          <IconButton
            onClick={handleCloseFullscreen}
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              zIndex: 10,
              color: theme.palette.text.primary,
            }}
          >
            <CloseIcon />
          </IconButton>

          {/* Fullscreen Image */}
          <img
            src={src}
            alt={alt}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain', // Preserve aspect ratio
            }}
          />
        </Box>
      </Dialog>
    </>
  );
}
