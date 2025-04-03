import { useThemeContext } from "./ThemeContext";
import { Switch } from "@mui/material";
import { Brightness4, Brightness7 } from "@mui/icons-material";

const ThemeSelector = ({ style }) => {
  const { themeMode, toggleTheme } = useThemeContext();

  return (
    <div
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1px", ...style }}
    >
      {themeMode === "dark" ? <Brightness7 /> : <Brightness4 />}
      <Switch checked={themeMode === "dark"} onChange={toggleTheme} />
    </div>
  );
};

export default ThemeSelector;
