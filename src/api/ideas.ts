import { apiGet, API_BASE } from './http';
import { ideaAssetUrl, type Idea, type IdeaListResponse } from '../lib/ideas';

/** Authed API calls for the Ideas tab. Same-origin requests carry the browser's Basic-auth credentials. */
export function loadIdeaList(): Promise<IdeaListResponse> {
  return apiGet<IdeaListResponse>('/api/ideas');
}

export function loadIdea(slug: string): Promise<Idea> {
  return apiGet<Idea>(`/api/ideas/${encodeURIComponent(slug)}`);
}

/** Image resolver for the renderer: "assets/<slug>/<file>" -> "/api/ideas/<slug>/img/<file>". */
export function resolveIdeaImage(ref: string): string | null {
  return ideaAssetUrl(ref, API_BASE);
}
