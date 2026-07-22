import { IBoardConfig } from '../interfaces/IBoardConfig';
import { ITileData, ITilePosition } from '../interfaces/ITileData';

/**
 * BoardPositionHelper - Tính toán vị trí, jitter và overlap giữa các tile.
 * Dùng chung cho BoardManager (runtime) và LevelSolver (validation).
 */
export class BoardPositionHelper {
    private static readonly DEFAULT_STRIP_WIDTH_RATIO = 0.45;
    private static readonly DEFAULT_STRIP_HEIGHT_RATIO = 0.07;
    private static readonly DEFAULT_SINGLE_COVER_AREA_RATIO = 0.02;

    public static isLayerAbove(otherLayer: number, tileLayer: number, config: IBoardConfig): boolean {
        return config.layerOrder === 'lowerOnTop'
            ? otherLayer < tileLayer
            : otherLayer > tileLayer;
    }

    public static getTileWidth(tile: Partial<ITileData> | ITilePosition, config: IBoardConfig): number {
        const value = (tile as ITileData).tileWidth;
        return Number.isFinite(value) && value! > 0 ? value! : (config.tileWidth ?? 100);
    }

    public static getTileHeight(tile: Partial<ITileData> | ITilePosition, config: IBoardConfig): number {
        const value = (tile as ITileData).tileHeight;
        return Number.isFinite(value) && value! > 0 ? value! : (config.tileHeight ?? 120);
    }

    /** Jitter xác định từ layer seed (không random runtime) */
    public static getLayerJitter(layer: number, axis: number, config: IBoardConfig): number {
        const prime1 = 15485863;
        const prime2 = 32452843;
        const seed = Math.abs(layer * prime1 + axis * prime2);

        const jitterMultiplier = axis === 0
            ? (config.jitterX ?? 0.3)
            : (config.jitterY ?? 0.3);
        const size = axis === 0
            ? (config.tileWidth ?? 100)
            : (config.tileHeight ?? 120);

        return ((seed % 100) / 100 - 0.5) * size * jitterMultiplier;
    }

    /** Tính tâm tile theo công thức mới */
    public static getTileCenter(tile: ITilePosition, config: IBoardConfig): { x: number; y: number } {
        const spacingX = config.tileSpacingX ?? config.tileSpacing;
        const spacingY = config.tileSpacingY ?? config.tileSpacing;
        const jitterX = this.getLayerJitter(tile.layer, 0, config);
        const jitterY = this.getLayerJitter(tile.layer, 1, config);
        const x = config.centerOffset.x + tile.gridX * spacingX + jitterX;
        const y = config.centerOffset.y - tile.gridY * spacingY + jitterY;
        return { x, y };
    }

    /** Tính diện tích overlap (pixel²) giữa 2 tile */
    public static calculateOverlapInfo(
        tileA: ITilePosition,
        tileB: ITilePosition,
        config: IBoardConfig
    ): { width: number; height: number; area: number; widthRatio: number; heightRatio: number } {
        const tileAW = this.getTileWidth(tileA, config);
        const tileAH = this.getTileHeight(tileA, config);
        const tileBW = this.getTileWidth(tileB, config);
        const tileBH = this.getTileHeight(tileB, config);
        if (tileAW <= 0 || tileAH <= 0 || tileBW <= 0 || tileBH <= 0) {
            return { width: 0, height: 0, area: 0, widthRatio: 0, heightRatio: 0 };
        }

        const centerA = this.getTileCenter(tileA, config);
        const centerB = this.getTileCenter(tileB, config);

        const overlapW = Math.max(0, (tileAW + tileBW) * 0.5 - Math.abs(centerA.x - centerB.x));
        const overlapH = Math.max(0, (tileAH + tileBH) * 0.5 - Math.abs(centerA.y - centerB.y));
        const minW = Math.min(tileAW, tileBW);
        const minH = Math.min(tileAH, tileBH);

        return {
            width: overlapW,
            height: overlapH,
            area: overlapW * overlapH,
            widthRatio: minW > 0 ? overlapW / minW : 0,
            heightRatio: minH > 0 ? overlapH / minH : 0,
        };
    }

    public static calculateOverlapArea(
        tileA: ITilePosition,
        tileB: ITilePosition,
        config: IBoardConfig
    ): number {
        return this.calculateOverlapInfo(tileA, tileB, config).area;
    }

    public static isBlockingOverlap(
        tile: ITileData,
        coverer: ITileData,
        config: IBoardConfig,
        accumulatedOverlap: number = 0
    ): boolean {
        const info = this.calculateOverlapInfo(tile, coverer, config);
        if (info.area <= 0) return false;

        const tileArea = this.getTileWidth(tile, config) * this.getTileHeight(tile, config);
        const minOverlap = Math.max(config.minBlockOverlapPixels ?? 1, tileArea * (config.coverThreshold ?? 0.01));
        if (accumulatedOverlap + info.area > minOverlap) return true;
        if (info.area / tileArea >= (config.blockOverlapAreaRatio ?? this.DEFAULT_SINGLE_COVER_AREA_RATIO)) return true;

        const minWidthRatio = config.blockOverlapWidthRatio ?? this.DEFAULT_STRIP_WIDTH_RATIO;
        const minHeightRatio = config.blockOverlapHeightRatio ?? this.DEFAULT_STRIP_HEIGHT_RATIO;
        return info.widthRatio >= minWidthRatio && info.heightRatio >= minHeightRatio;
    }

    /** Kiểm tra tile có bị block không dựa trên overlap với tile ở layer cao hơn */
    public static isTileBlocked(
        tile: ITileData,
        allTiles: ITileData[],
        config: IBoardConfig
    ): boolean {
        if (!tile.active) return true;

        const blockMode = config.blockMode ?? 'overlap';
        if (blockMode === 'sameCell') {
            for (const other of allTiles) {
                if (other.id === tile.id) continue;
                if (!other.active) continue;
                if (other.gridX === tile.gridX && other.gridY === tile.gridY && this.isLayerAbove(other.layer, tile.layer, config)) {
                    return true;
                }
            }
            return false;
        }

        let totalOverlap = 0;
        for (const other of allTiles) {
            if (other.id === tile.id) continue;
            if (!other.active) continue;
            if (!this.isLayerAbove(other.layer, tile.layer, config)) continue;

            if (this.isBlockingOverlap(tile, other, config, totalOverlap)) return true;
            const overlap = this.calculateOverlapArea(tile, other, config);
            totalOverlap += overlap;
            // Early exit nếu đã vượt ngưỡng
        }
        return false;
    }
}
