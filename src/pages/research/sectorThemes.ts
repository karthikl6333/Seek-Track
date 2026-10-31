/** Sector theme ETF mappings: verified live sector ETFs only
 * Each theme shows only real, currently-listed sector products.
 * Themes with fewer than 5+5 reflect actual market availability.
 */
export const SECTOR_THEMES: Record<string, {
  name: string;
  bull: Array<{ etf: string; factor: number; name: string }>;
  bear: Array<{ etf: string; factor: number; name: string }>;
}> = {
  AI: {
    name: 'AI',
    bull: [
      { etf: 'AIBU', factor: 2, name: 'Direxion Daily AI Bull 2X' },
    ],
    bear: [
      { etf: 'AIBD', factor: -2, name: 'Direxion Daily AI Bear 2X' },
    ],
  },
  Tech: {
    name: 'Tech',
    bull: [
      { etf: 'TECL', factor: 3, name: 'Direxion Daily Technology Bull 3X' },
      { etf: 'ROM', factor: 2, name: 'ProShares Ultra Technology' },
    ],
    bear: [
      { etf: 'TECS', factor: -3, name: 'Direxion Daily Technology Bear 3X' },
      { etf: 'REW', factor: -2, name: 'ProShares UltraShort Technology' },
    ],
  },
  Semiconductors: {
    name: 'Semiconductors',
    bull: [
      { etf: 'SOXL', factor: 3, name: 'Direxion Daily Semiconductor Bull 3X' },
      { etf: 'USD', factor: 2, name: 'ProShares Ultra Semiconductors' },
    ],
    bear: [
      { etf: 'SOXS', factor: -3, name: 'Direxion Daily Semiconductor Bear 3X' },
      { etf: 'SSG', factor: -2, name: 'ProShares UltraShort Semiconductors' },
    ],
  },
  Energy: {
    name: 'Energy',
    bull: [
      { etf: 'ERX', factor: 2, name: 'Direxion Daily Energy Bull 2X' },
      { etf: 'NRGU', factor: 2, name: 'MicroSectors U.S. Big Oil Index 2X Leveraged ETNs' },
      { etf: 'DIG', factor: 2, name: 'ProShares Ultra Oil & Gas' },
    ],
    bear: [
      { etf: 'ERY', factor: -2, name: 'Direxion Daily Energy Bear 2X' },
      { etf: 'NRGD', factor: -2, name: 'MicroSectors U.S. Big Oil Index -2X Inverse Leveraged ETNs' },
      { etf: 'DUG', factor: -2, name: 'ProShares UltraShort Oil & Gas' },
    ],
  },
  Power: {
    name: 'Power',
    bull: [
      { etf: 'UTSL', factor: 3, name: 'Direxion Daily Utilities Bull 3X' },
      { etf: 'UPW', factor: 2, name: 'ProShares Ultra Utilities' },
    ],
    bear: [
      { etf: 'SDP', factor: -2, name: 'ProShares UltraShort Utilities' },
    ],
  },
  'Real Estate': {
    name: 'Real Estate',
    bull: [
      { etf: 'DRN', factor: 3, name: 'Direxion Daily Real Estate Bull 3X' },
      { etf: 'URE', factor: 2, name: 'ProShares Ultra Real Estate' },
    ],
    bear: [
      { etf: 'DRV', factor: -3, name: 'Direxion Daily Real Estate Bear 3X' },
      { etf: 'SRS', factor: -2, name: 'ProShares UltraShort Real Estate' },
    ],
  },
  Financials: {
    name: 'Financials',
    bull: [
      { etf: 'FAS', factor: 3, name: 'Direxion Daily Financial Bull 3X' },
      { etf: 'UYG', factor: 2, name: 'ProShares Ultra Financials' },
      { etf: 'BNKU', factor: 3, name: 'MicroSectors U.S. Big Banks Index 3X Leveraged ETNs' },
    ],
    bear: [
      { etf: 'FAZ', factor: -3, name: 'Direxion Daily Financial Bear 3X' },
      { etf: 'SKF', factor: -2, name: 'ProShares UltraShort Financials' },
      { etf: 'BNKD', factor: -3, name: 'MicroSectors U.S. Big Banks Index -3X Inverse Leveraged ETNs' },
    ],
  },
  Biotech: {
    name: 'Biotech',
    bull: [
      { etf: 'LABU', factor: 3, name: 'Direxion Daily S&P Biotech Bull 3X' },
      { etf: 'BIB', factor: 2, name: 'ProShares Ultra Nasdaq Biotechnology' },
      { etf: 'CURE', factor: 3, name: 'Direxion Daily Healthcare Bull 3X' },
      { etf: 'RXL', factor: 2, name: 'ProShares Ultra Health Care' },
    ],
    bear: [
      { etf: 'LABD', factor: -3, name: 'Direxion Daily S&P Biotech Bear 3X' },
      { etf: 'BIS', factor: -2, name: 'ProShares UltraShort Nasdaq Biotechnology' },
      { etf: 'RXD', factor: -2, name: 'ProShares UltraShort Health Care' },
    ],
  },
  China: {
    name: 'China',
    bull: [
      { etf: 'YINN', factor: 3, name: 'Direxion Daily FTSE China Bull 3X' },
      { etf: 'CWEB', factor: 2, name: 'Direxion Daily CSI China Internet Index Bull 2X' },
      { etf: 'CHAU', factor: 2, name: 'Direxion Daily CSI 300 China A Share Bull 2X' },
      { etf: 'FXI', factor: 1, name: 'iShares China Large-Cap ETF' },
    ],
    bear: [
      { etf: 'YANG', factor: -3, name: 'Direxion Daily FTSE China Bear 3X' },
      { etf: 'CHAD', factor: -1, name: 'Direxion Daily CSI 300 China A Share Bear 1X' },
      { etf: 'FXP', factor: -2, name: 'ProShares UltraShort FTSE China 50' },
    ],
  },
  Materials: {
    name: 'Materials',
    bull: [
      { etf: 'UYM', factor: 2, name: 'ProShares Ultra Basic Materials' },
    ],
    bear: [
      { etf: 'SMN', factor: -2, name: 'ProShares UltraShort Basic Materials' },
    ],
  },
};
