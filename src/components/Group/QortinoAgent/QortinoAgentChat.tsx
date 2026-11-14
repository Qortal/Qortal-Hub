import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Snackbar,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddCommentRoundedIcon from '@mui/icons-material/AddCommentRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  createEmptySession,
  loadActiveSessionIds,
  loadChatSessions,
  saveActiveSessionIds,
  saveChatSessions,
  sortSessionsForDrawer,
  titleFromMessages,
  type QortinoChatSession,
  type StoredChatBubble,
} from '../../../qortinoAgent/chatHistoryStore';
import { QortinoChatHistoryDrawer } from './QortinoChatHistoryDrawer';
import QortinoLlm, {
  isQortinoLlmInferenceAvailable,
  type QortinoChatMessage,
  type QortinoListenerHandle,
} from '../../../qortinoAgent/qortinoLlm';
import {
  buildSystemPrompt,
  isPlayingQortalKnowledgeUnit,
  QORTINO_PLAYING_QORTAL_FACTS,
  wantsPlayingQortalMaterial,
} from '../../../qortinoAgent/persona';
import {
  lookupGoldenAnswer,
  warmGoldenIndex,
} from '../../../qortinoAgent/goldenMatch';
import {
  openOfficialResource,
  suggestOfficialResources,
  type OfficialResourceLink,
} from '../../../qortinoAgent/officialResources';
import {
  formatQAppAnswer,
  matchQAppCatalog,
  openQAppInNewTab,
  type MatchedQApp,
} from '../../../qortinoAgent/qAppCatalog';
import { QortinoAppAvatar } from './QortinoAppAvatar';
import { QortinoPanelHeader } from './QortinoPanelHeader';
import {
  looksIncompleteAnswer,
  shouldOfferContinueAssemble,
} from '../../../qortinoAgent/answerComplete';
import { normalizeQortCoinLanguage } from '../../../qortinoAgent/qortCoinLanguage';
import {
  isQortalNetworkDefinitionQuery,
  isQortPriceQuery,
} from '../../../qortinoAgent/queryIntent';
import {
  isTopicFollowUpQuery,
  resolveTopicFollowUpQuery,
} from '../../../qortinoAgent/topicFollowUp';
import {
  OTHER_MODEL_SAMPLING,
  type ActiveQortinoModel,
} from '../../../qortinoAgent/models';
import { subscribeToEvent, unsubscribeFromEvent } from '../../../utils/events';
import { QORTINO_CHATS_CLEARED_EVENT } from './qortinoChatEvents';
import {
  continuedAnswerSource,
  isQortinoAnswerSource,
  type QortinoAnswerReport,
  type QortinoAnswerSource,
} from '../../../qortinoAgent/answerReport';
import { QortinoReportDialog } from './QortinoReportDialog';
import {
  ensureQortinoModel,
  forgetQortinoModel,
  markQortinoBusy,
  qortinoKvHistoryStart,
  releaseQortinoModelAfterClose,
  setQortinoKvOwner,
  warmQortinoSystemPrompt,
} from '../../../qortinoAgent/modelSession';
import qortinoHeadUrl from '../../../assets/svgs/QortinoHead.svg';
import { ASSEMBLE_TIPS } from '../../../qortinoAgent/assembleCopy';
import { formatAssistantBubbleForClipboard } from './formatAssistantBubbleClipboard';
import { QortinoRichText } from './QortinoRichText';
import {
  buildPromptHistory,
  composeUserTurn,
  estimateTokens,
  QORTINO_REPLY_TOKENS,
  QORTINO_SAMPLING,
  type PromptTurn,
} from '../../../qortinoAgent/promptHistory';
import {
  getPendingQortinoQuestion,
  subscribePendingQortinoQuestion,
  takePendingQortinoQuestion,
} from '../../../qortinoAgent/pendingQuestion';
import {
  QORTINO_TEXT_FONT_SIZE,
  useQortinoSettings,
} from '../../../qortinoAgent/settings';

type ChatBubble = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** What the model was given (user) or wrote (assistant) for this turn. */
  modelContent?: string;
  streaming?: boolean;
  /** Guides / official pages. */
  links?: OfficialResourceLink[];
  /** Matched Q-App cards with avatar + open. */
  apps?: MatchedQApp[];
  /** Offer “Continue answer” under a reply cut off by the length cap. */
  canContinueAssemble?: boolean;
  /** Original user question for continue. */
  continueQuery?: string;
  /** Where the answer came from (for a report on it). */
  source?: QortinoAnswerSource;
};

function toStoredBubbles(messages: ChatBubble[]): StoredChatBubble[] {
  return messages
    .filter((m) => !m.streaming)
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      modelContent: m.modelContent,
      links: m.links,
      apps: m.apps,
      canContinueAssemble: m.canContinueAssemble,
      continueQuery: m.continueQuery,
      source: m.source,
    }));
}

function fromStoredBubbles(messages: StoredChatBubble[]): ChatBubble[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    modelContent: m.modelContent,
    links: m.links as ChatBubble['links'],
    apps: m.apps as ChatBubble['apps'],
    canContinueAssemble: m.canContinueAssemble,
    continueQuery: m.continueQuery,
    source: isQortinoAnswerSource(m.source) ? m.source : undefined,
  }));
}

type Props = {
  /** The model this chat talks with (models.ts). */
  model: ActiveQortinoModel;
  onClose: () => void;
  onOpenSettings: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
};

type ModelState = 'loading' | 'ready' | 'error';

/** Live line under "Assembling…": what the model is doing right now. */
type LiveStatus =
  | { kind: 'reading'; percent?: number }
  | { kind: 'warmup' }
  /** A model that thinks before it answers (not Qortino's own). */
  | { kind: 'thinking' }
  | { kind: 'writing' };

/** The question is about Qortal itself (not herb mint or ice on a burn). */
const QORTAL_CUE =
  /\b(qortal|qort|qdn|q-?apps?|q-?chat|q-?tube|q-?mail|qortal go|minter|minting|mintership|nominat\w*|reward share|trade portal|seed ?phrase|registered name|crowetic|simon james|playing qortal)\b/i;

/**
 * History sent when the model's KV cache does not hold this chat (after Hub
 * restarts or another chat was open): about the last exchange. Re-reading a
 * long chat would take a slow computer many seconds before the first word.
 */
const COLD_HISTORY_TOKENS = 500;

/** Small-talk / jokes don't need the FAQ — the model answers directly. */
function wantsKnowledgeLookup(query: string): boolean {
  const t = query.trim().toLowerCase();
  if (!t) return false;
  if (
    /^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|lol|haha|yes|no|yep|nope)\b/.test(
      t
    ) &&
    t.length < 48
  ) {
    return false;
  }
  if (
    /^(tell me (a |another )?joke|another( one)?|joke|make me laugh|who are you|what are you)\b/.test(
      t
    )
  ) {
    return false;
  }
  return true;
}

