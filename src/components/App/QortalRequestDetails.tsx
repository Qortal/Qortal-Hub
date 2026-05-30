import { Box, Typography, alpha, useTheme } from '@mui/material';

type ResourceDetail = {
  service?: unknown;
  name?: unknown;
  identifier?: unknown;
  filename?: unknown;
};

type PaymentDetail = {
  recipientAddress?: unknown;
  amount?: unknown;
};

export type QortalRequestDetailsData =
  | {
      type: 'sessionPermissions';
      permissions: unknown[];
    }
  | {
      type: 'resources';
      resources: ResourceDetail[];
    }
  | {
      type: 'buyOrderFees';
      unlockLabel: string;
      unlockAmount: unknown;
      ticker: unknown;
      unlockDescription: string;
      lockLabel: string;
      lockDescription: string;
    }
  | {
      type: 'paymentsAndResources';
      payments: PaymentDetail[];
      resources: ResourceDetail[];
    };

type QortalRequestDetailsProps = {
  details?: QortalRequestDetailsData;
};

const valueToText = (value: unknown): string => String(value ?? '');

export function QortalRequestDetails({ details }: QortalRequestDetailsProps) {
  const theme = useTheme();

  if (!details) return null;

  const cardSx = {
    backgroundColor: theme.palette.background.default,
    border: `1px solid ${alpha(theme.palette.text.primary, 0.22)}`,
    borderRadius: '8px',
    display: 'grid',
    gap: '8px',
    margin: '8px 0',
    padding: '16px',
  };

  const fieldSx = {
    display: 'grid',
    gap: '2px',
    minWidth: 0,
  };

  const labelSx = {
    color: theme.palette.text.primary,
    fontSize: '13px',
    fontWeight: 700,
  };

  const valueSx = {
    color: theme.palette.text.primary,
    fontSize: '14px',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
  };

  const renderField = (label: string, value: unknown) => (
    <Box sx={fieldSx}>
      <Typography sx={labelSx}>{label}</Typography>
      <Typography sx={valueSx}>{valueToText(value)}</Typography>
    </Box>
  );

  const renderResource = (resource: ResourceDetail, index: number) => (
    <Box
      key={`${valueToText(resource.service)}-${valueToText(
        resource.identifier
      )}-${index}`}
      sx={{
        ...cardSx,
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
      }}
    >
      {renderField('Service', resource.service)}
      {renderField('Name', resource.name)}
      {renderField('Identifier', resource.identifier)}
      {resource.filename ? renderField('Filename', resource.filename) : null}
    </Box>
  );

  return (
    <Box
      sx={{
        maxHeight: { xs: '34vh', sm: '40vh' },
        overflowY: 'auto',
        width: '100%',
      }}
    >
      {details.type === 'sessionPermissions' &&
        details.permissions.map((permission, index) => (
          <Box
            key={`${valueToText(permission)}-${index}`}
            sx={{
              backgroundColor: theme.palette.background.paper,
              border: `1px solid ${alpha(theme.palette.text.primary, 0.16)}`,
              borderRadius: '4px',
              margin: '4px 0',
              padding: '8px 12px',
            }}
          >
            <Typography
              sx={{
                color: theme.palette.text.primary,
                fontFamily: 'monospace',
                fontSize: '14px',
                overflowWrap: 'anywhere',
              }}
            >
              {valueToText(permission)}
            </Typography>
          </Box>
        ))}

      {details.type === 'resources' &&
        details.resources.map((resource, index) =>
          renderResource(resource, index)
        )}

      {details.type === 'buyOrderFees' && (
        <Box sx={cardSx}>
          {renderField(
            details.unlockLabel,
            `${valueToText(details.unlockAmount)} ${valueToText(details.ticker)}`
          )}
          <Typography sx={{ ...valueSx, marginBottom: '8px' }}>
            {details.unlockDescription}
          </Typography>
          {renderField(details.lockLabel, details.lockDescription)}
        </Box>
      )}

      {details.type === 'paymentsAndResources' && (
        <>
          {details.payments.map((payment, index) => (
            <Box
              key={`${valueToText(payment.recipientAddress)}-${index}`}
              sx={{
                ...cardSx,
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, minmax(0, 1fr))',
                },
              }}
            >
              {renderField('Recipient', payment.recipientAddress)}
              {renderField('Amount', payment.amount)}
            </Box>
          ))}
          {details.resources.map((resource, index) =>
            renderResource(resource, index)
          )}
        </>
      )}
    </Box>
  );
}
