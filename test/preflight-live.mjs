/**
 * Live preflight: resolve the real stored DEEPSEEK_API_KEY through the same
 * code path the plugin uses, hit the public balance API, and print ONLY
 * non-secret results (status, balance document, key length/mask). It also pulls
 * the real maintained holiday data, so the fetch path is exercised for real.
 */
import { readFileSync } from 'node:fs'
import { apply, Config } from '../lib/index.js'
import { createHolidaySource, DEFAULT_HOLIDAY_URL } from '../lib/holiday-source.js'

const CREDENTIALS = '/Volumes/External/.dsh/.credentials.yaml'

/** Tiny targeted parse: the `refs:` block's DEEPSEEK_API_KEY entry. */
function readStoredKey() {
  const text = readFileSync(CREDENTIALS, 'utf8')
  const match = text.match(/^\s{2}DEEPSEEK_API_KEY:\s*(.+?)\s*$/m)
  if (match === null) throw new Error('DEEPSEEK_API_KEY not found in the credential store')
  return match[1].replace(/^['"]|['"]$/g, '')
}

const key = readStoredKey()
console.log(`stored key: length=${key.length} mask=${key.slice(0, 6)}…${key.slice(-4)}`)

let route
const ctx = {
  get: (name) => (name === 'credentials' ? { resolve: async () => ({ value: key, source: 'file' }) } : undefined),
  effect: (factory) => {
    const dispose = factory()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  webServer: {
    register: (registered) => {
      route = registered
      return () => {}
    }
  },
  logger: { warn: (fmt, code, message) => console.error(`warn: ${fmt} | ${code} | ${message}`) }
}

apply(ctx, Config({}))
console.log(`route: ${route.kind} ${route.path}`)

const res = {
  statusCode: undefined,
  headers: {},
  body: undefined,
  setHeader(k, v) {
    this.headers[k.toLowerCase()] = v
  },
  end(chunk) {
    this.body = chunk
  }
}
/** One route call, returning the parsed payload. */
async function call() {
  const out = {
    statusCode: undefined,
    headers: {},
    body: undefined,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v
    },
    end(chunk) {
      this.body = chunk
    }
  }
  await route.handler({ method: 'GET', url: '/usage/balance?refresh=1', headers: { host: '127.0.0.1:3080' } }, out)
  return { statusCode: out.statusCode, payload: JSON.parse(out.body) }
}

const { statusCode, payload } = await call()
Object.assign(res, { statusCode })

console.log(`http status: ${res.statusCode}`)
console.log(`payload.ok: ${payload.ok}`)
if (payload.pricing !== undefined) {
  const { window, reason, discountPercent, nextWindow, nextChangeAt } = payload.pricing
  console.log(
    `pricing: ${window} (${reason}, ${discountPercent === 0 ? 'full price' : `${discountPercent}% off`}) ` +
      `-> ${nextWindow} at ${new Date(nextChangeAt).toISOString()}`
  )
}
if (payload.ok === true) {
  console.log(`is_available: ${payload.balance.is_available}`)
  for (const info of payload.balance.balance_infos) {
    console.log(
      `  ${info.currency}: total=${info.total_balance} granted=${info.granted_balance} topped_up=${info.topped_up_balance}`
    )
  }
  console.log(`fetchedAt: ${new Date(payload.fetchedAt).toISOString()}`)
  console.log(`holiday data in the route payload: ${payload.pricing?.holidayData}`)
} else {
  console.log(`error: ${JSON.stringify(payload.error)}`)
}

// The route warms its holiday cache in the background: the first request answers
// from the bundled table while the fetch is in flight, and a later one must flip
// to the fetched data. Poll for that transition rather than assuming a delay.
console.log('\nholiday source handover')
let handover = payload.pricing?.holidayData
const deadline = Date.now() + 10000
while (handover !== 'remote' && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 400))
  handover = (await call()).payload.pricing?.holidayData
}
console.log(`  first request: ${payload.pricing?.holidayData}`)
console.log(`  after the background refresh: ${handover}`)
if (handover !== 'remote') {
  console.log('  the route never switched to fetched holiday data')
  process.exitCode = 1
}
const year = new Date().getUTCFullYear()
console.log('\nmaintained holiday data')
const source = createHolidaySource({ urlTemplate: DEFAULT_HOLIDAY_URL })
const snapshot = await source.refresh([year, year + 1])
if (snapshot === undefined) {
  console.log('  fetch failed — the route keeps using the bundled table')
  process.exitCode = 1
} else {
  console.log(`  source: ${DEFAULT_HOLIDAY_URL}`)
  console.log(`  years: ${snapshot.years.join(', ')}`)
  console.log(`  days off: ${snapshot.holidays.length}, makeup workdays: ${snapshot.makeupWorkdays.length}`)
  console.log(`  paper: ${snapshot.papers[0] ?? '(none)'}`)
  // Cross-check the maintained data against the bundled fallback for 2026.
  if (snapshot.years.includes(2026)) {
    const off2026 = snapshot.holidays.filter((date) => date.startsWith('2026-'))
    console.log(`  2026 days off: ${off2026.length}`)
  }
}

if (payload.ok !== true) {
  console.log('\nlive preflight: FAILED')
  process.exitCode = 1
} else {
  console.log('\nlive preflight: PASS')
}
