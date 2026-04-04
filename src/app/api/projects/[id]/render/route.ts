import { NextRequest, NextResponse } from 'next/server';
import { getProject, updateProject } from '@/lib/db';
import { renderClip } from '@/lib/ffmpeg';
import { getVideoDetails } from '@/lib/youtube';
import { RenderResult } from '@/types/project';
import { RenderOutput } from '@/lib/ffmpeg';

const MAX_CLIP_DURATION_SECONDS = 300;

function isFfmpeg403Error(message: string): boolean {
  return /403 Forbidden/i.test(message) || /HTTP error 403/i.test(message);
}

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

  if (end - start > MAX_CLIP_DURATION_SECONDS) {
    return NextResponse.json({ error: `Clip duration cannot exceed ${MAX_CLIP_DURATION_SECONDS} seconds` }, { status: 400 });
  }

  updateProject(id, { status: 'rendering', error: null });

  (async () => {
    const baseRenderOptions = {
      projectId: id,
      start,
      end,
      srt: project.srt || undefined,
      burnSubtitles,
      clipIndex,
    };

    const saveRenderResult = (output: RenderOutput) => {
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
    };

    try {
      const output = await renderClip({
        ...baseRenderOptions,
        videoUrl: project.downloadUrl as string,
      });
      saveRenderResult(output);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Render failed';

      if (isFfmpeg403Error(message)) {
        try {
          if (!project.videoId) {
            throw new Error('Cannot refresh download URL because project videoId is missing');
          }
          const refreshed = await getVideoDetails(project.videoId);
          if (refreshed.downloadUrl) {
            updateProject(id, {
              downloadUrl: refreshed.downloadUrl,
            });

            const retriedOutput = await renderClip({
              ...baseRenderOptions,
              videoUrl: refreshed.downloadUrl,
            });

            saveRenderResult(retriedOutput);
            return;
          }
          updateProject(id, {
            status: 'error',
            error: `Original error: ${message}. Retry skipped: refresh succeeded but returned a missing/empty downloadUrl.`,
          });
          return;
        } catch (retryErr: unknown) {
          const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
          updateProject(id, {
            status: 'error',
            error: `Original error: ${message}. Retry attempt failed: ${retryMessage}`,
          });
          return;
        }
      }

      updateProject(id, { status: 'error', error: message });
    }
  })();

  return NextResponse.json({ ok: true, message: 'Render started' });
}
