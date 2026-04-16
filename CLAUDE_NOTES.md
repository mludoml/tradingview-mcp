# TradingView MCP — Notatki z sesji (2026-04-15)

Obserwacje z praktycznego użycia, bugi i workaroundy.

---

## Problemy krytyczne

### 1. `draw_list` / `draw_get_properties` / `draw_remove_one` / `draw_clear` — "getChartApi is not defined" — ✅ NAPRAWIONE (2026-04-15)

**Problem:** Narzędzia `draw_list`, `draw_get_properties`, `draw_remove_one`, `draw_clear` rzucały
błąd "getChartApi is not defined" przy każdym wywołaniu.

**Prawdziwa przyczyna (nie KNOWN_PATHS!):** Bug w `src/core/drawing.js` — cztery funkcje
(`listDrawings`, `getProperties`, `removeOne`, `clearAll`) używały `getChartApi()` i `evaluate()`
bezpośrednio, ale te nazwy nie istniały w ich scope. Import jest z aliasem:
```js
import { evaluate as _evaluate, getChartApi as _getChartApi, ... } from '../connection.js';
```
Tylko `drawShape` działał poprawnie bo używa `_resolve(_deps)` który tworzy lokalne zmienne.
Pozostałe funkcje powinny używać `_getChartApi()` i `_evaluate()`.

**Fix:** W `src/core/drawing.js` zmieniono `getChartApi()` → `_getChartApi()` i `evaluate()` → `_evaluate()`
w funkcjach: `listDrawings`, `getProperties`, `removeOne`, `clearAll`.

**Weryfikacja:** `draw_list` zwróciło 27 shapes. `draw_get_properties`, `draw_remove_one` działają poprawnie.

---

### 2. `draw_shape` (rectangle) — shapes niewidoczne, `entity_id: null`

**Problem:** `draw_shape` z `shape: 'rectangle'` zwraca `{ success: true, entity_id: null }`.
Prostokąty nie pojawiają się na wykresie.

**Przyczyna:** `createMultipointShape` (bez podkreślnika) tworzy shape ale **bez punktów** (`getPoints()` zwraca null).
Shape istnieje w `getAllShapes()` ale nie ma współrzędnych, więc nie renderuje.

**Rozwiązanie:** Użyj `_createMultipointShape` (z podkreślnikiem) + wywołaj `setPoints()` po stworzeniu.
Szczegóły poniżej.

---

### 3. `removeAllShapes()` — niszczy stan API

**Problem:** Po wywołaniu `api.removeAllShapes()`, żadne kolejne wywołania `_createMultipointShape`
nie działają — zwracają Promise który nigdy nie dodaje shape do `getAllShapes()`.

**Workaround:** Zamiast `removeAllShapes()`, usuwaj shapes indywidualnie przez `api.removeEntity(id)`.
Albo używaj `removeAllDrawingTools()` z `_exposed_chartWidgetCollection`.

**WAŻNE:** Nigdy nie wywoływać `removeAllShapes()` jeśli planujesz rysować nowe shapes w tej samej sesji!

---

### 4. `_createMultipointShape` — asynchroniczny, tylko jeden naraz

**Problem:** `_createMultipointShape` zwraca **Promise**, nie obiekt shape. Shape pojawia się
w `getAllShapes()` dopiero po ~3–5 sekund w osobnym `evaluate()`.

**Problemy:**
- `ui_evaluate` NIE awaits Promises (domyślnie `awaitPromise: false`)
- Można tworzyć tylko jeden shape naraz — drugi nie startuje dopóki pierwszy się nie zresolwuje
- `.then(s => ...)` — `s` to **string** (entity ID), nie obiekt shape. Trzeba `api.getShapeById(s)`
- Kolory w formacie `#RRGGBBAA` (8 znaków hex) mogą powodować odrzucenie Promise dla niektórych stref

**Poprawny workflow:**
```js
// W jednym evaluate:
api._createMultipointShape([p1, p2], { shape: 'rectangle', overrides: {...} })
  .then(function(id) {
    var s = api.getShapeById(id);  // id to string, nie obiekt!
    if (s) s.setPoints([p1, p2]);
    window._done = true;
    // Tutaj można chainować kolejny _createMultipointShape
  })
  .catch(function(e) { window._err = e.message; });

// W osobnym evaluate (po ~5s):
window._done  // sprawdź czy gotowe
```

**Sekwencyjne tworzenie wielu shapes — jedyny działający pattern:**
```js
function createZone(api, p1, p2, overrides) {
  return api._createMultipointShape([p1, p2], { shape: 'rectangle', overrides })
    .then(function(id) {
      var s = api.getShapeById(id);
      if (s) s.setPoints([p1, p2]);
      return id;
    });
}

// Chain:
createZone(api, ...).then(() => createZone(api, ...)).then(() => createZone(api, ...))
  .then(() => { window._allDone = true; });

// Czekaj ~5s * N shapes przed sprawdzeniem
```

