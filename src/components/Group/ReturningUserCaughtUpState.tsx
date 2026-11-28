import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import { Box, Button, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import qortalOfficialLogo from '../../assets/sidebar/qortal-logo-official.webp';
import chatBubbleDots from '../../assets/qchat/caught-up-chat-dots.webp';
import chatBubbleLines from '../../assets/qchat/caught-up-chat-lines.webp';
import { QChatWhatsNewDialog } from './QChatWhatsNewDialog';

type ReturningUserCaughtUpStateProps = {
  displayName?: string;
  onBrowseCommunities: () => void;
};

const SPARKLES = [
  { height: 3, left: '17%', top: '29%', width: 3 },
  { height: 4, left: '25%', top: '69%', width: 4 },
  { height: 3, left: '35%', top: '17%', width: 3 },
  { height: 3, right: '34%', top: '24%', width: 3 },
  { height: 4, right: '22%', top: '65%', width: 4 },
  { height: 3, right: '14%', top: '36%', width: 3 },
];

export function ReturningUserCaughtUpState({
  displayName,
  onBrowseCommunities,
}: ReturningUserCaughtUpStateProps) {
  const [isWhatsNewOpen, setIsWhatsNewOpen] = useState(false);
  const logoRef = useRef<HTMLImageElement | null>(null);
  const leftBubbleRef = useRef<HTMLImageElement | null>(null);
  const rightBubbleRef = useRef<HTMLImageElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);
  const sparkleRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const logo = logoRef.current;
    const leftBubble = leftBubbleRef.current;
    const rightBubble = rightBubbleRef.current;
    const glow = glowRef.current;
    const sparkles = sparkleRefs.current.filter(
      (sparkle): sparkle is HTMLDivElement => Boolean(sparkle)
    );
    if (!logo || !leftBubble || !rightBubble || !glow) return;

    const animations = [
      logo.animate(
        [
          { transform: 'translate(-50%, -50%) translateY(0)' },
          { transform: 'translate(-50%, -50%) translateY(-4px)' },
          { transform: 'translate(-50%, -50%) translateY(0)' },
        ],
        { duration: 5000, easing: 'ease-in-out', iterations: Infinity }
      ),
      leftBubble.animate(
        [
          { transform: 'translate(0, 0) rotate(-2deg)' },
          { transform: 'translate(-8px, -11px) rotate(1deg)' },
          { transform: 'translate(0, 0) rotate(-2deg)' },
        ],
        { duration: 4100, easing: 'ease-in-out', iterations: Infinity }
      ),
      rightBubble.animate(
        [
          { transform: 'translate(0, 0) rotate(2deg)' },
          { transform: 'translate(9px, -9px) rotate(-1deg)' },
          { transform: 'translate(0, 0) rotate(2deg)' },
        ],
        { duration: 4550, easing: 'ease-in-out', iterations: Infinity }
      ),
      glow.animate(
        [
          { opacity: 0.52, transform: 'translate(-50%, -50%) scale(0.96)' },
          { opacity: 0.78, transform: 'translate(-50%, -50%) scale(1.04)' },
          { opacity: 0.52, transform: 'translate(-50%, -50%) scale(0.96)' },
        ],
        { duration: 6000, easing: 'ease-in-out', iterations: Infinity }
      ),
      ...sparkles.map((sparkle, index) =>
        sparkle.animate(
          [
            { opacity: 0.2, transform: 'translateY(0) scale(0.7)' },
            { opacity: 0.85, transform: 'translateY(-4px) scale(1.12)' },
            { opacity: 0.2, transform: 'translateY(0) scale(0.7)' },
          ],
          {
            delay: index * 230,
            duration: 2700 + index * 190,
            easing: 'ease-in-out',
            iterations: Infinity,
          }
        )
      ),
    ];

    return () => animations.forEach((animation) => animation.cancel());
  }, []);

  return (
    <Box
      sx={{
        alignItems: 'center',
        boxSizing: 'border-box',
        display: 'flex',
        height: '100%',
        justifyContent: 'center',
        overflowX: 'hidden',
        overflowY: 'auto',
        position: 'relative',
        px: 3,
        py: { xs: 7, md: 8 },
        width: '100%',
      }}
    >
      <Button
        onClick={() => setIsWhatsNewOpen(true)}
        variant="outlined"
        sx={{
          borderColor: 'rgba(151, 161, 178, 0.35)',
          borderRadius: '8px',
          color: 'text.secondary',
          fontSize: 13,
          fontWeight: 650,
          position: 'absolute',
          right: { xs: 16, sm: 24 },
          textTransform: 'none',
          top: { xs: 16, sm: 24 },
          zIndex: 3,
          '&:hover': {
            backgroundColor: 'rgba(255, 255, 255, 0.055)',
            borderColor: 'rgba(151, 161, 178, 0.58)',
            color: 'text.primary',
          },
        }}
      >
        What's New?
      </Button>

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexDirection: 'column',
          maxWidth: 620,
          textAlign: 'center',
          width: '100%',
        }}
      >
        <Typography
          component="h2"
          sx={{
            color: 'text.primary',
            fontSize: { xs: 29, md: 34 },
            fontWeight: 700,
            letterSpacing: '-0.025em',
            lineHeight: 1.16,
            mb: 1.5,
          }}
        >
          {displayName ? `Welcome back, ${displayName}!` : 'Welcome back!'}
        </Typography>
        <Typography
          sx={{
            color: 'text.secondary',
            fontSize: { xs: 15, md: 16 },
            lineHeight: 1.45,
          }}
        >
          You're all caught up. No new messages right now.
        </Typography>

        <Box
          aria-hidden
          sx={{
            height: { xs: 190, sm: 215 },
            my: { xs: 2.25, sm: 2.75 },
            position: 'relative',
            width: { xs: 300, sm: 370 },
          }}
        >
          <Box
            ref={glowRef}
            sx={{
              background:
                'radial-gradient(circle, rgba(0, 143, 255, 0.3) 0%, rgba(0, 106, 255, 0.13) 42%, transparent 72%)',
              borderRadius: '50%',
              height: { xs: 148, sm: 174 },
              left: '50%',
              position: 'absolute',
              top: '48%',
              transform: 'translate(-50%, -50%)',
              width: { xs: 148, sm: 174 },
            }}
          />
          <Box
            sx={{
              background:
                'radial-gradient(ellipse at center, rgba(24, 142, 255, 0.35) 0%, rgba(18, 104, 210, 0.12) 44%, transparent 75%)',
              bottom: { xs: 12, sm: 13 },
              filter: 'blur(2px)',
              height: 28,
              left: '50%',
              position: 'absolute',
              transform: 'translateX(-50%)',
              width: { xs: 180, sm: 220 },
            }}
          />
          <Box
            component="img"
            ref={logoRef}
            src={qortalOfficialLogo}
            alt=""
            sx={{
              filter: 'drop-shadow(0 10px 18px rgba(0, 129, 255, 0.28))',
              height: { xs: 106, sm: 122 },
              left: '50%',
              position: 'absolute',
              top: '47%',
              transform: 'translate(-50%, -50%)',
              width: { xs: 106, sm: 122 },
              zIndex: 2,
            }}
          />
          <Box
            component="img"
            ref={leftBubbleRef}
            src={chatBubbleDots}
            alt=""
            sx={{
              filter: 'drop-shadow(0 6px 12px rgba(0, 105, 210, 0.22))',
              left: { xs: 13, sm: 31 },
              opacity: 0.72,
              position: 'absolute',
              top: { xs: 68, sm: 76 },
              width: { xs: 65, sm: 75 },
            }}
          />
          <Box
            component="img"
            ref={rightBubbleRef}
            src={chatBubbleLines}
            alt=""
            sx={{
              filter: 'drop-shadow(0 6px 12px rgba(0, 105, 210, 0.22))',
              opacity: 0.72,
              position: 'absolute',
              right: { xs: 12, sm: 28 },
              top: { xs: 88, sm: 98 },
              width: { xs: 65, sm: 75 },
            }}
          />
          {SPARKLES.map((sparkle, index) => (
            <Box
              key={index}
              ref={(element: HTMLDivElement | null) => {
                sparkleRefs.current[index] = element;
              }}
              sx={{
                ...sparkle,
                backgroundColor: 'primary.main',
                borderRadius: '50%',
                boxShadow: '0 0 7px rgba(69, 157, 255, 0.7)',
                position: 'absolute',
                opacity: 0.55,
              }}
            />
          ))}
        </Box>

        <Button
          aria-label="Browse Communities"
          onClick={onBrowseCommunities}
          startIcon={<GroupsRoundedIcon sx={{ fontSize: 16 }} />}
          variant="outlined"
          sx={{
            backgroundColor: 'transparent',
            borderColor: 'rgba(125, 158, 202, 0.42)',
            borderRadius: '8px',
            color: 'text.primary',
            fontSize: '14px',
            fontWeight: 600,
            gap: '9px',
            height: '46px',
            letterSpacing: '-0.005em',
            lineHeight: 1,
            px: '22px',
            textTransform: 'none',
            transition: 'background-color 150ms ease, border-color 150ms ease',
            width: 'clamp(225px, 18vw, 250px)',
            '& .MuiButton-startIcon': {
              margin: 0,
            },
            '&:hover': {
              backgroundColor: 'rgba(38, 48, 64, 0.48)',
              borderColor: 'rgba(87, 157, 255, 0.66)',
            },
            '&:active': {
              backgroundColor: 'rgba(13, 18, 26, 0.62)',
              borderColor: 'rgba(125, 158, 202, 0.36)',
            },
            '&:focus-visible': {
              outline: '2px solid',
              outlineColor: 'primary.main',
              outlineOffset: 2,
            },
          }}
        >
          Browse Communities
        </Button>
        <Typography
          sx={{
            color: 'text.secondary',
            fontSize: 13.5,
            lineHeight: 1.45,
            mt: 1.75,
          }}
        >
          Looking for something new? Discover more communities.
        </Typography>
      </Box>

      <QChatWhatsNewDialog
        onClose={() => setIsWhatsNewOpen(false)}
        open={isWhatsNewOpen}
      />
    </Box>
  );
}
