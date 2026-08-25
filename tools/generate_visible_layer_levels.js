const fs = require('fs');
const path = require('path');

const DIR = path.join('assets', 'resources', 'data', 'levels');
const START = Number(process.env.START_LEVEL ?? 101);
const COUNT = Number(process.env.COUNT ?? 0);
const DIFFICULTY_BASE = Number(process.env.DIFFICULTY_BASE ?? Math.max(0, START - 1));
const TILE_W = Number(process.env.TILE_W ?? 120);
const TILE_H = Number(process.env.TILE_H ?? 144);
const JITTER_X = 0.5;
const JITTER_Y = 0.6;
// VelvetNight / VevetNight: 22 tile arts (files 0-21).
const GROUPS = Array.from({ length: 22 }, (_, i) => String(i));
const TILE_SIZE_CATALOG_PATH = process.env.TILE_SIZE_CATALOG ?? path.join('assets', 'resources', 'data', 'tile_size_catalog.json');
const TILE_SIZE_CATALOG = fs.existsSync(TILE_SIZE_CATALOG_PATH)
  ? JSON.parse(fs.readFileSync(TILE_SIZE_CATALOG_PATH, 'utf8').replace(/^\uFEFF/, ''))
  : {};
const CATALOG_SIZES = Object.values(TILE_SIZE_CATALOG)
  .filter(size => Number.isFinite(size?.width) && size.width > 0 && Number.isFinite(size?.height) && size.height > 0);
const MAX_TILE_W = CATALOG_SIZES.length ? Math.max(...CATALOG_SIZES.map(size => size.width)) : TILE_W;
const MAX_TILE_H = CATALOG_SIZES.length ? Math.max(...CATALOG_SIZES.map(size => size.height)) : TILE_H;
// Large ~200px tiles need a real same-layer gap and compact boards.
const SAME_LAYER_GAP_X = 10;
const SAME_LAYER_GAP_Y = 10;
const LARGE_TILE_PACK = MAX_TILE_W >= 180 || MAX_TILE_H >= 190;

function difficultyBandParams(idx) {
  // idx 0 = level 1
  if (idx < 5) {
    return { HINT: 3, UNDO: 3, SKIP: 0, wrongTrayMaxSlots: 4, coverThreshold: 0.18 };
  }
  if (idx < 12) {
    return { HINT: 2, UNDO: 2, SKIP: 0, wrongTrayMaxSlots: 3, coverThreshold: 0.12 };
  }
  if (idx < 20) {
    return { HINT: 1, UNDO: 2, SKIP: 0, wrongTrayMaxSlots: 2, coverThreshold: 0.08 };
  }
  if (idx < 28) {
    return { HINT: 1, UNDO: 1, SKIP: 0, wrongTrayMaxSlots: 2, coverThreshold: 0.06 };
  }
  if (idx < 40) {
    return { HINT: 0, UNDO: 1, SKIP: 0, wrongTrayMaxSlots: 2, coverThreshold: 0.05 };
  }
  return { HINT: 0, UNDO: 0, SKIP: 0, wrongTrayMaxSlots: 2, coverThreshold: 0.04 };
}

function boostersFor(idx) {
  const band = difficultyBandParams(idx);
  return { HINT: band.HINT, UNDO: band.UNDO, SKIP: band.SKIP };
}

function orderPatternBand(idx) {
  // Levels 1-5 (idx 0-4): AAA — 3 ô giống nhau.
  // Levels 6-15: AAB — 2 giống + 1 khác.
  // Levels 16+: ABC — 3 ô khác nhau.
  if (idx < 5) return 'AAA';
  if (idx < 15) return 'AAB';
  return 'ABC';
}

function groupSpanFor(idx) {
  // Keep early pools modest so same-item orders stay readable on board.
  if (idx < 10) return Math.min(GROUPS.length, 10);
  if (idx < 20) return Math.min(GROUPS.length, 12);
  if (idx < 35) return Math.min(GROUPS.length, 16);
  return GROUPS.length;
}
const COVER_THRESHOLD = 0;
const FINAL_COVER_THRESHOLD = 0.08;
const STACK_MIN_COVER_RATIO = 0.2;
const BLOCK_OVERLAP_WIDTH_RATIO = 0.45;
const BLOCK_OVERLAP_HEIGHT_RATIO = 0.07;
const BLOCK_OVERLAP_AREA_RATIO = 0.02;
const SAFE = { minX: -510, maxX: 510, minY: -600, maxY: 600 };

// Compact silhouettes only (<=4x4) so ~200px VelvetNight tiles still fit the safe screen.
const COMPACT_SHAPES = [
  ['petal_rise', ['#...', '##..', '###.', '####']],
  ['twin_lanes', ['##.#', '##.#', '#.##', '#.##']],
  ['topdown_pyramid', ['####', '####', '####', '####'], 'topdown_pyramid'],
  ['cross_gem', ['.##.', '####', '.##.']],
  ['hollow_square', ['####', '#..#', '#..#', '####']],
  ['diamond_seed', ['.##.', '####', '#.##']],
  ['cross_gate', ['####', '.##.', '####']],
  ['mirror_frame', ['####', '#..#', '####']],
  ['x_knot', ['#..#', '####', '.##.', '####']],
  ['hourglass_path', ['####', '.##.', '####', '.##.']],
  ['chevron_shield', ['.##.', '####', '.###', '..#.']],
  ['crown_step', ['#..#', '####', '####', '.##.']],
  ['lantern_core', ['.##.', '####', '#..#', '####']],
  ['plus_small', ['.#.', '###', '.#.']],
  ['stairs_3', ['#..', '##.', '###']],
  ['corner_L', ['#..', '#..', '###']],
  ['U_gate', ['#.#', '#.#', '###']],
  ['H_gate', ['#.#', '###', '#.#']],
  ['ring_3', ['###', '#.#', '###']],
  ['slash_bar', ['##.', '.##', '##.']],
  ['T_mark', ['###', '.#.', '.#.']],
  ['Y_fork', ['#.#', '.#.', '###']],
  ['pyramid_3', ['.#.', '###', '###']],
  ['inv_pyramid', ['###', '###', '.#.']],
  ['left_wedge', ['#..', '##.', '###', '##.']],
  ['right_wedge', ['..#', '.##', '###', '.##']],
  ['bridge_4', ['####', '.##.', '.##.', '####']],
  ['pillars_4', ['#..#', '#..#', '####', '#..#']],
  ['nest_4', ['.##.', '#..#', '#..#', '.##.']],
  ['knot_alt', ['##.#', '.###', '###.', '#.##']],
  ['seed_alt', ['#.##', '####', '##.#']],
  ['gate_alt', ['.###', '##.#', '#.##', '###.']],
  ['Z_mark', ['##.', '.##', '..#']],
  ['S_mark', ['..#', '.##', '##.']],
  ['C_hook', ['###', '#..', '###']],
  ['E_ridge', ['###', '#.#', '#.#']],
  ['dual_step', ['##..', '###.', '.###', '..##']],
  ['fan_edge', ['#...', '##..', '###.', '##..']],
  ['bowl_4', ['#..#', '####', '####', '.##.']],
  ['twin_tower_lanes', ['##.#', '##.#', '#.##', '#.##']],
  ['cross_wide', ['.##.', '####', '####', '.##.']],
  ['mini_helm', ['####', '#..#', '.##.', '####']],
  ['arrow_head', ['.#..', '##..', '###.', '####']],
  ['trap_door', ['####', '.##.', '.##.', '####']],
  ['split_bar', ['##.#', '####', '#.##', '####']],
];
const WIDE_SHAPES = [
  ['woven_star', ['.#.#.', '#####', '.###.', '#####']],
  ['totem_gate', ['#####', '..#..', '#.#.#', '#####']],
  ['lotus_mark', ['.#.#.', '#####', '.###.', '##.##', '.###.']],
  ['spire_ring', ['..#..', '.###.', '##.##', '.###.', '##.##']],
  ['solar_cross', ['.###.', '##..#', '#...#', '#..##', '#####']],
  ['moon_gate', ['.####', '##..#', '#...#', '##..#', '.####']],
  ['helm_shape', ['#####', '#.#.#', '.###.', '#####', '##.##']],
];
const ACTIVE_SHAPES = LARGE_TILE_PACK ? COMPACT_SHAPES : [...COMPACT_SHAPES, ...WIDE_SHAPES];

