/**
 * The one model Qortino runs, and where it lives on QDN.
 *
 * Qwen3-4B-Instruct-2507 (Apache-2.0), quantized to Q4_K_M and split in two
 * GGUF parts because QDN refuses single files over 2 GiB. Both parts are
 * published with Q-Share under the `Qortino AI` name; Hub finds them by
 * filename (see qshareDiscovery.ts), saves them side by side and loads the
 * first part — llama.cpp opens the others from the same folder. The same
 * model also comes in three parts for the public node
 * (QORTINO_MODEL_PUBLIC_NODE).
 *
 * Built by tools/qortino-model/build-model.sh from the official weights.
 */

/** Q-Share / QDN registered name for all agent resources. */
export const QORTINO_QDN_NAME = 'Qortino AI';

export type QortinoModelPart = {
  /** Q-Share filename; also the name on disk (llama.cpp needs it). */
  filename: string;
  sizeBytes: number;
  sha256: string;
};

export type QortinoModelSpec = {
  id: string;
  label: string;
  license: string;
  parts: QortinoModelPart[];
  /** Below this much RAM the gate warns that answers may be slow. */
  recommendedRamBytes: number;
  /** Context window the chat loads the model with. */
  contextTokens: number;
};

export const QORTINO_MODEL: QortinoModelSpec = {
  id: 'qwen3-4b-instruct-2507-q4km',
  label: 'Qwen3 4B Instruct 2507',
  license: 'Apache-2.0',
  parts: [
    {
      filename: 'qortino-qwen3-4b-2507-q4km-00001-of-00002.gguf',
      sizeBytes: 1_305_218_624,
      sha256:
        'faf47a62eb961356346902fa7adfeafa722f24bb876f25eb0b0d848d8796277c',
    },
    {
      filename: 'qortino-qwen3-4b-2507-q4km-00002-of-00002.gguf',
      sizeBytes: 1_192_060_352,
      sha256:
        '6e609c08211eb99c2e8bb6b5f8b642fb2f816620a61769122807b69c289a059e',
    },
  ],
  recommendedRamBytes: 6 * 1024 ** 3,
  contextTokens: 4096,
};

/**
 * The same model in three parts under 1 GiB, for the public node:
 * it cuts any single transfer near 1 GiB and often drops what it fetched,
 * so smaller parts finish in one go more often. Private nodes keep the two
 * parts above. Built from the same Q4_K_M file with llama-gguf-split
 * --split-max-size 900M.
 */
export const QORTINO_MODEL_PUBLIC_NODE: QortinoModelSpec = {
  ...QORTINO_MODEL,
  parts: [
    {
      filename: 'qortino-qwen3-4b-2507-q4km-00001-of-00003.gguf',
      sizeBytes: 887_056_512,
      sha256:
        '052f989b25564ce96b734e9296803ee4a536969be324707b41217f812ea5cec5',
    },
    {
      filename: 'qortino-qwen3-4b-2507-q4km-00002-of-00003.gguf',
      sizeBytes: 887_372_448,
      sha256:
        '5625eb9a8c6136d02e5062a159977a2b15156fb215c5530bf72d6cf9cca02416',
    },
    {
      filename: 'qortino-qwen3-4b-2507-q4km-00003-of-00003.gguf',
      sizeBytes: 722_850_144,
      sha256:
        'd040e8a87be71426d1d4bc0b4282def2ffdcde30db286f1c64a13a7c78c290a6',
    },
  ],
};

/** Every way the model is published; a computer holds one of them. */
export const QORTINO_MODEL_LAYOUTS: QortinoModelSpec[] = [
  QORTINO_MODEL,
  QORTINO_MODEL_PUBLIC_NODE,
];

/** The layout an install belongs to, from the path of its first part. */
export function qortinoLayoutForPath(llmPath?: string): QortinoModelSpec {
  return (
    QORTINO_MODEL_LAYOUTS.find((layout) =>
      llmPath?.endsWith(`/${layout.parts[0].filename}`)
    ) ?? QORTINO_MODEL
  );
}

/** Folder under the Qortino storage root that holds the model parts. */
export const QORTINO_MODELS_DIR = 'models';

export function modelPartRelativePath(part: QortinoModelPart): string {
  return `${QORTINO_MODELS_DIR}/${part.filename}`;
}

export function modelTotalBytes(
  model: QortinoModelSpec = QORTINO_MODEL
): number {
  return model.parts.reduce((sum, part) => sum + part.sizeBytes, 0);
}

/**
 * Identifiers the parts are published under, keyed by lowercased filename.
 *
 * Q-Share mints a random identifier per file. Hub reads them from the Q-Share
 * metadata document at runtime; this copy of the current publish keeps the
 * download working when a node cannot serve that document yet.
 */
export const PUBLISHED_QSHARE_FILES: Record<
  string,
  { identifier: string; service: string; sizeBytes: number }
> = {
  // Q-Share qshare_file_qortino-ai-qwen3-4b-instruct-2_w2mDgq, 4 Nov 2026.
  'qortino-qwen3-4b-2507-q4km-00001-of-00002.gguf': {
    identifier: 'qshare_file_qortino-ai-qwen3-4b-instruct-2_ukKkj7',
    service: 'FILE',
    sizeBytes: 1_305_218_624,
  },
  'qortino-qwen3-4b-2507-q4km-00002-of-00002.gguf': {
    identifier: 'qshare_file_qortino-ai-qwen3-4b-instruct-2_uFPC1Z',
    service: 'FILE',
    sizeBytes: 1_192_060_352,
  },
  // Public node layout: Q-Share qshare_file_qortino-ai-qwen3-4b-instruct-2_UjBZvM.
  'qortino-qwen3-4b-2507-q4km-00001-of-00003.gguf': {
    identifier: 'qshare_file_qortino-ai-qwen3-4b-instruct-2_pFGfCz',
    service: 'FILE',
    sizeBytes: 887_056_512,
  },
  'qortino-qwen3-4b-2507-q4km-00002-of-00003.gguf': {
    identifier: 'qshare_file_qortino-ai-qwen3-4b-instruct-2_7QSliN',
    service: 'FILE',
    sizeBytes: 887_372_448,
  },
  'qortino-qwen3-4b-2507-q4km-00003-of-00003.gguf': {
    identifier: 'qshare_file_qortino-ai-qwen3-4b-instruct-2_f0lX83',
    service: 'FILE',
    sizeBytes: 722_850_144,
  },
};

/**
 * Shown in the gate and given to the model. Owned by the app, so the wording
 * can change without republishing to QDN.
 */
export const QORTINO_SAFETY_DISCLAIMER =
  'Qortino can be confidently wrong → double-check anything important.';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
