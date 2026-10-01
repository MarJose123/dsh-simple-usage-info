/**
 * dsh-simple-usage-info — host (Node) half type surface.
 * @module dsh-simple-usage-info
 */
import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name. */
export declare const name = 'dsh-simple-usage-info'
/** Host services required before the balance route can register. */
export declare const inject: string[]
/** The one route path this plugin owns, shared with the browser half. */
export declare const BALANCE_PATH = '/usage/balance'
/** Plugin configuration schema. */
export declare const Config: unknown

/** One currency's balance, exactly as the DeepSeek API reports it. */
export interface DeepSeekBalanceInfo {
  readonly currency: 'CNY' | 'USD'
  readonly total_balance: string
  readonly granted_balance: string
  readonly topped_up_balance: string
}

/** The DeepSeek `GET /user/balance` document. */
export interface DeepSeekBalance {
  readonly is_available: boolean
  readonly balance_infos: readonly DeepSeekBalanceInfo[]
}

/** What `GET /usage/balance` answers. Both branches carry the pricing block. */
export type BalancePayload =
  | {
      readonly ok: true
      readonly balance: DeepSeekBalance
      readonly pricing: import('./pricing.js').PricingReading
      readonly fetchedAt: number
    }
  | {
      readonly ok: false
      readonly error: { readonly code: string; readonly message: string }
      readonly pricing: import('./pricing.js').PricingReading
      readonly fetchedAt: number
    }

/** Host plugin body: one cached, read-only balance route. */
export declare function apply(ctx: Context, config: unknown): void
