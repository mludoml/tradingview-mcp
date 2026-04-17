# TradingView MCP — NanoClaw Integration

## Kontekst NanoClaw

Ten katalog to git submodule repo `nanoclaw` (`projects/tradingview-mcp/`).
Używany wyłącznie przez instancję **mac-trading** (`~/nanoclaw-trading/`).

### Architektura połączenia

```
Telegram → mac-trading (Node.js) → Docker container (agent)
                                           ↓ stdio (bezpośrednio, bez supergateway)
                                   /workspace/tradingview-mcp/src/server.js
                                           ↓ CDP_HOST=host.docker.internal:9222
                                   TradingView Desktop (CDP)
```

### Uruchamianie

**TradingView Desktop** (wymagane przed użyciem narzędzi, domyślny port 9222):
```bash
open -a "TradingView" --args --remote-debugging-port=9222
```

### Konfiguracja

| Plik | Rola |
|------|------|
| `rules.json` | Twoje reguły tradingowe (nie syncowane z upstream) |
| `~/nanoclaw-trading/.env` → `TRADINGVIEW_MCP_PATH` | Ścieżka do katalogu submodułu |
| `src/connection.js` | `CDP_HOST`/`CDP_PORT` env vars (dodane przez nas) |


### Aktualizacja submodułu (upstream)

```bash
cd ~/Projects/nanoclaw/projects/tradingview-mcp
git pull origin main
cd ~/Projects/nanoclaw
git add projects/tradingview-mcp
git commit -m "chore: update tradingview-mcp submodule"
```

### Rozwój i customizacja

Zmiany w `src/` trafiają do repo submodułu (osobny git, upstream = tradesdontlie/tradingview-mcp).
Zmiany w integracji NanoClaw (port, launchd, konfiguracja agenta) → repo nanoclaw (`src/config.ts`, `src/container-runner.ts`).

---

# TradingView MCP — Claude Instructions

78 tools for reading and controlling a live TradingView Desktop chart via CDP (port 9222).

## Decision Tree — Which Tool When

### "What's on my chart right now?"

1. `chart_get_state` → symbol, timeframe, chart type, list of all indicators with entity IDs
2. `data_get_study_values` → current numeric values from all visible indicators (RSI, MACD, BBands, EMAs, etc.)
3. `quote_get` → real-time price, OHLC, volume for current symbol

### "What levels/lines/labels are showing?"

Custom Pine indicators draw with `line.new()`, `label.new()`, `table.new()`, `box.new()`. These are invisible to normal data tools. Use:

1. `data_get_pine_lines` → horizontal price levels drawn by indicators (deduplicated, sorted high→low)
2. `data_get_pine_labels` → text annotations with prices (e.g., "PDH 24550", "Bias Long ✓")
3. `data_get_pine_tables` → table data formatted as rows (e.g., session stats, analytics dashboards)
4. `data_get_pine_boxes` → price zones / ranges as {high, low} pairs

Use `study_filter` parameter to target a specific indicator by name substring (e.g., `study_filter: "Profiler"`).

### "Give me price data"

- `data_get_ohlcv` with `summary: true` → compact stats (high, low, range, change%, avg volume, last 5 bars)
- `data_get_ohlcv` without summary → all bars (use `count` to limit, default 100)
- `quote_get` → single latest price snapshot
- `depth_get` → order book / DOM (Depth of Market) — requires DOM panel open in TradingView

### "Analyze my chart" (full report workflow)

1. `quote_get` → current price
2. `data_get_study_values` → all indicator readings
3. `data_get_pine_lines` → key price levels from custom indicators
4. `data_get_pine_labels` → labeled levels with context (e.g., "Settlement", "ASN O/U")
5. `data_get_pine_tables` → session stats, analytics tables
6. `data_get_ohlcv` with `summary: true` → price action summary
7. `capture_screenshot` → visual confirmation

### "Change the chart"

- `chart_set_symbol` → switch ticker (e.g., "AAPL", "ES1!", "NYMEX:CL1!")
- `chart_set_timeframe` → switch resolution (e.g., "1", "5", "15", "60", "D", "W")
- `chart_set_type` → switch chart style (Candles, HeikinAshi, Line, Area, Renko, etc.)
- `chart_manage_indicator` → add or remove studies (use full name: "Relative Strength Index", not "RSI")
- `chart_scroll_to_date` → jump to a date (ISO format: "2025-01-15")
- `chart_set_visible_range` → zoom to exact date range (unix timestamps)

### "Work on Pine Script"

1. `pine_set_source` → inject code into editor
2. `pine_smart_compile` → compile with auto-detection + error check
3. `pine_get_errors` → read compilation errors
4. `pine_get_console` → read log.info() output
5. `pine_get_source` → read current code back (WARNING: can be very large for complex scripts)
6. `pine_save` → save to TradingView cloud
7. `pine_new` → create blank indicator/strategy/library
8. `pine_open` → load a saved script by name

### "Analyze a strategy backtest"

- `data_get_strategy_results` → performance metrics (profit factor, win rate, max drawdown, etc.) — requires strategy on chart
- `data_get_trades` → trade list from Strategy Tester (pass `max_trades` to limit)
- `data_get_equity` → equity curve data from Strategy Tester

### "Practice trading with replay"

1. `replay_start` with `date: "2025-03-01"` → enter replay mode
2. `replay_step` → advance one bar
3. `replay_autoplay` → auto-advance (set speed with `speed` param in ms)
4. `replay_trade` with `action: "buy"/"sell"/"close"` → execute trades
5. `replay_status` → check position, P&L, current date
6. `replay_stop` → return to realtime

### "Manage tabs and multi-chart layout"

