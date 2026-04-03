import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { promisify } from 'util';
import { NextResponse } from 'next/server';
import { getClipsDir } from '@/lib/ffmpeg';

const statAsync = promisify(fs.stat);

function toSafeSegment(value: string): string | null {
  if (!value) {
    return null;
  }
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (
    !decoded
    || decoded.includes('..')
    || decoded.includes('/')
    || decoded.includes('\\')
    || decoded.includes(':')
    || !/^[A-Za-z0-9._-]+$/.test(decoded)
  ) {
    return null;
  }
  if (decoded.endsWith('.') || decoded.startsWith('.') || (decoded.match(/\./g)?.length || 0) > 1) {
    return null;
  }
  if (!decoded.toLowerCase().endsWith('.mp4')) {
    return null;
  }
  return decoded;
}

function buildSafeInlineContentDisposition(filename: string): string {
  // Keep fallback filename to a conservative ASCII set for header compatibility.
  const asciiFallback = filename
    .replace(/[^A-Za-z0-9._ -]/g, '')
    .trim() || 'clip.mp4';
  const encoded = encodeURIComponent(filename);
  return `inline; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; filename: string }> }
) {
  const { projectId, filename } = await params;
  const safeProjectId = toSafeSegment(projectId);
  const safeFilename = toSafeSegment(filename);
  if (!safeProjectId || !safeFilename) {
    return NextResponse.json({ error: 'Invalid clip path' }, { status: 400 });
  }

  const clipsRoot = getClipsDir();
  const filePath = path.resolve(clipsRoot, safeProjectId, safeFilename);
  const expectedPrefix = path.resolve(clipsRoot) + path.sep;
  if (!filePath.startsWith(expectedPrefix)) {
    return NextResponse.json({ error: 'Invalid clip path' }, { status: 400 });
  }

  let stat: fs.Stats;
  try {
    stat = await statAsync(filePath);
  } catch {
    return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
  }
  if (!stat.isFile()) {
    return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
  }

  let stream: ReadableStream<Uint8Array>;
  try {
    stream = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream<Uint8Array>;
  } catch {
    return NextResponse.json({ error: 'Failed to stream clip' }, { status: 500 });
  }
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(stat.size),
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      'Content-Disposition': buildSafeInlineContentDisposition(safeFilename),
    },
  });
}
