import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import {
  Box,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  type KeyboardEvent,
  useCallback,
  useId,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  cleanCreditCharacter,
  cleanCreditName,
  normalizePersonName,
  SUBSCREEN_CREDIT_TEXT_MAX_LENGTH,
  SUBSCREEN_CREDITS_MAX,
  type SubscreenCredit,
  type SubscreenCreditRole,
} from '../../lib/videoPublisher';
import { SectionHeading } from './FormParts';

/** Why an add didn't go: shown under the field. */
type AddProblem = 'duplicate' | 'full';

/** The crew after the cast, in Subscreen's order, side by side when wide. */
const CREW_AFTER_CAST: readonly SubscreenCreditRole[] = [
  'writer',
  'producer',
  'composer',
  'cinematographer',
  'editor',
];

/** Enter adds, unless an input method is still composing the text. */
const isEnter = (event: KeyboardEvent) =>
  event.key === 'Enter' && !event.nativeEvent.isComposing;

/** An added name, with its remove button. */
const CreditChip = ({
  disabled,
  label,
  onRemove,
  removeLabel,
}: {
  disabled: boolean;
  label: string;
  onRemove: () => void;
  removeLabel: string;
}) => {
  const theme = useTheme();
  return (
    <Box
      component="li"
      sx={{
        alignItems: 'center',
        bgcolor: alpha(theme.palette.primary.main, 0.12),
        border: `1px solid ${alpha(theme.palette.primary.main, 0.32)}`,
        borderRadius: 999,
        color: theme.palette.text.primary,
        display: 'inline-flex',
        fontSize: '0.78rem',
        gap: 0.25,
        lineHeight: 1.6,
        maxWidth: '100%',
        minWidth: 0,
        pl: 1,
        pr: 0.25,
      }}
    >
      <Box
        component="span"
        sx={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={label}
      >
        {label}
      </Box>
      <IconButton
        aria-label={removeLabel}
        disabled={disabled}
        onClick={onRemove}
        size="small"
        sx={{ p: 0.25 }}
      >
        <CloseRoundedIcon sx={{ fontSize: '0.95rem' }} />
      </IconButton>
    </Box>
  );
};

/** One role: its field (and the character, for the cast), then its names. */
const RoleField = ({
  disabled,
  entries,
  full,
  onAdd,
  onRemove,
  role,
}: {
  disabled: boolean;
  entries: readonly { credit: SubscreenCredit; index: number }[];
  full: boolean;
  onAdd: (credit: SubscreenCredit) => AddProblem | null;
  onRemove: (index: number) => void;
  role: SubscreenCreditRole;
}) => {
  const { t } = useTranslation(['core']);
  const [name, setName] = useState('');
  const [character, setCharacter] = useState('');
  const [problem, setProblem] = useState<AddProblem | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const isCast = role === 'actor';
  const roleLabel = t(`core:video_publisher.credits.role.${role}`);
  const clean = cleanCreditName(name);
  const locked = disabled || full;

  const add = () => {
    if (locked || !clean) return;
    const outcome = onAdd({
      role,
      displayName: clean,
      ...(isCast && cleanCreditCharacter(character)
        ? { character: cleanCreditCharacter(character) }
        : {}),
    });
    setProblem(outcome);
    if (outcome) return;
    setName('');
    setCharacter('');
    nameInput.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isEnter(event)) return;
    event.preventDefault();
    add();
  };
  const addButton = (
    <InputAdornment position="end">
      <IconButton
        aria-label={t('core:video_publisher.credits.add', { role: roleLabel })}
        disabled={locked || !clean}
        edge="end"
        onClick={add}
        size="small"
      >
        <AddRoundedIcon fontSize="small" />
      </IconButton>
    </InputAdornment>
  );
  const helperText =
    problem === 'duplicate'
      ? t('core:video_publisher.credits.duplicate', {
          name: clean,
          role: roleLabel,
        })
      : undefined;
  const textLimit = {
    maxLength: SUBSCREEN_CREDIT_TEXT_MAX_LENGTH,
    enterKeyHint: 'done' as const,
    autoCapitalize: 'words',
    spellCheck: false,
  };

  const nameField = (
    <TextField
      disabled={locked}
      error={Boolean(helperText)}
      fullWidth
      helperText={helperText}
      inputRef={nameInput}
      label={roleLabel}
      onChange={(event) => {
        setName(event.target.value);
        setProblem(null);
      }}
      onKeyDown={onKeyDown}
      placeholder={t('core:video_publisher.credits.name_placeholder')}
      size="small"
      slotProps={{
        htmlInput: textLimit,
        input: isCast ? undefined : { endAdornment: addButton },
      }}
      value={name}
    />
  );

  return (
    <Box sx={{ display: 'grid', gap: 0.75, minWidth: 0 }}>
      {isCast ? (
        <Box
          sx={{
            alignItems: 'start',
            display: 'grid',
            gap: 1,
            gridTemplateColumns:
              'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
          }}
        >
          {nameField}
          <TextField
            disabled={locked}
            fullWidth
            label={t('core:video_publisher.credits.character')}
            onChange={(event) => {
              setCharacter(event.target.value);
              setProblem(null);
            }}
            onKeyDown={onKeyDown}
            placeholder={t(
              'core:video_publisher.credits.character_placeholder'
            )}
            size="small"
            slotProps={{
              htmlInput: textLimit,
              input: { endAdornment: addButton },
            }}
            value={character}
          />
        </Box>
      ) : (
        nameField
      )}
      {entries.length ? (
        <Box
          aria-label={roleLabel}
          component="ul"
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0.5,
            listStyle: 'none',
            m: 0,
            p: 0,
          }}
        >
          {entries.map(({ credit, index }) => (
            <CreditChip
              disabled={disabled}
              key={`${index}:${credit.displayName}`}
              label={
                credit.character
                  ? t('core:video_publisher.credits.as_character', {
                      name: credit.displayName,
                      character: credit.character,
                    })
                  : credit.displayName
              }
              onRemove={() => onRemove(index)}
              removeLabel={t('core:video_publisher.credits.remove', {
                name: credit.displayName,
                role: roleLabel,
              })}
            />
          ))}
        </Box>
      ) : null}
    </Box>
  );
};

