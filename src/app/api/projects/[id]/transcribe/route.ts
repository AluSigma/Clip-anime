import { NextRequest, NextResponse } from 'next/server';
import { getProject, updateProject } from '@/lib/db';
import { submitTranscription, waitForTranscription, getSrtSubtitles } from '@/lib/assemblyai';
import { buildTranscriptChunks } from '@/lib/bluesminds';
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

  if (!project.downloadUrl) {
    return NextResponse.json({ error: 'No download URL available. Fetch video details first.' }, { status: 400 });
  }

  if (project.status === 'transcribing') {
    return NextResponse.json({ error: 'Transcription already in progress' }, { status: 409 });
  }

  updateProject(id, { status: 'transcribing', error: null });

  // Run async in background
  (async () => {
    try {
      const transcriptId = await submitTranscription(project.downloadUrl as string, 'en');
      const result = await waitForTranscription(transcriptId);
      const srt = await getSrtSubtitles(transcriptId);

      // Build chunks for later scoring
      const chunks = buildTranscriptChunks(result.words);

      updateProject(id, {
        transcriptText: result.text,
        srt,
        status: 'transcribed',
      });

      // Store chunks in data dir for later use
      const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
      fs.writeFileSync(
        path.join(dataDir, `${id}_chunks.json`),
        JSON.stringify(chunks, null, 2)
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Transcription failed';
      updateProject(id, { status: 'error', error: message });
    }
  })();

  return NextResponse.json({ ok: true, message: 'Transcription started' });
}
