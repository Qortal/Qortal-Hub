import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';

export const DrawerComponent = ({ open, setOpen, children }) => {
  const toggleDrawer = (newOpen: boolean) => () => {
    setOpen(newOpen);
  };

  return (
    <div>
      <Drawer open={open} onClose={toggleDrawer(false)}>
        <Box sx={{ width: '400px', height: '100%' }} role="presentation">
          {children}
        </Box>
      </Drawer>
    </div>
  );
};
