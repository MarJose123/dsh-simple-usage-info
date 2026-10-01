# dsh-simple-usage-info

[![npm](https://img.shields.io/npm/v/dsh-simple-usage-info.svg)](https://www.npmjs.com/package/dsh-simple-usage-info)
[![license](https://img.shields.io/npm/l/dsh-simple-usage-info.svg)](LICENSE)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that puts your
**DeepSeek API balance** and the **current billing window** in the composer dock — the ambient row
directly below the message input, after the context meter.

```
┌──────────────────────────────────────────────────────────┐
│  Ask anything…                                           │
│                                            [ model ]  ▸  │
└──────────────────────────────────────────────────────────┘
                    ◐ 12%   ● DeepSeek ¥22.48  (Off-peak)
```

Click the bar for the full breakdown:

```
● DeepSeek account                                    ¥22.48
─────────────────────────────────────────────────────────────
Billing window
Billing                              Off-peak
Applies because          Chinese public holiday
Peak hours today (Asia/Manila)   09:00–12:00, 14:00–18:00
Next switch              peak in 6d 13h (Thu 09:00)
─────────────────────────────────────────────────────────────
CNY
Total                                 ¥22.48
Granted                                ¥0.00
─────────────────────────────────────────────────────────────
USD
Total                                  $0.00
Granted                                $0.00
─────────────────────────────────────────────────────────────
Read at 19:04                                     (⟳)
```

The pill reads **Off-peak** (green) or **Peak** (red). The balance is read with the same
`DEEPSEEK_API_KEY` credential the `deepseek-official` model route resolves — no extra setup. The
billing window is computed in your browser's timezone and drawn from the published rule: off-peak is
half price, peak is 01:00–04:00 and 06:00–10:00 UTC, Monday–Friday, excluding Chinese public
holidays. The holiday list is fetched from
[NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn), which scrapes the State Council
announcements daily, so it keeps itself current.

## Requirements

- DeepSeek Harness `0.2.0-rc.2` or later
- Node 20+
- A `DEEPSEEK_API_KEY` credential (the Models page writes one, or export it before launching)

## Install

### Recommended — the DSH plugin manager

The plugin manager forwards to `pnpm`, so install that first if it is missing:

```sh
bun add -g pnpm        # or: corepack enable pnpm / npm i -g pnpm
dsh plugin --profile web add dsh-simple-usage-info
```

This installs the package, records it in the profile's `dependencies`, and appends it to
`dsh.profile.bundles`. Because the package declares `dsh.bundle.patch`, its own `cordis.patch.yml`
then supplies the loader row — there is nothing else to edit.

Restart the web server (`dsh web`) when it finishes.

### Manual — a `cordis.patch.yml` row

Use this when the package is already somewhere the profile can resolve (a local checkout, a
workspace link, a private registry). Append to `$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: usage-info
      name: dsh-simple-usage-info
```

Restart the web server. Use **either** this row **or** the `bundles` entry from the recommended
path, never both, or the plugin loads twice.

### Manual without pnpm — add the dependency yourself

`dsh plugin` only knows how to shell out to pnpm. Without it, do the two halves by hand.

**1. Make the package resolvable from the profile.** Either install it with any package manager:

```sh
cd "$DSH_HOME/profiles/web"
bun add dsh-simple-usage-info     # or: npm install dsh-simple-usage-info
```

…or link a local checkout:

```sh
mkdir -p "$DSH_HOME/profiles/web/node_modules"
ln -sfn /absolute/path/to/dsh-simple-usage-info \
        "$DSH_HOME/profiles/web/node_modules/dsh-simple-usage-info"
```

and declare it in `$DSH_HOME/profiles/web/package.json`, because DSH treats a name as profile-local
only when the manifest lists it:

```json
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {
    "dsh-simple-usage-info": "link:/absolute/path/to/dsh-simple-usage-info"
  },
  "dsh": {
    "profile": {
      "bundles": [
         ////
      ]
    }
  }
}
```

**2. Activate it** with the `cordis.patch.yml` row above, or by adding `"dsh-simple-usage-info"` to
the `dsh.profile.bundles` array.

Restart the web server.

## Configure

Set these under the `usage-info` row, in the profile's `cordis.patch.yml`:

| Key | Default | Meaning |
|---|---|---|
| `refreshMs` | `60000` | how long one balance answer stays fresh |
| `timeoutMs` | `15000` | upstream request timeout |
| `baseURL` | `https://api.deepseek.com` | API origin |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | credential name holding the key |
| `peakWindows` | `['01:00-04:00', '06:00-10:00']` | peak windows, `HH:MM-HH:MM` UTC |
| `peakDays` | `[1, 2, 3, 4, 5]` | peak weekdays, `0` = Sunday |
| `holidayURL` | holiday-cn `{year}.json` | maintained holiday source; `''` goes offline |
| `holidayRefreshMs` | `43200000` | how long a fetched holiday snapshot stays fresh |
| `useBundledHolidays` | `true` | keep the bundled table as an offline fallback |
| `holidays` | `[]` | extra `YYYY-MM-DD` dates, added on top of the fetched list |
| `makeupWorkdaysArePeak` | `false` | treat 调休 makeup workdays as peak days |
| `makeupWorkdays` | `[]` | extra `YYYY-MM-DD` makeup workdays |
| `offPeakDiscountPercent` | `50` | reported as `pricing.discountPercent` |

For example:

```yaml
- id: usage-info
  config:
    peakWindows:
      - '01:00-04:00'
      - '06:00-10:00'
    holidays:
      - 2027-01-01
```

A malformed schedule (a bad clock, a window wrapping past midnight, a day outside 0–6) fails at
plugin load, so the row is skipped with a clear error instead of answering requests with a broken
window.

## Verify

```sh
# the route, once the server is running:
curl -s -H 'Host: 127.0.0.1:3080' http://127.0.0.1:3080/usage/balance

# the plugin really composes into a profile (throwaway home, your profile untouched):
bun run verify:compose
```

`pricing.holidayData` in the response tells you where the holidays came from — `remote` (fetched),
`bundled` (offline fallback), or `none`.

## Development

```sh
bun install
bun run preflight          # host, pricing, holidays, client — 200+ assertions, no network
bun run preflight:live     # real balance + holiday fetch; prints the masked key only
bun run preview:panel      # prints the popover markup and stylesheet, no browser needed
```

There is no build step: `lib/index.js` is plain ESM, and `lib/client.js` is hand-authored in the web
client's module-loader bundle format. Neither half needs a bundler.

### Preparation for release 

**release via CI.** Bump the version, then cut a GitHub Release:

```sh
npm version 0.1.1 --no-git-tag-version
git commit -am "Release 0.1.1" && git push
gh release create v0.1.1 --generate-notes
```


## License

[MIT](LICENSE)
