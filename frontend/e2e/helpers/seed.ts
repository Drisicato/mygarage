// frontend/e2e/helpers/seed.ts
//
// Shared register/login/seed/authenticate flow used by BOTH the root
// (`global.setup.ts`) and the prefixed (`subpath.setup.ts`) Playwright
// projects (#107). The two projects differ only in where the API lives and
// where the auth cookie is scoped — everything else is identical, so the
// hardcoded `localhost:8686` that used to live in `global.setup.ts` is now a
// parameter (`apiBase`) and the subpath project drives its seed through the
// prefix-stripping proxy (`http://127.0.0.1:3001/mygarage/api`).

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type APIRequestContext, type Page, expect } from '@playwright/test'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** A real PNG so the backend's Pillow thumbnail step succeeds on upload. */
const SAMPLE_PHOTO = path.resolve(HERE, '../../public/icon-192.png')

export const ADMIN = {
  username: 'e2e-admin',
  email: 'e2e@mygarage.dev',
  password: 'E2eTest!ng123',
  full_name: 'E2E Test Admin',
}

/**
 * A real admin session, for a spec that has to drive the API directly.
 *
 * A second hand-rolled login inside a spec is how `forms.ts` grew a helper that
 * PATCHed a route which never existed, so session handling lives here beside
 * the credentials it uses.
 */
export interface AdminSession {
  /** Cookie + CSRF headers to attach to an API call. */
  headers: Record<string, string>
  accessToken: string
  csrfToken: string
}

/**
 * Recover the session `seedAndAuthenticate` already established, WITHOUT
 * logging in again.
 *
 * ★ `/api/auth/login` IS RATE LIMITED TO FIVE ATTEMPTS A MINUTE PER IP
 * (`rate_limit_auth`), and the whole suite runs from one address in well under
 * a minute. `auth.spec.ts` spends two of those on purpose (a good login and a
 * bad one) and the setup project spends a third, so a spec that logs in for its
 * own setup passes when run alone and 429s in the full suite. That failure
 * arrives as "Login failed: 429" from a helper, which reads as a broken helper
 * rather than as a budget.
 *
 * The cookie in `storageState` is a bearer token that is still valid, and
 * `GET /auth/csrf-token` mints a fresh CSRF token from it with no limiter
 * attached. So a spec needing API credentials takes them from the session that
 * already exists rather than making a new one.
 *
 * @param request Any Playwright request context.
 * @param apiBase Absolute API root, e.g. `http://localhost:8686/api`.
 * @param authFile The storageState file `seedAndAuthenticate` wrote.
 * @returns The session, with the headers an API call needs.
 */
export async function adminSessionFromStorageState(
  request: APIRequestContext,
  apiBase: string,
  authFile: string,
): Promise<AdminSession> {
  const state = JSON.parse(readFileSync(authFile, 'utf8')) as {
    cookies?: { name: string; value: string }[]
  }
  const cookie = (state.cookies ?? []).find((entry) => entry.name === 'mygarage_token')
  if (cookie === undefined) {
    throw new Error(`No mygarage_token cookie in ${authFile}; did the setup project run?`)
  }
  const cookieHeader = `mygarage_token=${cookie.value}`

  const csrfResp = await request.get(`${apiBase}/auth/csrf-token`, {
    headers: { Cookie: cookieHeader },
  })
  expect(csrfResp.ok(), `CSRF refresh failed: ${csrfResp.status()}`).toBeTruthy()
  const csrfToken: string | null = (await csrfResp.json()).csrf_token
  // Null here means the cookie was not accepted (expired, or `auth_mode=none`),
  // which would otherwise surface much later as an unexplained 401.
  expect(csrfToken, 'the stored session did not yield a CSRF token').toBeTruthy()

  return {
    headers: { Cookie: cookieHeader, 'X-CSRF-Token': csrfToken ?? '' },
    accessToken: cookie.value,
    csrfToken: csrfToken ?? '',
  }
}

/**
 * Log the seeded admin in over the API.
 *
 * Spends one of the five-per-minute auth attempts, so it is deliberately NOT
 * exported: `adminSessionFromStorageState` is what a spec should use.
 *
 * @param request Any Playwright request context.
 * @param apiBase Absolute API root, e.g. `http://localhost:8686/api`.
 * @returns The session, with the headers an API call needs.
 */
