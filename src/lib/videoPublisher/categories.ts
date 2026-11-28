/**
 * The categories each app lists videos under. Ids are the apps' own;
 * `i18nKey` is under `core:video_publisher.category.*` for the window, with
 * `defaultLabel` the app's English name.
 *
 * Sources: Q-Tube's src/constants/Categories.ts (deployed 2026-08-01, the
 * same ids as GitHub), Subscreen 1.1.3, Q-Share 2.1.0 (video, category 4).
 */

export type CategoryOption = {
  id: number;
  i18nKey: string;
  defaultLabel: string;
};

const option = (
  id: number,
  key: string,
  defaultLabel: string
): CategoryOption => ({
  id,
  i18nKey: `core:video_publisher.category.${key}`,
  defaultLabel,
});

export const QTUBE_CATEGORY_MOVIES = 1;
export const QTUBE_CATEGORY_SERIES = 2;

/** Q-Tube's categories (Torq's video dialog uses the same list). */
export const QTUBE_CATEGORIES: readonly CategoryOption[] = [
  option(1, 'movies', 'Movies'),
  option(2, 'series', 'Series'),
  option(3, 'music', 'Music'),
  option(4, 'education', 'Education'),
  option(5, 'lifestyle', 'Lifestyle'),
  option(6, 'gaming', 'Gaming'),
  option(7, 'technology', 'Technology'),
  option(8, 'sports', 'Sports'),
  option(9, 'news_politics', 'News & Politics'),
  option(10, 'cooking_food', 'Cooking & Food'),
  option(11, 'animation', 'Animation'),
  option(12, 'science', 'Science'),
  option(13, 'health_wellness', 'Health & Wellness'),
  option(14, 'diy_crafts', 'DIY & Crafts'),
  option(15, 'kids_family', 'Kids & Family'),
  option(16, 'comedy', 'Comedy'),
  option(17, 'travel_adventure', 'Travel & Adventure'),
  option(18, 'art_design', 'Art & Design'),
  option(19, 'nature_environment', 'Nature & Environment'),
  option(20, 'business_finance', 'Business & Finance'),
  option(21, 'personal_development', 'Personal Development'),
  option(22, 'religion', 'Religion'),
  option(23, 'history', 'History'),
  option(24, 'anime', 'Anime'),
  option(25, 'cartoons', 'Cartoons'),
  option(26, 'qortal', 'Qortal'),
  option(27, 'paranormal', 'Paranormal'),
  option(28, 'spirituality', 'Spirituality'),
  option(29, 'privacy', 'Privacy'),
  option(99, 'other', 'Other'),
];

/**
 * Film genres. Subscreen lists 116 as Other but reads 199 the same way, and
 * Q-Tube only knows 199, so Other is published as 199 (shown in both).
 */
export const FILM_GENRES: readonly CategoryOption[] = [
  option(101, 'film_action_adventure', 'Action & Adventure'),
  option(102, 'film_comedy', 'Comedy'),
  option(103, 'film_drama', 'Drama'),
  option(104, 'film_fantasy_scifi', 'Fantasy & Science Fiction'),
  option(105, 'film_horror_thriller', 'Horror & Thriller'),
  option(106, 'film_documentaries', 'Documentaries'),
  option(107, 'film_animated', 'Animated'),
  option(108, 'film_family_kids', 'Family & Kids'),
  option(109, 'film_romance', 'Romance'),
  option(110, 'film_mystery_crime', 'Mystery & Crime'),
  option(111, 'film_historical_war', 'Historical & War'),
  option(112, 'film_musicals', 'Musicals & Music Films'),
  option(113, 'film_indie', 'Indie Films'),
  option(114, 'film_international', 'International Films'),
  option(115, 'film_biographies', 'Biographies & True Stories'),
  option(199, 'film_other', 'Other'),
];

/** Series genres; Other is 299 for the same reason as films' 199. */
export const SERIES_GENRES: readonly CategoryOption[] = [
  option(201, 'series_dramas', 'Dramas'),
  option(202, 'series_comedies', 'Comedies'),
  option(203, 'series_reality', 'Reality & Competition'),
  option(204, 'series_documentaries', 'Documentaries & Docuseries'),
  option(205, 'series_scifi_fantasy', 'Sci-Fi & Fantasy'),
  option(206, 'series_crime_mystery', 'Crime & Mystery'),
  option(207, 'series_animated', 'Animated Series'),
  option(208, 'series_kids_family', 'Kids & Family'),
  option(209, 'series_historical', 'Historical & Period Pieces'),
  option(210, 'series_action_adventure', 'Action & Adventure'),
  option(211, 'series_horror_thriller', 'Horror & Thriller'),
  option(212, 'series_romance', 'Romance'),
  option(213, 'series_anthologies', 'Anthologies'),
  option(214, 'series_international', 'International Series'),
  option(215, 'series_miniseries', 'Miniseries'),
  option(299, 'series_other', 'Other'),
];

