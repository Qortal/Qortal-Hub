import type { MouseEvent, ReactNode } from 'react';

export type InfoPreviewStatusTone = 'operational' | 'syncing' | 'issue';

export type InfoPreviewPrimaryRow = {
  label: string;
  emphasize?: boolean;
  value?: string;
  valueNode?: ReactNode;
  variant?: 'pill';
  pillTone?: 'negative' | 'warning' | 'positive';
};

export type InfoPreviewMetricItem = {
  label: string;
  value: string;
  accent?: string;
};

export type InfoPreviewFooterRow = {
  label: string;
  value?: string;
  valueNode?: ReactNode;
  labelAction?: {
    ariaLabel: string;
    isOpen: boolean;
    onClick: (event: MouseEvent<HTMLButtonElement>) => void;
    tooltip: string;
  };
};

export type InfoPreviewFooterSection = {
  title: string;
  /** Stable section semantics (title is localized and must not be used for branching). */
  variant?: 'node';
  offsetTopPx?: number;
  items: InfoPreviewFooterRow[];
};

export type InfoPreviewPanelRows = {
  status: {
    tone: InfoPreviewStatusTone;
    isOperational?: boolean;
    label?: string;
  };
  primaryItems: InfoPreviewPrimaryRow[];
  metricItems: InfoPreviewMetricItem[];
  footerSections: InfoPreviewFooterSection[];
};