async function loginAsAdmin(
  request: APIRequestContext,
  apiBase: string,
): Promise<AdminSession> {
  const loginResp = await request.post(`${apiBase}/auth/login`, {
    data: { username: ADMIN.username, password: ADMIN.password },
  })
  expect(loginResp.ok(), `Login failed: ${loginResp.status()}`).toBeTruthy()
  const loginData = await loginResp.json()
  return {
    headers: {
      Cookie: `mygarage_token=${loginData.access_token}`,
      'X-CSRF-Token': loginData.csrf_token,
    },
    accessToken: loginData.access_token,
    csrfToken: loginData.csrf_token,
  }
}

/** Seeded test vehicle used by workflow specs (records, tabs, archive). */
export const TEST_VEHICLE = {
  vin: 'TEST0000000000001',
  nickname: 'E2E Test Car',
  vehicle_type: 'Car' as const,
  year: 2022,
  make: 'TestMake',
  model: 'TestModel',
  color: 'Blue',
}

export interface SeedOptions {
  /** Absolute API root, e.g. `http://localhost:8686/api` (no trailing slash). */
  apiBase: string
  /** Cookie domain the browser context is served from, e.g. `localhost`. */
  cookieDomain: string
  /** storageState output path, e.g. `./e2e/.auth/user.json`. */
  authFile: string
  /**
   * When true, also upload a main photo and seed a fuel fill-up so the subpath
   * specs can assert a `<img>` and a Recharts chart render under the prefix.
   */
  seedMedia?: boolean
}

/**
 * Register the first (admin) user, enable local auth, seed the test vehicle,
 * optionally seed media/fuel, set the JWT cookie, and persist storage state.
 * Idempotent so the suite can be re-run against a warm DB.
 */
export async function seedAndAuthenticate(
  page: Page,
  request: APIRequestContext,
  opts: SeedOptions,
): Promise<void> {
  const { apiBase, cookieDomain, authFile } = opts

  // Step 1: Register first user (auto-admin). 201 = created, 403 = exists.
  const regResp = await request.post(`${apiBase}/auth/register`, {
    data: {
      username: ADMIN.username,
      email: ADMIN.email,
      password: ADMIN.password,
      full_name: ADMIN.full_name,
    },
  })
  expect([201, 403]).toContain(regResp.status())

  // Step 2: Login for JWT + CSRF token.
  const session = await loginAsAdmin(request, apiBase)
  const authHeaders = session.headers

  // Step 3: Enable local auth mode (fresh DB defaults to "none").
  const authModeResp = await request.put(`${apiBase}/settings/auth_mode`, {
    data: { value: 'local' },
    headers: authHeaders,
  })
  expect(authModeResp.ok(), `Set auth_mode failed: ${authModeResp.status()}`).toBeTruthy()

  // Step 4: Seed the test vehicle (idempotent).
  const vehicleResp = await request.post(`${apiBase}/vehicles`, {
    data: TEST_VEHICLE,
    headers: authHeaders,
  })
  expect(
    [201, 400, 409, 422].includes(vehicleResp.status()),
    `Seed vehicle failed: ${vehicleResp.status()} ${await vehicleResp.text()}`,
  ).toBeTruthy()

  // Step 4b: Ensure the user language is English (i18n specs may change it).
  const langResp = await request.put(`${apiBase}/auth/me`, {
    data: { language: 'en' },
    headers: authHeaders,
  })
  expect(langResp.ok(), `Set language failed: ${langResp.status()}`).toBeTruthy()

  // Step 4c (subpath only): seed a main photo + a fuel fill-up so the prefixed
  // specs have a real `<img>` and Recharts chart to assert against.
  if (opts.seedMedia) {
    await seedMainPhoto(request, apiBase, authHeaders)
    await seedFuelRecord(request, apiBase, authHeaders)
  }

  // Step 5: Set the JWT cookie on the browser context (path '/' works under a
  // prefix — the proxy strips it before the cookie is ever sent upstream).
  await page.context().addCookies([
    {
      name: 'mygarage_token',
      value: session.accessToken,
      domain: cookieDomain,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ])

  // Step 6: CSRF token + English locale. Navigate with a RELATIVE '.' so it
  // resolves to the project baseURL's directory (root -> `/`, subpath ->
  // `.../mygarage/`). A root-absolute '/' would escape the `/mygarage/` prefix.
  await page.goto('.')
  await page.evaluate((token: string) => {
    sessionStorage.setItem('csrf_token', token)
    localStorage.setItem('i18nextLng', 'en')
  }, session.csrfToken)

  // Step 7: Verify auth works (reload to pick up English locale).
  await page.goto('.')
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible({
    timeout: 15000,
  })

  await page.context().storageState({ path: authFile })
}

/** Upload a main photo for the test vehicle (idempotent-ish; extra rows ok). */
async function seedMainPhoto(
  request: APIRequestContext,
  apiBase: string,
  authHeaders: Record<string, string>,
): Promise<void> {
  const resp = await request.post(`${apiBase}/vehicles/${TEST_VEHICLE.vin}/photos`, {
    headers: authHeaders,
    multipart: {
      file: {
        name: 'seed.png',
        mimeType: 'image/png',
        buffer: readFileSync(SAMPLE_PHOTO),
      },
      set_as_main: 'true',
    },
  })
  // 201 = created; 409 = already exists on rerun.
  expect(
    [201, 409].includes(resp.status()),
    `Seed photo failed: ${resp.status()} ${await resp.text()}`,
  ).toBeTruthy()
}

/** Seed a single fuel fill-up with a cost so garage analytics has chart data. */
async function seedFuelRecord(
  request: APIRequestContext,
  apiBase: string,
  authHeaders: Record<string, string>,
): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
  const resp = await request.post(`${apiBase}/vehicles/${TEST_VEHICLE.vin}/fuel`, {
    headers: authHeaders,
    data: {
      // `vin` is a REQUIRED body field on FuelRecordCreate (17 chars), separate
      // from the path param. Omitting it 422s, silently leaving analytics with
      // no cost data — which the garage-analytics reskin's cost-conditional
      // charts then render empty. Keep it in the body.
      vin: TEST_VEHICLE.vin,
      date: today,
      odometer_km: '48280',
      liters: '47.318',
      cost: '43.75',
      is_full_tank: true,
    },
  })
  // 201 = created; 409 tolerated on rerun (duplicate). A 400/422 is a real
  // validation failure we must NOT swallow — it leaves analytics cost-free.
  expect(
    [201, 409].includes(resp.status()),
    `Seed fuel failed: ${resp.status()} ${await resp.text()}`,
  ).toBeTruthy()
}

