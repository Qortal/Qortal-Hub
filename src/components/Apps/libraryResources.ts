/**
 * The library lists each name's own app and website: the resource without an
 * identifier. Core usually leaves the identifier out of its search results for
 * those, but its search cache returns "default" for every entry it updated
 * since it was last refilled (every 30 minutes by default): one just published
 * through this node, and also a new or updated app that arrived from the
 * network. Both mean the name's own app, so it shows in the library at once.
 */

type WithIdentifier = { identifier?: string | null };

export const isNamesOwnResource = (
  resource: WithIdentifier | null | undefined
): boolean =>
  !!resource && (!resource.identifier || resource.identifier === 'default');

/** The names' own resources, each without the "default" identifier. */
export const namesOwnResources = <T extends WithIdentifier>(
  resources: T[] | null | undefined
): T[] =>
  (Array.isArray(resources) ? resources : [])
    .filter(isNamesOwnResource)
    .map((resource) => {
      if (resource.identifier !== 'default') return resource;
      const { identifier: _default, ...rest } = resource;
      return rest as T;
    });
