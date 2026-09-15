import { MediaJobWorkspace } from '@/features/jobs/media-job-workspace';

/** Image generation jobs (Phase 8; resumable since Phase 9). */
export function ImagePage() {
  return <MediaJobWorkspace kind="image" />;
}
