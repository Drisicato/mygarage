/**
 * Saving a search result posts the Address Book chip for its POI type.
 *
 * It used to post category 'service' for everything, lowercase, so a saved
 * gas station matched no chip and an EV charger read as a service (#194).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '../../__tests__/test-utils'

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/services/api', () => ({ default: { get, post } }))
vi.mock('@/components/MapDisplay', () => ({ default: () => null }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, user: {}, isAdmin: false, authMode: 'local' }),
}))
vi.mock('@/components/poi/PoiProvidersDrawer', () => ({ default: () => null }))

import POIFinder from '../POIFinder'

function grantLocation(): void {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { latitude: 10, longitude: 20 } } as GeolocationPosition),
    },
  })
}

// axios JSON-serializes the body, which drops undefined keys, so read it the
// way it goes over the wire.
function saveBody(): Record<string, unknown> {
  const call = post.mock.calls.find(([url]) => url === '/poi/save')
  expect(call).toBeDefined()
  return JSON.parse(JSON.stringify(call?.[1])) as Record<string, unknown>
}

async function searchAndSave(poiCategory: string): Promise<void> {
  post.mockImplementation((url: string) =>
    Promise.resolve(
      url === '/poi/search'
        ? {
            data: {
              results: [
                {
                  business_name: 'Found Place',
                  latitude: '10',
                  longitude: '20',
                  poi_category: poiCategory,
                  source: 'osm',
                  external_id: 'osm-1',
                  distance_meters: 500,
                },
              ],
              source: 'osm',
            },
          }
        : { data: {} }
    )
  )
  render(<POIFinder />)
  fireEvent.click(await screen.findByText('poiFinder.useMyLocation'))
  fireEvent.click(await screen.findByRole('button', { name: 'poiCard.saveToAddressBook' }))
  await waitFor(() => expect(post).toHaveBeenCalledWith('/poi/save', expect.anything()))
}

beforeEach(() => {
  vi.clearAllMocks()
  get.mockResolvedValue({ data: { recommendations: [] } })
  grantLocation()
})

describe('POIFinder save', () => {
  it.each([
    ['gas_station', 'Gas Station'],
    ['auto_shop', 'Service'],
    ['rv_shop', 'RV Park'],
  ])('posts the chip for %s, and its POI type', async (poiCategory, chip) => {
    await searchAndSave(poiCategory)
    expect(saveBody().category).toBe(chip)
    expect(saveBody().poi_category).toBe(poiCategory)
  })

  it('posts no category for an EV charger, which has no chip', async () => {
    await searchAndSave('ev_charging')
    expect('category' in saveBody()).toBe(false)
    expect(saveBody().poi_category).toBe('ev_charging')
  })
})
