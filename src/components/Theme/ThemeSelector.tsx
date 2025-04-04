import { useThemeContext } from "./ThemeContext";
import { Switch } from "@mui/material";
import LightModeIcon from '@mui/icons-material/LightMode';
import NightlightIcon from '@mui/icons-material/Nightlight';

const ThemeSelector = ({ style }) => {
  const { themeMode, toggleTheme } = useThemeContext();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "1px",
        ...style,
      }}
    >
      {themeMode === "light" ? <LightModeIcon /> : <NightlightIcon />}
      <Switch checked={themeMode === "light"} onChange={toggleTheme} />
    </div>
  );
};

export default ThemeSelector;