const EARLY_PRESET_SHAPES = [
  ['petal_rise', ['#...', '##..', '###.', '####'], 'default_depths'],
  ['twin_lanes', ['##.#', '##.#', '#.##', '#.##'], 'default_depths'],
  ['topdown_pyramid', ['####', '####', '####', '####'], 'topdown_pyramid'],
  ['cross_gem', ['.##.', '####', '.##.'], 'default_depths'],
  ['hollow_square', ['####', '#..#', '#..#', '####'], 'default_depths'],
  ['stairs_3', ['#..', '##.', '###'], 'default_depths'],
  ['plus_small', ['.#.', '###', '.#.'], 'default_depths'],
  ['diamond_seed', ['.##.', '####', '#.##'], 'default_depths'],
];

function pad(n) { return String(n).padStart(3, '0'); }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function round(n) { return Math.round(n * 100) / 100; }
function key(c) { return `${c.x},${c.y}`; }
function tileW(tile, config) { return tile?.tileWidth ?? TILE_SIZE_CATALOG[tile?.groupId]?.width ?? config.tileWidth; }
function tileH(tile, config) { return tile?.tileHeight ?? TILE_SIZE_CATALOG[tile?.groupId]?.height ?? config.tileHeight; }

function shapeDefinitionFor(shapeIdx, difficultyIdx) {
  const useEarlyPresets = difficultyIdx < EARLY_PRESET_SHAPES.length;
  const source = useEarlyPresets ? EARLY_PRESET_SHAPES : ACTIVE_SHAPES;
  const sourceShapeIdx = useEarlyPresets ? shapeIdx : Math.max(0, shapeIdx - EARLY_PRESET_SHAPES.length);
  const def = source[sourceShapeIdx % source.length];
  const baseShapeName = def[0];
  const shapeRows = def[1];
  const presetKind = def[2] || 'default_depths';
  const variant = Math.floor(sourceShapeIdx / source.length);
  const shapeName = variant > 0 ? `${baseShapeName}_v${variant + 1}` : baseShapeName;
  return { shapeName, shapeRows, presetKind };
}

function catalogSize(groupId) {
  const size = TILE_SIZE_CATALOG[groupId];
  return {
    width: Number.isFinite(size?.width) && size.width > 0 ? size.width : TILE_W,
    height: Number.isFinite(size?.height) && size.height > 0 ? size.height : TILE_H,
  };
}

function applyTileSizes(tiles) {
  for (const tile of tiles) {
    const size = catalogSize(tile.groupId);
    tile.tileWidth = size.width;
    tile.tileHeight = size.height;
  }
}

function countSameLayerOverlaps(tiles, config) {
  let count = 0;
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      if (sameLayerOverlap(tiles[i], tiles[j], config)) count++;
    }
  }
  return count;
}

/**
 * Sync board tile size to catalog max and grow spacing until same-layer AABBs no longer collide.
 * Prevents VelvetNight size drift (catalog taller/wider than spacing baked for older packs).
 */
function ensureCatalogAwareSpacing(config, tiles) {
  if (!tiles.length) return;
  const maxW = Math.max(...tiles.map(t => tileW(t, config)));
  const maxH = Math.max(...tiles.map(t => tileH(t, config)));
  config.tileWidth = maxW;
  config.tileHeight = maxH;

  const fitSpacingX = Math.floor((SAFE.maxX - SAFE.minX - maxW) / Math.max(1, config.cols - 1));
  const fitSpacingY = Math.floor((SAFE.maxY - SAFE.minY - maxH) / Math.max(1, config.rows - 1));
  config.tileSpacing = Math.max(config.tileSpacing || 0, maxW + SAME_LAYER_GAP_X);
  config.tileSpacingY = Math.max(config.tileSpacingY || 0, maxH + SAME_LAYER_GAP_Y);

  for (let step = 0; step < 40; step++) {
    recenter(config, tiles);
    if (countSameLayerOverlaps(tiles, config) === 0 && fits(bounds(tiles, config))) break;
    if (config.tileSpacing < fitSpacingX) config.tileSpacing += 2;
    if (config.tileSpacingY < fitSpacingY) config.tileSpacingY += 2;
    if (config.tileSpacing >= fitSpacingX && config.tileSpacingY >= fitSpacingY) {
      recenter(config, tiles);
      break;
    }
  }

  recenter(config, tiles);
  if (countSameLayerOverlaps(tiles, config) > 0) {
    throw new Error(`same-layer overlap remains after spacing expand (${config.shapeName})`);
  }
  if (!fits(bounds(tiles, config))) {
    throw new Error(`screen fit failed after spacing expand (${config.shapeName})`);
  }
}

function cellsFromRows(rows) {
  const cells = [];
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      if (rows[y][x] === '#') cells.push({ x, y });
    }
  }
  return cells;
}

function cellsFromPattern(pattern) {
  const cells = [];
  for (let y = 0; y < pattern.length; y++) {
    for (let x = 0; x < pattern[y].length; x++) {
      if (pattern[y][x]) cells.push({ x, y });
    }
  }
  return cells;
}

function patternFromCells(cells) {
  const rows = Math.max(...cells.map(c => c.y)) + 1;
  const cols = Math.max(...cells.map(c => c.x)) + 1;
  const p = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (const c of cells) p[c.y][c.x] = 1;
  return p;
}

function componentCount(cells) {
  const set = new Set(cells.map(key));
  const seen = new Set();
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let count = 0;

  for (const start of set) {
    if (seen.has(start)) continue;
    count++;
    const q = [start];
    seen.add(start);
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i].split(',').map(Number);
      for (const [dx, dy] of dirs) {
        const nk = `${x + dx},${y + dy}`;
        if (set.has(nk) && !seen.has(nk)) {
          seen.add(nk);
          q.push(nk);
        }
      }
    }
  }
  return count;
}

function targetTiles(idx) {
  // Gentler growth so all 50 levels stay casual / low-retry.
  // Orders are always size 3, so tile counts must stay divisible by 3.
  const progressiveTarget = 15 + 2 * Math.floor(idx / 3);
  const capped = Math.min(idx >= 29 ? 42 : 48, progressiveTarget);
  return Math.max(15, capped - (capped % 3));
}

function trimTilesToOrderMultiple(tiles) {
  if (tiles.length % 3 === 0) return tiles;
  const removable = [...tiles].sort((a, b) =>
    a.layer - b.layer ||
    a.gridY - b.gridY ||
    a.gridX - b.gridX ||
    a.id.localeCompare(b.id)
  );
  const removeCount = tiles.length % 3;
  const dropIds = new Set(removable.slice(0, removeCount).map(t => t.id));
  return tiles.filter(t => !dropIds.has(t.id));
}
function maxLayersFor(idx) {
  if (idx < 12) return 3;
  // Never go to 5 layers in the casual pack — keeps silhouettes readable.
  return 4;
}

function layerJitter(layer, axis, config) {
  const seed = Math.abs(layer * 15485863 + axis * 32452843);
  const mult = axis === 0 ? (config.jitterX ?? JITTER_X) : (config.jitterY ?? JITTER_Y);
  const size = axis === 0 ? (config.tileWidth ?? TILE_W) : (config.tileHeight ?? TILE_H);
  return ((seed % 100) / 100 - 0.5) * size * mult;
}

function center(tile, config) {
  return {
    x: config.centerOffset.x + tile.gridX * (config.tileSpacingX ?? config.tileSpacing) + layerJitter(tile.layer, 0, config),
    y: config.centerOffset.y - tile.gridY * (config.tileSpacingY ?? config.tileSpacing) + layerJitter(tile.layer, 1, config),
  };
}

function bounds(tiles, config) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of tiles) {
    const p = center(t, config);
    minX = Math.min(minX, p.x - tileW(t, config) / 2);
    maxX = Math.max(maxX, p.x + tileW(t, config) / 2);
    minY = Math.min(minY, p.y - tileH(t, config) / 2);
    maxY = Math.max(maxY, p.y + tileH(t, config) / 2);
  }
  return { minX: round(minX), maxX: round(maxX), minY: round(minY), maxY: round(maxY) };
}

function fits(b) {
  return b.minX >= SAFE.minX && b.maxX <= SAFE.maxX && b.minY >= SAFE.minY && b.maxY <= SAFE.maxY;
}

