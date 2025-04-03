import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./messaging/messagesToBackground";
import { CssBaseline } from "@mui/material";
import { MessageQueueProvider } from "./MessageQueueContext.tsx";
import { RecoilRoot } from "recoil";
import { ThemeProvider } from "./components/Theme/ThemeContext.tsx";

// const darkTheme: ThemeOptions = {
//   palette: {
//     primary: {
//       main: "#232428", // Primary color (e.g., used for buttons, headers, etc.)
//     },
//     secondary: {
//       main: "#232428", // Secondary color
//     },
//     background: {
//       default: "#27282c", // Default background color
//       paper: "#1d1d1d", // Paper component background (for dropdowns, dialogs, etc.)
//     },
//     text: {
//       primary: "#ffffff", // White as the primary text color
//       secondary: "#b0b0b0", // Light gray for secondary text
//       disabled: "#808080", // Gray for disabled text
//     },
//     action: {
//       // disabledBackground: 'set color of background here',
//       disabled: "rgb(255 255 255 / 70%)",
//     },
//   },
//   typography: {
//     fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif', // Font family
//     h1: {
//       color: "#ffffff", // White color for h1 elements
//     },
//     h2: {
//       color: "#ffffff", // White color for h2 elements
//     },
//     body1: {
//       color: "#ffffff", // Default body text color
//     },
//     body2: {
//       color: "#b0b0b0", // Lighter text for body2, often used for secondary text
//     },
//   },
//   components: {
//     MuiOutlinedInput: {
//       styleOverrides: {
//         root: {
//           ".MuiOutlinedInput-notchedOutline": {
//             borderColor: "white", // ⚪ Default outline color
//           },
//         },
//       },
//     },
//     MuiSelect: {
//       styleOverrides: {
//         icon: {
//           color: "white", // ✅ Caret (dropdown arrow) color
//         },
//       },
//     },
//   },
// }

// const lightTheme: ThemeOptions = {
//   palette: {
//     primary: {
//       main: "#1976d2", // Primary color for buttons, headers, etc.
//     },
//     secondary: {
//       main: "#ff4081", // Secondary color with a vibrant pink touch
//     },
//     background: {
//       default: "#f5f5f5", // Light background color for the main UI
//       paper: "#ffffff", // Background color for Paper components (dialogs, dropdowns, etc.)
//     },
//     text: {
//       primary: "#212121", // Dark text for contrast and readability
//       secondary: "#616161", // Medium gray for secondary text
//       disabled: "#9e9e9e", // Light gray for disabled text
//     },
//     action: {
//       disabled: "rgb(0 0 0 / 50%)", // Color for disabled actions
//     },
//   },
//   typography: {
//     fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif', // Font family for consistency
//     h1: {
//       color: "#ffffff", // Dark color for main headings (h1)
//     },
//     h2: {
//       color: "#ffffff", // Dark color for subheadings (h2)
//     },
//     body1: {
//       color: "#ffffff", // Default body text color
//     },
//     body2: {
//       color: "#ffffff", // Lighter text for secondary content
//     },
//   },
//   components: {
//     MuiOutlinedInput: {
//       styleOverrides: {
//         root: {
//           ".MuiOutlinedInput-notchedOutline": {
//             borderColor: "#ffffff", // Darker outline for better input field visibility
//           },
//         },
//       },
//     },
//     MuiSelect: {
//       styleOverrides: {
//         icon: {
//           color: "#212121", // Dark dropdown arrow icon for contrast
//         },
//       },
//     },
//   },
// };

// const theme = createTheme(lightTheme);

// export default theme;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <>
    <ThemeProvider>
      <CssBaseline />
      <MessageQueueProvider>
        <RecoilRoot>
          <App />
        </RecoilRoot>
      </MessageQueueProvider>
    </ThemeProvider>
  </>
);
