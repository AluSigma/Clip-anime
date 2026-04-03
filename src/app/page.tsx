'use client';

import { useState, useEffect, useCallback } from 'react';
import { Project, HighlightCandidate } from '@/types/project';

const ACTIVE_STATUSES = ['fetching', 'transcribing', 'scoring', 'rendering'];

const STATUS_LABELS: Record<string, string> = {
  created: 'Created',
  fetching: 'Fetching video info...',
  fetched: 'Video info fetched',
  transcribing: 'Transcribing audio...',
  transcribed: 'Transcript ready',
  scoring: 'Scoring highlights...',
  scored: 'Highlights scored',
  rendering: 'Rendering clip...',
  done: 'Done ✓',
  error: 'Error',
};

const STATUS_COLOR: Record<string, string> = {
  created: 'bg-gray-100 text-gray-700',
  fetching: 'bg-blue-100 text-blue-700',
  fetched: 'bg-blue-100 text-blue-700',
  transcribing: 'bg-yellow-100 text-yellow-700',
  transcribed: 'bg-yellow-100 text-yellow-700',
  scoring: 'bg-purple-100 text-purple-700',
  scored: 'bg-purple-100 text-purple-700',
  rendering: 'bg-orange-100 text-orange-700',
  done: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
};

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function StepIndicator({ project }: { project: Project }) {
  const steps = [
    { key: ['fetching', 'fetched'], label: '1. Fetch', icon: '🔍' },
    { key: ['transcribing', 'transcribed'], label: '2. Transcribe', icon: '📝' },
    { key: ['scoring', 'scored'], label: '3. Highlights', icon: '⭐' },
    { key: ['rendering', 'done'], label: '4. Render', icon: '🎬' },
  ];

  const statusOrder = ['created', 'fetching', 'fetched', 'transcribing', 'transcribed', 'scoring', 'scored', 'rendering', 'done'];
  const currentIndex = statusOrder.indexOf(project.status);

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {steps.map((step, i) => {
        const stepStatuses = step.key;
        const stepMinIndex = Math.min(...stepStatuses.map(s => statusOrder.indexOf(s)));
        const stepMaxIndex = Math.max(...stepStatuses.map(s => statusOrder.indexOf(s)));
        
        let state: 'done' | 'active' | 'pending' = 'pending';
        if (currentIndex > stepMaxIndex) state = 'done';
        else if (currentIndex >= stepMinIndex) state = 'active';

        return (
          <div key={i} className="flex items-center gap-1">
            <div className={`px-3 py-1 rounded-full text-sm font-medium ${
              state === 'done' ? 'bg-green-100 text-green-700' :
              state === 'active' ? 'bg-blue-100 text-blue-700 animate-pulse' :
              'bg-gray-100 text-gray-400'
            }`}>
              {step.icon} {step.label}
            </div>
            {i < steps.length - 1 && (
              <span className="text-gray-300">→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HighlightCard({
  highlight,
  index,
  onRender,
  isRendering,
}: {
  highlight: HighlightCandidate;
  index: number;
  onRender: (start: number, end: number, burnSubtitles: boolean, clipIndex: number) => void;
  isRendering: boolean;
}) {
  const [burnSubs, setBurnSubs] = useState(false);
  const duration = highlight.end - highlight.start;

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <span className="font-medium text-gray-900">Clip #{index + 1}</span>
          <span className="ml-2 text-sm text-gray-500">
            {formatTime(highlight.start)} → {formatTime(highlight.end)}
          </span>
          <span className="ml-2 text-xs text-gray-400">({formatDuration(duration)})</span>
        </div>
        <div className={`px-2 py-1 rounded text-sm font-bold ${
          highlight.score >= 80 ? 'bg-green-100 text-green-700' :
          highlight.score >= 60 ? 'bg-yellow-100 text-yellow-700' :
          'bg-gray-100 text-gray-600'
        }`}>
          {highlight.score}/100
        </div>
      </div>
      <p className="text-sm text-gray-600 mb-3 line-clamp-2">{highlight.reason}</p>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={burnSubs}
            onChange={(e) => setBurnSubs(e.target.checked)}
            className="w-4 h-4 text-blue-600 rounded"
          />
          Burn subtitles
        </label>
        <button
          onClick={() => onRender(highlight.start, highlight.end, burnSubs, index)}
          disabled={isRendering}
          className="ml-auto px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isRendering ? '⏳ Rendering...' : '🎬 Render Clip'}
        </button>
      </div>
    </div>
  );
}

function ProjectView({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      const data = await res.json();
      if (data.project) setProject(data.project);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProject();
    const isActive = ACTIVE_STATUSES.includes(project?.status || '');
    if (isActive || !project) {
      const interval = setInterval(fetchProject, 3000);
      return () => clearInterval(interval);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchProject, project?.status]);

  const doAction = async (action: string, body?: Record<string, unknown>) => {
    setActionLoading(action);
    setActionError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Action failed');
      await fetchProject();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Project not found</p>
        <button onClick={onBack} className="mt-4 text-blue-600 hover:underline">← Back</button>
      </div>
    );
  }

  const isProcessing = ACTIVE_STATUSES.includes(project.status);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-700 text-sm flex items-center gap-1">
          ← Back
        </button>
        <h2 className="text-xl font-bold text-gray-900 truncate flex-1">
          {project.title || 'Loading...'}
        </h2>
        {isProcessing && (
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 flex-shrink-0" />
        )}
      </div>

      {/* Video Info */}
      {project.thumbnail && (
        <div className="flex gap-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={project.thumbnail}
            alt={project.title}
            className="w-32 h-20 object-cover rounded-lg flex-shrink-0"
          />
          <div>
            <p className="font-medium text-gray-900">{project.title}</p>
            {project.channel && <p className="text-sm text-gray-500">{project.channel}</p>}
            {project.duration > 0 && (
              <p className="text-sm text-gray-500">Duration: {formatTime(project.duration)}</p>
            )}
            <a
              href={project.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline mt-1 inline-block"
            >
              View on YouTube ↗
            </a>
          </div>
        </div>
      )}

      {/* Status */}
      <div className="space-y-2">
        <StepIndicator project={project} />
        <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLOR[project.status]}`}>
          {STATUS_LABELS[project.status] || project.status}
        </div>
        {project.error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            ⚠️ {project.error}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      {actionError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          ⚠️ {actionError}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {/* Transcribe button */}
        {(project.status === 'fetched' || project.status === 'error') && project.downloadUrl && (
          <button
            onClick={() => doAction('transcribe')}
            disabled={!!actionLoading}
            className="px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50 transition-colors"
          >
            {actionLoading === 'transcribe' ? '⏳ Starting...' : '📝 Transcribe Audio'}
          </button>
        )}

        {/* Score highlights button */}
        {(project.status === 'transcribed' || (project.status === 'error' && project.transcriptText)) && (
          <button
            onClick={() => doAction('highlights')}
            disabled={!!actionLoading}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            {actionLoading === 'highlights' ? '⏳ Starting...' : '⭐ Score Highlights'}
          </button>
        )}

        {/* Refresh button when processing */}
        {isProcessing && (
          <button
            onClick={fetchProject}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            🔄 Refresh Status
          </button>
        )}
      </div>

      {/* Transcript Preview */}
      {project.transcriptText && (
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">📝 Transcript</h3>
          <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 max-h-40 overflow-y-auto">
            <p className="text-sm text-gray-700 leading-relaxed">{project.transcriptText}</p>
          </div>
        </div>
      )}

      {/* Highlight Candidates */}
      {project.highlightCandidates && project.highlightCandidates.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-3">⭐ Highlight Candidates</h3>
          <div className="space-y-3">
            {project.highlightCandidates
              .sort((a, b) => b.score - a.score)
              .map((h, i) => (
                <HighlightCard
                  key={i}
                  highlight={h}
                  index={i}
                  onRender={(start, end, burnSubs, clipIdx) =>
                    doAction('render', { start, end, burnSubtitles: burnSubs, clipIndex: clipIdx })
                  }
                  isRendering={actionLoading === 'render' || project.status === 'rendering'}
                />
              ))}
          </div>
        </div>
      )}

      {/* Custom Render */}
      {project.downloadUrl && (
        <CustomRenderPanel
          project={project}
          onRender={(start, end, burnSubs) =>
            doAction('render', { start, end, burnSubtitles: burnSubs, clipIndex: 99 })
          }
          isRendering={actionLoading === 'render' || project.status === 'rendering'}
        />
      )}

      {/* Renders */}
      {project.renders && project.renders.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-3">🎬 Rendered Clips</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {project.renders.map((render, i) => (
              <div key={i} className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
                <video
                  src={render.url}
                  controls
                  className="w-full aspect-[9/16] bg-black"
                  playsInline
                />
                <div className="p-3">
                  <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                    <span>📐 {render.format}</span>
                    <span>⏱ {formatDuration(Math.round(render.duration))}</span>
                    {render.subtitle && <span>💬 Subtitles</span>}
                  </div>
                  <a
                    href={render.url}
                    download={`clip_${i + 1}.mp4`}
                    className="block w-full text-center px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors"
                  >
                    ⬇️ Download Clip {i + 1}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CustomRenderPanel({
  project,
  onRender,
  isRendering,
}: {
  project: Project;
  onRender: (start: number, end: number, burnSubtitles: boolean) => void;
  isRendering: boolean;
}) {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(Math.min(60, project.duration));
  const [burnSubs, setBurnSubs] = useState(false);
  const [preset, setPreset] = useState<30 | 60 | 90>(60);

  const applyPreset = (duration: 30 | 60 | 90) => {
    setPreset(duration);
    setEnd(Math.min(start + duration, project.duration));
  };

  if (!['fetched', 'transcribed', 'scored', 'done', 'error'].includes(project.status)) {
    return null;
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-white">
      <h3 className="text-lg font-semibold text-gray-800 mb-3">✂️ Custom Clip</h3>
      <div className="space-y-4">
        <div className="flex gap-2">
          {([30, 60, 90] as const).map((d) => (
            <button
              key={d}
              onClick={() => applyPreset(d)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                preset === d ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {d}s
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm text-gray-600">Start (sec)</span>
            <input
              type="number"
              min={0}
              max={project.duration}
              value={start}
              onChange={(e) => setStart(Number(e.target.value))}
              className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="block">
            <span className="text-sm text-gray-600">End (sec)</span>
            <input
              type="number"
              min={start + 1}
              max={project.duration}
              value={end}
              onChange={(e) => setEnd(Number(e.target.value))}
              className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={burnSubs}
              onChange={(e) => setBurnSubs(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded"
            />
            Burn subtitles {!project.srt && '(requires transcript)'}
          </label>
          <button
            onClick={() => onRender(start, end, burnSubs && !!project.srt)}
            disabled={isRendering || end <= start}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isRendering ? '⏳ Rendering...' : '🎬 Render Custom Clip'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      if (data.projects) setProjects(data.projects);
    } catch {
      // ignore
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setCreating(true);
    setCreateError(null);

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create project');

      setUrl('');
      setSelectedProjectId(data.project.id);
      await fetchProjects();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  if (selectedProjectId) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
        <div className="max-w-2xl mx-auto px-4 py-8">
          <ProjectView
            projectId={selectedProjectId}
            onBack={() => {
              setSelectedProjectId(null);
              fetchProjects();
            }}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            🎬 ClipAnime
          </h1>
          <p className="text-gray-500 text-lg">
            Auto-generate short clips from any YouTube video
          </p>
        </div>

        {/* URL Input */}
        <form onSubmit={handleCreate} className="mb-8">
          <div className="flex gap-3">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className="flex-1 border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-sm"
              required
            />
            <button
              type="submit"
              disabled={creating || !url.trim()}
              className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {creating ? '⏳ Creating...' : '🚀 Start'}
            </button>
          </div>
          {createError && (
            <p className="mt-2 text-sm text-red-600">⚠️ {createError}</p>
          )}
        </form>

        {/* Projects List */}
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            Recent Projects
          </h2>

          {loadingProjects ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-5xl mb-3">🎥</p>
              <p>No projects yet. Paste a YouTube URL to get started!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProjectId(p.id)}
                  className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200 rounded-xl hover:shadow-md hover:border-blue-200 transition-all text-left"
                >
                  {p.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.thumbnail}
                      alt={p.title}
                      className="w-16 h-10 object-cover rounded flex-shrink-0"
                    />
                  ) : (
                    <div className="w-16 h-10 bg-gray-200 rounded flex-shrink-0 flex items-center justify-center text-gray-400 text-xl">
                      🎬
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">
                      {p.title || p.videoId || 'Loading...'}
                    </p>
                    <p className="text-sm text-gray-500 truncate">{p.sourceUrl}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[p.status]}`}>
                      {STATUS_LABELS[p.status] || p.status}
                    </span>
                    {p.renders.length > 0 && (
                      <span className="text-xs text-gray-400">{p.renders.length} clip(s)</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
