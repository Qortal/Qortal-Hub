import { useRef, useState, useMemo } from 'react';
import { useModal } from './useModal';

/**
 * Centralizes all app-level modals (payment/publish, unsaved changes, info,
 * Qortal request, Qortal request extension) and related state.
 * useModal() already returns stable show/onOk/onCancel; we expose them
 * in one object so App stays lean and consumers get stable refs.
 */
export function useAppModals() {
  const paymentPublish = useModal();
  const unsavedChanges = useModal();
  const info = useModal();
  const qortalRequest = useModal();
  const qortalRequestExtension = useModal();

  const [confirmRequestRead, setConfirmRequestRead] = useState(false);
  const qortalRequestCheckbox1Ref = useRef<boolean | null>(null);

  return useMemo(
    () => ({
      // Payment/publish
      paymentPublish,
      // Unsaved changes (logout confirm)
      unsavedChanges,
      // Info
      info,
      // Qortal request (popup)
      qortalRequest,
      // Qortal request extension (main window)
      qortalRequestExtension,
      confirmRequestRead,
      setConfirmRequestRead,
      qortalRequestCheckbox1Ref,
    }),
    [
      paymentPublish,
      unsavedChanges,
      info,
      qortalRequest,
      qortalRequestExtension,
      confirmRequestRead,
    ]
  );
}
