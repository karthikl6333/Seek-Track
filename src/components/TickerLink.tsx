export function yahooQuoteUrl(symbol: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol.toUpperCase())}`;
}

export function TickerLink({
  symbol,
  className,
}: {
  symbol: string;
  className?: string;
}) {
  if (!symbol) return null;
  return (
    <a
      className={`mono ticker-link${className ? ` ${className}` : ''}`}
      href={yahooQuoteUrl(symbol)}
      target="_blank"
      rel="noopener noreferrer"
      title={`Yahoo Finance: ${symbol.toUpperCase()}`}
    >
      {symbol}
    </a>
  );
}
