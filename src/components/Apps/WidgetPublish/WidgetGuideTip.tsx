import { useId, useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  Popover,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WidgetsRoundedIcon from '@mui/icons-material/WidgetsRounded';
import { useTranslation } from 'react-i18next';
import { GuideText } from './WidgetGuideParts';
import {
  WIDGET_GUIDE_TIP_KEYS,
  WIDGET_GUIDE_TIP_TITLE_KEY,
} from './widgetGuide';
import { useLauncherTabDialog } from '../launcherTabs';

/**
 * The (i) beside the Widget option: the short guide in a popover, with Learn
 * more for the whole guide. The form opens it the first time Widget is
 * picked; the (i) opens it again.
 */
export const WidgetGuideTip = ({
  open,
  onOpenChange,
  onLearnMore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLearnMore: () => void;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  // The popover waits for its anchor: on the first render the (i) isn't there yet.
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  // In a launcher tab that is hidden, the popover waits for it to show.
  const popoverShown = useLauncherTabDialog(open && !!anchor);
  const capital = { postProcess: 'capitalizeFirstChar' };
  const label = t('core:widget_guide.tip.about', capital);
  const titleId = useId();
  const accent =
    theme.palette.mode === 'dark'
      ? theme.palette.primary.light
      : theme.palette.primary.dark;

  return (
    <>
      <Tooltip title={label}>
        <IconButton
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={label}
          onClick={() => onOpenChange(!open)}
          ref={setAnchor}
          size="small"
          sx={{ color: accent }}
        >
          <InfoOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Popover
        anchorEl={anchor}
        anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
        onClose={() => onOpenChange(false)}
        {...popoverShown}
        slotProps={{
          paper: {
            'aria-labelledby': titleId,
            // The popover keeps focus inside until it closes.
            'aria-modal': true,
            role: 'dialog',
            sx: {
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: '16px',
              maxWidth: 'min(440px, calc(100vw - 32px))',
              mt: 1,
              p: 2.25,
            },
          },
        }}
        transformOrigin={{ horizontal: 'left', vertical: 'top' }}
      >
        <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.25, mb: 1.5 }}>
          <Box
            aria-hidden
            sx={{
              alignItems: 'center',
              backgroundColor: alpha(theme.palette.primary.main, 0.14),
              borderRadius: '10px',
              color: accent,
              display: 'flex',
              flexShrink: 0,
              height: 34,
              justifyContent: 'center',
              width: 34,
            }}
          >
            <WidgetsRoundedIcon fontSize="small" />
          </Box>
          <Typography
            component="h2"
            id={titleId}
            sx={{ fontSize: '15px', fontWeight: 700 }}
          >
            {t(WIDGET_GUIDE_TIP_TITLE_KEY, capital)}
          </Typography>
        </Box>
        <Box
          component="ul"
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            m: 0,
            pl: 2.25,
            '& li::marker': { color: accent },
          }}
        >
          {WIDGET_GUIDE_TIP_KEYS.map((key) => (
            <Typography
              component="li"
              key={key}
              sx={{ fontSize: '13.5px', lineHeight: 1.5 }}
            >
              <GuideText text={t(key, capital)} />
            </Typography>
          ))}
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
          <Button
            onClick={() => {
              onOpenChange(false);
              onLearnMore();
            }}
            sx={{ borderRadius: '10px', textTransform: 'none' }}
            variant="contained"
          >
            {t('core:widget_guide.learn_more', capital)}
          </Button>
        </Box>
      </Popover>
    </>
  );
};
