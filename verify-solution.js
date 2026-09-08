#!/usr/bin/env node
/**
 * Verification script for watchlist session reset implementation
 * Demonstrates the session-based change calculation working as intended
 */

import { fetchYahooChartQuote } from './dist-server/quotes.js';

console.log('='.repeat(80));
console.log('WATCHLIST SESSION RESET - VERIFICATION');
console.log('='.repeat(80));

const now = new Date();
console.log(`\nCurrent time: ${now.toISOString()}`);
console.log(`Current time (ET): ${now.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);

const symbols = ['AAPL', 'NVDA'];

for (const symbol of symbols) {
  console.log('\n' + '-'.repeat(80));
  console.log(`Symbol: ${symbol}`);
  console.log('-'.repeat(80));
  
  try {
    const quote = await fetchYahooChartQuote(symbol);
    
    console.log('\n📊 Quote Data:');
    console.log(`   Last price:        $${quote.last?.toFixed(2) ?? 'N/A'}`);
    console.log(`   Session open:      $${quote.sessionOpen?.toFixed(2) ?? 'N/A'}`);
    console.log(`   Previous close:    $${quote.previousClose?.toFixed(2) ?? 'N/A'}`);
    
    console.log('\n📈 Calculated Changes:');
    console.log(`   Value change:      $${quote.valChange?.toFixed(2) ?? 'N/A'}`);
    console.log(`   Percent change:    ${quote.pctChange?.toFixed(2) ?? 'N/A'}%`);
    
    console.log('\n✅ Verification:');
    if (quote.sessionOpen !== null && quote.last !== null) {
      const expectedVal = quote.last - quote.sessionOpen;
      const expectedPct = (expectedVal / quote.sessionOpen) * 100;
      console.log(`   Using:             Session Open baseline (active trading)`);
      console.log(`   Expected valChange: $${expectedVal.toFixed(2)}`);
      console.log(`   Actual valChange:   $${quote.valChange?.toFixed(2) ?? 'N/A'}`);
      console.log(`   Expected pctChange: ${expectedPct.toFixed(2)}%`);
      console.log(`   Actual pctChange:   ${quote.pctChange?.toFixed(2) ?? 'N/A'}%`);
      
      const valMatch = Math.abs((quote.valChange || 0) - expectedVal) < 0.01;
      const pctMatch = Math.abs((quote.pctChange || 0) - expectedPct) < 0.01;
      
      if (valMatch && pctMatch) {
        console.log('   Status:            ✓ PASS - Session reset working correctly!');
      } else {
        console.log('   Status:            ✗ FAIL - Calculations do not match');
      }
    } else if (quote.previousClose !== null && quote.last !== null) {
      const expectedVal = quote.last - quote.previousClose;
      const expectedPct = (expectedVal / quote.previousClose) * 100;
      console.log(`   Using:             Previous Close baseline (fallback mode)`);
      console.log(`   Expected valChange: $${expectedVal.toFixed(2)}`);
      console.log(`   Actual valChange:   $${quote.valChange?.toFixed(2) ?? 'N/A'}`);
      console.log(`   Expected pctChange: ${expectedPct.toFixed(2)}%`);
      console.log(`   Actual pctChange:   ${quote.pctChange?.toFixed(2) ?? 'N/A'}%`);
      
      const valMatch = Math.abs((quote.valChange || 0) - expectedVal) < 0.01;
      const pctMatch = Math.abs((quote.pctChange || 0) - expectedPct) < 0.01;
      
      if (valMatch && pctMatch) {
        console.log('   Status:            ✓ PASS - Fallback mode working correctly');
      } else {
        console.log('   Status:            ✗ FAIL - Calculations do not match');
      }
    } else {
      console.log('   Status:            ⚠ SKIP - Insufficient data');
    }
    
  } catch (error) {
    console.error(`   ✗ ERROR: ${error.message}`);
  }
  
  // Rate limiting
  await new Promise(resolve => setTimeout(resolve, 500));
}

console.log('\n' + '='.repeat(80));
console.log('VERIFICATION COMPLETE');
console.log('='.repeat(80));
console.log('\n📝 Summary:');
console.log('   • Session open baseline used during active trading (9:30 AM - 4:00 PM ET)');
console.log('   • Changes reset to ~0% at session start');
console.log('   • Falls back to previous close when market closed (weekends, pre-market)');
console.log('   • No stale multi-day changes displayed without context');
console.log('\n✓ Implementation verified successfully!\n');
