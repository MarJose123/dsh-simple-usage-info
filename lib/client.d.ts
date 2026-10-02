/**
 * dsh-simple-usage-info — browser half type surface.
 *
 * The shipped artifact is `lib/client.js`, hand-authored in the web client's
 * module-loader bundle format; this declaration file exists so the package's
 * `./client` export has a typed face. Everything is plain JavaScript at runtime,
 * so the types below describe the objects the bundle passes around.
 * @module dsh-simple-usage-info/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** Services this browser plugin requires. */
export declare const inject: string[]
/** The viewer's IANA timezone, read once from the browser. */
export declare const zone: string

/** One window of the serialized schedule, in minutes since UTC midnight. */
export interface WireWindow {
  readonly start: number
  readonly end: number
  readonly label: string
}

/** The plain-JSON schedule the host sends and the browser evaluates from. */
export interface WireSchedule {
  readonly peakWindows: readonly WireWindow[]
  readonly peakDays: readonly number[]
  readonly holidays: readonly string[]
  readonly makeupWorkdays: readonly string[]
  readonly makeupWorkdaysArePeak: boolean
  readonly offPeakDiscountPercent: number
  readonly coveredYears: readonly number[]
}

/** The billing reading the browser computes for one instant. */
export interface WindowReading {
  readonly window: 'peak' | 'off-peak'
  readonly reason: string
  readonly discountPercent: number
  readonly nextChangeAt?: number
  readonly nextWindow?: 'peak' | 'off-peak'
}

/** One label/value row of the popover. */
export interface PanelRow {
  readonly label: string
  readonly value: string
}

/** One titled group of popover rows. */
export interface PanelGroup {
  readonly title: string
  readonly rows: readonly PanelRow[]
}

/** Everything the popover renders, as plain data. */
export interface PanelModel {
  readonly headline: string
  readonly available?: boolean
  readonly groups: readonly PanelGroup[]
  readonly error?: string
  readonly footer: string
}

/** Token usage from the `tokenUsage` session projection (flat object). */
export interface TokenUsageProjection {
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

/** Per-currency per-million-token rates for one billing window. */
export interface CurrencyRates {
  readonly usd: { readonly inputCacheHit: number; readonly inputCacheMiss: number; readonly output: number }
  readonly cny: { readonly inputCacheHit: number; readonly inputCacheMiss: number; readonly output: number }
}

/** Rates for a model across peak and off-peak billing windows. */
export interface ModelRates {
  readonly peak: CurrencyRates
  readonly offPeak: CurrencyRates
}

/** Estimated cost in both currencies. */
export interface EstimatedCost {
  readonly usd: number
  readonly cny: number
}

/** Known model keys recognised by the rates table. */
export type ModelKey = 'deepseek-flash' | 'deepseek-v4-pro'

/** The composer-dock entry component. */
export declare function UsageBar(props?: { useProjection?: (key: string) => unknown }): unknown
/** Client plugin body: one entry in the composer dock. */
export declare function apply(ctx: ClientContext): void

/** `¥110.00` / `$110.00` / `110.00 CHF`. */
export declare function formatWallet(info: { currency?: string; total_balance?: string }): string
/** The dock's one-line text for the current state. */
export declare function summarize(state: { status: string; payload?: unknown }): string
/** The peak / off-peak pill: the window name and nothing else. */
export declare function priceBadge(pricing?: { window?: string } | null): unknown
/** The popover's contents, as data. */
export declare function panelModel(payload: unknown, pricing: unknown, now: number, tokenUsage?: TokenUsageProjection | undefined, model?: string | undefined): PanelModel
/** Estimate cost from token usage at the current billing window. */
export declare function estimateCost(usage: TokenUsageProjection | undefined, isPeak: boolean, model?: string | undefined): EstimatedCost | null
/** Resolve the rates table for a model key and billing window, falling back to the default. */
export declare function getModelRates(model?: string | undefined, isPeak?: boolean): CurrencyRates
/** Format a dollar amount. */
export declare function formatUsd(value: number): string
/** Format a CNY amount. */
export declare function formatCny(value: number): string
/** `2m` / `2h 5m` / `2d 2h`, always rounding up. */
export declare function countdown(target?: number, now?: number): string | undefined
/** Which window one instant falls in, mirroring lib/pricing.js. */
export declare function windowAt(schedule: WireSchedule, instant: number): { window: string; reason: string }
/** The complete reading for one instant. */
export declare function readWindow(schedule: WireSchedule, instant: number): WindowReading
/** The peak windows as wall-clock times in a timezone. */
export declare function localWindows(schedule: WireSchedule, instant: number, zone?: string): string
