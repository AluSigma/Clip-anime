import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { NextResponse } from 'next/server';
import { getClipsDir } from '@/lib/ffmpeg';

function toSafeSegment(value: string): string | null {
  if (!value || value.includes('/') || value.includes('\\') || value.includes('\0')) {
    return null;
  }
  return value;
}

function buildSafeInlineContentDisposition(filename: string): string {
  const asciiFallback = filename
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[\\"]/g, '')
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

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
  }

  const stat = fs.statSync(filePath);
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
