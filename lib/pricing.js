/**
 * DeepSeek peak / off-peak pricing windows.
 *
 * Policy, per https://api-docs.deepseek.com/quick_start/pricing :
 *
 *   "Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00 and
 *    06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public holidays.
 *    All other hours are off-peak, including weekends and Chinese public holidays
 *    in full."
 *
 * The windows are defined in UTC, so the price of a given instant is the same
 * everywhere; only the clock the user reads it on differs. Everything here is
 * therefore absolute-instant arithmetic, and the browser half repeats the same
 * small rule to stay live between polls and to render the windows in the user's
 * own timezone.
 *
 * Chinese public holidays come from `lib/holidays.js`, merged with any dates the
 * operator adds in config.
 *
 * @module dsh-simple-usage-info/pricing
 */
import { COVERED_YEARS, bundledHolidays, bundledMakeupWorkdays, noticeFor } from './holidays.js'

/** Peak-rate window name. */
export const PEAK = 'peak'
/** Off-peak (discounted) window name. */
export const OFF_PEAK = 'off-peak'

/** `HH:MM` -> minutes since UTC midnight. */
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/
/** `HH:MM-HH:MM` -> one window. */
const WINDOW = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/

/** Minutes since UTC midnight for one `HH:MM`. */
function clockMinutes(text) {
  const match = CLOCK.exec(text)
  if (match === null) throw new TypeError(`clock "${text}" must be HH:MM in 24-hour UTC`)
  return Number(match[1]) * 60 + Number(match[2])
}

/** `YYYY-MM-DD` for one instant's UTC date. */
function utcDayKey(instant) {
  const date = new Date(instant)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** Weekday names, indexed by `Date#getUTCDay`. */
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Validate raw configuration into the shape the readers below consume.
 * Bundled Chinese public holidays are merged in unless `useBundledHolidays` is
 * false; `holidays` is always additive, so it covers years the table does not.
 * @param raw - the plugin's pricing configuration.
 * @returns a detached, validated schedule.
 * @throws TypeError when a window, day, holiday, or discount is malformed.
 */
export function normalizeSchedule(raw) {
  const windows = (raw.peakWindows ?? []).map((text) => {
    const match = WINDOW.exec(text)
    if (match === null) throw new TypeError(`peak window "${text}" must be HH:MM-HH:MM in 24-hour UTC`)
    const start = clockMinutes(`${match[1]}:${match[2]}`)
    const end = clockMinutes(`${match[3]}:${match[4]}`)
    if (end <= start) throw new TypeError(`peak window "${text}" must not wrap past midnight; write overnight coverage as two windows`)
    return { label: text, start, end }
  })
  const days = (raw.peakDays ?? []).map((day) => {
    if (!Number.isInteger(day) || day < 0 || day > 6) throw new TypeError(`peak day ${String(day)} must be 0 (Sunday) through 6 (Saturday)`)
    return day
  })
  const asDates = (values, label) =>
    (values ?? []).map((day) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new TypeError(`${label} "${day}" must be YYYY-MM-DD`)
      return day
    })
  const discount = raw.offPeakDiscountPercent ?? 50
  if (typeof discount !== 'number' || discount < 0 || discount > 100) throw new TypeError(`offPeakDiscountPercent ${String(discount)} must be between 0 and 100`)

  const useBundled = raw.useBundledHolidays !== false
  // The bundled and configured dates are kept apart from the effective sets so
  // `withHolidayData` can swap the bundled half for fetched data while leaving
  // the operator's own additions in place.
  const bundled = useBundled ? bundledHolidays() : []
  const bundledMakeup = useBundled ? bundledMakeupWorkdays() : []
  const configured = asDates(raw.holidays, 'holiday')
  const configuredMakeup = asDates(raw.makeupWorkdays, 'makeup workday')

  return {
    windows,
    peakDays: new Set(days),
    bundledHolidays: bundled,
    bundledMakeupWorkdays: bundledMakeup,
    configuredHolidays: configured,
    configuredMakeupWorkdays: configuredMakeup,
    holidays: new Set([...bundled, ...configured]),
    makeupWorkdays: new Set([...bundledMakeup, ...configuredMakeup]),
    makeupWorkdaysArePeak: raw.makeupWorkdaysArePeak === true,
    offPeakDiscountPercent: discount,
    coveredYears: useBundled ? COVERED_YEARS : [],
    holidayData: useBundled ? 'bundled' : 'none',
    holidayPapers: [],
    label: `${windows.map((window) => window.label).join(', ')} UTC, ${days.length === 0 ? 'no' : days.map((day) => DAY_NAMES[day]).join('/')}`
  }
}

