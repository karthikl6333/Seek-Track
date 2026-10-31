import type { UniverseRow } from './types.js';

/** Seed universe — editable via DB later. */
export const RESEARCH_UNIVERSE: UniverseRow[] = [
  { symbol: 'NVDA', name: 'NVIDIA', sortOrder: 1, sectorNote: 'GPU / AI' },
  { symbol: 'AVGO', name: 'Broadcom', sortOrder: 2, sectorNote: 'Semiconductors' },
  { symbol: 'TSM', name: 'TSMC', sortOrder: 3, sectorNote: 'Foundry' },
  { symbol: 'ASML', name: 'ASML', sortOrder: 4, sectorNote: 'Lithography' },
  { symbol: 'AMD', name: 'AMD', sortOrder: 5, sectorNote: 'CPU / GPU' },
  { symbol: 'MU', name: 'Micron', sortOrder: 6, sectorNote: 'Memory' },
  { symbol: 'INTC', name: 'Intel', sortOrder: 7, sectorNote: 'CPU / Foundry' },
  { symbol: 'QCOM', name: 'Qualcomm', sortOrder: 8, sectorNote: 'Mobile / RF' },
  { symbol: 'AMAT', name: 'Applied Materials', sortOrder: 9, sectorNote: 'Equipment' },
  { symbol: 'LRCX', name: 'Lam Research', sortOrder: 10, sectorNote: 'Equipment' },
];

/**
 * Curated single-stock leveraged/inverse ETFs verified via Yahoo quote names (2026-09).
 * Prefer one primary bull + one primary bear per underlying when available.
 */
export const RESEARCH_SEED_MAPS: Array<{
  underlying: string;
  etf: string;
  direction: 'bull' | 'bear';
  factor: number;
}> = [
  { underlying: 'NVDA', etf: 'NVDL', direction: 'bull', factor: 2 },
  { underlying: 'NVDA', etf: 'NVDU', direction: 'bull', factor: 2 },
  { underlying: 'NVDA', etf: 'NVD', direction: 'bear', factor: -2 },
  { underlying: 'NVDA', etf: 'NVDD', direction: 'bear', factor: -1 },
  { underlying: 'AVGO', etf: 'AVL', direction: 'bull', factor: 2 },
  { underlying: 'AVGO', etf: 'AVS', direction: 'bear', factor: -1 },
  { underlying: 'TSM', etf: 'TSMX', direction: 'bull', factor: 2 },
  { underlying: 'TSM', etf: 'TSMZ', direction: 'bear', factor: -1 },
  { underlying: 'ASML', etf: 'ASMG', direction: 'bull', factor: 2 },
  { underlying: 'AMD', etf: 'AMDL', direction: 'bull', factor: 2 },
  { underlying: 'AMD', etf: 'AMUU', direction: 'bull', factor: 2 },
  { underlying: 'AMD', etf: 'AMDS', direction: 'bear', factor: -1 },
  { underlying: 'AMD', etf: 'AMDD', direction: 'bear', factor: -1 },
  { underlying: 'MU', etf: 'MULL', direction: 'bull', factor: 2 },
  { underlying: 'MU', etf: 'MUU', direction: 'bull', factor: 2 },
  { underlying: 'MU', etf: 'MUZ', direction: 'bear', factor: -2 },
  { underlying: 'MU', etf: 'MUD', direction: 'bear', factor: -1 },
  { underlying: 'INTC', etf: 'INTW', direction: 'bull', factor: 2 },
  { underlying: 'QCOM', etf: 'QCML', direction: 'bull', factor: 2 },
  { underlying: 'QCOM', etf: 'QCMU', direction: 'bull', factor: 2 },
  { underlying: 'QCOM', etf: 'QCMD', direction: 'bear', factor: -1 },
  { underlying: 'AMAT', etf: 'AMA', direction: 'bull', factor: 2 },
  { underlying: 'LRCX', etf: 'LRCU', direction: 'bull', factor: 2 },
  // Sandisk / Tradr 2x Long + Short SNDK
  { underlying: 'SNDK', etf: 'SNXX', direction: 'bull', factor: 2 },
  { underlying: 'SNDK', etf: 'SNDQ', direction: 'bear', factor: -2 },
  // Marvell — Direxion MRVU first (primary), GraniteShares MVLL
  { underlying: 'MRVL', etf: 'MRVU', direction: 'bull', factor: 2 },
  { underlying: 'MRVL', etf: 'MVLL', direction: 'bull', factor: 2 },
];
