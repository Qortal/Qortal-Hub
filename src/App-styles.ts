import { Typography, Box, TextField, InputLabel } from "@mui/material";
import { styled } from "@mui/system";

export const AppContainer = styled(Box)(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  flexDirection: "column",
  width: "100vw",
  background: "rgba(39, 40, 44, 1)",
  height: "100vh",
  radius: "15px",
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AuthenticatedContainer = styled(Box)(({ theme }) => ({
  display: "flex",
  width: "100%",
  height: "100%",
  justifyContent: "space-between",
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AuthenticatedContainerInnerLeft = styled(Box)(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  flexDirection: "column",
  height: "100%",
  width: "100%",
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AuthenticatedContainerInnerRight = styled(Box)(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  flexDirection: "column",
  width: "60px",
  height: "100%",
  background: "rgba(0, 0, 0, 0.1)",
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AuthenticatedContainerInnerTop = styled(Box)(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-start",
  width: "100%px",
  height: "60px",
  background: "rgba(0, 0, 0, 0.1)",
  padding: "20px",
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const TextP = styled(Typography)(({ theme }) => ({
  fontSize: "13px",
  fontWeight: 600,
  fontFamily: "Inter",
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const TextItalic = styled("span")(({ theme }) => ({
  fontSize: "13px",
  fontWeight: 600,
  fontFamily: "Inter",
  fontStyle: "italic",
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const TextSpan = styled("span")(({ theme }) => ({
  fontSize: "13px",
  fontFamily: "Inter",
  fontWeight: 800,
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AddressBox = styled(Box)(({ theme }) => ({
  display: "flex",
  border: `1px solid ${
    theme.palette.mode === "dark"
      ? "rgba(255, 255, 255, 0.5)"
      : "rgba(0, 0, 0, 0.3)"
  }`,
  justifyContent: "space-between",
  alignItems: "center",
  width: "auto",
  height: "25px",
  padding: "5px 15px",
  gap: "5px",
  borderRadius: "100px",
  fontFamily: "Inter",
  fontSize: "12px",
  fontWeight: 600,
  lineHeight: "14.52px",
  textAlign: "left",
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  cursor: "pointer",
  transition: "all 0.2s",

  "&:hover": {
    backgroundColor:
      theme.palette.mode === "dark"
        ? "rgba(41, 41, 43, 1)"
        : "rgba(240, 240, 240, 1)",
    color: theme.palette.mode === "dark" ? "#fff" : "#000",

    "svg path": {
      fill: theme.palette.mode === "dark" ? "#fff" : "#000",
    },
  },
}));

export const CustomButton = styled(Box)(({ theme }) => ({
  boxSizing: "border-box",
  padding: "15px 20px",
  gap: "10px",

  border: `0.5px solid ${
    theme.palette.mode === "dark"
      ? "rgba(255, 255, 255, 0.5)"
      : "rgba(0, 0, 0, 0.3)"
  }`,
  filter: "drop-shadow(1px 4px 10.5px rgba(0, 0, 0, 0.3))",
  borderRadius: "5px",

  display: "inline-flex",
  justifyContent: "center",
  alignItems: "center",

  width: "fit-content",
  minWidth: "160px",
  cursor: "pointer",
  transition: "all 0.2s",

  fontWeight: 600,
  fontFamily: "Inter",
  textAlign: "center",
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,

  "&:hover": {
    backgroundColor:
      theme.palette.mode === "dark"
        ? "rgba(41, 41, 43, 1)"
        : "rgba(230, 230, 230, 1)",
    color: "#fff",

    "svg path": {
      fill: "#fff",
    },
  },
}));

interface CustomButtonProps {
  bgColor?: string;
  color?: string;
}

export const CustomButtonAccept = styled(Box)<CustomButtonProps>(
  ({ bgColor, color, theme }) => ({
    boxSizing: "border-box",
    padding: "15px 20px",
    gap: "10px",
    border: `0.5px solid ${
      theme.palette.mode === "dark"
        ? "rgba(255, 255, 255, 0.5)"
        : "rgba(0, 0, 0, 0.3)"
    }`,
    filter: "drop-shadow(1px 4px 10.5px rgba(0,0,0,0.3))",
    borderRadius: 5,
    display: "inline-flex",
    justifyContent: "center",
    alignItems: "center",
    width: "fit-content",
    transition: "all 0.2s",
    minWidth: 160,
    cursor: "pointer",
    fontWeight: 600,
    fontFamily: "Inter",
    textAlign: "center",
    opacity: 0.7,

    // Color and backgroundColor with fallbacks
    backgroundColor: bgColor || (theme.palette.mode === "dark" ? "#1d1d1d" : "#f5f5f5"),
    color: color || (theme.palette.mode === "dark" ? "#fff" : "#000"),

    "&:hover": {
      opacity: 1,
      backgroundColor: bgColor || (theme.palette.mode === "dark" ? "rgba(41, 41, 43, 1)" : "rgba(230, 230, 230, 1)"),
      color: color || "#fff",
      svg: {
        path: {
          fill: color || "#fff",
        },
      },
    },
  })
);

export const CustomInput = styled(TextField)({
  width: "183px", // Adjust the width as needed
  borderRadius: "5px",
  // backgroundColor: "rgba(30, 30, 32, 1)",
  outline: "none",
  input: {
    fontSize: 10,
    fontFamily: "Inter",
    fontWeight: 400,
    color: "white",
    "&::placeholder": {
      fontSize: 16,
      color: "rgba(255, 255, 255, 0.2)",
    },
    outline: "none",
    padding: "10px",
  },
  "& .MuiOutlinedInput-root": {
    "& fieldset": {
      border: "0.5px solid rgba(255, 255, 255, 0.5)",
    },
    "&:hover fieldset": {
      border: "0.5px solid rgba(255, 255, 255, 0.5)",
    },
    "&.Mui-focused fieldset": {
      border: "0.5px solid rgba(255, 255, 255, 0.5)",
    },
  },
  "& .MuiInput-underline:before": {
    borderBottom: "none",
  },
  "& .MuiInput-underline:hover:not(.Mui-disabled):before": {
    borderBottom: "none",
  },
  "& .MuiInput-underline:after": {
    borderBottom: "none",
  },
});

export const CustomLabel = styled(InputLabel)(({ theme }) => ({
  fontWeight: 400,
  fontFamily: "Inter",
  fontSize: "10px",
  lineHeight: "12px",
  color:
    theme.palette.mode === "dark"
      ? "rgba(255, 255, 255, 0.5)"
      : "rgba(0, 0, 0, 0.5)",
}));

