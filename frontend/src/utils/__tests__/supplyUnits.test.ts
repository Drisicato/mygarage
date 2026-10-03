import { describe, expect, it } from 'vitest'

import { canonicalToDisplay, displayToCanonical, supplyUnitLabel, unitCostToDisplay } from '../supplyUnits'

describe('supplyUnits', () => {
  it('round-trips liters↔quarts for imperial volume', () => {
    const qt = canonicalToDisplay(1, 'volume', 'imperial')
    expect(qt).toBeCloseTo(1.05669, 4)
    expect(displayToCanonical(qt, 'volume', 'imperial')).toBeCloseTo(1, 6)
  })

  it('is identity for metric volume and for count', () => {
    expect(canonicalToDisplay(2, 'volume', 'metric')).toBe(2)
    expect(canonicalToDisplay(3, 'count', 'imperial')).toBe(3)
  })

  it('displayToCanonical is identity for metric volume and for count', () => {
    expect(displayToCanonical(2, 'volume', 'metric')).toBe(2)
    expect(displayToCanonical(3, 'count', 'imperial')).toBe(3)
  })

  describe('unitCostToDisplay', () => {
    // 5 qt bought for $25 is stored as 4.732 L, so the API's average is per litre.
    const perLitre = String(25 / 4.732)

    it('prices a quart, not a litre, for imperial volume', () => {
      expect(unitCostToDisplay(perLitre, 'volume', 'imperial')).toBeCloseTo(5, 3)
    })

    it('leaves metric volume and count costs alone', () => {
      expect(unitCostToDisplay(perLitre, 'volume', 'metric')).toBeCloseTo(5.2832, 4)
      expect(unitCostToDisplay('3.5', 'count', 'imperial')).toBe(3.5)
    })

    it('keeps a missing cost missing', () => {
      expect(unitCostToDisplay(null, 'volume', 'imperial')).toBeNull()
      expect(unitCostToDisplay(undefined, 'volume', 'imperial')).toBeNull()
    })
  })

  describe('supplyUnitLabel', () => {
    it('returns qt for imperial volume', () => {
      expect(supplyUnitLabel('volume', 'imperial')).toBe('qt')
    })

    it('returns L for metric volume', () => {
      expect(supplyUnitLabel('volume', 'metric')).toBe('L')
    })

    it('returns empty string for count regardless of system', () => {
      expect(supplyUnitLabel('count', 'imperial')).toBe('')
      expect(supplyUnitLabel('count', 'metric')).toBe('')
    })
  })
})
