/**
 * dsh-simple-usage-info — peak / off-peak pricing schedule types.
 * @module dsh-simple-usage-info/pricing
 */

/** Peak-rate window name. */
export declare const PEAK = 'peak'
/** Off-peak (discounted) window name. */
export declare const OFF_PEAK = 'off-peak'

/** Which window applies. */
export type PricingWindow = typeof PEAK | typeof OFF_PEAK
/**
 * Why a window applies: a Chinese public holiday, a non-peak weekday, the peak
 * clock windows, or none of them.
 */
export type PricingReason = 'holiday' | 'non-peak-day' | 'peak-hours' | 'outside-peak-hours'

/** Raw schedule configuration, as it arrives from the Cordis patch. */
export interface PricingScheduleInput {
  readonly peakWindows?: readonly string[]
  readonly peakDays?: readonly number[]
  readonly holidays?: readonly string[]
  readonly makeupWorkdays?: readonly string[]
  readonly makeupWorkdaysArePeak?: boolean
  readonly useBundledHolidays?: boolean
  readonly offPeakDiscountPercent?: number
}
/** A validated schedule. */
export interface NormalizedSchedule {
  readonly windows: readonly { readonly label: string; readonly start: number; readonly end: number }[]
  readonly peakDays: ReadonlySet<number>
  /** The bundled State Council table, before any fetched data replaces it. */
  readonly bundledHolidays: readonly string[]
  readonly bundledMakeupWorkdays: readonly string[]
  /** Dates the operator added; always additive, even over fetched data. */
  readonly configuredHolidays: readonly string[]
  readonly configuredMakeupWorkdays: readonly string[]
  /** The effective holiday set. */
  readonly holidays: ReadonlySet<string>
  readonly makeupWorkdays: ReadonlySet<string>
  readonly makeupWorkdaysArePeak: boolean
  readonly offPeakDiscountPercent: number
  /** The years the effective holiday data covers. */
  readonly coveredYears: readonly number[]
  /** Where the holiday dates came from: fetched, bundled, or none. */
  readonly holidayData: 'remote' | 'bundled' | 'none'
  /** The State Council papers the data was scraped from, when fetched. */
  readonly holidayPapers: readonly string[]
  readonly label: string
}

/**
 * Validate raw configuration, seeding the holiday sets from the bundled table.
 * @throws TypeError when a window, day, holiday, or discount is malformed.
 */
export declare function normalizeSchedule(raw: PricingScheduleInput): NormalizedSchedule

/**
 * Swap the bundled holiday table for a fetched snapshot, keeping configured
 * dates additive. Returns the input unchanged when `remote` is undefined.
 */
export declare function withHolidayData(
  schedule: NormalizedSchedule,
  remote: import('./holiday-source.js').HolidaySnapshot | undefined
): NormalizedSchedule

/** The plain-JSON schedule the browser half repeats the rule from. */
export interface SerializedSchedule {
  readonly peakWindows: readonly { readonly start: number; readonly end: number; readonly label: string }[]
  readonly peakDays: readonly number[]
  readonly holidays: readonly string[]
  readonly makeupWorkdays: readonly string[]
  readonly makeupWorkdaysArePeak: boolean
  readonly offPeakDiscountPercent: number
  readonly coveredYears: readonly number[]
}

/** Project a schedule into plain JSON for the browser half. */
export declare function serializeSchedule(schedule: NormalizedSchedule): SerializedSchedule

/** The pricing block the route returns. */
export interface PricingReading {
  readonly window: PricingWindow
  readonly reason: PricingReason
  readonly discountPercent: number
  readonly nextChangeAt?: number
  readonly nextWindow?: PricingWindow
  /** Human-readable UTC summary, e.g. `01:00-04:00, 06:00-10:00 UTC, Mon/Tue/...`. */
  readonly schedule: string
  /** The UTC year the reading was evaluated in. */
  readonly holidayYear: number
  /** Whether the effective holiday data covers `holidayYear`. */
  readonly holidayCovered: boolean
  /** The State Council paper or bundled notice for `holidayYear`, when known. */
  readonly holidayNotice?: string
  /** Where the holiday dates came from: fetched, bundled, or none. */
  readonly holidayData: 'remote' | 'bundled' | 'none'
  readonly now: number
  /** The serializable schedule the browser half evaluates from. */
  readonly windows: SerializedSchedule
}

/** Describe the pricing window in force at one instant. */
export declare function readPricing(schedule: NormalizedSchedule, instant: number): PricingReading
