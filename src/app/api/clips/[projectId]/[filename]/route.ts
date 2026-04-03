import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { getClipsDir } from '@/lib/ffmpeg';

function toSafeSegment(value: string): string | null {
  if (!value || value.includes('/') || value.includes('\\') || value.includes('\0')) {
    return null;
  }
  return value;
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

  const file = fs.readFileSync(filePath);
  return new NextResponse(new Uint8Array(file), {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(stat.size),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Disposition': `inline; filename="${safeFilename.replace(/"/g, '')}"`,
    },
  });
}
