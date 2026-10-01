/**
 * Offline preflight for lib/index.js: the route shape, the cache, and the
 * failure branches. Never touches the network, so it needs no credential.
 */
import { apply, BALANCE_PATH, Config, inject, name } from '../lib/index.js'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

let failures = 0
const check = (label, condition, detail) => {
  if (condition === true) console.log(`  ok   ${label}`)
  else {
    failures += 1
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

console.log(`name=${name} path=${BALANCE_PATH} inject=${JSON.stringify(inject)}`)
check('BALANCE_PATH is absolute', BALANCE_PATH.startsWith('/'))

const parsed = Config({})
check('Config defaults', parsed.baseURL === 'https://api.deepseek.com', JSON.stringify(parsed))
check('Config apiKeyEnv default', parsed.apiKeyEnv === 'DEEPSEEK_API_KEY', String(parsed.apiKeyEnv))
check('Config peak windows default to the published schedule', JSON.stringify(parsed.peakWindows) === '["01:00-04:00","06:00-10:00"]', JSON.stringify(parsed.peakWindows))
check('Config peak days default to Mon-Fri', JSON.stringify(parsed.peakDays) === '[1,2,3,4,5]', JSON.stringify(parsed.peakDays))
check('Config holidays default to empty', Array.isArray(parsed.holidays) && parsed.holidays.length === 0)
check('Config off-peak discount defaults to 50', parsed.offPeakDiscountPercent === 50, String(parsed.offPeakDiscountPercent))

/** Capture the registered route and drive it with a fake req/res pair. */
let route
let effectLabel
const ctx = {
  get: () => undefined,
  effect: (factory, label) => {
    effectLabel = label
    const dispose = factory()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  webServer: {
    register: (registered) => {
      route = registered
      return () => {
        route = undefined
      }
    }
  },
  logger: { warn: () => {} }
}

apply(ctx, Config({}))
check('registered one route', route !== undefined)
check('route is exact', route?.kind === 'exact', String(route?.kind))
check('route path matches BALANCE_PATH', route?.path === BALANCE_PATH, String(route?.path))
check('effect carries a label', typeof effectLabel === 'string', String(effectLabel))

/** Minimal IncomingMessage/ServerResponse stand-ins. */
const fakeReq = (method, url = '/', host = '127.0.0.1:3080') => ({ method, url, headers: { host } })
const fakeRes = () => {
  const out = { statusCode: undefined, headers: {}, body: undefined }
  out.setHeader = (k, v) => {
    out.headers[k.toLowerCase()] = v
  }
  out.end = (chunk) => {
    out.body = chunk
  }
  return out
}
const call = async (method, url, host) => {
  const res = fakeRes()
  await route.handler(fakeReq(method, url, host), res)
  return { ...res, json: res.body === undefined ? undefined : JSON.parse(res.body) }
}

const post = await call('POST')
check('POST is 405', post.statusCode === 405, String(post.statusCode))
check('POST advertises allow', post.headers.allow === 'GET, HEAD', String(post.headers.allow))

const head = await call('HEAD')
check('HEAD is 200 with empty body', head.statusCode === 200 && head.body === undefined)

// DNS-rebinding guard: a foreign Host is refused on the loopback posture.
const foreign = await call('GET', '/', 'evil.example.com')
check('foreign Host is 403', foreign.statusCode === 403, String(foreign.statusCode))
check('foreign Host code is forbidden-host', foreign.json?.error?.code === 'forbidden-host', JSON.stringify(foreign.json))
const ipv6 = await call('HEAD', '/', '[::1]:3080')
check('IPv6 loopback Host is allowed', ipv6.statusCode === 200, String(ipv6.statusCode))
const noHost = await call('GET', '/', '')
check('missing Host is 403', noHost.statusCode === 403, String(noHost.statusCode))

// A deliberate 0.0.0.0 bind answers any host.
apply({ ...ctx, webServer: { ...ctx.webServer, host: '0.0.0.0' } }, Config({}))
const exposed = await call('GET', '/', 'lan.example.com:3080')
check('0.0.0.0 bind allows a foreign Host', exposed.statusCode === 200, String(exposed.statusCode))
apply(ctx, Config({}))

// No credentials service and no ambient key -> a structured, non-throwing failure.
const get = await call('GET')
check('GET answers JSON 200', get.statusCode === 200 && get.headers['content-type']?.startsWith('application/json'))
check('GET reports ok:false', get.json?.ok === false, JSON.stringify(get.json))
check(
  'GET failure code is missing-credential',
  ['missing-credential', 'request-failed'].includes(get.json?.error?.code),
  JSON.stringify(get.json?.error)
)

// Pricing rides along with the balance and is computed fresh from the clock,
// so it is present even when the upstream balance read failed.
const pricing = get.json?.pricing
check('GET carries a pricing block', pricing !== undefined && pricing !== null, JSON.stringify(get.json))
check('pricing names a window', pricing?.window === 'peak' || pricing?.window === 'off-peak', String(pricing?.window))
check('pricing explains the reason', typeof pricing?.reason === 'string', String(pricing?.reason))
check('pricing names the next window', pricing?.nextWindow === 'peak' || pricing?.nextWindow === 'off-peak', String(pricing?.nextWindow))
check('pricing carries a next transition', typeof pricing?.nextChangeAt === 'number', String(pricing?.nextChangeAt))
check('pricing discount matches the window', pricing?.discountPercent === (pricing?.window === 'off-peak' ? 50 : 0), String(pricing?.discountPercent))
check('pricing publishes the schedule label', /UTC/.test(String(pricing?.schedule)), String(pricing?.schedule))

// A malformed schedule is a configuration error, not a per-request failure.
let scheduleRejected = false
try {
  apply(ctx, Config({ peakWindows: ['25:00-26:00'] }))
} catch {
  scheduleRejected = true
}
check('a malformed peak window is rejected at apply time', scheduleRejected === true)
apply(ctx, Config({}))

// The credentials seam is consulted with a branded ref.
const seen = []
const ctxWithCreds = {
  ...ctx,
  get: (key) => (key === 'credentials' ? { resolve: async (ref) => (seen.push(String(ref)), undefined) } : undefined)
}
apply(ctxWithCreds, Config({}))
await call('GET')
check('credentials.resolve used the branded ref', seen.length === 1 && seen[0] === 'DEEPSEEK_API_KEY', JSON.stringify(seen))
check('credentialRef accepts the default name', String(credentialRef('DEEPSEEK_API_KEY')) === 'DEEPSEEK_API_KEY')

console.log(failures === 0 ? '\npreflight: PASS' : `\npreflight: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
