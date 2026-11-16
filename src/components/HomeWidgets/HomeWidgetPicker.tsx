import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import WidgetsRoundedIcon from '@mui/icons-material/WidgetsRounded';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../utils/globalApi';
import { fetchHomeWidgets } from './fetchHomeWidgets';
import {
  HOME_WIDGET_LIMIT,
  homeWidgetKey,
  type HomeWidgetListing,
} from './homeWidgets';

type HomeWidgetPickerProps = {
  open: boolean;
  onClose: () => void;
  /** The widgets already on Home, wherever they are: marked added. */
  added: readonly { name: string; identifier: string | null }[];
  onAdd: (listing: HomeWidgetListing) => void;
};

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; widgets: HomeWidgetListing[] };

/**
 * The widgets published on QDN (APPs tagged go-widget), to add to Home. Nothing runs from here: a widget only loads
 * once it is on Home.
 */
export const HomeWidgetPicker = ({
  open,
  onClose,
  added,
  onAdd,
}: HomeWidgetPickerProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core', 'group']);
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setState((current) =>
      current.phase === 'ready' && attempt === 0
        ? current
        : { phase: 'loading' }
    );
    fetchHomeWidgets(getBaseApiReact(), {
      signal: controller.signal,
      fresh: attempt > 0,
    })
      .then((widgets) => {
        if (!controller.signal.aborted) setState({ phase: 'ready', widgets });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ phase: 'error' });
      });
    return () => controller.abort();
  }, [open, attempt]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const addedKeys = useMemo(
    () => new Set(added.map((widget) => homeWidgetKey(widget))),
    [added]
  );
  const full = added.length >= HOME_WIDGET_LIMIT;

  const shown = useMemo(() => {
    if (state.phase !== 'ready') return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return state.widgets;
    return state.widgets.filter((widget) =>
      [widget.title, widget.name, widget.description, widget.identifier ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [state, query]);

  const searchLabel = t('group:home_widgets.picker_search', {
    defaultValue: 'Search widgets',
  });

  return (
    <Dialog
      fullWidth
      maxWidth="sm"
      onClose={onClose}
      open={open}
      PaperProps={{
        sx: {
          backgroundImage: 'none',
          borderRadius: '16px',
          maxHeight: 'min(720px, calc(100vh - 64px))',
        },
      }}
    >
      <DialogTitle
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: 1,
          pb: 1,
          pr: 6,
        }}
      >
        <WidgetsRoundedIcon sx={{ color: 'primary.main', fontSize: 22 }} />
        <Box component="span" sx={{ fontSize: '1.05rem', fontWeight: 700 }}>
          {t('group:home_widgets.picker_title', {
            defaultValue: 'Add a widget',
          })}
        </Box>
        <IconButton
          aria-label={t('core:action.close', {
            postProcess: 'capitalizeFirstChar',
          })}
          onClick={onClose}
          size="small"
          sx={{ position: 'absolute', right: 12, top: 12 }}
        >
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 0.5 }}
      >
        <Box
          sx={{
            alignItems: 'flex-start',
            backgroundColor: alpha(theme.palette.primary.main, 0.08),
            border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
            borderRadius: '12px',
            display: 'flex',
            gap: 1,
            p: 1.25,
          }}
        >
          <ShieldOutlinedIcon
            sx={{ color: 'primary.main', fontSize: 20, mt: '1px' }}
          />
          <Typography
            sx={{
              color: 'text.secondary',
              fontSize: '0.78rem',
              lineHeight: 1.5,
            }}
          >
            {t('group:home_widgets.picker_note', {
              defaultValue:
                "Widgets are small Q-Apps on Home. They can show things and open apps, but they can't pay, publish or sign anything.",
            })}
          </Typography>
        </Box>

        <TextField
          inputProps={{ 'aria-label': searchLabel }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon fontSize="small" />
              </InputAdornment>
            ),
            sx: { borderRadius: '12px' },
          }}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchLabel}
          size="small"
          value={query}
        />

        {full ? (
          <Typography sx={{ color: 'warning.main', fontSize: '0.78rem' }}>
            {t('group:home_widgets.limit', {
              defaultValue: 'You can have up to {{max}} widgets on Home.',
              max: HOME_WIDGET_LIMIT,
            })}
          </Typography>
        ) : null}

        {state.phase === 'loading' ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
            <CircularProgress size={28} />
          </Box>
        ) : state.phase === 'error' ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>
              {t('group:home_widgets.picker_error', {
                defaultValue:
                  "Couldn't load the widgets. Check the node connection.",
              })}
            </Typography>
            <Button
              onClick={() => setAttempt((n) => n + 1)}
              sx={{ fontWeight: 700, mt: 1, textTransform: 'none' }}
            >
              {t('core:retry', { postProcess: 'capitalizeFirstChar' })}
            </Button>
          </Box>
        ) : shown.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>
              {state.widgets.length === 0
                ? t('group:home_widgets.picker_empty', {
                    defaultValue: 'No widgets published yet.',
                  })
                : t('group:home_widgets.picker_none_found', {
                    defaultValue: 'No widgets match.',
                  })}
            </Typography>
            {state.widgets.length === 0 ? (
              <Typography
                sx={{
                  color: 'text.secondary',
                  fontSize: '0.75rem',
                  lineHeight: 1.5,
                  maxWidth: 380,
                  mt: 1,
                  mx: 'auto',
                  opacity: 0.8,
                }}
              >
                {t('group:home_widgets.picker_developers', {
                  defaultValue:
                    'Q-App developers: publish a widget as an APP with the tag go-widget, ideally with an identifier starting with go-widget.',
                })}
              </Typography>
            ) : null}
          </Box>
        ) : (
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {shown.map((widget) => {
              const key = homeWidgetKey(widget);
              const isAdded = addedKeys.has(key);
              return (
                <Box
                  component="li"
                  key={key}
                  sx={{
                    alignItems: 'center',
                    borderBottom: `1px solid ${theme.palette.divider}`,
                    display: 'flex',
                    gap: 1.5,
                    py: 1.25,
                  }}
                >
                  <Avatar
                    alt=""
                    src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${encodeURIComponent(
                      widget.name
                    )}/qortal_avatar?async=true`}
                    sx={{ borderRadius: '12px', height: 44, width: 44 }}
                    variant="rounded"
                  >
                    <WidgetsRoundedIcon fontSize="small" />
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      noWrap
                      sx={{ fontSize: '0.92rem', fontWeight: 700 }}
                    >
                      {widget.title}
                    </Typography>
                    <Typography
                      noWrap
                      sx={{ color: 'text.secondary', fontSize: '0.74rem' }}
                    >
                      {t('group:home_widgets.by', {
                        defaultValue: 'by {{name}}',
                        name: widget.name,
                      })}
                    </Typography>
                    {widget.description ? (
                      <Typography
                        sx={{
                          WebkitBoxOrient: 'vertical',
                          WebkitLineClamp: 2,
                          color: 'text.secondary',
                          display: '-webkit-box',
                          fontSize: '0.76rem',
                          lineHeight: 1.4,
                          mt: 0.25,
                          overflow: 'hidden',
                        }}
                      >
                        {widget.description}
                      </Typography>
                    ) : null}
                  </Box>
                  <Button
                    disabled={isAdded || full}
                    onClick={() => onAdd(widget)}
                    size="small"
                    startIcon={isAdded ? <CheckRoundedIcon /> : undefined}
                    sx={{
                      borderRadius: 999,
                      flexShrink: 0,
                      fontWeight: 700,
                      textTransform: 'none',
                    }}
                    variant={isAdded ? 'text' : 'contained'}
                  >
                    {isAdded
                      ? t('group:home_widgets.added', {
                          defaultValue: 'added',
                          postProcess: 'capitalizeFirstChar',
                        })
                      : t('group:home_widgets.add', {
                          defaultValue: 'add',
                          postProcess: 'capitalizeFirstChar',
                        })}
                  </Button>
                </Box>
              );
            })}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
};
