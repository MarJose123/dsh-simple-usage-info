/**
 * dsh-simple-usage-info — host (Node) half.
 *
 * Registers one exact read-only HTTP route on the Web GUI's server. The route
 * resolves the same credential the shipped `deepseek-official` model route uses
 * (`DEEPSEEK_API_KEY`, through the credentials service) and asks the public
 * DeepSeek balance API for the account balance, then answers the browser half
 * with plain JSON. The key never leaves this process.
 *
 * Route: GET /usage/balance
 *   200 { ok: true,  balance: { is_available, balance_infos: [...] }, pricing, fetchedAt }
 *   200 { ok: false, error: { code, message }, pricing, fetchedAt }
 *   403 when the request's Host header is not a loopback host
 *   405 for any other method.
 *
 * `pricing` is computed fresh on every request from the server clock; only the
 * upstream balance call is cached.
 *
 * The route is registered directly on the WebServer, so it sits outside the
 * Web GUI's `/api` authentication fence. It answers loopback hosts only (and
 * anything when the operator deliberately binds `0.0.0.0`), which blocks a
 * malicious page from reading the balance through DNS rebinding, and it never
 * returns key material — only the numbers the DeepSeek API reports.
 *
 * The route is deliberately cache-backed: the browser half polls it, and
 * `refreshMs` bounds how often the upstream API is actually called.
 *
 * @module dsh-simple-usage-info
 */
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { normalizeSchedule, readPricing, withHolidayData } from './pricing.js'
import { createHolidaySource, DEFAULT_HOLIDAY_URL } from './holiday-source.js'

/** Cordis plugin name. */
export const name = 'dsh-simple-usage-info'

/** The WebServer must exist before the balance route can register. */
export const inject = ['webServer']

/**
 * The one route path this plugin owns. The browser half hard-codes the same
 * constant, so it is exported rather than configurable.
 */
export const BALANCE_PATH = '/usage/balance'

/** Plugin configuration, validated by Schemastery. */
export const Config = z.object({
  /** DeepSeek API origin; the balance endpoint lives at its root. */
  baseURL: z.string().default('https://api.deepseek.com'),
  /** Credential-reference name holding the API key. */
  apiKeyEnv: z.string().role('credential-ref').default('DEEPSEEK_API_KEY'),
  /** How long one upstream balance answer stays fresh. */
  refreshMs: z.number().default(60000),
  /** Upstream request timeout. */
  timeoutMs: z.number().default(15000),
  /** Peak-rate windows as `HH:MM-HH:MM` UTC; everything else is off-peak. */
  peakWindows: z.array(z.string()).default(['01:00-04:00', '06:00-10:00']),
  /** Peak weekdays, 0 = Sunday through 6 = Saturday. */
  peakDays: z.array(z.number()).default([1, 2, 3, 4, 5]),
  /** Extra `YYYY-MM-DD` UTC dates priced off-peak in full, on top of the fetched holidays. */
  holidays: z.array(z.string()).default([]),
  /** Extra `YYYY-MM-DD` UTC makeup workdays; only meaningful with `makeupWorkdaysArePeak`. */
  makeupWorkdays: z.array(z.string()).default([]),
  /**
   * Treat 调休 makeup workdays as peak days. The published rule says "Monday
   * through Friday", which makes them off-peak, so this defaults off.
   */
  makeupWorkdaysArePeak: z.boolean().default(false),
  /**
   * Where to read the maintained Chinese holiday data; `{year}` is substituted.
   * Leave the URL empty to stay offline and use the bundled table.
   */
  holidayURL: z.string().default(DEFAULT_HOLIDAY_URL),
  /** How long one fetched holiday snapshot stays fresh. */
  holidayRefreshMs: z.number().default(43200000),
  /** Merge the bundled State Council holiday table as a fallback; false leaves only `holidays`. */
  useBundledHolidays: z.boolean().default(true),
  /** Off-peak discount, as a percentage of the peak rate. */
  offPeakDiscountPercent: z.number().default(50)
})

/** A forced refresh may never hit the network more often than this. */
const MIN_REFRESH_MS = 5000

/** Hostnames that can only mean the local machine. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * Whether a request's `Host` header is one this route answers.
 *
 * The route lives outside the GUI's `/api` auth fence, so without this check a
 * malicious page could use DNS rebinding to read the balance from
 * `http://127.0.0.1:<port>/usage/balance`. A deliberate `0.0.0.0` bind is the
 * operator's stated intent to expose the server, so that posture answers any
 * host.
 * @param hostHeader - the raw `Host` header.
 * @param bindHost - the WebServer's configured bind host.
 * @returns true when the request may be answered.
 */
function hostAllowed(hostHeader, bindHost) {
  if (bindHost === '0.0.0.0') return true
  if (typeof hostHeader !== 'string' || hostHeader === '') return false
  const closing = hostHeader.startsWith('[') ? hostHeader.indexOf(']') : -1
  const hostname = closing >= 0 ? hostHeader.slice(0, closing + 1) : hostHeader.split(':', 1)[0]
  return LOOPBACK_HOSTS.has(hostname.toLowerCase())
}

/** Write one JSON response. `no-store` keeps browsers from caching a balance. */
function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

