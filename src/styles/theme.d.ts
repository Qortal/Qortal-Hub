import '@mui/material/styles';

declare module '@mui/material/styles' {
  interface TypeBackground {
    surface: string;
  }
  interface Palette {
    border: {
      main: string;
      subtle: string;
    };
  }
  interface PaletteOptions {
    border?: {
      main?: string;
      subtle?: string;
    };
  }
}