---

### 5. Kolory — format

**Działają:** `rgba(255, 152, 0, 0.33)`, `rgba(38, 166, 154, 1)`
**Nie działają (czasem):** `#ff980055` (8-znakowy hex z alpha) — Promise odrzucony z błędem "Passed color string does not match any of the known color representations"

**Rekomendacja:** Zawsze używaj formatu `rgba()` dla wszystkich kolorów w overrides.

---

### 6. `evaluateAsync` nie jest wystawiony przez `ui_evaluate`

**Problem:** `ui_evaluate` MCP tool używa `evaluate()` z `awaitPromise: false`.
Funkcja `evaluateAsync` istnieje w `connection.js` ale nie jest używana przez żaden tool.

**Fix sugerowany:** Dodać nowy tool `ui_evaluate_async` który używa `evaluateAsync()`,
lub dodać opcjonalny parametr `await_promise: boolean` do istniejącego `ui_evaluate`.

---

## Poprawny sposób czyszczenia rysunków

Zamiast `draw_clear` (broken) lub `removeAllShapes()` (niszczy stan):

```js
// Opcja 1: removeAllDrawingTools (bezpieczne)
window._exposed_chartWidgetCollection.activeChartWidget.value().removeAllDrawingTools()

// Opcja 2: usuwanie po ID (jeśli masz IDs)
const api = window.TradingViewApi._activeChartWidgetWV.value();
api.getAllShapes().forEach(s => api.removeEntity(s.id));
// UWAGA: po tym _createMultipointShape też przestaje działać!
```

---

## Poprawny sposób rysowania stref

Kompletny działający przykład (wklejić do `ui_evaluate`):

```js
(function() {
  const api = window.TradingViewApi._activeChartWidgetWV.value();
  const t1 = 1775376000;  // unix timestamp lewej krawędzi
  const t2 = 1777200000;  // unix timestamp prawej krawędzi (przyszłość)

  const zones = [
    { p1: 76200, p2: 75500, bg: 'rgba(239,83,80,0.4)',   line: 'rgba(239,83,80,1)',   lw: 2 },
    { p1: 73700, p2: 73200, bg: 'rgba(38,166,154,0.33)', line: 'rgba(38,166,154,1)',  lw: 2 },
  ];

  zones.reduce(function(chain, z) {
    return chain.then(function() {
      return api._createMultipointShape(
        [{ time: t1, price: z.p1 }, { time: t2, price: z.p2 }],
        { shape: 'rectangle', overrides: {
            fillBackground: true,
            backgroundColor: z.bg,
            color: z.line,
            linewidth: z.lw
        }}
      ).then(function(id) {
        var s = api.getShapeById(id);
        if (s) s.setPoints([{ time: t1, price: z.p1 }, { time: t2, price: z.p2 }]);
      });
    });
  }, Promise.resolve()).then(function() { window._zonesReady = true; });

  return 'creating zones...';  // sprawdź window._zonesReady po ~5s * N
})()
```

---

## To do / sugerowane fixy

| Priorytet | Problem | Fix |
|-----------|---------|-----|
| ✅ DONE | `draw_list` / `draw_get_properties` / `draw_remove_one` / `draw_clear` broken | Naprawiono bug importu w `src/core/drawing.js` (2026-04-15) |
| HIGH | `draw_shape` nie działa | Przepisać na `_createMultipointShape` + `setPoints` pattern |
| HIGH | `removeAllShapes()` niszczy stan | Zastąpić `removeEntity()` per shape lub `removeAllDrawingTools()` |
| MED | `ui_evaluate` nie awaits Promises | Dodać `ui_evaluate_async` tool lub parametr `await_promise` |
| MED | Kolory hex z alpha | Walidacja i auto-konwersja do `rgba()` przed przekazaniem do API |
| LOW | Czas tworzenia shape (~3–5s) | Zbadać czy da się przyspieszyć (może inny endpoint TV) |

---

## Uwagi ogólne

- **`ui_evaluate`** jest najważniejszym narzędziem w całym MCP — pozwala obejść wszystkie broken tools
- **`_exposed_chartWidgetCollection`** i **`TradingViewApi._activeChartWidgetWV`** to dwie różne ścieżki do tej samej chart widget — obie działają
- TradingView Desktop v2.14.0 (Electron 38.2.2, Chrome 140) — API może się różnić od web
- Shapes są zapisywane do chmury TV automatycznie — zostają po zamknięciu aplikacji
- `getAllShapes()` jest synchroniczne ale shape pojawia się tam z opóźnieniem po `_createMultipointShape`
- Timestampy shapes są snapowane do najbliższego słupka: `1775600000 → 1775592000`
