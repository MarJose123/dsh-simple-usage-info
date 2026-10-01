/**
 * Chinese public holiday source.
 *
 * DeepSeek's peak window excludes Chinese public holidays, and the statutory
 * arrangement is republished every November and is not derivable — the observed
 * days move with the lunar calendar and the annual 调休 adjustments. So instead
 * of maintaining a table by hand, this fetches one that is already maintained:
 *
 *   https://github.com/NateScarlet/holiday-cn
 *
 * That repository scrapes the State Council announcements daily in CI and
 * publishes one JSON file per year:
 *
 *   { "year": 2026, "papers": ["https://www.gov.cn/..."],
 *     "days": [ { "name": "元旦", "date": "2026-01-01", "isOffDay": true }, ... ] }
 *
 * `isOffDay: true` is a statutory day off; `isOffDay: false` is a 调休 makeup
 * workday. `lib/holidays.js` stays as an offline fallback for when the fetch
 * fails. The fetcher is injected so it can be exercised without a network.
 *
 * @module dsh-simple-usage-info/holiday-source
 */

/** Where the maintained data lives; `{year}` is substituted. */
export const DEFAULT_HOLIDAY_URL = 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json'

/** How long one successful snapshot stays fresh. */
export const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000

/** Remote request timeout. */
export const DEFAULT_TIMEOUT_MS = 10000

/** Sorted, de-duplicated union. */
function union(lists) {
  return [...new Set(lists.flat())].sort()
}

/**
 * Read one year's document.
 * @param options - the injected fetch, template, timeout, and clock.
 * @param year - the calendar year to read.
 * @returns the year's days, or `undefined` when the notice is not published yet.
 * @throws Error when the request fails or the body is unusable.
 */
async function loadYear(options, year) {
  const url = options.urlTemplate.replace('{year}', String(year))
  const response = await options.fetchImpl(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(options.timeoutMs)
  })
  if (response.ok !== true) throw new Error(`${url} answered HTTP ${response.status}`)
  const body = await response.json()
  const days = Array.isArray(body?.days) ? body.days : []
  // holiday-cn publishes an empty placeholder before the State Council notice
  // lands, and an empty `days` means "not announced", never "no holidays".
  if (days.length === 0) return undefined
  return {
    year: Number(body.year ?? year),
    holidays: days.filter((day) => day.isOffDay === true).map((day) => String(day.date)),
    makeupWorkdays: days.filter((day) => day.isOffDay !== true).map((day) => String(day.date)),
    papers: Array.isArray(body.papers) ? body.papers.map(String) : []
  }
}

/**
 * Build a lazily-refreshed holiday source.
 *
 * `refresh()` never rejects: a failed year is recorded and the previous snapshot
 * is kept, so the caller can always render something.
 * @param options - configuration and injectable seams.
 * @returns the source handle.
 */
export function createHolidaySource(options) {
  const settings = {
    urlTemplate: options?.urlTemplate ?? DEFAULT_HOLIDAY_URL,
    ttlMs: options?.ttlMs ?? DEFAULT_TTL_MS,
    timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    fetchImpl: options?.fetchImpl ?? globalThis.fetch,
    now: options?.now ?? Date.now,
    log: options?.log ?? (() => {})
  }

  /** The last successful snapshot, if any. */
  let snapshot
  /** The in-flight refresh, so concurrent callers share one round trip. */
  let inflight = null
  /** When the last refresh finished, successful or not. */
  let attemptedAt = 0

  /** Whether a remote source is configured at all. */
  const enabled = () => settings.urlTemplate !== '' && typeof settings.fetchImpl === 'function'

  /**
   * Whether a refresh is worth starting for these years.
   * @param years - the years the caller needs covered.
   * @returns true when the snapshot is missing, stale, or short of a year.
   */
  function stale(years) {
    if (!enabled()) return false
    if (snapshot === undefined) return true
    if (settings.now() - attemptedAt > settings.ttlMs) return true
    return years.some((year) => !snapshot.years.includes(year))
  }

  /**
   * Fetch every requested year and publish one merged snapshot. A disabled
   * source resolves to the current snapshot without touching the network, so a
   * caller that forgets to check {@link stale} still cannot fetch.
   * @param years - the years to cover.
   * @returns the snapshot after the attempt (unchanged when every year failed).
   */
  function refresh(years) {
    if (!enabled()) return Promise.resolve(snapshot)
    if (inflight !== null) return inflight
    inflight = (async () => {
      const loaded = []
      const failures = []
      for (const year of years) {
        try {
          const one = await loadYear(settings, year)
          if (one !== undefined) loaded.push(one)
        } catch (error) {
          failures.push(`${year}: ${String(error?.message ?? error)}`)
        }
      }
      attemptedAt = settings.now()
      if (loaded.length > 0) {
        snapshot = {
          holidays: union(loaded.map((one) => one.holidays)),
          makeupWorkdays: union(loaded.map((one) => one.makeupWorkdays)),
          years: [...new Set(loaded.map((one) => one.year))].sort((left, right) => left - right),
          papers: union(loaded.map((one) => one.papers)),
          fetchedAt: settings.now()
        }
      }
      if (failures.length > 0) {
        settings.log(
          `usage-info: holiday refresh incomplete (${failures.join('; ')})` +
            (snapshot === undefined ? '; falling back to the bundled table' : '; keeping the last snapshot')
        )
      }
      inflight = null
      return snapshot
    })()
    return inflight
  }

  return {
    /** The current snapshot, or undefined before the first success. */
    peek: () => snapshot,
    stale,
    refresh
  }
}
