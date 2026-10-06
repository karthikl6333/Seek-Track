#!/usr/bin/env node
/**
 * Test the fix against REAL Yahoo API data
 */

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const USER_AGENT = 'Mozilla/5.0 (compatible; SeekTrack/1.0; +https://github.com/karthikl6333/Seek-Track)';

function determineSession(meta, now) {
  const regularStart = meta.currentTradingPeriod?.regular?.start;
  const regularEnd = meta.currentTradingPeriod?.regular?.end;
  const preStart = meta.currentTradingPeriod?.pre?.start;
  const preEnd = meta.currentTradingPeriod?.pre?.end;
  const postStart = meta.currentTradingPeriod?.post?.start;
  const postEnd = meta.currentTradingPeriod?.post?.end;

  if (regularStart != null && regularEnd != null && now >= regularStart && now < regularEnd) {
    return 'regular';
  }
  if (preStart != null && preEnd != null && now >= preStart && now < preEnd) {
    return 'premarket';
  }
  if (postStart != null && postEnd != null && now >= postStart && now < postEnd) {
    return 'afterhours';
  }
  return 'unknown';
}

async function fetchYahooQuote(symbol) {
  const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=true`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Yahoo HTTP ${res.status} for ${symbol}`);
  }

  const data = await res.json();
  const result = data.chart?.result?.[0];
  const meta = result?.meta;

  if (!meta) {
    throw new Error(data.chart?.error?.description || `No quote data for ${symbol}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const session = determineSession(meta, now);
  const isRegularHours = session === 'regular';

  // NEW FIXED LOGIC
  let price = null;
  
  if (isRegularHours) {
    price = meta.regularMarketPrice ?? null;
  } else {
    // Outside regular hours: get last extended-hours bar close
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    for (let i = closes.length - 1; i >= 0; i--) {
      const closePrice = closes[i];
      if (closePrice != null && Number.isFinite(closePrice)) {
        price = Number(closePrice);
        break;
      }
    }
  }

  // Fallback
  if (price === null || !Number.isFinite(price)) {
    price = meta.regularMarketPrice ?? meta.previousClose ?? null;
  }

  if (price === null) {
    throw new Error(`No price for ${symbol}`);
  }

  return {
    symbol,
    price,
    session,
    regularMarketPrice: meta.regularMarketPrice,
    fulldayPrice: meta.fulldayPrice,
    hasPrePostMarketData: meta.hasPrePostMarketData,
    previousClose: meta.previousClose,
    lastBarClose: result?.indicators?.quote?.[0]?.close?.slice(-1)[0],
  };
}

console.log('Testing REAL Yahoo API fix for NVDA...\n');

fetchYahooQuote('NVDA')
  .then(quote => {
    console.log('✅ Successfully fetched quote from Yahoo:\n');
    console.log(`Symbol: ${quote.symbol}`);
    console.log(`Session: ${quote.session}`);
    console.log(`\nYahoo Meta Fields:`);
    console.log(`  regularMarketPrice: $${quote.regularMarketPrice}`);
    console.log(`  fulldayPrice: $${quote.fulldayPrice}`);
    console.log(`  hasPrePostMarketData: ${quote.hasPrePostMarketData}`);
    console.log(`  previousClose: $${quote.previousClose}`);
    console.log(`\nBar Data:`);
    console.log(`  Last bar close: $${quote.lastBarClose}`);
    console.log(`\n🎯 SELECTED PRICE: $${quote.price}`);
    
    if (quote.session !== 'regular') {
      const isCorrect = Math.abs(quote.price - quote.lastBarClose) < 0.01;
      console.log(`\n${isCorrect ? '✅' : '❌'} Extended-hours test:`);
      console.log(`  Expected: ~$${quote.lastBarClose} (last bar close)`);
      console.log(`  Got: $${quote.price}`);
      console.log(`  Status: ${isCorrect ? 'PASS - Using extended-hours price' : 'FAIL'}`);
      
      if (!isCorrect && Math.abs(quote.price - quote.regularMarketPrice) < 0.01) {
        console.log(`  ⚠️  Using regularMarketPrice instead of extended-hours price (BUG)`);
      }
    } else {
      console.log(`\n✅ Regular hours test: Using regularMarketPrice correctly`);
    }
  })
  .catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
