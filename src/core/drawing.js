/**
 * Core drawing logic.
 */
import { evaluate as _evaluate, evaluateAsync as _evaluateAsync, getChartApi as _getChartApi, safeString, requireFinite } from '../connection.js';

/**
 * Convert #RRGGBBAA (8-char hex with alpha) to rgba() format.
 * TradingView rejects 8-char hex colors in some shape overrides.
 */
function normalizeColor(value) {
  if (typeof value !== 'string') return value;
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(value.trim());
  if (m) {
    const r = parseInt(m[1].slice(0, 2), 16);
    const g = parseInt(m[1].slice(2, 4), 16);
    const b = parseInt(m[1].slice(4, 6), 16);
    const a = (parseInt(m[2], 16) / 255).toFixed(2);
    return `rgba(${r},${g},${b},${a})`;
  }
  return value;
}

/**
 * Walk an overrides object and normalize all color string values.
 */
function normalizeOverrideColors(overrides) {
  if (!overrides || typeof overrides !== 'object') return overrides;
  const result = {};
  for (const [k, v] of Object.entries(overrides)) {
    result[k] = typeof v === 'string' ? normalizeColor(v) : v;
  }
  return result;
}

function _resolve(deps) {
  return { evaluate: deps?.evaluate || _evaluate, getChartApi: deps?.getChartApi || _getChartApi };
}

export async function drawShape({ shape, point, point2, overrides: overridesRaw, text, _deps }) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const rawOverrides = overridesRaw ? (typeof overridesRaw === 'string' ? JSON.parse(overridesRaw) : overridesRaw) : {};
  const overrides = normalizeOverrideColors(rawOverrides);
  const apiPath = await getChartApi();
  const overridesStr = JSON.stringify(overrides);
  const textStr = text ? JSON.stringify(text) : '""';

  const p1time = requireFinite(point.time, 'point.time');
  const p1price = requireFinite(point.price, 'point.price');

  // Rectangle requires _createMultipointShape (async) + setPoints to actually render.
  // createMultipointShape (no underscore) creates shape without points → invisible.
  if (shape === 'rectangle' && point2) {
    const p2time = requireFinite(point2.time, 'point2.time');
    const p2price = requireFinite(point2.price, 'point2.price');
    const entityId = await _evaluateAsync(`
      (function() {
        var api = ${apiPath};
        return api._createMultipointShape(
          [{ time: ${p1time}, price: ${p1price} }, { time: ${p2time}, price: ${p2price} }],
          { shape: 'rectangle', overrides: ${overridesStr} }
        ).then(function(id) {
          var s = api.getShapeById(id);
          if (s) s.setPoints([{ time: ${p1time}, price: ${p1price} }, { time: ${p2time}, price: ${p2price} }]);
          return id;
        });
      })()
    `);
    return { success: true, shape, entity_id: entityId || null };
  }

  const before = await evaluate(`${apiPath}.getAllShapes().map(function(s) { return s.id; })`);

  if (point2) {
    const p2time = requireFinite(point2.time, 'point2.time');
    const p2price = requireFinite(point2.price, 'point2.price');
    await evaluate(`
      ${apiPath}.createMultipointShape(
        [{ time: ${p1time}, price: ${p1price} }, { time: ${p2time}, price: ${p2price} }],
        { shape: ${safeString(shape)}, overrides: ${overridesStr}, text: ${textStr} }
      )
    `);
  } else {
    await evaluate(`
      ${apiPath}.createShape(
        { time: ${p1time}, price: ${p1price} },
        { shape: ${safeString(shape)}, overrides: ${overridesStr}, text: ${textStr} }
      )
    `);
  }

  await new Promise(r => setTimeout(r, 200));
  const after = await evaluate(`${apiPath}.getAllShapes().map(function(s) { return s.id; })`);
  const newId = (after || []).find(id => !(before || []).includes(id)) || null;
  return { success: true, shape, entity_id: newId };
}

