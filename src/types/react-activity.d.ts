import type { ReactNode } from 'react';

/** React 19.2+ `<Activity />` — types not yet in @types/react at our pinned version. */
declare module 'react' {
  export const Activity: (props: {
    mode: 'visible' | 'hidden';
    children?: ReactNode;
  }) => ReactNode;
}
