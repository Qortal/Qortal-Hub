import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import {
  Box,
  Button,
  ButtonBase,
  ClickAwayListener,
  IconButton,
  Paper,
  Popper,
  Tooltip,
  Typography,
  useTheme,
  type TooltipProps,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded';
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded';
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded';
import { useTranslation } from 'react-i18next';
import { formatZoomPercent, isNormalZoom } from './hubZoom';
import { HUB_ZOOM_BUBBLE_MS, type HubZoom } from './useHubZoom';

/** Keys that alone use nothing in the panel: held for Ctrl+wheel, say. */
const MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'Shift']);

type HubZoomButtonProps = {
  zoom: HubZoom;
  /** As the search bar's other buttons look under the pointer. */
  hoverBackground: string;
  tooltipSlotProps?: TooltipProps['slotProps'];
  tooltipTitle?: (text: string) => ReactNode;
};

/**
 * The magnifier at the end of the search field. It shows while the Q-App or
 * website on screen isn't at Hub's zoom, and for a moment after its zoom
 * changed with the keys, the menu or the wheel. A click opens its panel: −,
 * the zoom, +, and back to Hub's zoom.
 */
export function HubZoomButton({
  zoom,
  hoverBackground,
  tooltipSlotProps,
  tooltipTitle = (text) => text,
}: HubZoomButtonProps) {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core']);
  const titleId = useId();
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  // The panel opens under the magnifier once it is on the page.
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const anchorTo = useCallback((node: HTMLButtonElement | null) => {
    anchorRef.current = node;
    setAnchor(node);
  }, []);
  // Once the panel is on the page (the Popper's portal mounts a moment later).
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  // Opened with a click, until closed.
  const [open, setOpen] = useState(false);
  const panelOpen = open || zoom.bubble;
  const levels = zoom.state?.app ?? null;
  const visible = zoom.available && (open || zoom.shown) && !!levels;

  const { endBubble, pointerAway, pointerOn } = zoom;
  // The magnifier's tooltip gives way to its panel, before it is drawn, and
  // isn't opened under the panel: MUI reports no leave while its tooltip is
  // closed, so it would come back when the panel closes. Controlled, so that
  // the pointer leaving unseen (below) closes it too.
  const [tipOpen, setTipOpen] = useState(false);
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;
  useLayoutEffect(() => {
    if (panelOpen) setTipOpen(false);
  }, [panelOpen]);

  // Opened with a click of the pointer, the panel fades a moment after the
  // pointer has left it, as a zoom's own panel does. Opened with the
  // keyboard, or once a key is used in it, it stays until closed.
  const fadesRef = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopFade = useCallback(() => {
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = null;
  }, []);

  // Whether the pointer is on the magnifier or on its panel. Either can go
  // away under it (a panel closed, the zoom back to normal) without a
  // pointerleave, so main is told then too.
  const hoverRef = useRef({ button: false, panel: false });
  const fadeWhenLeft = useCallback(() => {
    stopFade();
    if (!openRef.current || !fadesRef.current) return;
    // The pointer coming back stops it (hover, below).
    fadeTimer.current = setTimeout(() => {
      fadeTimer.current = null;
      setOpen(false);
      endBubble();
    }, HUB_ZOOM_BUBBLE_MS);
  }, [stopFade, endBubble]);
  const hover = useCallback(
    (part: 'button' | 'panel', on: boolean) => {
      hoverRef.current[part] = on;
      const { button, panel } = hoverRef.current;
      pointerOn(button || panel);
      if (button || panel) stopFade();
      else fadeWhenLeft();
    },
    [pointerOn, stopFade, fadeWhenLeft]
  );
  // A pointerenter missed after the pointer left unseen (below): the page
  // still thinks the pointer never left, but it moves.
  const moved = (part: 'button' | 'panel') => {
    if (!hoverRef.current[part]) hover(part, true);
  };
  useEffect(() => {
    if (!panelOpen && hoverRef.current.panel) hover('panel', false);
  }, [panelOpen, hover]);
  useEffect(() => {
    if (visible) return;
    hoverRef.current.button = false;
    hover('panel', false);
  }, [visible, hover]);
  // Main saw the pointer go from here straight onto an app's page.
  useEffect(() => {
    if (!pointerAway) return;
    hoverRef.current = { button: false, panel: false };
    setTipOpen(false);
    fadeWhenLeft();
  }, [pointerAway, fadeWhenLeft]);
  useEffect(() => {
    if (!open) stopFade();
  }, [open, stopFade]);
  useEffect(() => stopFade, [stopFade]);

  // Another tab on screen, or no zoom to show: a panel opened for the last
  // one closes.
  const tabId = zoom.tabId;
  useEffect(() => setOpen(false), [tabId]);
  // Opened with a click: the keyboard goes to its first button.
  useEffect(() => {
    if (!open || !panel) return;
    panel.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }, [open, panel]);
  // Escape closes it wherever the keyboard is: a button just greyed out
  // (back at normal size) drops the focus to the page.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      endBubble();
      anchorRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, endBubble]);
  // One of Hub's windows or dialogs took the keyboard: the panel would float
  // over it.
  const { hubWindow } = zoom;
  useEffect(() => {
    if (!hubWindow) return;
    setOpen(false);
    endBubble();
  }, [hubWindow, endBubble]);
  // A click into an app's page, or into another window, gives the Hub page
  // no click to close the panel on: only its window losing the keyboard.
  useEffect(() => {
    if (!open) return undefined;
    const onBlur = () => {
      setOpen(false);
      endBubble();
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [open, endBubble]);

  if (!visible) return null;

  const percent = formatZoomPercent(levels.level, i18n.language);
  const label = t('core:navbar.zoom.button', {
    percent,
    postProcess: 'capitalizeFirstChar',
  });
  // Back at Hub's size, nothing is kept for the app.
  const note =
    zoom.appName && !isNormalZoom(levels.level)
      ? t('core:navbar.zoom.kept', {
          name: zoom.appName,
          postProcess: 'capitalizeFirstChar',
        })
      : '';
  const Icon = levels.level < 0 ? ZoomOutRoundedIcon : ZoomInRoundedIcon;

  const close = (focusBack: boolean) => {
    setOpen(false);
    zoom.endBubble();
    if (focusBack) anchorRef.current?.focus();
  };
  const toggle = (event: ReactMouseEvent) => {
    if (open) {
      close(false);
      return;
    }
    zoom.endBubble();
    // A click of the pointer has a count; Enter and Space give none.
    fadesRef.current = event.detail > 0;
    if (fadesRef.current) moved('button');
    setOpen(true);
  };

  return (
    <>
      <Tooltip
        title={tooltipTitle(label)}
        placement="bottom"
        arrow
        slotProps={tooltipSlotProps}
        open={tipOpen}
        onOpen={() => {
          if (!panelOpenRef.current) setTipOpen(true);
        }}
        onClose={() => setTipOpen(false)}
      >
        <ButtonBase
          ref={anchorTo}
          disableRipple
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          data-hub-zoom-button=""
          onClick={toggle}
          onPointerEnter={() => hover('button', true)}
          onPointerMove={() => moved('button')}
          onPointerLeave={() => hover('button', false)}
          sx={{
            alignItems: 'center',
            borderRadius: '8px',
            color: panelOpen
              ? theme.palette.primary.main
              : theme.palette.text.secondary,
            display: 'flex',
            flexShrink: 0,
            height: 26,
            justifyContent: 'center',
            minWidth: 26,
            transition:
              'background-color 140ms ease, color 140ms ease, transform 120ms ease, box-shadow 140ms ease',
            width: 26,
            '&:hover': {
              backgroundColor: hoverBackground,
              color: theme.palette.text.primary,
              transform: 'translateY(-1px)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            },
            '&:active': {
              transform: 'translateY(0)',
              boxShadow: 'none',
            },
            '&:focus-visible': {
              outline: `1px solid ${theme.palette.primary.main}`,
              outlineOffset: '2px',
            },
          }}
        >
          <Icon sx={{ display: 'block', flexShrink: 0, fontSize: 18 }} />
        </ButtonBase>
      </Tooltip>
      <Popper
        open={panelOpen && !!anchor}
        anchorEl={anchor}
        placement="bottom-end"
        modifiers={[{ name: 'offset', options: { offset: [0, 8] } }]}
        sx={{ zIndex: theme.zIndex.modal + 1 }}
      >
        <ClickAwayListener
          mouseEvent="onMouseDown"
          onClickAway={(event) => {
            if (anchorRef.current?.contains(event.target as Node)) return;
            if (open) close(false);
            else zoom.endBubble();
          }}
        >
          <Paper
            ref={setPanel}
            role="dialog"
            aria-labelledby={titleId}
            data-hub-zoom-panel=""
            elevation={6}
            onPointerEnter={() => hover('panel', true)}
            onPointerMove={() => moved('panel')}
            onPointerLeave={() => hover('panel', false)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                close(true);
                return;
              }
              // Used with the keys: it stays until closed.
              if (MODIFIER_KEYS.has(event.key)) return;
              fadesRef.current = false;
              stopFade();
            }}
            sx={{
              backgroundColor: theme.palette.background.paper,
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: '12px',
              maxWidth: 300,
              minWidth: 236,
              px: 1.5,
              py: 1.25,
            }}
          >
            <Typography
              id={titleId}
              sx={{
                color: theme.palette.text.primary,
                fontSize: '13px',
                fontWeight: 700,
                mb: 0.75,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {zoom.appName}
            </Typography>
            <Box sx={{ alignItems: 'center', display: 'flex', gap: 0.5 }}>
              <IconButton
                size="small"
                aria-label={t('core:navbar.zoom.zoom_out', {
                  postProcess: 'capitalizeFirstChar',
                })}
                disabled={!levels.canOut}
                onClick={() => zoom.change('out')}
              >
                <RemoveRoundedIcon fontSize="small" />
              </IconButton>
              <Typography
                aria-live="polite"
                sx={{
                  color: theme.palette.text.primary,
                  fontSize: '14px',
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 600,
                  minWidth: 52,
                  textAlign: 'center',
                }}
              >
                {percent}
              </Typography>
              <IconButton
                size="small"
                aria-label={t('core:navbar.zoom.zoom_in', {
                  postProcess: 'capitalizeFirstChar',
                })}
                disabled={!levels.canIn}
                onClick={() => zoom.change('in')}
              >
                <AddRoundedIcon fontSize="small" />
              </IconButton>
              <Button
                size="small"
                disabled={isNormalZoom(levels.level)}
                onClick={() => zoom.change('reset')}
                sx={{ ml: 'auto', textTransform: 'none', whiteSpace: 'nowrap' }}
              >
                {t('core:navbar.zoom.same_as_hub', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Button>
            </Box>
            {note ? (
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: '12px',
                  mt: 0.75,
                }}
              >
                {note}
              </Typography>
            ) : null}
          </Paper>
        </ClickAwayListener>
      </Popper>
    </>
  );
}
