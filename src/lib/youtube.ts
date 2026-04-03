import axios from 'axios';

const BASE = 'https://youtube-media-downloader.p.rapidapi.com';

function headers() {
  return {
    'x-rapidapi-key': process.env.RAPIDAPI_KEY || '',
    'x-rapidapi-host': 'youtube-media-downloader.p.rapidapi.com',
  };
}

export function extractVideoId(input: string): string {
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /shorts\/([a-zA-Z0-9_-]{11})/,
    /embed\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = input.match(p);
    if (m) return m[1];
  }
  throw new Error('Invalid YouTube URL or video ID');
}

export interface VideoDetails {
  id: string;
  title: string;
  duration: number; // seconds
  thumbnail: string | null;
  channel: string | null;
  downloadUrl: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickBestVideoUrl(data: any): string | null {
  // Try videos array first (muxed mp4 with audio)
  const videos = data?.videos?.items || data?.videos || [];
  if (Array.isArray(videos) && videos.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mp4 = videos
      .filter((v: any) => v?.url && (v?.extension === 'mp4' || v?.mimeType?.includes('mp4')))
      .sort((a: any, b: any) => (b?.height || 0) - (a?.height || 0));
    const best = mp4.find((v: any) => (v?.height || 0) <= 1080) || mp4[0];
    if (best?.url) return best.url;
  }

  // Try audios array as fallback (audio-only for transcription)
  const audios = data?.audios?.items || data?.audios || [];
  if (Array.isArray(audios) && audios.length > 0) {
    const best = audios[0];
    if (best?.url) return best.url;
  }

  return null;
}

export async function getVideoDetails(urlOrId: string): Promise<VideoDetails> {
  const videoId = extractVideoId(urlOrId);

  const { data } = await axios.get(`${BASE}/v2/video/details`, {
    params: { videoId },
    headers: headers(),
    timeout: 20000,
  });

  // Parse duration - may be in seconds or "HH:MM:SS" format
  let duration = 0;
  if (typeof data?.lengthSeconds === 'number') {
    duration = data.lengthSeconds;
  } else if (typeof data?.duration === 'number') {
    duration = data.duration;
  } else if (typeof data?.duration === 'string') {
    const parts = data.duration.split(':').map(Number);
    if (parts.length === 3) duration = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) duration = parts[0] * 60 + parts[1];
  }

  const thumbnail =
    data?.thumbnails?.[0]?.url ||
    data?.thumbnail?.url ||
    data?.thumbnail ||
    null;

  const downloadUrl = pickBestVideoUrl(data);

  return {
    id: videoId,
    title: data?.title || 'Untitled',
    duration,
    thumbnail,
    channel: data?.channel?.name || data?.channel || null,
    downloadUrl,
  };
}
