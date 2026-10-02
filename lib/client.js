/**
 * dsh-simple-usage-info — browser half.
 *
 * Registered into the `conversation.composer.dock` slot: the ambient row the
 * composer renders *below* the message input. The bar shows the DeepSeek account
 * balance plus a peak / off-peak pill, and clicking it opens a popover with the
 * full breakdown, laid out as label/value rows the way the shipped context meter
 * does.
 *
 * The billing window is evaluated HERE, in the browser, from the serializable
 * schedule the host sends:
 *
 *   - the instant is skew-corrected against the host's clock, so a wrong browser
 *     clock cannot mis-report the price;
 *   - the rule is re-evaluated on a timer, so the badge flips on time instead of
 *     waiting for the next poll;
 *   - the windows are rendered in the user's own timezone, which only the
 *     browser knows.
 *
 * `windowAt` and `nextWindowChange` mirror lib/pricing.js. A preflight sweeps
 * both implementations against each other so they cannot drift.
 *
 * This file is authored directly in the module-loader bundle format the DSH web
 * client serves from a package's `./client` export, so the plugin needs no
 * bundler:
 *
 *     window.__ModuleLoader__.load({ id, factory: (require) => exports })
 *
 * `react`, `react-dom`, and `@deepseek-ai/dsh-client-ui-primitives` all come from
 * the client's frozen platform module seed, so the plugin declares no
 * `dsh.client.external` request.
 */
