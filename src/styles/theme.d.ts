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
      /** The gold of a node that mints (the Qortal logo's ring). */
      minting: string;
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
      minting?: string;
    };
  }
}
