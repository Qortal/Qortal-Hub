import { describe, expect, it } from 'vitest';
import {
  applyPendingVote,
  initialRating,
  isPendingVoteConfirmed,
  ratingName,
  ratingPollName,
  ratingWithPendingVote,
  summarizeVoteCounts,
  summaryFromVoters,
  votersFromPoll,
} from './appVotes';

const options = [
  { optionName: '1' },
  { optionName: '2' },
  { optionName: '3' },
  { optionName: '4' },
  { optionName: '5' },
  { optionName: 'initialValue-5' },
];
// The creator's key gives 'QOwner'; `owner` is whatever the creator named.
const poll = { creatorPublicKey: 'Owner', pollOptions: options };
const addressOf = (publicKey: string) => `Q${publicKey}`;

describe('rating polls', () => {
  it('uses the library poll name', () => {
    expect(ratingPollName('app', 'Q-Blog')).toBe(
      'app-library-APP-rating-Q-Blog'
    );
  });

  it("names a widget's poll after its identifier, as Q-Git names a repository's", () => {
    expect(ratingName('Q-Weather', 'go-widget-now')).toBe(
      'Q-Weather-id-go-widget-now'
    );
    expect(ratingPollName('APP', 'Q-Weather', 'go-widget-now')).toBe(
      'app-library-APP-rating-Q-Weather-id-go-widget-now'
    );
    // A widget that is its name's default APP is the app: one poll.
    expect(ratingPollName('APP', 'GO Clock', null)).toBe(
      'app-library-APP-rating-GO Clock'
    );
    expect(ratingPollName('APP', 'GO Clock', 'default')).toBe(
      'app-library-APP-rating-GO Clock'
    );
    expect(ratingName('GO Clock', '')).toBe('GO Clock');
  });

  it("reads the creator's rating from the poll's options", () => {
    expect(initialRating(options)).toBe(5);
    expect(initialRating(options.slice(0, 5))).toBeNull();
    expect(initialRating([{ optionName: 'initialValue-9' }])).toBeNull();
  });

  it('counts like the library cards: votes plus the initial rating', () => {
    const summary = summarizeVoteCounts([
      { optionName: 'initialValue-5', voteCount: 0 },
      { optionName: '1', voteCount: 1 },
      { optionName: '4', voteCount: 2 },
      { optionName: '5', voteCount: 0 },
      { optionName: 'nonsense', voteCount: 9 },
    ]);
    expect(summary.counts).toEqual({ 1: 1, 2: 0, 3: 0, 4: 2, 5: 1 });
    expect(summary.total).toBe(4);
    expect(summary.average).toBeCloseTo((1 + 8 + 5) / 4);
    expect(summarizeVoteCounts([]).average).toBe(0);
  });

  it('counts each person once, by their latest vote', () => {
    const summary = summaryFromVoters([
      { address: 'QOwner', rating: 5, isInitial: false },
      { address: 'QB', rating: 4, isInitial: false },
      { address: 'QA', rating: 2, isInitial: false },
    ]);
    expect(summary.total).toBe(3);
    expect(summary.average).toBeCloseTo(11 / 3);
    expect(summaryFromVoters([]).total).toBe(0);
  });

  it('lists who voted what, one row each, highest first', () => {
    const voters = votersFromPoll(
      poll,
      [
        { optionIndex: 0, voterPublicKey: 'A' },
        { optionIndex: 3, voterPublicKey: 'B' },
        { optionIndex: 1, voterPublicKey: 'A' },
        { optionIndex: 9, voterPublicKey: 'C' },
        { optionIndex: 5, voterPublicKey: 'D' },
      ],
      addressOf
    );
    expect(voters).toEqual([
      { address: 'QOwner', rating: 5, isInitial: true },
      { address: 'QB', rating: 4, isInitial: false },
      { address: 'QA', rating: 2, isInitial: false },
    ]);
  });

  it("shows the creator's later vote instead of their initial rating", () => {
    const voters = votersFromPoll(
      poll,
      [{ optionIndex: 2, voterPublicKey: 'Owner' }],
      addressOf
    );
    expect(voters).toEqual([
      { address: 'QOwner', rating: 3, isInitial: false },
    ]);
  });

  it('skips votes whose voter cannot be read', () => {
    expect(
      votersFromPoll(
        { creatorPublicKey: 'x', pollOptions: options },
        [{ optionIndex: 1, voterPublicKey: 'x' }],
        () => null
      )
    ).toEqual([]);
  });

  it('credits the first rating to the creator, not to the named owner', () => {
    const named = {
      creatorPublicKey: 'Mallory',
      owner: 'QPublisher',
      pollOptions: [...options.slice(0, 5), { optionName: 'initialValue-1' }],
    };
    expect(votersFromPoll(named, [], addressOf)).toEqual([
      { address: 'QMallory', rating: 1, isInitial: true },
    ]);
    // Naming someone who voted doesn't drop the creator's own rating.
    expect(
      votersFromPoll(
        named,
        [{ optionIndex: 4, voterPublicKey: 'Publisher' }],
        addressOf
      )
    ).toEqual([
      { address: 'QPublisher', rating: 5, isInitial: false },
      { address: 'QMallory', rating: 1, isInitial: true },
    ]);
  });

  it('gives nobody the first rating when the creator is unknown', () => {
    expect(
      votersFromPoll({ owner: 'QOwner', pollOptions: options } as any, [])
    ).toEqual([]);
  });
});

