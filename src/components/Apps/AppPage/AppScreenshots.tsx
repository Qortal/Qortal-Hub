import { useCallback, useEffect, useRef, useState } from 'react';
import {
  alpha,
  Box,
  ButtonBase,
  Dialog,
  IconButton,
  Skeleton,
  Typography,
  useTheme,
} from '@mui/material';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import AddPhotoAlternateRoundedIcon from '@mui/icons-material/AddPhotoAlternateRounded';
import { useTranslation } from 'react-i18next';
import { SectionTitle } from './AppPageParts';
import { useLauncherTabDialog } from '../launcherTabs';

export interface GalleryShot {
  url: string;
  caption: string;
  width?: number;
  height?: number;
}

const HEIGHT = { xs: 190, sm: 250 };

const ShotLightbox = ({
  shots,
  index,
  onClose,
  onIndex,
  appTitle,
}: {
  shots: GalleryShot[];
  index: number | null;
  onClose: () => void;
  onIndex: (index: number) => void;
  appTitle: string;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const open = index !== null && !!shots[index];
  const shot = open ? shots[index] : null;
  // Put away while its launcher tab is hidden; the arrows wait for it too.
  const dialogShown = useLauncherTabDialog(open);
  const isShown = dialogShown.open;
  const go = useCallback(
    (delta: number) => {
      if (index === null || shots.length === 0) return;
      onIndex((index + delta + shots.length) % shots.length);
    },
    [index, onIndex, shots.length]
  );

  useEffect(() => {
    if (!isShown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') go(theme.direction === 'rtl' ? 1 : -1);
      if (event.key === 'ArrowRight') go(theme.direction === 'rtl' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, isShown, theme.direction]);

  return (
    <Dialog
      PaperProps={{
        sx: {
          backgroundColor: alpha(theme.palette.background.default, 0.96),
          backgroundImage: 'none',
          borderRadius: '18px',
          maxHeight: '94vh',
          maxWidth: '94vw',
          overflow: 'hidden',
        },
      }}
      maxWidth={false}
      onClose={onClose}
      {...dialogShown}
    >
      {shot && (
        <Box sx={{ position: 'relative' }}>
          <Box
            alt={
              shot.caption ||
              t('core:app_page.screenshots.alt', {
                index: (index ?? 0) + 1,
                name: appTitle,
                postProcess: 'capitalizeFirstChar',
              })
            }
            component="img"
            src={shot.url}
            sx={{
              display: 'block',
              maxHeight: 'calc(94vh - 64px)',
              maxWidth: '94vw',
              objectFit: 'contain',
            }}
          />
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: 2,
              justifyContent: 'space-between',
              minHeight: 56,
              px: 2,
            }}
          >
            <Typography sx={{ color: 'text.secondary', fontSize: '14px' }}>
              {shot.caption}
            </Typography>
            <Typography sx={{ color: 'text.secondary', fontSize: '13px' }}>
              {t('core:app_page.screenshots.counter', {
                current: (index ?? 0) + 1,
                total: shots.length,
              })}
            </Typography>
          </Box>
          <IconButton
            aria-label={t('core:action.close', {
              postProcess: 'capitalizeFirstChar',
            })}
            onClick={onClose}
            sx={{
              backgroundColor: alpha(theme.palette.background.default, 0.7),
              position: 'absolute',
              right: 10,
              top: 10,
            }}
          >
            <CloseRoundedIcon />
          </IconButton>
          {shots.length > 1 && (
            <>
              <IconButton
                aria-label={t('core:app_page.screenshots.previous', {
                  postProcess: 'capitalizeFirstChar',
                })}
                onClick={() => go(-1)}
                sx={{
                  backgroundColor: alpha(theme.palette.background.default, 0.7),
                  left: 10,
                  position: 'absolute',
                  top: 'calc(50% - 48px)',
                }}
              >
                <ChevronLeftRoundedIcon />
              </IconButton>
              <IconButton
                aria-label={t('core:app_page.screenshots.next', {
                  postProcess: 'capitalizeFirstChar',
                })}
                onClick={() => go(1)}
                sx={{
                  backgroundColor: alpha(theme.palette.background.default, 0.7),
                  position: 'absolute',
                  right: 10,
                  top: 'calc(50% - 48px)',
                }}
              >
                <ChevronRightRoundedIcon />
              </IconButton>
            </>
          )}
        </Box>
      )}
    </Dialog>
  );
};

export const AppScreenshots = ({
  shots,
  loading,
  appTitle,
  isPublisher,
  onAdd,
}: {
  shots: GalleryShot[];
  loading: boolean;
  appTitle: string;
  isPublisher: boolean;
  onAdd: () => void;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const scroller = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const updateEdges = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const max = element.scrollWidth - element.clientWidth;
    const position = Math.abs(element.scrollLeft);
    setEdges({ start: position <= 2, end: position >= max - 2 });
  }, []);

  useEffect(() => {
    updateEdges();
    const element = scroller.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateEdges);
    observer.observe(element);
    return () => observer.disconnect();
  }, [shots.length, updateEdges]);

  if (!loading && shots.length === 0 && !isPublisher) return null;

  const scrollBy = (direction: number) => {
    const element = scroller.current;
    if (!element) return;
    const step = element.clientWidth * 0.8 * direction;
    element.scrollBy({
      behavior: 'smooth',
      left: theme.direction === 'rtl' ? -step : step,
    });
  };

  return (
    <Box
      component="section"
      aria-labelledby="app-page-screenshots"
      sx={{ mb: 3 }}
    >
      <SectionTitle id="app-page-screenshots">
        {t('core:app_page.screenshots.title', {
          postProcess: 'capitalizeFirstChar',
        })}
      </SectionTitle>
      <Box sx={{ position: 'relative' }}>
        <Box
          onScroll={updateEdges}
          ref={scroller}
          sx={{
            display: 'flex',
            gap: 1.5,
            overflowX: 'auto',
            pb: 1,
            scrollSnapType: 'x mandatory',
            // A thin, themed bar instead of the system's light one.
            scrollbarColor: `${alpha(theme.palette.text.primary, 0.22)} transparent`,
            scrollbarWidth: 'thin',
          }}
        >
          {loading && shots.length === 0
            ? [0, 1, 2].map((item) => (
                <Skeleton
                  key={item}
                  sx={{ borderRadius: '16px', flexShrink: 0 }}
                  variant="rectangular"
                  height={HEIGHT.sm}
                  width={HEIGHT.sm * 1.6}
                />
              ))
            : shots.map((shot, index) => {
                const ratio =
                  shot.width && shot.height ? shot.width / shot.height : 1.6;
                return (
                  <ButtonBase
                    aria-label={
                      shot.caption ||
                      t('core:app_page.screenshots.alt', {
                        index: index + 1,
                        name: appTitle,
                        postProcess: 'capitalizeFirstChar',
                      })
                    }
                    focusRipple
                    key={shot.url}
                    onClick={() => setOpen(index)}
                    sx={{
                      aspectRatio: `${ratio}`,
                      border: `1px solid ${alpha(theme.palette.text.primary, 0.1)}`,
                      borderRadius: '16px',
                      flexShrink: 0,
                      height: HEIGHT,
                      overflow: 'hidden',
                      scrollSnapAlign: 'start',
                      transition: 'transform 160ms ease, box-shadow 160ms ease',
                      '&:hover': {
                        boxShadow: `0 10px 28px ${alpha(theme.palette.common.black, 0.35)}`,
                        transform: 'translateY(-2px)',
                      },
                    }}
                  >
                    <Box
                      alt=""
                      component="img"
                      loading="lazy"
                      src={shot.url}
                      sx={{
                        display: 'block',
                        height: '100%',
                        objectFit: 'cover',
                        width: '100%',
                      }}
                    />
                  </ButtonBase>
                );
              })}
          {isPublisher && !loading && shots.length < 5 && (
            <ButtonBase
              onClick={onAdd}
              sx={{
                alignItems: 'center',
                border: `2px dashed ${alpha(theme.palette.text.primary, 0.2)}`,
                borderRadius: '16px',
                color: 'text.secondary',
                display: 'flex',
                flexDirection: 'column',
                flexShrink: 0,
                gap: 1,
                height: HEIGHT,
                justifyContent: 'center',
                px: 2,
                width: { xs: 190, sm: 220 },
                '&:hover': {
                  borderColor: theme.palette.primary.main,
                  color: theme.palette.primary.main,
                },
                '&.Mui-focusVisible': {
                  borderColor: theme.palette.primary.main,
                  color: theme.palette.primary.main,
                  outline: `2px solid ${theme.palette.primary.main}`,
                  outlineOffset: 2,
                },
              }}
            >
              <AddPhotoAlternateRoundedIcon />
              <Typography sx={{ fontSize: '14px', fontWeight: 600 }}>
                {t('core:app_page.screenshots.add', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </ButtonBase>
          )}
        </Box>
        {!edges.start && (
          <IconButton
            aria-label={t('core:app_page.screenshots.scroll_back', {
              postProcess: 'capitalizeFirstChar',
            })}
            onClick={() => scrollBy(-1)}
            sx={{
              backgroundColor: alpha(theme.palette.background.paper, 0.9),
              boxShadow: 2,
              left: -8,
              position: 'absolute',
              top: 'calc(50% - 24px)',
              '&:hover': { backgroundColor: theme.palette.background.paper },
            }}
          >
            <ChevronLeftRoundedIcon />
          </IconButton>
        )}
        {!edges.end && (
          <IconButton
            aria-label={t('core:app_page.screenshots.scroll_more', {
              postProcess: 'capitalizeFirstChar',
            })}
            onClick={() => scrollBy(1)}
            sx={{
              backgroundColor: alpha(theme.palette.background.paper, 0.9),
              boxShadow: 2,
              position: 'absolute',
              right: -8,
              top: 'calc(50% - 24px)',
              '&:hover': { backgroundColor: theme.palette.background.paper },
            }}
          >
            <ChevronRightRoundedIcon />
          </IconButton>
        )}
      </Box>
      <ShotLightbox
        appTitle={appTitle}
        index={open}
        onClose={() => setOpen(null)}
        onIndex={setOpen}
        shots={shots}
      />
    </Box>
  );
};