function dist(c, cx, cy) {
  return Math.abs(c.x - cx) + Math.abs(c.y - cy);
}

function buildDepths(cells, target, maxLayers, idx) {
  const depths = new Map(cells.map(c => [key(c), 1]));
  let total = cells.length;
  const cx = (Math.min(...cells.map(c => c.x)) + Math.max(...cells.map(c => c.x))) / 2;
  const cy = (Math.min(...cells.map(c => c.y)) + Math.max(...cells.map(c => c.y))) / 2;
  const core = [...cells].sort((a, b) => dist(a, cx, cy) - dist(b, cx, cy) || a.y - b.y || a.x - b.x);

  const deepStacks = Math.max(idx < 8 ? 3 : 4, Math.min(core.length, Math.floor((idx + 8) / 6)));
  for (let i = 0; i < deepStacks && total < target; i++) {
    const k = key(core[i]);
    while (depths.get(k) < maxLayers && total < target) {
      depths.set(k, depths.get(k) + 1);
      total++;
    }
  }

  let cursor = idx % core.length;
  while (total < target) {
    let added = false;
    for (let tries = 0; tries < core.length && total < target; tries++) {
      const c = core[(cursor + tries) % core.length];
      const k = key(c);
      if (depths.get(k) < maxLayers) {
        depths.set(k, depths.get(k) + 1);
        total++;
        added = true;
      }
    }
    cursor = (cursor + 3) % core.length;
    if (!added) break;
  }
  return depths;
}

function buildPresetDepths(presetKind, cells) {
  if (presetKind !== 'topdown_pyramid') return null;
  const depths = new Map();
  for (const c of cells) {
    let depth = 1;
    if (c.x <= 2 && c.y <= 2) depth = 2;
    if (c.x >= 1 && c.x <= 2 && c.y >= 1 && c.y <= 2) depth = 3;
    if (c.x === 1 && c.y === 1) depth = 4;
    depths.set(key(c), depth);
  }
  return depths;
}

function presetTileGridPosition(presetKind, cell, layer) {
  if (presetKind === 'topdown_pyramid') {
    if (layer === 1 || layer === 3) return { gridX: cell.x + 0.5, gridY: cell.y + 0.5 };
    return { gridX: cell.x, gridY: cell.y };
  }
  return { gridX: cell.x, gridY: cell.y };
}

function compactEarlyPresetLayerOverlap(difficultyIdx, config, tiles) {
  if (config.shapeName === 'topdown_pyramid') {
    config.jitterX = 0;
    config.jitterY = 0;
    recenter(config, tiles);
    return;
  }
  config.jitterX = 0.45;
  config.jitterY = 0.54;
  recenter(config, tiles);
}

function applyFinalCoverThreshold(difficultyIdx, config) {
  config.coverThreshold = difficultyBandParams(difficultyIdx).coverThreshold;
}

function recenter(config, tiles) {
  const minX = Math.min(...tiles.map(t => t.gridX));
  const maxX = Math.max(...tiles.map(t => t.gridX));
  const minY = Math.min(...tiles.map(t => t.gridY));
  const maxY = Math.max(...tiles.map(t => t.gridY));
  const layers = [...new Set(tiles.map(t => t.layer))];
  const avgJx = layers.reduce((s, l) => s + layerJitter(l, 0, config), 0) / layers.length;
  const avgJy = layers.reduce((s, l) => s + layerJitter(l, 1, config), 0) / layers.length;
  config.centerOffset = {
    x: round(-((minX + maxX) / 2) * (config.tileSpacingX ?? config.tileSpacing) - avgJx),
    y: round(((minY + maxY) / 2) * (config.tileSpacingY ?? config.tileSpacing) - avgJy),
  };
}

function solutionOrder(tiles, config, idx) {
  const sim = tiles.map(t => ({ ...t, active: true }));
  const byId = new Map(sim.map(t => [t.id, t]));
  const result = [];
  let preferredNextId = null;

  while (result.length < tiles.length) {
    computeBlockStatus(sim, config);
    const choices = sim.filter(t => t.active && t.selectable);
    if (!choices.length) break;

    const preferred = preferredNextId ? choices.find(t => t.id === preferredNextId) : null;
    let chosen = preferred || null;
    if (!chosen) {
      const scored = choices.map(t => {
        const beforeSelectable = new Set(choices.map(c => c.id));
        t.active = false;
        computeBlockStatus(sim, config);
        const afterSelectable = sim.filter(c => c.active && c.selectable);
        t.active = true;

        const newlyOpened = afterSelectable.filter(c => !beforeSelectable.has(c.id));
        const sameStackOpened = newlyOpened.filter(c => c.gridX === t.gridX && c.gridY === t.gridY).length;
        const lowerOpened = newlyOpened.filter(c => c.layer < t.layer).length;
        const coverCount = sim.filter(c => c.active && c.layer < t.layer && overlapArea(c, t, config) > tileW(c, config) * tileH(c, config) * STACK_MIN_COVER_RATIO).length;
        const staggerBias = idx < 6 ? 2 : idx < 12 ? 4 : 6;

        return {
          tile: t,
          score:
            sameStackOpened * 140 * staggerBias +
            lowerOpened * 45 * staggerBias +
            coverCount * 12 +
            t.layer * 8 -
            Math.abs(t.gridX - t.gridY),
        };
      });

      scored.sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        if (a.tile.layer !== b.tile.layer) return b.tile.layer - a.tile.layer;
        if (a.tile.gridY !== b.tile.gridY) return a.tile.gridY - b.tile.gridY;
        return a.tile.gridY % 2 === 0 ? a.tile.gridX - b.tile.gridX : b.tile.gridX - a.tile.gridX;
      });
      chosen = scored[0].tile;
    }

    const beforeSelectable = new Set(choices.map(c => c.id));
    chosen.active = false;
    result.push(byId.get(chosen.id));
    computeBlockStatus(sim, config);
    const sameStackNewlyOpened = sim
      .filter(t => t.active && t.selectable && t.gridX === chosen.gridX && t.gridY === chosen.gridY && !beforeSelectable.has(t.id))
      .sort((a, b) => b.layer - a.layer);
    preferredNextId = sameStackNewlyOpened[0]?.id ?? null;
  }

  return result.map(t => tiles.find(original => original.id === t.id)).filter(Boolean);
}

function overlapArea(a, b, config) {
  return overlapInfo(a, b, config).area;
}

function overlapInfo(a, b, config) {
  const ca = center(a, config);
  const cb = center(b, config);
  const aw = tileW(a, config);
  const ah = tileH(a, config);
  const bw = tileW(b, config);
  const bh = tileH(b, config);
  const width = Math.max(0, (aw + bw) * 0.5 - Math.abs(ca.x - cb.x));
  const height = Math.max(0, (ah + bh) * 0.5 - Math.abs(ca.y - cb.y));
  return {
    width,
    height,
    area: width * height,
    widthRatio: width / Math.max(1, Math.min(aw, bw)),
    heightRatio: height / Math.max(1, Math.min(ah, bh)),
  };
}

function isBlockingOverlap(tile, coverer, config, accumulatedOverlap = 0) {
  const info = overlapInfo(tile, coverer, config);
  if (info.area <= 0) return false;
  const minOverlap = Math.max(config.minBlockOverlapPixels ?? 1, tileW(tile, config) * tileH(tile, config) * (config.coverThreshold ?? 0.01));
  if (accumulatedOverlap + info.area > minOverlap) return true;
  if (info.area / Math.max(1, tileW(tile, config) * tileH(tile, config)) >= (config.blockOverlapAreaRatio ?? BLOCK_OVERLAP_AREA_RATIO)) return true;
  const minWidthRatio = config.blockOverlapWidthRatio ?? BLOCK_OVERLAP_WIDTH_RATIO;
  const minHeightRatio = config.blockOverlapHeightRatio ?? BLOCK_OVERLAP_HEIGHT_RATIO;
  return info.widthRatio >= minWidthRatio && info.heightRatio >= minHeightRatio;
}

function isLayerAbove(otherLayer, tileLayer, config) {
  return config?.layerOrder === 'lowerOnTop'
    ? otherLayer < tileLayer
    : otherLayer > tileLayer;
}

