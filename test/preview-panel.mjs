/** Print the popover's real markup and stylesheet for a visual sanity check. */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
let reg
globalThis.window = { __ModuleLoader__: { load: (row) => { reg = row } } }
await import('../lib/client.js')
const seed = { react: React, 'react-dom': require('react-dom'), '@deepseek-ai/dsh-client-ui-primitives': { useAnchoredPosition: () => null, useDismissOnOutsidePointer: () => {}, Tooltip: () => null } }
const x = reg.factory((n) => seed[n])
const wire = { peakWindows: [{ start: 60, end: 240, label: '01:00-04:00' }, { start: 360, end: 600, label: '06:00-10:00' }], peakDays: [1,2,3,4,5], holidays: ['2026-10-01'], makeupWorkdays: [], makeupWorkdaysArePeak: false, offPeakDiscountPercent: 50, coveredYears: [2026] }
const pricing = { ...x.readWindow(wire, Date.UTC(2026,9,1,2)), windows: wire, holidayYear: 2026, holidayCovered: true, schedule: 'x' }
const payload = { ok: true, fetchedAt: Date.UTC(2026,9,1,11,4), balance: { is_available: true, balance_infos: [{ currency: 'USD', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' }, { currency: 'CNY', total_balance: '22.07', granted_balance: '0.00', topped_up_balance: '22.07' }] } }
const model = x.panelModel(payload, pricing, Date.UTC(2026,9,1,11,4))
console.log('--- model ---'); console.log(JSON.stringify(model, null, 1))
console.log('\n--- markup ---'); console.log(renderToStaticMarkup(x.panelElement(model, { left: 40, top: 100 }, { current: null }, () => {})))
console.log('\n--- bar ---'); console.log(renderToStaticMarkup(React.createElement(x.UsageBar)))
console.log('\n--- css (first 3 rules) ---'); console.log(x.PANEL_CSS.trim().split('\n').slice(0,3).join('\n'))
