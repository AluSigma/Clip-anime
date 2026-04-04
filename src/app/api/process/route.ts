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

function getRapidApiKey(): string {
  const key = (process.env.RAPIDAPI_KEY || '').trim();
  if (!key) throw new Error('RAPIDAPI_KEY is missing');
  return key;
}

function getBluesmindsApiKey(): string {
  const key = (process.env.BLUESMINDS_API_KEY || '').replace(/^Bearer\s+/i, '').trim();
  if (!key) throw new Error('BLUESMINDS_API_KEY is missing');
  return key;
}

function getFfmpegBin(): string {
  const configured = process.env.FFMPEG_PATH?.trim();
  if (configured) return configured;
  if (ffmpegInstaller?.path) return ffmpegInstaller.path;
  return 'ffmpeg';
}

function extractDownloadUrl(progressPayload: JsonRecord): string | null {
  const direct = typeof progressPayload.download_url === 'string' ? progressPayload.download_url.trim() : '';
  if (direct) return direct;

  const alternatives = progressPayload.alternative_download_urls;
  if (Array.isArray(alternatives)) {
    for (const candidate of alternatives) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
      const obj = toRecord(candidate);
      if (!obj) continue;
      const url = typeof obj.url === 'string' ? obj.url.trim() : '';
      if (url) return url;
      const alt = typeof obj.download_url === 'string' ? obj.download_url.trim() : '';
      if (alt) return alt;
    }
  }

  return null;
}

async function initiate(videoUrl: string): Promise<{ jobId: string; title: string }> {
  const { data } = await axios.get('https://p.savenow.to/ajax/download.php', {
    params: {
      format: '720',
      url: videoUrl,
      apikey: getRapidApiKey(),
      add_info: 1,
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
  for (let i = 0; i < 20; i += 1) {
    const { data } = await axios.get('https://p.savenow.to/ajax/progress', {
      params: { id: jobId },
      timeout: 30000,
    });

    const payload = (toRecord(data) || {}) as JsonRecord;
    const success = toNumber(payload.success);
    const progress = toNumber(payload.progress);

    if (success === 1 && progress === 1000) {
      const url = extractDownloadUrl(payload);
      if (url) return url;
      throw new Error('Download completed but no download_url available');
    }

    await sleep(2000);
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
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
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
  if (stats.size <= 50 * 1024) {
    throw new Error('Downloaded file is too small (< 50KB). Likely blocked by source (403).');
  }

  return inputPath;
}

async function analyzeWithAi(videoTitle: string): Promise<ClipSpec[]> {
  const instruction = "Strict JSON Array only: [{'title':'...', 'start_time':'MM:SS', 'end_time':'MM:SS'}]";

  const prompt = [
    'You are a short-video editor AI for YouTube Shorts.',
    `Video title: ${videoTitle}`,
    'Generate exactly 4 engaging vertical clip suggestions.',
    'Each clip must be 20-60 seconds and use realistic non-overlapping ranges.',
    instruction,
    'Output JSON only. No markdown. No explanation.',
  ].join('\n');

  const { data } = await axios.post(
    'https://api.bluesminds.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [
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
  const normalized = content.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(normalized);

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
    .slice(0, 6);
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

    const { jobId, title: videoTitle } = await initiate(videoUrl);
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
        console.warn('Clip render skipped:', clipErr instanceof Error ? clipErr.message : String(clipErr));
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to process video' },
      { status: 500 },
    );
  } finally {
    if (inputPath && fs.existsSync(inputPath)) {
      try {
        fs.unlinkSync(inputPath);
      } catch {
        // ignore cleanup issues
      }
    }
  }
}