describe('a vote waiting for its block', () => {
  const summary = summarizeVoteCounts([
    { optionName: '3', voteCount: 2 },
    { optionName: '5', voteCount: 1 },
  ]);
  const sent = { voter: 'QMe', rating: 5, createdPoll: false, sentAt: 1 };

  it('adds a first vote at once', () => {
    const next = applyPendingVote(summary, sent, null);
    expect(next.counts[5]).toBe(2);
    expect(next.total).toBe(4);
  });

  it('moves a changed vote from the old star to the new one', () => {
    const next = applyPendingVote(summary, sent, {
      address: 'QMe',
      rating: 3,
      isInitial: false,
    });
    expect(next.counts).toMatchObject({ 3: 1, 5: 2 });
    expect(next.total).toBe(3);
  });

  it("replaces the creator's first rating with their vote", () => {
    const next = applyPendingVote(
      summary,
      { ...sent, rating: 3 },
      {
        address: 'QMe',
        rating: 5,
        isInitial: true,
      }
    );
    expect(next.counts).toMatchObject({ 3: 3, 5: 0 });
  });

  it('changes nothing once the node shows the vote', () => {
    const mine = { address: 'QMe', rating: 5, isInitial: false };
    expect(isPendingVoteConfirmed(sent, mine)).toBe(true);
    expect(applyPendingVote(summary, sent, mine)).toBe(summary);
  });

  it('counts a new poll as confirmed when its creator rating shows', () => {
    const created = { voter: 'QMe', rating: 4, createdPoll: true, sentAt: 1 };
    expect(
      isPendingVoteConfirmed(created, {
        address: 'QMe',
        rating: 4,
        isInitial: true,
      })
    ).toBe(true);
    expect(
      isPendingVoteConfirmed(sent, {
        address: 'QMe',
        rating: 5,
        isInitial: true,
      })
    ).toBe(false);
  });
});

describe('ratingWithPendingVote (the library, before the block)', () => {
  const stored = (voteCounts: Array<[string, number]>) => ({
    averageRating: 0,
    totalVotes: 0,
    voteCounts: voteCounts.map(([optionName, voteCount]) => ({
      optionName,
      voteCount,
    })),
    hasPublishedRating: true,
    pollInfo: null,
    lastFetched: 7,
  });
  const sent = (rating: number, extra = {}) => ({
    voter: 'QMe',
    rating,
    createdPoll: false,
    sentAt: 1,
    name: 'Q-Weather-id-go-widget-now',
    service: 'APP',
    ...extra,
  });

  it('shows a first rating at once, until the store has the poll', () => {
    expect(
      ratingWithPendingVote(null, sent(5, { createdPoll: true }))
    ).toMatchObject({
      averageRating: 5,
      totalVotes: 1,
      hasPublishedRating: true,
    });
    // The poll is in: its first rating is counted already.
    const inStore = stored([['initialValue-5', 0]]);
    expect(ratingWithPendingVote(inStore, sent(5, { createdPoll: true }))).toBe(
      inStore
    );
  });

  it('adds a vote, or moves the voter’s earlier one, as the cards count', () => {
    // The creator's 5, and a 3: 4.0 from 2.
    const data = stored([
      ['initialValue-5', 0],
      ['3', 1],
      ['5', 0],
    ]);
    expect(ratingWithPendingVote(data, sent(5))).toMatchObject({
      averageRating: 13 / 3,
      totalVotes: 3,
    });
    // The one who gave 3 now gives 5.
    expect(ratingWithPendingVote(data, sent(5, { replaces: 3 }))).toMatchObject(
      { averageRating: 5, totalVotes: 2 }
    );
    // An option the node didn't list yet.
    expect(
      ratingWithPendingVote(stored([['initialValue-4', 0]]), sent(2))
    ).toMatchObject({ averageRating: 3, totalVotes: 2 });
  });

  it("leaves what it can't count as it is", () => {
    const unknown = { ...stored([]), hasPublishedRating: false };
    // A vote on a poll the store hasn't fetched yet.
    expect(ratingWithPendingVote(unknown, sent(5))).toBe(unknown);
    expect(ratingWithPendingVote(null, sent(5))).toBeNull();
    expect(ratingWithPendingVote(unknown, sent(9))).toBe(unknown);
  });
});
