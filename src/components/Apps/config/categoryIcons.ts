// Category Icon Mapping
// Maps category IDs to emoji icons for visual display

export const categoryIcons: Record<string, string> = {
  all: '🌐',
  art: '🎨',
  automotive: '🚗',
  beauty: '💄',
  blockchain: '⛓️',
  business: '💼',
  communication: '💬',
  communications: '📡',
  crypto: '₿',
  culture: '🎭',
  dating: '❤️',
  design: '🎨',
  development: '👨‍💻',
  education: '📚',
  entertainment: '🎬',
  events: '📅',
  fashion: '👠',
  finance: '💰',
  food: '🍕',
  games: '🎮',
  geography: '🌎',
  health: '⚕️',
  history: '🏛️',
  home: '🏠',
  language: '💬',
  lifestyle: '🌟',
  manufactoring: '🏭',
  music: '🎵',
  news: '📰',
  other: '📦',
  pets: '🐕',
  philosophy: '🤔',
  photography: '📷',
  politics: '🗳️',
  productivity: '📊',
  psychology: '🧠',
  science: '🔬',
  security: '🔒',
  shopping: '🛒',
  social: '📱',
  software: '💻',
  spirituality: '🧘',
  sports: '⚽',
  storytelling: '📖',
  technology: '💻',
  tools: '🔧',
  travel: '✈️',
  utilities: '⚙️',
  video: '🎥',
  weather: '🌤️',
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
