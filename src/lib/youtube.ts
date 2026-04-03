import axios from 'axios';

const BASE = 'https://youtube-media-downloader.p.rapidapi.com';

function getRapidApiKey(): string {
  const key = (process.env.RAPIDAPI_KEY || '').trim();
  if (!key) {
    throw new Error('RAPIDAPI_KEY is missing. Set it in .env.local');
  }
  return key;
}

function headers() {
  return {
    'x-rapidapi-key': getRapidApiKey(),
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

interface RapidApiVideoItem {
  url?: string;
  extension?: string;
  mimeType?: string;
  height?: number;
}

interface RapidApiResponse {
  title?: string;
  lengthSeconds?: number;
  duration?: number | string;
  thumbnails?: Array<{ url: string }>;
  thumbnail?: { url: string } | string;
  channel?: { name: string } | string;
  videos?: { items?: RapidApiVideoItem[] } | RapidApiVideoItem[];
  audios?: { items?: RapidApiVideoItem[] } | RapidApiVideoItem[];
}

function pickBestVideoUrl(data: RapidApiResponse): string | null {
  // Try videos array first (muxed mp4 with audio)
  const videoSource = data?.videos;
  const videos: RapidApiVideoItem[] = Array.isArray(videoSource)
    ? videoSource
    : (videoSource as { items?: RapidApiVideoItem[] })?.items || [];
  if (videos.length > 0) {
    const mp4 = videos
      .filter((v) => v?.url && (v?.extension === 'mp4' || v?.mimeType?.includes('mp4')))
      .sort((a, b) => (b?.height || 0) - (a?.height || 0));
    const best = mp4.find((v) => (v?.height || 0) <= 1080) || mp4[0];
    if (best?.url) return best.url;
  }

  // Try audios array as fallback (audio-only for transcription)
  const audioSource = data?.audios;
  const audios: RapidApiVideoItem[] = Array.isArray(audioSource)
    ? audioSource
    : (audioSource as { items?: RapidApiVideoItem[] })?.items || [];
  if (audios.length > 0 && audios[0]?.url) return audios[0].url;

  return null;
}

export async function getVideoDetails(urlOrId: string): Promise<VideoDetails> {
  const videoId = extractVideoId(urlOrId);

  const { data: rawData } = await axios.get(`${BASE}/v2/video/details`, {
    params: { videoId },
    headers: headers(),
    timeout: 20000,
  });
  const data = rawData as RapidApiResponse;

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

  const thumbnailRaw = data?.thumbnail;
  const thumbnail =
    data?.thumbnails?.[0]?.url ||
    (typeof thumbnailRaw === 'object' && thumbnailRaw !== null ? thumbnailRaw.url : thumbnailRaw) ||
    null;

  const downloadUrl = pickBestVideoUrl(data);
  const channelRaw = data?.channel;

  return {
    id: videoId,
    title: data?.title || 'Untitled',
    duration,
    thumbnail: thumbnail || null,
    channel: (typeof channelRaw === 'object' && channelRaw !== null ? channelRaw.name : channelRaw) || null,
    downloadUrl,
  };
}
