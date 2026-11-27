export const RETICULUM_GROUP_ORDER_STORAGE_KEY =
  'qortal_reticulum_group_order_v1';

const RETICULUM_GROUP_ORDER_EVENT = 'qortal-reticulum-group-order-change';

const RETICULUM_AVATAR_PALETTE = [
  '#7dd3fc',
  '#86efac',
  '#f9a8d4',
  '#c4b5fd',
  '#fcd34d',
  '#fdba74',
  '#a7f3d0',
  '#93c5fd',
  '#f0abfc',
  '#fca5a5',
];

export const readReticulumGroupOrder = (): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(RETICULUM_GROUP_ORDER_STORAGE_KEY) || '[]'
    );
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

export const orderReticulumGroups = <T extends { groupId?: unknown }>(
  groups: T[],
  manualOrder: string[]
): T[] => {
  const orderIndex = new Map(
    manualOrder.map((groupId, index) => [String(groupId), index])
  );
  return [...groups].sort((a, b) => {
    const aIndex = orderIndex.get(String(a?.groupId));
    const bIndex = orderIndex.get(String(b?.groupId));
    if (aIndex != null && bIndex != null) return aIndex - bIndex;
    if (aIndex != null) return -1;
    if (bIndex != null) return 1;
    return 0;
  });
};

export const persistReticulumGroupOrder = (nextOrder: string[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    RETICULUM_GROUP_ORDER_STORAGE_KEY,
    JSON.stringify(nextOrder)
  );
  window.dispatchEvent(
    new CustomEvent(RETICULUM_GROUP_ORDER_EVENT, { detail: nextOrder })
  );
};

export const subscribeToReticulumGroupOrder = (
  listener: (nextOrder: string[]) => void
) => {
  if (typeof window === 'undefined') return () => undefined;
  const handleOrderChange = (event: Event) => {
    const nextOrder = (event as CustomEvent<unknown>).detail;
    listener(
      Array.isArray(nextOrder)
        ? nextOrder.map(String)
        : readReticulumGroupOrder()
    );
  };
  window.addEventListener(RETICULUM_GROUP_ORDER_EVENT, handleOrderChange);
  return () =>
    window.removeEventListener(RETICULUM_GROUP_ORDER_EVENT, handleOrderChange);
};

export const getReticulumGroupAvatarColor = (value?: string | number) => {
  const key = String(value || 'group');
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash =
      (hash * 31 + key.charCodeAt(index)) % RETICULUM_AVATAR_PALETTE.length;
  }
  return RETICULUM_AVATAR_PALETTE[
    Math.abs(hash) % RETICULUM_AVATAR_PALETTE.length
  ];
};
