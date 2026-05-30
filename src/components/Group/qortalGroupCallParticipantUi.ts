import { getBaseApiReactForAvatar } from '../../App';

export function shortAddr(addr: string): string {
  if (!addr || addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function initialsFromDisplayLabel(label: string, address: string): string {
  const compact = label.replace(/[^a-zA-Z0-9]/g, '');
  if (compact.length >= 2) return compact.slice(0, 2).toUpperCase();
  return address.slice(0, 2).toUpperCase();
}

export function addrHue(addr: string): string {
  let h = 0;
  for (let i = 0; i < addr.length; i++) {
    h = (h * 31 + addr.charCodeAt(i)) & 0xffff;
  }
  return `hsl(${h % 360}, 58%, 46%)`;
}

export function registeredNameForAvatar(
  address: string,
  isSelf: boolean,
  memberPrimaryNames: Record<string, string>,
  selfRegisteredName: string | undefined
): string | undefined {
  const fromList = memberPrimaryNames[address]?.trim();
  if (fromList) return fromList;
  if (isSelf) return selfRegisteredName?.trim() || undefined;
  return undefined;
}

export function qortalAvatarThumbnailSrc(
  registeredName: string | undefined
): string | undefined {
  const n = registeredName?.trim();
  if (!n) return undefined;
  return `${getBaseApiReactForAvatar()}/arbitrary/THUMBNAIL/${encodeURIComponent(n)}/qortal_avatar?async=true`;
}
