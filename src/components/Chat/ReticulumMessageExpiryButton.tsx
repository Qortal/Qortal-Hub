import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import {
  Box,
  IconButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Tooltip,
  useTheme,
} from '@mui/material';
import AllInclusiveRoundedIcon from '@mui/icons-material/AllInclusiveRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { useTranslation } from 'react-i18next';
import { CustomStyledMenu } from '../ContextMenu';
import {
  formatReticulumExpiryDuration,
  isReticulumMessageExpiryOptionAllowed,
  RETICULUM_MESSAGE_EXPIRY_OPTIONS,
} from './reticulumMessageExpiry';

type ReticulumMessageExpiryButtonProps = {
  channelExpiryDurationMs?: number;
  direct?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onChange: (durationMs: number | null | undefined) => void;
  segmented?: boolean;
  value?: number | null;
};

const expiryMenuItemSx = {
  borderRadius: '6px',
  fontSize: 13,
  fontWeight: 600,
  minHeight: 36,
  px: 1,
  py: 0.65,
  transition: 'background-color 120ms ease',
  '&:hover': { backgroundColor: 'action.hover' },
  '& .MuiListItemIcon-root': {
    color: 'text.secondary',
    minWidth: 30,
  },
  '& .MuiListItemText-primary': {
    fontSize: 13,
    fontWeight: 600,
    lineHeight: '18px',
  },
  '& .MuiListItemText-secondary': {
    fontSize: 11,
    lineHeight: '15px',
  },
  '& .MuiSvgIcon-root': { fontSize: 18 },
};

const expiryIndicatorLabel = (durationMs?: number): string | null => {
  if (!durationMs) return null;
  const option = RETICULUM_MESSAGE_EXPIRY_OPTIONS.find(
    (candidate) => candidate.durationMs === durationMs
  );
  return option?.shortLabel ?? null;
};

