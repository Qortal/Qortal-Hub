export const capitalizeAll = {
  type: 'postProcessor',
  name: 'capitalizeAll',
  process: (value: string) => value.toUpperCase(),
};

export const capitalizeFirst = {
  type: 'postProcessor',
  name: 'capitalizeFirst',
  process: (value: string) => value.charAt(0).toUpperCase() + value.slice(1),
};
