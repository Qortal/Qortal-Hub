type PreviewUrlOptions = {
  cacheBuster?: number;
  language: string;
  theme: string;
};

export const buildPreviewUrl = (
  url: string,
  { cacheBuster, language, theme }: PreviewUrlOptions
): string => {
  const query = new URLSearchParams({
    theme,
    lang: language,
  });

  if (cacheBuster != null) {
    query.set('time', String(cacheBuster));
  }

  const separator =
    url.endsWith('?') || url.endsWith('&') ? '' : url.includes('?') ? '&' : '?';

  return `${url}${separator}${query.toString()}`;
};
