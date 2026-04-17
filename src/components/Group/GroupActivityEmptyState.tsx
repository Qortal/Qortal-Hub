import { Box, Button, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  GroupActivityEmptyStateGraphic,
  type GroupActivityEmptyStateGraphicVariant,
} from './GroupActivityEmptyStateGraphic';

type GroupActivityEmptyStateProps = {
  compact?: boolean;
  title: string;
  secondaryLines: [string, string] | string[];
  tertiaryText?: string;
  ctaLabel: string;
  onCtaClick: () => void;
  graphicVariant?: GroupActivityEmptyStateGraphicVariant;
};

export const GroupActivityEmptyState = ({
  compact = false,
  title,
  secondaryLines,
  tertiaryText,
  ctaLabel,
  onCtaClick,
  graphicVariant = 'requests',
}: GroupActivityEmptyStateProps) => {
  const theme = useTheme();

  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        margin: '0 auto',
        maxWidth: '360px',
        transform: compact ? 'translateY(-44px)' : 'translateY(-40px)',
        textAlign: 'center',
        width: '100%',
      }}
      className="group-empty-state"
    >
      <GroupActivityEmptyStateGraphic
        size={compact ? 292 : 254}
        variant={graphicVariant}
      />
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexDirection: 'column',
          maxWidth: '360px',
          width: '100%',
        }}
      >
        <Typography
          className="group-empty-title"
          sx={{
            color:
              theme.palette.mode === 'dark'
                ? 'rgba(255, 255, 255, 0.96)'
                : alpha(theme.palette.text.primary, 0.94),
            fontSize: compact ? '1.18rem' : '1.25rem',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            lineHeight: 1.15,
            margin: '0 0 12px',
          }}
        >
          {title}
        </Typography>
        <Typography
          className="group-empty-copy"
          component="div"
          sx={{
            color:
              theme.palette.mode === 'dark'
                ? 'rgba(221, 229, 243, 0.72)'
                : alpha(theme.palette.text.primary, 0.68),
            fontSize: compact ? '1rem' : '1.0625rem',
            fontWeight: 500,
            letterSpacing: '-0.015em',
            lineHeight: 1.34,
            margin: 0,
            maxWidth: '340px',
          }}
        >
          {secondaryLines.map((line) => (
            <Box
              key={line}
              component="span"
              className="group-empty-copy--secondary-break"
              sx={{ display: 'block' }}
            >
              {line}
            </Box>
          ))}
        </Typography>
        {tertiaryText ? (
          <Typography
            className="group-empty-copy"
            component="p"
            sx={{
              color:
                theme.palette.mode === 'dark'
                  ? 'rgba(221, 229, 243, 0.58)'
                  : alpha(theme.palette.text.primary, 0.56),
              fontSize: compact ? '1rem' : '1.0625rem',
              fontWeight: 500,
              letterSpacing: '-0.015em',
              lineHeight: 1.45,
              margin: '10px 0 0',
              maxWidth: '296px',
            }}
          >
            {tertiaryText}
          </Typography>
        ) : null}
      </Box>
      <Box className="group-empty-cta-wrap" sx={{ marginTop: '18px' }}>
        <Button
          className="group-empty-cta"
          variant="contained"
          disableElevation
          onClick={onCtaClick}
          sx={{
            appearance: 'none',
            background:
              'linear-gradient(180deg, #8fb8f3 0%, #79aaf0 42%, #6fa3f0 100%)',
            border: '1px solid rgba(143, 184, 243, 0.22)',
            borderRadius: '999px',
            boxShadow:
              '0 6px 18px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(255, 255, 255, 0.03) inset, 0 0 18px rgba(132, 175, 240, 0.18)',
            color: 'rgba(10, 18, 30, 0.92)',
            fontSize: '15px',
            fontWeight: 600,
            letterSpacing: '-0.01em',
            lineHeight: 1,
            minHeight: '46px',
            minWidth: '168px',
            padding: '12px 22px',
            textTransform: 'none',
            transition:
              'transform 180ms ease, box-shadow 180ms ease, filter 180ms ease, background 180ms ease',
            '&:hover': {
              background:
                'linear-gradient(180deg, #98bff6 0%, #83b1f3 42%, #76a7f1 100%)',
              boxShadow:
                '0 8px 22px rgba(0, 0, 0, 0.32), 0 0 0 1px rgba(255, 255, 255, 0.04) inset, 0 0 22px rgba(132, 175, 240, 0.22)',
              filter: 'saturate(1.02)',
            },
            '&:active': {
              background:
                'linear-gradient(180deg, #7faef0 0%, #6f9fe7 100%)',
              boxShadow:
                '0 4px 12px rgba(0, 0, 0, 0.24), 0 0 0 1px rgba(255, 255, 255, 0.02) inset, 0 0 12px rgba(132, 175, 240, 0.14)',
              transform: 'translateY(1px)',
            },
            '&:focus-visible': {
              boxShadow:
                '0 0 0 2px rgba(132, 175, 240, 0.28), 0 6px 18px rgba(0, 0, 0, 0.28), 0 0 18px rgba(132, 175, 240, 0.18)',
              outline: 'none',
            },
          }}
        >
          {ctaLabel}
        </Button>
      </Box>
    </Box>
  );
};
