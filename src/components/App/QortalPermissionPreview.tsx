import { Box, Chip, FormControlLabel, MenuItem, Select, Switch, Typography, alpha, useTheme } from '@mui/material';
import { useMemo, useState } from 'react';
import { QortalPermissionCard } from './QortalRequestExtensionDialog';
import {
  MODAL_REQUEST_TYPES,
  type MessageQortalRequestExtension,
} from './qortalPermissionPresentation';

const PRIORITY_REQUESTS = [
  'GET_USER_ACCOUNT',
  'SESSION_PERMISSIONS',
  'PUBLISH_QDN_RESOURCE',
  'PUBLISH_MULTIPLE_QDN_RESOURCES',
  'SEND_COIN',
  'SIGN_TRANSACTION',
];

const orderedRequestTypes = [
  ...PRIORITY_REQUESTS,
  ...MODAL_REQUEST_TYPES.filter((requestType) => !PRIORITY_REQUESTS.includes(requestType)),
];

const createPreviewMessage = (
  requestType: string,
  includeSource: boolean,
  includeRemember: boolean,
  countdownDuration: number
): MessageQortalRequestExtension => {
  const baseMessage: MessageQortalRequestExtension = {
    requestType,
    countdownDuration,
    sourceKind: 'Q-App',
    sourceLabel: includeSource ? 'Q-Tube' : undefined,
    technicalDetails: [{ rows: [{ label: 'Request type', value: requestType }] }],
  };

  if (includeRemember) {
    baseMessage.checkbox1 = {
      label: 'Always allow this automatically',
      value: false,
    };
  }

  switch (requestType) {
    case 'GET_USER_ACCOUNT':
      return {
        ...baseMessage,
        summaryBody:
          'This confirms your Qortal identity for the application. It does not send a payment or publish data.',
        technicalDetails: [
          {
            rows: [
              { label: 'Request type', value: requestType },
              { label: 'Granted account field', value: 'Primary account identity' },
            ],
          },
        ],
      };
    case 'SESSION_PERMISSIONS':
      return {
        ...baseMessage,
        confirmCheckbox: true,
        confirmCheckboxLabel: 'I trust this app and understand these permissions will auto-execute',
        technicalDetails: [
          {
            rows: [
              { label: 'Request type', value: requestType },
              { label: 'Requested permissions', value: 'GET_USER_ACCOUNT, PUBLISH_QDN_RESOURCE, SIGN_TRANSACTION' },
              { label: 'Scope', value: 'Current session only' },
            ],
          },
        ],
      };
    case 'PUBLISH_QDN_RESOURCE':
      return {
        ...baseMessage,
        text2: 'service: DOCUMENT',
        text3: 'identifier: grp-42-thread-abc123',
        text4: 'name: q-tube',
        fee: '0.10000000',
        technicalDetails: [
          {
            rows: [
              { label: 'Request type', value: requestType },
              { label: 'Service', value: 'DOCUMENT' },
              { label: 'Identifier', value: 'grp-42-thread-abc123' },
              { label: 'Name', value: 'q-tube' },
            ],
          },
        ],
      };
    case 'PUBLISH_MULTIPLE_QDN_RESOURCES':
      return {
        ...baseMessage,
        fee: '0.20000000',
        html: `
          <div class="resource-container">
            <div class="resource-detail"><span>Service:</span> IMAGE</div>
            <div class="resource-detail"><span>Identifier:</span> grp-q-manager_1_group_42_abcd</div>
            <div class="resource-detail"><span>Name:</span> q-tube</div>
          </div>
          <div class="resource-container">
            <div class="resource-detail"><span>Service:</span> DOCUMENT_PRIVATE</div>
            <div class="resource-detail"><span>Identifier:</span> episode-notes-42</div>
            <div class="resource-detail"><span>Name:</span> q-tube</div>
          </div>
        `,
        technicalDetails: [
          {
            rows: [
              { label: 'Request type', value: requestType },
              { value: 'Resource 1' },
              { label: 'Service', value: 'IMAGE' },
              { label: 'Identifier', value: 'grp-q-manager_1_group_42_abcd' },
              { label: 'Name', value: 'q-tube' },
              { value: 'Resource 2' },
              { label: 'Service', value: 'DOCUMENT_PRIVATE' },
              { label: 'Identifier', value: 'episode-notes-42' },
              { label: 'Name', value: 'q-tube' },
            ],
          },
        ],
      };
    case 'SEND_COIN':
      return {
        ...baseMessage,
        text2: 'to: Qabc123receiver',
        highlightedText: '5 QORT',
        fee: '0.00100000',
      };
    case 'SIGN_TRANSACTION':
      return {
        ...baseMessage,
        summaryBody: 'This app wants your account to sign a transaction. Review the key facts before accepting.',
        json: {
          type: 'Payment',
          recipient: 'Qxyz987destination',
          amount: '5 QORT',
        },
      };
    case 'ADD_FOREIGN_SERVER':
      return {
        ...baseMessage,
        technicalDetails: [
          {
            rows: [
              { label: 'Request type', value: requestType },
              { label: 'Server host', value: 'api.qortalhub.net' },
              { label: 'Server port', value: '12391' },
              { label: 'Protocol', value: 'https' },
            ],
          },
        ],
      };
    default:
      return {
        ...baseMessage,
        technicalDetails: [
          {
            rows: [{ label: 'Request type', value: requestType }],
          },
        ],
      };
  }
};

