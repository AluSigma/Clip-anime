import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { extractVideoId, getVideoDetails } from '@/lib/youtube';
import { saveProject, listProjects, getProject } from '@/lib/db';
import { Project } from '@/types/project';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url } = body as { url: string };

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    let videoId: string;
    try {
      videoId = extractVideoId(url);
    } catch {
      return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });
    }

    const project: Project = {
      id: uuidv4(),
      sourceUrl: url,
      videoId,
      title: '',
      duration: 0,
      thumbnail: null,
      channel: null,
      downloadUrl: null,
      transcriptText: null,
      srt: null,
      highlightCandidates: [],
      renders: [],
      status: 'fetching',
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    saveProject(project);

    // Fetch video details in background
    getVideoDetails(url)
      .then((details) => {
        const existing = getProject(project.id);
        if (!existing) return;
        saveProject({
          ...existing,
          title: details.title,
          duration: details.duration,
          thumbnail: details.thumbnail,
          channel: details.channel,
          downloadUrl: details.downloadUrl,
          status: 'fetched',
          updatedAt: new Date().toISOString(),
        });
      })
      .catch((err: Error) => {
        const existing = getProject(project.id);
        if (!existing) return;
        saveProject({
          ...existing,
          status: 'error',
          error: err.message,
          updatedAt: new Date().toISOString(),
        });
      });

    return NextResponse.json({ ok: true, project }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const projects = listProjects();
    return NextResponse.json({ ok: true, projects });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
