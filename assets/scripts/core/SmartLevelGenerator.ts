import { ITileData } from '../interfaces/ITileData';
import { IBoardConfig } from '../interfaces/IBoardConfig';
import { ITrayConfig } from '../interfaces/ITrayConfig';
import { IDifficultyConfig } from '../interfaces/IDifficultyConfig';
import { ILevelOutput } from '../interfaces/ILevelOutput';
import { ITEM_ID_COUNT } from './ItemIdCatalog';
import { LevelGenerator } from './LevelGenerator';
import { LevelSolver } from './LevelSolver';
import { TileType } from '../enums/TileType';

/**
 * SmartLevelGenerator V3 - Sinh level với placement đảm bảo solvable.
 * Mỗi triplet: 2 tile layer 0 (cell riêng) + 1 tile layer 1 (đè lên 1 cell của chính nó).
 * Cơ chế block: sameCell — tile bị block nếu có tile active khác ở layer cao hơn trong cùng cell.
 */
export class SmartLevelGenerator {

    private static readonly TRAY_SLOTS = 7;
    private static readonly MATCH_COUNT = 3;
    private static readonly SHAPE_NAMES = Object.keys(LevelGenerator.SHAPES);

    public static generate(
        levelId: number,
        difficulty: IDifficultyConfig,
        groupIds: string[],
        shapeName?: string
    ): ILevelOutput {
        if (!groupIds || groupIds.length === 0) {
            throw new Error('SmartLevelGenerator: groupIds must not be empty');
        }
        if (difficulty.totalTriplets < 1) {
            throw new Error('SmartLevelGenerator: totalTriplets must be >= 1');
        }

        const effectiveGroups = groupIds.slice(0, difficulty.tileTypeCount);
        if (effectiveGroups.length === 0) {
            throw new Error('SmartLevelGenerator: not enough groupIds for tileTypeCount');
        }

        const shape = shapeName && LevelGenerator.SHAPES[shapeName]
            ? LevelGenerator.SHAPES[shapeName]
            : this.pickShapeForDifficulty(difficulty);

        const rows = shape.length;
        const cols = shape[0]?.length || 0;

        const baseCells: { gridX: number; gridY: number }[] = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (shape[r][c] === 1) baseCells.push({ gridX: c, gridY: r });
            }
        }

        const requiredTiles = difficulty.totalTriplets * 3;
        const maxCapacity = baseCells.length * difficulty.layerCount;
        if (maxCapacity < requiredTiles) {
            difficulty = { ...difficulty, layerCount: Math.ceil(requiredTiles / baseCells.length) };
        }

        // spacing phải đủ lớn để cross-cell tiles (khác layer) không overlap
        // tileWidth=100, max jitter diff = 100*0.3 = 30 → spacingX >= 130
        // tileHeight=120, max jitter diff = 120*0.3 = 36 → spacingY >= 156
        const spacingX = 130;
        const spacingY = 160;
        const boardConfig: IBoardConfig = {
            rows, cols,
            maxLayers: difficulty.layerCount,
            tileSpacing: spacingX,
            tileSpacingY: spacingY,
            centerOffset: {
                x: -((cols - 1) * spacingX) / 2,
                y: ((rows - 1) * spacingY) / 2 + 35
            },
            tileWidth: 100, tileHeight: 120,
            jitterX: 0.3, jitterY: 0.3,
            jitterMode: 'layer',
            blockMode: 'overlap',
            minBlockOverlapPixels: 1,
            coverThreshold: difficulty.coverThreshold,
            shapePattern: shape,
        };

        const trayConfig: ITrayConfig = {
            maxSlots: this.TRAY_SLOTS,
            matchCount: this.MATCH_COUNT,
            screenPosition: { x: 540, y: 200 },
            slotSpacing: 110,
        };

        const seed = levelId * 1000;
        const solutionSteps = this.generateSolutionSteps(difficulty.totalTriplets, effectiveGroups, seed);
        const tiles = this.placeTiles(solutionSteps, baseCells, difficulty.layerCount, levelId, seed);

        // Compute block status
        LevelSolver.computeBlockStatus(tiles, boardConfig);

        // Validate basic constraints only (no heavy BFS)
        const activeTiles = tiles.filter(t => t.active);
        if (activeTiles.length % 3 !== 0) {
            throw new Error(`Tile count ${activeTiles.length} not divisible by 3`);
        }
        const counts: Record<string, number> = {};
        for (const t of activeTiles) counts[t.groupId] = (counts[t.groupId] || 0) + 1;
        for (const gid of Object.keys(counts)) {
            if (counts[gid] % 3 !== 0) throw new Error(`Group ${gid} count ${counts[gid]} not divisible by 3`);
        }

        const selectable = activeTiles.filter(t => t.selectable);
        if (selectable.length === 0) throw new Error('No selectable tiles at start');

        return {
            levelId,
            displayName: `Level ${levelId}`,
            defaultSkin: 'uma',
            board: boardConfig,
            tiles,
            tray: trayConfig,
            difficultyConfig: difficulty,
            solutionSteps,
        };
    }

    public static generateSolutionSteps(
        totalTriplets: number,
        groupIds: string[],
        seed?: number
    ): string[][] {
        const rng = this.seededRandom(seed ?? 12345);
        const shuffled = this.shuffleArray([...groupIds], rng);
        const steps: string[][] = [];
        for (let i = 0; i < totalTriplets; i++) {
            const gid = shuffled[i % shuffled.length];
            steps.push([gid, gid, gid]);
        }
        return steps;
    }

    /**
     * Structured placement guaranteeing solvability with sameCell blocking.
     * Each triplet: 2 tiles at layer 0 (separate cells) + 1 tile at layer 1 (same cell as first).
     * The layer-0 tile in the shared cell is blocked until the layer-1 tile is picked.
     */
    private static placeTiles(
        solutionSteps: string[][],
        baseCells: { gridX: number; gridY: number }[],
        layerCount: number,
        levelId: number,
        seed: number
    ): ITileData[] {
        const tiles: ITileData[] = [];
        let idCounter = 0;
        const rng = this.seededRandom(seed);
        const shuffledCells = this.shuffleArray([...baseCells], rng);

        const makeTile = (gridX: number, gridY: number, layer: number, groupId: string): ITileData => {
            const padded = idCounter < 10 ? `00${idCounter}` : idCounter < 100 ? `0${idCounter}` : `${idCounter}`;
            idCounter++;
            return {
                id: `L${levelId}_T${padded}`,
                groupId,
                tileType: TileType.NORMAL,
                gridX, gridY, layer,
                active: true,
                selectable: true,
                isBlocked: false,
            };
        };

        let cellIdx = 0;

        if (layerCount >= 3) {
            // Tower mode: each triplet occupies 1 cell across layers 0,1,2
            // Player must clear top-to-bottom. Solvable because all 3 tiles share groupId.
            for (const step of solutionSteps) {
                const gid = step[0];
                const cell = shuffledCells[cellIdx++ % shuffledCells.length];
                tiles.push(makeTile(cell.gridX, cell.gridY, 0, gid));
                tiles.push(makeTile(cell.gridX, cell.gridY, 1, gid));
                tiles.push(makeTile(cell.gridX, cell.gridY, 2, gid));
            }
        } else {
            // Phase 1: place 2 layer-0 tiles per triplet
            const assignments: { cellA: { gridX: number; gridY: number }; cellB: { gridX: number; gridY: number } }[] = [];
            for (const step of solutionSteps) {
                const gid = step[0];
                const cellA = shuffledCells[cellIdx++ % shuffledCells.length];
                const cellB = shuffledCells[cellIdx++ % shuffledCells.length];
                tiles.push(makeTile(cellA.gridX, cellA.gridY, 0, gid));
                tiles.push(makeTile(cellB.gridX, cellB.gridY, 0, gid));
                assignments.push({ cellA, cellB });
            }

            // Phase 2: place 1 layer-1 tile per triplet on cellA
            for (let i = 0; i < solutionSteps.length; i++) {
                const gid = solutionSteps[i][0];
                const layer = Math.min(1, layerCount - 1);
                tiles.push(makeTile(assignments[i].cellA.gridX, assignments[i].cellA.gridY, layer, gid));
            }
        }

        return tiles;
    }

    private static pickShapeForDifficulty(difficulty: IDifficultyConfig): number[][] {
        const index = (difficulty.difficulty - 1) % this.SHAPE_NAMES.length;
        return LevelGenerator.SHAPES[this.SHAPE_NAMES[index]];
    }

    /**
     * Curve 50 level / 13 clip: 1–5 rất dễ, 6–12 dễ, 13–20 vừa,
     * 21–32 khó, 33–50 rất khó (thúc Hint 8★ / Undo 3★ / Skip 40★).
     * Chỉ ảnh hưởng level generate mới — JSON sẵn trong resources vẫn giữ board cũ.
     */
    public static getDifficultyForLevel(levelId: number): IDifficultyConfig {
        const id = Math.max(1, Math.floor(levelId));
        const layerCount = id <= 12 ? 2 : id <= 28 ? 3 : 4;
        const tileTypeCount = id <= 5
            ? 3
            : Math.min(4 + Math.floor((id - 1) / 8), ITEM_ID_COUNT);
        const totalTriplets = id <= 5
            ? 4
            : id <= 12
                ? 6
                : Math.min(8 + Math.floor((id - 12) / 4), 16);
        const safeMoveWindow = id <= 5 ? 4 : id <= 12 ? 3 : id <= 28 ? 2 : 1;
        const trapRate = id <= 5
            ? 0.04
            : id <= 12
                ? 0.10
                : Math.min(0.16 + (id - 12) * 0.012, 0.55);
        const visibleTripletLimit = id <= 12 ? 3 : id <= 28 ? 2 : 1;
        const coverThreshold = id <= 12 ? 0.22 : id <= 28 ? 0.30 : 0.36;

        return {
            difficulty: id,
            layerCount,
            tileTypeCount,
            totalTriplets,
            safeMoveWindow,
            trapRate,
            visibleTripletLimit,
            coverThreshold,
        };
    }

    private static shuffleArray<T>(arr: T[], rng?: () => number): T[] {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor((rng ? rng() : Math.random()) * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    private static seededRandom(seed: number): () => number {
        let s = seed;
        return () => {
            s = (s * 16807 + 0) % 2147483647;
            return (s - 1) / 2147483646;
        };
    }
}
