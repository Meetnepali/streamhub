import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api, errorMessage } from '../../lib/api';
import type { VideoSummary } from './types';
import { VideoCard, VideoCardSkeleton } from './VideoCard';
import './player.css';

export function HomePage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [query, setQuery] = useState(q);
  const [videos, setVideos] = useState<VideoSummary[] | null>(null);
  const [continueWatching, setContinueWatching] = useState<VideoSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setVideos(null);
    api
      .get<{ items: VideoSummary[] }>(`/videos${q ? `?q=${encodeURIComponent(q)}` : ''}`)
      .then((r) => !cancelled && setVideos(r.items))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [q, user?.id]);

  useEffect(() => {
    if (!user) return setContinueWatching([]);
    api
      .get<{ items: VideoSummary[] }>('/videos/continue-watching')
      .then((r) => setContinueWatching(r.items))
      .catch(() => setContinueWatching([]));
  }, [user]);

  // Debounced search → URL.
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (query.trim() === q) return;
      setParams(query.trim() ? { q: query.trim() } : {}, { replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [query, q, setParams]);

  return (
    <div className="container">
      <div className="home-head">
        <div>
          <h1 className="page-title">{q ? `Results for “${q}”` : 'Explore'}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {q ? `${videos?.length ?? '…'} videos` : 'Fresh videos, courses and more'}
          </p>
        </div>
        <label className="home-search">
          <Search size={16} />
          <input
            className="input"
            type="search"
            placeholder="Search videos"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search videos"
          />
        </label>
      </div>

      {error && <div className="alert error">{error}</div>}

      {!q && continueWatching.length > 0 && (
        <>
          <h2 className="section-title">Continue watching</h2>
          <div className="video-row">
            {continueWatching.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
        </>
      )}

      {!q && <h2 className="section-title">All videos</h2>}
      <div className="video-grid">
        {videos === null
          ? Array.from({ length: 8 }, (_, i) => <VideoCardSkeleton key={i} />)
          : videos.map((v) => <VideoCard key={v.id} video={v} />)}
      </div>
      {videos?.length === 0 && <div className="empty">No videos match your search.</div>}
    </div>
  );
}
