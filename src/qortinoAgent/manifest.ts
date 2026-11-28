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
  /**
   * Folder under the Qortino storage root its parts are saved in. Qortino's
   * own layouts use QORTINO_MODELS_DIR.
   */
  folder?: string;
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

/**
 * Folder for models other than Qortino's own. Cleaning up Qortino's folder
 * never touches it; each model there is removed on its own.
 */
export const QORTINO_OTHER_MODELS_DIR = 'other-models';

export function modelPartRelativePath(part: QortinoModelPart): string {
  return `${QORTINO_MODELS_DIR}/${part.filename}`;
}

/** Where a part of `model` is saved, under the Qortino storage root. */
export function modelPartPath(
  model: QortinoModelSpec,
  part: QortinoModelPart
): string {
  return `${model.folder ?? QORTINO_MODELS_DIR}/${part.filename}`;
}

/**
 * A bigger open model for computers with plenty of memory, on QDN under the
 * same name: Qwen3-30B-A3B-Instruct-2507 (Apache-2.0), Unsloth's Q4_K_M
 * GGUF split into 11 parts with llama-gguf-split --split-max-size 1800M.
 * It is a mixture of experts (8 of its 128 experts run for each token), so
 * it answers quickly for its size. Saved apart from Qortino's own model, so
 * removing or repairing one leaves the other alone.
 */
export const QWEN3_30B_MODEL: QortinoModelSpec = {
  id: 'qwen3-30b-a3b-instruct-2507-q4km',
  label: 'Qwen3 30B A3B Instruct 2507',
  license: 'Apache-2.0',
  parts: [
    {
      filename: 'qortino-qwen3-30b-a3b-2507-q4km-00001-of-00011.gguf',
      sizeBytes: 1_657_913_024,
      sha256:
        '27943a1cdfd572a4cdcec1aa610584bc7e59450ef45055be1dd45fa3008f1101',
    },
    {
      filename: 'qortino-qwen3-30b-a3b-2507-q4km-00002-of-00011.gguf',
      sizeBytes: 1_789_492_512,
      sha256:
        '3832391209d4266befc1b637fda8d5d6df868fdb315d727e19b1459e123bc65e',
    },
    {
      filename: 'qortino-qwen3-30b-a3b-2507-q4km-00003-of-00011.gguf',
      sizeBytes: 1_747_157_600,
      sha256:
        'b5abaf29ff6a8a6211dc915fd46b13e683a188d05be249b7ff5247f05442513f',
    },
    {
      filename: 'qortino-qwen3-30b-a3b-2507-q4km-00004-of-00011.gguf',
      sizeBytes: 1_696_310_016,
      sha256:
        '447cc75f5fe3a25b3eea961577735b17715253a38125f013241194b4376e68bb',
    },
    {
      filename: 'qortino-qwen3-30b-a3b-2507-q4km-00005-of-00011.gguf',
      sizeBytes: 1_737_317_728,
      sha256:
        'e1b868e9965f68c4e6002e2083d57eaa867c33a4b167d426ccf0e4c1229c880d',
    },
    {
      filename: 'qortino-qwen3-30b-a3b-2507-q4km-00006-of-00011.gguf',
      sizeBytes: 1_747_157_632,
      sha256:
        '76b368be5459811d66c7b34b48584f3b259a3fd569fb62361ec42b57261c0c06',
    },
    {
      filename: 'qortino-qwen3-30b-a3b-2507-q4km-00007-of-00011.gguf',
      sizeBytes: 1_696_039_680,
      sha256:
        '04a6571aedb57df4e9557de7a6b0330e6996b7862f570f2b2d5f8c0241121083',
    },
    {
      filename: 'qortino-qwen3-30b-a3b-2507-q4km-00008-of-00011.gguf',
      sizeBytes: 1_737_588_064,
      sha256:
        'b1f8169038df3ab3ad7d3e5faba6caf820e69827d24d2a72fb215dd8ac9ff17c',
    },
    {
      filename: 'qortino-qwen3-30b-a3b-2507-q4km-00009-of-00011.gguf',
      sizeBytes: 1_694_982_784,
      sha256:
        '272ad5f9f79ca633cd8e17b6ee185813f5084fab758afab6def4b7dde0335c55',
    },
    {
      filename: 'qortino-qwen3-30b-a3b-2507-q4km-00010-of-00011.gguf',
      sizeBytes: 1_728_691_488,
      sha256:
        'fcaf29cb59d6da1ed6efbe695dd18a9986e4a1da0502945f5e716b9c13254cd9',
    },
    {
      filename: 'qortino-qwen3-30b-a3b-2507-q4km-00011-of-00011.gguf',
      sizeBytes: 1_324_037_536,
      sha256:
        'ced8bc3e0fabb6c7e2fe98e1a6b8bc47c003a5c0ec4ad9f526f886ad8c86c57c',
    },
  ],
  recommendedRamBytes: 32 * 1024 ** 3,
  contextTokens: 4096,
  folder: `${QORTINO_OTHER_MODELS_DIR}/qwen3-30b-a3b-instruct-2507-q4km`,
};

