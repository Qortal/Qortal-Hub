import i18n from '../../i18n/i18n';
import { TIME_SECONDS_30_IN_MILLISECONDS } from '../../constants/constants';
import { serializeQortalRequestError } from '../../qortal/qortal-request-errors';
import { executeEvent } from '../../utils/events';

/**
 * What a Home widget may ask the Hub for: the qortalRequest actions that
 * reach the Hub. The read-only node look-ups (SEARCH_QDN_RESOURCES,
 * FETCH_QDN_RESOURCE, GET_BALANCE, ...) are answered by Core's own script
 * inside the widget and never get here.
 *
 * Widgets run without being opened, on Home, so they get far less than an
 * open Q-App: they show things and open apps. Anything that pays, publishes,
 * signs, decrypts, saves files, sends messages, notifies or takes the whole
 * screen is refused, with a message to open the app instead. The few that ask
 * the user (account address, wallet balance) or change what is on screen
 * (opening an app) are only taken while Home is the view showing, so a widget
 * out of sight never pops anything up.
 *
 * The names match Qortal GO's widgets screen, so one widget runs in both.
 */
export const WIDGET_SET_SIZE = 'GO_WIDGET_SET_SIZE';
export const WIDGET_INFO = 'GO_WIDGET_INFO';
/** Posted to a widget when it comes into view or leaves it. */
export const WIDGET_VISIBILITY = 'GO_WIDGET_VISIBILITY';

/**
 * Harmless at any time: public node facts, foreign-coin fees and servers,
 * and the frame's bookkeeping.
 */
const ALWAYS = new Set([
  'GET_CROSSCHAIN_SERVER_INFO',
  'GET_DAY_SUMMARY',
  'GET_FOREIGN_FEE',
  'GET_NODE_INFO',
  'GET_NODE_STATUS',
  'GET_PRIMARY_NAME',
  'GET_TX_ACTIVITY_SUMMARY',
  'IS_USING_PUBLIC_NODE',
  'LINK_TO_QDN_RESOURCE',
  'NAVIGATION_HISTORY',
  'QDN_RESOURCE_DISPLAYED',
  'WHICH_UI',
]);

/** Only while Home is showing: they ask the user or open something. */
const ON_SCREEN = new Set([
  'GET_USER_ACCOUNT',
  'GET_WALLET_BALANCE',
  'OPEN_NEW_TAB',
  'OPEN_USER_LOOKUP',
  'SET_TAB',
]);

/** Acknowledged without doing anything: a widget has no history or path. */
const ACKNOWLEDGED = new Set([
  'LINK_TO_QDN_RESOURCE',
  'NAVIGATION_HISTORY',
  'QDN_RESOURCE_DISPLAYED',
]);

export const WIDGET_REQUEST_NOT_ALLOWED = 'WIDGET_REQUEST_NOT_ALLOWED';
export const WIDGET_NOT_ON_SCREEN = 'WIDGET_NOT_ON_SCREEN';

export type WidgetRequestVerdict =
  | { kind: 'allow' }
  | { kind: 'own' }
  | {
      kind: 'refuse';
      code: typeof WIDGET_REQUEST_NOT_ALLOWED | typeof WIDGET_NOT_ON_SCREEN;
    };

export const widgetRequestVerdict = (
  action: unknown,
  onScreen: boolean
): WidgetRequestVerdict => {
  if (action === WIDGET_SET_SIZE || action === WIDGET_INFO) {
    return { kind: 'own' };
  }
  if (typeof action !== 'string') {
    return { kind: 'refuse', code: WIDGET_REQUEST_NOT_ALLOWED };
  }
  if (ALWAYS.has(action)) return { kind: 'allow' };
  if (ON_SCREEN.has(action)) {
    return onScreen
      ? { kind: 'allow' }
      : { kind: 'refuse', code: WIDGET_NOT_ON_SCREEN };
  }
  return { kind: 'refuse', code: WIDGET_REQUEST_NOT_ALLOWED };
};

const refusedMessage = (code: string): string =>
  code === WIDGET_NOT_ON_SCREEN
    ? i18n.t('group:home_widgets.error.not_on_screen', {
        defaultValue: 'Home is not showing, so widgets cannot ask for this.',
      })
    : i18n.t('group:home_widgets.error.not_allowed', {
        defaultValue:
          'Widgets cannot do this. Open the app for it (OPEN_NEW_TAB).',
      });

type ReplyPort = { postMessage: (message: unknown) => void };
type BridgeEvent = { data: any; ports: ReplyPort[] };

type SendMessage = (
  action: string,
  payload: unknown,
  timeout: number,
  isExtension: boolean,
  appInfo: { name: string; service: string; tabId: string }
) => Promise<any>;

/** A background response, as the main Q-App listener reports it. */
const replyFor = (response: any) => {
  if (!response?.error) return { result: response, error: null };
  const code = typeof response.code === 'string' ? response.code : undefined;
  const message =
    code && typeof response.message === 'string'
      ? response.message
      : typeof response.error === 'string'
        ? response.error
        : typeof response.message === 'string'
          ? response.message
          : 'An error has occurred';
  return {
    result: null,
    error: { error: response.error, ...(code ? { code } : {}), message },
  };
};

export type WidgetRequestHandlerOptions = {
  owner: { tabId: string; name: string; service: string };
  /** Read when a request comes in (see ON_SCREEN). */
  isOnScreen: () => boolean;
  /** Answers the widget's own requests (GO_WIDGET_*). */
  answerOwn: (action: string, data: Record<string, unknown>) => unknown;
  /** The Hub's request runner; window.sendMessage outside tests. */
  sendMessage?: SendMessage;
};

/**
 * The listener for one widget guest's requests (see
 * attachQAppRequestBridge): its own requests answered here, allowed ones run
 * as for any Q-App, everything else refused with a code the widget can read.
 */
export const createWidgetRequestHandler =
  ({
    owner,
    isOnScreen,
    answerOwn,
    sendMessage = (...args) => window.sendMessage(...args),
  }: WidgetRequestHandlerOptions) =>
  async (event: BridgeEvent): Promise<void> => {
    const data = event?.data;
    if (data?.requestedHandler !== 'UI') return;
    const port = event.ports?.[0];
    const reply = (message: unknown) => port?.postMessage(message);
    const verdict = widgetRequestVerdict(data.action, isOnScreen());

    if (verdict.kind === 'refuse') {
      const message = refusedMessage(verdict.code);
      reply({
        result: null,
        error: { error: verdict.code, code: verdict.code, message },
      });
      return;
    }
    if (verdict.kind === 'own') {
      reply({ result: answerOwn(data.action, data), error: null });
      return;
    }
    if (ACKNOWLEDGED.has(data.action)) {
      reply({ result: true, error: null });
      return;
    }
    if (data.action === 'SET_TAB') {
      executeEvent('addTab', { data: data.payload });
      executeEvent('open-apps-mode', {});
      reply({ result: true, error: null });
      return;
    }
    try {
      const response = await sendMessage(
        data.action,
        data,
        TIME_SECONDS_30_IN_MILLISECONDS,
        true,
        { name: owner.name, service: owner.service, tabId: owner.tabId }
      );
      reply(replyFor(response));
    } catch (error) {
      reply({ result: null, error: serializeQortalRequestError(error) });
    }
  };
