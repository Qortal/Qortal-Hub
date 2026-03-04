import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { CountdownCircleTimer } from 'react-countdown-circle-timer';
import { TextP } from '../../styles/App-styles.ts';

type CountdownOverlayProps = {
  countdown: number;
  onComplete: () => void;
};

export function CountdownOverlay({ countdown, onComplete }: CountdownOverlayProps) {
  return (
    <Box
      style={{
        left: '20px',
        position: 'absolute',
        top: '20px',
      }}
    >
      <CountdownCircleTimer
        isPlaying
        duration={countdown}
        colors={['#004777', '#F7B801', '#A30000', '#A30000']}
        colorsTime={[7, 5, 2, 0]}
        onComplete={onComplete}
        size={75}
        strokeWidth={8}
      >
        {({ remainingTime }) => <TextP>{remainingTime}</TextP>}
      </CountdownCircleTimer>
    </Box>
  );
}
