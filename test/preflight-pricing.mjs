/**
 * Offline preflight for lib/pricing.js: the peak / off-peak schedule and the
 * Chinese public holiday table, against fixed UTC instants. No clock, no network.
 *
 * Fixtures use the week of 2026-11-02 (Mon) .. 2026-11-08 (Sun), which the State
 * Council notice leaves free of holidays — October is unusable as a neutral week,
 * because 2026-10-01..07 is National Day and 2026-10-10 is a makeup workday.
 */
import { normalizeSchedule, serializeSchedule, readPricing, PEAK, OFF_PEAK } from '../lib/pricing.js'
import { COVERED_YEARS, bundledHolidays, bundledMakeupWorkdays } from '../lib/holidays.js'

let failures = 0
const check = (label, condition, detail) => {
  if (condition === true) console.log(`  ok   ${label}`)
  else {
    failures += 1
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const at = (day, hour, minute = 0) => Date.UTC(2026, 10, day, hour, minute)

// Fixture sanity: the whole file depends on these weekday facts.
check('2026-11-02 is a Monday', new Date(at(2, 0)).getUTCDay() === 1)
check('2026-11-07 is a Saturday', new Date(at(7, 0)).getUTCDay() === 6)

const schedule = normalizeSchedule({
  peakWindows: ['01:00-04:00', '06:00-10:00'],
  peakDays: [1, 2, 3, 4, 5],
  holidays: [],
  offPeakDiscountPercent: 50
})

/** The published policy, boundary by boundary, on an ordinary weekday. */
const weekday = [
  ['Monday 00:59 is off-peak', at(2, 0, 59), OFF_PEAK],
  ['Monday 01:00 is peak', at(2, 1, 0), PEAK],
  ['Monday 03:59 is peak', at(2, 3, 59), PEAK],
  ['Monday 04:00 is off-peak', at(2, 4, 0), OFF_PEAK],
  ['Monday 05:59 is off-peak', at(2, 5, 59), OFF_PEAK],
  ['Monday 06:00 is peak', at(2, 6, 0), PEAK],
  ['Monday 09:59 is peak', at(2, 9, 59), PEAK],
  ['Monday 10:00 is off-peak', at(2, 10, 0), OFF_PEAK],
  ['Monday 23:59 is off-peak', at(2, 23, 59), OFF_PEAK]
]
for (const [label, instant, expected] of weekday) {
  check(label, readPricing(schedule, instant).window === expected, readPricing(schedule, instant).window)
}

/** Weekends are off-peak in full, including inside a peak window. */
check('Saturday 02:00 is off-peak', readPricing(schedule, at(7, 2)).window === OFF_PEAK)
check('Saturday reason is non-peak-day', readPricing(schedule, at(7, 2)).reason === 'non-peak-day', readPricing(schedule, at(7, 2)).reason)
check('Sunday 07:00 is off-peak', readPricing(schedule, at(8, 7)).window === OFF_PEAK)

/** The discount rides on the window, not on the balance. */
check('off-peak carries the 50% discount', readPricing(schedule, at(2, 5)).discountPercent === 50)
check('peak carries no discount', readPricing(schedule, at(2, 2)).discountPercent === 0)

/** Transitions: the next boundary the window actually flips on. */
const monday2 = readPricing(schedule, at(2, 2))
check('Monday 02:00 switches to off-peak at 04:00', monday2.nextChangeAt === at(2, 4), new Date(monday2.nextChangeAt ?? 0).toISOString())
check('the next window is named', monday2.nextWindow === OFF_PEAK, String(monday2.nextWindow))

const monday0 = readPricing(schedule, at(2, 0))
check('Monday 00:00 switches to peak at 01:00', monday0.nextChangeAt === at(2, 1), new Date(monday0.nextChangeAt ?? 0).toISOString())

// Friday 11:00 is off-peak and stays off-peak through the weekend, so the next
// real transition is Monday 01:00 — the boundary scan has to cross two days.
const friday11 = readPricing(schedule, at(6, 11))
check('Friday 11:00 switches to peak on Monday 01:00', friday11.nextChangeAt === at(9, 1), new Date(friday11.nextChangeAt ?? 0).toISOString())

const saturday2 = readPricing(schedule, at(7, 2))
check('Saturday 02:00 switches to peak on Monday 01:00', saturday2.nextChangeAt === at(9, 1), new Date(saturday2.nextChangeAt ?? 0).toISOString())

/** The bundled State Council table. */
const holidays = bundledHolidays()
check('the bundled table covers 2026', COVERED_YEARS.includes(2026), JSON.stringify(COVERED_YEARS))
check('the bundled table has 33 days off', holidays.length === 33, String(holidays.length))
check('the bundled table has 6 makeup workdays', bundledMakeupWorkdays().length === 6, String(bundledMakeupWorkdays().length))

// National Day 2026-10-01..07: a Thursday inside a peak window is off-peak.
check('National Day is off-peak at 02:00', readPricing(schedule, Date.UTC(2026, 9, 1, 2)).window === OFF_PEAK)
check('National Day reports reason holiday', readPricing(schedule, Date.UTC(2026, 9, 1, 2)).reason === 'holiday', readPricing(schedule, Date.UTC(2026, 9, 1, 2)).reason)
check('the last National Day day is off-peak', readPricing(schedule, Date.UTC(2026, 9, 7, 2)).window === OFF_PEAK)
check('the day after National Day is peak again', readPricing(schedule, Date.UTC(2026, 9, 8, 2)).window === PEAK)
// Spring Festival runs across a weekend and two weeks of weekdays.
check('Spring Festival 2026-02-16 is off-peak', readPricing(schedule, Date.UTC(2026, 1, 16, 2)).window === OFF_PEAK)
check('2026-02-24 is peak again', readPricing(schedule, Date.UTC(2026, 1, 24, 2)).window === PEAK)

/** 调休 makeup workdays: off-peak under the literal "Monday through Friday" rule. */
check(
  'a makeup workday stays off-peak by default',
  readPricing(schedule, Date.UTC(2026, 9, 10, 2)).window === OFF_PEAK,
  readPricing(schedule, Date.UTC(2026, 9, 10, 2)).window
)
const makeupPeak = normalizeSchedule({
  peakWindows: ['01:00-04:00', '06:00-10:00'],
  peakDays: [1, 2, 3, 4, 5],
  makeupWorkdaysArePeak: true,
  offPeakDiscountPercent: 50
})
check(
  'a makeup workday is peak when opted in',
  readPricing(makeupPeak, Date.UTC(2026, 9, 10, 2)).window === PEAK,
  readPricing(makeupPeak, Date.UTC(2026, 9, 10, 2)).window
)

/** Holidays can be added for years the table does not cover. */
const future = normalizeSchedule({ peakWindows: ['01:00-04:00'], peakDays: [1], holidays: ['2027-03-01'] })
check('a configured holiday applies', readPricing(future, Date.UTC(2027, 2, 1, 2)).reason === 'holiday')
check('an uncovered year is reported', readPricing(future, Date.UTC(2027, 2, 2, 2)).holidayCovered === false)
check('a covered year is reported', readPricing(schedule, at(2, 2)).holidayCovered === true)

/** Bundled holidays can be switched off entirely. */
const manual = normalizeSchedule({ peakWindows: ['01:00-04:00'], peakDays: [1, 2, 3, 4, 5], useBundledHolidays: false })
check('useBundledHolidays:false ignores National Day', readPricing(manual, Date.UTC(2026, 9, 1, 2)).window === PEAK)

/** The serialized schedule is what the browser half repeats the rule from. */
const wire = serializeSchedule(schedule)
check('the serialized schedule is JSON-safe', JSON.stringify(wire).length > 0)
check('the serialized schedule keeps window minutes', wire.peakWindows[0].start === 60 && wire.peakWindows[0].end === 240, JSON.stringify(wire.peakWindows))
check('the serialized schedule keeps the holiday list', wire.holidays.includes('2026-10-01'), String(wire.holidays.length))
check('the serialized schedule keeps covered years', JSON.stringify(wire.coveredYears) === '[2026]', JSON.stringify(wire.coveredYears))
check('the serialized schedule carries the discount', wire.offPeakDiscountPercent === 50)

/** The schedule label is human-readable for the tooltip. */
check('schedule label names the windows and days', /01:00-04:00, 06:00-10:00 UTC/.test(schedule.label), schedule.label)

/** Bad configuration fails loudly instead of answering with a broken window. */
const rejects = [
  ['a malformed window', { peakWindows: ['1:00-4:00'] }],
  ['a wrapping window', { peakWindows: ['22:00-02:00'] }],
  ['an out-of-range day', { peakDays: [7] }],
  ['a malformed holiday', { holidays: ['2026-1-1'] }],
  ['a malformed makeup workday', { makeupWorkdays: ['nope'] }],
  ['an out-of-range discount', { offPeakDiscountPercent: 150 }]
]
for (const [label, raw] of rejects) {
  let threw = false
  try {
    normalizeSchedule({ peakWindows: [], peakDays: [], holidays: [], offPeakDiscountPercent: 50, ...raw })
  } catch {
    threw = true
  }
  check(`normalizeSchedule rejects ${label}`, threw === true)
}

console.log(failures === 0 ? '\npricing preflight: PASS' : `\npricing preflight: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
