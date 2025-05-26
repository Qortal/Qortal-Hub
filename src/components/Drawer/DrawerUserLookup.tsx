import { useTheme } from '@mui/material';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';

export const DrawerUserLookup = ({ open, setOpen, children }) => {
  const toggleDrawer = (newOpen: boolean) => () => {
    setOpen(newOpen);
  };

  const theme = useTheme();

  return (
    <div>
      <Drawer
        disableEnforceFocus
        hideBackdrop={true}
        open={open}
        onClose={toggleDrawer(false)}
        sx={{ color: theme.palette.text.primary }}
      >
        <Box
          sx={{ width: '70vw', height: '100%', maxWidth: '1000px' }}
          role="presentation"
        >
          {children}
        </Box>
      </Drawer>
    </div>
  );
};