const EDUCATION_SUBCATEGORIES: readonly CategoryOption[] = [
  option(400, 'education_tutorial', 'Tutorial'),
  option(401, 'education_qortal', 'Qortal'),
  option(402, 'education_documentary', 'Documentary'),
  option(499, 'education_other', 'Other'),
];

const ANIME_SUBCATEGORIES: readonly CategoryOption[] = [
  option(2401, 'anime_kodomomuke', 'Kodomomuke'),
  option(2402, 'anime_shonen', 'Shonen'),
  option(2403, 'anime_shoujo', 'Shoujo'),
  option(2404, 'anime_seinen', 'Seinen'),
  option(2405, 'anime_josei', 'Josei'),
  option(2406, 'anime_mecha', 'Mecha'),
  option(2407, 'anime_mahou_shoujo', 'Mahou Shoujo'),
  option(2408, 'anime_isekai', 'Isekai'),
  option(2409, 'anime_yaoi', 'Yaoi'),
  option(2410, 'anime_yuri', 'Yuri'),
  option(2411, 'anime_harem', 'Harem'),
  option(2412, 'anime_ecchi', 'Ecchi'),
  option(2413, 'anime_idol', 'Idol'),
  option(2499, 'anime_other', 'Other'),
];

/** Q-Tube's subcategories, by category (only these four have any). */
export const QTUBE_SUBCATEGORIES: Readonly<
  Record<number, readonly CategoryOption[]>
> = {
  1: FILM_GENRES,
  2: SERIES_GENRES,
  4: EDUCATION_SUBCATEGORIES,
  24: ANIME_SUBCATEGORIES,
};

export const qtubeSubcategories = (
  category: number | null | undefined
): readonly CategoryOption[] =>
  (category != null && QTUBE_SUBCATEGORIES[category]) || [];

/** Q-Share's category for videos. */
export const QSHARE_VIDEO_CATEGORY = 4;

/** Q-Share's video subcategories (it has no 401–403 or 422). */
export const QSHARE_VIDEO_SUBCATEGORIES: readonly CategoryOption[] = [
  option(404, 'qshare_education', 'Education'),
  option(405, 'qshare_lifestyle', 'Lifestyle'),
  option(406, 'qshare_gaming', 'Gaming'),
  option(407, 'qshare_technology', 'Technology'),
  option(408, 'qshare_sports', 'Sports'),
  option(409, 'qshare_news_politics', 'News & Politics'),
  option(410, 'qshare_cooking_food', 'Cooking & Food'),
  option(411, 'qshare_animation', 'Animation'),
  option(412, 'qshare_science', 'Science'),
  option(413, 'qshare_health_wellness', 'Health & Wellness'),
  option(414, 'qshare_diy_crafts', 'DIY & Crafts'),
  option(415, 'qshare_kids_family', 'Kids & Family'),
  option(416, 'qshare_comedy', 'Comedy'),
  option(417, 'qshare_travel_adventure', 'Travel & Adventure'),
  option(418, 'qshare_art_design', 'Art & Design'),
  option(419, 'qshare_nature_environment', 'Nature & Environment'),
  option(420, 'qshare_business_finance', 'Business & Finance'),
  option(421, 'qshare_personal_development', 'Personal Development'),
  option(423, 'qshare_history', 'History'),
  option(499, 'qshare_other', 'Other'),
];

export const isQtubeCategory = (id: unknown): id is number =>
  QTUBE_CATEGORIES.some((entry) => entry.id === id);

export const isQtubeSubcategoryOf = (
  category: number,
  subcategory: unknown
): subcategory is number =>
  qtubeSubcategories(category).some((entry) => entry.id === subcategory);

export const isFilmGenre = (id: unknown): id is number =>
  FILM_GENRES.some((entry) => entry.id === id);

export const isSeriesGenre = (id: unknown): id is number =>
  SERIES_GENRES.some((entry) => entry.id === id);

export const isQshareVideoSubcategory = (id: unknown): id is number =>
  QSHARE_VIDEO_SUBCATEGORIES.some((entry) => entry.id === id);

/** Every option the window may show, for adding their translations. */
export const ALL_CATEGORY_OPTIONS: readonly CategoryOption[] = [
  ...QTUBE_CATEGORIES,
  ...FILM_GENRES,
  ...SERIES_GENRES,
  ...EDUCATION_SUBCATEGORIES,
  ...ANIME_SUBCATEGORIES,
  ...QSHARE_VIDEO_SUBCATEGORIES,
];
