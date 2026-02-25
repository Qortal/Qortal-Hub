/**
 * Validates that an object has the shape of a group secret key:
 * keys are numeric strings, values are objects with non-empty string messageKey.
 */
export function validateSecretKey(obj: unknown): boolean {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  for (const key in obj as Record<string, unknown>) {
    if (!/^\d+$/.test(key)) {
      return false;
    }

    const value = (obj as Record<string, unknown>)[key];

    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const v = value as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(v, 'messageKey')) {
      return false;
    }

    if (
      typeof v.messageKey !== 'string' ||
      (v.messageKey as string).trim() === ''
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Returns true if two arrays contain the same elements (order-independent).
 */
export function areKeysEqual(
  array1: unknown[] | undefined,
  array2: unknown[] | undefined
): boolean {
  if (array1?.length !== array2?.length) {
    return false;
  }

  const sortedArray1 = [...array1].sort();
  const sortedArray2 = [...array2].sort();

  return sortedArray1.every((key, index) => key === sortedArray2[index]);
}
