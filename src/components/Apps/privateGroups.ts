type GroupWithPrivacy = {
  groupId?: number | string;
  isOpen?: boolean;
};

type GroupProperties = Record<
  string,
  {
    isOpen?: boolean;
  }
>;

export const filterPrivateGroups = <T extends GroupWithPrivacy>(
  groups: T[] | null | undefined,
  groupsProperties: GroupProperties | null | undefined
): T[] => {
  return (groups ?? []).filter((group) => {
    const cachedIsOpen =
      group.groupId == null
        ? undefined
        : groupsProperties?.[String(group.groupId)]?.isOpen;
    const isOpen =
      typeof group.isOpen === 'boolean' ? group.isOpen : cachedIsOpen;

    return isOpen === false;
  });
};
