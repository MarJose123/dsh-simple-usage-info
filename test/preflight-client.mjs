/**
 * Offline preflight for lib/client.js: the module-loader bundle contract, the
 * dock registration, the peak/off-peak pill, the popover's row model,
 * user-timezone rendering, and a drift sweep proving the browser's copy of the
 * pricing rule agrees with lib/pricing.js.
 *
 * The platform-module seed is stubbed for the two primitives hooks that need a
 * real DOM; everything under test here is pure.
 */
import { createRequire } from 'node:module'
import { normalizeSchedule, serializeSchedule, readPricing } from '../lib/pricing.js'

const require = createRequire(import.meta.url)
const React = require('react')
const ReactDOM = require('react-dom')
const { renderToStaticMarkup } = require('react-dom/server')

let failures = 0
const check = (label, condition, detail) => {
  if (condition === true) console.log(`  ok   ${label}`)
  else {
    failures += 1
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

/** Stand in for the browser's loader facade and capture the registration. */
let registration
globalThis.window = {
  __ModuleLoader__: {
    load: (row) => {
      registration = row
    }
  }
}

await import('../lib/client.js')

check('bundle registered via window.__ModuleLoader__.load', registration !== undefined)
check('bundle id matches the package name', registration?.id === 'dsh-simple-usage-info', String(registration?.id))
check('factory is a function', typeof registration?.factory === 'function')

/**
 * The factory may only reach the frozen platform seed. `react-dom` is there for
 * createPortal, and ui-primitives supplies the anchoring and dismiss hooks the
 * shipped context meter uses too.
 */
const seed = {
  react: React,
  'react-dom': ReactDOM,
  '@deepseek-ai/dsh-client-ui-primitives': {
    useAnchoredPosition: () => null,
    useDismissOnOutsidePointer: () => {},
    Tooltip: () => null
  }
}
const requested = []
const exports_ = registration.factory((name) => {
  requested.push(name)
  if (name in seed) return seed[name]
  throw new Error(`unexpected require("${name}")`)
})

check(
  'only platform-seed modules are required',
  JSON.stringify(requested) === '["react","react-dom","@deepseek-ai/dsh-client-ui-primitives"]',
  JSON.stringify(requested)
)
check('exports.inject is the Cordis service list', JSON.stringify(exports_.inject) === '["slots"]', JSON.stringify(exports_.inject))
check('exports.apply is a function', typeof exports_.apply === 'function')

/** Drive apply() against a fake slot registry. */
let registerArgs
const ctx = {
  slots: {
    inject: (key, callback) => {
      check('injected into the composer dock slot', key === 'conversation.composer.dock', String(key))
      check('slot callback returns a disposer', typeof callback() === 'function')
      return () => {}
    },
    register: (spec, component) => {
      registerArgs = { spec, component }
      return () => {}
    }
  }
}
exports_.apply(ctx)

check('registered one dock entry', registerArgs !== undefined)
check('entry name is the slot', registerArgs?.spec?.name === 'conversation.composer.dock', String(registerArgs?.spec?.name))
check('entry id is usage-info', registerArgs?.spec?.id === 'usage-info', String(registerArgs?.spec?.id))
check('entry order is a number', typeof registerArgs?.spec?.order === 'number', String(registerArgs?.spec?.order))
check('entry component is a function', typeof registerArgs?.component === 'function')

/** Formatting and summarization. */
check('CNY renders with a yen sign', exports_.formatWallet({ currency: 'CNY', total_balance: '25.38' }) === '¥25.38')
check('USD renders with a dollar sign', exports_.formatWallet({ currency: 'USD', total_balance: '0.00' }) === '$0.00')
check('unknown currency keeps its code', exports_.formatWallet({ currency: 'CHF', total_balance: '1.00' }) === '1.00 CHF')

const balancePayload = {
  ok: true,
  fetchedAt: Date.UTC(2026, 10, 2, 4, 30),
  balance: {
    is_available: true,
    balance_infos: [
      { currency: 'USD', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' },
      { currency: 'CNY', total_balance: '25.38', granted_balance: '1.00', topped_up_balance: '24.38' }
    ]
  }
}
const bothWallets = { status: 'ready', payload: balancePayload }
check('summarize shows CNY when USD is zero', exports_.summarize(bothWallets) === 'DeepSeek ¥25.38', exports_.summarize(bothWallets))
check(
  'summarize shows CNY when USD is empty',
  exports_.summarize({
    status: 'ready',
    payload: {
      ok: true,
      balance: {
        is_available: true,
        balance_infos: [{ currency: 'CNY', total_balance: '19.41' }]
      }
    }
  }) === 'DeepSeek ¥19.41'
)
check(
  'summarize shows USD when CNY is empty',
  exports_.summarize({
    status: 'ready',
    payload: {
      ok: true,
      balance: {
        is_available: true,
        balance_infos: [{ currency: 'USD', total_balance: '10.00' }]
      }
    }
  }) === 'DeepSeek $10.00'
)
check(
  'summarize shows USD when CNY is zero',
  exports_.summarize({
    status: 'ready',
    payload: {
      ok: true,
      balance: {
        is_available: true,
        balance_infos: [
          { currency: 'CNY', total_balance: '0.00' },
          { currency: 'USD', total_balance: '10.00' }
        ]
      }
    }
  }) === 'DeepSeek $10.00'
)
check(
  'summarize formats both funded CNY and USD totals',
  exports_.summarize({
    status: 'ready',
    payload: {
      ok: true,
      balance: {
        is_available: true,
        balance_infos: [
          { currency: 'CNY', total_balance: '19.41' },
          { currency: 'USD', total_balance: '10.00' }
        ]
      }
    }
  }) === 'DeepSeek ¥19.41 + $10.00'
)
check(
  'summarize orders CNY before USD regardless of payload order when both funded',
  exports_.summarize({
    status: 'ready',
    payload: {
      ok: true,
      balance: {
        is_available: true,
        balance_infos: [
          { currency: 'USD', total_balance: '10.00' },
          { currency: 'CNY', total_balance: '19.41' }
        ]
      }
    }
  }) === 'DeepSeek ¥19.41 + $10.00'
)
check('summarize handles the loading state', exports_.summarize({ status: 'loading' }) === 'DeepSeek …')
check('summarize handles the error state', exports_.summarize({ status: 'error' }) === 'DeepSeek unavailable')
check(
  'summarize handles an empty wallet list',
  exports_.summarize({ status: 'ready', payload: { ok: true, balance: { is_available: true, balance_infos: [] } } }) ===
    'DeepSeek no balance'
)

/** The schedule the browser evaluates from, identical to what the host sends. */
const hostSchedule = normalizeSchedule({
  peakWindows: ['01:00-04:00', '06:00-10:00'],
  peakDays: [1, 2, 3, 4, 5],
  holidays: [],
  offPeakDiscountPercent: 50
})
const wire = serializeSchedule(hostSchedule)
const anchor = Date.UTC(2026, 10, 2, 0, 0, 0)

const pricing = {
  ...readPricing(hostSchedule, anchor),
  windows: wire,
  schedule: hostSchedule.label,
  holidayYear: 2026,
  holidayCovered: true
}

/** The pill shows the window name only. */
const offPeak = { ...pricing, window: 'off-peak', reason: 'holiday', discountPercent: 50, nextWindow: 'peak' }
const peak = { ...pricing, window: 'peak', reason: 'peak-hours', discountPercent: 0, nextWindow: 'off-peak' }

const offPeakBadge = renderToStaticMarkup(exports_.priceBadge(offPeak))
check('off-peak pill reads exactly Off-peak', offPeakBadge.replace(/<[^>]*>/g, '') === 'Off-peak', offPeakBadge)
check('off-peak pill carries no percentage', !offPeakBadge.includes('%') && !offPeakBadge.includes('−'), offPeakBadge)
check('off-peak pill wears the off-peak tone', offPeakBadge.includes('dsu-pill-off'), offPeakBadge)

const peakBadge = renderToStaticMarkup(exports_.priceBadge(peak))
check('peak pill reads exactly Peak', peakBadge.replace(/<[^>]*>/g, '') === 'Peak', peakBadge)
check('peak pill wears the peak tone', peakBadge.includes('dsu-pill-peak'), peakBadge)

check('no pricing means no pill', exports_.priceBadge(undefined) === null)
check('a pricing block without a window means no pill', exports_.priceBadge({}) === null)

/** The popover model: label/value rows grouped the way the context meter is. */
const model = exports_.panelModel(balancePayload, offPeak, anchor, undefined)
check('the popover headline is the funded balance', model.headline === '¥25.38', model.headline)
check('the popover opens with the billing group', model.groups[0]?.title === 'Billing window', JSON.stringify(model.groups.map((group) => group.title)))
check(
  'the popover groups one section per currency',
  model.groups[1]?.title === 'CNY' && model.groups[2]?.title === 'USD',
  JSON.stringify(model.groups.map((group) => group.title))
)
// The API lists the zero USD wallet first; the funded one must lead instead.
check('the funded wallet leads the panel', model.groups[1]?.title === 'CNY', JSON.stringify(model.groups.map((group) => group.title)))
check('the popover reports no error when the read succeeded', model.error === undefined)

const billingRows = Object.fromEntries(model.groups[0].rows.map((row) => [row.label, row.value]))
check('billing row names the window', billingRows.Billing === 'Off-peak', JSON.stringify(billingRows))
check('the discount row is gone', billingRows.Discount === undefined, JSON.stringify(billingRows))
check('billing row names the holiday reason', billingRows['Applies because'] === 'Chinese public holiday', JSON.stringify(billingRows))
check(
  'billing row shows local peak hours',
  /^[0-9]{2}:[0-5][0-9]–[0-9]{2}:[0-5][0-9], /.test(String(billingRows[`Peak hours today (${exports_.zone})`])),
  JSON.stringify(billingRows)
)
check('billing row counts down to the switch', /^peak in /.test(String(billingRows['Next switch'])), JSON.stringify(billingRows))

const cnyRows = Object.fromEntries(model.groups[1].rows.map((row) => [row.label, row.value]))
check(
  'wallet rows carry total and granted',
  cnyRows.Total === '¥25.38' && cnyRows.Granted === '¥1.00',
  JSON.stringify(cnyRows)
)
check('the topped-up row is gone', cnyRows['Topped up'] === undefined, JSON.stringify(cnyRows))
const usdRows = Object.fromEntries(model.groups[2].rows.map((row) => [row.label, row.value]))
check('the zero wallet still reports its own figures', usdRows.Total === '$0.00' && usdRows.Granted === '$0.00', JSON.stringify(usdRows))
check('the zero wallet has no topped-up row either', usdRows['Topped up'] === undefined, JSON.stringify(usdRows))

const peakModel = exports_.panelModel(balancePayload, peak, anchor, undefined)
const peakRows = Object.fromEntries(peakModel.groups[0].rows.map((row) => [row.label, row.value]))
check('peak model says Peak', peakRows.Billing === 'Peak', JSON.stringify(peakRows))
check('peak model has no discount row either', peakRows.Discount === undefined, JSON.stringify(peakRows))

const failed = exports_.panelModel(
  { ok: false, error: { code: 'missing-credential', message: 'no key' }, fetchedAt: anchor },
  offPeak,
  anchor,
  undefined
)
check('a failed read keeps the billing group', failed.groups[0]?.title === 'Billing window')
check('a failed read surfaces the error', failed.error === 'no key', String(failed.error))
check('a failed read has no wallet groups', failed.groups.length === 1, String(failed.groups.length))
check('a failed read still shows a headline placeholder', failed.headline === '—', failed.headline)

const uncovered = exports_.panelModel(balancePayload, { ...offPeak, holidayCovered: false, holidayYear: 2027 }, anchor, undefined)
const uncoveredRows = Object.fromEntries(uncovered.groups[0].rows.map((row) => [row.label, row.value]))
check('an uncovered holiday year is called out', uncoveredRows.Holidays === 'not bundled for 2027', JSON.stringify(uncoveredRows))

const notRead = exports_.panelModel({}, offPeak, anchor, undefined)
check('an unread balance says so', notRead.footer === 'Not read yet', notRead.footer)
check('a read balance stamps the time', /^Read at \d{2}:\d{2}$/.test(model.footer), model.footer)

/** Estimated cost calculation — flat TokenUsageProjection object. */
const sampleUsage = {
  uncachedInputTokens: 10000,
  outputTokens: 5000,
  cacheReadTokens: 20000,
  cacheWriteTokens: 1000
}

/** Peak rates for deepseek-flash: cache hit $0.006/M, cache miss $0.30/M, output $1.20/M */
const peakCost = exports_.estimateCost(sampleUsage, true)
check('peak cost returns both currencies', peakCost !== null && typeof peakCost.usd === 'number' && typeof peakCost.cny === 'number')
// Peak Flash: 20000*0.006 + 10000*0.30 + 5000*1.20 = 120 + 3000 + 6000 = 9120 / 1M = $0.00912
check('peak Flash USD cost is correct', Math.abs(peakCost.usd - 0.00912) < 0.00001, String(peakCost.usd))
// Peak Flash CNY: 20000*0.04 + 10000*2 + 5000*8 = 800 + 20000 + 40000 = 60800 / 1M = ¥0.0608
check('peak Flash CNY cost is correct', Math.abs(peakCost.cny - 0.0608) < 0.00001, String(peakCost.cny))

/** Off-peak uses explicit published rates: cache hit $0.003/M, cache miss $0.15/M, output $0.60/M */
const offPeakCost = exports_.estimateCost(sampleUsage, false)
// Off-peak Flash USD: 20000*0.003 + 10000*0.15 + 5000*0.60 = 60 + 1500 + 3000 = 4560 / 1M = $0.00456
check('off-peak Flash USD cost is correct', Math.abs(offPeakCost.usd - 0.00456) < 0.00001, String(offPeakCost.usd))
// Off-peak Flash CNY: 20000*0.02 + 10000*1 + 5000*4 = 400 + 10000 + 20000 = 30400 / 1M = ¥0.0304
check('off-peak Flash CNY cost is correct', Math.abs(offPeakCost.cny - 0.0304) < 0.00001, String(offPeakCost.cny))

/** DeepSeek-V4-Pro peak rates: cache hit $0.044/M, cache miss $1.32/M, output $3.96/M */
const v4ProPeakCost = exports_.estimateCost(sampleUsage, true, 'deepseek-v4-pro')
check('V4-Pro peak returns both currencies', v4ProPeakCost !== null && typeof v4ProPeakCost.usd === 'number' && typeof v4ProPeakCost.cny === 'number')
// Peak V4-Pro USD: 20000*0.044 + 10000*1.32 + 5000*3.96 = 880 + 13200 + 19800 = 33880 / 1M = $0.03388
check('V4-Pro peak USD cost is correct', Math.abs(v4ProPeakCost.usd - 0.03388) < 0.00001, String(v4ProPeakCost.usd))
// Peak V4-Pro CNY: 20000*0.30 + 10000*9.00 + 5000*27.0 = 6000 + 90000 + 135000 = 231000 / 1M = ¥0.231
check('V4-Pro peak CNY cost is correct', Math.abs(v4ProPeakCost.cny - 0.231) < 0.00001, String(v4ProPeakCost.cny))

/** DeepSeek-V4-Pro off-peak uses explicit published rates: cache hit $0.022/M, cache miss $0.66/M, output $1.98/M */
const v4ProOffPeakCost = exports_.estimateCost(sampleUsage, false, 'deepseek-v4-pro')
// Off-peak V4-Pro USD: 20000*0.022 + 10000*0.66 + 5000*1.98 = 440 + 6600 + 9900 = 16940 / 1M = $0.01694
check('V4-Pro off-peak USD cost is correct', Math.abs(v4ProOffPeakCost.usd - 0.01694) < 0.00001, String(v4ProOffPeakCost.usd))
// Off-peak V4-Pro CNY: 20000*0.15 + 10000*4.5 + 5000*13.5 = 3000 + 45000 + 67500 = 115500 / 1M = ¥0.1155
check('V4-Pro off-peak CNY cost is correct', Math.abs(v4ProOffPeakCost.cny - 0.1155) < 0.00001, String(v4ProOffPeakCost.cny))

/** Explicit deepseek-flash model key matches default */
const flashCost = exports_.estimateCost(sampleUsage, true, 'deepseek-flash')
check('explicit Flash model matches default', Math.abs(flashCost.usd - peakCost.usd) < 0.00001 && Math.abs(flashCost.cny - peakCost.cny) < 0.00001)

/** Unknown model falls back to default Flash rates */
const unknownModelCost = exports_.estimateCost(sampleUsage, true, 'unknown-model')
check('unknown model falls back to Flash', Math.abs(unknownModelCost.usd - peakCost.usd) < 0.00001 && Math.abs(unknownModelCost.cny - peakCost.cny) < 0.00001)

/** getModelRates returns the correct rates table for peak and off-peak */
const flashPeakRates = exports_.getModelRates('deepseek-flash', true)
check('Flash peak rates cache hit is $0.006', flashPeakRates.usd.inputCacheHit === 0.006, String(flashPeakRates.usd.inputCacheHit))
const flashOffPeakRates = exports_.getModelRates('deepseek-flash', false)
check('Flash off-peak rates cache hit is $0.003', flashOffPeakRates.usd.inputCacheHit === 0.003, String(flashOffPeakRates.usd.inputCacheHit))
const v4ProPeakRates = exports_.getModelRates('deepseek-v4-pro', true)
check('V4-Pro peak rates cache hit is $0.044', v4ProPeakRates.usd.inputCacheHit === 0.044, String(v4ProPeakRates.usd.inputCacheHit))
const v4ProOffPeakRates = exports_.getModelRates('deepseek-v4-pro', false)
check('V4-Pro off-peak rates cache hit is $0.022', v4ProOffPeakRates.usd.inputCacheHit === 0.022, String(v4ProOffPeakRates.usd.inputCacheHit))
const fallbackPeakRates = exports_.getModelRates('nonexistent', true)
check('unknown model falls back to Flash peak rates', fallbackPeakRates.usd.inputCacheHit === 0.006, String(fallbackPeakRates.usd.inputCacheHit))

/** Zero usage returns null */
check('zero usage returns null', exports_.estimateCost({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, true) === null)
check('missing usage returns null', exports_.estimateCost(undefined, true) === null)

/** Formatting */
check('formatUsd shows dollars', exports_.formatUsd(1.50) === '$1.50', exports_.formatUsd(1.50))
check('formatUsd shows small amounts', exports_.formatUsd(0.012) === '$0.012', exports_.formatUsd(0.012))
check('formatCny shows yen', exports_.formatCny(2.50) === '¥2.50', exports_.formatCny(2.50))
check('formatCny shows small amounts', exports_.formatCny(0.08) === '¥0.08', exports_.formatCny(0.08))

/** Panel model with token usage shows estimated cost group */
const modelWithCost = exports_.panelModel(balancePayload, offPeak, anchor, sampleUsage)
const costGroup = modelWithCost.groups.find((group) => group.title === 'Estimated cost')
check('panel with usage shows estimated cost group', costGroup !== undefined)
check('cost group has USD row', costGroup?.rows?.find((row) => row.label === 'USD') !== undefined)
check('cost group has CNY row', costGroup?.rows?.find((row) => row.label === 'CNY') !== undefined)

/** Panel model uses the model parameter to select pricing rates */
const panelFlash = exports_.panelModel(balancePayload, { window: 'peak' }, anchor, sampleUsage, 'deepseek-flash')
const panelV4Pro = exports_.panelModel(balancePayload, { window: 'peak' }, anchor, sampleUsage, 'deepseek-v4-pro')
const flashCostGroup = panelFlash.groups.find((group) => group.title === 'Estimated cost')
const v4ProCostGroup = panelV4Pro.groups.find((group) => group.title === 'Estimated cost')
check('panel model parameter selects Flash rates', flashCostGroup?.rows?.find((row) => row.label === 'USD')?.value === '$0.0091', flashCostGroup?.rows?.find((row) => row.label === 'USD')?.value)
check('panel model parameter selects V4-Pro rates', v4ProCostGroup?.rows?.find((row) => row.label === 'USD')?.value === '$0.0339', v4ProCostGroup?.rows?.find((row) => row.label === 'USD')?.value)
const flashUsdValue = flashCostGroup?.rows?.find((row) => row.label === 'USD')?.value?.replace('$', '') ?? '0'
const v4ProUsdValue = v4ProCostGroup?.rows?.find((row) => row.label === 'USD')?.value?.replace('$', '') ?? '0'
check('V4-Pro cost is higher than Flash cost', parseFloat(v4ProUsdValue) > parseFloat(flashUsdValue))

/**
 * Regression guard. `useAnchoredPosition` returns ONLY `{left, top}`, and that
 * object replaces the panel's entire inline style. When the design lived inline,
 * positioning the panel wiped it and the popover rendered as a bare transparent
 * div. The design must therefore live in the stylesheet.
 */
const css = exports_.PANEL_CSS
check('the panel class exists in the stylesheet', css.includes('.dsu-panel{'), css.slice(0, 80))
for (const declaration of ['position:fixed', 'background:var(--dsw-specific-menu)', 'box-shadow:', 'border-radius:', 'padding:12px', 'width:min(']) {
  check(`the panel class declares ${declaration}`, css.includes(declaration), declaration)
}
check('the stylesheet styles the popover rows', css.includes('.dsu-row{') && css.includes('.dsu-label{') && css.includes('.dsu-value{'))
check('the stylesheet styles the dock bar', css.includes('.dsu-bar{') && css.includes('.dsu-bar:hover{'))
check('the stylesheet styles the pill', css.includes('.dsu-pill{') && css.includes('.dsu-pill-off{') && css.includes('.dsu-pill-peak{'))
check('the off-peak pill is green', /\.dsu-pill-off\{color:var\(--dsw-alias-state-success-primary\)\}/.test(css), css.match(/\.dsu-pill-off\{[^}]*\}/)?.[0])
check('the peak pill is red', /\.dsu-pill-peak\{color:var\(--dsw-alias-state-error-primary\)\}/.test(css), css.match(/\.dsu-pill-peak\{[^}]*\}/)?.[0])

const panelHtml = renderToStaticMarkup(exports_.panelElement(model, { left: 10, top: 20 }, { current: null }, () => {}))
check('the panel wears its class', panelHtml.includes('class="dsu-panel"'), panelHtml.slice(0, 160))
check('the anchor coordinates reach the inline style', panelHtml.includes('left:10px') && panelHtml.includes('top:20px'), panelHtml.slice(0, 200))
// The inline style carries coordinates only; anything else would be dropped on
// the next measurement, which is the bug this test exists for.
const inlineStyle = /style="([^"]*)"/.exec(panelHtml)?.[1] ?? ''
check('the inline style carries nothing but coordinates', inlineStyle.replace(/left:[^;]*;?|top:[^;]*;?/g, '') === '', inlineStyle)
check('the panel rows use classes too', panelHtml.includes('class="dsu-row"') && panelHtml.includes('class="dsu-label"'), panelHtml.slice(0, 400))
check('the panel offers a refresh control', panelHtml.includes('class="dsu-refresh"'))
check('the refresh control is an icon, not the word', !panelHtml.includes('>Refresh<'), panelHtml.slice(-340))
check('the refresh icon is a labelled svg', panelHtml.includes('<svg') && panelHtml.includes('aria-label="Refresh balance"'), panelHtml.slice(-340))

