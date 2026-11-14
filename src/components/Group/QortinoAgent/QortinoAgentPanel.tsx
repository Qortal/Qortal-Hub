import { Box, CircularProgress, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { AnimatePresence, motion } from 'framer-motion';
import { useAtom } from 'jotai';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { qortinoAgentOpenAtom } from '../../../atoms/global';
import { appChromeOffset } from '../../Desktop/CustomTitleBar';
import {
  resolveActiveQortinoModel,
  useQortinoModels,
  type ActiveQortinoModel,
} from '../../../qortinoAgent/models';
import { ensureQortinoModel } from '../../../qortinoAgent/modelSession';
import { clearPendingQortinoQuestion } from '../../../qortinoAgent/pendingQuestion';
import { getQortinoSettings } from '../../../qortinoAgent/settings';
import {
  loadInstallState,
  saveInstallState,
  type QortinoInstallState,
} from '../../../qortinoAgent/store';
import {
  loadQortinoAgentChat,
  type QortinoChatModule as ChatModule,
} from './loadQortinoAgentChat';
import { QortinoAgentGate } from './QortinoAgentGate';
import { QortinoPanelHeader } from './QortinoPanelHeader';
import { QortinoSettingsView } from './QortinoSettingsView';

const PANEL_WIDTH_PX = 460;
const PANEL_WIDE_WIDTH = 'min(920px, calc(100vw - 120px))';
const PANEL_GAP_PX = 10;
const EXPANDED_KEY = 'qortino:panel-wide:v1';

function readExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Start reading the model as soon as the panel knows which one, in parallel
 * with loading the chat code. The chat's own load joins this one.
 */
function preloadModel(model: ActiveQortinoModel): void {
  if (!model.path) return;
  void ensureQortinoModel({
    path: model.path,
    nCtx: model.contextTokens,
    gpu: getQortinoSettings().useGpu,
  }).catch(() => undefined);
}

/**
 * Qortino AI in Hub: a panel on the right of the window, over whatever is
 * open (Home, a Q-App, Q-Chat). It shows the download gate until a model is
 * on this computer, then the chat. Its settings slide over either.
 */
export function QortinoAgentPanel() {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const isDark = theme.palette.mode === 'dark';
  const [open, setOpen] = useAtom(qortinoAgentOpenAtom);
  const models = useQortinoModels();
  const [ready, setReady] = useState(false);
  const [install, setInstall] = useState<QortinoInstallState>({
    installed: false,
  });
  // Held in state (not React.lazy) so the chat replaces the loading view or
  // the gate in one render, without a Suspense fallback in between.
  const [chatModule, setChatModule] = useState<ChatModule | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expanded, setExpanded] = useState(readExpanded);
  const refreshGenRef = useRef(0);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const activeModel = useMemo(
    () =>
      resolveActiveQortinoModel(
        install.installed ? install.llmPath : null,
        models
      ),
    [install.installed, install.llmPath, models]
  );
  const showChat = Boolean(activeModel.path);

  const loadChat = useCallback(async () => {
    const m = await loadQortinoAgentChat().catch(() => null);
    if (m) setChatModule(m);
  }, []);

  const refresh = useCallback(async () => {
    const gen = ++refreshGenRef.current;
    const state = await loadInstallState();
    if (gen !== refreshGenRef.current) return;
    const model = resolveActiveQortinoModel(
      state.installed ? state.llmPath : null
    );
    // Keep the loading view until the chat code is in, so the chat shows at once.
    if (model.path) {
      preloadModel(model);
      await loadChat();
      if (gen !== refreshGenRef.current) return;
    }
    setInstall(state);
    setReady(true);
  }, [loadChat]);

  useEffect(() => {
    if (!open) {
      // Closed from anywhere (its button, the sidebar, Escape, a report):
      // a question from Home the chat never took is not asked next time.
      setSettingsOpen(false);
      clearPendingQortinoQuestion();
      return;
    }
    void refresh();
  }, [open, refresh]);

  // Another model chosen in settings: get its chat code in.
  useEffect(() => {
    if (showChat && !chatModule) void loadChat();
  }, [chatModule, loadChat, showChat]);

  const handleInstalled = useCallback(
    (next: QortinoInstallState) => {
      setInstall(next);
      if (next.installed && next.llmPath) {
        // The parts were just written, so they are still in the page cache.
        preloadModel(resolveActiveQortinoModel(next.llmPath));
        void loadChat();
      }
    },
    [loadChat]
  );

  const handleRemoved = useCallback(() => {
    setInstall({ installed: false });
  }, []);

  const handleClose = useCallback(async () => {
    setSettingsOpen(false);
    // A question from Home the chat never took is not asked next time.
    clearPendingQortinoQuestion();
    setOpen(false);
    if (install.installed) {
      const next = { ...install, lastOpenedAt: Date.now() };
      await saveInstallState(next);
      setInstall(next);
    }
  }, [install, setOpen]);

  const toggleExpanded = useCallback(() => {
    setExpanded((value) => {
      const next = !value;
      try {
        localStorage.setItem(EXPANDED_KEY, next ? '1' : '0');
      } catch {
        /* only for this visit */
      }
      return next;
    });
  }, []);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      if (settingsOpen) setSettingsOpen(false);
      else void handleClose();
    },
    [handleClose, settingsOpen]
  );

  // Opened from the sidebar or Home: the keyboard goes to the panel.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) panel.focus();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [open]);

  const Chat = chatModule?.QortinoAgentChat;
  const headerProps = {
    onClose: () => void handleClose(),
    onOpenSettings: () => setSettingsOpen(true),
    expanded,
    onToggleExpanded: toggleExpanded,
  };

  let body;
  if (!ready) {
    body = (
      <>
        <QortinoPanelHeader {...headerProps} />
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flex: 1,
            justifyContent: 'center',
          }}
        >
          <CircularProgress size={26} />
        </Box>
      </>
    );
  } else if (showChat && Chat) {
    body = (
      <Chat
        model={activeModel}
        onClose={() => void handleClose()}
        onOpenSettings={() => setSettingsOpen(true)}
        expanded={expanded}
        onToggleExpanded={toggleExpanded}
      />
    );
  } else if (showChat) {
    body = <QortinoPanelHeader {...headerProps} />;
  } else {
    body = (
      <>
        <QortinoPanelHeader {...headerProps} />
        <QortinoAgentGate
          onAssembleStart={() => void loadChat()}
          onInstalled={handleInstalled}
          onCancel={() => void handleClose()}
          onOpenModels={() => setSettingsOpen(true)}
        />
      </>
    );
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="qortino-panel"
          initial={{ opacity: 0, x: 36 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 36 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          style={{
            bottom: PANEL_GAP_PX,
            position: 'fixed',
            right: PANEL_GAP_PX,
            top: appChromeOffset + PANEL_GAP_PX,
            width: expanded ? PANEL_WIDE_WIDTH : `${PANEL_WIDTH_PX}px`,
            maxWidth: `calc(100vw - ${PANEL_GAP_PX * 2}px)`,
            zIndex: theme.zIndex.drawer + 2,
          }}
        >
          <Box
            ref={panelRef}
            role="complementary"
            aria-label={t('core:qortino_agent.sidebar')}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            data-testid="qortino-agent-panel"
            sx={{
              backdropFilter: 'blur(18px)',
              background: isDark
                ? `linear-gradient(180deg, ${alpha('#121722', 0.97)} 0%, ${alpha('#0c0f16', 0.98)} 100%)`
                : `linear-gradient(180deg, ${alpha('#ffffff', 0.97)} 0%, ${alpha('#f2f6fb', 0.98)} 100%)`,
              border: `1px solid ${alpha(isDark ? '#B3D0FF' : '#5E7390', isDark ? 0.14 : 0.22)}`,
              borderRadius: '18px',
              boxShadow: isDark
                ? `0 24px 60px ${alpha('#000', 0.55)}, inset 0 1px 0 ${alpha('#fff', 0.04)}`
                : `0 24px 60px ${alpha('#1E3248', 0.22)}`,
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              outline: 'none',
              overflow: 'hidden',
              position: 'relative',
              width: '100%',
            }}
          >
            {body}
            {settingsOpen ? (
              <QortinoSettingsView
                install={install}
                onBack={() => setSettingsOpen(false)}
                onRemoved={handleRemoved}
              />
            ) : null}
          </Box>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export default QortinoAgentPanel;
