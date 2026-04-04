export type ProjectStatus =
  | 'created'
  | 'fetching'
  | 'fetched'
  | 'transcribing'
  | 'transcribed'
  | 'scoring'
  | 'scored'
  | 'rendering'
  | 'done'
  | 'error';

export interface HighlightCandidate {
  start: number; // seconds
  end: number;   // seconds
  score: number; // 0-100
  reason: string;
}

export interface RenderResult {
  path: string;
  url: string;
  format: string;
  duration: number;
  subtitle: boolean;
  createdAt: string;
}

export interface Project {
  id: string;
  sourceUrl: string;
  videoId: string;
  title: string;
  description: string | null;
  duration: number; // seconds
  thumbnail: string | null;
  channel: string | null;
  downloadUrl: string | null;
  sourceFilePath?: string | null;
  transcriptText: string | null;
  srt: string | null;
  highlightCandidates: HighlightCandidate[];
  renders: RenderResult[];
  status: ProjectStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