const unpositioned = renderToStaticMarkup(exports_.panelElement(model, null, { current: null }, () => {}))
check('an unmeasured panel stays hidden rather than flashing', unpositioned.includes('visibility:hidden'), unpositioned.slice(0, 200))
check('an unmeasured panel still wears its class', unpositioned.includes('class="dsu-panel"'), unpositioned.slice(0, 120))

/** Countdown, measured against a passed-in "now" so it is deterministic. */
check('countdown rounds up to whole minutes', exports_.countdown(anchor + 61 * 1000, anchor) === '2m', String(exports_.countdown(anchor + 61 * 1000, anchor)))
check('countdown formats hours', exports_.countdown(anchor + (2 * 60 + 5) * 60000, anchor) === '2h 5m', String(exports_.countdown(anchor + (2 * 60 + 5) * 60000, anchor)))
check('countdown formats days', exports_.countdown(anchor + 50 * 60 * 60000, anchor) === '2d 2h', String(exports_.countdown(anchor + 50 * 60 * 60000, anchor)))
check('countdown ignores a missing target', exports_.countdown(undefined, anchor) === undefined)

/** The user's own timezone: the same UTC windows, read on a different clock. */
check('UTC renders the raw windows', exports_.localWindows(wire, anchor, 'UTC') === '01:00–04:00, 06:00–10:00', exports_.localWindows(wire, anchor, 'UTC'))
check('UTC+8 shows the Chinese working day', exports_.localWindows(wire, anchor, 'Asia/Shanghai') === '09:00–12:00, 14:00–18:00', exports_.localWindows(wire, anchor, 'Asia/Shanghai'))
check('UTC-5 shows the previous evening', exports_.localWindows(wire, anchor, 'America/New_York') === '20:00–23:00, 01:00–05:00', exports_.localWindows(wire, anchor, 'America/New_York'))

