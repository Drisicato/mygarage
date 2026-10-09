import { describe, expect, it } from 'vitest'
import { firstImageFile, googleImageSearchUrl, supplyImageUrl } from '../supplyImage'

describe('googleImageSearchUrl', () => {
  it('searches Google Images for the name and part number together', () => {
    const url = googleImageSearchUrl('Oil Filter', 'PH3593A')
    expect(url).toBe('https://www.google.com/search?tbm=isch&q=Oil%20Filter%20PH3593A')
  })

  it('works from a part number alone and trims blanks', () => {
    expect(googleImageSearchUrl('  ', ' 04152-YZZA1 ')).toBe(
      'https://www.google.com/search?tbm=isch&q=04152-YZZA1',
    )
  })

  it('encodes characters that would break the query', () => {
    expect(googleImageSearchUrl('Brake pads & rotors', null)).toContain('Brake%20pads%20%26%20rotors')
  })

  it('has nothing to search for without a name or part number', () => {
    expect(googleImageSearchUrl('', undefined)).toBeNull()
    expect(googleImageSearchUrl(' ', ' ')).toBeNull()
  })
})

describe('supplyImageUrl', () => {
  it('points at the supply image and versions it', () => {
    expect(supplyImageUrl(7)).toMatch(/\/api\/supplies\/7\/image$/)
    expect(supplyImageUrl(7, '2026-10-09T10:00:00')).toMatch(/\/image\?v=2026-10-09T10%3A00%3A00$/)
  })
})

describe('firstImageFile', () => {
  it('picks the first image and skips other files', () => {
    const text = new File(['x'], 'a.txt', { type: 'text/plain' })
    const png = new File(['x'], 'b.png', { type: 'image/png' })
    expect(firstImageFile([text, png] as unknown as FileList)).toBe(png)
  })

  it('returns null when there is no image', () => {
    expect(firstImageFile(null)).toBeNull()
    expect(firstImageFile([] as unknown as FileList)).toBeNull()
  })
})
