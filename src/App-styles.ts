import {
  AppBar,
  Button,
  Toolbar,
  Typography,
  Box,
  TextField,
  InputLabel,
} from "@mui/material";
import { styled } from "@mui/system";

export const AppContainer = styled(Box)(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  flexDirection: 'column',
  width: "100vw",
  background: "rgba(39, 40, 44, 1)",
  height: "100vh",
  radius: "15px"
}));
export const AuthenticatedContainer = styled(Box)(({ theme }) => ({
  display: "flex",
  width: "100%",
  height: "100%",
  justifyContent: "space-between"
}));
export const AuthenticatedContainerInnerLeft = styled(Box)(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  flexDirection: 'column',
  height: "100%",
  width: "100%"
}));
export const AuthenticatedContainerInnerRight = styled(Box)(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  flexDirection: 'column',
  width: "60px",
  height: "100%",
  background: "rgba(0, 0, 0, 0.1)"

}));
export const AuthenticatedContainerInnerTop = styled(Box)(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-start",
  width: "100%px",
  height: "60px",
  background: "rgba(0, 0, 0, 0.1)",
  padding: '20px'
}));

export const TextP = styled(Typography)(({ theme }) => ({
  fontSize: "13px",
  fontWeight: 600,
  fontFamily: "Inter",
  color: "white"
}));

export const TextItalic = styled("span")(({ theme }) => ({
  fontSize: "13px",
  fontWeight: 600,
  fontFamily: "Inter",
  color: "white",
  fontStyle: "italic"
}));

export const TextSpan = styled("span")(({ theme }) => ({
  fontSize: "13px",
  fontFamily: "Inter",
  fontWeight: 800,
  color: "white"
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

`

export const CustomButton = styled(Box)`

/* Authenticate */

box-sizing: border-box;

padding: 15px 20px;
gap: 10px;


border: 0.5px solid rgba(255, 255, 255, 0.5);
filter: drop-shadow(1px 4px 10.5px rgba(0, 0, 0, 0.3));
border-radius: 5px;

  display: inline-flex;

  justify-content: center;
  align-items: center;

  width: fit-content;
  transition: all 0.2s;
  color: black;
  min-width: 160px;
  cursor: pointer;
  font-weight: 600;
  font-family: Inter;
  color: white;
  text-align: center;
  &:hover {
    background-color: rgba(41, 41, 43, 1);
    color: white;
    svg path {
      fill: white; // Fill color changes to white on hover
    }
  }
`;


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
      border: '0.5px solid rgba(255, 255, 255, 0.5)',
    },
    "&:hover fieldset": {
     border: '0.5px solid rgba(255, 255, 255, 0.5)',
    },
    "&.Mui-focused fieldset": {
     border: '0.5px solid rgba(255, 255, 255, 0.5)',
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

export const CustomLabel = styled(InputLabel)`
  font-weight: 400;
  font-family: Inter;
  font-size: 10px;
  line-height: 12px;
  color: rgba(255, 255, 255, 0.5);

`