export function QortalPermissionPreview() {
  const theme = useTheme();
  const [requestType, setRequestType] = useState<string>('GET_USER_ACCOUNT');
  const [includeSource, setIncludeSource] = useState(true);
  const [includeRemember, setIncludeRemember] = useState(true);
  const [countdownDuration, setCountdownDuration] = useState(60);
  const [confirmRequestRead, setConfirmRequestRead] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  const message = useMemo(
    () => createPreviewMessage(requestType, includeSource, includeRemember, countdownDuration),
    [requestType, includeSource, includeRemember, countdownDuration]
  );

  return (
    <Box
      sx={{
        background: theme.palette.mode === 'dark'
          ? 'linear-gradient(180deg, #17191d 0%, #111317 100%)'
          : 'linear-gradient(180deg, #f4f6f8 0%, #ecf0f3 100%)',
        display: 'grid',
        gap: '24px',
        gridTemplateColumns: { md: '320px minmax(0, 1fr)' },
        minHeight: '100vh',
        padding: '24px',
      }}
    >
      <Box
        sx={{
          backgroundColor: alpha(theme.palette.background.paper, 0.84),
          border: `1px solid ${alpha(theme.palette.common.white, 0.08)}`,
          borderRadius: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
          padding: '20px',
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Chip label="Dev-only preview" sx={{ alignSelf: 'flex-start' }} />
          <Typography sx={{ fontSize: '24px', fontWeight: 700 }}>Qortal permission modal preview</Typography>
          <Typography sx={{ color: theme.palette.text.secondary, fontSize: '14px', lineHeight: 1.5 }}>
            This page renders the same permission card used by the real modal so common flows and edge cases can be reviewed locally without triggering real requests.
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <Typography sx={{ color: theme.palette.text.secondary, fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Request type
          </Typography>
          <Select
            value={requestType}
            onChange={(event) => {
              setRequestType(event.target.value);
              setConfirmRequestRead(false);
              setPreviewKey((value) => value + 1);
            }}
            size="small"
          >
            {orderedRequestTypes.map((item) => (
              <MenuItem key={item} value={item}>
                {item}
              </MenuItem>
            ))}
          </Select>
        </Box>

        <FormControlLabel
          control={
            <Switch
              checked={includeSource}
              onChange={(event) => {
                setIncludeSource(event.target.checked);
                setPreviewKey((value) => value + 1);
              }}
            />
          }
          label="Show source identity"
        />
        <FormControlLabel
          control={
            <Switch
              checked={includeRemember}
              onChange={(event) => {
                setIncludeRemember(event.target.checked);
                setPreviewKey((value) => value + 1);
              }}
            />
          }
          label="Show remember option"
        />

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <Typography sx={{ color: theme.palette.text.secondary, fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Countdown state
          </Typography>
          <Select
            value={countdownDuration}
            onChange={(event) => {
              setCountdownDuration(Number(event.target.value));
              setPreviewKey((value) => value + 1);
            }}
            size="small"
          >
            <MenuItem value={60}>60 seconds</MenuItem>
            <MenuItem value={15}>15 seconds</MenuItem>
            <MenuItem value={5}>5 seconds</MenuItem>
          </Select>
        </Box>

        <Typography sx={{ color: theme.palette.text.secondary, fontSize: '13px', lineHeight: 1.5 }}>
          Priority flows are listed first: authentication, session permissions, and QDN publishing. The remaining items cover every request type that currently uses the permission modal flow.
        </Typography>
      </Box>

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'center',
          minHeight: '70vh',
          padding: { xs: 0, md: '12px' },
        }}
      >
        <QortalPermissionCard
          key={`${requestType}-${includeSource}-${includeRemember}-${countdownDuration}-${previewKey}`}
          message={message}
          confirmRequestRead={confirmRequestRead}
          onConfirmRequestReadChange={setConfirmRequestRead}
          onCheckbox1Change={() => undefined}
          onAccept={() => undefined}
          onCancel={() => undefined}
          onCountdownComplete={() => undefined}
          countdownSeconds={countdownDuration}
        />
      </Box>
    </Box>
  );
}