function convertToLowerOnTop(config, tiles) {
  if (config.layerOrder === 'lowerOnTop') return;
  const maxLayer = Math.max(...tiles.map(t => t.layer));
  const spacingX = config.tileSpacingX ?? config.tileSpacing;
  const spacingY = config.tileSpacingY ?? config.tileSpacing;
  for (const tile of tiles) {
    const oldCenter = center(tile, config);
    const newLayer = maxLayer - tile.layer;
    tile.layer = newLayer;
    tile.gridX = round((oldCenter.x - config.centerOffset.x - layerJitter(newLayer, 0, config)) / spacingX);
    tile.gridY = round(-(oldCenter.y - config.centerOffset.y - layerJitter(newLayer, 1, config)) / spacingY);
  }
  config.layerOrder = 'lowerOnTop';
}

function sameLayerOverlap(a, b, config) {
  if (a.layer !== b.layer) return false;
  const ca = center(a, config);
  const cb = center(b, config);
  return Math.abs(ca.x - cb.x) < (tileW(a, config) + tileW(b, config)) * 0.5 &&
    Math.abs(ca.y - cb.y) < (tileH(a, config) + tileH(b, config)) * 0.5;
}

function computeBlockStatus(tiles, config) {
  for (const t of tiles) {
    if (!t.active) {
      t.selectable = false;
      t.isBlocked = true;
      continue;
    }
    let blocked = false;
    let totalOverlap = 0;
    for (const o of tiles) {
      if (o.id === t.id || !o.active || !isLayerAbove(o.layer, t.layer, config)) continue;
      if (isBlockingOverlap(t, o, config, totalOverlap)) {
        blocked = true;
        break;
      }
      totalOverlap += overlapArea(t, o, config);
    }
    t.isBlocked = blocked;
    t.selectable = !blocked;
  }
}

function buildOrderPermutation(moveCount, idx) {
  const perm = [];
  let i = 0;
  // Casual pack: keep natural clear order until late levels so players rarely
  // need "unlocker" taps between order items.
  const shouldInterleave = idx >= 35;
  while (i < moveCount) {
    if (shouldInterleave && i + 5 < moveCount) {
      perm.push(i, i + 2, i + 3, i + 1, i + 4, i + 5);
      i += 6;
    } else {
      perm.push(i++);
    }
  }
  return perm.slice(0, moveCount);
}

function buildOrdersFromTapSequence(sequence, idx) {
  const perm = buildOrderPermutation(sequence.length, idx);
  const orders = [];
  const solutionOrders = [];
  for (let i = 0; i < perm.length; i += 3) {
    const items = perm.slice(i, i + 3).map(moveIndex => sequence[moveIndex].groupId);
    orders.push({ id: `order_${pad(i / 3 + 1)}`, items });
    solutionOrders.push(items);
  }
  return { orders, solutionOrders, orderPermutation: perm };
}

function interleavedMoveMetrics(level) {
  const tray = [];
  let orderIndex = 0;
  let wrongUnlockerMoves = 0;
  const firstTwentyMoveKinds = [];

  const findMatch = () => {
    const order = level.orders[orderIndex];
    if (!order) return null;
    const matched = [];
    let itemIndex = 0;
    for (const tile of tray) {
      if (tile.groupId !== order.items[itemIndex]) continue;
      matched.push(tile);
      itemIndex++;
      if (itemIndex >= order.items.length) return matched;
    }
    return null;
  };

  const byId = new Map(level.tiles.map(tile => [tile.id, tile]));
  for (const tileId of level.solutionMoveTileIds) {
    const tile = byId.get(tileId);
    if (!tile) continue;
    const currentOrder = level.orders[orderIndex];
    const expected = currentOrder?.items.find((_, itemIndex) => {
      const matched = [];
      let scanIndex = 0;
      for (const trayTile of tray) {
        if (trayTile.groupId === currentOrder.items[scanIndex]) {
          matched.push(trayTile);
          scanIndex++;
        }
      }
      return itemIndex === scanIndex;
    }) ?? currentOrder?.items[0];
    const isWrongUnlocker = !!currentOrder && tile.groupId !== expected;
    if (isWrongUnlocker) wrongUnlockerMoves++;
    if (firstTwentyMoveKinds.length < 20) firstTwentyMoveKinds.push(isWrongUnlocker ? 'unlocker' : 'order');

    tray.push(tile);
    let match = findMatch();
    while (match) {
      for (const matchedTile of match) {
        const idx = tray.findIndex(t => t.id === matchedTile.id);
        if (idx !== -1) tray.splice(idx, 1);
      }
      orderIndex++;
      match = findMatch();
    }
  }

  return {
    wrongUnlockerMoves,
    wrongUnlockerRatio: round(wrongUnlockerMoves / Math.max(1, level.solutionMoveTileIds.length)),
    firstTwentyMoveKinds,
  };
}

function selectable(activeTiles, config = null) {
  if (config) {
    computeBlockStatus(activeTiles, config);
    return activeTiles.filter(t => t.active && t.selectable);
  }
  return activeTiles.filter(t => !activeTiles.some(o => o.id !== t.id && o.active && o.gridX === t.gridX && o.gridY === t.gridY && isLayerAbove(o.layer, t.layer, null)));
}

function isSelectableAfterRemoving(activeIds, removeId, targetId, byId, config) {
  const activeTiles = [...activeIds]
    .filter(id => id !== removeId)
    .map(id => byId.get(id))
    .filter(Boolean);
  return selectable(activeTiles, config).some(t => t.id === targetId);
}

function wouldCreateBadOrder(sequence, rank, tile, newGroupId, idx = 20) {
  const orderIndex = Math.floor(rank.get(tile.id) / 3);
  const orderStart = orderIndex * 3;
  const items = sequence.slice(orderStart, orderStart + 3).map(t => t.id === tile.id ? newGroupId : t.groupId);
  if (items.length === 3) {
    const unique = new Set(items).size;
    const band = orderPatternBand(idx);
    // Protect the intended order pattern band when decoys rewrite tile groups.
    if (band === 'AAA' && unique !== 1) return true;
    if (band === 'AAB' && unique !== 2) return true;
    if (band === 'ABC' && unique < 3) return true;
  }

  const prev = orderIndex > 0 ? sequence.slice(orderStart - 3, orderStart).map(t => t.groupId).join(',') : '';
  const next = sequence.slice(orderStart + 3, orderStart + 6).map(t => t.groupId).join(',');
  const current = items.join(',');
  return current === prev || (next.length > 0 && current === next);
}

function addDecoys(tiles, sequence, idx, board) {
  const byId = new Map(tiles.map(t => [t.id, t]));
  const rank = new Map(sequence.map((t, i) => [t.id, i]));
  const active = new Set(tiles.map(t => t.id));
  const limit = Math.min(sequence.length - 5, idx < 5 ? 0 : idx < 15 ? 3 : 6 + Math.floor(idx * 0.35));
  const totalCap = Math.min(
    sequence.length - 3,
    idx < 5 ? 0 :
      idx < 15 ? Math.max(1, Math.floor(sequence.length * 0.06)) :
        idx < 35 ? Math.max(3, Math.floor(sequence.length * 0.14)) :
          Math.max(5, Math.floor(sequence.length * 0.22))
  );
  const perFutureOrderTargetCap = idx < 15 ? 1 : idx < 35 ? 1 : 2;
  const futureOrderTargetCounts = new Map();
  let decoyCount = 0;

  const desiredChoiceCount = (step) => {
    if (idx < 5) return 1;
    if (idx < 15) return 1 + (step >= 8 && step % 5 === 0 ? 1 : 0);
    if (idx < 35) return 1 + (step % 4 === 0 ? 1 : 0);
    return 2 + (step % 3 === 0 ? 1 : 0);
  };

  for (let step = 0; step < limit; step++) {
    if (decoyCount >= totalCap) break;
    const chosen = sequence[step];
    const currentSelectable = selectable([...active].map(id => byId.get(id)), board);
    const currentChoices = currentSelectable.filter(t => t.groupId === chosen.groupId).length;
    const needed = Math.max(0, desiredChoiceCount(step) - currentChoices);
    if (needed <= 0) {
      active.delete(chosen.id);
      continue;
    }

    const criticalWindow = sequence.slice(step + 1, Math.min(sequence.length, step + 6));
    const candidates = selectable([...active].map(id => byId.get(id)), board)
      .filter(t => {
        if (t.id === chosen.id) return false;
        if (rank.get(t.id) <= step + 3) return false;
        if (t.strategyRole) return false;
        const futureOrder = Math.floor(rank.get(t.id) / 3);
        const k = `${futureOrder}:${chosen.groupId}`;
        return (futureOrderTargetCounts.get(k) || 0) < perFutureOrderTargetCap;
      })
      .map(t => ({
        tile: t,
        immediateTrap: criticalWindow.some(target =>
          target.id !== t.id &&
          isSelectableAfterRemoving(active, chosen.id, target.id, byId, board) &&
          !isSelectableAfterRemoving(active, t.id, target.id, byId, board)
        ),
      }));
    if (candidates.length) {
      candidates.sort((a, b) =>
        Number(b.immediateTrap) - Number(a.immediateTrap) ||
        rank.get(b.tile.id) - rank.get(a.tile.id) ||
        a.tile.layer - b.tile.layer
      );
      const take = Math.min(needed, candidates.length, totalCap - decoyCount);
      const used = new Set();
      for (let i = 0; i < take; i++) {
        const picked = candidates[i] || candidates[(step + idx + i) % candidates.length];
        const decoy = picked.tile;
        if (used.has(decoy.id)) continue;
        used.add(decoy.id);
        if (decoy.id === chosen.id) continue;
        if (wouldCreateBadOrder(sequence, rank, decoy, chosen.groupId, idx)) continue;
        decoy.groupId = chosen.groupId;
        decoy.strategyRole = picked.immediateTrap ? 'critical_path_decoy' : 'same_item_path_decoy';
        decoy.decoyForStep = step + 1;
        decoy.decoyAgainstKeyTile = chosen.id;
        const futureOrder = Math.floor(rank.get(decoy.id) / 3);
        const k = `${futureOrder}:${chosen.groupId}`;
        futureOrderTargetCounts.set(k, (futureOrderTargetCounts.get(k) || 0) + 1);
        decoyCount++;
      }
    }
    active.delete(chosen.id);
  }
}