/**
 * Short follow-ups ("anything specific" / "what is it in depth") are matched
 * against the FAQ with the prior topic folded in.
 */
function knowledgeQueryForRetrieval(
  text: string,
  priorMessages: Array<{ role: string; content: string }>
): string {
  const t = text.trim();
  if (!t) return t;

  const topicFollow = resolveTopicFollowUpQuery(t, priorMessages);
  if (topicFollow.expanded) return topicFollow.text;

  // Clear new questions stand alone — never inherit the prior turn.
  if (
    /^(what|who|how|why|where|when|is|are|can|do|does|did|should|could|would|explain|tell|list|define|describe)\b/i.test(
      t
    ) &&
    !/^(what else|what about)\b/i.test(t) &&
    !isTopicFollowUpQuery(t)
  ) {
    return t;
  }
  const vague =
    /^(anything|more|specific|details?|examples?|and\b|also\b|like what|yes|yeah|yep|ok|okay)\b/i.test(
      t
    ) ||
    (t.length < 28 &&
      !/\bqortal\b|\bq-?apps?\b|\bqort\b|\bmint|\bnominat/i.test(t));
  if (!vague) return t;
  for (let i = priorMessages.length - 1; i >= 0; i -= 1) {
    const m = priorMessages[i];
    if (m?.role === 'user' && m.content?.trim() && m.content.trim() !== t) {
      return `${m.content.trim()}\nFollow-up: ${t}`;
    }
  }
  return t;
}

/** Sent to the model when the user asks it to continue a cut-off answer. */
const CONTINUE_INSTRUCTION =
  'Continue exactly from where you stopped. Do not restart the answer. End cleanly when done.';

/** Capacitor rejects with plain objects; show whatever message they carry. */
function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'errorMessage' in e) {
    return String((e as { errorMessage?: string }).errorMessage);
  }
  if (e && typeof e === 'object' && 'message' in e) {
    return String((e as { message?: string }).message);
  }
  return String(e);
}

/** Space, newline or nothing between a cut-off answer and its continuation. */
function joinContinuation(base: string, more: string): string {
  if (/^[,.;:!?)\]]/.test(more) || /^[a-z]/.test(more))
    return /\s$/.test(base) ? '' : ' ';
  return /[.!?:)\]]$/.test(base) ? '\n' : ' ';
}

function AssemblingLabel({ label, detail }: { label: string; detail: string }) {
  // Joined scripts (Arabic) must not be split into per-letter boxes.
  const letters = /[؀-ۿ]/.test(label) ? [label] : Array.from(label);
  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: 0.55, minWidth: 0 }}
    >
      <Box
        aria-label={label}
        sx={{
          alignItems: 'baseline',
          display: 'flex',
          flexWrap: 'wrap',
          fontSize: '0.95rem',
          fontWeight: 700,
          letterSpacing: '0.02em',
          lineHeight: 1.35,
          '@keyframes qortinoAssembleWave': {
            '0%, 100%': { transform: 'translateY(0)' },
            '40%': { transform: 'translateY(-4px)' },
            '60%': { transform: 'translateY(1px)' },
          },
          '@keyframes qortinoAssemblePulse': {
            '0%, 100%': { opacity: 0.72 },
            '50%': { opacity: 1 },
          },
          animation: 'qortinoAssemblePulse 2.8s ease-in-out infinite',
        }}
      >
        {letters.map((ch, i) => (
          <Box
            key={`${ch}-${i}`}
            component="span"
            sx={{
              animation: 'qortinoAssembleWave 1.8s ease-in-out infinite',
              animationDelay: `${i * 0.07}s`,
              display: 'inline-block',
              whiteSpace: 'pre',
              willChange: 'transform',
            }}
          >
            {ch}
          </Box>
        ))}
        <Box
          component="span"
          sx={{
            animation: 'qortinoAssembleWave 1.8s ease-in-out infinite',
            animationDelay: `${letters.length * 0.07}s`,
            display: 'inline-block',
            ml: 0.15,
          }}
        >
          …
        </Box>
      </Box>
      <Typography
        sx={{
          color: 'inherit',
          fontSize: '0.74rem',
          lineHeight: 1.4,
          opacity: 0.78,
        }}
      >
        {detail}
      </Typography>
    </Box>
  );
}

/** Fast word-by-word reveal for curated answers (not waiting on the model). */
async function revealTextWordByWord(
  fullText: string,
  onPartial: (partial: string) => void,
  isCancelled: () => boolean
): Promise<string> {
  const cleaned = normalizeQortCoinLanguage(fullText);
  const words = cleaned.match(/\S+\s*/g) || [cleaned];
  let out = '';
  for (let i = 0; i < words.length; i += 2) {
    if (isCancelled()) break;
    out += words.slice(i, i + 2).join('');
    onPartial(out);
    await new Promise((r) => setTimeout(r, 14));
  }
  if (!isCancelled()) onPartial(cleaned);
  return cleaned;
}

