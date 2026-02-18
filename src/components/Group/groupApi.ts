import {
  getArbitraryEndpointReact,
  getBaseApiReact,
} from '../../App';
import {
  requestQueueAdminMemberNames,
  requestQueueMemberNames,
} from './groupQueues';

export async function getNameInfo(address: string): Promise<string> {
  const response = await fetch(
    `${getBaseApiReact()}/names/primary/` + address
  );
  const nameData = await response.json();

  if (nameData?.name) {
    return nameData.name;
  }
  return '';
}

export const getPublishesFromAdmins = async (
  admins: string[],
  groupId: string
): Promise<Record<string, unknown> | false> => {
  const queryString = admins.map((name) => `name=${name}`).join('&');
  const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=DOCUMENT_PRIVATE&identifier=symmetric-qchat-group-${groupId}&exactmatchnames=true&limit=0&reverse=true&${queryString}&prefix=true`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error('network error');
  }
  const adminData = await response.json();

  const filterId = adminData.filter(
    (data: { identifier?: string }) =>
      data.identifier === `symmetric-qchat-group-${groupId}`
  );

  if (filterId?.length === 0) {
    return false;
  }

  const sortedData = filterId.sort(
    (
      a: { updated?: string; created?: string },
      b: { updated?: string; created?: string }
    ) => {
      const dateA = a.updated ? new Date(a.updated) : new Date(a.created);
      const dateB = b.updated ? new Date(b.updated) : new Date(b.created);
      return dateB.getTime() - dateA.getTime();
    }
  );

  return sortedData[0];
};

export const getAllPublishesFromAdmins = async (
  admins: string[],
  groupId: string
): Promise<Record<string, unknown>[]> => {
  const queryString = admins.map((name) => `name=${name}`).join('&');
  const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=DOCUMENT_PRIVATE&identifier=symmetric-qchat-group-${groupId}&exactmatchnames=true&limit=0&reverse=true&${queryString}&prefix=true`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error('network error');
  }
  const adminData = await response.json();

  const filterId = adminData.filter(
    (data: { identifier?: string }) =>
      data.identifier === `symmetric-qchat-group-${groupId}`
  );

  if (filterId?.length === 0) {
    return [];
  }

  const sortedData = filterId.sort(
    (
      a: { updated?: string; created?: string },
      b: { updated?: string; created?: string }
    ) => {
      const dateA = a.updated ? new Date(a.updated) : new Date(a.created);
      const dateB = b.updated ? new Date(b.updated) : new Date(b.created);
      return dateB.getTime() - dateA.getTime();
    }
  );

  return sortedData;
};

export const getGroupAdminsAddress = async (
  groupNumber: number
): Promise<string[]> => {
  const response = await fetch(
    `${getBaseApiReact()}/groups/members/${groupNumber}?limit=0&onlyAdmins=true`
  );
  const groupData = await response.json();
  const members: string[] = [];
  if (groupData && Array.isArray(groupData?.members)) {
    for (const member of groupData.members) {
      if (member.member) {
        members.push(member.member);
      }
    }
  }
  return members;
};

export const getGroupMembers = async (groupNumber: number): Promise<{
  members?: { member: string }[];
  memberCount?: number;
  [key: string]: unknown;
}> => {
  const response = await fetch(
    `${getBaseApiReact()}/groups/members/${groupNumber}?limit=0`
  );
  const groupData = await response.json();
  return groupData;
};

export const getGroupAdmins = async (
  groupNumber: number
): Promise<{
  names: string[];
  addresses: string[];
  both: { name: string; address: string }[];
}> => {
  const response = await fetch(
    `${getBaseApiReact()}/groups/members/${groupNumber}?limit=0&onlyAdmins=true`
  );
  const groupData = await response.json();
  const members: string[] = [];
  const membersAddresses: string[] = [];
  const both: { name: string; address: string }[] = [];

  const getMemNames = groupData?.members?.map(async (member: { member?: string }) => {
    if (member?.member) {
      const name = await requestQueueAdminMemberNames.enqueue(() =>
        getNameInfo(member.member as string)
      );
      if (name) {
        members.push(name);
        both.push({ name, address: member.member });
      }
      membersAddresses.push(member.member);
    }
    return true;
  });
  await Promise.all(getMemNames || []);

  return { names: members, addresses: membersAddresses, both };
};

export const getNames = async (
  listOfMembers: { member: string }[]
): Promise<{ member: string; name: string }[]> => {
  const members: { member: string; name: string }[] = [];

  const getMemNames = listOfMembers.map(async (member) => {
    if (member.member) {
      const name = await requestQueueMemberNames.enqueue(() =>
        getNameInfo(member.member)
      );
      if (name) {
        members.push({ ...member, name });
      } else {
        members.push({ ...member, name: '' });
      }
    }
    return true;
  });

  await Promise.all(getMemNames);

  return members;
};

export const getNamesForAdmins = async (
  admins: string[] | undefined
): Promise<{ address: string; name: string }[]> => {
  const members: { address: string; name: string }[] = [];

  const getMemNames = admins?.map(async (admin) => {
    if (admin) {
      const name = await requestQueueAdminMemberNames.enqueue(() =>
        getNameInfo(admin)
      );
      if (name) {
        members.push({ address: admin, name });
      }
    }
    return true;
  });
  await Promise.all(getMemNames || []);

  return members;
};