function addOpeningAmbiguity(tiles, sequence, idx, board) {
  const rank = new Map(sequence.map((t, i) => [t.id, i]));
  const openingTiles = selectable(tiles, board).filter(t => rank.get(t.id) > 2);
  const used = new Set(tiles.filter(t => t.strategyRole).map(t => t.id));
  const totalCap = idx < 5 ? 0 : idx < 15 ? 1 : idx < 35 ? 3 : 5;
  const desired = idx < 5 ? 1 : idx < 15 ? 1 : idx < 35 ? 2 : 3;
  let changes = 0;

  for (let step = 0; step < Math.min(10, sequence.length - 3) && changes < totalCap; step++) {
    const chosen = sequence[step];
    const currentChoices = openingTiles.filter(t => t.groupId === chosen.groupId).length;
    let needed = Math.max(0, desired - currentChoices);
    if (needed === 0) continue;

    const candidates = openingTiles
      .filter(t => t.id !== chosen.id && !used.has(t.id) && rank.get(t.id) > step + 3)
      .sort((a, b) => rank.get(b.id) - rank.get(a.id) || a.layer - b.layer);

    for (const decoy of candidates) {
      if (needed <= 0 || changes >= totalCap) break;
      if (wouldCreateBadOrder(sequence, rank, decoy, chosen.groupId, idx)) continue;
      decoy.groupId = chosen.groupId;
      decoy.strategyRole = 'opening_same_item_decoy';
      decoy.decoyForStep = step + 1;
      decoy.decoyAgainstKeyTile = chosen.id;
      used.add(decoy.id);
      changes++;
      needed--;
    }
  }
}

function layerVisibilityMetrics(maxLayers, config) {
  const area = config.tileWidth * config.tileHeight;
  const pairs = [];
  for (let layer = 0; layer < maxLayers - 1; layer++) {
    const a = { gridX: 0, gridY: 0, layer };
    const b = { gridX: 0, gridY: 0, layer: layer + 1 };
    const visibleRatio = 1 - overlapArea(a, b, config) / area;
    pairs.push({ lowerLayer: layer, upperLayer: layer + 1, visibleRatio: round(visibleRatio) });
  }
  return pairs;
}

function validate(level) {
  const errors = [];
  const b = bounds(level.tiles, level.board);
  if (!fits(b)) errors.push(`bounds overflow ${JSON.stringify(b)}`);
  if (level.tiles.length !== level.solutionMoveTileIds.length) errors.push('solution count mismatch');
  if (level.tiles.length !== level.orders.reduce((s, o) => s + o.items.length, 0)) errors.push('order count mismatch');
  const allowDisconnectedShape = /parallel|lane|cluster/i.test(level.board.shapeName ?? '');
  if (!allowDisconnectedShape && componentCount(cellsFromPattern(level.board.shapePattern)) !== 1) errors.push('shape disconnected');
  const difficultyIdx = Number.isFinite(level.difficultyMetrics?.difficultyIndex)
    ? level.difficultyMetrics.difficultyIndex - 1
    : Math.max(0, (level.levelId || START) - START);
  const band = orderPatternBand(difficultyIdx);
  for (let i = 0; i < level.orders.length; i++) {
    const items = level.orders[i].items;
    const unique = new Set(items).size;
    if (band === 'AAA' && unique !== 1) {
      errors.push(`expected AAA order ${i + 1}: ${items.join('-')}`);
    } else if (band === 'AAB' && unique !== 2) {
      errors.push(`expected AAB order ${i + 1}: ${items.join('-')}`);
    } else if (band === 'ABC' && unique < 3) {
      errors.push(`expected ABC order ${i + 1}: ${items.join('-')}`);
    }
    if (i > 0 && items.join(',') === level.orders[i - 1].items.join(',')) {
      errors.push(`repeated adjacent order ${i + 1}: ${items.join('-')}`);
    }
  }

  const relaxedLayerVisibility = EARLY_PRESET_SHAPES.some(([shapeName]) => shapeName === level.board.shapeName);
  const minVisibleRatio = 0;
  const maxVisibleRatio = relaxedLayerVisibility ? 0.6 : 0.5;
  for (const pair of layerVisibilityMetrics(level.board.maxLayers, level.board)) {
    if (pair.visibleRatio < minVisibleRatio || pair.visibleRatio > maxVisibleRatio) {
      errors.push(`layer visibility out of range ${JSON.stringify(pair)}`);
    }
  }

  for (let i = 0; i < level.tiles.length; i++) {
    for (let j = i + 1; j < level.tiles.length; j++) {
      const a = level.tiles[i];
      const b = level.tiles[j];
      if (a.active && b.active && sameLayerOverlap(a, b, level.board)) {
        errors.push(`same-layer overlap ${a.id} ${b.id}`);
      }
    }
  }

  for (const tile of level.tiles) {
    const sameStackCoverers = level.tiles.filter(other =>
      other.id !== tile.id &&
      other.active &&
      other.gridX === tile.gridX &&
      other.gridY === tile.gridY &&
      isLayerAbove(other.layer, tile.layer, level.board)
    );
    if (!sameStackCoverers.length) continue;

    const tileArea = tileW(tile, level.board) * tileH(tile, level.board);
    const maxCoverRatio = Math.max(...sameStackCoverers.map(other => overlapArea(tile, other, level.board) / tileArea));
    if (maxCoverRatio < STACK_MIN_COVER_RATIO) {
      errors.push(`stack cover below ${STACK_MIN_COVER_RATIO} ${tile.id}: ${round(maxCoverRatio)}`);
    }
  }

  const sim = level.tiles.map(t => ({ ...t, active: true }));
  const byId = new Map(sim.map(t => [t.id, t]));
  const tray = [];
  let orderIndex = 0;
  const findOrderMatch = () => {
    const order = level.orders[orderIndex];
    if (!order) return null;
    const matched = [];
    let itemIndex = 0;
    for (const tile of tray) {
      if (tile.groupId !== order.items[itemIndex]) continue;
      matched.push(tile);
      itemIndex++;
      if (itemIndex >= order.items.length) return matched;
    }
    return null;
  };
  const consumeReadyOrders = () => {
    let matched = findOrderMatch();
    while (matched) {
      for (const tile of matched) {
        const idx = tray.findIndex(t => t.id === tile.id);
        if (idx !== -1) tray.splice(idx, 1);
      }
      orderIndex++;
      matched = findOrderMatch();
    }
  };

  computeBlockStatus(sim, level.board);
  for (let i = 0; i < level.solutionMoveTileIds.length; i++) {
    const t = byId.get(level.solutionMoveTileIds[i]);
    if (!t) { errors.push(`missing move ${i + 1}`); continue; }
    if (!t.selectable) errors.push(`blocked move ${i + 1} ${t.id}`);
    t.active = false;
    tray.push(t);
    consumeReadyOrders();
    if (tray.length >= level.tray.maxSlots) errors.push(`tray overflow at move ${i + 1}`);
    computeBlockStatus(sim, level.board);
  }
  if (sim.some(t => t.active)) errors.push('board not cleared');
  consumeReadyOrders();
  if (orderIndex < level.orders.length) errors.push(`orders not completed ${orderIndex}/${level.orders.length}`);
  if (tray.length > 0) errors.push(`tray not empty after solution ${tray.map(t => t.id).join(',')}`);
  return { errors, bounds: b };
}

