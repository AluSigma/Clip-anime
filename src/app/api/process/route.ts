import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

const execFileAsync = promisify(execFile);

export const dynamic = 'force-dynamic';

type JsonRecord = Record<string, unknown>;
const POLLING_INTERVAL_MS = 2000;
const MAX_POLLING_ATTEMPTS = 20;
const MIN_VALID_FILE_SIZE_BYTES = 50000;
const MAX_CLIPS = 6;
const OPENAI_CHAT_COMPLETIONS_URL =
  process.env.OPENAI_API_BASE_URL?.trim() || 'https://api.openai.com/v1/chat/completions';
const SAVENOW_API_KEY = process.env.RAPIDAPI_KEY || '203e3387bdmsh778c780492564ddp1a2c8ajsn3e8c40099188';

interface ClipSpec {
  title: string;
  start_time: string;
  end_time: string;
}

function toRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function logError(error: unknown): void {
  if (axios.isAxiosError(error)) {
    console.error(error.response?.data || error.message);
    return;
  }
  if (error instanceof Error) {
    console.error(error.message);
    return;
  }
  console.error(String(error));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toSafeFilePart(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'clip';
}

function parseTimeToSeconds(time: string): number {
  const trimmed = time.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid time format: ${time}. Expected MM:SS`);

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds > 59) {
    throw new Error(`Invalid time value: ${time}`);
  }

  return minutes * 60 + seconds;
}

function getBluesmindsApiKey(): string {
  const raw = (process.env.OPENAI_API_KEY || process.env.BLUESMINDS_API_KEY || '').trim();
  if (!raw) throw new Error('OPENAI_API_KEY or BLUESMINDS_API_KEY is missing');
  if (/^Bearer\s+/i.test(raw)) {
    return raw.replace(/^Bearer\s+/i, '').trim();
  }
  return raw;
}

function normalizeVideoUrl(videoUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(videoUrl.trim());
  } catch {
    throw new Error('Invalid URL format');
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const pathnameParts = parsed.pathname.split('/').filter(Boolean);
  const trackingParams = new Set([
    'si',
    'feature',
    'pp',
    'fbclid',
    'gclid',
    'igshid',
  ]);

  for (const key of Array.from(parsed.searchParams.keys())) {
    if (trackingParams.has(key) || key.toLowerCase().startsWith('utm_')) {
      parsed.searchParams.delete(key);
    }
  }

  if (host === 'youtu.be') {
    const videoId = pathnameParts[0] || '';
    if (!videoId) throw new Error('Invalid youtu.be URL');
    return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  }

  if (
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com'
  ) {
    if (pathnameParts[0] === 'shorts') {
      const videoId = pathnameParts[1] || '';
      if (!videoId) throw new Error('Invalid YouTube Shorts URL');
      return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    }

    if (pathnameParts[0] === 'watch') {
      const watchId = parsed.searchParams.get('v')?.trim() || '';
      if (!watchId) throw new Error('Invalid YouTube watch URL (missing v)');
      return `https://www.youtube.com/watch?v=${encodeURIComponent(watchId)}`;
    }
  }

  return parsed.toString();
}

function getFfmpegBin(): string {
  const configured = process.env.FFMPEG_PATH?.trim();
  if (configured) return configured;
  if (ffmpegInstaller?.path) return ffmpegInstaller.path;
  return 'ffmpeg';
}

async function initiate(cleanVideoUrl: string): Promise<{ jobId: string; title: string }> {
  console.log('[🔑] API Key Status:', SAVENOW_API_KEY ? 'Loaded' : 'Empty');
  const { data } = await axios.get('https://p.savenow.to/ajax/download.php', {
    params: {
      format: '720',
      url: cleanVideoUrl,
      apikey: SAVENOW_API_KEY,
      add_info: '1',
      audio_quality: '128',
      allow_extended_duration: '1',
      max_duration: '240',
    },
    timeout: 30000,
  });

  const payload = toRecord(data) || {};
  const id = String(payload.id || payload.job_id || '').trim();
  const title = String(payload.title || 'Untitled Video').trim() || 'Untitled Video';

  if (!id) throw new Error('Failed to initiate download job (missing id)');
  return { jobId: id, title };
}

async function pollDownloadUrl(jobId: string): Promise<string> {
  for (let i = 0; i < MAX_POLLING_ATTEMPTS; i += 1) {
    const { data } = await axios.get(`https://p.savenow.to/ajax/progress?id=${encodeURIComponent(jobId)}`, {
      timeout: 30000,
    });

    const payload = (toRecord(data) || {}) as JsonRecord;
    const success = toNumber(payload.success);
    const progress = toNumber(payload.progress);

    if (success === 1 && progress === 1000) {
      const primaryDownloadUrl =
        typeof payload.download_url === 'string' ? payload.download_url.trim() : '';
      const alternatives = Array.isArray(payload.alternative_download_urls)
        ? payload.alternative_download_urls
        : [];
      const firstAlternative = toRecord(alternatives[0]);
      const fallbackUrl = typeof firstAlternative?.url === 'string' ? firstAlternative.url.trim() : '';
      const url = primaryDownloadUrl || fallbackUrl;
      if (url) return url;
      throw new Error('Download completed but no download_url available');
    }

    if (i < MAX_POLLING_ATTEMPTS - 1) {
      await sleep(POLLING_INTERVAL_MS);
    }
  }

  throw new Error('Timeout while polling download progress');
}

