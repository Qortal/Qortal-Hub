/**
 * The Activity row of the Explorer's settings (from Q-Mintership+'s
 * ActivitySettings), for a viewer who sees the detailed parts: how many of
 * an account's newest transactions the Overview reads when it opens (for
 * its Activity and QORT figures), and how many more each Read older reads;
 * and which kinds of milestones it shows. Saved at once, on this device,
 * for this Hub account (lib/explorer/activitySettings.ts).
 */
import { useEffect, useId, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { MARK_KINDS, type MarkKind } from '../../../../lib/explorer/activity';
import {
  ACTIVITY_FIRST_READ_CHOICES,
  ACTIVITY_FIRST_READ_DEFAULT,
  ACTIVITY_FIRST_READ_MAX,
  ACTIVITY_FIRST_READ_MIN,
  clampActivityRead,
  type ActivitySettings,
} from '../../../../lib/explorer/activitySettings';
import { formatCount } from '../../../../lib/explorer/format';
import { cap, mutedText } from '../../parts';

const OTHER = 'other';
const KIND_KEY: Record<MarkKind, string> = {
  joined: 'joined',
  asked: 'asked',
  declined: 'declined',
  removed: 'removed',
  banned: 'banned',
  unbanned: 'unbanned',
  left: 'left',
  admin: 'admin',
  notAdmin: 'not_admin',
  name: 'name',
  minting: 'minting',
};

const isChoice = (n: number) =>
  (ACTIVITY_FIRST_READ_CHOICES as readonly number[]).includes(n);

export function ActivitySettingsDialog({
  open,
  settings,
  onChange,
  onClose,
}: {
  open: boolean;
  settings: ActivitySettings;
  onChange: (next: ActivitySettings) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const language = i18n.language;
  const firstRead = clampActivityRead(settings.firstRead);
  const [other, setOther] = useState(!isChoice(firstRead));
  const [typed, setTyped] = useState(
    isChoice(firstRead) ? '' : String(firstRead)
  );
  const [problem, setProblem] = useState(false);
  const readId = useId();
  const marksId = useId();

  // Opened again: as kept.
  useEffect(() => {
    if (!open) return;
    setOther(!isChoice(firstRead));
    setTyped(isChoice(firstRead) ? '' : String(firstRead));
    setProblem(false);
    // Only when it opens.
  }, [open]);

  const range = {
    min: formatCount(ACTIVITY_FIRST_READ_MIN, language),
    max: formatCount(ACTIVITY_FIRST_READ_MAX, language),
  };
  const applyTyped = (text: string) => {
    const n = Number(text.replace(/[\s,.'’]/g, ''));
    if (!text.trim() || !Number.isFinite(n) || n < ACTIVITY_FIRST_READ_MIN) {
      setProblem(true);
      return;
    }
    const value = clampActivityRead(n);
    setProblem(false);
    setTyped(String(value));
    onChange({ ...settings, firstRead: value });
  };
  const hidden = new Set(settings.hiddenMarks);
  const toggle = (kind: MarkKind) =>
    onChange({
      ...settings,
      hiddenMarks: hidden.has(kind)
        ? settings.hiddenMarks.filter((each) => each !== kind)
        : [...settings.hiddenMarks, kind],
    });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby={`${readId}-title`}
      slotProps={{
        paper: {
          sx: {
            '& .MuiTypography-body2': { fontSize: '0.875rem' },
            '& .MuiButton-root': { textTransform: 'none' },
          },
        },
      }}
    >
      <DialogTitle id={`${readId}-title`}>
        {t('explorer:activity_settings.title', cap)}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <Box component="section" aria-labelledby={readId}>
            <Typography
              id={readId}
              component="h3"
              sx={{ fontSize: '0.95rem', fontWeight: 700 }}
            >
              {t('explorer:activity_settings.first_read', cap)}
            </Typography>
            <Typography
              variant="body2"
              sx={(theme) => ({ color: mutedText(theme), mb: 1 })}
            >
              {t('explorer:activity_settings.first_read_hint', cap)}
            </Typography>
            <RadioGroup
              aria-labelledby={readId}
              value={other ? OTHER : String(firstRead)}
              onChange={(event) => {
                if (event.target.value === OTHER) {
                  setOther(true);
                  if (typed) applyTyped(typed);
                  return;
                }
                setOther(false);
                setProblem(false);
                onChange({
                  ...settings,
                  firstRead: Number(event.target.value),
                });
              }}
            >
              {ACTIVITY_FIRST_READ_CHOICES.map((n) => (
                <FormControlLabel
                  key={n}
                  value={String(n)}
                  control={<Radio size="small" />}
                  label={
                    n === ACTIVITY_FIRST_READ_DEFAULT
                      ? t('explorer:activity_settings.default_choice', {
                          n: formatCount(n, language),
                        })
                      : formatCount(n, language)
                  }
                />
              ))}
              <FormControlLabel
                value={OTHER}
                control={<Radio size="small" />}
                label={t('explorer:activity_settings.other', cap)}
              />
            </RadioGroup>
            {other ? (
              <TextField
                label={t('explorer:activity_settings.number', cap)}
                size="small"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                onBlur={() => applyTyped(typed)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applyTyped(typed);
                }}
                error={problem}
                helperText={
                  problem
                    ? t('explorer:activity_settings.number_problem', range)
                    : t('explorer:activity_settings.number_hint', range)
                }
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                sx={{ maxWidth: 280, mt: 1 }}
              />
            ) : null}
          </Box>

          <Box component="section" aria-labelledby={marksId}>
            <Typography
              id={marksId}
              component="h3"
              sx={{ fontSize: '0.95rem', fontWeight: 700 }}
            >
              {t('explorer:activity_settings.marks', cap)}
            </Typography>
            <Typography
              variant="body2"
              sx={(theme) => ({ color: mutedText(theme), mb: 0.5 })}
            >
              {t('explorer:activity_settings.marks_hint', cap)}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              {MARK_KINDS.map((kind) => (
                <FormControlLabel
                  key={kind}
                  control={
                    <Checkbox
                      size="small"
                      checked={!hidden.has(kind)}
                      onChange={() => toggle(kind)}
                    />
                  }
                  label={t(
                    `explorer:activity_settings.kind.${KIND_KEY[kind]}`,
                    cap
                  )}
                />
              ))}
            </Box>
            <Button
              size="small"
              onClick={() => onChange({ ...settings, hiddenMarks: [] })}
              disabled={!settings.hiddenMarks.length}
              sx={{ mt: 0.5 }}
            >
              {t('explorer:activity_settings.show_every', cap)}
            </Button>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          {t('explorer:activity_settings.done', cap)}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