function choiceMetrics(level) {
  const sim = level.tiles.map(t => ({ ...t, active: true }));
  const byId = new Map(sim.map(t => [t.id, t]));
  let sumSelectable = 0;
  let sumSameItemChoices = 0;
  let maxSameItemChoices = 0;
  let firstTenSameItemChoices = [];

  for (let step = 0; step < level.solutionMoveTileIds.length; step++) {
    computeBlockStatus(sim, level.board);
    const selectableTiles = sim.filter(t => t.active && t.selectable);
    const expected = level.orders[Math.floor(step / 3)]?.items[step % 3];
    const sameItemChoices = selectableTiles.filter(t => t.groupId === expected).length;
    sumSelectable += selectableTiles.length;
    sumSameItemChoices += sameItemChoices;
    maxSameItemChoices = Math.max(maxSameItemChoices, sameItemChoices);
    if (firstTenSameItemChoices.length < 10) {
      firstTenSameItemChoices.push(sameItemChoices);
    }

    const move = byId.get(level.solutionMoveTileIds[step]);
    if (move) move.active = false;
  }

  const steps = Math.max(1, level.solutionMoveTileIds.length);
  return {
    averageSelectableTilesDuringSolution: round(sumSelectable / steps),
    averageSameItemChoicesDuringSolution: round(sumSameItemChoices / steps),
    maxSameItemChoicesDuringSolution: maxSameItemChoices,
    firstTenSameItemChoices,
  };
}

function branchDifficultyMetrics(level) {
  const tiles = level.tiles;
  const byId = new Map(tiles.map(t => [t.id, t]));
  const orderItems = level.orders.flatMap(o => o.items);
  const memo = new Map();

  const activeKey = (activeIds, step) => `${step}|${[...activeIds].sort().join(',')}`;
  const correctChoices = (activeIds, step) => {
    const activeTiles = [...activeIds].map(id => byId.get(id)).filter(Boolean);
    const expected = orderItems[step];
    return selectable(activeTiles, level.board).filter(t => t.groupId === expected).map(t => t.id);
  };

  const canWin = (activeIds, step) => {
    if (step >= orderItems.length) return activeIds.size === 0;
    const k = activeKey(activeIds, step);
    if (memo.has(k)) return memo.get(k);
    const choices = correctChoices(activeIds, step);
    let ok = false;
    for (const id of choices) {
      const next = new Set(activeIds);
      next.delete(id);
      if (canWin(next, step + 1)) {
        ok = true;
        break;
      }
    }
    memo.set(k, ok);
    return ok;
  };

  let active = new Set(tiles.map(t => t.id));
  let forcedSteps = 0;
  let realTrapSteps = 0;
  let harmlessAmbiguousSteps = 0;
  let totalCorrectChoices = 0;
  let totalWinningChoices = 0;
  const firstTenBranching = [];

  for (let step = 0; step < orderItems.length; step++) {
    const choices = correctChoices(active, step);
    const winning = [];
    for (const id of choices) {
      const next = new Set(active);
      next.delete(id);
      if (canWin(next, step + 1)) winning.push(id);
    }

    totalCorrectChoices += choices.length;
    totalWinningChoices += winning.length;
    if (choices.length <= 1) forcedSteps++;
    else if (winning.length < choices.length) realTrapSteps++;
    else harmlessAmbiguousSteps++;
    if (firstTenBranching.length < 10) {
      firstTenBranching.push({ choices: choices.length, winning: winning.length });
    }

    active.delete(level.solutionMoveTileIds[step]);
  }

  const steps = Math.max(1, orderItems.length);
  return {
    forcedSteps,
    realTrapSteps,
    harmlessAmbiguousSteps,
    averageCorrectChoices: round(totalCorrectChoices / steps),
    averageWinningChoices: round(totalWinningChoices / steps),
    firstTenBranching,
  };
}

function staggeredOrderMetrics(level) {
  const sim = level.tiles.map(t => ({ ...t, active: true }));
  const byId = new Map(sim.map(t => [t.id, t]));
  let staggeredOrders = 0;
  const firstTenOrderStartSelectable = [];

  for (let start = 0; start < level.solutionMoveTileIds.length; start += 3) {
    computeBlockStatus(sim, level.board);
    const orderMoveIds = level.solutionMoveTileIds.slice(start, start + 3);
    const selectableAtStart = orderMoveIds.filter(id => byId.get(id)?.active && byId.get(id)?.selectable).length;
    if (selectableAtStart < orderMoveIds.length) staggeredOrders++;
    if (firstTenOrderStartSelectable.length < 10) firstTenOrderStartSelectable.push(selectableAtStart);

    for (const id of orderMoveIds) {
      const tile = byId.get(id);
      if (tile) {
        computeBlockStatus(sim, level.board);
        tile.active = false;
      }
    }
  }

  return {
    staggeredOrders,
    staggeredOrderRatio: round(staggeredOrders / Math.max(1, level.orders.length)),
    firstTenOrderStartSelectable,
  };
}

