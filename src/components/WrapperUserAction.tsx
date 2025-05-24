import { useCallback, useContext, useEffect, useState } from 'react';
import {
  Popover,
  Button,
  Box,
  CircularProgress,
  useTheme,
} from '@mui/material';
import { executeEvent } from '../utils/events';
import { QORTAL_APP_CONTEXT } from '../App';
import { useAtom } from 'jotai';
import { isRunningPublicNodeAtom } from '../atoms/global';
import { useTranslation } from 'react-i18next';

export const WrapperUserAction = ({ children, address, name, disabled }) => {
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const [isRunningPublicNode] = useAtom(isRunningPublicNodeAtom);

  const [anchorEl, setAnchorEl] = useState(null);

  // Handle child element click to open Popover
  const handleChildClick = (event) => {
    event.stopPropagation(); // Prevent parent onClick from firing
    setAnchorEl(event.currentTarget);
  };

  // Handle closing the Popover
  const handleClose = useCallback(() => {
    setAnchorEl(null);
  }, []);

  // Determine if the popover is open
  const open = Boolean(anchorEl);
  const id = open ? address || name : undefined;

  if (disabled) {
    return children;
  }

  return (
    <>
      <Box
        onClick={handleChildClick} // Open popover on click
        sx={{
          alignItems: 'center',
          alignSelf: 'flex-start', // Prevent stretching to parent height
          cursor: 'pointer',
          display: 'inline-flex', // Keep inline behavior
          height: 'fit-content', // Limit height to content size
          justifyContent: 'center',
          maxHeight: '100%', // Prevent flex shrink behavior in a flex container
          maxWidth: '100%', // Optional: Limit the width to avoid overflow
          padding: 0,
          width: 'fit-content', // Limit width to content size
        }}
      >
        {/* Render the child without altering dimensions */}
        {children}
      </Box>

      {/* Popover */}
      {open && (
        <Popover
          id={id}
          open={open}
          anchorEl={anchorEl}
          onClose={handleClose} // Close popover on click outside
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'center',
          }}
          transformOrigin={{
            vertical: 'top',
            horizontal: 'center',
          }}
          componentsProps={{
            paper: {
              onClick: (event) => event.stopPropagation(), // Stop propagation inside popover
            },
          }}
        >
          <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {/* Option 1: Message */}
            <Button
              variant="text"
              onClick={() => {
                handleClose();
                setTimeout(() => {
                  executeEvent('openDirectMessageInternal', {
                    address,
                    name,
                  });
                }, 200);
              }}
              sx={{
                color: theme.palette.text.primary,
                justifyContent: 'flex-start',
              }}
            >
              {t('core:message.message', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>

            {/* Option 2: Send QORT */}
            <Button
              variant="text"
              onClick={() => {
                executeEvent('openPaymentInternal', {
                  address,
                  name,
                });
                handleClose();
              }}
              sx={{
                color: theme.palette.text.primary,
                justifyContent: 'flex-start',
              }}
            >
              {t('core:action.send_qort', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>

            <Button
              variant="text"
              onClick={() => {
                navigator.clipboard.writeText(address || '');
                handleClose();
              }}
              sx={{
                color: theme.palette.text.primary,
                justifyContent: 'flex-start',
              }}
            >
              {t('auth:action.copy_address', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>

            <Button
              variant="text"
              onClick={() => {
                executeEvent('openUserLookupDrawer', {
                  addressOrName: name || address,
                });
                handleClose();
              }}
              sx={{
                color: theme.palette.text.primary,
                justifyContent: 'flex-start',
              }}
            >
              {t('core:user_lookup', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>

            {!isRunningPublicNode && (
              <BlockUser
                handleClose={handleClose}
                address={address}
                name={name}
              />
            )}
          </Box>
        </Popover>
      )}
    </>
  );
};

const BlockUser = ({ address, name, handleClose }) => {
  const [isAlreadyBlocked, setIsAlreadyBlocked] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const { isUserBlocked, addToBlockList, removeBlockFromList } =
    useContext(QORTAL_APP_CONTEXT);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  useEffect(() => {
    if (!address) return;
    setIsAlreadyBlocked(isUserBlocked(address, name));
  }, [address, setIsAlreadyBlocked, isUserBlocked, name]);

  return (
    <Button
      variant="text"
      onClick={async () => {
        try {
          setIsLoading(true);
          executeEvent('blockUserFromOutside', {
            user: address,
          });
        } catch (error) {
          console.error(error);
        } finally {
          setIsLoading(false);
          handleClose();
        }
      }}
      sx={{
        color: theme.palette.text.primary,
        gap: '10px',
        justifyContent: 'flex-start',
      }}
    >
      {(isAlreadyBlocked === null || isLoading) && (
        <CircularProgress color="secondary" size={24} />
      )}
      {isAlreadyBlocked &&
        t('auth:action.unblock_name', { postProcess: 'capitalizeFirstChar' })}
      {isAlreadyBlocked === false &&
        t('auth:action.block_name', { postProcess: 'capitalizeFirstChar' })}
    </Button>
  );
};
