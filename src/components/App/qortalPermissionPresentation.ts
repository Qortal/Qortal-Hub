export type PermissionDetailRow = {
  label?: string;
  value: string;
};

export type PermissionDetailSection = {
  title?: string;
  rows?: PermissionDetailRow[];
  html?: string;
  json?: any;
};

export type MessageQortalRequestExtension = {
  text1?: string;
  text2?: string;
  text3?: string;
  text4?: string;
  html?: string;
  highlightedText?: string;
  json?: any;
  fee?: string;
  appFee?: string;
  foreignFee?: string;
  checkbox1?: { label?: string; value?: boolean };
  confirmCheckbox?: boolean;
  confirmCheckboxLabel?: string;
  requestType?: string;
  sourceLabel?: string;
  sourceKind?: 'Q-App' | 'Application' | 'Extension';
  summaryTitle?: string;
  summaryBody?: string;
  summaryItems?: PermissionDetailRow[];
  technicalDetails?: PermissionDetailSection[];
  countdownDuration?: number;
};

export type PermissionPresentation = {
  sourceLabel?: string;
  sourceKind: string;
  title: string;
  body: string;
  summaryItems: PermissionDetailRow[];
  feeItems: PermissionDetailRow[];
  detailsSections: PermissionDetailSection[];
};

export const MODAL_REQUEST_TYPES = [
  'ADD_FOREIGN_SERVER',
  'ADD_GROUP_ADMIN',
  'ADD_LIST_ITEMS',
  'ADMIN_ACTION',
  'BAN_FROM_GROUP',
  'BUY_NAME',
  'CANCEL_GROUP_BAN',
  'CANCEL_GROUP_INVITE',
  'CANCEL_SELL_NAME',
  'CANCEL_TRADE_SELL_ORDER',
  'CREATE_GROUP',
  'CREATE_POLL',
  'CREATE_TRADE_BUY_ORDER',
  'CREATE_TRADE_SELL_ORDER',
  'DELETE_HOSTED_DATA',
  'DELETE_LIST_ITEM',
  'DEPLOY_AT',
  'GET_HOSTED_DATA',
  'GET_LIST_ITEMS',
  'GET_USER_ACCOUNT',
  'GET_USER_WALLET',
  'GET_USER_WALLET_INFO',
  'GET_USER_WALLET_TRANSACTIONS',
  'GET_WALLET_BALANCE',
  'INVITE_TO_GROUP',
  'JOIN_GROUP',
  'KICK_FROM_GROUP',
  'LEAVE_GROUP',
  'LOCK_TAB',
  'MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA',
  'PUBLISH_MULTIPLE_QDN_RESOURCES',
  'PUBLISH_QDN_RESOURCE',
  'REENCRYPT_GROUP_KEYS',
  'REGISTER_NAME',
  'REMOVE_FOREIGN_SERVER',
  'REMOVE_GROUP_ADMIN',
  'SAVE_FILE',
  'SELL_NAME',
  'SEND_CHAT_MESSAGE',
  'SEND_COIN',
  'SESSION_PERMISSIONS',
  'SET_CURRENT_FOREIGN_SERVER',
  'SIGN_FOREIGN_FEES',
  'SIGN_TRANSACTION',
  'TRANSFER_ASSET',
  'UPDATE_FOREIGN_FEE',
  'UPDATE_GROUP',
  'UPDATE_NAME',
  'VOTE_ON_POLL',
] as const;