/** Holiday handling reaches the browser's copy of the rule. */
check(
  'National Day is off-peak in the browser rule',
  exports_.windowAt(wire, Date.UTC(2026, 9, 1, 2)).reason === 'holiday',
  JSON.stringify(exports_.windowAt(wire, Date.UTC(2026, 9, 1, 2)))
)
check(
  'an ordinary Monday peak window is peak in the browser rule',
  exports_.windowAt(wire, Date.UTC(2026, 10, 2, 2)).window === 'peak',
  JSON.stringify(exports_.windowAt(wire, Date.UTC(2026, 10, 2, 2)))
)

/**
 * Drift guard: the browser repeats lib/pricing.js by hand, so sweep the two
 * against each other across a window that spans National Day, the makeup workday,
 * and two weekends. Any divergence in window, reason, or next transition fails.
 */
let samples = 0
let divergences = 0
let firstDivergence
const start = Date.UTC(2026, 8, 28, 0, 0, 0)
const end = Date.UTC(2026, 9, 13, 0, 0, 0)
for (let at = start; at <= end; at += 15 * 60000) {
  samples += 1
  const host = readPricing(hostSchedule, at)
  const client = exports_.readWindow(wire, at)
  if (
    host.window !== client.window ||
    host.reason !== client.reason ||
    host.discountPercent !== client.discountPercent ||
    host.nextChangeAt !== client.nextChangeAt ||
    host.nextWindow !== client.nextWindow
  ) {
    divergences += 1
    if (firstDivergence === undefined) firstDivergence = { at: new Date(at).toISOString(), host, client }
  }
}
check(`browser and host rules agree across ${samples} instants`, divergences === 0, JSON.stringify(firstDivergence))
check('the sweep actually covered a holiday', exports_.windowAt(wire, Date.UTC(2026, 9, 1, 2)).reason === 'holiday')