/**
 * Swap the bundled holiday table for fetched data.
 *
 * The fetched snapshot (see `lib/holiday-source.js`) replaces the bundled half
 * entirely; dates the operator configured are always additive on top, so a
 * private calendar can extend the official one.
 * @param schedule - a normalized schedule.
 * @param remote - the source's snapshot, or undefined to keep the bundled table.
 * @returns a derived schedule; the input is not mutated.
 */
export function withHolidayData(schedule, remote) {
  if (remote === undefined) return schedule
  return {
    ...schedule,
    holidays: new Set([...remote.holidays, ...schedule.configuredHolidays]),
    makeupWorkdays: new Set([...remote.makeupWorkdays, ...schedule.configuredMakeupWorkdays]),
    coveredYears: remote.years,
    holidayData: 'remote',
    holidayPapers: remote.papers
  }
}

/**
 * Project a schedule into plain JSON for the browser half, which repeats the
 * rule locally so the badge can flip on time and render in the user's timezone.
 * @param schedule - a normalized schedule.
 * @returns a serializable copy.
 */
export function serializeSchedule(schedule) {
  return {
    peakWindows: schedule.windows.map((window) => ({ start: window.start, end: window.end, label: window.label })),
    peakDays: [...schedule.peakDays].sort((left, right) => left - right),
    holidays: [...schedule.holidays].sort(),
    makeupWorkdays: [...schedule.makeupWorkdays].sort(),
    makeupWorkdaysArePeak: schedule.makeupWorkdaysArePeak,
    offPeakDiscountPercent: schedule.offPeakDiscountPercent,
    coveredYears: [...schedule.coveredYears]
  }
}

/**
 * Which window one instant falls in.
 * @param schedule - a normalized schedule.
 * @param instant - epoch milliseconds.
 * @returns the window and why it applies.
 */
function stateAt(schedule, instant) {
  const date = new Date(instant)
  const key = utcDayKey(instant)
  if (schedule.holidays.has(key)) return { window: OFF_PEAK, reason: 'holiday' }
  // The published rule says "Monday through Friday", so a 调休 makeup workday is
  // off-peak unless the operator opts into treating it as a working day.
  const makesUp = schedule.makeupWorkdaysArePeak && schedule.makeupWorkdays.has(key)
  if (!makesUp && !schedule.peakDays.has(date.getUTCDay())) return { window: OFF_PEAK, reason: 'non-peak-day' }
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes()
  for (const window of schedule.windows) {
    if (minutes >= window.start && minutes < window.end) return { window: PEAK, reason: 'peak-hours' }
  }
  return { window: OFF_PEAK, reason: 'outside-peak-hours' }
}

/**
 * The first instant after `instant` whose window differs from the current one.
 * Walks the candidate boundaries (UTC midnight plus every window edge) over the
 * next eight days, which is enough to cross any weekend or holiday run.
 * @param schedule - a normalized schedule.
 * @param instant - epoch milliseconds.
 * @returns the next boundary, or `undefined` when none is found.
 */
function nextChange(schedule, instant) {
  const base = new Date(instant)
  const year = base.getUTCFullYear()
  const month = base.getUTCMonth()
  const day = base.getUTCDate()
  const current = stateAt(schedule, instant).window
  const candidates = []
  for (let offset = 0; offset <= 8; offset += 1) {
    const midnight = Date.UTC(year, month, day + offset, 0, 0, 0, 0)
    candidates.push(midnight)
    for (const window of schedule.windows) {
      candidates.push(midnight + window.start * 60000)
      candidates.push(midnight + window.end * 60000)
    }
  }
  for (const candidate of candidates.filter((value) => value > instant).sort((left, right) => left - right)) {
    const state = stateAt(schedule, candidate)
    if (state.window !== current) return { at: candidate, window: state.window }
  }
  return { at: undefined, window: undefined }
}

/**
 * Describe the pricing window in force at one instant.
 * @param schedule - a normalized schedule.
 * @param instant - epoch milliseconds to evaluate.
 * @returns the window, its reason, the discount, the next transition, and the
 *   serializable schedule the browser half repeats the rule from.
 */
export function readPricing(schedule, instant) {
  const state = stateAt(schedule, instant)
  const next = nextChange(schedule, instant)
  const year = new Date(instant).getUTCFullYear()
  return {
    window: state.window,
    reason: state.reason,
    discountPercent: state.window === OFF_PEAK ? schedule.offPeakDiscountPercent : 0,
    nextChangeAt: next.at,
    nextWindow: next.window,
    schedule: schedule.label,
    holidayYear: year,
    holidayCovered: schedule.coveredYears.includes(year),
    // A fetched year cites the State Council paper; the bundled table cites its
    // own notice. Either way the operator can see where the dates came from.
    holidayNotice: schedule.holidayPapers?.[0] ?? noticeFor(year),
    holidayData: schedule.holidayData,
    now: instant,
    windows: serializeSchedule(schedule)
  }
}