export const REQUEST_ACTION_LABELS: Record<string, string> = {
  ADD_FOREIGN_SERVER: 'add a server',
  ADD_GROUP_ADMIN: 'add a group admin',
  ADD_LIST_ITEMS: 'add items to a list',
  ADMIN_ACTION: 'perform an admin action',
  BAN_FROM_GROUP: 'ban a user from a group',
  BUY_NAME: 'buy a name',
  CANCEL_GROUP_BAN: 'cancel a group ban',
  CANCEL_GROUP_INVITE: 'cancel a group invite',
  CANCEL_SELL_NAME: 'cancel a name sale',
  CANCEL_TRADE_SELL_ORDER: 'cancel a trade sell order',
  CREATE_GROUP: 'create a group',
  CREATE_POLL: 'create a poll',
  CREATE_TRADE_BUY_ORDER: 'create a trade buy order',
  CREATE_TRADE_SELL_ORDER: 'create a trade sell order',
  DELETE_HOSTED_DATA: 'delete hosted data',
  DELETE_LIST_ITEM: 'delete a list item',
  DEPLOY_AT: 'deploy an AT',
  GET_USER_ACCOUNT: 'authenticate',
  GET_HOSTED_DATA: 'access hosted data',
  GET_LIST_ITEMS: 'access list items',
  SESSION_PERMISSIONS: 'request session permissions',
  INVITE_TO_GROUP: 'invite to a group',
  PUBLISH_QDN_RESOURCE: 'publish data',
  PUBLISH_MULTIPLE_QDN_RESOURCES: 'publish multiple resources',
  KICK_FROM_GROUP: 'remove a user from a group',
  LOCK_TAB: 'lock this tab',
  REMOVE_FOREIGN_SERVER: 'remove a server',
  REMOVE_GROUP_ADMIN: 'remove a group admin',
  SAVE_FILE: 'save a file',
  SELL_NAME: 'sell a name',
  SEND_COIN: 'send a payment',
  SET_CURRENT_FOREIGN_SERVER: 'change server settings',
  SIGN_TRANSACTION: 'sign a transaction',
  SIGN_FOREIGN_FEES: 'sign foreign fees',
  MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA: 'send a payment and publish private data',
  GET_USER_WALLET: 'access wallet details',
  GET_WALLET_BALANCE: 'access wallet balances',
  GET_USER_WALLET_INFO: 'access wallet information',
  GET_USER_WALLET_TRANSACTIONS: 'access wallet transactions',
  TRANSFER_ASSET: 'transfer an asset',
  UPDATE_FOREIGN_FEE: 'update foreign fees',
  UPDATE_GROUP: 'update a group',
  REGISTER_NAME: 'register a name',
  UPDATE_NAME: 'update a name',
  JOIN_GROUP: 'join a group',
  LEAVE_GROUP: 'leave a group',
  SEND_CHAT_MESSAGE: 'send a chat message',
  VOTE_ON_POLL: 'vote on a poll',
};

const formatServiceName = (service?: string) => {
  if (!service) return 'Unknown';
  return service
    .toLowerCase()
    .split('_')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
};

const QDN_SERVICE_SUMMARIES: Record<string, string> = {
  APP: 'This publishes a Q-App resource to QDN.',
  DOCUMENT: 'This publishes document-style content to QDN.',
  DOCUMENT_PRIVATE: 'This publishes encrypted private document data to QDN.',
  IMAGE: 'This publishes image data to QDN.',
  VIDEO: 'This publishes video content to QDN.',
  THUMBNAIL: 'This publishes thumbnail-style media to QDN.',
  WEBSITE: 'This publishes website content to QDN.',
  BLOG: 'This publishes blog content to QDN.',
};

export const getReadableRequestAction = (requestType?: string) => {
  if (!requestType) return 'make a change to your account';
  if (REQUEST_ACTION_LABELS[requestType]) return REQUEST_ACTION_LABELS[requestType];
  return 'make a change to your account';
};

const formatGroupType = (value?: string) => {
  if (!value) return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'public' || normalized === 'open') return 'Public';
  if (normalized === '0' || normalized === 'private' || normalized === 'closed') return 'Private';
  return value;
};

const sanitizeQuestionCopy = (value?: string) => {
  if (!value) return '';

  return value
    .replace(/^do you give this application permission to\s*/i, '')
    .replace(/^this application is requesting\s*/i, '')
    .replace(/\?$/u, '')
    .trim();
};

const parseDetailRow = (value?: string): PermissionDetailRow | null => {
  if (!value?.trim()) return null;

  const trimmed = value.trim();
  const separatorIndex = trimmed.indexOf(':');

  if (separatorIndex > 0) {
    return {
      label: trimmed.slice(0, separatorIndex).trim(),
      value: trimmed.slice(separatorIndex + 1).trim() || '-',
    };
  }

  return {
    value: trimmed,
  };
};

const trimTrailingZeros = (value: string) => {
  if (!/^-?\d+(\.\d+)?$/u.test(value)) return value;
  return value.replace(/\.?0+$/u, '');
};

const formatCurrencyValue = (value?: string, fallbackCurrency = 'QORT') => {
  if (!value) return '';
  const trimmed = value.trim();
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)(?:\s+([A-Z]+))?$/u);

  if (!match) return trimmed;

  const [, amount, currency] = match;
  const normalizedAmount = trimTrailingZeros(amount);
  const resolvedCurrency = currency || fallbackCurrency;
  return resolvedCurrency ? `${normalizedAmount} ${resolvedCurrency}` : normalizedAmount;
};