/** A custom schedule must sweep cleanly too. */
const customHost = normalizeSchedule({ peakWindows: ['22:00-23:30'], peakDays: [0, 6], offPeakDiscountPercent: 25 })
const customWire = serializeSchedule(customHost)
let customDivergences = 0
for (let at = Date.UTC(2026, 10, 1); at <= Date.UTC(2026, 10, 15); at += 30 * 60000) {
  const host = readPricing(customHost, at)
  const client = exports_.readWindow(customWire, at)
  if (host.window !== client.window || host.reason !== client.reason || host.nextChangeAt !== client.nextChangeAt) customDivergences += 1
}
check('browser and host rules agree on a weekend-night schedule', customDivergences === 0, String(customDivergences))

/** First render: the loading state, through the real server renderer. */
const html = renderToStaticMarkup(React.createElement(registerArgs.component))
check('first render shows the loading bar', html.includes('DeepSeek'), html)
check(
  'first render carries a collapsed dialog trigger',
  html.includes('aria-expanded="false"') && html.includes('aria-haspopup="dialog"'),
  html
)
// The context percentage is hardcoded after the dock slot, so flex order is the
// only thing that can place this bar last in the row — and it lives in the class.
check('the bar wears its class', html.includes('class="dsu-bar"'), html)
check('the bar class carries the flex order that clears the context meter', /\.dsu-bar\{order:1;/.test(exports_.PANEL_CSS), exports_.PANEL_CSS.slice(0, 120))
check('the popover is not in the tree while closed', !html.includes('dsu-panel'), html)

console.log(failures === 0 ? '\nclient preflight: PASS' : `\nclient preflight: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
