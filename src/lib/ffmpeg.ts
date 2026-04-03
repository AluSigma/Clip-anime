import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const CLIPS_DIR = process.env.CLIPS_DIR || path.join(process.cwd(), 'public', 'clips');

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

  if (burnSubtitles && srt) {
    // Write SRT to a temp file
    const srtPath = await writeSrtFile(projectId, srt, clipIndex);
    // Escape path for subtitle filter (FFmpeg filter syntax requires colons to be escaped)
    const escapedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    
    args.push(
      '-vf',
      `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,subtitles='${escapedSrtPath}':force_style='FontSize=18,Alignment=2,MarginV=40,PrimaryColour=&H00FFFFFF&,OutlineColour=&H00000000&,Outline=2'`,
    );
  } else {
    args.push(
      '-vf',
      'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
    );
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
    await execFileAsync('ffmpeg', args, { timeout: 300000 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // If subtitle burn-in failed, retry without subtitles
    if (burnSubtitles && srt && message.includes('subtitles')) {
      return renderClip({ ...options, burnSubtitles: false });
    }
    throw new Error(`FFmpeg render failed: ${message}`);
  }

  const relPath = path.relative(path.join(process.cwd(), 'public'), outPath);
  const url = '/' + relPath.replace(/\\/g, '/');

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
