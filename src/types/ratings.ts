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
