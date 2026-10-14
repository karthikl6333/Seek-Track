import { describe, it, expect } from 'vitest';

/**
 * Calculate distance from price level to last price
 * Returns: { pct, dollar, status }
 */
function calculateDistance(
  ruleType: 'target' | 'stop' | 'no-add-below' | 'deadline' | 'note',
  priceLevel: number | null,
  lastPrice: number | null,
): { pct: number | null; dollar: number | null; status: 'normal' | 'near' | 'hit' } {
  if (!priceLevel || !lastPrice) {
    return { pct: null, dollar: null, status: 'normal' };
  }

  const distancePct = ((lastPrice - priceLevel) / priceLevel) * 100;
  const distanceDollar = lastPrice - priceLevel;

  const nearThreshold = 3;

  let status: 'normal' | 'near' | 'hit' = 'normal';

  if (ruleType === 'target') {
    if (lastPrice >= priceLevel) {
      status = 'hit';
    } else if (distancePct > -nearThreshold) {
      status = 'near';
    }
  } else if (ruleType === 'stop' || ruleType === 'no-add-below') {
    if (lastPrice <= priceLevel) {
      status = 'hit';
    } else if (distancePct < nearThreshold) {
      status = 'near';
    }
  }

  return { pct: distancePct, dollar: distanceDollar, status };
}

describe('Plan Rule Distance Calculation', () => {
  describe('Target rules (sell at or above)', () => {
    it('should mark as hit when price reaches target', () => {
      const result = calculateDistance('target', 150, 150);
      expect(result.status).toBe('hit');
      expect(result.pct).toBe(0);
      expect(result.dollar).toBe(0);
    });

    it('should mark as hit when price exceeds target', () => {
      const result = calculateDistance('target', 150, 155);
      expect(result.status).toBe('hit');
      expect(result.pct).toBeCloseTo(3.33, 2);
      expect(result.dollar).toBe(5);
    });

    it('should mark as near when within 3%', () => {
      const result = calculateDistance('target', 150, 146);
      expect(result.status).toBe('near');
      expect(result.pct).toBeCloseTo(-2.67, 2);
      expect(result.dollar).toBe(-4);
    });

    it('should mark as normal when beyond 3%', () => {
      const result = calculateDistance('target', 150, 140);
      expect(result.status).toBe('normal');
      expect(result.pct).toBeCloseTo(-6.67, 2);
      expect(result.dollar).toBe(-10);
    });
  });

  describe('Stop rules (sell at or below)', () => {
    it('should mark as hit when price reaches stop', () => {
      const result = calculateDistance('stop', 561.92, 561.92);
      expect(result.status).toBe('hit');
      expect(result.pct).toBe(0);
    });

    it('should mark as hit when price goes below stop', () => {
      const result = calculateDistance('stop', 561.92, 550);
      expect(result.status).toBe('hit');
      expect(result.pct).toBeCloseTo(-2.12, 2);
    });

    it('should mark as near when within 3% above', () => {
      const result = calculateDistance('stop', 561.92, 575);
      expect(result.status).toBe('near');
      expect(result.pct).toBeCloseTo(2.33, 2);
    });

    it('should mark as normal when beyond 3% above', () => {
      const result = calculateDistance('stop', 561.92, 600);
      expect(result.status).toBe('normal');
      expect(result.pct).toBeCloseTo(6.78, 2);
    });
  });

  describe('No-add-below rules', () => {
    it('should mark as hit when price reaches level', () => {
      const result = calculateDistance('no-add-below', 585.33, 585.33);
      expect(result.status).toBe('hit');
    });

    it('should mark as hit when price goes below level', () => {
      const result = calculateDistance('no-add-below', 585.33, 580);
      expect(result.status).toBe('hit');
    });

    it('should mark as near when within 3% above', () => {
      const result = calculateDistance('no-add-below', 585.33, 595);
      expect(result.status).toBe('near');
    });

    it('should mark as normal when beyond 3% above', () => {
      const result = calculateDistance('no-add-below', 585.33, 610);
      expect(result.status).toBe('normal');
    });
  });

  describe('Edge cases', () => {
    it('should handle null price level', () => {
      const result = calculateDistance('target', null, 150);
      expect(result.status).toBe('normal');
      expect(result.pct).toBe(null);
      expect(result.dollar).toBe(null);
    });

    it('should handle null last price', () => {
      const result = calculateDistance('target', 150, null);
      expect(result.status).toBe('normal');
      expect(result.pct).toBe(null);
      expect(result.dollar).toBe(null);
    });

    it('should handle deadline rules (no price logic)', () => {
      const result = calculateDistance('deadline', 150, 140);
      expect(result.status).toBe('normal');
    });

    it('should handle note-only rules', () => {
      const result = calculateDistance('note', 150, 140);
      expect(result.status).toBe('normal');
    });
  });

  describe('Real-world scenarios', () => {
    it('SOXL target 150 at 146 (near)', () => {
      const result = calculateDistance('target', 150, 146);
      expect(result.status).toBe('near');
      expect(result.pct).toBeCloseTo(-2.67, 2);
    });

    it('AVL target 35.44 at 35.44 (hit)', () => {
      const result = calculateDistance('target', 35.44, 35.44);
      expect(result.status).toBe('hit');
    });

    it('SMH stop 561.92 at 565 (near)', () => {
      const result = calculateDistance('stop', 561.92, 565);
      expect(result.status).toBe('near');
    });

    it('SMH no-add-below 585.33 at 587 (near)', () => {
      const result = calculateDistance('no-add-below', 585.33, 587);
      expect(result.status).toBe('near');
    });
  });
});

describe('Alert Deduplication', () => {
  // Mock notification log
  const notificationLog = new Map<string, Set<string>>();

  function hasBeenNotified(ruleId: string, eventType: string): boolean {
    return notificationLog.get(ruleId)?.has(eventType) ?? false;
  }

  function logNotification(ruleId: string, eventType: string): void {
    if (!notificationLog.has(ruleId)) {
      notificationLog.set(ruleId, new Set());
    }
    notificationLog.get(ruleId)!.add(eventType);
  }

  it('should allow first notification', () => {
    const ruleId = 'rule-1';
    const eventType = 'near';

    expect(hasBeenNotified(ruleId, eventType)).toBe(false);
  });

  it('should prevent duplicate notifications', () => {
    const ruleId = 'rule-2';
    const eventType = 'near';

    logNotification(ruleId, eventType);
    expect(hasBeenNotified(ruleId, eventType)).toBe(true);

    // Attempting to log again should still show as already notified
    expect(hasBeenNotified(ruleId, eventType)).toBe(true);
  });

  it('should allow different event types for same rule', () => {
    const ruleId = 'rule-3';

    logNotification(ruleId, 'near');
    expect(hasBeenNotified(ruleId, 'near')).toBe(true);
    expect(hasBeenNotified(ruleId, 'hit')).toBe(false);

    logNotification(ruleId, 'hit');
    expect(hasBeenNotified(ruleId, 'hit')).toBe(true);
  });

  it('should handle multiple rules independently', () => {
    logNotification('rule-4', 'near');
    logNotification('rule-5', 'near');

    expect(hasBeenNotified('rule-4', 'near')).toBe(true);
    expect(hasBeenNotified('rule-5', 'near')).toBe(true);
    expect(hasBeenNotified('rule-6', 'near')).toBe(false);
  });
});
