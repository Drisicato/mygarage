import { describe, expect, it } from 'vitest'
import { isWebUrl, partSearchLinks, partSearchQuery } from '../partSearch'

const vehicle = { year: 2014, make: 'Ford', model: 'F-150' }

describe('partSearchQuery', () => {
  it('joins the part number and the vehicle', () => {
    expect(partSearchQuery(' WP-1234 ', vehicle)).toBe('WP-1234 2014 Ford F-150')
  })

  it('skips what the vehicle does not have', () => {
    expect(partSearchQuery('WP-1234', { make: 'Ford', model: null })).toBe('WP-1234 Ford')
    expect(partSearchQuery('WP-1234')).toBe('WP-1234')
  })
})

describe('partSearchLinks', () => {
  it('offers no links for a blank part number', () => {
    expect(partSearchLinks('   ', vehicle)).toEqual([])
  })

  it('links every site, encoding the query', () => {
    const links = Object.fromEntries(partSearchLinks('A&B 12', vehicle).map((l) => [l.site, l.url]))
    expect(Object.keys(links)).toEqual(['google', 'rockauto', 'amazon', 'ebay'])
    expect(links.google).toBe('https://www.google.com/search?q=A%26B%2012%202014%20Ford%20F-150')
    expect(links.amazon).toBe('https://www.amazon.com/s?k=A%26B%2012%202014%20Ford%20F-150')
    expect(links.ebay).toBe('https://www.ebay.com/sch/i.html?_nkw=A%26B%2012%202014%20Ford%20F-150')
  })

  it('searches RockAuto by the part number alone', () => {
    const rockauto = partSearchLinks('A&B 12', vehicle).find((l) => l.site === 'rockauto')
    expect(rockauto?.url).toBe('https://www.rockauto.com/en/partsearch/?partnum=A%26B%2012')
  })
})

describe('isWebUrl', () => {
  it.each([
    ['https://www.rockauto.com/x', true],
    [' http://example.com ', true],
    ['javascript:alert(1)', false],
    ['www.example.com', false],
    ['https://', false],
    ['', false],
  ])('%s -> %s', (text, expected) => {
    expect(isWebUrl(text)).toBe(expected)
  })
})
