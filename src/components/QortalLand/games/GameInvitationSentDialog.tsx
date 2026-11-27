import SportsEsportsRoundedIcon from '@mui/icons-material/SportsEsportsRounded';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  alpha,
  useMediaQuery,
} from '@mui/material';
import {
  gameModalActionsSx,
  gameModalDividerSx,
  gameModalPaperSx,
  gameModalSecondaryButtonSx,
  gameModalTitleSx,
} from './gameModalStyles';

type Props = {
  expiresAt?: number;
  gameTitle: string;
  now: number;
  onCancel: () => void;
  opponentName: string;
};

const INVITATION_DURATION_MS = 60_000;
const RING_RADIUS = 58;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const toIdSegment = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export function GameInvitationSentDialog({
  expiresAt,
  gameTitle,
  now,
  onCancel,
  opponentName,
}: Props) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const remainingMs =
    expiresAt === undefined
      ? INVITATION_DURATION_MS
      : Math.max(0, expiresAt - now);
  const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const progress = Math.min(1, remainingMs / INVITATION_DURATION_MS);
  const dashOffset = RING_CIRCUMFERENCE * (1 - progress);
  const idSegment = toIdSegment(gameTitle);
  const titleId = `${idSegment}-invitation-sent-title`;
  const descriptionId = `${idSegment}-invitation-sent-description`;

  return (
    <Dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      maxWidth={false}
      onClose={(_event, reason) => {
        if (reason === 'escapeKeyDown') onCancel();
      }}
      open
      sx={{
        '& .MuiDialog-container': {
          alignItems: 'center',
          boxSizing: 'border-box',
          pb: '12px',
          pt: { xs: '72px', md: '92px' },
        },
      }}
      PaperProps={{
        sx: {
          ...gameModalPaperSx,
          display: 'flex',
          maxHeight: { xs: 'calc(100dvh - 84px)', md: 'calc(100dvh - 104px)' },
        },
      }}
    >
      <DialogTitle sx={gameModalTitleSx}>
        <Box sx={{ alignItems: 'center', display: 'flex', minHeight: 36 }}>
          <Box
            sx={{
              alignItems: 'center',
              backgroundColor: alpha('#82afea', 0.08),
              border: `1px solid ${alpha('#82afea', 0.28)}`,
              borderRadius: '8px',
              display: 'flex',
              height: 38,
              justifyContent: 'center',
              mr: 1.5,
              width: 38,
            }}
          >
            <SportsEsportsRoundedIcon
              sx={{ color: '#82afea', height: 20, width: 20 }}
            />
          </Box>
          <Typography
            component="span"
            sx={{
              fontSize: 19,
              fontWeight: 700,
              letterSpacing: '-0.018em',
              lineHeight: 1.2,
            }}
          >
            {gameTitle}
          </Typography>
          <Box sx={{ ...gameModalDividerSx, flex: 1, ml: 1.75, mt: 0 }} />
        </Box>
      </DialogTitle>

      <DialogContent
        sx={{
          alignItems: 'center',
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          justifyContent: 'center',
          overflowY: 'auto',
          px: { xs: 2.5, sm: '26px' },
          pb: '20px',
          pt: '6px',
          textAlign: 'center',
        }}
      >
        <Box
          aria-label={`${remainingSeconds} seconds remaining`}
          aria-valuemax={60}
          aria-valuemin={0}
          aria-valuenow={remainingSeconds}
          role="progressbar"
          sx={{
            '@keyframes qortalLandInvitationBreathe': {
              '0%, 100%': {
                filter: 'drop-shadow(0 0 6px rgba(34,216,228,.18))',
                transform: 'scale(1)',
              },
              '50%': {
                filter: 'drop-shadow(0 0 17px rgba(34,216,228,.34))',
                transform: 'scale(1.025)',
              },
            },
            animation: reducedMotion
              ? 'none'
              : 'qortalLandInvitationBreathe 2.4s ease-in-out infinite',
            height: 70,
            mb: 1.5,
            position: 'relative',
            width: 70,
          }}
        >
          <Box
            component="svg"
            viewBox="0 0 150 150"
            sx={{
              display: 'block',
              height: '100%',
              transform: 'rotate(-90deg)',
              width: '100%',
            }}
          >
            <circle
              cx="75"
              cy="75"
              fill="none"
              r="70"
              stroke={alpha('#22d8e4', 0.09)}
              strokeWidth="1"
            />
            <circle
              cx="75"
              cy="75"
              fill={alpha('#041421', 0.56)}
              r="52"
              stroke={alpha('#22d8e4', 0.2)}
              strokeWidth="1"
            />
            <circle
              cx="75"
              cy="75"
              fill="none"
              r={RING_RADIUS}
              stroke={alpha('#22d8e4', 0.14)}
              strokeWidth="4"
            />
            <circle
              cx="75"
              cy="75"
              fill="none"
              r={RING_RADIUS}
              stroke="#26e4ed"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              strokeWidth="4"
              style={{
                transition: reducedMotion
                  ? 'none'
                  : 'stroke-dashoffset 700ms linear',
              }}
            />
          </Box>
          <SportsEsportsRoundedIcon
            sx={{
              color: '#2de7ef',
              height: 24,
              left: '50%',
              position: 'absolute',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 24,
            }}
          />
        </Box>

        <Typography
          id={titleId}
          sx={{
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            lineHeight: 1.2,
          }}
        >
          Invitation sent
        </Typography>
        <Typography
          id={descriptionId}
          sx={{ color: '#a9b5c4', fontSize: 14, lineHeight: 1.4, mt: 0.75 }}
        >
          Waiting for {opponentName || 'the other player'} to respond...
        </Typography>
        <Box
          aria-hidden
          sx={{
            alignItems: 'center',
            display: 'flex',
            my: 1.5,
            width: 'min(100%, 250px)',
          }}
        >
          <Box
            sx={{
              background: `linear-gradient(90deg, transparent, ${alpha('#22d8e4', 0.8)})`,
              height: '1px',
              flex: 1,
            }}
          />
          <Box
            sx={{
              backgroundColor: '#22d8e4',
              borderRadius: '50%',
              boxShadow: `0 0 10px ${alpha('#22d8e4', 0.85)}`,
              height: 5,
              mx: 0.5,
              width: 5,
            }}
          />
          <Box
            sx={{
              background: `linear-gradient(90deg, ${alpha('#22d8e4', 0.8)}, transparent)`,
              height: '1px',
              flex: 1,
            }}
          />
        </Box>
        <Typography sx={{ color: '#9aa8b8', fontSize: 12.5, lineHeight: 1.4 }}>
          Invitation expires automatically after 60 seconds.
        </Typography>
      </DialogContent>

      <DialogActions sx={gameModalActionsSx}>
        <Button autoFocus onClick={onCancel} sx={gameModalSecondaryButtonSx}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}
