import { transcribeAudio as elevenLabsSTT } from './api/elevenlabs-stt';
import { transcribeAudio as deepgramSTT } from './api/deepgram-stt';
import { transcribeAudio as groqSTT } from './api/groq-stt';

/**
 * Transcribe audio using ElevenLabs Scribe (primary) with Groq and Deepgram fallbacks.
 * Frontend-direct — no backend involvement.
 *
 * Fallback chain: ElevenLabs -> Groq -> Deepgram
 */
export async function transcribe(
  audioBase64: string,
  mimeType: string,
  elevenLabsKey: string,
  deepgramKey?: string,
  groqKey?: string,
): Promise<string> {
  // Try ElevenLabs first (primary)
  if (elevenLabsKey) {
    try {
      const text = await elevenLabsSTT(audioBase64, mimeType, elevenLabsKey);
      console.log('[DOMino] STT provider used: ElevenLabs ✅');
      return text;
    } catch (err) {
      console.warn('[DOMino] ElevenLabs STT failed, trying Groq fallback:', err);
    }
  }

  // Try Groq second (fallback)
  if (groqKey) {
    try {
      const text = await groqSTT(audioBase64, mimeType, groqKey);
      console.log('[DOMino] STT provider used: Groq (fallback) ⚠️');
      return text;
    } catch (err) {
      console.warn('[DOMino] Groq STT failed, trying Deepgram fallback:', err);
    }
  }

  // Try Deepgram last
  if (deepgramKey) {
    try {
      const text = await deepgramSTT(audioBase64, mimeType, deepgramKey);
      console.log('[DOMino] STT provider used: Deepgram (fallback) ⚠️');
      return text;
    } catch (deepgramErr) {
      console.warn('[DOMino] Deepgram STT also failed:', deepgramErr);
    }
  }

  throw new Error('All STT providers failed — check your API keys in Settings');
}
