/**
 * A QDN resource's identifier, for telling a name's resources apart. The
 * name's default resource has none, however it is written: missing, blank,
 * 'null' (as some tabs keep it) or 'default' (as Core calls it). Any other
 * identifier is kept exactly as it is.
 */
export const resourceIdentifierKey = (identifier: unknown): string => {
  if (typeof identifier !== 'string' || identifier.trim() === '') return '';
  return identifier === 'null' || identifier === 'default' ? '' : identifier;
};

/**
 * Whether two identifiers are the same resource of a name. A missing one is
 * the default resource, not any resource.
 */
export const isSameResourceIdentifier = (
  left: unknown,
  right: unknown
): boolean => resourceIdentifierKey(left) === resourceIdentifierKey(right);
