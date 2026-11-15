import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded';
import HorizontalRuleRoundedIcon from '@mui/icons-material/HorizontalRuleRounded';
import LanguageRoundedIcon from '@mui/icons-material/LanguageRounded';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Radio,
  RadioGroup,
  Slider,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useAtomValue } from 'jotai';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { availableQappsAtom } from '../../atoms/appsAtoms';
import { AppsIcon } from '../../assets/Icons/AppsIcon';
import { HomeIcon } from '../../assets/Icons/HomeIcon';
import { MessagingIconFilled } from '../../assets/Icons/MessagingIconFilled';
import qortalLogoOfficial from '../../assets/sidebar/qortal-logo-official.webp';
import { appTitle, rankAppSearchMatches } from './appSearchSuggestions';
import { SidePanelAppIcon } from './SidePanelAppIcon';
import { sidePanelItemLabel } from './sidePanelLabels';
import {
  isSidePanelItemShown,
  isSidePanelQdnItem,
  moveSidePanelItem,
  SIDE_PANEL_ADDED_LIMIT,
  SIDE_PANEL_BUTTON_SIZES,
  SIDE_PANEL_DEFAULT,
  SIDE_PANEL_HANDLE_HEIGHTS,
  SIDE_PANEL_HIDEABLE,
  type SidePanelItem,
  type SidePanelSettings,
  sidePanelItemKey,
  withoutSidePanelItem,
  withSidePanelItemShown,
  withSidePanelQdnItem,
} from './sidePanel';

type SidePanelEditorProps = {
  open: boolean;
  onClose: () => void;
  settings: SidePanelSettings;
  onChange: (change: (current: SidePanelSettings) => SidePanelSettings) => void;
  /** Dev mode's button is only listed while dev mode is on. */
  devMode: boolean;
};

const ADD_SUGGESTIONS = 8;

/**
 * The side panel's settings: whether it waits at the left edge or stays
 * open, how much of its background shows, its buttons' size, the edge
 * handle's height and fill, and its buttons, which can be put in any order,
 * with Q-Apps and websites added. Each change applies at once, so the panel
 * shows it while the editor is open.
 */
