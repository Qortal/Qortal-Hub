import { useEffect, useRef, useState } from 'react';
import { getBaseApiReact } from '../App';
import { base64ToUint8Array } from '../qdn/encryption/group-encryption';
import {
  buildSubscriptionIdentifiers,
  getSubscriptionIdForGroup,
  type SubscriptionGroupItem,
} from './useSubscriptionsFromGroups';

export type ManagedSubscriptionActions = {
  groupId: number;
  pendingJoinRequests: number;
  needsReEncryption: boolean;
  totalActions: number;
};

export type ManagedSubscriptionEntry = {
  group: SubscriptionGroupItem;
  groupId: number;
  actions: ManagedSubscriptionActions;
  url: string;
};

export async function getGroupMembers(groupNumber: number) {
  const response = await fetch(
    `${getBaseApiReact()}/groups/members/${groupNumber}?limit=0`
  );
  return response.json();
}

export async function getGroupAdmins(groupNumber: number) {
  const response = await fetch(
    `${getBaseApiReact()}/groups/members/${groupNumber}?limit=0&onlyAdmins=true`
  );
  const groupData = await response.json();
  const names: string[] = [];

  for (const member of groupData?.members ?? []) {
    if (member?.member && member?.primaryName) {
      names.push(member.primaryName);
    }
  }

  return { names };
}

export function useManagedSubscriptionsFromGroups(
  address: string | undefined,
  name: string | undefined,
  groups: SubscriptionGroupItem[]
) {
  const [managedSubscriptions, setManagedSubscriptions] = useState<
    ManagedSubscriptionEntry[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnce = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!address || !name || !Array.isArray(groups) || groups.length === 0) {
        setManagedSubscriptions([]);
        setLoading(false);
        return;
      }

      if (!hasLoadedOnce.current) setLoading(true);
      setError(null);

      try {
        const results = await Promise.all(
          groups
            .filter((group) => group.owner === address)
            .map(async (group): Promise<ManagedSubscriptionEntry | null> => {
              try {
                const subscriptionId = getSubscriptionIdForGroup(group.groupId);
                const { detailsIdentifier, indexIdentifier } =
                  await buildSubscriptionIdentifiers(subscriptionId);
                const baseIdentifierPrefix = indexIdentifier.replace(
                  /-v\d+$/,
                  ''
                );

                const matchesResponse = await fetch(
                  `${getBaseApiReact()}/arbitrary/resources/search?mode=ALL&service=DOCUMENT&identifier=${baseIdentifierPrefix}&exactmatchnames=true&limit=1&prefix=true&reverse=true&name=${name}`
                );
                if (!matchesResponse.ok) return null;
                const matches = await matchesResponse.json();
                const latestIdentifier = matches?.[0]?.identifier;
                if (!latestIdentifier || !/-v\d+$/.test(latestIdentifier)) {
                  return null;
                }

                let validJoinRequestCount = 0;
                const joinResponse = await fetch(
                  `${getBaseApiReact()}/groups/joinrequests/${group.groupId}`
                );
                if (joinResponse.ok) {
                  const joinRequests = await joinResponse.json();
                  const validations = await Promise.all(
                    (Array.isArray(joinRequests) ? joinRequests : []).map(
                      async (request) => {
                        try {
                          const nameResponse = await fetch(
                            `${getBaseApiReact()}/names/primary/${request.joiner}`
                          );
                          if (!nameResponse.ok) return false;
                          const primaryName = (await nameResponse.json())?.name;
                          if (!primaryName) return false;

                          const resourceResponse = await fetch(
                            `${getBaseApiReact()}/arbitrary/resources/search?mode=ALL&service=PRODUCT&identifier=${detailsIdentifier}&exactmatchnames=true&limit=1&prefix=true&reverse=true&name=${primaryName}`
                          );
                          const resources = await resourceResponse.json();
                          return resourceResponse.ok && resources.length > 0;
                        } catch {
                          return false;
                        }
                      }
                    )
                  );
                  validJoinRequestCount = validations.filter(Boolean).length;
                }

                let needsReEncryption = false;
                try {
                  const memberData = await getGroupMembers(group.groupId);
                  const { names: adminNames } = await getGroupAdmins(
                    group.groupId
                  );

                  if (adminNames.length > 0) {
                    const queryString = adminNames
                      .map(
                        (adminName) => `name=${encodeURIComponent(adminName)}`
                      )
                      .join('&');
                    const resourcesResponse = await fetch(
                      `${getBaseApiReact()}/arbitrary/resources/search?mode=ALL&service=DOCUMENT_PRIVATE&identifier=symmetric-qchat-group-${group.groupId}&exactmatchnames=true&limit=0&reverse=true&${queryString}&prefix=true`
                    );

                    if (!resourcesResponse.ok) {
                      needsReEncryption = true;
                    } else {
                      const resources = await resourcesResponse.json();
                      const matchingResources = resources.filter(
                        (resource: any) =>
                          resource.identifier ===
                          `symmetric-qchat-group-${group.groupId}`
                      );

                      if (!matchingResources.length) {
                        needsReEncryption = true;
                      } else {
                        const latestResource = matchingResources.sort(
                          (left: any, right: any) => {
                            const leftDate = left.updated
                              ? new Date(left.updated)
                              : new Date(left.created);
                            const rightDate = right.updated
                              ? new Date(right.updated)
                              : new Date(right.created);
                            return rightDate.getTime() - leftDate.getTime();
                          }
                        )[0];

                        const encryptedResponse = await fetch(
                          `${getBaseApiReact()}/arbitrary/DOCUMENT_PRIVATE/${latestResource.name}/${latestResource.identifier}?encoding=base64`
                        );
                        const encryptedData = await encryptedResponse.text();
                        const combined = base64ToUint8Array(encryptedData);
                        const countStart = combined.length - 4;
                        const countArray = combined.slice(
                          countStart,
                          countStart + 4
                        );
                        const count = new Uint32Array(countArray.buffer)[0];

                        if (count !== memberData?.memberCount) {
                          needsReEncryption = true;
                        }
                      }
                    }
                  }
                } catch {
                  // Network failures should not create false positive actions.
                }

                const actions = {
                  groupId: group.groupId,
                  pendingJoinRequests: validJoinRequestCount,
                  needsReEncryption,
                  totalActions:
                    validJoinRequestCount + (needsReEncryption ? 1 : 0),
                };

                return {
                  group,
                  groupId: group.groupId,
                  actions,
                  url: `manage/${group.groupId}`,
                };
              } catch {
                return null;
              }
            })
        );

        if (!cancelled) {
          setManagedSubscriptions(
            results.filter(Boolean) as ManagedSubscriptionEntry[]
          );
          hasLoadedOnce.current = true;
        }
      } catch (event: any) {
        if (!cancelled) {
          setError(event?.message ?? 'Failed to load managed subscriptions');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [address, name, groups]);

  return { managedSubscriptions, loading, error };
}