export async function listDrawings() {
  const apiPath = await _getChartApi();
  const shapes = await _evaluate(`
    (function() {
      var api = ${apiPath};
      var all = api.getAllShapes();
      return all.map(function(s) { return { id: s.id, name: s.name }; });
    })()
  `);
  return { success: true, count: shapes?.length || 0, shapes: shapes || [] };
}

export async function getProperties({ entity_id }) {
  const apiPath = await _getChartApi();
  const result = await _evaluate(`
    (function() {
      var api = ${apiPath};
      var eid = ${safeString(entity_id)};
      var props = { entity_id: eid };
      var shape = api.getShapeById(eid);
      if (!shape) return { error: 'Shape not found: ' + eid };
      var methods = [];
      try { for (var key in shape) { if (typeof shape[key] === 'function') methods.push(key); } props.available_methods = methods; } catch(e) {}
      try { var pts = shape.getPoints(); if (pts) props.points = pts; } catch(e) { props.points_error = e.message; }
      try { var ovr = shape.getProperties(); if (ovr) props.properties = ovr; } catch(e) {
        try { var ovr2 = shape.properties(); if (ovr2) props.properties = ovr2; } catch(e2) { props.properties_error = e2.message; }
      }
      try { props.visible = shape.isVisible(); } catch(e) {}
      try { props.locked = shape.isLocked(); } catch(e) {}
      try { props.selectable = shape.isSelectionEnabled(); } catch(e) {}
      try {
        var all = api.getAllShapes();
        for (var i = 0; i < all.length; i++) { if (all[i].id === eid) { props.name = all[i].name; break; } }
      } catch(e) {}
      return props;
    })()
  `);
  if (result?.error) throw new Error(result.error);
  return { success: true, ...result };
}

export async function removeOne({ entity_id }) {
  const apiPath = await _getChartApi();
  const result = await _evaluate(`
    (function() {
      var api = ${apiPath};
      var eid = ${safeString(entity_id)};
      var before = api.getAllShapes();
      var found = false;
      for (var i = 0; i < before.length; i++) { if (before[i].id === eid) { found = true; break; } }
      if (!found) return { removed: false, error: 'Shape not found: ' + eid, available: before.map(function(s) { return s.id; }) };
      api.removeEntity(eid);
      var after = api.getAllShapes();
      var stillExists = false;
      for (var j = 0; j < after.length; j++) { if (after[j].id === eid) { stillExists = true; break; } }
      return { removed: !stillExists, entity_id: eid, remaining_shapes: after.length };
    })()
  `);
  if (result?.error) throw new Error(result.error);
  return { success: true, entity_id: result?.entity_id, removed: result?.removed, remaining_shapes: result?.remaining_shapes };
}

export async function clearAll() {
  // removeAllShapes() corrupts internal state — _createMultipointShape stops working after.
  // removeAllDrawingTools() is the safe alternative.
  const result = await _evaluate(`
    (function() {
      try {
        var coll = window._exposed_chartWidgetCollection;
        if (coll && coll.activeChartWidget && typeof coll.activeChartWidget.value === 'function') {
          var w = coll.activeChartWidget.value();
          if (w && typeof w.removeAllDrawingTools === 'function') {
            w.removeAllDrawingTools();
            return { method: 'removeAllDrawingTools', success: true };
          }
        }
      } catch(e) {}
      // Fallback: individual removeEntity per shape (slower but safe)
      var api = window.TradingViewApi._activeChartWidgetWV.value();
      var shapes = api.getAllShapes();
      var removed = 0;
      for (var i = 0; i < shapes.length; i++) {
        try { api.removeEntity(shapes[i].id); removed++; } catch(e) {}
      }
      return { method: 'removeEntity', success: true, removed: removed };
    })()
  `);
  return { success: true, action: 'all_shapes_removed', method: result?.method, removed: result?.removed };
}
