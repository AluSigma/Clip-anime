import axios from 'axios';

const BASE = 'https://api.assemblyai.com/v2';

function aaiHeaders() {
  return {
    authorization: process.env.ASSEMBLYAI_API_KEY || '',
    'content-type': 'application/json',
  };
}

export async function submitTranscription(audioUrl: string, languageCode = 'en'): Promise<string> {
  const { data } = await axios.post(
    `${BASE}/transcript`,
    {
      audio_url: audioUrl,
      language_code: languageCode,
      punctuate: true,
      format_text: true,
    },
    { headers: aaiHeaders(), timeout: 30000 }
  );
  return data.id as string;
}

export interface TranscriptResult {
  text: string;
  words: Array<{ text: string; start: number; end: number; confidence: number }>;
}

export async function waitForTranscription(
  transcriptId: string,
  maxWaitMs = 10 * 60 * 1000
): Promise<TranscriptResult> {
  const start = Date.now();
  while (true) {
    const { data } = await axios.get(`${BASE}/transcript/${transcriptId}`, {
      headers: aaiHeaders(),
      timeout: 30000,
    });

    if (data.status === 'completed') {
      return {
        text: data.text || '',
        words: data.words || [],
      };
    }
    if (data.status === 'error') {
      throw new Error(data.error || 'AssemblyAI transcription error');
    }
    if (Date.now() - start > maxWaitMs) {
      throw new Error('Transcription timeout');
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

export async function getSrtSubtitles(transcriptId: string): Promise<string> {
  const { data } = await axios.get(`${BASE}/transcript/${transcriptId}/srt`, {
    headers: aaiHeaders(),
    timeout: 30000,
    responseType: 'text',
  });
  return data as string;
}
