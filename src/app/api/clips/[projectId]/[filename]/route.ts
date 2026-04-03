import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { promisify } from 'util';
import { NextResponse } from 'next/server';
import { getClipsDir } from '@/lib/ffmpeg';

const statAsync = promisify(fs.stat);
const accessAsync = promisify(fs.access);

function toSafeSegment(value: string): string | null {
  if (!value || value.includes('\0')) {
    return null;
  }
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (!decoded || decoded.includes('..') || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) {
    return null;
  }
  return decoded;
}

function buildSafeInlineContentDisposition(filename: string): string {
  // Keep fallback filename to printable ASCII only (0x20-0x7E) for header compatibility.
  const asciiFallback = filename
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/["\\]/g, '')
    .replace(/[\r\n]/g, '')
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

  try {
    await accessAsync(filePath, fs.constants.R_OK);
  } catch {
    return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
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

  const stream = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream<Uint8Array>;
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(stat.size),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Disposition': buildSafeInlineContentDisposition(safeFilename),
    },
  });
}
