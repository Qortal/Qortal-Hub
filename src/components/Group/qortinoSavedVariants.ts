import {
  DEFAULT_QORTINO_LOOK_DEBUG_SETTINGS,
  type QortinoLookDebugSettings,
} from './qortinoLookDebug';

export type SavedQortinoVariant = {
  id: string;
  label: string;
  lookDebug: QortinoLookDebugSettings;
  note: string;
  showAntenna: boolean;
};

export const QORTINO_DEFAULT_SAVED_VARIANT: SavedQortinoVariant = {
  id: 'default',
  label: 'QORTINO Default',
  lookDebug: { ...DEFAULT_QORTINO_LOOK_DEBUG_SETTINGS },
  note: 'Current live mascot default with antenna and Qortal logo cap.',
  showAntenna: true,
};

export const QORTINO_NO_ANTENNA_SAVED_VARIANT: SavedQortinoVariant = {
  id: 'no-antenna',
  label: 'QORTINO No Antenna',
  lookDebug: { ...DEFAULT_QORTINO_LOOK_DEBUG_SETTINGS },
  note: 'Saved fallback variant that removes the antenna and Qortal logo cap while keeping the current body and face tuning.',
  showAntenna: false,
};

export const QORTINO_SAVED_VARIANTS: SavedQortinoVariant[] = [
  QORTINO_DEFAULT_SAVED_VARIANT,
  QORTINO_NO_ANTENNA_SAVED_VARIANT,
];
