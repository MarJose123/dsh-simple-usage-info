/**
 * Offline preflight for lib/holiday-source.js and pricing.withHolidayData.
 * The fetcher and the clock are injected, so this never touches the network.
 *
 * The fixtures mirror the real holiday-cn shape:
 *   { year, papers: [...], days: [{ name, date, isOffDay }] }
 */
import { createHolidaySource, DEFAULT_HOLIDAY_URL } from '../lib/holiday-source.js'
import { normalizeSchedule, withHolidayData, readPricing } from '../lib/pricing.js'
import { bundledHolidays } from '../lib/holidays.js'

let failures = 0
const check = (label, condition, detail) => {
  if (condition === true) console.log(`  ok   ${label}`)
  else {
    failures += 1
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

/** A fetch stub that answers from a `{ year: body }` table. */
function stubFetch(table, options = {}) {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    const year = Number(/\/(\d{4})\.json$/.exec(url)?.[1])
    if (options.fail?.includes(year) === true) return { ok: false, status: 503, json: async () => ({}) }
    if (options.throw?.includes(year) === true) throw new Error('socket hang up')
    const body = table[year]
    if (body === undefined) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => body }
  }
  return { fetchImpl, calls }
}

const day = (date, isOffDay, name = '节日') => ({ name, date, isOffDay })
const doc = (year, days, papers = [`https://www.gov.cn/${year}`]) => ({ year, papers, days })

/** A 2026 fixture in the real shape. */
const DOC_2026 = doc(2026, [
  day('2026-01-01', true, '元旦'),
  day('2026-01-02', true, '元旦'),
  day('2026-01-04', false, '元旦'),
  day('2026-10-01', true, '国庆节'),
  day('2026-10-10', false, '国庆节')
])

console.log('holiday source\n')

/** The happy path: off days and makeup days split by isOffDay. */
{
  const { fetchImpl, calls } = stubFetch({ 2026: DOC_2026 })
  const source = createHolidaySource({ urlTemplate: DEFAULT_HOLIDAY_URL, fetchImpl })
  const snapshot = await source.refresh([2026])
  check('a fetched snapshot reports its years', JSON.stringify(snapshot.years) === '[2026]', JSON.stringify(snapshot.years))
  check('isOffDay:true becomes a holiday', JSON.stringify(snapshot.holidays) === '["2026-01-01","2026-01-02","2026-10-01"]', JSON.stringify(snapshot.holidays))
  check('isOffDay:false becomes a makeup workday', JSON.stringify(snapshot.makeupWorkdays) === '["2026-01-04","2026-10-10"]', JSON.stringify(snapshot.makeupWorkdays))
  check('the State Council paper is kept', snapshot.papers[0] === 'https://www.gov.cn/2026', JSON.stringify(snapshot.papers))
  check('the {year} template was substituted', calls[0].endsWith('/2026.json'), calls[0])
  check('peek() returns the snapshot', source.peek() === snapshot)
}

/** Multiple years merge and de-duplicate. */
{
  const { fetchImpl } = stubFetch({
    2026: DOC_2026,
    2027: doc(2027, [day('2027-01-01', true), day('2027-02-06', false)])
  })
  const source = createHolidaySource({ fetchImpl })
  const snapshot = await source.refresh([2026, 2027])
  check('both years merge', JSON.stringify(snapshot.years) === '[2026,2027]', JSON.stringify(snapshot.years))
  check('the merged holiday list is sorted', JSON.stringify(snapshot.holidays) === '["2026-01-01","2026-01-02","2026-10-01","2027-01-01"]', JSON.stringify(snapshot.holidays))
  check('the merged makeup list carries both years', snapshot.makeupWorkdays.length === 3, JSON.stringify(snapshot.makeupWorkdays))
}

/** An announced-but-empty year means "not published", never "no holidays". */
{
  const { fetchImpl } = stubFetch({ 2027: doc(2027, []) })
  const source = createHolidaySource({ fetchImpl })
  const snapshot = await source.refresh([2027])
  check('an empty year yields no snapshot', snapshot === undefined, JSON.stringify(snapshot))
  check('an empty year is not treated as holiday-free data', source.peek() === undefined)
}

/** A failed year keeps the previous snapshot and is reported once. */
{
  const logs = []
  const good = stubFetch({ 2026: DOC_2026 })
  const source = createHolidaySource({
    fetchImpl: async (url) => {
      if (url.endsWith('/2027.json')) return { ok: false, status: 503, json: async () => ({}) }
      return good.fetchImpl(url)
    },
    log: (message) => logs.push(message)
  })
  const first = await source.refresh([2026, 2027])
  check('a partial failure still publishes the year that worked', first?.years.join() === '2026', JSON.stringify(first?.years))
  check('a partial failure is logged once', logs.length === 1, JSON.stringify(logs))
  check('a partial failure names the year', String(logs[0]).includes('2027'), String(logs[0]))
  check('the log says it kept the snapshot', String(logs[0]).includes('keeping the last snapshot'), String(logs[0]))
}