export function ReticulumMessageExpiryButton({
  channelExpiryDurationMs,
  direct = false,
  disabled = false,
  disabledReason,
  onChange,
  segmented = false,
  value,
}: ReticulumMessageExpiryButtonProps) {
  const { t } = useTranslation(['reticulum']);
  const theme = useTheme();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const effectiveExpiryDurationMs =
    value === null ? undefined : (value ?? channelExpiryDurationMs);
  const indicatorLabel = expiryIndicatorLabel(effectiveExpiryDurationMs);
  const channelDefaultSummary = channelExpiryDurationMs
    ? t('reticulum:expiry.maximum', {
        duration: formatReticulumExpiryDuration(channelExpiryDurationMs),
        postProcess: 'capitalizeFirstChar',
      })
    : t('reticulum:expiry.no_expiry', {
        postProcess: 'capitalizeFirstChar',
      });
  const channelDefaultLabel = useMemo(
    () =>
      channelExpiryDurationMs
        ? t('reticulum:expiry.channel_default_with', {
            duration: formatReticulumExpiryDuration(channelExpiryDurationMs),
            postProcess: 'capitalizeFirstChar',
          })
        : t('reticulum:expiry.channel_default_no_expiry', {
            postProcess: 'capitalizeFirstChar',
          }),
    [channelExpiryDurationMs, t]
  );
  const tooltip = disabled
    ? disabledReason ||
      t('reticulum:expiry.unavailable', {
        postProcess: 'capitalizeFirstChar',
      })
    : segmented
      ? t('reticulum:expiry.title', {
          postProcess: 'capitalizeFirstChar',
        })
      : value === null
        ? t('reticulum:expiry.tooltip_value', {
            postProcess: 'capitalizeFirstChar',
            value: t('reticulum:expiry.no_expiry', {
              postProcess: 'capitalizeFirstChar',
            }),
          })
        : value
          ? t('reticulum:expiry.tooltip_value', {
              postProcess: 'capitalizeFirstChar',
              value: formatReticulumExpiryDuration(value),
            })
          : t('reticulum:expiry.tooltip_value', {
              postProcess: 'capitalizeFirstChar',
              value: channelDefaultLabel,
            });

  useEffect(() => {
    if (disabled) setAnchorEl(null);
  }, [disabled]);

  const select = (durationMs: number | null | undefined) => {
    onChange(durationMs);
    setAnchorEl(null);
  };

  return (
    <>
      <Tooltip title={tooltip}>
        <Box
          component="span"
          sx={
            segmented
              ? {
                  display: 'flex',
                  height: '100%',
                }
              : undefined
          }
        >
          <IconButton
            data-tour={direct ? 'hub-dm-expiry' : undefined}
            aria-label={t('reticulum:expiry.set', {
              postProcess: 'capitalizeFirstChar',
            })}
            aria-haspopup="menu"
            aria-expanded={anchorEl ? 'true' : undefined}
            disabled={disabled}
            onClick={(event: MouseEvent<HTMLElement>) =>
              setAnchorEl(event.currentTarget)
            }
            size="small"
            sx={{
              backgroundColor: segmented
                ? theme.palette.background.default
                : value !== undefined
                  ? theme.palette.action.selected
                  : 'transparent',
              border: segmented ? 'none' : `1px solid ${theme.palette.divider}`,
              borderRadius: segmented ? 0 : '8px',
              color:
                value !== undefined
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary,
              flexShrink: 0,
              height: segmented ? 38 : 34,
              position: 'relative',
              width: segmented ? 40 : 34,
              '&::after': segmented
                ? {
                    backgroundColor: theme.palette.divider,
                    content: '""',
                    height: 20,
                    position: 'absolute',
                    right: 0,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '1px',
                  }
                : undefined,
              '&:hover': segmented
                ? {
                    backgroundColor: theme.palette.action.hover,
                    color: theme.palette.text.primary,
                  }
                : undefined,
              '&.Mui-focusVisible': {
                boxShadow: `inset 0 0 0 2px ${theme.palette.primary.main}`,
              },
            }}
          >
            {indicatorLabel ? (
              <Box
                component="span"
                sx={{
                  fontFamily: 'Inter, system-ui, sans-serif',
                  fontSize: '11px',
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 800,
                  letterSpacing: '-0.02em',
                  lineHeight: 1,
                }}
              >
                {indicatorLabel}
              </Box>
            ) : (
              <AllInclusiveRoundedIcon
                sx={{ color: 'inherit' }}
                titleAccess={t('reticulum:expiry.no_expiry', {
                  postProcess: 'capitalizeFirstChar',
                })}
              />
            )}
          </IconButton>
        </Box>
      </Tooltip>
      <CustomStyledMenu
        reticulumMenu
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        open={Boolean(anchorEl)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              backgroundColor: `${theme.palette.background.paper} !important`,
              overflow: 'hidden',
            },
          },
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <MenuItem
            selected={direct ? value === null : value === undefined}
            onClick={() => select(undefined)}
            sx={expiryMenuItemSx}
          >
            <ListItemIcon>
              {direct ? (
                value === null ? (
                  <CheckRoundedIcon />
                ) : null
              ) : value === undefined ? (
                <CheckRoundedIcon />
              ) : null}
            </ListItemIcon>
            <ListItemText
              primary={
                direct
                  ? t('reticulum:expiry.no_expiry', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : t('reticulum:expiry.channel_default', {
                      postProcess: 'capitalizeFirstChar',
                    })
              }
              secondary={
                direct
                  ? t('reticulum:expiry.do_not_auto_delete', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : channelDefaultSummary
              }
            />
          </MenuItem>
          {RETICULUM_MESSAGE_EXPIRY_OPTIONS.map((option) => {
            const allowed = isReticulumMessageExpiryOptionAllowed(
              option.durationMs,
              channelExpiryDurationMs
            );
            return (
              <MenuItem
                disabled={!allowed}
                key={option.durationMs}
                selected={value === option.durationMs}
                onClick={() => {
                  if (allowed) select(option.durationMs);
                }}
                sx={expiryMenuItemSx}
              >
                <ListItemIcon>
                  {value === option.durationMs ? <CheckRoundedIcon /> : null}
                </ListItemIcon>
                <ListItemText
                  primary={option.label}
                  secondary={
                    allowed || !channelExpiryDurationMs
                      ? undefined
                      : t('reticulum:expiry.maximum', {
                          duration: formatReticulumExpiryDuration(
                            channelExpiryDurationMs
                          ),
                          postProcess: 'capitalizeFirstChar',
                        })
                  }
                />
              </MenuItem>
            );
          })}
          {!direct && (
            <MenuItem
              selected={value === null}
              onClick={() => select(null)}
              sx={expiryMenuItemSx}
            >
              <ListItemIcon>
                {value === null ? <CheckRoundedIcon /> : null}
              </ListItemIcon>
              <ListItemText
                primary={t('reticulum:expiry.no_expiry', {
                  postProcess: 'capitalizeFirstChar',
                })}
                secondary={t('reticulum:expiry.do_not_auto_delete', {
                  postProcess: 'capitalizeFirstChar',
                })}
              />
            </MenuItem>
          )}
        </Box>
      </CustomStyledMenu>
    </>
  );
}
