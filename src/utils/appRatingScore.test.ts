import { describe, expect, it } from 'vitest';
import { compareByWeightedRating, weightedRatingScore } from './appRatingScore';

describe('weightedRatingScore', () => {
  it('has no score without votes', () => {
    expect(weightedRatingScore(null)).toBeNull();
    expect(weightedRatingScore({})).toBeNull();
    expect(weightedRatingScore({ averageRating: 5, totalVotes: 0 })).toBeNull();
  });

  it('pulls a rating with few votes towards the middle', () => {
    const oneVote = weightedRatingScore({ averageRating: 5, totalVotes: 1 });
    const manyVotes = weightedRatingScore({
      averageRating: 5,
      totalVotes: 200,
    });
    expect(oneVote).toBeCloseTo(3.5);
    expect(manyVotes).toBeGreaterThan(4.9);
    expect(manyVotes).toBeLessThan(5);
  });

  it('ignores values that are not numbers', () => {
    expect(
      weightedRatingScore({ averageRating: Number.NaN, totalVotes: 4 })
    ).toBeNull();
  });
});

describe('compareByWeightedRating', () => {
  const sort = (
    ratings: { id: string; averageRating: number; totalVotes: number }[]
  ) => [...ratings].sort(compareByWeightedRating).map((rating) => rating.id);

  it('puts many good votes above a single perfect vote', () => {
    expect(
      sort([
        { id: 'one-perfect-vote', averageRating: 5, totalVotes: 1 },
        { id: 'many-good-votes', averageRating: 4.6, totalVotes: 50 },
      ])
    ).toEqual(['many-good-votes', 'one-perfect-vote']);
  });

  it('puts apps without votes last, in the order they came', () => {
    expect(
      sort([
        { id: 'unrated-1', averageRating: 0, totalVotes: 0 },
        { id: 'rated-low', averageRating: 1, totalVotes: 2 },
        { id: 'unrated-2', averageRating: 0, totalVotes: 0 },
      ])
    ).toEqual(['rated-low', 'unrated-1', 'unrated-2']);
  });

  it('breaks a tie with the number of votes', () => {
    expect(
      sort([
        { id: 'three-votes', averageRating: 3, totalVotes: 3 },
        { id: 'nine-votes', averageRating: 3, totalVotes: 9 },
      ])
    ).toEqual(['nine-votes', 'three-votes']);
  });
});
