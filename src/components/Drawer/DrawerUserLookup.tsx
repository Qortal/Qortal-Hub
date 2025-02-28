import * as React from 'react';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';

export const DrawerUserLookup = ({open, setOpen, children}) => {

  const toggleDrawer = (newOpen: boolean) => () => {
    setOpen(newOpen);
  };

 
  return (
    <div>
      <Drawer disableEnforceFocus hideBackdrop={true} open={open} onClose={toggleDrawer(false)}>
      <Box sx={{ width: '70vw', height: '100%', maxWidth: '1000px' }} role="presentation">
     
      {children}
    </Box>
      </Drawer>
    </div>
  );
}