const capitalizeSentence = (value?: string) => {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const buildFallbackActionSentence = (requestType?: string) => {
  return capitalizeSentence(getReadableRequestAction(requestType));
};

const getDetailRowValue = (
  rows: PermissionDetailRow[],
  targetLabel: string
) => {
  return rows.find((row) => row.label?.toLowerCase() === targetLabel.toLowerCase())?.value;
};

const parsePublishMultipleSummary = (html?: string) => {
  if (!html) {
    return { resourceCount: 0, includesPrivateData: false };
  }

  const resourceCount = (html.match(/resource-container/g) || []).length;
  const includesPrivateData = /_PRIVATE|encrypted/iu.test(html);

  return {
    resourceCount,
    includesPrivateData,
  };
};

const getJsonValue = (json: any, candidateKeys: string[]) => {
  if (!json || typeof json !== 'object') return undefined;

  for (const key of candidateKeys) {
    if (json[key] != null) {
      return json[key];
    }
  }

  return undefined;
};

const getPermissionsList = (message: MessageQortalRequestExtension) => {
  const rawPermissions =
    getJsonValue(message.json, ['permissions']) ??
    message.technicalDetails
      ?.flatMap((section) => section.rows || [])
      .find((row) => row.label?.toLowerCase() === 'permissions')
      ?.value;

  if (Array.isArray(rawPermissions)) {
    return rawPermissions.map((permission) => String(permission)).filter(Boolean);
  }

  if (typeof rawPermissions === 'string') {
    return rawPermissions
      .split(',')
      .map((permission) => permission.trim())
      .filter(Boolean);
  }

  return [];
};

const buildTitle = (message: MessageQortalRequestExtension) => {
  if (message.summaryTitle) return message.summaryTitle;

  const sourceLabel = message.sourceLabel?.trim();
  const requestType = message.requestType;
  const actionLabel = getReadableRequestAction(requestType);

  if (sourceLabel) {
    return `${sourceLabel} wants to ${actionLabel}`;
  }

  const sanitized = sanitizeQuestionCopy(message.text1);
  return `This application wants to ${REQUEST_ACTION_LABELS[requestType || ''] || sanitized || actionLabel}`;
};

const buildBody = (
  message: MessageQortalRequestExtension,
  t: (key: string, options?: Record<string, unknown>) => string
) => {
  if (message.summaryBody) return message.summaryBody;

  const requestType = message.requestType;
  const serviceRow = parseDetailRow(message.text2);
  const serviceValue = serviceRow?.label?.toLowerCase() === 'service' ? serviceRow.value : '';

  switch (requestType) {
    case 'GET_USER_ACCOUNT':
      return 'This confirms your Qortal identity for the application.\nThis action does not send a payment or publish data.';
    case 'SESSION_PERMISSIONS':
      return 'Approved permissions apply only during this session.';
    case 'ADD_FOREIGN_SERVER':
      return 'This adds a foreign server configuration to your Qortal environment.';
    case 'PUBLISH_QDN_RESOURCE':
      return (
        QDN_SERVICE_SUMMARIES[serviceValue] ||
        `This action will publish data to QDN using the ${serviceValue || 'selected'} service.`
      );
    case 'PUBLISH_MULTIPLE_QDN_RESOURCES':
      return 'Multiple QDN resources will be published using your account.\nResources may include private or encrypted data.';
    case 'SEND_COIN':
      return 'This sends funds from your wallet to the specified recipient.';
    case 'SIGN_TRANSACTION':
      return 'Review the transaction details before approving.';
    case 'MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA':
      return 'This will send a payment and publish private encrypted data in the same action.';
    case 'REMOVE_FOREIGN_SERVER':
      return 'This removes a saved foreign server configuration from your Qortal environment.';
    case 'SET_CURRENT_FOREIGN_SERVER':
      return 'This changes which foreign server your Qortal environment will use.';
    case 'GET_USER_WALLET':
    case 'GET_WALLET_BALANCE':
    case 'GET_USER_WALLET_INFO':
    case 'GET_USER_WALLET_TRANSACTIONS':
      return 'This gives the application access to wallet-related information from your Qortal account.';
    default:
      return '';
  }
};

const buildSummaryItems = (
  message: MessageQortalRequestExtension,
  t: (key: string, options?: Record<string, unknown>) => string
) => {
  if (message.summaryItems?.length) return message.summaryItems;

  const requestType = message.requestType;
  const rows = [message.text2, message.text3, message.text4]
    .map(parseDetailRow)
    .filter(Boolean) as PermissionDetailRow[];

  const serviceValue = getDetailRowValue(rows, 'service');
  const nameValue = getDetailRowValue(rows, 'name');
  const recipientValue = getDetailRowValue(rows, 'to');

  if (requestType === 'GET_USER_ACCOUNT') {
    return [{ value: 'Grant permissions for this session only' }];
  }

  if (requestType === 'SESSION_PERMISSIONS') {
    const permissions = getPermissionsList(message);
    return [
      ...(permissions.length
        ? permissions.map((permission) => ({ value: capitalizeSentence(permission.replace(/_/g, ' ').toLowerCase()) }))
        : [{ value: 'Grant permissions for this session only' }]),
    ];
  }

  if (requestType === 'ADD_FOREIGN_SERVER') {
    const hostValue = getDetailRowValue(rows, 'host');
    const portValue = getDetailRowValue(rows, 'port');
    const protocolValue = getDetailRowValue(rows, 'protocol');
    return [
      ...(hostValue ? [{ label: 'Host', value: hostValue }] : []),
      ...(portValue ? [{ label: 'Port', value: portValue }] : []),
      ...(protocolValue ? [{ label: 'Protocol', value: protocolValue }] : []),
      ...(!hostValue && !portValue && !protocolValue
        ? [{ value: 'Add a foreign server' }]
        : []),
    ];
  }

  if (requestType === 'PUBLISH_QDN_RESOURCE') {
    return [
      { value: 'Publish data to QDN using your account' },
      ...(serviceValue ? [{ label: 'Content type', value: formatServiceName(serviceValue) }] : []),
      ...(nameValue ? [{ label: 'Name', value: nameValue }] : []),
    ];
  }

  if (requestType === 'CREATE_GROUP') {
    const typeValue = getDetailRowValue(rows, 'type');
    return [
      ...(message.highlightedText
        ? [{ label: 'Group name', value: message.highlightedText.replace(/^group name:\s*/iu, '') }]
        : []),
      ...(typeValue ? [{ label: 'Type', value: formatGroupType(typeValue) }] : []),
      { value: 'This action will create a group' },
    ];
  }

  if (requestType === 'PUBLISH_MULTIPLE_QDN_RESOURCES') {
    const { resourceCount } = parsePublishMultipleSummary(message.html);
    return [
      { value: 'Publish multiple QDN resources using your account' },
      ...(resourceCount > 0
        ? [{ label: 'Resource count', value: `${resourceCount}` }]
        : []),
    ];
  }

  if (requestType === 'SEND_COIN') {
    return [
      ...(message.highlightedText ? [{ label: 'Amount', value: message.highlightedText }] : []),
      ...(recipientValue ? [{ label: 'Recipient address', value: recipientValue }] : []),
      ...(!message.highlightedText && !recipientValue
        ? [{ value: 'Send a payment' }]
        : []),
    ];
  }

  if (
    requestType === 'GET_USER_WALLET' ||
    requestType === 'GET_USER_WALLET_INFO' ||
    requestType === 'GET_USER_WALLET_TRANSACTIONS'
  ) {
    return [
      { value: 'This app can view wallet-related information from your Qortal account' },
      ...(message.highlightedText ? [{ label: 'Wallet', value: message.highlightedText.replace(/^coin:\s*/iu, '') }] : []),
    ];
  }

  if (requestType === 'GET_WALLET_BALANCE') {
    return [{ value: 'This app can view your wallet balance' }];
  }

  if (requestType === 'SIGN_TRANSACTION') {
    const txType = getJsonValue(message.json, ['type']);
    const recipient = getJsonValue(message.json, ['recipient', 'recipientAddress']);
    const amount = getJsonValue(message.json, ['amount', 'amountQort']);
    const fieldRows = [
      ...(txType != null ? [{ label: 'Transaction type', value: String(txType) }] : []),
      ...(recipient != null ? [{ label: 'Recipient address', value: String(recipient) }] : []),
      ...(amount != null ? [{ label: 'Amount', value: String(amount) }] : []),
    ];
    return fieldRows.length > 0 ? fieldRows : [{ value: 'Sign a transaction' }];
  }

  if (requestType === 'REMOVE_FOREIGN_SERVER') {
    return [{ value: 'This action will remove a saved foreign server configuration' }];
  }

  if (requestType === 'SET_CURRENT_FOREIGN_SERVER') {
    return [{ value: 'This action will change the foreign server currently in use' }];
  }

  const summaryRows = rows.slice(0, message.highlightedText ? 1 : 2);

  if (requestType === 'ADD_GROUP_ADMIN') {
    return summaryRows.length > 0 ? summaryRows : [{ value: 'Add a group admin' }];
  }

  if (requestType === 'CREATE_GROUP') {
    return summaryRows.length > 0 ? summaryRows : [{ value: 'Create a group' }];
  }

  if (requestType === 'MULTI_ASSET_PAYMENT_WITH_PRIVATE_DATA') {
    return [
      { value: 'Send a payment' },
      { value: 'Publish private data' },
    ];
  }

  if (message.highlightedText) {
    return [{ value: message.highlightedText }, ...summaryRows];
  }

  return summaryRows.length > 0
    ? summaryRows
    : [{ value: buildFallbackActionSentence(requestType) }];
};

const buildFeeItems = (
  message: MessageQortalRequestExtension,
  t: (key: string, options?: Record<string, unknown>) => string
) => {
  const feeItems: PermissionDetailRow[] = [];

  if (message.fee) {
    feeItems.push({
      label: message.requestType === 'CREATE_GROUP' ? 'Fee' : 'Network fee',
      value: formatCurrencyValue(message.fee),
    });
  }

  if (message.appFee) {
    feeItems.push({
      label: t('core:message.generic.fee_qort', {
        fee: message.appFee,
        postProcess: 'capitalizeFirstChar',
      }).split(':')[0] || 'App fee',
      value: formatCurrencyValue(message.appFee),
    });
  }

  if (message.foreignFee) {
    feeItems.push({
      label: t('core:message.generic.foreign_fee', {
        fee: message.foreignFee,
        postProcess: 'capitalizeFirstChar',
      }).split(':')[0] || 'Foreign fee',
      value: formatCurrencyValue(message.foreignFee, ''),
    });
  }

  return feeItems;
};

const buildDetailsSections = (message: MessageQortalRequestExtension) => {
  const sections: PermissionDetailSection[] = [];

  const rows = [message.text2, message.text3, message.text4]
    .map(parseDetailRow)
    .filter(Boolean) as PermissionDetailRow[];

  const summaryRows = buildSummaryItems(message, () => '');
  const summaryKeys = new Set(summaryRows.map((row) => `${row.label}:${row.value}`));
  const fallbackRows = rows.filter((row) => !summaryKeys.has(`${row.label}:${row.value}`));

  const technicalRows: PermissionDetailRow[] = [];
  const technicalKeys = new Set<string>();
  const normalizeLabel = (label?: string) => (label || '').trim().toLowerCase();
  const pushTechnicalRow = (row?: PermissionDetailRow | null) => {
    if (!row) return;
    const key = `${normalizeLabel(row.label)}:${row.value}`;
    if (technicalKeys.has(key)) return;
    technicalKeys.add(key);
    technicalRows.push(row);
  };

  pushTechnicalRow(
    message.requestType ? { label: 'Request type', value: message.requestType } : null
  );

  for (const section of message.technicalDetails || []) {
    if (section.title?.trim().toLowerCase() === 'original message') {
      continue;
    }
    for (const row of section.rows || []) {
      pushTechnicalRow(row);
    }
  }

  for (const row of fallbackRows) {
    pushTechnicalRow(row);
  }

  if (technicalRows.length > 0) {
    sections.push({ title: 'Technical details', rows: technicalRows });
  }

  const shouldShowHtmlPayload =
    !!message.html && message.requestType !== 'PUBLISH_MULTIPLE_QDN_RESOURCES';

  if (shouldShowHtmlPayload) {
    sections.push({ title: 'Request payload', html: message.html });
  }

  if (message.json) {
    sections.push({ title: 'Raw payload', json: message.json });
  }

  return sections;
};

const normalizePresentationText = (value?: string) => {
  return (value || '')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[.!?]+$/u, '')
    .toLowerCase();
};

export const buildPermissionPresentation = (
  message: MessageQortalRequestExtension,
  t: (key: string, options?: Record<string, unknown>) => string
): PermissionPresentation => {
  const summaryItems = buildSummaryItems(message, t);
  const body = buildBody(message, t);
  const firstSummaryLine = summaryItems.find((item) => !item.label)?.value;
  const resolvedBody =
    normalizePresentationText(body) === normalizePresentationText(firstSummaryLine) ? '' : body;

  return {
    sourceLabel: message.sourceLabel,
    sourceKind: message.sourceKind || 'Application',
    title: buildTitle(message),
    body: resolvedBody,
    summaryItems,
    feeItems: buildFeeItems(message, t),
    detailsSections: buildDetailsSections(message),
  };
};
