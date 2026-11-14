/**
 * Host-side call recorder: composites every visible tile of the call stage onto a canvas and mixes
 * all audio (local mic + remote participants) through WebAudio, then records with MediaRecorder.
 * Nothing leaves the host's browser unless they choose to upload the result.
 */
export class CallRecorder {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private audioCtx = new AudioContext();
  private dest = this.audioCtx.createMediaStreamDestination();
  private sources = new Map<string, MediaStreamAudioSourceNode>();
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private drawTimer?: ReturnType<typeof setInterval>;
  private startedAt = 0;

  constructor(
    private stage: () => HTMLElement | null,
    private audioTracks: () => MediaStreamTrack[],
  ) {
    this.canvas.width = 1280;
    this.canvas.height = 720;
  }

  static get supported() {
    return typeof MediaRecorder !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
  }

  start() {
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    const stream = new MediaStream([
      ...this.canvas.captureStream(24).getVideoTracks(),
      ...this.dest.stream.getAudioTracks(),
    ]);
    this.recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
    this.chunks = [];
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(1000);
    this.startedAt = Date.now();
    // setInterval (not rAF) so recording continues when the tab is in the background.
    this.drawTimer = setInterval(() => {
      this.syncAudio();
      this.draw();
    }, 1000 / 24);
  }

  stop(): Promise<{ blob: Blob; durationSec: number }> {
    return new Promise((resolve) => {
      clearInterval(this.drawTimer);
      const durationSec = Math.round((Date.now() - this.startedAt) / 1000);
      const finish = () => {
        resolve({ blob: new Blob(this.chunks, { type: 'video/webm' }), durationSec });
        this.sources.forEach((s) => s.disconnect());
        void this.audioCtx.close().catch(() => {});
      };
      if (!this.recorder || this.recorder.state === 'inactive') return finish();
      this.recorder.onstop = finish;
      this.recorder.stop();
    });
  }

  private syncAudio() {
    if (this.audioCtx.state === 'suspended') void this.audioCtx.resume().catch(() => {});
    const tracks = this.audioTracks().filter((t) => t.readyState === 'live');
    const ids = new Set(tracks.map((t) => t.id));
    for (const [id, src] of this.sources) {
      if (!ids.has(id)) {
        src.disconnect();
        this.sources.delete(id);
      }
    }
    for (const t of tracks) {
      if (this.sources.has(t.id)) continue;
      try {
        const src = this.audioCtx.createMediaStreamSource(new MediaStream([t]));
        src.connect(this.dest);
        this.sources.set(t.id, src);
      } catch {
        /* track not ready yet */
      }
    }
  }

  private draw() {
    const { ctx, canvas } = this;
    ctx.fillStyle = '#0b0b0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const tiles = [...(this.stage()?.querySelectorAll<HTMLElement>('[data-rec-tile]') ?? [])];
    // A screen share, if any, takes the whole frame.
    const screen = tiles.find((t) => t.dataset.recTile === 'screen');
    const list = screen ? [screen] : tiles;
    if (!list.length) return;
    const cols = Math.ceil(Math.sqrt(list.length));
    const rows = Math.ceil(list.length / cols);
    const w = canvas.width / cols;
    const h = canvas.height / rows;
    list.forEach((tile, i) => {
      const x = (i % cols) * w;
      const y = Math.floor(i / cols) * h;
      const video = tile.querySelector('video');
      const name = tile.dataset.recName ?? '';
      ctx.fillStyle = '#1c1c22';
      ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
      if (video && tile.dataset.recVideo === 'on' && video.videoWidth) {
        const scale = Math.min((w - 8) / video.videoWidth, (h - 8) / video.videoHeight);
        const vw = video.videoWidth * scale;
        const vh = video.videoHeight * scale;
        ctx.drawImage(video, x + (w - vw) / 2, y + (h - vh) / 2, vw, vh);
      } else {
        ctx.fillStyle = '#e11d48';
        ctx.beginPath();
        ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.round(Math.min(w, h) / 8)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name.charAt(0).toUpperCase(), x + w / 2, y + h / 2);
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = '600 18px system-ui';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const tw = ctx.measureText(name).width;
      ctx.fillRect(x + 12, y + h - 40, tw + 16, 28);
      ctx.fillStyle = '#fff';
      ctx.fillText(name, x + 20, y + h - 20);
    });
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
