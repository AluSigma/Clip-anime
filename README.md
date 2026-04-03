# 🎬 ClipAnime

Auto-generate short vertical clips from YouTube videos using AI.

## Features

- 🔍 Fetch YouTube video metadata via RapidAPI
- 📝 Transcribe audio with AssemblyAI (SRT subtitle support)
- ⭐ AI-powered highlight detection via Bluesminds (GPT-4o-mini)
- 🎬 Render 9:16 vertical clips with FFmpeg (optional subtitle burn-in)
- ⬇️ Preview and download generated clips

## Setup

### Prerequisites

- Node.js 18+
- FFmpeg installed and in PATH
- API keys (see below)

### Installation

```bash
git clone https://github.com/AluSigma/Clip-anime
cd Clip-anime
npm install
```

### Environment Variables

Copy `.env.example` to `.env.local` and fill in your keys:

```bash
cp .env.example .env.local
```

Required variables:

| Variable | Description |
|---|---|
| `RAPIDAPI_KEY` | RapidAPI key for YouTube Media Downloader |
| `ASSEMBLYAI_API_KEY` | AssemblyAI API key for transcription |
| `BLUESMINDS_API_KEY` | Bluesminds API key (GPT-4o-mini compatible) |
| `BLUESMINDS_MODEL` | Model name (default: `gpt-4o-mini`) |
| `DATA_DIR` | Directory for project data (default: `./data`) |
| `CLIPS_DIR` | Directory for rendered clips (default: `./public/clips`) |

### Running Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. Paste a YouTube URL into the input field
2. Click **Start** to fetch video metadata
3. Click **Transcribe Audio** to generate transcript + SRT
4. Click **Score Highlights** to identify the best moments
5. Click **Render Clip** on any highlight (or use Custom Clip for manual times)
6. Preview and download your clips

## API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/projects` | Create project from YouTube URL |
| GET | `/api/projects` | List all projects |
| GET | `/api/projects/:id` | Get project details |
| POST | `/api/projects/:id/transcribe` | Start transcription |
| POST | `/api/projects/:id/highlights` | Score highlights with AI |
| POST | `/api/projects/:id/render` | Render a clip |

## Known Limitations

- FFmpeg must be installed on the server (not bundled)
- RapidAPI free tier has request limits
- AssemblyAI transcription takes 1-5 minutes depending on video length
- Rendered clips are stored in `public/clips/` — implement cleanup for production
- No authentication — add auth before deploying publicly
- File-based storage (`data/projects.json`) — use a real DB for production
