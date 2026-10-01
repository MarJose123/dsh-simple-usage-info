/**
 * Chinese public holidays — the offline fallback table.
 *
 * The primary source is fetched at runtime from a list that is already
 * maintained (`lib/holiday-source.js` → NateScarlet/holiday-cn). This table is
 * what the plugin uses when that fetch has never succeeded, so an offline host
 * still prices holidays correctly instead of silently treating them as ordinary
 * weekdays.
 *
 * The dates are Chinese calendar days; because every peak window (01:00–10:00
 * UTC) sits inside one Chinese day (09:00–18:00 CST), looking them up by UTC
 * date is equivalent.
 *
 * The 2026 entry below is the State Council announcement (Guo Ban Fa Ming Dian
 * [2025] No. 7), verified date-for-date against holiday-cn's 2026.json: 33 days
 * off and 6 makeup workdays, identical.
 *
 * Being a fallback rather than the source of truth, it needs no annual
 * maintenance — a year it does not cover simply reports itself as uncovered when
 * the fetch is also unavailable.
 *
 * @module dsh-simple-usage-info/holidays
 */

/**
 * One year's announced arrangement.
 * `ranges` are inclusive `YYYY-MM-DD` spans of days off; `makeupWorkdays` are
 * weekend days the notice designates as working days.
 */
const NOTICES = {
  2026: {
    notice: 'Guo Ban Fa Ming Dian [2025] No. 7 (4 November 2025)',
    ranges: [
      // New Year's Day, 3 days.
      ['2026-01-01', '2026-01-03'],
      // Spring Festival, 9 days.
      ['2026-02-15', '2026-02-23'],
      // Qingming Festival, 3 days.
      ['2026-04-04', '2026-04-06'],
      // Labor Day, 5 days.
      ['2026-05-01', '2026-05-05'],
      // Dragon Boat Festival, 3 days.
      ['2026-06-19', '2026-06-21'],
      // Mid-Autumn Festival, 3 days.
      ['2026-09-25', '2026-09-27'],
      // National Day, 7 days.
      ['2026-10-01', '2026-10-07']
    ],
    makeupWorkdays: [
      '2026-01-04', // Sunday, for New Year's Day
      '2026-02-14', // Saturday, for Spring Festival
      '2026-02-28', // Saturday, for Spring Festival
      '2026-05-09', // Saturday, for Labor Day
      '2026-09-20', // Sunday, for National Day
      '2026-10-10' // Saturday, for National Day
    ]
  }
}

/** Every calendar year this table covers. */
export const COVERED_YEARS = Object.keys(NOTICES).map(Number).sort()

/** `YYYY-MM-DD` for a UTC date. */
function dayKey(year, month, day) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

/**
 * Expand one inclusive `YYYY-MM-DD`..`YYYY-MM-DD` span.
 * @param from - first day off.
 * @param to - last day off.
 * @returns every date in the span.
 */
function expandRange(from, to) {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  const dates = []
  for (let at = start; at <= end; at += 86400000) {
    const date = new Date(at)
    dates.push(dayKey(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  }
  return dates
}

/**
 * Every announced public holiday date across the covered years.
 * @returns a sorted list of `YYYY-MM-DD`.
 */
export function bundledHolidays() {
  return COVERED_YEARS.flatMap((year) => NOTICES[year].ranges.flatMap(([from, to]) => expandRange(from, to))).sort()
}

/**
 * Every announced makeup workday across the covered years.
 * @returns a sorted list of `YYYY-MM-DD`.
 */
export function bundledMakeupWorkdays() {
  return COVERED_YEARS.flatMap((year) => [...NOTICES[year].makeupWorkdays]).sort()
}

/**
 * The citation for one year's arrangement.
 * @param year - calendar year.
 * @returns the notice reference, or undefined when uncovered.
 */
export function noticeFor(year) {
  return NOTICES[year]?.notice
}
