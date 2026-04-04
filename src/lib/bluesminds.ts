import axios from 'axios';
import { HighlightCandidate } from '@/types/project';

const ENDPOINT = 'https://api.bluesminds.com/v1/chat/completions';

function getBluesmindsAuthorizationHeader(): string {
  const raw = (process.env.BLUESMINDS_API_KEY || '').trim();
  if (!raw) {
    throw new Error('BLUESMINDS_API_KEY is missing. Set it in .env.local');
  }
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    throw new Error('BLUESMINDS_API_KEY is invalid. Provide a non-empty API key');
  }
  return `Bearer ${token}`;
}

interface TranscriptChunk {
  index: number;
  start: number; // seconds
  end: number;   // seconds
  text: string;
}

const AUTO_FALLBACK_CLIPS: HighlightCandidate[] = [
  {
    start: 0,
    end: 30,
    score: 50,
    reason: 'Viral Clip (Auto-Fallback)',
  },
];

export function buildTranscriptChunks(
  words: Array<{ text: string; start: number; end: number }>,
  chunkDurationMs = 30000
): TranscriptChunk[] {
  if (!words || words.length === 0) return [];

  const chunks: TranscriptChunk[] = [];
  let chunkStart = words[0].start;
  let chunkTexts: string[] = [];
  let idx = 0;

  for (const word of words) {
    chunkTexts.push(word.text);
    if (word.end - chunkStart >= chunkDurationMs) {
      chunks.push({
        index: idx++,
        start: Math.round(chunkStart / 1000),
        end: Math.round(word.end / 1000),
        text: chunkTexts.join(' '),
      });
      chunkStart = word.end;
      chunkTexts = [];
    }
  }

  if (chunkTexts.length > 0) {
    const lastWord = words[words.length - 1];
    chunks.push({
      index: idx,
      start: Math.round(chunkStart / 1000),
      end: Math.round(lastWord.end / 1000),
      text: chunkTexts.join(' '),
    });
  }

  return chunks;
}

export async function scoreHighlights(
  chunks: TranscriptChunk[],
  targetCount = 5,
  context?: { title?: string | null; description?: string | null }
): Promise<HighlightCandidate[]> {
  const model = process.env.BLUESMINDS_MODEL || 'gpt-4o-mini';

  const systemPrompt = 'You are a machine. Output ONLY a valid, raw JSON array. DO NOT wrap the output in markdown code blocks. NO backticks. NO conversational text.';

  const metaTitle = (context?.title || '').trim();
  const metaDescription = (context?.description || '').trim();
  const metaBlock = `Video metadata:
Title: ${metaTitle || '(unknown)'}
Description: ${metaDescription.length > 0 ? metaDescription : '(none)'}`;

  const userPrompt = `Analyze these transcript chunks and return the top ${targetCount} most engaging segments as a JSON array.

${metaBlock}

Transcript chunks:
${JSON.stringify(chunks, null, 2)}

Return format (JSON array only):
[
  {
    "start": <start_seconds>,
    "end": <end_seconds>,
    "score": <0-100>,
    "reason": "<brief reason>"
  }
]

Ensure each selected segment is 30-90 seconds long. Merge adjacent chunks if needed to hit target duration. Return exactly ${targetCount} candidates sorted by score descending.`;

  const { data } = await axios.post(ENDPOINT, {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
  }, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: getBluesmindsAuthorizationHeader(),
    },
    timeout: 60000,
  });

  const content = String(data?.choices?.[0]?.message?.content || '[]');
  const cleanedResponse = content
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim();
  const arrayCandidate = cleanedResponse.match(/\[[\s\S]*?\]/)?.[0] || cleanedResponse;

  let clipsData: HighlightCandidate[];
  try {
    const parsed = JSON.parse(arrayCandidate);
    clipsData = Array.isArray(parsed) ? parsed as HighlightCandidate[] : [];
  } catch {
    clipsData = AUTO_FALLBACK_CLIPS;
  }

  if (!Array.isArray(clipsData) || clipsData.length === 0) {
    clipsData = AUTO_FALLBACK_CLIPS;
  }

  return clipsData.map((h) => ({
    start: Number(h.start) || 0,
    end: Number(h.end) || 0,
    score: Number(h.score) || 0,
    reason: String(h.reason || ''),
  }));
}
