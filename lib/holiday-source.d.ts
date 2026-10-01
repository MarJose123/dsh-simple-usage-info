/**
 * dsh-simple-usage-info — maintained holiday source types.
 * @module dsh-simple-usage-info/holiday-source
 */

/** Where the maintained data lives; `{year}` is substituted. */
export declare const DEFAULT_HOLIDAY_URL: string
/** How long one successful snapshot stays fresh. */
export declare const DEFAULT_TTL_MS: number
/** Remote request timeout. */
export declare const DEFAULT_TIMEOUT_MS: number

/** One merged, fetched holiday snapshot. */
export interface HolidaySnapshot {
  /** Every statutory day off across the fetched years, sorted. */
  readonly holidays: readonly string[]
  /** Every 调休 makeup workday across the fetched years, sorted. */
  readonly makeupWorkdays: readonly string[]
  /** The years the snapshot actually covers. */
  readonly years: readonly number[]
  /** The State Council papers the data was scraped from. */
  readonly papers: readonly string[]
  /** When the snapshot was published. */
  readonly fetchedAt: number
}

/** Injectable seams and configuration for {@link createHolidaySource}. */
export interface HolidaySourceOptions {
  /** URL template with a `{year}` placeholder; empty disables fetching. */
  readonly urlTemplate?: string
  /** How long a snapshot stays fresh. */
  readonly ttlMs?: number
  /** Per-request timeout. */
  readonly timeoutMs?: number
  /** The fetch implementation; injectable for tests. */
  readonly fetchImpl?: typeof fetch
  /** The clock; injectable for tests. */
  readonly now?: () => number
  /** Where refresh failures are reported. */
  readonly log?: (message: string) => void
}

/** A lazily-refreshed holiday source. */
export interface HolidaySource {
  /** The current snapshot, or undefined before the first success. */
  peek(): HolidaySnapshot | undefined
  /** Whether a refresh is worth starting for these years. */
  stale(years: readonly number[]): boolean
  /** Fetch every requested year; never rejects. */
  refresh(years: readonly number[]): Promise<HolidaySnapshot | undefined>
}

/** Build a lazily-refreshed holiday source. */
export declare function createHolidaySource(options?: HolidaySourceOptions): HolidaySource
