import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LEVELS_DIR = path.join(ROOT, 'assets', 'resources', 'data', 'levels');
/** Commit chứa layout gốc (shape/layer) trước khi chuyển TRIPLE_MATCH. */
const ORIG_GIT_REF = process.env.ORIG_GIT_REF || '4790d1a';
const TILE_SIZE_CATALOG = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'assets', 'resources', 'data', 'tile_size_catalog.json'), 'utf8')
);

/**
 * Giữ nguyên shape/layer/vị trí tile từ level gốc.
 * Chỉ đổi rule → TRIPLE_MATCH và phân bổ lại item (0-15) đều qua 5 level.
 * Thứ tự play: old2, old3, old1, old4, old5.
 */
const LEVEL_PLANS = [
  { levelId: 1, sourceLevelId: 2, groups: ['4', '5', '6'] },
  { levelId: 2, sourceLevelId: 3, groups: ['7', '8', '9'] },
  { levelId: 3, sourceLevelId: 1, groups: ['0', '1', '2', '3'] },
  { levelId: 4, sourceLevelId: 4, groups: ['10', '11', '12'] },
  { levelId: 5, sourceLevelId: 5, groups: ['13', '14', '15'] },
];

function pad(n) {
  return String(n).padStart(3, '0');
}

function readOriginalLevel(levelId) {
  const relPath = `assets/resources/data/levels/level_${pad(levelId)}.json`;
  const raw = execFileSync('git', ['show', `${ORIG_GIT_REF}:${relPath}`], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return JSON.parse(raw.replace(/^\uFEFF/, ''));
}

/** Chia totalTiles thành counts bội số 3, càng đều càng tốt. */
function buildGroupCounts(totalTiles, groups) {
  if (totalTiles % 3 !== 0) {
    throw new Error(`Tile count ${totalTiles} is not divisible by 3`);
  }
  const tripleSlots = totalTiles / 3;
  const counts = Object.fromEntries(groups.map((g) => [g, 0]));
  for (let i = 0; i < tripleSlots; i++) {
    counts[groups[i % groups.length]] += 3;
  }
  return counts;
}

/**
 * Gán groupId ưu tiên tile layer cao / đang selectable trước,
 * để lúc mở level thường có sẵn bộ 3 giống nhau dễ click.
 */
function assignGroupIds(tiles, groups, counts) {
  const remaining = { ...counts };
  const order = tiles
    .map((tile, index) => ({ tile, index }))
    .sort((a, b) => {
      const layerDiff = (b.tile.layer ?? 0) - (a.tile.layer ?? 0);
      if (layerDiff !== 0) return layerDiff;
      const selDiff = Number(b.tile.selectable) - Number(a.tile.selectable);
      if (selDiff !== 0) return selDiff;
      return a.index - b.index;
    });

  const assigned = new Array(tiles.length);
  let groupCursor = 0;

  for (const { index } of order) {
    let picked = null;
    for (let offset = 0; offset < groups.length; offset++) {
      const gid = groups[(groupCursor + offset) % groups.length];
      if (remaining[gid] > 0) {
        picked = gid;
        groupCursor = (groupCursor + offset + 1) % groups.length;
        break;
      }
    }
    if (!picked) throw new Error('Ran out of group assignments');
    remaining[picked]--;
    assigned[index] = picked;
  }

  return assigned;
}

function convertLevel(plan) {
  const sourceLevelId = plan.sourceLevelId ?? plan.levelId;
  const orig = readOriginalLevel(sourceLevelId);
  const tiles = Array.isArray(orig.tiles) ? orig.tiles : [];
  const counts = buildGroupCounts(tiles.length, plan.groups);
  const groupIds = assignGroupIds(tiles, plan.groups, counts);
  const idPrefix = new RegExp(`^L${sourceLevelId}_`);

  const nextTiles = tiles.map((tile, index) => {
    const groupId = groupIds[index];
    const size = TILE_SIZE_CATALOG[groupId] || { width: tile.tileWidth, height: tile.tileHeight };
    const nextId = typeof tile.id === 'string'
      ? tile.id.replace(idPrefix, `L${plan.levelId}_`)
      : tile.id;
    const blockedBy = Array.isArray(tile.blockedBy)
      ? tile.blockedBy.map((id) => (typeof id === 'string' ? id.replace(idPrefix, `L${plan.levelId}_`) : id))
      : tile.blockedBy;
    return {
      ...tile,
      id: nextId,
      blockedBy,
      groupId,
      tileWidth: size.width,
      tileHeight: size.height,
    };
  });

  const level = {
    levelId: plan.levelId,
    displayName: `Level ${pad(plan.levelId)} - ${orig.board?.shapeName || 'level'}`,
    defaultSkin: orig.defaultSkin || 'uma',
    gameMode: 'TRIPLE_MATCH',
    startingBoosters: {
      HINT: 5,
      UNDO: orig.startingBoosters?.UNDO ?? 3,
      SKIP: orig.startingBoosters?.SKIP ?? 0,
    },
    board: orig.board,
    tray: orig.tray,
    tiles: nextTiles,
    timeLimit: orig.timeLimit ?? 0,
    moveLimit: orig.moveLimit ?? 0,
  };

  return { level, counts };
}

for (const plan of LEVEL_PLANS) {
  const { level, counts } = convertLevel(plan);
  const outPath = path.join(LEVELS_DIR, `level_${pad(plan.levelId)}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(level, null, 2)}\n`, 'utf8');

  const layers = [...new Set(level.tiles.map((t) => t.layer))].sort((a, b) => a - b);
  console.log(
    `L${plan.levelId} shape=${level.board.shapeName} maxLayers=${level.board.maxLayers} ` +
      `tiles=${level.tiles.length} layers=[${layers.join(',')}] counts=${JSON.stringify(counts)}`
  );
}

const used = LEVEL_PLANS.flatMap((p) => p.groups);
console.log(`Distributed ${new Set(used).size}/16 unique tile types across levels 1-5`);
