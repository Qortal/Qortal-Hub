import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyPendingVote,
  fetchPollInfo,
  initialRating,
  isPendingVoteConfirmed,
  ratingPollName,
  ratingsByAddress,
  summarizeVoteCounts,
  summaryFromVoters,
  voterOf,
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

  it("counts each voter's latest vote and the creator's first rating", () => {
    const summary = summaryFromVoters([
      { address: 'QOwner', rating: 5, isInitial: true },
      { address: 'QOwner', rating: 1, isInitial: false },
      { address: 'QB', rating: 4, isInitial: false },
      { address: 'QA', rating: 2, isInitial: false },
    ]);
    expect(summary.total).toBe(4);
    expect(summary.average).toBeCloseTo(12 / 4);
    expect(summaryFromVoters([]).total).toBe(0);
  });

  it('counts as the library does when the creator rates again', () => {
    // The poll was created with 5 stars, its creator then voted 1, and
    // someone else voted 3: the library's card says 3.0 from 3 ratings.
    const page = summaryFromVoters(
      votersFromPoll(
        poll,
        [
          { optionIndex: 0, voterPublicKey: 'Owner' },
          { optionIndex: 2, voterPublicKey: 'A' },
        ],
        addressOf
      )
    );
    const library = summarizeVoteCounts([
      { optionName: '1', voteCount: 1 },
      { optionName: '2', voteCount: 0 },
      { optionName: '3', voteCount: 1 },
      { optionName: '4', voteCount: 0 },
      { optionName: '5', voteCount: 0 },
      { optionName: 'initialValue-5', voteCount: 0 },
    ]);
    expect(page).toEqual(library);
    expect(page.total).toBe(3);
    expect(page.average).toBeCloseTo(3);
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

  it("keeps the creator's first rating beside their later vote", () => {
    const voters = votersFromPoll(
      poll,
      [{ optionIndex: 2, voterPublicKey: 'Owner' }],
      addressOf
    );
    expect(voters).toEqual([
      { address: 'QOwner', rating: 5, isInitial: true },
      { address: 'QOwner', rating: 3, isInitial: false },
    ]);
  });

  it("finds someone's rating: their latest vote, or else their first", () => {
    const voted = votersFromPoll(
      poll,
      [{ optionIndex: 2, voterPublicKey: 'Owner' }],
      addressOf
    );
    expect(voterOf(voted, 'QOwner')).toEqual({
      address: 'QOwner',
      rating: 3,
      isInitial: false,
    });
    expect(voterOf(votersFromPoll(poll, [], addressOf), 'QOwner')).toEqual({
      address: 'QOwner',
      rating: 5,
      isInitial: true,
    });
    expect(voterOf(voted, 'QNobody')).toBeNull();
    expect(voterOf(voted, undefined)).toBeNull();
  });

  it("gives each person's stars: their vote, or else their first rating", () => {
    // Created with 1 star, then voted 5; the rows come highest first.
    const voters = votersFromPoll(
      {
        creatorPublicKey: 'Owner',
        pollOptions: [...options.slice(0, 5), { optionName: 'initialValue-1' }],
      },
      [
        { optionIndex: 4, voterPublicKey: 'Owner' },
        { optionIndex: 2, voterPublicKey: 'A' },
      ],
      addressOf
    );
    expect(ratingsByAddress(voters)).toEqual(
      new Map([
        ['QOwner', 5],
        ['QA', 3],
      ])
    );
    expect(ratingsByAddress([...voters].reverse()).get('QOwner')).toBe(5);
    expect(
      ratingsByAddress(votersFromPoll(poll, [], addressOf)).get('QOwner')
    ).toBe(5);
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

  it("keeps the creator's first rating when they vote again", () => {
    const next = applyPendingVote(
      summary,
      { ...sent, rating: 3 },
      {
        address: 'QMe',
        rating: 5,
        isInitial: true,
      }
    );
    expect(next.counts).toMatchObject({ 3: 3, 5: 1 });
    expect(next.total).toBe(4);
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

describe('reading the rating poll', () => {
  const answer = (status: number, body: unknown) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
      })
    );
  const read = () => fetchPollInfo('http://node', 'APP', 'Q-Blog');

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gives the poll the node has', async () => {
    answer(200, { pollName: 'app-library-APP-rating-Q-Blog' });
    await expect(read()).resolves.toMatchObject({
      pollName: 'app-library-APP-rating-Q-Blog',
    });
  });

  it('says there is none only when the node says so', async () => {
    // Core's answer for a poll it doesn't have.
    answer(404, { error: 501, message: '!!en:ApiError.POLL_NO_EXISTS!!' });
    await expect(read()).resolves.toBeNull();
  });

  it("throws when the poll couldn't be read, so no vote creates it", async () => {
    answer(500, { error: 1, message: 'unknown error' });
    await expect(read()).rejects.toThrow();
    answer(404, '<html>Not found</html>');
    await expect(read()).rejects.toThrow();
    answer(200, { message: 'not a poll' });
    await expect(read()).rejects.toThrow();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('Failed to fetch')
    );
    await expect(read()).rejects.toThrow('Failed to fetch');
  });
});
