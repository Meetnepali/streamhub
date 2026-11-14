/**
 * Ensures only one video plays at a time: within this tab (module registry) and
 * across tabs (BroadcastChannel). Any player that starts calls claimPlayback().
 */
const players = new Set<HTMLVideoElement>();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('streamhub-playback') : null;
const tabId = Math.random().toString(36).slice(2);

channel?.addEventListener('message', (e: MessageEvent<{ tabId: string }>) => {
  if (e.data?.tabId !== tabId) players.forEach((p) => p.pause());
});

export function registerPlayer(el: HTMLVideoElement) {
  players.add(el);
  return () => {
    players.delete(el);
  };
}

export function claimPlayback(el: HTMLVideoElement) {
  players.forEach((p) => {
    if (p !== el && !p.paused) p.pause();
  });
  channel?.postMessage({ tabId });
}
