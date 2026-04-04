import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
let resolvedFfmpegBinary: string | null = null;

function isExecutableBinary(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return false;
    }

    if (process.platform === 'win32') {
      return true;
    }

    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveFfmpegBinary(): Promise<string> {
  if (resolvedFfmpegBinary) {
    return resolvedFfmpegBinary;
  }

  const configured = process.env.FFMPEG_PATH?.trim();
  const attemptedPaths: string[] = [];

  if (configured) {
    const resolvedConfigured = path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
    attemptedPaths.push(resolvedConfigured);
    if (!isExecutableBinary(resolvedConfigured)) {
      throw new Error(
        `Invalid FFMPEG_PATH: "${configured}" does not point to an executable ffmpeg binary.`,
      );
    }
    resolvedFfmpegBinary = resolvedConfigured;
    return resolvedFfmpegBinary;
  }

  const candidates = process.platform === 'win32'
    ? [
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
    ]
    : [
      '/usr/local/bin/ffmpeg',
      '/usr/bin/ffmpeg',
      '/opt/homebrew/bin/ffmpeg',
      '/snap/bin/ffmpeg',
    ];

  for (const candidate of candidates) {
    attemptedPaths.push(candidate);
    if (isExecutableBinary(candidate)) {
      resolvedFfmpegBinary = candidate;
      return resolvedFfmpegBinary;
    }
  }

  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const candidate = path.join(entry, binaryName);
    attemptedPaths.push(candidate);
    if (isExecutableBinary(candidate)) {
      resolvedFfmpegBinary = candidate;
      return resolvedFfmpegBinary;
    }
  }

  const bundledBinary = await resolveBundledFfmpegBinary();
  if (bundledBinary) {
    attemptedPaths.push(bundledBinary);
    if (isExecutableBinary(bundledBinary)) {
      resolvedFfmpegBinary = bundledBinary;
      return resolvedFfmpegBinary;
    }
  }

  const serverlessHint = isServerlessEnvironment()
    ? ' Serverless environment detected: provide a bundled ffmpeg binary (e.g. Lambda layer or deployment artifact) and set FFMPEG_PATH to that executable path.'
    : '';
  throw new Error(
    `FFmpeg binary not found. Install ffmpeg and ensure it is in PATH, or set FFMPEG_PATH to an executable ffmpeg binary path. Checked: ${attemptedPaths.join(', ')}.${serverlessHint}`,
  );
}

async function resolveBundledFfmpegBinary(): Promise<string | null> {
  try {
    const installer = await import('@ffmpeg-installer/ffmpeg');
    return installer.path && isExecutableBinary(installer.path) ? installer.path : null;
  } catch {
    return null;
  }
}

function isReadOnlyTaskPath(targetPath: string): boolean {
  const normalized = path.resolve(targetPath);
  return normalized === '/var/task' || normalized.startsWith('/var/task/');
}

function isServerlessEnvironment(): boolean {
  return !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
}

function resolveClipsDir(): string {
  const configured = process.env.CLIPS_DIR;
  if (configured) {
    const resolved = path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
    if (isReadOnlyTaskPath(resolved)) {
      return path.join(os.tmpdir(), 'clips');
    }
    return resolved;
  }

  const defaultPath = path.join(process.cwd(), 'public', 'clips');
  return isServerlessEnvironment() || isReadOnlyTaskPath(defaultPath)
    ? path.join(os.tmpdir(), 'clips')
    : defaultPath;
}

const CLIPS_DIR = resolveClipsDir();

function ensureClipsDir() {
  if (!fs.existsSync(CLIPS_DIR)) {
    fs.mkdirSync(CLIPS_DIR, { recursive: true });
  }
}

export interface RenderOptions {
  projectId: string;
  videoUrl: string;
  start: number;   // seconds
  end: number;     // seconds
  srt?: string;    // SRT content
  burnSubtitles?: boolean;
  clipIndex?: number;
}

export interface RenderOutput {
  path: string;
  url: string;
  duration: number;
  subtitle: boolean;
}

async function writeSrtFile(projectId: string, srt: string, clipIndex: number): Promise<string> {
  const srtDir = path.join(CLIPS_DIR, projectId);
  if (!fs.existsSync(srtDir)) fs.mkdirSync(srtDir, { recursive: true });
  const srtPath = path.join(srtDir, `clip_${clipIndex}.srt`);
  fs.writeFileSync(srtPath, srt, 'utf-8');
  return srtPath;
}

export async function renderClip(options: RenderOptions): Promise<RenderOutput> {
  ensureClipsDir();
  const {
    projectId,
    videoUrl,
    start,
    end,
    srt,
    burnSubtitles = false,
    clipIndex = 0,
  } = options;

  const duration = end - start;
  const outDir = path.join(CLIPS_DIR, projectId);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outFilename = `clip_${clipIndex}_${Date.now()}.mp4`;
  const outPath = path.join(outDir, outFilename);

  // Build FFmpeg args
  const args: string[] = [
    '-y',
    '-ss', String(start),
    '-i', videoUrl,
    '-t', String(duration),
  ];

  const scaleFilter = 'scale=1080:1920:force_original_aspect_ratio=decrease';
  const padFilter = 'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black';
  const subtitleStyle = 'FontSize=18,Alignment=2,MarginV=40,PrimaryColour=&H00FFFFFF&,OutlineColour=&H00000000&,Outline=2';

  if (burnSubtitles && srt) {
    const srtPath = await writeSrtFile(projectId, srt, clipIndex);
    // Escape path for subtitle filter (FFmpeg filter syntax requires colons to be escaped)
    const escapedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    const subtitleFilter = `subtitles='${escapedSrtPath}':force_style='${subtitleStyle}'`;
    args.push('-vf', `${scaleFilter},${padFilter},${subtitleFilter}`);
  } else {
    args.push('-vf', `${scaleFilter},${padFilter}`);
  }

  args.push(
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outPath,
  );

  try {
    const ffmpegBin = await resolveFfmpegBinary();
    await execFileAsync(ffmpegBin, args, { timeout: 300000 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // If subtitle burn-in failed, retry without subtitles
    if (burnSubtitles && srt && message.includes('subtitles')) {
      return renderClip({ ...options, burnSubtitles: false });
    }
    throw new Error(`FFmpeg render failed: ${message}`);
  }

  const url = `/api/clips/${encodeURIComponent(projectId)}/${encodeURIComponent(outFilename)}`;

  return {
    path: outPath,
    url,
    duration,
    subtitle: burnSubtitles && !!srt,
  };
}

export function cleanupProjectFiles(projectId: string): void {
  const dir = path.join(CLIPS_DIR, projectId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function getClipsDir(): string {
  ensureClipsDir();
  return CLIPS_DIR;
}
