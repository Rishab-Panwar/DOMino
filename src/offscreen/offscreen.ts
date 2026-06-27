/**
 * Offscreen document for audio recording.
 * Runs in the extension's origin so mic permission is granted once and persists
 * across all page navigations.
 */
import { getSupportedMimeType } from '../shared/mime-utils';

let mediaRecorder: MediaRecorder | null = null;
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];
let stopped = false;
let amplitudeInterval: ReturnType<typeof setInterval> | null = null;

// Silence detection
let silentSamples = 0;
const SILENCE_THRESHOLD = 0.02;
const SILENCE_DURATION_SAMPLES = 30; // ~1.5s at 50ms polling

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function startRecording(): Promise<void> {
  console.log('[DOMino][offscreen] startRecording called');
  stopped = false;
  chunks = [];
  silentSamples = 0;

  try {
    // Enable browser audio cleanup — noise suppression + auto gain noticeably
    // improve STT accuracy on laptop/built-in mics.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    console.log('[DOMino][offscreen] getUserMedia succeeded, tracks:', stream.getTracks().length);
  } catch (err) {
    console.error('[DOMino][offscreen] getUserMedia failed:', err);
    chrome.runtime.sendMessage({ action: 'offscreen-error', error: 'Microphone access denied' }).catch((err) => console.error('[DOMino] offscreen-error send:', err));
    return;
  }

  // Set up AudioContext + AnalyserNode for amplitude data
  audioContext = new AudioContext();
  // Resume AudioContext in case autoplay policy suspends it
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }
  console.log('[DOMino][offscreen] AudioContext state:', audioContext.state);
  const source = audioContext.createMediaStreamSource(stream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;
  source.connect(analyser);

  // Choose best MIME type using shared utility
  const mimeType = getSupportedMimeType();

  mediaRecorder = new MediaRecorder(stream, { mimeType });

  mediaRecorder.ondataavailable = (event: BlobEvent) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  // Record as a single blob (no timeslice). Timeslicing into 100ms chunks put
  // the webm/EBML header only in the first chunk; reassembling many chunks
  // intermittently produced a headerless, corrupt file on longer recordings.
  // We accumulate and send only at stop, so timeslicing bought nothing.
  mediaRecorder.start();

  // Send amplitude data every 50ms
  let ampLogCount = 0;
  amplitudeInterval = setInterval(() => {
    if (stopped || !analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const arr = Array.from(data);
    // Log first 5 sends so the user can verify data in the offscreen console
    if (ampLogCount < 5) {
      const max = Math.max(...arr);
      const sum = arr.reduce((a, b) => a + b, 0);
      console.log(`[DOMino][offscreen] amplitude #${ampLogCount} max=${max} sum=${sum} bins=${arr.length} first8=`, arr.slice(0, 8));
      ampLogCount++;
    }
    // Send as regular array (Uint8Array doesn't serialize well in chrome messages)
    chrome.runtime.sendMessage({ action: 'offscreen-amplitude', data: arr }).catch((err) => console.error('[DOMino] amplitude send:', err));

    // Silence detection disabled — this is push-to-talk (hold to record,
    // release to stop). Auto-stopping on a false-silent amplitude reading was
    // ending the recording mid-hold and producing a corrupt second blob.
    void SILENCE_THRESHOLD;
    void SILENCE_DURATION_SAMPLES;
    void silentSamples;
  }, 50);

  chrome.runtime.sendMessage({ action: 'offscreen-started' }).catch((err) => console.error('[DOMino] offscreen-started send:', err));
}

async function stopRecording(): Promise<void> {
  console.log('[DOMino][offscreen] stopRecording called, mediaRecorder state:', mediaRecorder?.state, 'chunks:', chunks.length);

  // Guard against a duplicate stop (e.g. key-release after we already stopped).
  // Re-running would rebuild a blob from stale chunks and corrupt the audio.
  if (mediaRecorder === null) {
    console.log('[DOMino][offscreen] stopRecording ignored — already stopped');
    return;
  }

  // Capture a short tail before stopping — releasing the key cuts the recorder
  // instantly, clipping the final word (seen as a trailing "-" in transcripts).
  await new Promise((r) => setTimeout(r, 250));

  stopped = true;

  // Stop amplitude polling
  if (amplitudeInterval !== null) {
    clearInterval(amplitudeInterval);
    amplitudeInterval = null;
  }

  // Stop MediaRecorder and collect audio
  const blob = await new Promise<Blob>((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      console.log('[DOMino][offscreen] MediaRecorder already inactive, using existing chunks:', chunks.length);
      resolve(new Blob(chunks, { type: 'audio/webm' }));
      return;
    }

    mediaRecorder.onstop = () => {
      const type = mediaRecorder?.mimeType || 'audio/webm';
      console.log('[DOMino][offscreen] MediaRecorder stopped, chunks:', chunks.length, 'mimeType:', type);
      resolve(new Blob(chunks, { type }));
    };

    mediaRecorder.stop();
  });

  // Stop stream tracks
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  // Close AudioContext
  if (audioContext) {
    await audioContext.close();
    audioContext = null;
    analyser = null;
  }

  mediaRecorder = null;

  // Convert to base64 and send back
  const audioBase64 = await blobToBase64(blob);
  console.log('[DOMino][offscreen] Sending offscreen-recording-complete, blob size:', blob.size, 'base64 length:', audioBase64.length);
  chrome.runtime.sendMessage({
    action: 'offscreen-recording-complete',
    audioBase64,
    mimeType: blob.type,
  }).catch((err) => {
    console.error('[DOMino][offscreen] Failed to send recording-complete:', err);
  });
}

// Listen for commands from service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'offscreen') return;

  if (message.action === 'start-recording') {
    console.log('[DOMino][offscreen] Starting recording...');
    startRecording();
  } else if (message.action === 'stop-recording') {
    console.log('[DOMino][offscreen] Stopping recording...');
    stopRecording();
  }
});

// Signal to the service worker that the offscreen script has loaded
// and is ready to receive messages. This fixes the race condition where
// createDocument() resolves before the script's onMessage listener is registered.
console.log('[DOMino][offscreen] Script loaded, sending ready signal');
chrome.runtime.sendMessage({ action: 'offscreen-ready' }).catch((err) => console.error('[DOMino] offscreen-ready send:', err));
