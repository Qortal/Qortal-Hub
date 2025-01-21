import React, { useState } from 'react';
import { Popover, Button, Box } from '@mui/material';
import { executeEvent } from '../utils/events';

export const WrapperUserAction = ({ children, address, name, disabled }) => {
  const [anchorEl, setAnchorEl] = useState(null);

  // Handle child element click to open Popover
  const handleChildClick = (event) => {
    event.stopPropagation(); // Prevent parent onClick from firing
    setAnchorEl(event.currentTarget);
  };

  // Handle closing the Popover
  const handleClose = () => {
    setAnchorEl(null);
  };

  // Determine if the popover is open
  const open = Boolean(anchorEl);
  const id = open ? address || name : undefined;

  if(disabled){
    return children
  }

  return (
    <>
      <Box
        onClick={handleChildClick} // Open popover on click
        sx={{
          display: 'inline-flex', // Keep inline behavior
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
          width: 'fit-content', // Limit width to content size
          height: 'fit-content', // Limit height to content size
          alignSelf: 'flex-start', // Prevent stretching to parent height
          maxWidth: '100%', // Optional: Limit the width to avoid overflow
          maxHeight: '100%', // Prevent flex shrink behavior in a flex container
        }}
      >
        {/* Render the child without altering dimensions */}
        {children}
      </Box>

      {/* Popover */}
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
                color: 'white',
                justifyContent: 'flex-start'
            }}
          >
            Message
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
                color: 'white',
                justifyContent: 'flex-start'
            }}
          >
            Send QORT
          </Button>
          <Button
            variant="text"
            onClick={() => {
              navigator.clipboard.writeText(address|| "");
              handleClose();
             
            }}
            sx={{
                color: 'white',
                justifyContent: 'flex-start'
            }}
          >
            Copy address
          </Button>
        </Box>
      </Popover>
    </>
  );
};
