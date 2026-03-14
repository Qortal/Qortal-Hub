export interface VoteCount {
  optionName: string;
  voteCount: number;
}

export interface PollInfo {
  pollName: string;
  pollDescription: string;
  pollOptions: Array<{ optionName: string }>;
  owner: string;
  published: number;
}

export interface AppRatingData {
  averageRating: number;
  totalVotes: number;
  voteCounts: VoteCount[];
  hasPublishedRating: boolean;
  pollInfo: PollInfo | null;
  lastFetched: number;
}

export interface RatingsCacheStorage {
  version: number;
  ratings: Record<string, AppRatingData>;
}

/** Single entry returned by GET /polls/apps/ratings */
export interface BulkRatingEntry {
  pollName: string;
  service: string;
  appName: string;
  owner: string;
  published: number;
  description?: string;
  totalVotes: number;
  voteCounts: VoteCount[];
}

/** Full response shape of GET /polls/apps/ratings */
export interface BulkRatingsResponse {
  count: number;
  offset: number;
  ratings: Record<string, BulkRatingEntry>;
}
