import { useEffect, useMemo, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  Skeleton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { useTranslation, type TFunction } from 'react-i18next';
import i18n from '../../i18n/i18n';
import { getBaseApiReact } from '../../utils/globalApi';
import { executeEvent } from '../../utils/events';
import qortalWhiteLogo from '../../assets/sidebar/qortal-logo-white.png';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';

type QAppPreviewKind = 'qtube' | 'quitter' | 'subwire';

export type ReticulumQAppLink = {
  appName: 'Q-Tube' | 'Quitter' | 'SubWire';
  author: string;
  identifier: string;
  kind: QAppPreviewKind;
  link: string;
  path: string;
};

type QAppPreviewData = {
  author: string;
  body: string;
  createdAt: number | null;
  duration?: number | string | null;
  thumbnail?: string;
  title: string;
};

type QAppPreviewFailure = 'not-found' | 'unavailable';

class QAppPreviewLoadError extends Error {
  reason: QAppPreviewFailure;

  constructor(reason: QAppPreviewFailure, message: string) {
    super(message);
    this.name = 'QAppPreviewLoadError';
    this.reason = reason;
  }
}

const QAPP_LINK_PATTERN = /qortal:\/\/APP\/[^\s<>"']+/gi;
const QAPP_PREVIEW_CACHE_TTL_MS = 30 * 60 * 1000;
const QAPP_PREVIEW_CACHE_MAX_ENTRIES = 24;
const QAPP_PREVIEW_REQUEST_TIMEOUT_MS = 15_000;
const QAPP_PREVIEWS_PER_MESSAGE = 3;
const QAPP_PREVIEW_ACCENTS: Record<QAppPreviewKind, string> = {
  qtube: '#ef3340',
  quitter: '#10b9dc',
  subwire: '#7257d9',
};
const previewCache = new Map<
  string,
  { data: QAppPreviewData; fetchedAt: number }
>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const safeString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const Q_TUBE_INTERNAL_METADATA_PATTERN =
  /\*{0,2}\s*category\s*:[^;\r\n*]+(?:\s*;\s*(?:subcategory|code)\s*:[^;\r\n*]+)*\s*\*{0,2}/gi;

export const normalizeQTubeDescription = (
  value: unknown,
  t: TFunction = i18n.t
) => {
  const description = safeString(value)
    .replace(Q_TUBE_INTERNAL_METADATA_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (
    description ||
    t('reticulum:qapp_preview.watch_on_qtube', {
      postProcess: 'capitalizeFirstChar',
    })
  );
};

const hasMediaItems = (value: unknown) =>
  Array.isArray(value) &&
  value.some(
    (item) =>
      (typeof item === 'string' && item.trim().length > 0) || isRecord(item)
  );

export const getQuitterPostSummary = (
  documentValue: Record<string, unknown>,
  mediaTitle = '',
  t: TFunction = i18n.t
) => {
  const text = safeString(documentValue.text);
  if (text) return text;
  if (hasMediaItems(documentValue.images))
    return t('reticulum:qapp_preview.shared_photo', {
      postProcess: 'capitalizeFirstChar',
    });
  if (hasMediaItems(documentValue.videos)) {
    return mediaTitle
      ? t('reticulum:qapp_preview.shared_video_titled', {
          postProcess: 'capitalizeFirstChar',
          title: mediaTitle,
        })
      : t('reticulum:qapp_preview.shared_video', {
          postProcess: 'capitalizeFirstChar',
        });
  }
  return t('reticulum:qapp_preview.view_on_quitter', {
    postProcess: 'capitalizeFirstChar',
  });
};

const safeNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const stripTrailingLinkPunctuation = (value: string) =>
  value.replace(/[),.;!?]+$/g, '');

const textWithoutCodeBlocks = (source: string) => {
  if (!source) return '';
  if (typeof DOMParser === 'undefined') return source;
  const documentNode = new DOMParser().parseFromString(source, 'text/html');
  const walker = documentNode.createTreeWalker(
    documentNode.body,
    NodeFilter.SHOW_TEXT
  );
  const output: string[] = [];
  let node = walker.nextNode();
  while (node) {
    if (!node.parentElement?.closest('code, pre')) {
      output.push(node.textContent || '');
    }
    node = walker.nextNode();
  }
  return output.join(' ');
};

const parseCandidate = (candidate: string): ReticulumQAppLink | null => {
  const link = stripTrailingLinkPunctuation(candidate);
  const match = link.match(
    /^qortal:\/\/APP\/(Q-Tube|Quitter|SubWire)\/(video|post|publication)\/([^/]+)\/([^/?#]+)$/i
  );
  if (!match) return null;

  const [, rawAppName, rawRoute, rawAuthor, rawIdentifier] = match;
  const appKey = rawAppName.toLowerCase();
  const route = rawRoute.toLowerCase();
  const expectedRoute =
    appKey === 'q-tube'
      ? 'video'
      : appKey === 'quitter'
        ? 'post'
        : 'publication';
  if (route !== expectedRoute) return null;

  let author = '';
  let identifier = '';
  try {
    author = decodeURIComponent(rawAuthor).trim();
    identifier = decodeURIComponent(rawIdentifier).trim();
  } catch {
    return null;
  }
  if (!author || !identifier) return null;

  const appName =
    appKey === 'q-tube'
      ? 'Q-Tube'
      : appKey === 'quitter'
        ? 'Quitter'
        : 'SubWire';
  const kind =
    appKey === 'q-tube'
      ? 'qtube'
      : appKey === 'quitter'
        ? 'quitter'
        : 'subwire';

  return {
    appName,
    author,
    identifier,
    kind,
    link,
    path: `${expectedRoute}/${rawAuthor}/${rawIdentifier}`,
  };
};

export const parseReticulumQAppLinks = (
  source: string
): ReticulumQAppLink[] => {
  const candidates =
    textWithoutCodeBlocks(source).match(QAPP_LINK_PATTERN) || [];
  const seen = new Set<string>();
  const parsed: ReticulumQAppLink[] = [];

  for (const candidate of candidates) {
    const link = parseCandidate(candidate);
    if (!link) continue;
    const key = link.link.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push(link);
    if (parsed.length >= QAPP_PREVIEWS_PER_MESSAGE) break;
  }
  return parsed;
};

export const formatReticulumQAppDisplayLink = (link: ReticulumQAppLink) => {
  const author = encodeURIComponent(link.author);
  const prefix =
    link.kind === 'subwire'
      ? `qortal://APP/SubWire/author/${author}/`
      : `qortal://APP/${link.appName}/${link.kind === 'qtube' ? 'video' : 'post'}/${author}/`;
  const identifier = encodeURIComponent(link.identifier);
  if (identifier.length <= 26) return `${prefix}${identifier}`;
  return `${prefix}${identifier.slice(0, 10)}(...)${identifier.slice(-10)}`;
};

const readCachedPreview = (key: string) => {
  const cached = previewCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > QAPP_PREVIEW_CACHE_TTL_MS) {
    previewCache.delete(key);
    return null;
  }
  previewCache.delete(key);
  previewCache.set(key, cached);
  return cached.data;
};

const cachePreview = (key: string, data: QAppPreviewData) => {
  previewCache.delete(key);
  previewCache.set(key, { data, fetchedAt: Date.now() });
  while (previewCache.size > QAPP_PREVIEW_CACHE_MAX_ENTRIES) {
    const oldest = previewCache.keys().next().value as string | undefined;
    if (!oldest) break;
    previewCache.delete(oldest);
  }
};

const fetchJson = async (url: string, signal: AbortSignal) => {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Q-App preview request failed (${response.status})`);
  }
  return response.json() as Promise<unknown>;
};

const resourceDocumentUrl = (link: ReticulumQAppLink) =>
  `${getBaseApiReact()}/arbitrary/DOCUMENT/${encodeURIComponent(
    link.author
  )}/${encodeURIComponent(link.identifier)}`;

const resourceSearchUrl = (link: ReticulumQAppLink) => {
  const params = new URLSearchParams({
    exactmatchnames: 'true',
    identifier: link.identifier,
    includemetadata: 'true',
    limit: '1',
    name: link.author,
    prefix: 'false',
    reverse: 'true',
    service: 'DOCUMENT',
  });
  return `${getBaseApiReact()}/arbitrary/resources/search?${params.toString()}`;
};

const qAppIconUrl = (appName: string) =>
  `${getBaseApiReact()}/arbitrary/THUMBNAIL/${encodeURIComponent(
    appName
  )}/qortal_avatar?async=true`;

const qortalAvatarUrl = (name: string) =>
  `${getBaseApiReact()}/arbitrary/THUMBNAIL/${encodeURIComponent(
    name
  )}/qortal_avatar?async=true`;

const embeddedImageDataUrl = (value: unknown) => {
  const source = safeString(value).replace(/\s+/g, '');
  if (!source) return '';
  if (
    source.startsWith('data:image/') ||
    source.startsWith('http://') ||
    source.startsWith('https://')
  ) {
    return source;
  }

  const mimeType = source.startsWith('UklGR')
    ? 'image/webp'
    : source.startsWith('iVBORw0KGgo')
      ? 'image/png'
      : source.startsWith('/9j/')
        ? 'image/jpeg'
        : source.startsWith('R0lGOD')
          ? 'image/gif'
          : '';

  return mimeType ? `data:${mimeType};base64,${source}` : '';
};

export const resolveReticulumPreviewImageUrl = (
  value: unknown,
  fallbackName: string,
  fallbackIdentifier?: string
) => {
  const direct = safeString(value);
  if (
    direct.startsWith('data:') ||
    direct.startsWith('http://') ||
    direct.startsWith('https://')
  ) {
    return direct;
  }
  if (direct) {
    return `${getBaseApiReact()}/arbitrary/IMAGE/${encodeURIComponent(
      fallbackName
    )}/${encodeURIComponent(direct)}?async=true`;
  }
  if (isRecord(value)) {
    const embeddedSource =
      embeddedImageDataUrl(value.src) ||
      embeddedImageDataUrl(value.data) ||
      embeddedImageDataUrl(value.base64) ||
      embeddedImageDataUrl(value.url);
    if (embeddedSource) return embeddedSource;

    const service = safeString(value.service) || 'IMAGE';
    const name = safeString(value.name) || fallbackName;
    const identifier = safeString(value.identifier) || fallbackIdentifier || '';
    if (name && identifier) {
      return `${getBaseApiReact()}/arbitrary/${encodeURIComponent(
        service
      )}/${encodeURIComponent(name)}/${encodeURIComponent(
        identifier
      )}?async=true`;
    }
  }
  return '';
};

const loadPreview = async (
  link: ReticulumQAppLink,
  signal: AbortSignal
): Promise<QAppPreviewData> => {
  const [documentResult, searchResult] = await Promise.allSettled([
    fetchJson(resourceDocumentUrl(link), signal),
    fetchJson(resourceSearchUrl(link), signal),
  ]);
  if (documentResult.status === 'rejected') {
    const resourceWasNotFound =
      searchResult.status === 'fulfilled' &&
      Array.isArray(searchResult.value) &&
      searchResult.value.length === 0;
    throw new QAppPreviewLoadError(
      resourceWasNotFound ? 'not-found' : 'unavailable',
      resourceWasNotFound
        ? 'Q-App preview resource was not found'
        : 'Q-App preview document could not be loaded'
    );
  }
  const documentValue = documentResult.value;
  const searchValue =
    searchResult.status === 'fulfilled' ? searchResult.value : [];
  if (!isRecord(documentValue)) {
    throw new QAppPreviewLoadError(
      'unavailable',
      'Q-App preview document is invalid'
    );
  }
  const searchEntry =
    Array.isArray(searchValue) && isRecord(searchValue[0])
      ? searchValue[0]
      : null;
  const searchMetadata =
    searchEntry && isRecord(searchEntry.metadata) ? searchEntry.metadata : null;
  const searchCreatedAt =
    (searchEntry && safeNumber(searchEntry.created)) || null;

  if (link.kind === 'qtube') {
    const description =
      safeString(documentValue.fullDescription) ||
      safeString(documentValue.description) ||
      safeString(searchMetadata?.description);
    return {
      author: link.author,
      body: normalizeQTubeDescription(description),
      createdAt:
        safeNumber(documentValue.created) ||
        safeNumber(documentValue.timestamp) ||
        searchCreatedAt,
      duration:
        safeNumber(documentValue.videoDuration) ||
        safeNumber(documentValue.duration) ||
        safeString(documentValue.duration),
      thumbnail: resolveReticulumPreviewImageUrl(
        documentValue.videoImage,
        link.author,
        link.identifier
      ),
      title:
        safeString(documentValue.title) ||
        safeString(searchMetadata?.title) ||
        'Q-Tube video',
    };
  }

  if (link.kind === 'quitter') {
    const text = safeString(documentValue.text);
    const videos = Array.isArray(documentValue.videos)
      ? documentValue.videos
      : [];
    const firstVideo = videos.find(isRecord);
    let mediaTitle = '';
    if (!text && firstVideo) {
      const videoName = safeString(firstVideo.name);
      const videoIdentifier = safeString(firstVideo.identifier);
      if (videoName && videoIdentifier) {
        const nestedUrl = `${getBaseApiReact()}/arbitrary/DOCUMENT/${encodeURIComponent(
          videoName
        )}/${encodeURIComponent(videoIdentifier)}`;
        const nested = await fetchJson(nestedUrl, signal).catch(() => null);
        if (isRecord(nested)) mediaTitle = safeString(nested.title);
      }
    }
    return {
      author: safeString(documentValue.name) || link.author,
      body: getQuitterPostSummary(documentValue, mediaTitle),
      createdAt: safeNumber(documentValue.timestamp) || searchCreatedAt,
      title: '',
    };
  }

  const thumbnailCandidate =
    documentValue.coverImage ||
    documentValue.image ||
    documentValue.thumbnail ||
    documentValue.banner;
  return {
    author: safeString(documentValue.name) || link.author,
    body:
      safeString(documentValue.content) ||
      safeString(documentValue.subtitle) ||
      safeString(searchMetadata?.description),
    createdAt: safeNumber(documentValue.timestamp) || searchCreatedAt,
    thumbnail: resolveReticulumPreviewImageUrl(
      thumbnailCandidate,
      link.author,
      link.identifier
    ),
    title:
      safeString(documentValue.title) ||
      safeString(searchMetadata?.title) ||
      'SubWire publication',
  };
};

const openQAppLink = (link: ReticulumQAppLink, pathOverride?: string) => {
  executeEvent('addTab', {
    data: {
      name: link.appName,
      path: pathOverride || link.path,
      service: 'APP',
    },
  });
  executeEvent('open-apps-mode', {});
};

const formatPreviewDate = (timestamp: number | null) => {
  if (!timestamp) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(timestamp);
  } catch {
    return '';
  }
};

const formatDuration = (duration: number | string | null | undefined) => {
  if (duration == null || duration === '') return '';
  if (typeof duration === 'string' && duration.includes(':')) return duration;
  const seconds = Number(duration);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
};

const WIDE_MEDIA_PREVIEW_WIDTH = 'min(730px, 100%)';

function PreviewShell({
  accentColor,
  children,
  link,
  maxWidth = 'min(510px, 100%)',
  minHeight,
}: {
  accentColor: string;
  children: React.ReactNode;
  link?: ReticulumQAppLink;
  maxWidth?: string;
  minHeight: number;
}) {
  const theme = useTheme();
  return (
    <>
      {link ? <PreviewSourceLink link={link} maxWidth={maxWidth} /> : null}
      <Box
        sx={{
          alignSelf: 'stretch',
          backgroundColor:
            theme.palette.mode === 'light'
              ? theme.palette.background.paper
              : '#17191f',
          border: '1px solid',
          borderColor:
            theme.palette.mode === 'light'
              ? 'rgba(34,49,69,0.18)'
              : 'rgba(157,173,198,0.2)',
          borderLeft: `3px solid ${accentColor}`,
          borderRadius: '8px',
          boxSizing: 'border-box',
          color: 'text.primary',
          height: { xs: 'auto', sm: minHeight },
          maxWidth,
          minHeight,
          mt: 0.8,
          overflow: 'hidden',
          width: '100%',
        }}
      >
        {children}
      </Box>
    </>
  );
}

function PreviewSourceLink({
  link,
  maxWidth,
}: {
  link: ReticulumQAppLink;
  maxWidth: string;
}) {
  return (
    <Box
      component="a"
      href={link.link}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openQAppLink(link);
      }}
      title={link.link}
      sx={{
        color: '#69a9ff',
        display: 'block',
        fontSize: 12,
        lineHeight: 1.35,
        maxWidth,
        mt: 0.65,
        overflow: 'hidden',
        textDecoration: 'none',
        textOverflow: 'ellipsis',
        userSelect: 'text',
        whiteSpace: 'nowrap',
        width: '100%',
        '&:hover': {
          color: '#8dbdff',
          textDecoration: 'underline',
        },
      }}
    >
      {formatReticulumQAppDisplayLink(link)}
    </Box>
  );
}

function AppHeader({ link }: { link: ReticulumQAppLink }) {
  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        gap: 0.8,
        minHeight: 28,
      }}
    >
      <Avatar
        alt=""
        src={qAppIconUrl(link.appName)}
        variant="rounded"
        sx={{
          bgcolor: 'rgba(78, 156, 255, 0.14)',
          borderRadius: '6px',
          height: 24,
          width: 24,
        }}
      >
        <Box
          alt=""
          component="img"
          draggable={false}
          src={LogoSelected}
          sx={{ height: 'auto', width: '64%' }}
        />
      </Avatar>
      <Typography
        sx={{ color: 'text.secondary', fontSize: 11.5, fontWeight: 650 }}
      >
        {link.appName}
      </Typography>
    </Box>
  );
}

const horizontalPreviewSx = {
  display: 'grid',
  gap: 1.5,
  gridTemplateColumns: {
    xs: 'minmax(0, 1fr)',
    sm: 'minmax(0, 364px) minmax(0, 1fr)',
  },
  mt: 1.15,
};

const previewShellLayout = (kind: QAppPreviewKind) => ({
  maxWidth: kind === 'quitter' ? 'min(510px, 100%)' : WIDE_MEDIA_PREVIEW_WIDTH,
  minHeight: kind === 'quitter' ? 185 : 268,
});

function PreviewSkeleton({ link }: { link: ReticulumQAppLink }) {
  const layout = previewShellLayout(link.kind);
  return (
    <PreviewShell
      accentColor={QAPP_PREVIEW_ACCENTS[link.kind]}
      link={link}
      maxWidth={layout.maxWidth}
      minHeight={layout.minHeight}
    >
      <Box sx={{ p: 1.6 }}>
        <Skeleton height={26} width={92} />
        <Box sx={horizontalPreviewSx}>
          <Skeleton
            sx={{ borderRadius: 1 }}
            variant="rectangular"
            height={link.kind === 'quitter' ? 88 : 190}
          />
          <Box>
            <Skeleton height={26} width="65%" />
            <Skeleton height={19} width="42%" />
            <Skeleton height={18} width="96%" />
            <Skeleton height={18} width="82%" />
            <Skeleton height={34} width={180} sx={{ mt: 1 }} />
          </Box>
        </Box>
      </Box>
    </PreviewShell>
  );
}

function PreviewFailure({
  failure,
  link,
  onRetry,
}: {
  failure: QAppPreviewFailure;
  link: ReticulumQAppLink;
  onRetry: () => void;
}) {
  const { t } = useTranslation(['core', 'reticulum']);
  const layout = previewShellLayout(link.kind);
  const notFound = failure === 'not-found';
  return (
    <PreviewShell
      accentColor={QAPP_PREVIEW_ACCENTS[link.kind]}
      link={link}
      maxWidth={layout.maxWidth}
      minHeight={layout.minHeight}
    >
      <Box
        sx={{
          alignItems: 'center',
          boxSizing: 'border-box',
          display: 'flex',
          height: '100%',
          minHeight: layout.minHeight,
          p: 1.6,
        }}
      >
        <Box sx={{ maxWidth: 420 }}>
          <AppHeader link={link} />
          <Typography sx={{ fontSize: 14, fontWeight: 750, mt: 1.6 }}>
            {notFound
              ? t('reticulum:qapp_preview.resource_not_found', {
                  postProcess: 'capitalizeFirstChar',
                })
              : t('reticulum:qapp_preview.preview_unavailable', {
                  postProcess: 'capitalizeFirstChar',
                })}
          </Typography>
          <Typography
            sx={{
              color: 'text.secondary',
              fontSize: 12.5,
              lineHeight: 1.45,
              mt: 0.45,
            }}
          >
            {notFound
              ? t('reticulum:qapp_preview.no_resource', {
                  postProcess: 'capitalizeFirstChar',
                })
              : t('reticulum:qapp_preview.preview_failed', {
                  postProcess: 'capitalizeFirstChar',
                })}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.7 }}>
            <Button
              onClick={(event) => {
                event.stopPropagation();
                onRetry();
              }}
              size="small"
              startIcon={<RefreshRoundedIcon />}
              variant="contained"
              sx={{ borderRadius: '6px', minHeight: 32, textTransform: 'none' }}
            >
              {notFound
                ? t('reticulum:qapp_preview.check_again', {
                    postProcess: 'capitalizeFirstChar',
                  })
                : t('core:retry', { postProcess: 'capitalizeFirstChar' })}
            </Button>
            {!notFound ? (
              <Button
                endIcon={<OpenInNewRoundedIcon />}
                onClick={(event) => {
                  event.stopPropagation();
                  openQAppLink(link);
                }}
                size="small"
                variant="outlined"
                sx={{
                  borderColor: 'divider',
                  borderRadius: '6px',
                  color: 'text.primary',
                  minHeight: 32,
                  textTransform: 'none',
                }}
              >
                Open in {link.appName}
              </Button>
            ) : null}
          </Box>
        </Box>
      </Box>
    </PreviewShell>
  );
}

function MediaPanel({
  ariaLabel,
  onMediaError,
  onClick,
  src,
  showPlay,
}: {
  ariaLabel: string;
  onMediaError?: () => void;
  onClick: () => void;
  src?: string;
  showPlay?: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [imageScale, setImageScale] = useState(1);

  useEffect(() => {
    setImageFailed(false);
    setImageScale(1);
  }, [src]);

  const hasImage = Boolean(src && !imageFailed);

  return (
    <ButtonBase
      aria-label={ariaLabel}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      sx={{
        aspectRatio: '16 / 9',
        backgroundColor: 'rgba(0,0,0,0.28)',
        borderRadius: '6px',
        display: 'block',
        minHeight: { xs: 150, sm: 0 },
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
    >
      {hasImage ? (
        <Box
          alt=""
          component="img"
          onError={() => {
            setImageFailed(true);
            onMediaError?.();
          }}
          onLoad={(event: React.SyntheticEvent<HTMLImageElement>) => {
            const image = event.currentTarget;
            if (!image.naturalWidth || !image.naturalHeight) {
              setImageScale(1);
              return;
            }
            const holderAspectRatio = 16 / 9;
            const imageAspectRatio = image.naturalWidth / image.naturalHeight;
            const coverScale = Math.max(
              imageAspectRatio / holderAspectRatio,
              holderAspectRatio / imageAspectRatio
            );
            setImageScale(Math.min(coverScale, 1.2));
          }}
          src={src}
          sx={{
            display: 'block',
            height: '100%',
            objectFit: 'contain',
            objectPosition: 'center',
            transform: `scale(${imageScale})`,
            transformOrigin: 'center',
            width: '100%',
          }}
        />
      ) : (
        <Box
          component="img"
          src={qortalWhiteLogo}
          alt=""
          sx={{
            height: 54,
            left: '50%',
            opacity: 0.16,
            position: 'absolute',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 54,
          }}
        />
      )}
      {showPlay && (
        <Box
          sx={{
            alignItems: 'center',
            backgroundColor: 'rgba(0,0,0,0.66)',
            borderRadius: '50%',
            color: '#fff',
            display: 'flex',
            height: 44,
            justifyContent: 'center',
            left: '50%',
            position: 'absolute',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 44,
          }}
        >
          <PlayArrowRoundedIcon sx={{ fontSize: 31 }} />
        </Box>
      )}
    </ButtonBase>
  );
}

function QTubePreview({
  data,
  link,
}: {
  data: QAppPreviewData;
  link: ReticulumQAppLink;
}) {
  const date = formatPreviewDate(data.createdAt);
  const duration = formatDuration(data.duration);
  const layout = previewShellLayout(link.kind);
  return (
    <PreviewShell
      accentColor={QAPP_PREVIEW_ACCENTS.qtube}
      link={link}
      maxWidth={layout.maxWidth}
      minHeight={layout.minHeight}
    >
      <Box sx={{ p: 1.6 }}>
        <AppHeader link={link} />
        <Box sx={horizontalPreviewSx}>
          <MediaPanel
            ariaLabel={`Play ${data.title} in Q-Tube`}
            onClick={() => openQAppLink(link)}
            showPlay
            src={data.thumbnail}
          />
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              py: { xs: 0, sm: 0.25 },
            }}
          >
            <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
              {data.author}
            </Typography>
            <Tooltip arrow placement="top" title={data.title}>
              <ButtonBase
                onClick={(event) => {
                  event.stopPropagation();
                  openQAppLink(link);
                }}
                sx={{
                  alignSelf: 'stretch',
                  borderRadius: '4px',
                  color: '#69a9ff',
                  display: 'block',
                  fontSize: 14,
                  fontWeight: 750,
                  lineHeight: 1.35,
                  mt: 0.45,
                  overflow: 'hidden',
                  textAlign: 'left',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  '&:hover': { color: '#8dbdff' },
                }}
              >
                {data.title}
              </ButtonBase>
            </Tooltip>
            <Typography
              sx={{
                color: 'text.secondary',
                display: '-webkit-box',
                fontSize: 12.5,
                lineHeight: 1.45,
                mt: 0.85,
                overflow: 'hidden',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 4,
              }}
            >
              {normalizeQTubeDescription(data.body)}
            </Typography>
            <Typography
              sx={{
                color: 'text.secondary',
                fontSize: 11,
                mt: 'auto',
                pt: 2.2,
              }}
            >
              Q-Tube
              {date ? ` · ${date}` : ''}
              {duration ? ` · ${duration}` : ''}
            </Typography>
          </Box>
        </Box>
      </Box>
    </PreviewShell>
  );
}

function QuitterPreview({
  data,
  link,
}: {
  data: QAppPreviewData;
  link: ReticulumQAppLink;
}) {
  const { t } = useTranslation(['core', 'reticulum']);
  const date = formatPreviewDate(data.createdAt);
  const layout = previewShellLayout(link.kind);
  return (
    <PreviewShell
      accentColor={QAPP_PREVIEW_ACCENTS.quitter}
      link={link}
      maxWidth={layout.maxWidth}
      minHeight={layout.minHeight}
    >
      <Box sx={{ p: 1.6 }}>
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <AppHeader link={link} />
          <Button
            endIcon={<OpenInNewRoundedIcon />}
            onClick={(event) => {
              event.stopPropagation();
              openQAppLink(link);
            }}
            size="small"
            variant="outlined"
            sx={{
              borderColor: 'divider',
              borderRadius: '6px',
              color: 'text.primary',
              fontSize: 11.5,
              fontWeight: 650,
              minHeight: 30,
              px: 1.15,
              textTransform: 'none',
              '&:hover': {
                bgcolor: 'action.hover',
                borderColor: 'text.secondary',
              },
            }}
          >
            View post
          </Button>
        </Box>
        <Box
          sx={{
            alignItems: 'flex-start',
            display: 'grid',
            gap: 1.3,
            gridTemplateColumns: '53px minmax(0, 1fr)',
            mt: 1.15,
          }}
        >
          <Avatar
            src={qortalAvatarUrl(data.author)}
            sx={{
              bgcolor: 'rgba(255,255,255,0.05)',
              height: 53,
              width: 53,
            }}
          >
            <Box
              alt=""
              component="img"
              src={qortalWhiteLogo}
              sx={{ height: 22, opacity: 0.15, width: 22 }}
            />
          </Avatar>
          <Box
            sx={{
              alignSelf: 'stretch',
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
            }}
          >
            <Typography sx={{ fontSize: 13.5, fontWeight: 750 }}>
              {data.author}
            </Typography>
            <Typography
              sx={{
                color: 'text.secondary',
                display: '-webkit-box',
                fontSize: 12.5,
                lineHeight: 1.45,
                mt: 0.65,
                overflow: 'hidden',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 3,
              }}
            >
              {data.body ||
                t('reticulum:qapp_preview.open_in_quitter', {
                  postProcess: 'capitalizeFirstChar',
                })}
            </Typography>
            <Typography
              sx={{
                color: 'text.secondary',
                fontSize: 11,
                mt: 'auto',
                pt: 2.2,
              }}
            >
              Quitter{date ? ` · ${date}` : ''}
            </Typography>
          </Box>
        </Box>
      </Box>
    </PreviewShell>
  );
}

function SubWirePreview({
  data,
  link,
}: {
  data: QAppPreviewData;
  link: ReticulumQAppLink;
}) {
  const { t } = useTranslation(['core', 'reticulum']);
  const date = formatPreviewDate(data.createdAt);
  const [mediaFailed, setMediaFailed] = useState(false);

  useEffect(() => {
    setMediaFailed(false);
  }, [data.thumbnail]);

  const hasMedia = Boolean(data.thumbnail && !mediaFailed);
  const layout = previewShellLayout(link.kind);

  return (
    <PreviewShell
      accentColor={QAPP_PREVIEW_ACCENTS.subwire}
      link={link}
      maxWidth={layout.maxWidth}
      minHeight={layout.minHeight}
    >
      <Box sx={{ p: 1.6 }}>
        <AppHeader link={link} />
        <Box sx={hasMedia ? horizontalPreviewSx : { mt: 1.15 }}>
          {hasMedia ? (
            <MediaPanel
              ariaLabel={`Read ${data.title} in SubWire`}
              onMediaError={() => setMediaFailed(true)}
              onClick={() => openQAppLink(link)}
              src={data.thumbnail}
            />
          ) : null}
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              py: { xs: 0, sm: 0.25 },
            }}
          >
            <Tooltip arrow placement="top" title={data.title}>
              <Typography
                sx={{
                  display: 'block',
                  fontSize: 14,
                  fontWeight: 750,
                  lineHeight: 1.35,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {data.title}
              </Typography>
            </Tooltip>
            <Typography sx={{ color: 'text.secondary', fontSize: 11, mt: 0.4 }}>
              {data.author}
              {date ? ` · ${date}` : ''}
            </Typography>
            <Typography
              sx={{
                color: 'text.secondary',
                display: '-webkit-box',
                fontSize: 12.5,
                lineHeight: 1.45,
                mt: 0.85,
                overflow: 'hidden',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 3,
              }}
            >
              {data.body ||
                t('reticulum:qapp_preview.open_publication', {
                  postProcess: 'capitalizeFirstChar',
                })}
            </Typography>
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 1,
                mt: 'auto',
                pt: 2.2,
              }}
            >
              <Button
                onClick={(event) => {
                  event.stopPropagation();
                  openQAppLink(link);
                }}
                size="small"
                endIcon={<OpenInNewRoundedIcon />}
                variant="outlined"
                sx={{
                  borderColor: 'divider',
                  borderRadius: '6px',
                  color: 'text.primary',
                  fontSize: 11.5,
                  fontWeight: 650,
                  minHeight: 32,
                  textTransform: 'none',
                  '&:hover': {
                    borderColor: 'text.secondary',
                    bgcolor: 'action.hover',
                  },
                }}
              >
                Read article
              </Button>
            </Box>
          </Box>
        </Box>
      </Box>
    </PreviewShell>
  );
}

function QAppPreview({ link }: { link: ReticulumQAppLink }) {
  const cacheKey = link.link.toLowerCase();
  const [data, setData] = useState<QAppPreviewData | null>(() =>
    readCachedPreview(cacheKey)
  );
  const [failure, setFailure] = useState<QAppPreviewFailure | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (data) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setFailure('unavailable');
      controller.abort();
    }, QAPP_PREVIEW_REQUEST_TIMEOUT_MS);
    void loadPreview(link, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        cachePreview(cacheKey, next);
        setData(next);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setFailure(
            error instanceof QAppPreviewLoadError ? error.reason : 'unavailable'
          );
        }
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt, cacheKey, data, link]);

  if (failure) {
    return (
      <PreviewFailure
        failure={failure}
        link={link}
        onRetry={() => {
          setFailure(null);
          setAttempt((previous) => previous + 1);
        }}
      />
    );
  }
  if (!data) return <PreviewSkeleton link={link} />;
  if (link.kind === 'qtube') return <QTubePreview data={data} link={link} />;
  if (link.kind === 'quitter')
    return <QuitterPreview data={data} link={link} />;
  return <SubWirePreview data={data} link={link} />;
}

export function ReticulumQAppLinkPreviews({ source }: { source: string }) {
  const links = useMemo(() => parseReticulumQAppLinks(source), [source]);

  if (links.length === 0) return null;
  return (
    <>
      {links.map((link) => (
        <QAppPreview key={link.link} link={link} />
      ))}
    </>
  );
}