/** A total failure leaves the previous snapshot untouched. */
{
  const logs = []
  const table = { 2026: DOC_2026 }
  let failNext = false
  const source = createHolidaySource({
    fetchImpl: async (url) => {
      if (failNext) throw new Error('offline')
      return stubFetch(table).fetchImpl(url)
    },
    log: (message) => logs.push(message)
  })
  const first = await source.refresh([2026])
  failNext = true
  const second = await source.refresh([2026])
  check('a total failure keeps the old snapshot', second === first, JSON.stringify(second?.years))
  check('the fallback is explained', logs.some((line) => line.includes('keeping the last snapshot')), JSON.stringify(logs))
}

/** A first-run failure reports that the bundled table is in use instead. */
{
  const logs = []
  const source = createHolidaySource({ fetchImpl: async () => { throw new Error('offline') }, log: (m) => logs.push(m) })
  const snapshot = await source.refresh([2026])
  check('a cold failure yields no snapshot', snapshot === undefined)
  check('the cold failure points at the bundled table', logs.some((line) => line.includes('falling back to the bundled table')), JSON.stringify(logs))
}

/** staleness: missing snapshot, missing year, and ttl expiry. */
{
  let clock = 1000
  const { fetchImpl } = stubFetch({ 2026: DOC_2026 })
  const source = createHolidaySource({ fetchImpl, now: () => clock, ttlMs: 5000 })
  check('an empty source is stale', source.stale([2026]) === true)
  await source.refresh([2026])
  check('a fresh snapshot is not stale', source.stale([2026]) === false)
  check('a year the snapshot lacks makes it stale', source.stale([2027]) === true)
  clock += 5001
  check('the ttl expires', source.stale([2026]) === true)
}

/** An empty URL template disables fetching entirely. */
{
  const { fetchImpl, calls } = stubFetch({ 2026: DOC_2026 })
  const source = createHolidaySource({ urlTemplate: '', fetchImpl })
  check('an empty url disables the source', source.stale([2026]) === false)
  await source.refresh([2026])
  check('an empty url performs no request', calls.length === 0, JSON.stringify(calls))
}

/** Concurrent refreshes share one round trip. */
{
  const { fetchImpl, calls } = stubFetch({ 2026: DOC_2026 })
  const source = createHolidaySource({ fetchImpl })
  const [a, b] = await Promise.all([source.refresh([2026]), source.refresh([2026])])
  check('concurrent refreshes share one round trip', calls.length === 1, JSON.stringify(calls))
  check('both callers see the same snapshot', a === b)
}

console.log('\nwithHolidayData\n')

const schedule = normalizeSchedule({ peakWindows: ['01:00-04:00'], peakDays: [1, 2, 3, 4, 5], holidays: ['2026-12-24'] })
check('without fetched data the bundled table is in use', schedule.holidayData === 'bundled')
check('without fetched data National Day is off-peak', readPricing(schedule, Date.UTC(2026, 9, 1, 2)).reason === 'holiday')

const remote = {
  holidays: ['2026-10-01'],
  makeupWorkdays: ['2026-10-10'],
  years: [2026, 2027],
  papers: ['https://www.gov.cn/paper']
}
const merged = withHolidayData(schedule, remote)
check('fetched data replaces the bundled table', merged.holidayData === 'remote')
check('fetched data swaps the holiday set', merged.holidays.size === 2 && merged.holidays.has('2026-10-01') && merged.holidays.has('2026-12-24'), JSON.stringify([...merged.holidays]))
check('configured dates stay additive', merged.holidays.has('2026-12-24'))
check('fetched makeup workdays land too', merged.makeupWorkdays.has('2026-10-10'))
check('covered years come from the fetch', JSON.stringify(merged.coveredYears) === '[2026,2027]', JSON.stringify(merged.coveredYears))
check('the source schedule is not mutated', schedule.holidays.size > 2, String(schedule.holidays.size))
check('the reading carries the paper as the notice', readPricing(merged, Date.UTC(2026, 9, 1, 2)).holidayNotice === 'https://www.gov.cn/paper')
check('the reading reports where the data came from', readPricing(merged, Date.UTC(2026, 9, 1, 2)).holidayData === 'remote')
check('a fetched year is covered', readPricing(merged, Date.UTC(2027, 0, 4, 2)).holidayCovered === true)
check('the serialized schedule carries the fetched list', readPricing(merged, Date.UTC(2026, 9, 1, 2)).windows.holidays.includes('2026-10-01'))

const fallback = withHolidayData(schedule, undefined)
check('an undefined snapshot keeps the bundled schedule', fallback === schedule)
check('the bundled fallback still knows the full year', fallback.holidays.size === bundledHolidays().length + 1, String(fallback.holidays.size))

console.log(failures === 0 ? '\nholiday preflight: PASS' : `\nholiday preflight: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
