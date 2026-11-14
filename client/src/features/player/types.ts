export interface VideoProgress {
  positionSec: number;
  durationSec: number;
  completed: boolean;
}

export interface VideoSummary {
  id: string;
  title: string;
  description: string;
  channelName: string;
  durationSec: number;
  fileSizeBytes: number;
  isPremium: boolean;
  isDownloadable: boolean;
  views: number;
  createdAt: string;
  thumbnailUrl: string;
  captionsUrl: string | null;
  streamUrl: string;
  progress?: VideoProgress | null;
}

export type AccessReason = 'PREMIUM_REQUIRED' | 'DAILY_LIMIT' | 'SIGN_IN' | null;

export interface VideoDetail {
  video: VideoSummary;
  progress: VideoProgress | null;
  access: { allowed: boolean; reason: AccessReason; remainingWatchSeconds: number | null };
  nextVideo: VideoSummary | null;
  features: { plan: string; adFree: boolean; maxQuality: string; dailyWatchMinutes: number | null };
  completePercent: number;
}

export interface ProgressResponse {
  progress: VideoProgress;
  justCompleted: boolean;
  remainingWatchSeconds: number | null;
  limitReached: boolean;
}
