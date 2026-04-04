import axios from 'axios';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

const BASE = 'https://youtube-info-download-api.p.rapidapi.com';
const POLLING_INTERVAL_MS = 2000;
const POLLING_TIMEOUT_MS = 8 * 60 * 1000;
const DOWNLOAD_DIR = path.join(process.cwd(), 'public', 'clips', 'sources');
const HOURS_IN_MS = 60 * 60 * 1000;
const SOURCE_CACHE_MAX_AGE_MS = 6 * HOURS_IN_MS; // keep cached source up to 6 hours
const QUALITY_SCORE_720 = 300;
const QUALITY_SCORE_360 = 200;
const QUALITY_SCORE_MP4 = 100;
const QUALITY_SCORE_FALLBACK = 10;

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
    'x-rapidapi-host': 'youtube-info-download-api.p.rapidapi.com',
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
  description: string | null;
  duration: number; // seconds
  thumbnail: string | null;
  channel: string | null;
  downloadUrl: string | null;
  localVideoPath: string | null;
  localVideoUrl: string | null;
}

interface UrlWithScore {
  url: string;
  score: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeYoutubeUrl(urlOrId: string): string {
  const trimmed = urlOrId.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const videoId = extractVideoId(trimmed);
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function normalizeUrl(url: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

function parseDurationSeconds(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  if (typeof value !== 'string') {
    return 0;
  }
  const trimmed = value.trim();
  if (!trimmed) return 0;

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const parts = trimmed.split(':').map((p) => Number(p));
  if (parts.some((p) => Number.isNaN(p))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function getFirstString(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function getNestedString(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const record = asRecord(data[key]);
    if (!record) continue;
    const nested = getFirstString(record, ['url', 'name', 'title', 'text']);
    if (nested) return nested;
  }
  return null;
}

function findProgressUrl(payload: unknown): string | null {
  const root = asRecord(payload);
  if (!root) return null;
  const direct = getFirstString(root, ['progress_url', 'progressUrl', 'progress']);
  if (direct) return direct;
  const dataNode = asRecord(root.data);
  if (!dataNode) return null;
  return getFirstString(dataNode, ['progress_url', 'progressUrl', 'progress']);
}

function qualityRank(label: string): number {
  const normalized = label.toLowerCase();
  if (normalized.includes('720')) return QUALITY_SCORE_720;
  if (normalized.includes('360')) return QUALITY_SCORE_360;
  if (normalized.includes('mp4')) return QUALITY_SCORE_MP4;
  return QUALITY_SCORE_FALLBACK;
}

function isLikelyMediaUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      /\.(mp4|m4a|webm)(\?|$)/i.test(url)
      || host === 'googlevideo.com'
      || host.endsWith('.googlevideo.com')
      || host === 'ytimg.com'
      || host.endsWith('.ytimg.com')
      || host === 'youtube.com'
      || host.endsWith('.youtube.com')
      || host === 'youtu.be'
    );
  } catch {
    return false;
  }
}

function collectCandidateUrls(payload: unknown): UrlWithScore[] {
  const candidates: UrlWithScore[] = [];

  const walk = (node: unknown) => {
    if (typeof node === 'string') {
      if (isLikelyMediaUrl(node)) {
        candidates.push({ url: node, score: qualityRank(node) });
      }
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    const record = asRecord(node);
    if (!record) return;

    const url = getFirstString(record, ['download_url', 'downloadUrl', 'file_url', 'fileUrl', 'url', 'link']);
    if (url && isLikelyMediaUrl(url)) {
      const quality = getFirstString(record, ['quality', 'resolution', 'label', 'format']) || '';
      const score = qualityRank(quality);
      candidates.push({ url, score });
    }

    for (const value of Object.values(record)) {
      walk(value);
    }
  };

  walk(payload);
  return candidates;
}

function selectBestCandidateUrl(payload: unknown): string | null {
  const sorted = collectCandidateUrls(payload)
    .sort((a, b) => b.score - a.score);
  return sorted[0]?.url ?? null;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function toSafeProviderMessage(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const normalized = input.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (normalized.length > 180) return null;
  if (!/^[a-zA-Z0-9 .,!?():-]+$/.test(normalized)) return null;
  return normalized;
}

function mapYoutubeApiError(err: unknown): Error {
  if (!axios.isAxiosError(err)) {
    return err instanceof Error ? err : new Error('Failed to fetch YouTube video details');
  }

  const status = err.response?.status;
  if (status === 400) {
    return new Error('Failed to fetch video details. Please ensure the URL format is valid and the video is publicly accessible (not private, deleted, or age-restricted).');
  }
  if (status === 401 || status === 403) {
    return new Error('Failed to fetch video details due to provider authorization.');
  }
  if (status === 404) {
    return new Error('Video details were not found by provider. Please verify the YouTube link.');
  }

  const providerPayload = asRecord(err.response?.data);
  const safeProviderMessage = toSafeProviderMessage(
    providerPayload ? getFirstString(providerPayload, ['message', 'error', 'detail']) : null,
  );
  if (safeProviderMessage) {
    return new Error(safeProviderMessage);
  }

  return new Error(err.message || 'Failed to fetch YouTube video details');
}

async function initiateDownloadTask(videoUrl: string): Promise<{ progressUrl: string | null; downloadUrl: string | null }> {
  for (const quality of ['720', '360']) {
    const { data } = await axios.get(`${BASE}/ajax/download.php`, {
      params: {
        format: 'mp4',
        url: videoUrl,
        quality,
      },
      headers: headers(),
      timeout: 30000,
    });

    const directUrl = selectBestCandidateUrl(data);
    if (directUrl) {
      return { progressUrl: null, downloadUrl: directUrl };
    }

    const progressUrl = findProgressUrl(data);
    if (progressUrl) {
      return { progressUrl, downloadUrl: null };
    }
  }

  const { data } = await axios.get(`${BASE}/ajax/download.php`, {
    params: {
      format: 'mp4',
      url: videoUrl,
    },
    headers: headers(),
    timeout: 30000,
  });
  return {
    progressUrl: findProgressUrl(data),
    downloadUrl: selectBestCandidateUrl(data),
  };
}

async function pollDownloadUrl(progressUrl: string): Promise<string> {
  const startedAt = Date.now();
  const normalizedProgressUrl = normalizeUrl(progressUrl);
  if (!normalizedProgressUrl) {
    throw new Error('Invalid progress_url from youtube-info-download-api');
  }

  while (Date.now() - startedAt < POLLING_TIMEOUT_MS) {
    const { data } = await axios.get(normalizedProgressUrl, {
      headers: headers(),
      timeout: 30000,
    });
    const downloadUrl = selectBestCandidateUrl(data);
    if (downloadUrl) {
      return downloadUrl;
    }

    await wait(POLLING_INTERVAL_MS);
  }

  throw new Error('Timed out waiting for download_url from progress API');
}

async function cacheVideoStream(videoId: string, downloadUrl: string): Promise<{ localVideoPath: string | null; localVideoUrl: string | null }> {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const cachedFiles = fs.readdirSync(DOWNLOAD_DIR)
    .filter((file) => file.startsWith(`${videoId}_`) && file.endsWith('.mp4'))
    .map((file) => {
      const fullPath = path.join(DOWNLOAD_DIR, file);
      try {
        const stat = fs.statSync(fullPath);
        return { file, fullPath, mtimeMs: stat.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((item): item is { file: string; fullPath: string; mtimeMs: number } => item !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (cachedFiles[0] && Date.now() - cachedFiles[0].mtimeMs < SOURCE_CACHE_MAX_AGE_MS) {
    const filename = cachedFiles[0].file;
    const localUrl = `/clips/sources/${encodeURIComponent(filename)}`;
    return {
      localVideoPath: cachedFiles[0].fullPath,
      localVideoUrl: localUrl,
    };
  }

  const filename = `${videoId}_${Date.now()}_${randomBytes(4).toString('hex')}.mp4`;
  const outputPath = path.join(DOWNLOAD_DIR, filename);

  const response = await axios.get(downloadUrl, {
    responseType: 'stream',
    timeout: 120000,
    maxRedirects: 5,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: '*/*',
      Referer: 'https://www.youtube.com/',
    },
  });

  const writeStream = fs.createWriteStream(outputPath);
  await new Promise<void>((resolve, reject) => {
    response.data.pipe(writeStream);
    response.data.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('finish', resolve);
  });

  const localUrl = `/clips/sources/${encodeURIComponent(filename)}`;

  for (const old of cachedFiles) {
    try {
      fs.unlinkSync(old.fullPath);
    } catch {
      // ignore cleanup failure
    }
  }

  return {
    localVideoPath: outputPath,
    localVideoUrl: localUrl,
  };
}

export async function getVideoDetails(urlOrId: string): Promise<VideoDetails> {
  try {
    const videoId = extractVideoId(urlOrId);
    const videoUrl = normalizeYoutubeUrl(urlOrId);

    const { data: rawData } = await axios.get(`${BASE}/ajax/api.php`, {
      params: {
        function: 'i',
        u: videoUrl,
      },
      headers: headers(),
      timeout: 30000,
    });
    const data = (asRecord(rawData) || {}) as Record<string, unknown>;

    const title = getFirstString(data, ['title', 'video_title', 'name']) || 'Untitled';
    const description = getFirstString(data, ['description', 'desc', 'video_description']);
    const duration = parseDurationSeconds(data.duration ?? data.length ?? data.lengthSeconds);
    const thumbnail = normalizeUrl(
      getFirstString(data, ['thumbnail', 'thumb', 'image']) || getNestedString(data, ['thumbnail', 'thumb', 'image']),
    );
    const channel = getFirstString(data, ['channel', 'author', 'uploader']) || getNestedString(data, ['channel', 'author', 'uploader']);

    const task = await initiateDownloadTask(videoUrl);
    const resolvedDownloadUrl = normalizeUrl(task.downloadUrl || (task.progressUrl ? await pollDownloadUrl(task.progressUrl) : null));
    if (!resolvedDownloadUrl) {
      throw new Error('Failed to resolve MP4 download URL from youtube-info-download-api');
    }

    let localVideoPath: string | null = null;
    let localVideoUrl: string | null = null;
    try {
      const cached = await cacheVideoStream(videoId, resolvedDownloadUrl);
      localVideoPath = cached.localVideoPath;
      localVideoUrl = cached.localVideoUrl;
    } catch (cacheError: unknown) {
      console.warn(
        '[youtube] Source caching failed, falling back to direct download URL:',
        cacheError instanceof Error ? cacheError.message : String(cacheError),
      );
      localVideoPath = null;
      localVideoUrl = null;
    }

    return {
      id: videoId,
      title,
      description,
      duration,
      thumbnail,
      channel,
      downloadUrl: resolvedDownloadUrl,
      localVideoPath,
      localVideoUrl,
    };
  } catch (err: unknown) {
    throw mapYoutubeApiError(err);
  }
}
