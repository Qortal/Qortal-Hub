export type Status =
  | 'BLOCKED'
  | 'BUILD_FAILED'
  | 'BUILDING'
  | 'DOWNLOADED'
  | 'DOWNLOADING'
  | 'FAILED_TO_DOWNLOAD'
  | 'INITIAL'
  | 'MISSING_DATA'
  | 'NOT_PUBLISHED'
  | 'PUBLISHED'
  | 'READY'
  | 'REFETCHING'
  | 'SEARCHING'
  | 'UNSUPPORTED';

export interface PeerDetail {
  id: string;
  speed: 'HIGH' | 'LOW' | 'IDLE';
  isDirect: boolean;
}

export interface ResourceStatus {
  status: Status;
  localChunkCount: number;
  totalChunkCount: number;
  percentLoaded: number;
  path?: string;
  filename?: string;
  numberOfPeers?: number;
  peers?: PeerDetail[];
  estimatedTimeRemaining?: number; // in seconds
  isFetching?: boolean;
}

export interface GlobalDownloadEntry {
  interval: ReturnType<typeof setInterval> | null;
  timeout: ReturnType<typeof setTimeout> | null;
  retryTimeout: ReturnType<typeof setTimeout> | null;
}
