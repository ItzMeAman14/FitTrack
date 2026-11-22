export type ParsedVideoSource =
  | { kind: 'youtube'; videoId: string; embedUrl: string; thumbnailUrl: string }
  | { kind: 'vimeo'; videoId: string; embedUrl: string }
  | { kind: 'video'; src: string }
  | null;

export function parseVideoSource(url: string | null | undefined): ParsedVideoSource {
  if (!url || !url.trim()) return null;
  const trimmed = url.trim();

  if (trimmed.startsWith('data:video/')) {
    return { kind: 'video', src: trimmed };
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();

    if (host.includes('youtube.com') || host === 'youtu.be') {
      let videoId = '';
      if (host === 'youtu.be') {
        videoId = parsed.pathname.replace(/^\//, '').split('/')[0];
      } else if (parsed.pathname.startsWith('/shorts/')) {
        videoId = parsed.pathname.split('/')[2] || '';
      } else if (parsed.pathname.startsWith('/embed/')) {
        videoId = parsed.pathname.split('/')[2] || '';
      } else {
        videoId = parsed.searchParams.get('v') || '';
      }
      if (videoId && /^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
        return {
          kind: 'youtube',
          videoId,
          embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`,
          thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        };
      }
    }

    if (host.includes('vimeo.com')) {
      const segments = parsed.pathname.split('/').filter(Boolean);
      const id = segments[segments.length - 1];
      if (id && /^\d+$/.test(id)) {
        return {
          kind: 'vimeo',
          videoId: id,
          embedUrl: `https://player.vimeo.com/video/${id}?autoplay=1`,
        };
      }
    }
  } catch {
    return null;
  }

  return { kind: 'video', src: trimmed };
}
