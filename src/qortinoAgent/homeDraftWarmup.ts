/**
 * Get Qortino ready while a question is typed next to him on Home.
 *
 * Reading the model takes a few seconds, and the system prompt has to be
 * read after that. Both start with the first letter typed in the Home box, so
 * by the time the question is sent the chat finds the model loaded (its own
 * load joins this one) and the answer can start at once.
 *
 * A question left unsent frees the memory again, as Qortino's "Keep ready"
 * setting says for a closed panel.
 */
import { getDefaultStore } from 'jotai';
import { qortinoAgentOpenAtom, qortinoAgentParkedAtom } from '../atoms/global';
import { isQortinoLlmInferenceAvailable } from './qortinoLlm';
import { resolveActiveQortinoModel } from './models';
import {
  RELEASE_AFTER_CLOSE_MS,
  ensureQortinoModel,
  releaseQortinoModelSoon,
  warmQortinoSystemPrompt,
} from './modelSession';
import { buildSystemPrompt } from './persona';
import { getQortinoSettings } from './settings';
import { loadInstallState } from './store';

/**
 * A draft left with "Keep ready" off: still time to click send, or to look
 * away for a moment and come back.
 */
export const RELEASE_HOME_DRAFT_OFF_MS = 15_000;

/** The Qortino panel is open or parked: its chat holds the model. */
function qortinoChatMounted(): boolean {
  const store = getDefaultStore();
  return Boolean(
    store.get(qortinoAgentOpenAtom) || store.get(qortinoAgentParkedAtom)
  );
}

/**
 * Load the model and read the system prompt in the background. Safe to call
 * again: a load or read already running is joined, not started twice, and a
 * release scheduled by an earlier draft is cancelled.
 */
export async function warmQortinoForHomeDraft(): Promise<void> {
  if (!isQortinoLlmInferenceAvailable()) return;
  try {
    const install = await loadInstallState();
    const model = resolveActiveQortinoModel(
      install.installed ? install.llmPath : null
    );
    if (!model.path) return;
    await ensureQortinoModel({
      path: model.path,
      nCtx: model.contextTokens,
      gpu: getQortinoSettings().useGpu,
    });
    await warmQortinoSystemPrompt(
      buildSystemPrompt(getQortinoSettings().answerLength)
    );
  } catch {
    // The chat loads again when it opens and shows what went wrong there.
  }
}

/** The draft was left without sending: free the model as the settings say. */
export function releaseQortinoAfterHomeDraft(): void {
  if (qortinoChatMounted()) return;
  const { keepReady } = getQortinoSettings();
  if (keepReady === 'open') return;
  releaseQortinoModelSoon(
    keepReady === 'off' ? RELEASE_HOME_DRAFT_OFF_MS : RELEASE_AFTER_CLOSE_MS
  );
}
