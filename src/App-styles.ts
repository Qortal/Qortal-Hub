import {
  Typography,
  Box,
  TextField,
  InputLabel,
} from "@mui/material";
import { styled } from "@mui/system";

export const AppContainer = styled(Box)(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  flexDirection: "column",
  width: "100vw",
  height: "100vh",
  radius: "15px",
  overflow: 'hidden',
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

export const AddressBox = styled(Box)`
  display: flex;
  border: 1px solid var(--50-white, rgba(255, 255, 255, 0.5));
  justify-content: space-between;
  align-items: center;
  width: auto;
  height: 25px;
  padding: 5px 15px 5px 15px;
  gap: 5px;
  border-radius: 100px;
  font-family: Inter;
  font-size: 12px;
  font-weight: 600;
  line-height: 14.52px;
  text-align: left;
  color: var(--50-white, rgba(255, 255, 255, 0.5));
  cursor: pointer;
  transition: all 0.2s;
  &:hover {
    background-color: rgba(41, 41, 43, 1);
    color: white;
    svg path {
      fill: white; // Fill color changes to white on hover
    }
  }
`;

export const CustomButton = styled(Box)`
  /* Authenticate */

  box-sizing: border-box;

  padding: 15px 20px;
  gap: 10px;

  border: 0.5px solid rgba(255, 255, 255, 0.5);
  filter: drop-shadow(1px 4px 10.5px rgba(0, 0, 0, 0.3));
  border-radius: 5px;

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
<<<<<<< HEAD
      backgroundColor: bgColor || (theme.palette.mode === "dark" ? "rgba(41, 41, 43, 1)" : "rgba(230, 230, 230, 1)"),
      color: color || "#fff",
      svg: {
        path: {
          fill: color || "#fff",
=======
      backgroundColor: bgColor ? bgColor : "rgba(41, 41, 43, 1)", // fallback hover bg
      color: color || "white",
      svg: {
        path: {
          fill: color || "white",
>>>>>>> ffb39b3 (Bind color and background to selected theme)
        },
      },
    },
  })
);

<<<<<<< HEAD
export const CustomInput = styled(TextField)(({ theme }) => ({
=======
export const CustomInput = styled(TextField)({
>>>>>>> ffb39b3 (Bind color and background to selected theme)
  width: "183px", // Adjust the width as needed
  borderRadius: "5px",
  // backgroundColor: "rgba(30, 30, 32, 1)",
  outline: "none",
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
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
}));

<<<<<<< HEAD
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

=======
export const CustomLabel = styled(InputLabel)`
  font-weight: 400;
  font-family: Inter;
  font-size: 10px;
  line-height: 12px;
  color: rgba(255, 255, 255, 0.5);
`;
>>>>>>> ffb39b3 (Bind color and background to selected theme)
