import { useEffect, type RefObject } from 'react';

export function useAdminPopoverDismiss({
  open,
  anchor,
  panelRef,
  onClose,
}: {
  open: boolean;
  anchor: HTMLElement | null;
  panelRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // MUI portals the key and fee dialogs outside the popover. Interacting
      // with a foreground dialog (including its backdrop) must not unmount
      // the panel that is awaiting its result.
      if (
        target instanceof Element &&
        target.closest('.reticulum-admin-popover-paper, .MuiDialog-root')
      ) {
        return;
      }
      if (panelRef.current?.contains(target) || anchor?.contains(target))
        return;
      onClose();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, true);
  }, [anchor, onClose, open, panelRef]);
}