/** Models besides Qortino's own that Hub offers to download from QDN. */
export const QDN_OTHER_MODELS: QortinoModelSpec[] = [QWEN3_30B_MODEL];

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
  // Q-Share qshare_file_qortino-ai-qwen3-30b-a3b-instr_AGGTub, 22 Nov 2026.
  'qortino-qwen3-30b-a3b-2507-q4km-00001-of-00011.gguf': {
    identifier: 'qshare_file_qortino-ai-qwen3-30b-a3b-instr_II5IHb',
    service: 'FILE',
    sizeBytes: 1_657_913_024,
  },
  'qortino-qwen3-30b-a3b-2507-q4km-00002-of-00011.gguf': {
    identifier: 'qshare_file_qortino-ai-qwen3-30b-a3b-instr_X5jrbs',
    service: 'FILE',
    sizeBytes: 1_789_492_512,
  },
  'qortino-qwen3-30b-a3b-2507-q4km-00003-of-00011.gguf': {
    identifier: 'qshare_file_qortino-ai-qwen3-30b-a3b-instr_F1tlTx',
    service: 'FILE',
    sizeBytes: 1_747_157_600,
  },
  'qortino-qwen3-30b-a3b-2507-q4km-00004-of-00011.gguf': {
    identifier: 'qshare_file_qortino-ai-qwen3-30b-a3b-instr_OWfFbk',
    service: 'FILE',
    sizeBytes: 1_696_310_016,
  },
  'qortino-qwen3-30b-a3b-2507-q4km-00005-of-00011.gguf': {
    identifier: 'qshare_file_qortino-ai-qwen3-30b-a3b-instr_71dKjx',
    service: 'FILE',
    sizeBytes: 1_737_317_728,
  },
  'qortino-qwen3-30b-a3b-2507-q4km-00006-of-00011.gguf': {
    identifier: 'qshare_file_qortino-ai-qwen3-30b-a3b-instr_kGYsOM',
    service: 'FILE',
    sizeBytes: 1_747_157_632,
  },
  'qortino-qwen3-30b-a3b-2507-q4km-00007-of-00011.gguf': {
    identifier: 'qshare_file_qortino-ai-qwen3-30b-a3b-instr_3NG0eK',
    service: 'FILE',
    sizeBytes: 1_696_039_680,
  },
  'qortino-qwen3-30b-a3b-2507-q4km-00008-of-00011.gguf': {
    identifier: 'qshare_file_qortino-ai-qwen3-30b-a3b-instr_kx7XDk',
    service: 'FILE',
    sizeBytes: 1_737_588_064,
  },
  'qortino-qwen3-30b-a3b-2507-q4km-00009-of-00011.gguf': {
    identifier: 'qshare_file_qortino-ai-qwen3-30b-a3b-instr_iUwbGd',
    service: 'FILE',
    sizeBytes: 1_694_982_784,
  },
  'qortino-qwen3-30b-a3b-2507-q4km-00010-of-00011.gguf': {
    identifier: 'qshare_file_qortino-ai-qwen3-30b-a3b-instr_fXLBQr',
    service: 'FILE',
    sizeBytes: 1_728_691_488,
  },
  'qortino-qwen3-30b-a3b-2507-q4km-00011-of-00011.gguf': {
    identifier: 'qshare_file_qortino-ai-qwen3-30b-a3b-instr_eeOePQ',
    service: 'FILE',
    sizeBytes: 1_324_037_536,
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
