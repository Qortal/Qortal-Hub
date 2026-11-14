/**
 * Ranking by rating has to take the number of votes into account: one 5-star
 * vote says less than fifty votes averaging 4.6. The score is a Bayesian
 * average, which pulls an app with few votes towards a neutral rating.
 */

/** The rating an app is assumed to have before anyone votes. */
const PRIOR_RATING = 3;
/** How many votes that assumption is worth. */
const PRIOR_VOTES = 3;

export type RatingSummary = {
  averageRating?: number | null;
  totalVotes?: number | null;
};

/** The weighted score of a rating, or null when there are no votes yet. */
export const weightedRatingScore = (
  rating: RatingSummary | null | undefined
): number | null => {
  const votes = Number(rating?.totalVotes ?? 0);
  if (!Number.isFinite(votes) || votes <= 0) return null;
  const average = Number(rating?.averageRating ?? 0);
  if (!Number.isFinite(average)) return null;
  return (average * votes + PRIOR_RATING * PRIOR_VOTES) / (votes + PRIOR_VOTES);
};

/**
 * Sort order for "best rated": the higher weighted score first, then the app
 * with more votes. Apps without votes come last and keep their order.
 */
export const compareByWeightedRating = (
  a: RatingSummary | null | undefined,
  b: RatingSummary | null | undefined
): number => {
  const scoreA = weightedRatingScore(a);
  const scoreB = weightedRatingScore(b);
  if (scoreA === null && scoreB === null) return 0;
  if (scoreA === null) return 1;
  if (scoreB === null) return -1;
  if (scoreA !== scoreB) return scoreB - scoreA;
  return Number(b?.totalVotes ?? 0) - Number(a?.totalVotes ?? 0);
};
