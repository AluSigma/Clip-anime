import { NextRequest, NextResponse } from 'next/server';
import { getProject, updateProject } from '@/lib/db';
import { scoreHighlights, buildTranscriptChunks } from '@/lib/bluesminds';
import fs from 'fs';
import path from 'path';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  if (!project.transcriptText) {
    return NextResponse.json({ error: 'No transcript available. Transcribe first.' }, { status: 400 });
  }

  updateProject(id, { status: 'scoring', error: null });

  (async () => {
    try {
      const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
      const chunksFile = path.join(dataDir, `${id}_chunks.json`);

      let chunks;
      if (fs.existsSync(chunksFile)) {
        chunks = JSON.parse(fs.readFileSync(chunksFile, 'utf-8'));
      } else {
        // Fallback: rebuild from transcript text with rough timestamps.
        // Uses word index * 500ms as a rough timestamp approximation when word-level timestamps are unavailable.
        const words = (project.transcriptText as string).split(' ').map((text, i) => ({
          text,
          start: i * 500,
          end: (i + 1) * 500,
        }));
        chunks = buildTranscriptChunks(words, 30000);
      }

      const highlights = await scoreHighlights(chunks, 5);
      updateProject(id, { highlightCandidates: highlights, status: 'scored' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Highlight scoring failed';
      updateProject(id, { status: 'error', error: message });
    }
  })();

  return NextResponse.json({ ok: true, message: 'Highlight scoring started' });
}
