import { NODE_SELECTION_EXPLICIT_KEY } from '../constants/constants';

export const isNodeSelectionExplicit = (): boolean => {
  if (typeof localStorage === 'undefined') {
    return false;
  }
  return localStorage.getItem(NODE_SELECTION_EXPLICIT_KEY) === 'true';
};

export const markNodeSelectionExplicit = (): void => {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(NODE_SELECTION_EXPLICIT_KEY, 'true');
};