/**
 * A VIN no earlier run has used: 17 characters, none of them I, O or Q (VIN
 * validation rejects those).
 *
 * Fresh per call because the e2e backend and its database outlive a local run
 * (`reuseExistingServer`), so a fixed VIN finds last run's vehicle, tires and
 * pairing still there.
 *
 * @param prefix A few letters that say which spec made it.
 * @returns The VIN.
 */
export function randomVin(prefix: string): string {
  const noise = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  return (prefix + noise.toUpperCase()).replace(/[IOQ]/g, 'X').padEnd(17, '0').slice(0, 17)
}

/** Fields a spec sets on a vehicle it seeds. */
export interface VehicleSeed {
  vin: string
  nickname: string
  vehicle_type: string
  year: number
  make: string
  model: string
}

/** Fields a spec sets on an address-book entry it seeds. */
export interface AddressBookSeed {
  business_name: string
  address?: string
  city?: string
  state?: string
  phone?: string
  category?: string
  poi_category?: string
}

/**
 * Seeds rows through the API and remembers them, so `cleanup` can delete every
 * one, including the vendor an address-book create quietly syncs.
 */
export interface SeedLedger {
  /** Create a vehicle; returns its VIN. Deleted (with everything under it) by `cleanup`. */
  vehicle(data: VehicleSeed): Promise<string>
  /** Create an address-book entry; returns its id. Its vendor twin goes in `cleanup` too. */
  addressBookEntry(data: AddressBookSeed): Promise<number>
  /** POST something under a seeded vehicle (a tire, a pairing), expecting a 201. */
  post(path: string, data: Record<string, unknown>): Promise<Record<string, unknown>>
  /** GET a path as the admin and return the JSON body. */
  get(path: string): Promise<Record<string, unknown>>
  /** Delete everything this ledger made. Tries every row before failing. */
  cleanup(): Promise<void>
}

/**
 * A ledger for one spec file's seeded rows.
 *
 * Seeded rows aren't tidiness, they're other specs' inputs: an extra vehicle on
 * the dashboard is a strict-mode failure in `vehicle.spec.ts`, and an extra
 * address-book entry with the same name doubles an autocomplete option. So
 * every row goes in here and `cleanup` takes them all back out.
 *
 * @param request A request context that outlives the tests (made in beforeAll).
 * @param apiBase Absolute API root, e.g. `http://localhost:3000/api`.
 * @param headers The admin's cookie + CSRF headers.
 * @returns The ledger.
 */
