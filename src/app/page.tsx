'use client';

import { useEffect, useMemo, useState } from 'react';

interface GeneratedClip {
  title: string;
  start_time: string;
  end_time: string;
  downloadUrl: string;
}

const LOADING_MESSAGES = [
  'Menembus Pertahanan YouTube...',
  'Menyusun Data Video...',
  'AI Sedang Menganalisa...',
  'Memotong Video...',
  'Menyempurnakan Hasil Sultan...',
];

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clips, setClips] = useState<GeneratedClip[]>([]);
  const [videoTitle, setVideoTitle] = useState('');
  const [loadingIndex, setLoadingIndex] = useState(0);

  useEffect(() => {
    if (!loading) return;
    const timer = setInterval(() => {
      setLoadingIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 1800);
    return () => clearInterval(timer);
  }, [loading]);

  const isValidYouTubeUrl = useMemo(() => {
    const value = url.trim();
    if (!value) return false;

    try {
      const parsed = new URL(value);
      const host = parsed.hostname.toLowerCase();
      return host.includes('youtube.com') || host.includes('youtu.be');
    } catch {
      return false;
    }
  }, [url]);

  const onGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidYouTubeUrl || loading) return;

    setLoading(true);
    setError(null);
    setClips([]);
    setVideoTitle('');
    setLoadingIndex(0);

    try {
      const res = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Gagal memproses video.');
      }

      setVideoTitle(String(data?.videoTitle || 'Hasil Sultan Clipper'));
      setClips(Array.isArray(data?.clips) ? data.clips : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan saat memproses video.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#06070b] bg-[radial-gradient(circle_at_10%_10%,rgba(147,51,234,0.25),transparent_35%),radial-gradient(circle_at_90%_20%,rgba(234,179,8,0.18),transparent_35%),linear-gradient(to_bottom_right,#090a12,#030409)] text-zinc-100">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:py-16">
        <section className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-xl ring-1 ring-purple-400/20 lg:p-12">
          <div className="text-center">
            <p className="mb-3 inline-flex rounded-full border border-yellow-400/40 bg-yellow-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-yellow-300">
              AI Auto Shorts Generator
            </p>
            <h1 className="text-4xl font-extrabold leading-tight sm:text-6xl">
              <span className="bg-gradient-to-r from-yellow-300 via-amber-200 to-purple-300 bg-clip-text text-transparent drop-shadow-[0_0_20px_rgba(250,204,21,0.35)]">
                Sultan Clipper
              </span>
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-sm text-zinc-300 sm:text-base">
              Ubah video YouTube jadi klip vertikal premium dalam hitungan menit dengan kekuatan AI.
            </p>
          </div>

          <form onSubmit={onGenerate} className="mx-auto mt-8 max-w-3xl">
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="h-14 flex-1 rounded-2xl border border-white/15 bg-black/30 px-5 text-base text-white placeholder:text-zinc-500 outline-none transition focus:border-purple-400/70 focus:ring-2 focus:ring-purple-400/40"
                required
              />
              <button
                type="submit"
                disabled={!isValidYouTubeUrl || loading}
                className="h-14 rounded-2xl bg-gradient-to-r from-yellow-400 via-amber-300 to-purple-400 px-7 font-bold text-zinc-900 shadow-xl transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Memproses...' : 'Generate Clips'}
              </button>
            </div>
            {!isValidYouTubeUrl && url.trim() && (
              <p className="mt-2 text-sm text-red-300">URL YouTube tidak valid.</p>
            )}
          </form>

          {loading && (
            <div className="mt-8 rounded-2xl border border-white/10 bg-black/30 p-6 text-center">
              <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-purple-300/30 border-t-yellow-300" />
              <p className="mt-4 text-sm font-medium text-zinc-200">{LOADING_MESSAGES[loadingIndex]}</p>
            </div>
          )}

          {error && (
            <div className="mt-6 rounded-2xl border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-200 shadow-lg shadow-red-900/20">
              ⚠️ {error}
            </div>
          )}
        </section>

        {clips.length > 0 && (
          <section className="mt-10">
            <div className="mb-5">
              <h2 className="text-2xl font-bold text-white">Result Gallery</h2>
              <p className="mt-1 text-sm text-zinc-400">{videoTitle}</p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {clips.map((clip, index) => (
                <article
                  key={`${clip.downloadUrl}-${index}`}
                  className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-xl ring-1 ring-white/5 backdrop-blur"
                >
                  <video controls src={clip.downloadUrl} className="aspect-[9/16] w-full bg-black" />
                  <div className="space-y-2 p-4">
                    <h3 className="line-clamp-2 font-semibold text-zinc-100">{clip.title}</h3>
                    <p className="text-xs text-zinc-400">
                      {clip.start_time} - {clip.end_time}
                    </p>
                    <a
                      href={clip.downloadUrl}
                      download
                      className="inline-flex rounded-lg border border-yellow-300/40 bg-yellow-300/10 px-3 py-1.5 text-xs font-medium text-yellow-200 transition hover:bg-yellow-300/20"
                    >
                      Download Clip
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