/**
 * A Subscreen title's cast & crew: one field per role, in the order its
 * title page shows them (Directors, Cast, Writers, Producers, Music,
 * Cinematography, Editing). A name goes in with Enter or the + button, as
 * a chip that can be taken out again; a person once per role, 200 names
 * at most, 80 characters each, as Subscreen keeps them.
 */
export const CreditsEditor = ({
  credits,
  disabled = false,
  onChange,
}: {
  credits: readonly SubscreenCredit[] | undefined;
  /** Exactly when the form's other fields are. */
  disabled?: boolean;
  onChange: (credits: SubscreenCredit[]) => void;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const headingId = useId();
  const list = credits ?? [];
  const full = list.length >= SUBSCREEN_CREDITS_MAX;

  const add = useCallback(
    (credit: SubscreenCredit): AddProblem | null => {
      if (list.length >= SUBSCREEN_CREDITS_MAX) return 'full';
      const name = normalizePersonName(credit.displayName);
      if (
        list.some(
          (other) =>
            other.role === credit.role &&
            normalizePersonName(other.displayName) === name
        )
      ) {
        return 'duplicate';
      }
      onChange([...list, credit]);
      return null;
    },
    [list, onChange]
  );
  const remove = useCallback(
    (index: number) => onChange(list.filter((_, at) => at !== index)),
    [list, onChange]
  );
  const field = (role: SubscreenCreditRole) => (
    <RoleField
      disabled={disabled}
      entries={list
        .map((credit, index) => ({ credit, index }))
        .filter((entry) => entry.credit.role === role)}
      full={full}
      key={role}
      onAdd={add}
      onRemove={remove}
      role={role}
    />
  );

  return (
    <Box
      aria-labelledby={headingId}
      role="group"
      sx={{ display: 'grid', gap: 1.25 }}
    >
      <Box>
        <SectionHeading id={headingId}>
          {t('core:video_publisher.credits.heading')}
        </SectionHeading>
        <Typography
          sx={{ color: theme.palette.text.secondary, fontSize: '0.74rem' }}
        >
          {t('core:video_publisher.credits.hint')}
        </Typography>
      </Box>
      {field('director')}
      {field('actor')}
      <Box
        sx={{
          display: 'grid',
          gap: 1.25,
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
        }}
      >
        {CREW_AFTER_CAST.map(field)}
      </Box>
      {full ? (
        <Typography
          role="status"
          sx={{ color: theme.palette.warning.main, fontSize: '0.74rem' }}
        >
          {t('core:video_publisher.credits.limit', {
            max: SUBSCREEN_CREDITS_MAX,
          })}
        </Typography>
      ) : null}
    </Box>
  );
};
