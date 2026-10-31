import type { ViewId } from '../types/index';

/** Compile-time exhaustive: adding a ViewId without listing it here is a type error. */
const VIEW_MAP: Record<ViewId, true> = {
  overview: true,
  positions: true,
  trades: true,
  charges: true,
  charts: true,
  research: true,
  paper: true,
  paperFlex: true,
  cryptoPaper: true,
};

export const VALID_VIEWS = Object.keys(VIEW_MAP) as ViewId[];

/** "#paperFlex", "#/paperFlex?x=1" -> 'paperFlex'; unknown or empty -> 'overview'. */
export function viewFromHash(hash: string): ViewId {
  const raw = (hash || '').replace(/^#\/?/, '').split(/[/?#]/)[0];
  return Object.prototype.hasOwnProperty.call(VIEW_MAP, raw) ? (raw as ViewId) : 'overview';
}