function makeLevel(shapeIdx, difficultyIdx = shapeIdx) {
  const idx = difficultyIdx;
  const levelId = START + idx;
  const { shapeName, shapeRows, presetKind } = shapeDefinitionFor(shapeIdx, idx);
  const cells = cellsFromRows(shapeRows);
  const target = targetTiles(idx);
  const maxLayers = maxLayersFor(idx);
  const presetDepths = buildPresetDepths(presetKind, cells);
  const depths = presetDepths || buildDepths(cells, target, maxLayers, idx);
  const tiles = [];
  let id = 0;

  for (const c of cells) {
    const depth = depths.get(key(c));
    for (let layer = 0; layer < depth; layer++) {
      const gridPos = presetTileGridPosition(presetKind, c, layer);
      tiles.push({
        id: `L${levelId}_T${pad(id++)}`,
        groupId: '0',
        tileType: 0,
        gridX: gridPos.gridX,
        gridY: gridPos.gridY,
        layer,
        active: true,
        selectable: true,
        isBlocked: false,
        clusteredLayout: false,
        clusterCount: 1,
        sameLayerOverlapForbidden: true,
        designRole: layer === 0 ? 'bottom' : layer === depth - 1 ? 'top' : 'middle',
      });
    }
  }
  // Keep every level solvable as complete 3-item orders.
  tiles.splice(0, tiles.length, ...trimTilesToOrderMultiple(tiles));
  if (tiles.length < 12 || tiles.length % 3 !== 0) {
    throw new Error(`level ${levelId} invalid:\nshape ${shapeName} cannot form complete orders (${tiles.length} tiles)`);
  }
  if (idx >= 29 && tiles.length < Math.min(target, 30)) {
    throw new Error(`level ${levelId} invalid:\nshape ${shapeName} only fits ${tiles.length}/${target} tiles with 4 layers`);
  }

  const cols = shapeRows[0].length;
  const rows = shapeRows.length;
  const minSameLayerGapX = SAME_LAYER_GAP_X;
  const minSameLayerGapY = SAME_LAYER_GAP_Y;
  const maxSameLayerGapX = 24;
  const maxSameLayerGapY = 24;
  const board = {
    rows,
    cols,
    maxLayers: Math.max(...tiles.map(t => t.layer)) + 1,
    tileSpacing: Math.max(MAX_TILE_W + minSameLayerGapX, Math.min(MAX_TILE_W + maxSameLayerGapX, Math.floor((SAFE.maxX - SAFE.minX - MAX_TILE_W) / Math.max(1, cols - 1)))),
    tileSpacingY: Math.max(MAX_TILE_H + minSameLayerGapY, Math.min(MAX_TILE_H + maxSameLayerGapY, Math.floor((SAFE.maxY - SAFE.minY - MAX_TILE_H) / Math.max(1, rows - 1)))),
    centerOffset: { x: 0, y: 0 },
    tileWidth: MAX_TILE_W,
    tileHeight: MAX_TILE_H,
    jitterX: JITTER_X,
    jitterY: JITTER_Y,
    jitterMode: 'layer_visible_mixed_shape',
    blockMode: 'overlap',
    minBlockOverlapPixels: 1,
    coverThreshold: COVER_THRESHOLD,
    blockOverlapWidthRatio: BLOCK_OVERLAP_WIDTH_RATIO,
    blockOverlapHeightRatio: BLOCK_OVERLAP_HEIGHT_RATIO,
    blockOverlapAreaRatio: BLOCK_OVERLAP_AREA_RATIO,
    shapePattern: patternFromCells(cells),
    shapeName,
  };
  recenter(board, tiles);

  const sequence = solutionOrder(tiles, board, idx);
  if (sequence.length !== tiles.length || sequence.length % 3 !== 0) {
    throw new Error(`level ${levelId} invalid:\nunsolvable or incomplete solution path (${sequence.length}/${tiles.length})`);
  }
  const groupSpan = groupSpanFor(idx);
  const band = orderPatternBand(idx);
  const orderBases = [];
  const orderSeconds = [];
  const orderThirds = [];
  const orderPermutation = buildOrderPermutation(sequence.length, idx);
  for (let p = 0; p < orderPermutation.length; p++) {
    const s = orderPermutation[p];
    const orderIndex = Math.floor(p / 3);
    const itemIndex = p % 3;
    const tile = sequence[s];
    const seed = (
      idx * 11 +
      orderIndex * 7 +
      itemIndex * 5 +
      ((orderIndex + 3) * (orderIndex + idx + 5)) +
      tile.gridX * 3 +
      tile.gridY * 5 +
      tile.layer * 7
    ) % groupSpan;

    let gid = seed;
    if (itemIndex === 0) {
      gid = seed;
      if (orderIndex > 0) {
        // Keep consecutive orders from becoming identical in every band.
        while (
          gid === orderBases[orderIndex - 1] &&
          (band === 'AAA' || groupSpan > 1)
        ) {
          gid = (gid + 1) % groupSpan;
          if (gid === seed) break;
        }
      }
      orderBases[orderIndex] = gid;
    } else if (band === 'AAA') {
      gid = orderBases[orderIndex];
    } else if (band === 'AAB') {
      if (itemIndex === 1) {
        gid = orderBases[orderIndex];
      } else {
        gid = (orderBases[orderIndex] + 1 + (orderIndex % Math.max(1, groupSpan - 1))) % groupSpan;
        if (gid === orderBases[orderIndex]) gid = (gid + 1) % groupSpan;
        if (orderIndex > 0) {
          const prev = [orderBases[orderIndex - 1], orderBases[orderIndex - 1], orderSeconds[orderIndex - 1]].join(',');
          let current = [orderBases[orderIndex], orderBases[orderIndex], gid].join(',');
          let guard = 0;
          while (current === prev && guard++ < groupSpan) {
            gid = (gid + 1) % groupSpan;
            if (gid === orderBases[orderIndex]) gid = (gid + 1) % groupSpan;
            current = [orderBases[orderIndex], orderBases[orderIndex], gid].join(',');
          }
        }
        orderSeconds[orderIndex] = gid;
      }
    } else {
      // ABC: three distinct items, still easier boards via reduced traps/layers.
      if (itemIndex === 1) {
        gid = (orderBases[orderIndex] + 1 + (seed % Math.max(1, groupSpan - 1))) % groupSpan;
        if (gid === orderBases[orderIndex]) gid = (gid + 1) % groupSpan;
        orderSeconds[orderIndex] = gid;
      } else {
        gid = (orderBases[orderIndex] + 2 + (seed % Math.max(1, groupSpan - 1))) % groupSpan;
        let guard = 0;
        while (
          (gid === orderBases[orderIndex] || gid === orderSeconds[orderIndex]) &&
          guard++ < groupSpan
        ) {
          gid = (gid + 1) % groupSpan;
        }
        if (orderIndex > 0) {
          const prev = [orderBases[orderIndex - 1], orderSeconds[orderIndex - 1], orderThirds[orderIndex - 1]].join(',');
          let current = [orderBases[orderIndex], orderSeconds[orderIndex], gid].join(',');
          guard = 0;
          while (current === prev && guard++ < groupSpan) {
            gid = (gid + 1) % groupSpan;
            if (gid === orderBases[orderIndex] || gid === orderSeconds[orderIndex]) continue;
            current = [orderBases[orderIndex], orderSeconds[orderIndex], gid].join(',');
          }
        }
        orderThirds[orderIndex] = gid;
      }
    }

    sequence[s].groupId = GROUPS[gid];
  }
  addDecoys(tiles, sequence, idx, board);
  addOpeningAmbiguity(tiles, sequence, idx, board);
  applyTileSizes(tiles);
  ensureCatalogAwareSpacing(board, tiles);

  const solutionMoveTileIds = sequence.map(t => t.id);
  const { orders, solutionOrders } = buildOrdersFromTapSequence(sequence, idx);
  compactEarlyPresetLayerOverlap(difficultyIdx, board, tiles);
  ensureCatalogAwareSpacing(board, tiles);
  applyFinalCoverThreshold(difficultyIdx, board);
  convertToLowerOnTop(board, tiles);
  ensureCatalogAwareSpacing(board, tiles);
  computeBlockStatus(tiles, board);

  const bandParams = difficultyBandParams(idx);
  const level = {
    levelId,
    displayName: `Level ${pad(levelId)} - ${shapeName}`,
    defaultSkin: 'uma',
    gameMode: 'ORDER_MATCH',
    startingBoosters: boostersFor(idx),
    board,
    tray: { maxSlots: 7, matchCount: 3, screenPosition: { x: 540, y: 200 }, slotSpacing: 110 },
    orderConfig: {
      orderSize: 3,
      orderMode: 'EXACT_ORDER',
      wrongTrayMaxSlots: bandParams.wrongTrayMaxSlots,
      consumeWrongTile: true,
    },
    orders,
    solutionOrders,
    solutionMoveTileIds,
    tiles,
    starThresholds: [0, 500, 1000],
    difficultyMetrics: {
      difficultyIndex: idx + 1,
      orderPatternBand: band,
    },
  };

  const result = validate(level);
  if (result.errors.length) throw new Error(`level ${levelId} invalid:\n${result.errors.join('\n')}`);
  const choices = choiceMetrics(level);
  const branch = branchDifficultyMetrics(level);
  const stagger = staggeredOrderMetrics(level);
  const interleavedMoves = interleavedMoveMetrics(level);

  const layerCounts = {};
  for (const t of tiles) layerCounts[`layer_${t.layer}`] = (layerCounts[`layer_${t.layer}`] || 0) + 1;
  const relaxedLayerVisibility = difficultyIdx < EARLY_PRESET_SHAPES.length;

  level.difficultyMetrics = {
    designType: 'casual_order_match_aaa_aab_abc_v1_visible_layers',
    difficultyBand: idx < 5 ? 'tutorial_aaa' : idx < 15 ? 'easy_aab' : idx < 35 ? 'casual_abc' : 'casual_late',
    difficultyIndex: idx + 1,
    orderPatternBand: band,
    shapeName,
    totalTiles: tiles.length,
    orderCount: orders.length,
    maxLayers: board.maxLayers,
    startingSelectableTiles: selectable(tiles).length,
    sameItemPathDecoyCount: tiles.filter(t => t.strategyRole === 'same_item_path_decoy').length,
    criticalPathDecoyCount: tiles.filter(t => t.strategyRole === 'critical_path_decoy').length,
    openingSameItemDecoyCount: tiles.filter(t => t.strategyRole === 'opening_same_item_decoy').length,
    totalStrategicDecoyCount: tiles.filter(t => !!t.strategyRole).length,
    averageSelectableTilesDuringSolution: choices.averageSelectableTilesDuringSolution,
    averageSameItemChoicesDuringSolution: choices.averageSameItemChoicesDuringSolution,
    maxSameItemChoicesDuringSolution: choices.maxSameItemChoicesDuringSolution,
    firstTenSameItemChoices: choices.firstTenSameItemChoices,
    forcedSteps: branch.forcedSteps,
    realTrapSteps: branch.realTrapSteps,
    harmlessAmbiguousSteps: branch.harmlessAmbiguousSteps,
    averageCorrectChoices: branch.averageCorrectChoices,
    averageWinningChoices: branch.averageWinningChoices,
    firstTenBranching: branch.firstTenBranching,
    staggeredOrders: stagger.staggeredOrders,
    staggeredOrderRatio: stagger.staggeredOrderRatio,
    firstTenOrderStartSelectable: stagger.firstTenOrderStartSelectable,
    wrongUnlockerMoves: interleavedMoves.wrongUnlockerMoves,
    wrongUnlockerRatio: interleavedMoves.wrongUnlockerRatio,
    firstTwentyMoveKinds: interleavedMoves.firstTwentyMoveKinds,
    topLayerTileCount: tiles.filter(t => t.layer === board.maxLayers - 1).length,
    bottomLayerTileCount: tiles.filter(t => t.layer === 0).length,
    phaseCountsTopToBottom: Object.keys(layerCounts).sort((a, b) => Number(b.split('_')[1]) - Number(a.split('_')[1])).map(k => layerCounts[k]),
    sameLayerOverlapByLayer: layerCounts,
    sameLayerOverlapValidated: true,
    shapeConnectedValidated: true,
    layerVisibilityPairs: layerVisibilityMetrics(board.maxLayers, board),
    lowerLayerVisibleTarget: { min: 0, max: relaxedLayerVisibility ? 0.6 : 0.5 },
    tileSize: { width: TILE_W, height: TILE_H },
    spacing: { x: board.tileSpacing, y: board.tileSpacingY },
    screenBounds: result.bounds,
    screenSafeBounds: clone(SAFE),
    screenFitValidated: true,
    solutionValidated: true,
    strategicGoal: 'Progressive ORDER_MATCH puzzle with unique balanced silhouettes, deeper core stacks, exact solution path, same-item decoys, and lower layers visibly offset by about 1/3-1/2 tile area.',
  };
  return level;
}

