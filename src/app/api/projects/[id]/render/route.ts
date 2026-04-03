import { NextRequest, NextResponse } from 'next/server';
import { getProject, updateProject } from '@/lib/db';
import { renderClip } from '@/lib/ffmpeg';
import { RenderResult } from '@/types/project';

interface RenderRequest {
  start: number;
  end: number;
  burnSubtitles?: boolean;
  clipIndex?: number;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  if (!project.downloadUrl) {
    return NextResponse.json({ error: 'No download URL available' }, { status: 400 });
  }

  const body = await req.json() as RenderRequest;
  const { start, end, burnSubtitles = false, clipIndex = 0 } = body;

  if (typeof start !== 'number' || typeof end !== 'number' || end <= start) {
    return NextResponse.json({ error: 'Invalid start/end times' }, { status: 400 });
  }

  if (end - start > 300) {
    return NextResponse.json({ error: 'Clip duration cannot exceed 300 seconds' }, { status: 400 });
  }

  updateProject(id, { status: 'rendering', error: null });

  (async () => {
    try {
      const output = await renderClip({
        projectId: id,
        videoUrl: project.downloadUrl!,
        start,
        end,
        srt: project.srt || undefined,
        burnSubtitles,
        clipIndex,
      });

      const renderResult: RenderResult = {
        path: output.path,
        url: output.url,
        format: '1080x1920',
        duration: output.duration,
        subtitle: output.subtitle,
        createdAt: new Date().toISOString(),
      };

      const currentProject = getProject(id);
      const renders = [...(currentProject?.renders || []), renderResult];
      updateProject(id, { renders, status: 'done' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Render failed';
      updateProject(id, { status: 'error', error: message });
    }
  })();

  return NextResponse.json({ ok: true, message: 'Render started' });
}
