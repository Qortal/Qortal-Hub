export type QuitterFeedSearchResource = {
  created: number;
  identifier: string;
  latestSignature: string;
  name: string;
  service: 'DOCUMENT';
  size: number;
  updated?: number;
};

export type QuitterFeedImageRef = {
  src: string;
};

export type QuitterFeedVideoRef = {
  identifier: string;
  mimeType?: string;
  name: string;
  service: 'DOCUMENT';
};

export type QuitterFeedDocument = {
  images?: QuitterFeedImageRef[];
  name: string;
  text: string;
  timestamp: number;
  videos?: QuitterFeedVideoRef[];
};

export type QuitterFeedItemImage = {
  alt: string;
  src: string;
};

export type QuitterFeedItem = {
  author: string;
  avatarUrl: string;
  hasVideo: boolean;
  id: string;
  identifier: string;
  images: QuitterFeedItemImage[];
  latestSignature: string;
  publishedAt: number;
  searchCreatedAt: number;
  service: 'DOCUMENT';
  text: string;
  updatedAt?: number;
};

export type FetchQuitterFeedOptions = {
  allowedAuthors?: string[];
  blockedAuthors?: string[];
  debugLabel?: string;
  excludeIds?: string[];
  itemLimit?: number;
  offset?: number;
  searchLimit?: number;
  signal?: AbortSignal;
};

export type QuitterFeedPage = {
  hasMore: boolean;
  items: QuitterFeedItem[];
  nextOffset: number;
};