window.__ModuleLoader__.load({
  id: 'dsh-simple-usage-info',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const ReactDOM = require('react-dom')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    /** The host half's route; keep in sync with `BALANCE_PATH` in lib/index.js. */
    const PATH = '/usage/balance'
    /** The dock cell key this plugin owns. */
    const ID = 'usage-info'
    /** Re-read cadence. The host caches for a minute, so this is cheap. */
    const POLL_MS = 60000
    /** How often the clock-derived badge re-evaluates between polls. */
    const TICK_MS = 20000

    const PEAK = 'peak'
    const OFF_PEAK = 'off-peak'

    // ------------------------------------------------------------------ styles

    /**
     * Dock entries render in a centered flex row, so the bar is one inline item.
     *
     * `order: 1` is deliberate. ui-conversation renders the dock as
     * `[conversation.composer.dock entries..., ContextMeter]` — the context
     * percentage is hardcoded AFTER this slot, so no order value inside the slot
     * can place a bar past it. Flex `order` sorts across the whole row instead:
     * the ContextMeter root (`.JObwrW_root`) declares no `order`, so it keeps the
     * default 0 and this item lands at the very end of the row.
     */
    /**
     * Every rule lives in a stylesheet, never inline.
     *
     * `useAnchoredPosition` returns ONLY `{left, top}`, and that object replaces
     * the panel's whole inline `style` — so a design carried inline disappears the
     * instant the panel is positioned. The shipped context meter avoids this the
     * same way: the panel wears a class, and the inline style is just coordinates.
     */
    const PANEL_CSS = `
.dsu-panel{position:fixed;z-index:1100;box-sizing:border-box;width:min(320px,100vw - 24px);padding:12px;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;font-size:12px;line-height:20px}
.dsu-header{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.dsu-title{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-primary);font-weight:600}
.dsu-headline{color:var(--dsw-alias-label-primary);font-weight:600;font-variant-numeric:tabular-nums}
.dsu-divider{height:1px;background:var(--dsw-alias-border-l1);margin:8px 0}
.dsu-group-title{color:var(--dsw-alias-label-caption);font-size:11px;margin-top:2px}
.dsu-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.dsu-label{color:var(--dsw-alias-label-tertiary);flex:none}
.dsu-value{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right;min-width:0;overflow-wrap:anywhere}
.dsu-value-error{color:var(--dsw-alias-state-error-primary)}
.dsu-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;color:var(--dsw-alias-label-tertiary)}
.dsu-refresh{display:inline-flex;align-items:center;justify-content:center;background:0 0;border:none;padding:2px;border-radius:var(--dsw-radius-sm);cursor:pointer;color:var(--dsw-alias-label-tertiary)}
.dsu-refresh:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dsu-refresh svg{display:block;transition:transform .15s ease}
.dsu-refresh:active svg{transform:rotate(-90deg)}
.dsu-bar{order:1;display:inline-flex;align-items:center;gap:6px;padding:1px 8px;border-radius:var(--dsw-radius-sm);font-family:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;cursor:pointer;user-select:none;background:0 0;border:none}
.dsu-bar:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dsu-dot{width:6px;height:6px;border-radius:50%;flex:none}
.dsu-dot-ok{background:var(--dsw-alias-state-success-primary)}
.dsu-dot-low{background:var(--dsw-alias-state-error-primary)}
.dsu-dot-unknown{background:var(--dsw-alias-label-quaternary)}
.dsu-pill{padding:0 6px;border-radius:999px;border:1px solid currentColor;font-size:11px;line-height:15px;font-weight:500;flex:none}
.dsu-pill-off{color:var(--dsw-alias-state-success-primary)}
.dsu-pill-peak{color:var(--dsw-alias-state-error-primary)}
`

    const STYLE_TAG = 'dsh-simple-usage-info/panel.css'

    /** Install the stylesheet once, tagged so the module system can withdraw it. */
    function installStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin-css="${STYLE_TAG}"]`) !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-simple-usage-info'
      tag.dataset.pluginCss = STYLE_TAG
      tag.textContent = PANEL_CSS
      document.head.appendChild(tag)
    }

    installStyles()

    // ---------------------------------------------------------------- schedule
    // Mirrors lib/pricing.js. Keep the two in step; the preflight sweeps them.

    /** `YYYY-MM-DD` for one instant's UTC date. */
    function utcDayKey(instant) {
      const date = new Date(instant)
      const pad = (value) => String(value).padStart(2, '0')
      return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
    }

    /**
     * Which window one instant falls in, per the published policy: peak only in
     * the listed UTC windows on a listed weekday, and never on a Chinese public
     * holiday.
     * @param schedule - the serialized schedule from the host.
     * @param instant - epoch milliseconds.
     * @returns the window and why it applies.
     */
    function windowAt(schedule, instant) {
      const date = new Date(instant)
      const key = utcDayKey(instant)
      if (schedule.holidays.indexOf(key) >= 0) return { window: OFF_PEAK, reason: 'holiday' }
      const makesUp = schedule.makeupWorkdaysArePeak === true && schedule.makeupWorkdays.indexOf(key) >= 0
      if (!makesUp && schedule.peakDays.indexOf(date.getUTCDay()) < 0) return { window: OFF_PEAK, reason: 'non-peak-day' }
      const minutes = date.getUTCHours() * 60 + date.getUTCMinutes()
      for (const window of schedule.peakWindows) {
        if (minutes >= window.start && minutes < window.end) return { window: PEAK, reason: 'peak-hours' }
      }
      return { window: OFF_PEAK, reason: 'outside-peak-hours' }
    }

    /**
     * The first instant after `instant` whose window differs. Same boundary scan
     * as the host: UTC midnights plus every window edge, eight days out.
     * @param schedule - the serialized schedule.
     * @param instant - epoch milliseconds.
     * @returns the next boundary, or `undefined`.
     */
    function nextWindowChange(schedule, instant) {
      const base = new Date(instant)
      const year = base.getUTCFullYear()
      const month = base.getUTCMonth()
      const day = base.getUTCDate()
      const current = windowAt(schedule, instant).window
      const candidates = []
      for (let offset = 0; offset <= 8; offset += 1) {
        const midnight = Date.UTC(year, month, day + offset, 0, 0, 0, 0)
        candidates.push(midnight)
        for (const window of schedule.peakWindows) {
          candidates.push(midnight + window.start * 60000)
          candidates.push(midnight + window.end * 60000)
        }
      }
      for (const candidate of candidates.filter((value) => value > instant).sort((left, right) => left - right)) {
        const state = windowAt(schedule, candidate)
        if (state.window !== current) return { at: candidate, window: state.window }
      }
      return { at: undefined, window: undefined }
    }

    /**
     * The complete billing reading for one instant.
     * @param schedule - the serialized schedule.
     * @param instant - epoch milliseconds.
     * @returns window, reason, discount, and the next transition.
     */
    function readWindow(schedule, instant) {
      const state = windowAt(schedule, instant)
      const next = nextWindowChange(schedule, instant)
      return {
        window: state.window,
        reason: state.reason,
        discountPercent: state.window === OFF_PEAK ? schedule.offPeakDiscountPercent : 0,
        nextChangeAt: next.at,
        nextWindow: next.window
      }
    }

    // -------------------------------------------------------------- formatting

    /** The viewer's own timezone, which only the browser knows. */
    const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

    const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    const STAMP_FORMAT = new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    })

    /** Why the window applies, in words. */
    const REASONS = {
      holiday: 'Chinese public holiday',
      'non-peak-day': 'not a peak weekday',
      'peak-hours': 'inside a peak window',
      'outside-peak-hours': 'outside the peak windows'
    }

    /** A rough, always-rounding-up countdown, so it never reads `0m` while pending. */
    function countdown(target, now) {
      if (typeof target !== 'number') return undefined
      const delta = target - (typeof now === 'number' ? now : Date.now())
      if (delta <= 0) return undefined
      const minutes = Math.ceil(delta / 60000)
      const hours = Math.floor(minutes / 60)
      if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`
      if (hours > 0) return `${hours}h ${minutes % 60}m`
      return `${minutes}m`
    }

    /**
     * The schedule's peak windows as wall-clock times in a timezone. Offsets are
     * read for the day of `instant`, so a DST shift shows correctly for today.
     * @param schedule - the serialized schedule.
     * @param instant - the reference instant.
     * @param zone - an IANA zone; defaults to the viewer's own.
     * @returns `09:00–12:00, 14:00–18:00`.
     */
    function localWindows(schedule, instant, zone) {
      const format =
        zone === undefined
          ? TIME_FORMAT
          : new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone })
      const date = new Date(instant)
      const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
      return schedule.peakWindows
        .map(
          (window) =>
            `${format.format(new Date(midnight + window.start * 60000))}–${format.format(new Date(midnight + window.end * 60000))}`
        )
        .join(', ')
    }

    /** The next transition as a wall-clock stamp in the viewer's timezone. */
    function localStamp(instant) {
      return typeof instant === 'number' ? STAMP_FORMAT.format(new Date(instant)) : undefined
    }

    /** Render one wallet as `¥110.00` / `$110.00` / `110.00 CHF`. */
    function formatWallet(info) {
      const amount = String(info?.total_balance ?? '')
      const currency = String(info?.currency ?? '')
      if (currency === 'CNY') return `¥${amount}`
      if (currency === 'USD') return `$${amount}`
      return currency === '' ? amount : `${amount} ${currency}`
    }

    /** A 6px status dot, green while the account can make API calls. */
    function dot(available, key) {
      const tone =
        available === true ? 'dsu-dot-ok' : available === false ? 'dsu-dot-low' : 'dsu-dot-unknown'
      return React.createElement('span', { key: key ?? 'dot', 'aria-hidden': true, className: `dsu-dot ${tone}` })
    }

    /**
     * The dock pill. Deliberately just the window name — the discount, the
     * reason, and every number live in the popover.
     */
    function priceBadge(pricing) {
      if (pricing === undefined || pricing === null || pricing.window === undefined) return null
      const offPeak = pricing.window === OFF_PEAK
      return React.createElement(
        'span',
        { key: 'window', className: `dsu-pill ${offPeak ? 'dsu-pill-off' : 'dsu-pill-peak'}` },
        offPeak ? 'Off-peak' : 'Peak'
      )
    }

    /**
     * One line of text for the dock. Shows "DeepSeek ¥19.41" if USD is empty or
     * zero, "DeepSeek ¥19.41 + $10.00" if both are funded, or "DeepSeek $10.00"
     * if CNY is empty; the popover carries the full breakdown.
     */
    function summarize(state) {
      if (state.status === 'loading') return 'DeepSeek …'
      if (state.status === 'error') return 'DeepSeek unavailable'
      const infos = state.payload?.balance?.balance_infos ?? []
      if (infos.length === 0) return 'DeepSeek no balance'
      const cny = infos.find((info) => info?.currency === 'CNY')
      const usd = infos.find((info) => info?.currency === 'USD')
      const hasCny = cny !== undefined && Number(cny.total_balance ?? 0) > 0
      const hasUsd = usd !== undefined && Number(usd.total_balance ?? 0) > 0

      if (hasCny && hasUsd) {
        return `DeepSeek ${formatWallet(cny)} + ${formatWallet(usd)}`
      }
      if (hasCny || (cny !== undefined && !hasUsd)) {
        return `DeepSeek ${formatWallet(cny)}`
      }
      if (hasUsd || usd !== undefined) {
        return `DeepSeek ${formatWallet(usd)}`
      }
      return `DeepSeek ${infos.map(formatWallet).join(' + ')}`
    }

    /**
     * The popover's contents as plain data, so they can be asserted without a DOM.
     * @param payload - the host's balance branch, or undefined.
     * @param pricing - the live billing reading.
     * @param now - skew-corrected epoch milliseconds.
     * @returns the headline, the label/value groups, and the footer.
     */
    function panelModel(payload, pricing, now) {
      const infos = payload?.ok === true ? (payload.balance?.balance_infos ?? []) : []
      const funded = infos.find((info) => Number(info?.total_balance ?? 0) > 0)
      // The API lists a permanently zero wallet first (USD beside a funded CNY),
      // so the funded wallet leads the panel. `sort` is stable, so the rest keep
      // the API's order.
      const ordered = [...infos].sort(
        (left, right) => (Number(left?.total_balance ?? 0) > 0 ? 0 : 1) - (Number(right?.total_balance ?? 0) > 0 ? 0 : 1)
      )

      const groups = []
      if (pricing !== undefined && pricing !== null && pricing.window !== undefined) {
        const offPeak = pricing.window === OFF_PEAK
        const rows = [
          { label: 'Billing', value: offPeak ? 'Off-peak' : 'Peak' },
          { label: 'Applies because', value: REASONS[pricing.reason] ?? String(pricing.reason) }
        ]
        const schedule = pricing.windows
        if (schedule !== undefined) {
          rows.push({ label: `Peak hours today (${ZONE})`, value: localWindows(schedule, now, undefined) })
        }
        const remaining = countdown(pricing.nextChangeAt, now)
        rows.push({
          label: 'Next switch',
          value:
            remaining === undefined
              ? '—'
              : `${pricing.nextWindow === PEAK ? 'peak' : 'off-peak'} in ${remaining} (${localStamp(pricing.nextChangeAt)})`
        })
        if (pricing.holidayCovered === false) {
          rows.push({ label: 'Holidays', value: `not bundled for ${pricing.holidayYear}` })
        }
        groups.push({ title: 'Billing window', rows })
      }

      for (const info of ordered) {
        groups.push({
          title: String(info.currency ?? 'balance'),
          rows: [
            { label: 'Total', value: formatWallet(info) },
            { label: 'Granted', value: formatWallet({ currency: info.currency, total_balance: info.granted_balance }) }
          ]
        })
      }

      const error =
        payload?.ok === false ? String(payload.error?.message ?? payload.error?.code ?? 'balance unavailable') : undefined

      return {
        headline: funded !== undefined ? formatWallet(funded) : '—',
        available: payload?.ok === true ? payload.balance?.is_available : undefined,
        groups,
        error,
        footer:
          typeof payload?.fetchedAt === 'number'
            ? `Read at ${TIME_FORMAT.format(new Date(payload.fetchedAt))}`
            : 'Not read yet'
      }
    }

    /** One label/value row. */
    function panelRow(row, index) {
      return React.createElement('div', { key: `row-${index}`, className: 'dsu-row' }, [
        React.createElement('span', { key: 'label', className: 'dsu-label' }, row.label),
        React.createElement('span', { key: 'value', className: 'dsu-value' }, row.value)
      ])
    }

    /** The refresh glyph: a stroked circular arrow, sized to the text line. */
    function refreshIcon() {
      return React.createElement(
        'svg',
        {
          key: 'glyph',
          viewBox: '0 0 24 24',
          width: 14,
          height: 14,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false
        },
        [
          React.createElement('polyline', { key: 'head', points: '23 4 23 10 17 10' }),
          React.createElement('path', { key: 'arc', d: 'M20.49 15a9 9 0 1 1-2.12-9.36L23 10' })
        ]
      )
    }

    /** The popover card, portaled to the body and positioned from its anchor. */
    function panelElement(model, position, panelRef, onRefresh) {
      const children = [
        React.createElement('div', { key: 'header', className: 'dsu-header' }, [
          React.createElement('span', { key: 'title', className: 'dsu-title' }, [
            dot(model.available, 'dot'),
            React.createElement('span', { key: 'text' }, 'DeepSeek account')
          ]),
          React.createElement('span', { key: 'headline', className: 'dsu-headline' }, model.headline)
        ])
      ]
      model.groups.forEach((group, groupIndex) => {
        children.push(React.createElement('div', { key: `divider-${groupIndex}`, className: 'dsu-divider' }))
        children.push(
          React.createElement('div', { key: `group-${groupIndex}` }, [
            React.createElement('div', { key: 'title', className: 'dsu-group-title' }, group.title),
            ...group.rows.map(panelRow)
          ])
        )
      })
      if (model.error !== undefined) {
        children.push(
          React.createElement('div', { key: 'error', className: 'dsu-row' }, [
            React.createElement('span', { key: 'label', className: 'dsu-label' }, 'Balance'),
            React.createElement('span', { key: 'value', className: 'dsu-value dsu-value-error' }, model.error)
          ])
        )
      }
      children.push(React.createElement('div', { key: 'footer-divider', className: 'dsu-divider' }))
      children.push(
        React.createElement('div', { key: 'footer', className: 'dsu-footer' }, [
          React.createElement('span', { key: 'read' }, model.footer),
          React.createElement(
            'button',
            {
              key: 'refresh',
              type: 'button',
              className: 'dsu-refresh',
              onClick: onRefresh,
              title: 'Refresh balance',
              'aria-label': 'Refresh balance'
            },
            refreshIcon()
          )
        ])
      )
      return React.createElement(
        'div',
        {
          ref: panelRef,
          className: 'dsu-panel',
          // The anchor hook returns ONLY coordinates, and this object replaces the
          // whole inline style — so it must never be the carrier of the design.
          style: position ?? { visibility: 'hidden', left: 0, top: 0 },
          role: 'dialog',
          'aria-label': 'DeepSeek account and billing window'
        },
        children
      )
    }

    /**
     * The dock entry. Reads the host route on mount and once a minute after,
     * re-evaluates the billing window every 20 s in between, and opens the
     * popover on click.
     * @returns the bar plus, while open, the portaled panel.
     */
    function UsageBar() {
      const [state, setState] = React.useState({ status: 'loading' })
      const [open, setOpen] = React.useState(false)
      const [, setTick] = React.useState(0)
      const alive = React.useRef(true)
      const rootRef = React.useRef(null)
      const panelRef = React.useRef(null)

      const load = React.useCallback(async (force) => {
        try {
          const response = await fetch(force === true ? `${PATH}?refresh=1` : PATH, {
            headers: { accept: 'application/json' },
            credentials: 'same-origin'
          })
          const body = await response.json().catch(() => undefined)
          if (alive.current !== true) return
          // The host sends `pricing` in both branches, so the billing window
          // stays on screen even when the balance read failed.
          const pricing = body?.pricing
          const skewMs = typeof pricing?.now === 'number' ? pricing.now - Date.now() : 0
          if (body !== undefined && body.ok === true) setState({ status: 'ready', payload: body, pricing, skewMs })
          else if (body !== undefined && body.ok === false)
            setState({ status: 'error', message: String(body.error?.message ?? 'unknown error'), pricing, skewMs })
          else setState({ status: 'error', message: `HTTP ${response.status}` })
        } catch (error) {
          if (alive.current === true)
            setState((previous) => ({
              status: 'error',
              message: String(error?.message ?? error),
              pricing: previous.pricing,
              skewMs: previous.skewMs
            }))
        }
      }, [])

      React.useEffect(() => {
        alive.current = true
        load(false)
        const poll = setInterval(() => load(false), POLL_MS)
        const tick = setInterval(() => setTick((count) => count + 1), TICK_MS)
        return () => {
          alive.current = false
          clearInterval(poll)
          clearInterval(tick)
        }
      }, [load])

      React.useEffect(() => {
        if (open !== true) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [open])

      const position = primitives.useAnchoredPosition({
        open,
        anchorRef: rootRef,
        panelRef,
        side: 'top',
        gap: 8,
        margin: 12
      })
      primitives.useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef)

      // Billing time is the host's clock, corrected for this browser's skew, so a
      // wrong local clock cannot mis-report the price.
      const now = Date.now() + (state.skewMs ?? 0)
      const host = state.pricing
      const schedule = host?.windows
      const pricing =
        schedule !== undefined
          ? {
              ...readWindow(schedule, now),
              schedule: host.schedule,
              holidayYear: host.holidayYear,
              holidayCovered: host.holidayCovered,
              windows: schedule
            }
          : host

      const available = state.status === 'ready' ? state.payload?.balance?.is_available : undefined
      const bar = React.createElement(
        'span',
        {
          key: 'bar',
          ref: rootRef,
          role: 'button',
          tabIndex: 0,
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          title: 'DeepSeek balance and billing window',
          onClick: () => setOpen((value) => value !== true),
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setOpen((value) => value !== true)
            }
          },
          className: 'dsu-bar'
        },
        [dot(available), React.createElement('span', { key: 'text' }, summarize(state)), priceBadge(pricing)]
      )

      return React.createElement(React.Fragment, null, [
        bar,
        open === true
          ? ReactDOM.createPortal(
              panelElement(panelModel(state.payload, pricing, now), position, panelRef, () => load(true)),
              document.body
            )
          : null
      ])
    }

    /** Cordis services this browser plugin needs. */
    const inject = ['slots']

    /**
     * Client plugin body: one entry in the composer dock.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.composer.dock',
            id: ID,
            order: 50
          },
          UsageBar
        )
      )
    }

    exports.UsageBar = UsageBar
    exports.apply = apply
    exports.inject = inject
    // Exported for the offline preflight; not part of the plugin contract.
    exports.formatWallet = formatWallet
    exports.summarize = summarize
    exports.priceBadge = priceBadge
    exports.panelModel = panelModel
    exports.countdown = countdown
    exports.windowAt = windowAt
    exports.readWindow = readWindow
    exports.localWindows = localWindows
    exports.zone = ZONE
    exports.panelElement = panelElement
    exports.PANEL_CSS = PANEL_CSS
    return module.exports
  }
})
