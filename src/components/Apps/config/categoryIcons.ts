// Category Icon Mapping
// Maps category IDs to emoji icons for visual display

export const categoryIcons: Record<string, string> = {
  // Entertainment
  games: '🎮',
  entertainment: '🎬',
  music: '🎵',
  sports: '⚽',

  // Productivity
  productivity: '📊',
  tools: '🔧',
  utilities: '⚙️',
  education: '📚',

  // Social & Communication
  social: '📱',
  communication: '💬',
  news: '📰',

  // Commerce & Finance
  finance: '💰',
  shopping: '🛒',
  business: '💼',

  // Media
  photography: '📷',
  video: '🎥',
  art: '🎨',

  // Lifestyle
  lifestyle: '🌟',
  health: '❤️',
  food: '🍕',
  travel: '✈️',
  weather: '🌤️',

  // Technology
  technology: '💻',
  development: '👨‍💻',
  security: '🔒',
  blockchain: '⛓️',
  crypto: '₿',

  // Special
  all: '🌐',
  other: '📦',
};

/**
 * Get the emoji icon for a category
 * @param categoryId - The category ID to look up
 * @returns The emoji icon, or a default icon if not found
 */
export const getCategoryIcon = (categoryId: string): string => {
  if (!categoryId) return categoryIcons.other;
  const lowerCaseId = categoryId.toLowerCase();
  return categoryIcons[lowerCaseId] || categoryIcons.other;
};

/**
 * Get all available category icons
 * @returns Record of category ID to icon
 */
export const getAllCategoryIcons = (): Record<string, string> => {
  return { ...categoryIcons };
};
