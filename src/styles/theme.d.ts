import '@mui/material/styles';

declare module '@mui/material/styles' {
  interface TypeBackground {
    surface: string;
    elevated: string;
  }
  interface Palette {
    border: {
      main: string;
      subtle: string;
    };
    other: {
      positive: string;
      danger: string;
      unread: string;
    };
  }
  interface PaletteOptions {
    border?: {
      main?: string;
      subtle?: string;
    };
    other?: {
      positive?: string;
      danger?: string;
      unread?: string;
    };
  }
}
