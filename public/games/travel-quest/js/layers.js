/**
 * Offscreen canvases for skyline tiles, haze, and landmark stamps.
 * A repeat lookup with the same key and size returns the same canvas.
 */

export function pixelRatio() {
  if (typeof window === 'undefined') return 1;
  const dpr = window.devicePixelRatio || 1;
  const narrow = window.innerWidth < 800;
  return Math.min(narrow ? 1.5 : 2, dpr);
}

export function createLayerCache(doc) {
  const store = new Map();
  function documentOf() {
    if (doc) return doc;
    if (typeof document !== 'undefined') return document;
    return null;
  }
  return {
    get(key, cssW, cssH, paint, ratio) {
      const dpr = ratio || 1;
      const W = Math.max(1, Math.round(cssW * dpr));
      const H = Math.max(1, Math.round(cssH * dpr));
      const id = `${key}|${W}x${H}`;
      const hit = store.get(id);
      if (hit) return hit;
      const el = documentOf();
      if (!el) return null;
      const canvas = el.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      if (ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(ctx, cssW, cssH);
      if (ctx.setTransform) ctx.setTransform(1, 0, 0, 1, 0, 0);
      const rec = { canvas, cssW, cssH };
      store.set(id, rec);
      if (store.size > 48) store.delete(store.keys().next().value);
      return rec;
    },
    clear() {
      store.clear();
    },
  };
}