export const SidePanelEditor = ({
  open,
  onClose,
  settings,
  onChange,
  devMode,
}: SidePanelEditorProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const availableQapps = useAtomValue(availableQappsAtom);
  const [query, setQuery] = useState('');

  const listed = settings.items.filter(
    (item) => item.kind !== 'dev' || devMode
  );
  const added = settings.items.filter(isSidePanelQdnItem);
  const full = added.length >= SIDE_PANEL_ADDED_LIMIT;
  const addedKeys = new Set(added.map(sidePanelItemKey));
  const suggestions = useMemo(
    () =>
      query.trim()
        ? rankAppSearchMatches(query, availableQapps)
            .filter(
              (app) =>
                !addedKeys.has(
                  sidePanelItemKey({
                    kind: 'qdn',
                    name: app.name,
                    service: app.service.toUpperCase() as 'APP' | 'WEBSITE',
                  })
                )
            )
            .slice(0, ADD_SUGGESTIONS)
        : [],
    // addedKeys follows settings.items.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [availableQapps, query, settings.items]
  );

  const labelOf = (item: SidePanelItem): string => sidePanelItemLabel(item, t);

  const iconOf = (item: SidePanelItem): ReactNode => {
    switch (item.kind) {
      case 'home':
        return <HomeIcon height={20} width={20} color="currentColor" />;
      case 'apps':
        return <AppsIcon height={18} color="currentColor" />;
      case 'qchat':
        return <MessagingIconFilled height={18} color="currentColor" />;
      case 'dev':
        return <CodeRoundedIcon sx={{ fontSize: 20 }} />;
      case 'divider':
        return <HorizontalRuleRoundedIcon sx={{ fontSize: 20 }} />;
      case 'info':
        return (
          <Box
            alt=""
            component="img"
            src={qortalLogoOfficial}
            sx={{ height: 20, width: 20 }}
          />
        );
      case 'language':
        return <LanguageRoundedIcon sx={{ fontSize: 20 }} />;
      case 'theme':
        return <PaletteOutlinedIcon sx={{ fontSize: 20 }} />;
      default:
        return <SidePanelAppIcon name={item.name} size={22} />;
    }
  };

  const sensors = useSensors(
    // A small move is still a click on the row's buttons.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const keys = listed.map(sidePanelItemKey);
  const nameOfKey = (key: string | number) => {
    const item = listed.find((entry) => sidePanelItemKey(entry) === key);
    return item ? labelOf(item) : '';
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onChange((current) =>
      moveSidePanelItem(
        current,
        current.items.findIndex((item) => sidePanelItemKey(item) === active.id),
        current.items.findIndex((item) => sidePanelItemKey(item) === over.id)
      )
    );
  };

  const sectionTitleSx = {
    color: theme.palette.text.secondary,
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.06em',
    mb: 0.75,
    textTransform: 'uppercase',
  } as const;
  const rowLabelSx = { color: 'text.secondary', fontSize: '0.78rem' } as const;
  const percent = (value: number) => `${value}%`;
  // Always open, the bar has no handle at the edge; the half circle always
  // opens from it.
  const hasHandle = settings.show === 'hover' || settings.layout === 'arc';

  return (
    <Dialog fullWidth maxWidth="xs" onClose={onClose} open={open}>
      <DialogTitle sx={{ pb: 1 }}>
        {t('core:side_panel.title', { postProcess: 'capitalizeFirstChar' })}
      </DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2.5 }}>
        <Box>
          <Typography id="side-panel-show" sx={sectionTitleSx}>
            {t('core:side_panel.show')}
          </Typography>
          <RadioGroup
            aria-labelledby="side-panel-show"
            onChange={(event) => {
              const show = event.target.value === 'always' ? 'always' : 'hover';
              onChange((current) => ({ ...current, show }));
            }}
            // The half circle only opens at the left edge.
            value={settings.layout === 'arc' ? 'hover' : settings.show}
          >
            <FormControlLabel
              control={<Radio size="small" />}
              label={t('core:side_panel.show_hover')}
              value="hover"
            />
            <FormControlLabel
              control={<Radio size="small" />}
              disabled={settings.layout === 'arc'}
              label={t('core:side_panel.show_always')}
              value="always"
            />
          </RadioGroup>
          {settings.layout === 'arc' ? (
            <Typography sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
              {t('core:side_panel.layout_arc_hover_only')}
            </Typography>
          ) : null}
        </Box>

        <Box>
          <Typography id="side-panel-layout" sx={sectionTitleSx}>
            {t('core:side_panel.layout')}
          </Typography>
          <RadioGroup
            aria-labelledby="side-panel-layout"
            onChange={(event) => {
              const layout = event.target.value === 'arc' ? 'arc' : 'bar';
              onChange((current) => ({ ...current, layout }));
            }}
            value={settings.layout}
          >
            <FormControlLabel
              control={<Radio size="small" />}
              label={t('core:side_panel.layout_bar')}
              value="bar"
            />
            <FormControlLabel
              control={<Radio size="small" />}
              label={
                <Box>
                  {t('core:side_panel.layout_arc')}
                  <Typography
                    sx={{ color: 'text.secondary', fontSize: '0.75rem' }}
                  >
                    {t('core:side_panel.layout_arc_hint')}
                  </Typography>
                </Box>
              }
              value="arc"
            />
          </RadioGroup>
        </Box>

        <Box>
          <Typography id="side-panel-background" sx={sectionTitleSx}>
            {t('core:side_panel.background')}
          </Typography>
          <RangeRow
            end={t('core:side_panel.background_full', {
              postProcess: 'capitalizeFirstChar',
            })}
            format={percent}
            labelledBy="side-panel-background"
            max={100}
            min={0}
            onChange={(value) =>
              onChange((current) => ({ ...current, background: value / 100 }))
            }
            start={t('core:side_panel.background_none', {
              postProcess: 'capitalizeFirstChar',
            })}
            step={5}
            value={Math.round(settings.background * 100)}
          />
        </Box>

        <Box>
          <Typography id="side-panel-button-size" sx={sectionTitleSx}>
            {t('core:side_panel.button_size')}
          </Typography>
          <RangeRow
            end={t('core:side_panel.button_size_bigger', {
              postProcess: 'capitalizeFirstChar',
            })}
            format={percent}
            labelledBy="side-panel-button-size"
            max={Math.round(SIDE_PANEL_BUTTON_SIZES.max * 100)}
            min={Math.round(SIDE_PANEL_BUTTON_SIZES.min * 100)}
            onChange={(value) =>
              onChange((current) => ({ ...current, buttonSize: value / 100 }))
            }
            start={t('core:side_panel.button_size_smaller', {
              postProcess: 'capitalizeFirstChar',
            })}
            step={Math.round(SIDE_PANEL_BUTTON_SIZES.step * 100)}
            value={Math.round(settings.buttonSize * 100)}
          />
        </Box>

        {hasHandle ? (
          <Box>
            <Typography id="side-panel-handle" sx={sectionTitleSx}>
              {t('core:side_panel.handle')}
            </Typography>
            <FormControlLabel
              control={
                <Switch
                  checked={settings.edgeHandle}
                  onChange={(_event, checked) =>
                    onChange((current) => ({ ...current, edgeHandle: checked }))
                  }
                  size="small"
                />
              }
              label={t('core:side_panel.handle_show', {
                postProcess: 'capitalizeFirstChar',
              })}
            />
            <Typography sx={{ ...rowLabelSx, mb: 1 }}>
              {settings.edgeHandle
                ? t('core:side_panel.handle_hint')
                : t('core:side_panel.handle_off_hint')}
            </Typography>
            {settings.edgeHandle ? (
              <>
                <Typography
                  id="side-panel-handle-height"
                  sx={{ ...rowLabelSx }}
                >
                  {t('core:side_panel.handle_height', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
                <RangeRow
                  end={t('core:side_panel.handle_taller', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                  format={(value) => `${value} px`}
                  labelledBy="side-panel-handle side-panel-handle-height"
                  max={SIDE_PANEL_HANDLE_HEIGHTS.max}
                  min={SIDE_PANEL_HANDLE_HEIGHTS.min}
                  onChange={(value) =>
                    onChange((current) => ({ ...current, handleHeight: value }))
                  }
                  start={t('core:side_panel.handle_shorter', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                  step={SIDE_PANEL_HANDLE_HEIGHTS.step}
                  value={settings.handleHeight}
                />
                <Typography
                  id="side-panel-handle-background"
                  sx={{ ...rowLabelSx, mt: 0.5 }}
                >
                  {t('core:side_panel.background', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
                <RangeRow
                  end={t('core:side_panel.background_full', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                  format={percent}
                  labelledBy="side-panel-handle side-panel-handle-background"
                  max={100}
                  min={0}
                  onChange={(value) =>
                    onChange((current) => ({
                      ...current,
                      handleBackground: value / 100,
                    }))
                  }
                  start={t('core:side_panel.handle_outline', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                  step={5}
                  value={Math.round(settings.handleBackground * 100)}
                />
              </>
            ) : null}
          </Box>
        ) : null}

        <Box>
          <Typography sx={sectionTitleSx}>
            {t('core:side_panel.buttons')}
          </Typography>
          <Typography
            sx={{ color: 'text.secondary', fontSize: '0.78rem', mb: 1 }}
          >
            {t('core:side_panel.buttons_hint')}{' '}
            {t('core:side_panel.buttons_hide_hint')}
          </Typography>
          <DndContext
            accessibility={{
              announcements: {
                onDragStart: ({ active }) =>
                  t('core:side_panel.drag_start', {
                    name: nameOfKey(active.id),
                  }),
                onDragOver: ({ active, over }) =>
                  over
                    ? t('core:side_panel.drag_over', {
                        name: nameOfKey(active.id),
                        other: nameOfKey(over.id),
                      })
                    : undefined,
                onDragEnd: ({ active }) =>
                  t('core:side_panel.drag_end', {
                    name: nameOfKey(active.id),
                  }),
                onDragCancel: ({ active }) =>
                  t('core:side_panel.drag_cancel', {
                    name: nameOfKey(active.id),
                  }),
              },
              screenReaderInstructions: {
                draggable: t('core:side_panel.drag_instructions'),
              },
            }}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
            sensors={sensors}
          >
            <SortableContext
              items={keys}
              strategy={verticalListSortingStrategy}
            >
              <Box
                component="ul"
                sx={{
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: '12px',
                  listStyle: 'none',
                  m: 0,
                  p: 0.5,
                }}
              >
                {listed.map((item) => (
                  <SortableRow
                    icon={iconOf(item)}
                    id={sidePanelItemKey(item)}
                    key={sidePanelItemKey(item)}
                    label={labelOf(item)}
                    moveLabel={t('core:side_panel.move', {
                      name: labelOf(item),
                    })}
                    onRemove={
                      isSidePanelQdnItem(item)
                        ? () =>
                            onChange((current) =>
                              withoutSidePanelItem(
                                current,
                                sidePanelItemKey(item)
                              )
                            )
                        : undefined
                    }
                    removeLabel={t('core:side_panel.remove', {
                      name: labelOf(item),
                    })}
                    shown={isSidePanelItemShown(item)}
                    onShownChange={
                      !isSidePanelQdnItem(item) &&
                      SIDE_PANEL_HIDEABLE.includes(item.kind)
                        ? (shown) =>
                            onChange((current) =>
                              withSidePanelItemShown(current, item.kind, shown)
                            )
                        : undefined
                    }
                    showLabel={t('core:side_panel.show_button', {
                      name: labelOf(item),
                    })}
                    secondary={
                      isSidePanelQdnItem(item)
                        ? item.service === 'WEBSITE'
                          ? t('core:side_panel.website', {
                              postProcess: 'capitalizeFirstChar',
                            })
                          : 'Q-App'
                        : undefined
                    }
                  />
                ))}
              </Box>
            </SortableContext>
          </DndContext>
        </Box>

        <Box>
          <Typography sx={sectionTitleSx}>
            {t('core:side_panel.add')}
          </Typography>
          <Autocomplete
            clearOnBlur={false}
            disabled={full}
            filterOptions={(options) => options}
            getOptionKey={(app) => `${app.service}:${app.name}`}
            getOptionLabel={(app) => appTitle(app)}
            inputValue={query}
            noOptionsText={t('core:side_panel.add_none', {
              postProcess: 'capitalizeFirstChar',
            })}
            onChange={(_event, app) => {
              if (!app) return;
              onChange((current) =>
                withSidePanelQdnItem(current, {
                  name: app.name,
                  service: app.service,
                })
              );
              setQuery('');
            }}
            onInputChange={(_event, value, reason) => {
              if (reason !== 'reset') setQuery(value);
            }}
            open={!!query.trim()}
            options={suggestions}
            renderInput={(params) => (
              <TextField
                {...params}
                helperText={
                  full
                    ? t('core:side_panel.add_limit', {
                        max: SIDE_PANEL_ADDED_LIMIT,
                      })
                    : undefined
                }
                placeholder={t('core:side_panel.add_placeholder', {
                  postProcess: 'capitalizeFirstChar',
                })}
                size="small"
              />
            )}
            renderOption={({ key, ...props }, app) => (
              <Box
                component="li"
                key={key}
                {...props}
                sx={{ alignItems: 'center', display: 'flex', gap: 1.25 }}
              >
                <SidePanelAppIcon name={app.name} size={24} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: '0.86rem' }}>
                    {appTitle(app)}
                  </Typography>
                  <Typography
                    noWrap
                    sx={{ color: 'text.secondary', fontSize: '0.72rem' }}
                  >
                    {app.service.toUpperCase() === 'WEBSITE'
                      ? t('core:side_panel.website', {
                          postProcess: 'capitalizeFirstChar',
                        })
                      : 'Q-App'}
                    {' · '}
                    {app.name}
                  </Typography>
                </Box>
              </Box>
            )}
            value={null}
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
        <Button
          onClick={() =>
            onChange(() => ({
              ...SIDE_PANEL_DEFAULT,
              items: [...SIDE_PANEL_DEFAULT.items],
            }))
          }
          sx={{ textTransform: 'none' }}
        >
          {t('core:side_panel.reset', { postProcess: 'capitalizeFirstChar' })}
        </Button>
        <Button
          onClick={onClose}
          sx={{
            backgroundColor: alpha(theme.palette.primary.main, 0.16),
            textTransform: 'none',
          }}
        >
          {t('core:side_panel.done', { postProcess: 'capitalizeFirstChar' })}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

type RangeRowProps = {
  /** The ids of what names the slider. */
  labelledBy: string;
  start: string;
  end: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
};

/** A slider between its two ends' words. */
const RangeRow = ({
  labelledBy,
  start,
  end,
  min,
  max,
  step,
  value,
  format,
  onChange,
}: RangeRowProps) => (
  <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.5, px: 1 }}>
    <Typography sx={{ color: 'text.secondary', fontSize: '0.78rem' }}>
      {start}
    </Typography>
    <Slider
      aria-labelledby={labelledBy}
      max={max}
      min={min}
      onChange={(_event, next) =>
        onChange(Array.isArray(next) ? next[0] : next)
      }
      size="small"
      step={step}
      value={value}
      valueLabelDisplay="auto"
      valueLabelFormat={format}
    />
    <Typography sx={{ color: 'text.secondary', fontSize: '0.78rem' }}>
      {end}
    </Typography>
  </Box>
);

type SortableRowProps = {
  id: string;
  icon: ReactNode;
  label: string;
  secondary?: string;
  moveLabel: string;
  removeLabel: string;
  onRemove?: () => void;
  /** Shown in the panel; a hidden button stays listed, dimmed. */
  shown: boolean;
  /** For the panel's own buttons that can be hidden. */
  onShownChange?: (shown: boolean) => void;
  showLabel: string;
};

/**
 * One button of the panel: dragged by its handle, removed if added, hidden
 * with its switch if it may be.
 */
const SortableRow = ({
  id,
  icon,
  label,
  secondary,
  moveLabel,
  removeLabel,
  onRemove,
  shown,
  onShownChange,
  showLabel,
}: SortableRowProps) => {
  const theme = useTheme();
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id });
  return (
    <Box
      component="li"
      data-side-panel-item={id}
      ref={setNodeRef}
      sx={{
        alignItems: 'center',
        backgroundColor: isDragging
          ? alpha(theme.palette.primary.main, 0.12)
          : 'transparent',
        borderRadius: '8px',
        display: 'flex',
        gap: 1,
        minHeight: 40,
        position: 'relative',
        px: 0.5,
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
        transition,
        zIndex: isDragging ? 1 : 0,
      }}
    >
      <IconButton
        aria-label={moveLabel}
        ref={setActivatorNodeRef}
        size="small"
        sx={{ color: 'text.secondary', cursor: 'grab', touchAction: 'none' }}
        {...attributes}
        {...listeners}
      >
        <DragIndicatorRoundedIcon sx={{ fontSize: 18 }} />
      </IconButton>
      <Box
        sx={{
          alignItems: 'center',
          color: 'text.secondary',
          display: 'flex',
          height: 24,
          justifyContent: 'center',
          opacity: shown ? 1 : 0.45,
          width: 24,
        }}
      >
        {icon}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, opacity: shown ? 1 : 0.55 }}>
        <Typography noWrap sx={{ fontSize: '0.86rem' }}>
          {label}
        </Typography>
        {secondary ? (
          <Typography
            noWrap
            sx={{ color: 'text.secondary', fontSize: '0.7rem' }}
          >
            {secondary}
          </Typography>
        ) : null}
      </Box>
      {onShownChange ? (
        <Switch
          checked={shown}
          onChange={(_event, checked) => onShownChange(checked)}
          size="small"
          slotProps={{ input: { 'aria-label': showLabel } }}
        />
      ) : null}
      {onRemove ? (
        <Tooltip title={removeLabel}>
          <IconButton aria-label={removeLabel} onClick={onRemove} size="small">
            <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      ) : null}
    </Box>
  );
};