function progressiveScore(level) {
  const m = level.difficultyMetrics;
  return round(
    level.tiles.length * 1.2 +
    level.board.maxLayers * 5 +
    m.averageSameItemChoicesDuringSolution * 6 +
    m.totalStrategicDecoyCount * 1.5 +
    (m.criticalPathDecoyCount || 0) * 1.5 +
    (m.realTrapSteps || 0) * 18 +
    m.maxSameItemChoicesDuringSolution * 2 -
    (m.harmlessAmbiguousSteps || 0) * 1.2
  );
}

function difficultyBandForIndex(idx) {
  return idx < 5 ? 'tutorial_aaa' : idx < 15 ? 'easy_aab' : idx < 35 ? 'casual_abc' : 'casual_late';
}

function renumberLevel(level, idx) {
  const newLevelId = START + idx;
  const difficultyIdx = DIFFICULTY_BASE + idx;
  const idMap = new Map();
  for (let i = 0; i < level.tiles.length; i++) {
    idMap.set(level.tiles[i].id, `L${newLevelId}_T${pad(i)}`);
  }

  level.levelId = newLevelId;
  level.displayName = `Level ${pad(newLevelId)} - ${level.board.shapeName}`;
  level.startingBoosters = boostersFor(difficultyIdx);
  for (let i = 0; i < level.tiles.length; i++) {
    const tile = level.tiles[i];
    tile.id = idMap.get(tile.id);
    if (tile.decoyAgainstKeyTile && idMap.has(tile.decoyAgainstKeyTile)) {
      tile.decoyAgainstKeyTile = idMap.get(tile.decoyAgainstKeyTile);
    }
  }
  level.solutionMoveTileIds = level.solutionMoveTileIds.map(id => idMap.get(id) ?? id);
  level.difficultyMetrics.difficultyIndex = difficultyIdx + 1;
  level.difficultyMetrics.difficultyBand = difficultyBandForIndex(difficultyIdx);
  level.difficultyMetrics.orderPatternBand = orderPatternBand(difficultyIdx);
  level.difficultyMetrics.progressiveDifficultyScore = progressiveScore(level);
  for (const tile of level.tiles) tile.active = true;
  computeBlockStatus(level.tiles, level.board);

  const result = validate(level);
  if (result.errors.length) throw new Error(`renumbered level ${newLevelId} invalid:\n${result.errors.join('\n')}`);
  level.difficultyMetrics.screenBounds = result.bounds;
}

const signatures = new Set();
const summary = [];
const levels = [];
// Keep progressive AAA→AAB→ABC bands in level order for the casual 1-50 pack.
const preserveGenerationOrder = process.env.PRESERVE_GENERATION_ORDER === '1'
  || (process.env.PRESERVE_GENERATION_ORDER !== '0' && START <= 50 && COUNT > 0 && COUNT <= 50);
const allowDuplicateShapes = LARGE_TILE_PACK || COUNT > ACTIVE_SHAPES.length + EARLY_PRESET_SHAPES.length;

const desiredCount = COUNT > 0 ? COUNT : ACTIVE_SHAPES.length;
for (let idx = 0; idx < desiredCount * 80 && levels.length < desiredCount; idx++) {
  let level;
  try {
    level = makeLevel(idx, DIFFICULTY_BASE + (preserveGenerationOrder ? levels.length : idx));
  } catch (err) {
    if (process.env.DEBUG_GENERATOR === '1') {
      console.error(`[gen] skip/fail idx=${idx}:`, err.message || err);
      if (
        !String(err.message || err).includes('same-layer') &&
        !String(err.message || err).includes('screen fit') &&
        !String(err.message || err).includes('invalid') &&
        !String(err.message || err).includes('only fits')
      ) {
        throw err;
      }
    }
    continue;
  }
  const sig = level.board.shapePattern.map(r => r.join('')).join('/');
  if (signatures.has(sig) && !allowDuplicateShapes) continue;
  if (!signatures.has(sig)) signatures.add(sig);
  level.difficultyMetrics.progressiveDifficultyScore = progressiveScore(level);
  levels.push(level);
}

if (!preserveGenerationOrder) {
  levels.sort((a, b) => {
    const ta = a.difficultyMetrics.realTrapSteps || 0;
    const tb = b.difficultyMetrics.realTrapSteps || 0;
    if (ta !== tb) return ta - tb;
    const sa = a.difficultyMetrics.progressiveDifficultyScore;
    const sb = b.difficultyMetrics.progressiveDifficultyScore;
    if (sa !== sb) return sa - sb;
    if (a.tiles.length !== b.tiles.length) return a.tiles.length - b.tiles.length;
    return a.board.maxLayers - b.board.maxLayers;
  });
}

const exportCount = COUNT > 0 ? Math.min(COUNT, levels.length) : levels.length;
if (COUNT > 0 && exportCount < COUNT) {
  throw new Error(`only generated ${exportCount}/${COUNT} valid levels`);
}
for (let idx = 0; idx < exportCount; idx++) {
  const level = levels[idx];
  renumberLevel(level, idx);
  fs.writeFileSync(path.join(DIR, `level_${pad(level.levelId)}.json`), JSON.stringify(level, null, 2) + '\n', 'utf8');
  summary.push({
    id: level.levelId,
    shape: level.board.shapeName,
    tiles: level.tiles.length,
    cells: level.board.shapePattern.flat().filter(Boolean).length,
    layers: level.board.maxLayers,
    decoys: level.difficultyMetrics.sameItemPathDecoyCount,
    totalDecoys: level.difficultyMetrics.totalStrategicDecoyCount,
    score: level.difficultyMetrics.progressiveDifficultyScore,
    visible: level.difficultyMetrics.layerVisibilityPairs,
    bounds: level.difficultyMetrics.screenBounds,
  });
}

console.log(JSON.stringify({
  generated: exportCount,
  uniqueShapes: signatures.size,
  maxTile: { w: MAX_TILE_W, h: MAX_TILE_H },
  groups: GROUPS.length,
  first: summary.slice(0, 5),
  mid: summary.slice(24, 26),
  last: summary.slice(-3),
}, null, 2));
