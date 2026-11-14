import { useCallback, useEffect, useRef, useState } from 'react';

const BUCKET_SEC = 2;
const WIDTH = 160;
const HEIGHT = 90;

/**
 * Timeline hover previews: a hidden, muted <video> on the same source is seeked to the hovered
 * time and the frame is drawn to a canvas. Frames are cached per 2-second bucket and requests are
 * coalesced, so only the latest hover position is decoded while a seek is in flight.
 */
export function useFramePreview(src: string | null) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cache = useRef(new Map<number, string>());
  const busy = useRef(false);
  const pending = useRef<number | null>(null);
  const [frame, setFrame] = useState<{ bucket: number; url: string } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    cache.current.clear();
    setFrame(null);
    setReady(false);
    if (!src) return;
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    v.playsInline = true;
    v.src = src;
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    videoRef.current = v;
    canvasRef.current = canvas;

    const onMeta = () => setReady(true);
    const onSeeked = () => {
      const bucket = Math.round(v.currentTime / BUCKET_SEC);
      try {
        canvas.getContext('2d')?.drawImage(v, 0, 0, WIDTH, HEIGHT);
        const url = canvas.toDataURL('image/jpeg', 0.6);
        if (cache.current.size > 300) cache.current.clear();
        cache.current.set(bucket, url);
        setFrame({ bucket, url });
      } catch {
        // Tainted canvas or decode failure — previews just won't show.
      }
      busy.current = false;
      if (pending.current !== null) {
        const next = pending.current;
        pending.current = null;
        seekTo(next);
      }
    };
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('seeked', onSeeked);
    return () => {
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('seeked', onSeeked);
      v.removeAttribute('src');
      v.load();
      videoRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const seekTo = useCallback((bucket: number) => {
    const v = videoRef.current;
    if (!v) return;
    busy.current = true;
    v.currentTime = bucket * BUCKET_SEC;
  }, []);

  const request = useCallback(
    (time: number) => {
      const bucket = Math.round(time / BUCKET_SEC);
      const hit = cache.current.get(bucket);
      if (hit) {
        setFrame({ bucket, url: hit });
        return;
      }
      if (!ready) return;
      if (busy.current) pending.current = bucket;
      else seekTo(bucket);
    },
    [ready, seekTo],
  );

  return { frame, request, bucketSec: BUCKET_SEC, width: WIDTH, height: HEIGHT };
}