async function streamDownloadToFile(downloadUrl: string, title: string): Promise<string> {
  const tempDir = path.join(os.tmpdir(), 'sultan-clipper');
  fs.mkdirSync(tempDir, { recursive: true });

  const inputPath = path.join(tempDir, `${Date.now()}-${toSafeFilePart(title)}.mp4`);

  const response = await axios.get(downloadUrl, {
    responseType: 'stream',
    timeout: 180000,
    maxRedirects: 5,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
      Referer: 'https://www.youtube.com/',
      Accept: '*/*',
    },
  });

  await new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(inputPath);
    response.data.pipe(writer);
    response.data.on('error', reject);
    writer.on('error', reject);
    writer.on('finish', resolve);
  });

  const stats = fs.statSync(inputPath);
  if (stats.size <= MIN_VALID_FILE_SIZE_BYTES) {
    throw new Error('Downloaded file is too small (<= 50KB). Download may have failed or been interrupted.');
  }

  return inputPath;
}

async function analyzeWithAi(videoTitle: string): Promise<ClipSpec[]> {
  const instruction = 'Return ONLY a raw JSON array: [{"title":"...","start_time":"MM:SS","end_time":"MM:SS"}]';

  const prompt = [
    'You are a short-video editor AI for YouTube Shorts.',
    `Video title: ${videoTitle}`,
    'Generate exactly 4 engaging vertical clip suggestions.',
    'Each clip must be 20-60 seconds and use realistic non-overlapping ranges.',
    instruction,
    'Output JSON only. No markdown. No explanation.',
  ].join('\n');

  const { data } = await axios.post(
    OPENAI_CHAT_COMPLETIONS_URL,
    {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a machine. Output ONLY valid raw JSON array. No markdown, no backticks, no explanation.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getBluesmindsApiKey()}`,
      },
      timeout: 60000,
    },
  );

  const content = String(data?.choices?.[0]?.message?.content || '').trim();
  const normalized = content
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .replace(/https?:\/\/googleusercontent\.com\/immersive_entry_chip\/\d+/gi, '')
    .trim();
  const arrayMatch = normalized.match(/\[[\s\S]*\]/);
  if (!arrayMatch) {
    throw new Error('AI returned non-JSON array response');
  }
  const parsed = JSON.parse(arrayMatch[0]);

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('AI returned invalid clip list');
  }

  return parsed
    .map((item) => {
      const obj = toRecord(item) || {};
      return {
        title: String(obj.title || 'Untitled Clip').trim() || 'Untitled Clip',
        start_time: String(obj.start_time || '').trim(),
        end_time: String(obj.end_time || '').trim(),
      };
    })
    .filter((item) => item.start_time && item.end_time)
    .slice(0, MAX_CLIPS);
}

async function renderClip(params: {
  inputPath: string;
  outputPath: string;
  startSeconds: number;
  duration: number;
}): Promise<void> {
  const ffmpegBin = getFfmpegBin();

  await execFileAsync(
    ffmpegBin,
    [
      '-y',
      '-ss', String(params.startSeconds),
      '-i', params.inputPath,
      '-t', String(params.duration),
      '-vf', 'crop=ih*9/16:ih',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      params.outputPath,
    ],
    { timeout: 300000 },
  );
}

export async function POST(req: NextRequest) {
  let inputPath = '';

  try {
    const body = (await req.json()) as { url?: string };
    const videoUrl = body?.url?.trim();

    if (!videoUrl) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    const cleanedUrl = normalizeVideoUrl(videoUrl);
    const { jobId, title: videoTitle } = await initiate(cleanedUrl);
    const downloadUrl = await pollDownloadUrl(jobId);
    inputPath = await streamDownloadToFile(downloadUrl, videoTitle);

    let clips = await analyzeWithAi(videoTitle);
    if (clips.length === 0) {
      clips = [
        { title: 'Opening Hook', start_time: '00:00', end_time: '00:30' },
        { title: 'Best Moment', start_time: '00:30', end_time: '01:00' },
      ];
    }

    const clipsDir = path.join(process.cwd(), 'public', 'clips');
    fs.mkdirSync(clipsDir, { recursive: true });

    const created: Array<{
      title: string;
      start_time: string;
      end_time: string;
      downloadUrl: string;
    }> = [];

    for (let i = 0; i < clips.length; i += 1) {
      const clip = clips[i];
      try {
        const startSeconds = parseTimeToSeconds(clip.start_time);
        const endSeconds = parseTimeToSeconds(clip.end_time);
        const duration = endSeconds - startSeconds;

        if (duration <= 0) continue;

        const filename = `${Date.now()}-${i + 1}-${toSafeFilePart(clip.title)}.mp4`;
        const outputPath = path.join(clipsDir, filename);

        await renderClip({
          inputPath,
          outputPath,
          startSeconds,
          duration,
        });

        created.push({
          title: clip.title,
          start_time: clip.start_time,
          end_time: clip.end_time,
          downloadUrl: `/clips/${encodeURIComponent(filename)}`,
        });
      } catch (clipErr) {
        console.error(`Clip render skipped (index=${i}, title="${clip.title}")`);
        logError(clipErr);
      }
    }

    if (created.length === 0) {
      throw new Error('No clips were generated');
    }

    return NextResponse.json({
      success: true,
      videoTitle,
      clips: created,
    });
  } catch (err: unknown) {
    logError(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to process video' },
      { status: 500 },
    );
  } finally {
    if (inputPath && fs.existsSync(inputPath)) {
      try {
        fs.unlinkSync(inputPath);
      } catch (cleanupError) {
        logError(cleanupError);
      }
    }
  }
}