Tabs (multiple chart windows):
- `tab_list` → see all open tabs with index, ID, URL
- `tab_switch` → switch to tab by index (from `tab_list`)
- `tab_new` → open a new chart tab
- `tab_close` → close the current tab

Panes (split layout within one tab):
- `pane_list` → list all panes with symbols; returns current layout code
- `pane_set_layout` → change grid layout (`s`=single, `2h`, `2v`, `4`=2x2, `6`, `8`, etc.)
- `pane_set_symbol` → set symbol on a specific pane by index
- `pane_focus` → focus a specific pane by index (required before chart operations on that pane)

### "Screen multiple symbols"

- `batch_run` with `symbols: ["ES1!", "NQ1!", "YM1!"]` and `action: "screenshot"` or `"get_ohlcv"`

### "Draw on the chart"

- `draw_shape` → horizontal_line, trend_line, rectangle, text (pass point + optional point2)
  - `rectangle` uses `_createMultipointShape` + `setPoints` internally (fixed 2026-04-16) — returns real `entity_id`
- `draw_list` → see what's drawn
- `draw_remove_one` → remove by ID
- `draw_clear` → remove all drawings using `removeAllDrawingTools()` (safe — won't corrupt draw state)

### "Manage alerts"

- `alert_create` → set price alert (condition: "crossing", "greater_than", "less_than")
- `alert_list` → view active alerts
- `alert_delete` → remove alerts

### "Navigate the UI"

High-level:
- `ui_open_panel` → open/close pine-editor, strategy-tester, watchlist, alerts, trading
- `ui_click` → click buttons by aria-label, text, or data-name
- `layout_switch` → load a saved layout by name
- `ui_fullscreen` → toggle fullscreen
- `capture_screenshot` → take a screenshot (regions: "full", "chart", "strategy_tester")
- `tv_ui_state` → get current UI state: which panels are open, all visible buttons with x,y positions

Low-level (when `ui_click` isn't enough):
- `ui_evaluate` → run arbitrary JS in TradingView page context; use `await_promise: true` for async TV APIs (e.g., `_createMultipointShape`)
- `ui_find_element` → find element by text/aria-label/CSS selector, returns position
- `ui_mouse_click` → click at exact x,y coordinates (use `tv_ui_state` or `ui_find_element` to get coords)
- `ui_hover` → hover over element by aria-label/data-name/text (triggers tooltips/dropdowns)
- `ui_scroll` → scroll chart or page in any direction (pixels, default 300)
- `ui_keyboard` → press keys or shortcuts (e.g., `key: "Escape"`, `key: "s"`, `modifiers: ["ctrl"]`)
- `ui_type_text` → type text into the currently focused input

### "TradingView isn't running"

- `tv_launch` → auto-detect and launch TradingView with CDP on Mac/Win/Linux
- `tv_health_check` → verify connection is working
- `tv_discover` → report available TradingView API paths and methods (diagnostics/dev)

## Context Management Rules

These tools can return large payloads. Follow these rules to avoid context bloat:

1. **Always use `summary: true` on `data_get_ohlcv`** unless you specifically need individual bars
2. **Always use `study_filter`** on pine tools when you know which indicator you want — don't scan all studies unnecessarily
3. **Never use `verbose: true`** on pine tools unless the user specifically asks for raw drawing data with IDs/colors
4. **Avoid calling `pine_get_source`** on complex scripts — it can return 200KB+. Only read if you need to edit the code.
5. **Avoid calling `data_get_indicator`** on protected/encrypted indicators — their inputs are encoded blobs. Use `data_get_study_values` instead for current values.
6. **Use `capture_screenshot`** for visual context instead of pulling large datasets — a screenshot is ~300KB but gives you the full visual picture
7. **Call `chart_get_state` once** at the start to get entity IDs, then reference them — don't re-call repeatedly
8. **Cap your OHLCV requests** — `count: 20` for quick analysis, `count: 100` for deeper work, `count: 500` only when specifically needed

### Output Size Estimates (compact mode)


| Tool                        | Typical Output                                 |
| --------------------------- | ---------------------------------------------- |
| `quote_get`                 | ~200 bytes                                     |
| `data_get_study_values`     | ~500 bytes (all indicators)                    |
| `data_get_pine_lines`       | ~1-3 KB per study (deduplicated levels)        |
| `data_get_pine_labels`      | ~2-5 KB per study (capped at 50)               |
| `data_get_pine_tables`      | ~1-4 KB per study (formatted rows)             |
| `data_get_pine_boxes`       | ~1-2 KB per study (deduplicated zones)         |
| `data_get_ohlcv` (summary)  | ~500 bytes                                     |
| `data_get_ohlcv` (100 bars) | ~8 KB                                          |
| `capture_screenshot`        | ~300 bytes (returns file path, not image data) |


## Tool Conventions

- All tools return `{ success: true/false, ... }`
- Entity IDs (from `chart_get_state`) are session-specific — don't cache across sessions
- Pine indicators must be **visible** on chart for pine graphics tools to read their data
- `chart_manage_indicator` requires **full indicator names**: "Relative Strength Index" not "RSI", "Moving Average Exponential" not "EMA", "Bollinger Bands" not "BB"
- Screenshots save to `screenshots/` directory with timestamps
- OHLCV capped at 500 bars, trades at 20 per request
- Pine labels capped at 50 per study by default (pass `max_labels` to override)

## Architecture

```
Claude Code ←→ MCP Server (stdio) ←→ CDP (localhost:9222) ←→ TradingView Desktop (Electron)
```

Pine graphics path: `study._graphics._primitivesCollection.dwglines.get('lines').get(false)._primitivesDataById`