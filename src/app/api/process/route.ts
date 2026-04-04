import { NextRequest, NextResponse } from 'next/server';
import { getVideoDetails } from '@/lib/youtube';

export const dynamic = 'force-dynamic';

interface ProcessRequest {
  url?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as ProcessRequest;
    const videoUrl = body?.url?.trim();
    if (!videoUrl) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    const details = await getVideoDetails(videoUrl);
    return NextResponse.json({
      ok: true,
      data: {
        videoId: details.id,
        title: details.title,
        description: details.description,
        duration: details.duration,
        thumbnail: details.thumbnail,
        channel: details.channel,
        downloadUrl: details.localVideoUrl || details.downloadUrl,
        sourceFilePath: details.localVideoPath,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to process video';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
