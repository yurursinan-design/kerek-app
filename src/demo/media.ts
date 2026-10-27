/** Voice recording and photo shrinking in the browser, sent to the assistant as base64. */

export interface Encoded {
  data: string;
  mime: string;
}

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A photo as JPEG no larger than maxSide pixels. */
export async function shrinkPhoto(file: Blob, maxSide: number): Promise<Encoded & { url: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('photo'))), 'image/jpeg', 0.82));
  return { data: toBase64(await blob.arrayBuffer()), mime: 'image/jpeg', url: URL.createObjectURL(blob) };
}

/** 16 kHz mono 16-bit WAV: small, and every speech model reads it. */
function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

const RATE = 16000;
export const MAX_VOICE_SECONDS = 45;

export interface Recording {
  stop(): Promise<(Encoded & { seconds: number; url: string }) | null>;
  cancel(): void;
}

export async function startRecording(onAutoStop: () => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const started = Date.now();
  const timer = window.setTimeout(onAutoStop, MAX_VOICE_SECONDS * 1000);
  recorder.start();
  const finish = () =>
    new Promise<void>((resolve) => {
      window.clearTimeout(timer);
      recorder.onstop = () => resolve();
      if (recorder.state !== 'inactive') recorder.stop();
      else resolve();
      stream.getTracks().forEach((t) => t.stop());
    });
  return {
    async stop() {
      await finish();
      const seconds = (Date.now() - started) / 1000;
      if (seconds < 0.8 || !chunks.length) return null;
      const blob = new Blob(chunks, { type: recorder.mimeType });
      const ctx = new AudioContext();
      try {
        const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
        const frames = Math.ceil(decoded.duration * RATE);
        const offline = new OfflineAudioContext(1, frames, RATE);
        const src = offline.createBufferSource();
        src.buffer = decoded;
        src.connect(offline.destination);
        src.start();
        const rendered = await offline.startRendering();
        const wav = encodeWav(rendered.getChannelData(0), RATE);
        return { data: toBase64(wav), mime: 'audio/wav', seconds: Math.round(decoded.duration), url: URL.createObjectURL(blob) };
      } finally {
        void ctx.close();
      }
    },
    cancel() {
      void finish();
    },
  };
}