/** An error carrying a stable machine-readable code for the browser half. */
function taggedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/**
 * Resolve the API key exactly the way `@deepseek-ai/dsh-llm-deepseek-api-key`
 * does: the credentials seam first (which itself layers the launch environment),
 * then the raw launch environment when no seam is mounted.
 * @param ctx - host plugin context.
 * @param config - validated plugin configuration.
 * @returns the secret key value.
 */
async function resolveApiKey(ctx, config) {
  const ref = credentialRef(config.apiKeyEnv)
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    const hit = await credentials.resolve(ref)
    if (hit !== undefined && hit.value.length > 0) return hit.value
  }
  const ambient = launchEnvironmentOf(ctx).get(ref)
  if (ambient !== undefined && ambient.value.length > 0) return ambient.value
  throw taggedError(
    'missing-credential',
    `no API key behind ${String(ref)}; store it through the credentials service or export it before launching dsh`
  )
}

/**
 * Read the account balance from the public DeepSeek API.
 * @param ctx - host plugin context.
 * @param config - validated plugin configuration.
 * @returns the parsed balance document.
 */
async function fetchBalance(ctx, config) {
  const key = await resolveApiKey(ctx, config)
  const url = `${config.baseURL.replace(/\/+$/, '')}/user/balance`
  const response = await fetch(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
    signal: AbortSignal.timeout(config.timeoutMs)
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const code = response.status === 401 || response.status === 403 ? 'invalid-credential' : 'upstream-error'
    throw taggedError(code, `DeepSeek answered HTTP ${response.status}${detail === '' ? '' : ` — ${detail.slice(0, 200)}`}`)
  }
  return await response.json()
}

/**
 * Host plugin body: one cached, read-only balance route.
 * @param ctx - host plugin context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx, config) {
  // A malformed schedule is a configuration error, so fail here rather than
  // answering every request with a broken pricing block.
  const schedule = normalizeSchedule(config)
  /** The maintained holiday data, refreshed in the background. */
  const holidays = createHolidaySource({
    urlTemplate: config.holidayURL,
    ttlMs: config.holidayRefreshMs,
    timeoutMs: config.timeoutMs,
    log: (message) => ctx.logger?.warn?.(message)
  })
  /**
   * The calendar years a reading can land in. holiday-cn files a date under the
   * year of the State Council paper rather than the date, so December can depend
   * on the next year's document and both must be present.
   */
  const neededYears = () => {
    const year = new Date().getUTCFullYear()
    return [year, year + 1]
  }
  // Warm the cache at load time; a failure just leaves the bundled table in use.
  if (holidays.stale(neededYears())) void holidays.refresh(neededYears())

  /** Cache: last good payload, its timestamp, and the in-flight read. */
  const cache = { payload: undefined, at: 0, inflight: undefined }
  const ttl = Math.max(MIN_REFRESH_MS, config.refreshMs)

  /**
   * Answer from cache, or re-read upstream. Concurrent callers share one read,
   * and a failed read never replaces the last good payload.
   * @param force - bypass the freshness window (still floored by MIN_REFRESH_MS).
   * @returns the payload the route serializes.
   */
  const read = async (force) => {
    const age = Date.now() - cache.at
    if (cache.payload !== undefined && age < (force ? MIN_REFRESH_MS : ttl)) return cache.payload
    if (cache.inflight !== undefined) return cache.inflight
    cache.inflight = (async () => {
      try {
        const balance = await fetchBalance(ctx, config)
        cache.payload = { ok: true, balance, fetchedAt: Date.now() }
        cache.at = Date.now()
        return cache.payload
      } catch (error) {
        const code = typeof error?.code === 'string' ? error.code : 'request-failed'
        const message = String(error?.message ?? error)
        ctx.logger?.warn?.('usage-info: balance read failed (%s): %s', code, message)
        return { ok: false, error: { code, message }, fetchedAt: Date.now() }
      } finally {
        cache.inflight = undefined
      }
    })()
    return cache.inflight
  }

  const route = {
    kind: 'exact',
    path: BALANCE_PATH,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('allow', 'GET, HEAD')
        sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'use GET' } })
        return
      }
      if (!hostAllowed(req.headers?.host, ctx.webServer?.host ?? '127.0.0.1')) {
        sendJson(res, 403, { ok: false, error: { code: 'forbidden-host', message: 'this route answers loopback hosts only' } })
        return
      }
      const force = new URL(req.url ?? '/', 'http://localhost').searchParams.get('refresh') === '1'
      const payload = await read(force)
      // Keep the holiday calendar warm without ever blocking a request on it: a
      // stale snapshot is refreshed in the background, and this request answers
      // from whatever is already cached (fetched data, else the bundled table).
      const years = neededYears()
      if (holidays.stale(years)) void holidays.refresh(years)
      // The pricing window is arithmetic on the server clock, so it is read
      // fresh here rather than cached with the upstream balance.
      const body = { ...payload, pricing: readPricing(withHolidayData(schedule, holidays.peek()), Date.now()) }
      if (req.method === 'HEAD') {
        res.statusCode = 200
        res.end()
        return
      }
      sendJson(res, 200, body)
    }
  }

  ctx.effect(() => ctx.webServer.register(route), `usage-info: ${BALANCE_PATH}`)
}
