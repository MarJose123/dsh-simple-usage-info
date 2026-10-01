/**
 * dsh-simple-usage-info — bundled Chinese public holiday table types.
 * @module dsh-simple-usage-info/holidays
 */

/** Every calendar year the bundled table covers. */
export declare const COVERED_YEARS: readonly number[]

/** Every announced public holiday date across the covered years, sorted. */
export declare function bundledHolidays(): string[]

/** Every announced 调休 makeup workday across the covered years, sorted. */
export declare function bundledMakeupWorkdays(): string[]

/**
 * The State Council citation for one year's arrangement.
 * @returns the notice reference, or undefined when the year is not covered.
 */
export declare function noticeFor(year: number): string | undefined
