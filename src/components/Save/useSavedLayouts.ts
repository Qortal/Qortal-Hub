import { useAtom, useAtomValue } from 'jotai';
import { useCallback, useMemo } from 'react';
import { useSidePanelSettings } from '../Desktop/sidePanel';
import { useHomeLayout } from '../Group/HomeDesktop/homeLayout';
import {
  readLocalLayouts,
  restoreSavedLayouts,
  sameLayoutPart,
  type SavedLayoutPart,
  savedLayoutsAtom,
  unsavedLayoutParts,
} from './savedLayouts';

/** Which of Home's layout and the side panel differ from what's on QDN. */
export const useUnsavedLayoutParts = (
  address: string | null | undefined
): SavedLayoutPart[] => {
  const state = useAtomValue(savedLayoutsAtom);
  const [homeLayout] = useHomeLayout(address);
  const [sidePanel] = useSidePanelSettings(address);
  return useMemo(
    () =>
      address
        ? unsavedLayoutParts(state, address, readLocalLayouts(address))
        : [],
    // The layouts are read again as they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [address, homeLayout, sidePanel, state]
  );
};

/** Whether Home's layout or the side panel differ from what's on QDN. */
export const useHasUnsavedLayouts = (address: string | null | undefined) =>
  useUnsavedLayoutParts(address).length > 0;

/**
 * The layout saved on QDN for `part`, when it differs from this device's,
 * and the way to put it in place.
 */
export const useSavedLayout = (
  address: string | null | undefined,
  part: SavedLayoutPart
) => {
  const [state, setState] = useAtom(savedLayoutsAtom);
  const [homeLayout] = useHomeLayout(address);
  const [sidePanel] = useSidePanelSettings(address);
  const found = address && state.address === address ? state.saved[part] : null;
  const local = part === 'homeLayout' ? homeLayout : sidePanel;
  const differs =
    !!found && !sameLayoutPart(part, local as never, found.value as never);
  const restore = useCallback(() => {
    if (!address) return;
    setState((current) => restoreSavedLayouts(address, current, [part]));
  }, [address, part, setState]);
  return { saved: differs ? found : null, restore };
};
