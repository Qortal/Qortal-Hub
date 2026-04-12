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

const REQUEST_ACTION_LABELS: Record<string, string> = {
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

const humanizeRequestType = (requestType?: string) => {
  if (!requestType) return 'make a change to your account';
  if (REQUEST_ACTION_LABELS[requestType]) return REQUEST_ACTION_LABELS[requestType];
  return 'make a change to your account';
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

const buildTitle = (message: MessageQortalRequestExtension) => {
  if (message.summaryTitle) return message.summaryTitle;

  const sourceLabel = message.sourceLabel?.trim();
  const requestType = message.requestType;
  const actionLabel = humanizeRequestType(requestType);

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
      return 'This app can confirm your Qortal identity. It cannot send payments or publish data.';
    case 'SESSION_PERMISSIONS':
      return 'Approved permissions can run automatically for this session only.';
    case 'ADD_FOREIGN_SERVER':
      return 'This adds a foreign server configuration to your Qortal environment.';
    case 'PUBLISH_QDN_RESOURCE':
      return (
        QDN_SERVICE_SUMMARIES[serviceValue] ||
        `This action will publish data to QDN using the ${serviceValue || 'selected'} service.`
      );
    case 'PUBLISH_MULTIPLE_QDN_RESOURCES':
      return 'Multiple QDN resources will be published using your account.';
    case 'SEND_COIN':
      return 'This sends funds from your wallet to the specified recipient.';
    case 'SIGN_TRANSACTION':
      return 'This app wants your account to sign a transaction.';
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
      return 'Review the details of this action before approving.';
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
    return [
      { value: 'This app can confirm your Qortal identity' },
      { value: 'It cannot send payments' },
      { value: 'It will not publish data' },
    ];
  }

  if (requestType === 'SESSION_PERMISSIONS') {
    return [
      {
        value: 'Approved permissions can run automatically for this session only',
      },
      { value: 'These permissions stop when the session ends' },
    ];
  }

  if (requestType === 'ADD_FOREIGN_SERVER') {
    return [
      { value: 'This action will add a foreign server configuration' },
      { value: 'Make sure you trust the server details below.' },
    ];
  }

  if (requestType === 'PUBLISH_QDN_RESOURCE') {
    return [
      { value: 'This will publish data to QDN using your account' },
      ...(serviceValue ? [{ label: 'Content type', value: formatServiceName(serviceValue) }] : []),
      ...(nameValue ? [{ label: 'Publishing name', value: nameValue }] : []),
    ];
  }

  if (requestType === 'PUBLISH_MULTIPLE_QDN_RESOURCES') {
    const { resourceCount, includesPrivateData } = parsePublishMultipleSummary(message.html);
    return [
      { value: 'Multiple QDN resources will be published using your account' },
      ...(includesPrivateData
        ? [{ value: 'Some resources include private or encrypted data' }]
        : []),
      ...(resourceCount > 0
        ? [{ label: 'Resources in this request', value: `${resourceCount}` }]
        : []),
    ];
  }

  if (requestType === 'SEND_COIN') {
    return [
      ...(message.highlightedText ? [{ label: 'Amount', value: message.highlightedText }] : []),
      ...(recipientValue ? [{ label: 'Recipient', value: recipientValue }] : []),
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
    return [
      { value: 'This app can view your wallet balance' },
      ...(message.text1?.includes('{{ coin }}') ? [] : []),
    ];
  }

  if (requestType === 'SIGN_TRANSACTION') {
    const txType = getJsonValue(message.json, ['type']);
    const recipient = getJsonValue(message.json, ['recipient', 'recipientAddress']);
    const amount = getJsonValue(message.json, ['amount', 'amountQort']);
    return [
      { value: 'This app wants your account to sign a transaction' },
      ...(txType != null ? [{ label: 'Transaction type', value: String(txType) }] : []),
      ...(recipient != null ? [{ label: 'Recipient', value: String(recipient) }] : []),
      ...(amount != null ? [{ label: 'Amount', value: String(amount) }] : []),
    ];
  }

  if (requestType === 'REMOVE_FOREIGN_SERVER') {
    return [
      { value: 'This action will remove a saved foreign server configuration' },
      { value: 'Review the server details below before approving' },
    ];
  }

  if (requestType === 'SET_CURRENT_FOREIGN_SERVER') {
    return [
      { value: 'This action will change the foreign server currently in use' },
      { value: 'Review the server details below before approving' },
    ];
  }

  const summaryRows = rows.slice(0, message.highlightedText ? 1 : 2);
  if (message.highlightedText) {
    return [{ value: message.highlightedText }, ...summaryRows];
  }

  if (summaryRows.length > 0) {
    return summaryRows;
  }

  return [
    { value: 'This action will modify your Qortal account or data' },
    { value: 'Review the technical details below before approving' },
  ];
};

const buildFeeItems = (
  message: MessageQortalRequestExtension,
  t: (key: string, options?: Record<string, unknown>) => string
) => {
  const feeItems: PermissionDetailRow[] = [];

  if (message.fee) {
    feeItems.push({ label: 'Network fee', value: `${message.fee} QORT` });
  }

  if (message.appFee) {
    feeItems.push({
      label: t('core:message.generic.fee_qort', {
        fee: message.appFee,
        postProcess: 'capitalizeFirstChar',
      }).split(':')[0] || 'App fee',
      value: `${message.appFee} QORT`,
    });
  }

  if (message.foreignFee) {
    feeItems.push({
      label: t('core:message.generic.foreign_fee', {
        fee: message.foreignFee,
        postProcess: 'capitalizeFirstChar',
      }).split(':')[0] || 'Foreign fee',
      value: message.foreignFee,
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

export const buildPermissionPresentation = (
  message: MessageQortalRequestExtension,
  t: (key: string, options?: Record<string, unknown>) => string
): PermissionPresentation => {
  return {
    sourceLabel: message.sourceLabel,
    sourceKind: message.sourceKind || 'Application',
    title: buildTitle(message),
    body: buildBody(message, t),
    summaryItems: buildSummaryItems(message, t),
    feeItems: buildFeeItems(message, t),
    detailsSections: buildDetailsSections(message),
  };
};