export function QortinoAgentChat({
  model,
  onClose,
  onOpenSettings,
  expanded,
  onToggleExpanded,
}: Props) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const isDark = theme.palette.mode === 'dark';
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [sessions, setSessions] = useState<QortinoChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [modelState, setModelState] = useState<ModelState>('loading');
  const [warming, setWarming] = useState(false);
  const [modelError, setModelError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [tip, setTip] = useState(ASSEMBLE_TIPS[0]);
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  const [copySnack, setCopySnack] = useState('');
  const [reportAnswer, setReportAnswer] = useState<QortinoAnswerReport | null>(
    null
  );
  const modelReady = modelState === 'ready';
  const drawerSessions = useMemo(
    () => sortSessionsForDrawer(sessions, 'offline'),
    [sessions]
  );
  const settings = useQortinoSettings();
  const replyTokens = QORTINO_REPLY_TOKENS[settings.answerLength];
  const textFontSize = QORTINO_TEXT_FONT_SIZE[settings.textSize];
  const systemPrompt = useMemo(
    () => buildSystemPrompt(settings.answerLength),
    [settings.answerLength]
  );

  const listRef = useRef<HTMLDivElement | null>(null);
  const revealCancelRef = useRef(false);
  const listenerRef = useRef<QortinoListenerHandle | null>(null);
  const progressListenerRef = useRef<QortinoListenerHandle | null>(null);
  const assistantIdRef = useRef<string | null>(null);
  const tipIndexRef = useRef(0);
  /** Only auto-stick to bottom when the user hasn't scrolled up to read. */
  const stickToBottomRef = useRef(true);
  /**
   * The native reply in flight. After Stop it can take a moment to wind
   * down; the next question waits for it rather than being refused.
   */
  const completionRef = useRef<Promise<unknown> | null>(null);

  // Restore persisted chat history once on mount. Sessions from the old QDN
  // chat stay stored but hidden.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [loaded, activeIds] = await Promise.all([
        loadChatSessions(),
        loadActiveSessionIds(),
      ]);
      if (cancelled) return;
      const nextSessions = [...loaded];
      let sid = activeIds.offline;
      let session = sid ? nextSessions.find((s) => s.id === sid) : undefined;
      if (!session || session.mode !== 'offline') {
        session = createEmptySession('offline');
        nextSessions.push(session);
        sid = session.id;
      }
      setSessions(nextSessions);
      setActiveSessionId(sid);
      setMessages(fromStoredBubbles(session.messages));
      setHistoryReady(true);
      void saveChatSessions(nextSessions);
      void saveActiveSessionIds({ ...activeIds, offline: sid });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist messages into the active session (debounced).
  useEffect(() => {
    if (!historyReady || !activeSessionId) return;
    if (messages.some((m) => m.streaming)) return;
    const stored = toStoredBubbles(messages);
    const autoTitle = titleFromMessages(stored);
    const timer = window.setTimeout(() => {
      setSessions((prev) => {
        const next = prev.map((s) =>
          s.id === activeSessionId
            ? {
                ...s,
                messages: stored,
                title: s.titleCustom ? s.title : autoTitle,
                updatedAt: Date.now(),
                mode: 'offline' as const,
              }
            : s
        );
        void saveChatSessions(next);
        return next;
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [messages, activeSessionId, historyReady]);

  const selectSession = useCallback((session: QortinoChatSession) => {
    setActiveSessionId(session.id);
    void loadActiveSessionIds().then((ids) =>
      saveActiveSessionIds({ ...ids, offline: session.id })
    );
    setMessages(fromStoredBubbles(session.messages));
    setStatusError(null);
  }, []);

  const handleNewChat = useCallback(() => {
    if (busy) return;
    const session = createEmptySession('offline');
    setSessions((prev) => {
      const next = [session, ...prev];
      void saveChatSessions(next);
      return next;
    });
    selectSession(session);
  }, [busy, selectSession]);

  const handleSelectSession = useCallback(
    (id: string) => {
      if (busy) return;
      const session = sessions.find((s) => s.id === id);
      if (!session || session.mode !== 'offline') return;
      selectSession(session);
    },
    [busy, selectSession, sessions]
  );

  const handleRenameSession = useCallback((id: string, title: string) => {
    setSessions((prev) => {
      const next = prev.map((s) =>
        s.id === id
          ? { ...s, title, titleCustom: true, updatedAt: Date.now() }
          : s
      );
      void saveChatSessions(next);
      return next;
    });
  }, []);

  const handleTogglePin = useCallback((id: string) => {
    setSessions((prev) => {
      const next = prev.map((s) =>
        s.id === id ? { ...s, pinned: !s.pinned, updatedAt: Date.now() } : s
      );
      void saveChatSessions(next);
      return next;
    });
  }, []);

  const handleDeleteSession = useCallback(
    (id: string) => {
      let next = sessions.filter((s) => s.id !== id);
      if (activeSessionId === id) {
        let replacement = sortSessionsForDrawer(next, 'offline')[0];
        if (!replacement) {
          replacement = createEmptySession('offline');
          next = [replacement, ...next];
        }
        selectSession(replacement);
      }
      setSessions(next);
      void saveChatSessions(next);
    },
    [activeSessionId, selectSession, sessions]
  );

  const hazeAccent = '#7EB6FF';
  const hazeWarm = '#C9E8D4';

  const headDecor = useMemo(
    () => [
      {
        top: '10%',
        left: '68%',
        size: 72,
        anim: 0,
        dur: '12s',
        opacity: isDark ? 0.16 : 0.13,
      },
      {
        top: '48%',
        left: '78%',
        size: 48,
        anim: 1,
        dur: '16s',
        opacity: isDark ? 0.12 : 0.1,
      },
      {
        top: '22%',
        left: '8%',
        size: 40,
        anim: 2,
        dur: '14s',
        opacity: isDark ? 0.1 : 0.09,
      },
      {
        top: '70%',
        left: '14%',
        size: 56,
        anim: 3,
        dur: '18s',
        opacity: isDark ? 0.13 : 0.11,
      },
      {
        top: '58%',
        left: '52%',
        size: 36,
        anim: 1,
        dur: '13s',
        opacity: isDark ? 0.08 : 0.07,
      },
    ],
    [isDark]
  );

  // Index the curated answers once the sheet has opened, so the first
  // question doesn't wait for it.
  useEffect(() => {
    const timer = window.setTimeout(warmGoldenIndex, 400);
    return () => window.clearTimeout(timer);
  }, []);

  // Load (or reuse) the model.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setModelState('loading');
      setModelError('');
      try {
        if (!isQortinoLlmInferenceAvailable()) {
          throw new Error(t('core:qortino_agent.chat.needs_app'));
        }
        if (!model.path) {
          throw new Error(t('core:qortino_agent.chat.model_missing'));
        }
        await ensureQortinoModel({
          path: model.path,
          nCtx: model.contextTokens,
          gpu: settings.useGpu,
        });
        if (cancelled) return;
        setModelState('ready');
      } catch (e) {
        if (cancelled) return;
        setModelError(errorText(e));
        setModelState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [model.path, model.contextTokens, settings.useGpu, loadAttempt, t]);

  // Read the system prompt in the background while the user types; again
  // when the answer length changes it.
  useEffect(() => {
    if (!modelReady) return;
    let cancelled = false;
    setWarming(true);
    void warmQortinoSystemPrompt(systemPrompt).finally(() => {
      if (!cancelled) setWarming(false);
    });
    return () => {
      cancelled = true;
      setWarming(false);
    };
  }, [modelReady, systemPrompt]);

  // What the chat holds now, for the save when it closes.
  const latestRef = useRef({
    messages,
    sessions,
    activeSessionId,
    historyReady,
  });
  latestRef.current = { messages, sessions, activeSessionId, historyReady };

  // Closing the panel unmounts the chat. Keep the model for a while so
  // reopening is instant; it is released after that. The chat is saved as it
  // stands: the save above waits for a reply to finish, and for a pause.
  useEffect(
    () => () => {
      const latest = latestRef.current;
      if (latest.historyReady && latest.activeSessionId) {
        const stored = toStoredBubbles(
          latest.messages
            .map((m) => (m.streaming ? { ...m, streaming: false } : m))
            .filter((m) => m.role !== 'assistant' || m.content.trim())
        );
        const next = latest.sessions.map((session) =>
          session.id === latest.activeSessionId
            ? {
                ...session,
                messages: stored,
                title: session.titleCustom
                  ? session.title
                  : titleFromMessages(stored),
                updatedAt:
                  stored.length === session.messages.length
                    ? session.updatedAt
                    : Date.now(),
              }
            : session
        );
        void saveChatSessions(next);
      }
      revealCancelRef.current = true;
      void QortinoLlm.cancel().catch(() => undefined);
      void listenerRef.current?.remove();
      void progressListenerRef.current?.remove();
      listenerRef.current = null;
      progressListenerRef.current = null;
      releaseQortinoModelAfterClose();
    },
    []
  );

  useEffect(() => {
    const el = listRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, liveStatus]);

  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => {
      tipIndexRef.current = (tipIndexRef.current + 1) % ASSEMBLE_TIPS.length;
      setTip(ASSEMBLE_TIPS[tipIndexRef.current]);
    }, 3200);
    return () => window.clearInterval(id);
  }, [busy]);

  const liveDetail = useMemo(() => {
    if (!liveStatus || liveStatus.kind === 'writing') {
      return t(`core:qortino_agent.tips.${tip}`);
    }
    if (liveStatus.kind === 'warmup') {
      return t('core:qortino_agent.status.getting_ready');
    }
    if (liveStatus.kind === 'thinking') {
      return t('core:qortino_agent.status.thinking');
    }
    return typeof liveStatus.percent === 'number'
      ? t('core:qortino_agent.status.reading_percent', {
          percent: liveStatus.percent,
        })
      : t('core:qortino_agent.status.reading');
  }, [liveStatus, t, tip]);

  const updateBubble = useCallback((id: string, patch: Partial<ChatBubble>) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m))
    );
  }, []);

  const stop = useCallback(async () => {
    revealCancelRef.current = true;
    await QortinoLlm.cancel().catch(() => undefined);
    setBusy(false);
    setMessages((prev) =>
      prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
    );
  }, []);

  // Settings → Delete all chats (the panel saved one empty chat already).
  useEffect(() => {
    const onCleared = (
      event: CustomEvent<{ session?: QortinoChatSession }>
    ) => {
      const fresh = event.detail?.session ?? createEmptySession('offline');
      if (busy) void stop();
      setSessions([fresh]);
      selectSession(fresh);
    };
    subscribeToEvent(QORTINO_CHATS_CLEARED_EVENT, onCleared);
    return () => unsubscribeFromEvent(QORTINO_CHATS_CLEARED_EVENT, onCleared);
  }, [busy, selectSession, stop]);

  /**
   * Run one model reply into `assistantId`. Tokens stream into the bubble
   * once per animation frame; returns the raw text the model wrote.
   */
  const generate = useCallback(
    async (
      assistantId: string,
      turns: QortinoChatMessage[],
      prefix = ''
    ): Promise<string> => {
      let streamed = '';
      let pendingTokens = '';
      let rafId = 0;
      let settleDone!: () => void;
      const donePromise = new Promise<void>((resolve) => {
        settleDone = resolve;
      });
      const flushStream = () => {
        rafId = 0;
        if (!pendingTokens) return;
        streamed += pendingTokens;
        pendingTokens = '';
        updateBubble(assistantId, { content: prefix + streamed });
      };

      // A stopped reply may still be winding down: let it finish first, so
      // its last events never land in this answer.
      await completionRef.current?.catch(() => undefined);
      await listenerRef.current?.remove();
      await progressListenerRef.current?.remove();
      progressListenerRef.current = await QortinoLlm.addListener(
        'progress',
        (event) => {
          if (assistantIdRef.current !== assistantId) return;
          if (event.stage === 'warmup') {
            setLiveStatus({ kind: 'warmup' });
          } else if (event.stage === 'prefill') {
            setLiveStatus({
              kind: 'reading',
              percent: Math.round(Math.min(1, event.percent) * 100),
            });
          } else if (event.stage === 'thinking') {
            setLiveStatus((prev) =>
              prev?.kind === 'thinking' ? prev : { kind: 'thinking' }
            );
          } else if (event.stage === 'generate') {
            setLiveStatus((prev) =>
              prev?.kind === 'writing' ? prev : { kind: 'writing' }
            );
          }
        }
      );
      listenerRef.current = await QortinoLlm.addListener('token', (event) => {
        if (assistantIdRef.current !== assistantId) return;
        // The model process went away: complete() rejects with the same
        // words, and the retry below streams into this listener afresh.
        if (event.error === 'Model is not loaded') return;
        if (event.error && event.error !== 'cancelled') {
          setStatusError(event.error);
        }
        if (event.token) {
          pendingTokens += event.token;
          if (!rafId) rafId = window.requestAnimationFrame(flushStream);
        }
        if (event.done) {
          if (rafId) {
            window.cancelAnimationFrame(rafId);
            rafId = 0;
          }
          flushStream();
          settleDone();
        }
      });

      let completeText = '';
      const run = () => {
        const request = QortinoLlm.complete({
          system: systemPrompt,
          messages: turns,
          maxTokens: replyTokens,
          ...(model.isQortino ? QORTINO_SAMPLING : OTHER_MODEL_SAMPLING),
        });
        completionRef.current = request;
        return request;
      };
      try {
        let result: { ok: boolean; text?: string };
        try {
          result = await run();
        } catch (e) {
          // The model went away under us (memory pressure, a lost load):
          // load it again and retry once.
          if (errorText(e) !== 'Model is not loaded' || !model.path) {
            throw e;
          }
          forgetQortinoModel();
          await ensureQortinoModel({
            path: model.path,
            nCtx: model.contextTokens,
            gpu: settings.useGpu,
          });
          // What the lost attempt wrote is not part of the new answer.
          if (rafId) {
            window.cancelAnimationFrame(rafId);
            rafId = 0;
          }
          streamed = '';
          pendingTokens = '';
          updateBubble(assistantId, { content: prefix });
          setStatusError(null);
          result = await run();
        }
        completeText = typeof result?.text === 'string' ? result.text : '';
      } finally {
        await Promise.race([
          donePromise,
          new Promise<void>((resolve) => setTimeout(resolve, 2500)),
        ]);
        if (rafId) {
          window.cancelAnimationFrame(rafId);
          rafId = 0;
        }
        flushStream();
      }
      // The returned text is authoritative; the stream may drop bridge events.
      return completeText.length >= streamed.length ? completeText : streamed;
    },
    [
      model.contextTokens,
      model.isQortino,
      model.path,
      replyTokens,
      settings.useGpu,
      systemPrompt,
      updateBubble,
    ]
  );

  /** Turns from the conversation so far, in the shape the prompt builder wants. */
  const priorTurns = useCallback(
    (upTo: ChatBubble[]): PromptTurn[] =>
      upTo
        .filter((m) => !m.streaming && m.content.trim())
        .map((m) => ({
          role: m.role,
          content: m.modelContent ?? m.content,
        })),
    []
  );

  const continueAssemble = useCallback(
    async (assistantId: string, query: string, priorAnswer: string) => {
      if (busy || !modelReady || !query.trim() || !priorAnswer.trim()) return;
      const index = messages.findIndex((m) => m.id === assistantId);
      if (index < 0) return;
      setBusy(true);
      markQortinoBusy(true);
      setStatusError(null);
      setLiveStatus({ kind: 'reading' });
      assistantIdRef.current = assistantId;
      stickToBottomRef.current = true;
      const base = priorAnswer.replace(/\s+$/g, '');
      const previousSource = messages[index]?.source;
      updateBubble(assistantId, {
        streaming: true,
        canContinueAssemble: false,
      });
      try {
        // Same conversation plus "continue": the model still holds all of it,
        // so only the instruction has to be read.
        const { turns } = buildPromptHistory({
          prior: priorTurns(messages.slice(0, index + 1)),
          next: CONTINUE_INSTRUCTION,
          systemTokens: estimateTokens(systemPrompt),
          replyTokens,
          start:
            (activeSessionId && qortinoKvHistoryStart(activeSessionId)) || 0,
        });
        const raw = await generate(assistantId, turns, `${base}\n`);
        const more = raw.trim();
        const merged = normalizeQortCoinLanguage(
          more ? `${base}${joinContinuation(base, more)}${more}` : base
        );
        updateBubble(assistantId, {
          content: merged,
          modelContent: merged,
          streaming: false,
          canContinueAssemble: shouldOfferContinueAssemble(merged, {
            maxTokens: replyTokens,
          }),
          continueQuery: query,
          // The model may have been switched since the first part.
          ...(more
            ? { source: continuedAnswerSource(previousSource, model.label) }
            : {}),
        });
      } catch (e) {
        const message = errorText(e);
        if (message !== 'cancelled') setStatusError(message);
        updateBubble(assistantId, {
          content: base,
          streaming: false,
          canContinueAssemble: true,
          continueQuery: query,
        });
      } finally {
        // After Stop, a newer reply may own the chat by now: leave its state.
        if (assistantIdRef.current === assistantId) {
          setBusy(false);
          setLiveStatus(null);
        }
        markQortinoBusy(false);
      }
    },
    [
      busy,
      generate,
      messages,
      model.label,
      modelReady,
      priorTurns,
      replyTokens,
      systemPrompt,
      updateBubble,
    ]
  );

  const sendText = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || busy || !modelReady) return;
      setInput('');
      setStatusError(null);
      revealCancelRef.current = false;
      tipIndexRef.current = 0;
      setTip(ASSEMBLE_TIPS[0]);
      setLiveStatus({ kind: 'reading' });

      const prior = messages;
      const userId = `u-${Date.now()}`;
      const assistantId = `a-${Date.now()}`;
      assistantIdRef.current = assistantId;
      stickToBottomRef.current = true;
      setMessages((prev) => [
        ...prev,
        { id: userId, role: 'user', content: text },
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          streaming: true,
          // Instant answers replace it; a reply that fails half way keeps it.
          source: { kind: 'model', model: model.label },
        },
      ]);
      setBusy(true);
      markQortinoBusy(true);

      const presentInstantAnswer = async (
        answer: string,
        extras: Partial<ChatBubble> = {}
      ) => {
        updateBubble(assistantId, { content: '', streaming: true, ...extras });
        const cleaned = await revealTextWordByWord(
          answer,
          (partial) => updateBubble(assistantId, { content: partial }),
          () =>
            revealCancelRef.current || assistantIdRef.current !== assistantId
        );
        if (
          !revealCancelRef.current &&
          assistantIdRef.current === assistantId
        ) {
          updateBubble(assistantId, {
            content: cleaned,
            modelContent: cleaned,
            streaming: false,
            ...extras,
          });
        }
      };

      try {
        const lookup = wantsKnowledgeLookup(text);
        const matchedApp = lookup ? matchQAppCatalog(text) : null;
        // Guide links and app cards belong under Qortal answers only: their
        // keyword triggers ("how do I start", "ice", "recover") also fire on
        // first-aid and survival questions.
        const qortalExtras = (faqCategory?: string) => {
          const onQortal =
            QORTAL_CUE.test(text) ||
            faqCategory === 'qortal' ||
            faqCategory === 'programming';
          if (!lookup || !onQortal) return {};
          const links = suggestOfficialResources(text);
          return {
            links: links.length ? links : undefined,
            apps: matchedApp ? [matchedApp] : undefined,
          };
        };

        // A specific Q-App question ("what is Q-Assets"): the catalog answer is exact.
        if (
          matchedApp &&
          matchedApp.score >= 0.8 &&
          !isQortalNetworkDefinitionQuery(text) &&
          !isQortPriceQuery(text)
        ) {
          const appLinks: OfficialResourceLink[] = suggestOfficialResources(
            text
          ).filter((l) => l.name !== matchedApp.entry.name);
          await presentInstantAnswer(formatQAppAnswer(matchedApp.entry, null), {
            apps: [matchedApp],
            links: appLinks.length ? appLinks : undefined,
            source: { kind: 'catalog', app: matchedApp.entry.name },
          });
          return;
        }

        const retrievalQuery = knowledgeQueryForRetrieval(text, prior);
        const wantsPlaying = wantsPlayingQortalMaterial(retrievalQuery);
        const notes: string[] = [];
        const hintIds: string[] = [];
        let faqCategory: string | undefined;
        if (lookup) {
          const topicFollow = resolveTopicFollowUpQuery(text, prior);
          // Depth follow-ups expand through the model, not the short FAQ.
          const wantsDeeper =
            topicFollow.expanded &&
            /\b(in (more )?depth|more detail|go deeper|elaborate|expand|tell me more)\b/i.test(
              text
            );
          // Book philosophy only when the question is about the book.
          const golden = lookupGoldenAnswer(retrievalQuery, {
            allow: (entry) =>
              wantsPlaying || !isPlayingQortalKnowledgeUnit(entry),
          });
          const instant = golden.instant;
          if (instant && !wantsDeeper) {
            await presentInstantAnswer(instant.entry.a, {
              ...qortalExtras(instant.entry.category),
              source: { kind: 'curated', id: instant.entry.id },
            });
            return;
          }
          // Not sure enough to answer as-is: the closest curated answers go
          // to the model with the question.
          const hints = instant ? [instant] : golden.hints;
          faqCategory = hints[0]?.entry.category;
          for (const hint of hints) {
            hintIds.push(hint.entry.id);
            notes.push(
              `[Curated FAQ · ${hint.entry.category}] Q: ${hint.entry.q}\nA: ${hint.entry.a}`
            );
          }
        }
        if (wantsPlaying) notes.push(QORTINO_PLAYING_QORTAL_FACTS);

        const userTurn = composeUserTurn(text, notes);
        updateBubble(userId, { modelContent: userTurn });
        // Oldest message still sent: it only moves forward, in jumps, so the
        // prompt keeps the same beginning for several turns and the model
        // reuses what it already read. Unknown (null) when the KV cache holds
        // another chat or was emptied by a reload.
        const warmStart = activeSessionId
          ? qortinoKvHistoryStart(activeSessionId)
          : null;
        const { turns, start } = buildPromptHistory({
          prior: priorTurns(prior),
          next: userTurn,
          systemTokens: estimateTokens(systemPrompt),
          replyTokens,
          start: warmStart ?? 0,
          coldPriorTokens: warmStart === null ? COLD_HISTORY_TOKENS : undefined,
        });

        const raw = await generate(assistantId, turns);
        if (activeSessionId) setQortinoKvOwner(activeSessionId, start);
        const finalText = normalizeQortCoinLanguage(raw.trim());
        if (finalText) {
          updateBubble(assistantId, {
            content: finalText,
            // What the KV cache holds: the next prompt repeats it unchanged.
            modelContent: raw,
            ...qortalExtras(faqCategory),
            source: {
              kind: 'model',
              model: model.label,
              ...(hintIds.length ? { hints: hintIds } : {}),
            },
            canContinueAssemble:
              looksIncompleteAnswer(finalText) ||
              shouldOfferContinueAssemble(finalText, {
                maxTokens: replyTokens,
              }),
            continueQuery: text,
          });
        } else {
          updateBubble(assistantId, {
            content: t('core:qortino_agent.chat.no_reply'),
          });
        }
      } catch (e) {
        const message = errorText(e);
        if (message === 'cancelled') {
          // Stopped before the first word: drop the empty bubble.
          setMessages((prev) =>
            prev.filter((m) => m.id !== assistantId || m.content.trim())
          );
        } else {
          setStatusError(message);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content:
                      m.content || t('core:qortino_agent.chat.reply_failed'),
                  }
                : m
            )
          );
        }
      } finally {
        // After Stop, a newer reply may own the chat by now: leave its state.
        if (assistantIdRef.current === assistantId) {
          setBusy(false);
          setLiveStatus(null);
        }
        markQortinoBusy(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m
          )
        );
      }
    },
    [
      activeSessionId,
      busy,
      generate,
      messages,
      model.label,
      modelReady,
      priorTurns,
      replyTokens,
      systemPrompt,
      t,
      updateBubble,
    ]
  );

  const send = useCallback(() => sendText(input), [input, sendText]);

  // A question typed next to Qortino on Home: a new chat for it (the empty
  // one open already is one), shown in the box until the model is loaded.
  const pendingQuestion = useSyncExternalStore(
    subscribePendingQortinoQuestion,
    getPendingQortinoQuestion,
    getPendingQortinoQuestion
  );
  const [queuedQuestion, setQueuedQuestion] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingQuestion || !historyReady || busy) return;
    const question = takePendingQortinoQuestion();
    if (!question) return;
    if (messages.length > 0) handleNewChat();
    setInput(question);
    setQueuedQuestion(question);
  }, [busy, handleNewChat, historyReady, messages.length, pendingQuestion]);
  useEffect(() => {
    if (!queuedQuestion || !modelReady || busy) return;
    setQueuedQuestion(null);
    void sendText(queuedQuestion);
  }, [busy, modelReady, queuedQuestion, sendText]);

  const subtitle = t('core:qortino_agent.chat.subtitle', {
    model: model.label,
  });

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        isolation: 'isolate',
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
        backgroundImage: isDark
          ? `radial-gradient(90% 120% at 12% 30%, ${alpha(hazeAccent, 0.14)} 0%, transparent 55%), radial-gradient(80% 100% at 88% 70%, ${alpha(hazeWarm, 0.1)} 0%, transparent 50%), linear-gradient(180deg, #12151c 0%, #0c0e13 100%)`
          : `radial-gradient(90% 120% at 12% 30%, ${alpha(hazeAccent, 0.12)} 0%, transparent 55%), radial-gradient(80% 100% at 88% 70%, ${alpha(hazeWarm, 0.16)} 0%, transparent 50%), linear-gradient(180deg, #f4f7fb 0%, #e8eef6 100%)`,
        '@keyframes qortinoHeadFloat0': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) rotate(-6deg)' },
          '50%': { transform: 'translate3d(10px, -8px, 0) rotate(4deg)' },
        },
        '@keyframes qortinoHeadFloat1': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) rotate(8deg)' },
          '50%': { transform: 'translate3d(-12px, 10px, 0) rotate(-4deg)' },
        },
        '@keyframes qortinoHeadFloat2': {
          '0%, 100%': {
            transform: 'translate3d(0, 0, 0) scale(1) rotate(-3deg)',
          },
          '50%': {
            transform: 'translate3d(8px, 12px, 0) scale(1.06) rotate(6deg)',
          },
        },
        '@keyframes qortinoHeadFloat3': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) rotate(5deg)' },
          '50%': { transform: 'translate3d(-8px, -10px, 0) rotate(-8deg)' },
        },
      }}
    >
      <Box
        aria-hidden
        sx={{
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
          position: 'absolute',
          zIndex: 0,
        }}
      >
        {headDecor.map((logo, idx) => (
          <Box
            key={`${logo.anim}-${idx}`}
            component="img"
            alt=""
            src={qortinoHeadUrl}
            sx={{
              animation: `qortinoHeadFloat${logo.anim} ${logo.dur} ease-in-out infinite`,
              filter: isDark
                ? 'saturate(0.85) brightness(1.08)'
                : 'saturate(0.9)',
              height: logo.size,
              left: logo.left,
              objectFit: 'contain',
              opacity: logo.opacity,
              position: 'absolute',
              top: logo.top,
              width: logo.size,
              willChange: 'transform',
            }}
          />
        ))}
      </Box>

      <QortinoPanelHeader
        subtitle={subtitle}
        onClose={onClose}
        onOpenSettings={onOpenSettings}
        expanded={expanded}
        onToggleExpanded={onToggleExpanded}
        leading={
          <IconButton
            aria-label={t('core:qortino_agent.aria.history')}
            onClick={() => setHistoryOpen(true)}
            size="small"
            title={t('core:qortino_agent.aria.history')}
          >
            <HistoryRoundedIcon fontSize="small" />
          </IconButton>
        }
        actions={
          <IconButton
            aria-label={t('core:qortino_agent.aria.new_chat')}
            // An empty chat already is a new one.
            disabled={busy || messages.length === 0}
            onClick={() => {
              handleNewChat();
              composerInputRef.current?.focus();
            }}
            size="small"
            title={t('core:qortino_agent.aria.new_chat')}
          >
            <AddCommentRoundedIcon fontSize="small" />
          </IconButton>
        }
      />

      <Box
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const distanceFromBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight;
          stickToBottomRef.current = distanceFromBottom < 96;
        }}
        sx={{
          WebkitOverflowScrolling: 'touch',
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          position: 'relative',
          px: 1.5,
          py: 1.5,
          touchAction: 'pan-y',
          zIndex: 1,
        }}
      >
        {modelState !== 'error' && messages.length === 0 && (
          <Typography
            sx={{
              color: alpha(theme.palette.text.primary, 0.7),
              fontSize: '0.92rem',
              lineHeight: 1.45,
              maxWidth: 420,
            }}
          >
            {t('core:qortino_agent.chat.empty')}
          </Typography>
        )}
        {modelState === 'error' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, py: 1 }}>
            <Typography
              sx={{ color: theme.palette.error.main, fontSize: '0.88rem' }}
            >
              {t('core:qortino_agent.chat.load_failed', { error: modelError })}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
              onClick={() => setLoadAttempt((n) => n + 1)}
            >
              {t('core:qortino_agent.chat.retry', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
          </Box>
        )}
        {messages.map((m, msgIndex) => (
          <Box
            key={m.id}
            sx={{
              display: 'flex',
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              mb: 1.1,
            }}
          >
            <Box
              sx={{
                background:
                  m.role === 'user'
                    ? alpha('#4A7FD4', isDark ? 0.35 : 0.18)
                    : alpha(
                        theme.palette.background.paper,
                        isDark ? 0.62 : 0.92
                      ),
                border: `1px solid ${alpha(theme.palette.common.white, isDark ? 0.08 : 0.35)}`,
                borderRadius: '14px',
                boxShadow: m.streaming
                  ? `0 8px 28px ${alpha('#7EB6FF', isDark ? 0.12 : 0.1)}`
                  : 'none',
                maxWidth: '92%',
                px: 1.2,
                py: 0.9,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {m.streaming ? (
                <Box
                  sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}
                >
                  <AssemblingLabel
                    label={t('core:qortino_agent.status.assembling')}
                    detail={liveDetail}
                  />
                  {m.content ? (
                    <Box
                      sx={{
                        borderLeft: `2px solid ${alpha('#7EB6FF', 0.45)}`,
                        pl: 1,
                      }}
                    >
                      <QortinoRichText
                        text={m.content}
                        fontSize={textFontSize}
                      />
                    </Box>
                  ) : null}
                </Box>
              ) : m.content ? (
                <QortinoRichText text={m.content} fontSize={textFontSize} />
              ) : null}
              {(() => {
                if (m.streaming || m.role !== 'assistant' || !m.content) {
                  return null;
                }
                let pairedQuestion = m.continueQuery?.trim() || '';
                if (!pairedQuestion) {
                  for (let i = msgIndex - 1; i >= 0; i -= 1) {
                    const prev = messages[i];
                    if (prev?.role === 'user' && prev.content?.trim()) {
                      pairedQuestion = prev.content.trim();
                      break;
                    }
                  }
                }
                const showContinue =
                  !!pairedQuestion &&
                  !!m.canContinueAssemble &&
                  shouldOfferContinueAssemble(m.content, {
                    maxTokens: replyTokens,
                  });
                return (
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: 0.5,
                      justifyContent: showContinue
                        ? 'space-between'
                        : 'flex-end',
                      mt: 0.85,
                      width: '100%',
                    }}
                  >
                    {showContinue ? (
                      <Box
                        component="button"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void continueAssemble(m.id, pairedQuestion, m.content)
                        }
                        sx={{
                          appearance: 'none',
                          background: alpha('#7EB6FF', isDark ? 0.14 : 0.1),
                          border: `1px solid ${alpha('#7EB6FF', 0.45)}`,
                          borderRadius: '10px',
                          color: isDark ? '#D6E8FF' : '#1A4A8A',
                          cursor: busy ? 'default' : 'pointer',
                          fontSize: '0.74rem',
                          fontWeight: 800,
                          opacity: busy ? 0.55 : 1,
                          px: 1,
                          py: 0.6,
                        }}
                      >
                        {t('core:qortino_agent.chat.continue')}
                      </Box>
                    ) : (
                      <Box />
                    )}
                    <Box
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        gap: 0.15,
                        ml: 'auto',
                      }}
                    >
                      <IconButton
                        aria-label={t('core:qortino_agent.aria.copy')}
                        size="small"
                        title={t('core:qortino_agent.aria.copy')}
                        onClick={() => {
                          const full = formatAssistantBubbleForClipboard(m, t);
                          void navigator.clipboard
                            ?.writeText(full || m.content)
                            .then(() =>
                              setCopySnack(t('core:qortino_agent.chat.copied'))
                            )
                            .catch(() =>
                              setCopySnack(
                                t('core:qortino_agent.chat.copy_failed')
                              )
                            );
                        }}
                        sx={{
                          color: alpha(theme.palette.text.primary, 0.42),
                          p: 0.35,
                          '&:hover': {
                            background: alpha('#7EB6FF', isDark ? 0.16 : 0.1),
                            color: isDark ? '#D6E8FF' : '#1A6FD4',
                          },
                        }}
                      >
                        <ContentCopyRoundedIcon sx={{ fontSize: '1.05rem' }} />
                      </IconButton>
                      <IconButton
                        aria-label={t('core:qortino_agent.aria.report')}
                        // Flagging opens Q-Mail and closes the panel, which
                        // would stop an answer still being written.
                        disabled={busy}
                        size="small"
                        title={t('core:qortino_agent.aria.report')}
                        onClick={() =>
                          setReportAnswer({
                            question: pairedQuestion,
                            answer:
                              formatAssistantBubbleForClipboard(m, t) ||
                              m.content,
                            source: m.source,
                          })
                        }
                        sx={{
                          color: alpha(theme.palette.text.primary, 0.42),
                          p: 0.35,
                          '&:hover': {
                            background: alpha(
                              theme.palette.warning.main,
                              isDark ? 0.16 : 0.1
                            ),
                            color: theme.palette.warning.main,
                          },
                        }}
                      >
                        <FlagOutlinedIcon sx={{ fontSize: '1.05rem' }} />
                      </IconButton>
                    </Box>
                  </Box>
                );
              })()}
              {m.apps?.length ? (
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.75,
                    mt: 1,
                  }}
                >
                  {m.apps.map((app) => (
                    <Box
                      key={app.entry.id}
                      sx={{
                        alignItems: 'center',
                        background: alpha('#7EB6FF', isDark ? 0.12 : 0.08),
                        border: `1px solid ${alpha('#7EB6FF', 0.35)}`,
                        borderRadius: '14px',
                        cursor: 'pointer',
                        display: 'flex',
                        gap: 1,
                        p: 0.85,
                      }}
                      onClick={() => openQAppInNewTab(app.entry)}
                    >
                      <QortinoAppAvatar
                        alt={app.entry.title}
                        appName={app.entry.name}
                        sx={{
                          border: `2px solid ${alpha('#7EB6FF', 0.4)}`,
                          height: 48,
                          width: 48,
                        }}
                      />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          sx={{ fontSize: '0.9rem', fontWeight: 800 }}
                        >
                          {app.entry.title}
                        </Typography>
                        <Typography
                          sx={{
                            color: alpha(theme.palette.text.primary, 0.6),
                            fontSize: '0.68rem',
                          }}
                        >
                          {t('core:qortino_agent.chat.published_as', {
                            service: app.entry.service,
                            name: app.entry.name,
                          })}
                        </Typography>
                      </Box>
                      <Box
                        component="button"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openQAppInNewTab(app.entry);
                        }}
                        sx={{
                          appearance: 'none',
                          background: alpha('#7EB6FF', 0.9),
                          border: 'none',
                          borderRadius: '10px',
                          color: '#061018',
                          cursor: 'pointer',
                          flexShrink: 0,
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          px: 1,
                          py: 0.55,
                        }}
                      >
                        {t('core:qortino_agent.chat.open_app')}
                      </Box>
                    </Box>
                  ))}
                </Box>
              ) : null}
              {m.links?.length ? (
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.65,
                    mt: m.content || m.apps?.length ? 1 : 0,
                  }}
                >
                  {m.links.map((link) => (
                    <Box
                      key={link.id}
                      component="button"
                      type="button"
                      onClick={() => openOfficialResource(link)}
                      sx={{
                        alignItems: 'center',
                        appearance: 'none',
                        background: alpha('#7EB6FF', isDark ? 0.16 : 0.1),
                        border: `1px solid ${alpha('#7EB6FF', 0.4)}`,
                        borderRadius: '12px',
                        color: isDark ? '#D6E8FF' : '#1A4A8A',
                        cursor: 'pointer',
                        display: 'flex',
                        gap: 0.85,
                        px: 0.85,
                        py: 0.65,
                        textAlign: 'left',
                        width: '100%',
                        '&:hover': {
                          background: alpha('#7EB6FF', isDark ? 0.26 : 0.18),
                        },
                      }}
                    >
                      {link.service && link.name ? (
                        <QortinoAppAvatar
                          alt={link.label}
                          appName={link.name}
                          sx={{
                            border: `2px solid ${alpha('#7EB6FF', 0.4)}`,
                            height: 40,
                            width: 40,
                          }}
                        />
                      ) : null}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          sx={{ fontSize: '0.82rem', fontWeight: 800 }}
                        >
                          {link.label}
                          {link.href ? ' ↗' : ' →'}
                        </Typography>
                        {link.blurb ? (
                          <Typography
                            sx={{
                              color: alpha(theme.palette.text.primary, 0.55),
                              fontSize: '0.68rem',
                            }}
                          >
                            {link.service
                              ? `${link.service} · ${link.blurb}`
                              : link.blurb}
                          </Typography>
                        ) : link.service ? (
                          <Typography
                            sx={{
                              color: alpha(theme.palette.text.primary, 0.55),
                              fontSize: '0.68rem',
                            }}
                          >
                            {link.service}
                            {link.name ? ` · ${link.name}` : ''}
                          </Typography>
                        ) : null}
                      </Box>
                    </Box>
                  ))}
                </Box>
              ) : null}
            </Box>
          </Box>
        ))}
        {statusError && (
          <Typography
            sx={{ color: theme.palette.error.main, fontSize: '0.85rem', mt: 1 }}
          >
            {statusError}
          </Typography>
        )}
      </Box>

      <Box
        sx={{
          borderTop: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          gap: 0.75,
          p: 1,
          pb: 1.25,
          position: 'relative',
          zIndex: 5,
        }}
      >
        {modelState === 'loading' ? (
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: 1,
              px: 0.5,
            }}
          >
            <CircularProgress size={16} thickness={5} />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.8rem', fontWeight: 700 }}>
                {t('core:qortino_agent.chat.loading_model')}
              </Typography>
              <Typography
                sx={{
                  color: alpha(theme.palette.text.primary, 0.55),
                  fontSize: '0.7rem',
                }}
              >
                {t('core:qortino_agent.chat.loading_model_hint')}
              </Typography>
            </Box>
          </Box>
        ) : null}

        <Box sx={{ alignItems: 'flex-end', display: 'flex', gap: 0.75 }}>
          <TextField
            fullWidth
            inputRef={composerInputRef}
            multiline
            autoFocus
            maxRows={6}
            placeholder={t('core:qortino_agent.chat.placeholder')}
            size="small"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                settings.enterSends &&
                // The Enter that picks a word in a Japanese or Chinese
                // input method is not a send.
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                void send();
              }
            }}
            inputProps={{
              enterKeyHint: settings.enterSends ? 'send' : 'enter',
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                background: alpha(
                  theme.palette.background.paper,
                  isDark ? 0.55 : 0.9
                ),
                borderRadius: '18px',
                px: 0.5,
                py: 0.15,
                '& fieldset': {
                  borderColor: alpha('#7EB6FF', isDark ? 0.28 : 0.35),
                  borderRadius: '18px',
                },
                '&:hover fieldset': {
                  borderColor: alpha('#7EB6FF', 0.55),
                },
                '&.Mui-focused fieldset': {
                  borderColor: '#7EB6FF',
                  borderWidth: '1.5px',
                },
              },
              '& .MuiInputBase-input': {
                fontSize: '0.92rem',
                lineHeight: 1.4,
                px: 1.1,
                py: 1,
              },
            }}
          />
          {busy ? (
            <IconButton
              aria-label={t('core:qortino_agent.aria.stop')}
              color="primary"
              onClick={() => void stop()}
            >
              <StopRoundedIcon />
            </IconButton>
          ) : (
            <IconButton
              aria-label={t('core:qortino_agent.aria.send')}
              color="primary"
              disabled={!modelReady || !input.trim()}
              onClick={() => void send()}
              sx={{
                background: alpha('#7EB6FF', isDark ? 0.22 : 0.16),
                borderRadius: '14px',
              }}
            >
              <SendRoundedIcon />
            </IconButton>
          )}
        </Box>
      </Box>

      <QortinoChatHistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        sessions={drawerSessions}
        activeId={activeSessionId}
        onNewChat={handleNewChat}
        onSelect={handleSelectSession}
        onRename={handleRenameSession}
        onTogglePin={handleTogglePin}
        onDelete={handleDeleteSession}
      />

      <QortinoReportDialog
        report={reportAnswer}
        onClose={() => setReportAnswer(null)}
      />
      <Snackbar
        open={!!copySnack}
        autoHideDuration={2200}
        onClose={() => setCopySnack('')}
        message={copySnack}
        sx={{ zIndex: 12000 }}
      />
    </Box>
  );
}

export default QortinoAgentChat;
