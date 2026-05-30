import { Box, Typography } from '@mui/material';
import {
  dashboardPanelSx,
  handleDashboardPanelPointerLeave,
  handleDashboardPanelPointerMove,
  useDashboardPanelMouseLight,
} from '../dashboardPanelEffects';

export const DashboardUtilityPanel = ({
  title,
  children,
  theme,
  sx = undefined,
  titleSx = undefined,
  panelBoxRef = undefined,
}) => {
  const panelRef = useDashboardPanelMouseLight<HTMLDivElement>();
  const assignPanelNode = (node) => {
    panelRef.current = node;

    if (typeof panelBoxRef === 'function') {
      panelBoxRef(node);
      return;
    }

    if (panelBoxRef) {
      panelBoxRef.current = node;
    }
  };

  return (
    <Box
      ref={assignPanelNode}
      sx={{
        ...dashboardPanelSx(theme, 'utility'),
        borderRadius: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '14px 16px',
        width: '100%',
        ...sx,
      }}
      onMouseMove={handleDashboardPanelPointerMove}
      onMouseLeave={handleDashboardPanelPointerLeave}
    >
      <Typography
        sx={{
          color: theme.palette.text.primary,
          fontSize: '1rem',
          fontWeight: 600,
          ...titleSx,
        }}
      >
        {title}
      </Typography>
      {children}
    </Box>
  );
};