export function seedLedger(
  request: APIRequestContext,
  apiBase: string,
  headers: Record<string, string>,
): SeedLedger {
  const vins: string[] = []
  const entryIds: number[] = []
  const vendorNames: string[] = []

  /**
   * Delete entries (and their vendor twins) a killed run left under this name.
   *
   * A failed delete fails here, not later as a duplicate option in some spec.
   * No 404 allowance: the id comes from a list made a moment ago and the suite
   * runs on one worker, so nothing else can have deleted it.
   */
  async function purgeName(name: string): Promise<void> {
    const entries = await request.get(
      `${apiBase}/address-book?search=${encodeURIComponent(name)}`,
      { headers },
    )
    expect(entries.ok(), `list address book: ${entries.status()}`).toBeTruthy()
    for (const entry of (await entries.json()).entries as { id: number; business_name: string }[]) {
      if (entry.business_name === name) {
        const gone = await request.delete(`${apiBase}/address-book/${entry.id}`, { headers })
        expect(gone.ok(), `purge address book ${entry.id} (${name}): ${gone.status()}`).toBeTruthy()
      }
    }
    expect(await deleteVendorsNamed(name), `purge vendors named ${name}`).toEqual([])
  }

  /** The address-book create syncs a vendor for anything that isn't a gas station. */
  async function deleteVendorsNamed(name: string): Promise<string[]> {
    const failures: string[] = []
    const vendors = await request.get(`${apiBase}/vendors?search=${encodeURIComponent(name)}`, {
      headers,
    })
    if (!vendors.ok()) return [`list vendors ${name}: ${vendors.status()}`]
    for (const vendor of (await vendors.json()).vendors as { id: number; name: string }[]) {
      if (vendor.name.toLowerCase() !== name.toLowerCase()) continue
      const gone = await request.delete(`${apiBase}/vendors/${vendor.id}`, { headers })
      if (!gone.ok() && gone.status() !== 404) failures.push(`vendor ${vendor.id}: ${gone.status()}`)
    }
    return failures
  }

  return {
    async vehicle(data: VehicleSeed): Promise<string> {
      const made = await request.post(`${apiBase}/vehicles`, { headers, data })
      expect(made.status(), `seed vehicle ${data.vin}: ${await made.text()}`).toBe(201)
      vins.push(data.vin)
      return data.vin
    },

    async addressBookEntry(data: AddressBookSeed): Promise<number> {
      await purgeName(data.business_name)
      const made = await request.post(`${apiBase}/address-book`, { headers, data })
      expect(made.status(), `seed address book ${data.business_name}: ${await made.text()}`).toBe(201)
      const id = (await made.json()).id as number
      entryIds.push(id)
      vendorNames.push(data.business_name)
      return id
    },

    async post(path: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
      const made = await request.post(`${apiBase}${path}`, { headers, data })
      expect(made.status(), `POST ${path}: ${await made.text()}`).toBe(201)
      return (await made.json()) as Record<string, unknown>
    },

    async get(path: string): Promise<Record<string, unknown>> {
      const got = await request.get(`${apiBase}${path}`, { headers })
      expect(got.ok(), `GET ${path}: ${got.status()} ${await got.text()}`).toBeTruthy()
      return (await got.json()) as Record<string, unknown>
    },

    async cleanup(): Promise<void> {
      const failures: string[] = []
      // Newest first: a trailer is paired to the tow vehicle seeded before it.
      for (const vin of [...vins].reverse()) {
        const gone = await request.delete(`${apiBase}/vehicles/${vin}`, { headers })
        if (!gone.ok() && gone.status() !== 404) failures.push(`vehicle ${vin}: ${gone.status()}`)
      }
      // After the vehicles, so nothing still points at an entry (a fill-up's station).
      for (const id of entryIds) {
        const gone = await request.delete(`${apiBase}/address-book/${id}`, { headers })
        if (!gone.ok() && gone.status() !== 404) failures.push(`address book ${id}: ${gone.status()}`)
      }
      for (const name of vendorNames) failures.push(...(await deleteVendorsNamed(name)))
      vins.length = 0
      entryIds.length = 0
      vendorNames.length = 0
      expect(failures, 'cleanup left rows behind').toEqual([])
    },
  }
}
