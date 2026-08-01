import { _decorator, Component } from 'cc';
import { ITileData } from '../interfaces/ITileData';
import { MatchResult } from '../enums/MatchResult';
import { GameEvent } from '../enums/GameEvent';
import { EventBus } from '../core/EventBus';
import { TrayManager } from './TrayManager';
import { TileManager } from './TileManager';
import { LevelManager } from './LevelManager';
import { AudioManager } from './AudioManager';
import { OrderManager } from './OrderManager';

const { ccclass } = _decorator;

/**
 * MatchManager - Xử lý Triple Match trong tray.
 * Chỉ đổi điều kiện khớp: có 3 item cùng loại trên tray.
 * Timing/effect clear giữ như ORDER_MATCH (nhảy ra ngay, không delay glow).
 */
@ccclass('MatchManager')
export class MatchManager extends Component {
    public static Instance: MatchManager;
    public static getInstance(): MatchManager { return MatchManager.Instance; }

    private _isProcessing: boolean = false;
    private _isRestarting: boolean = false;

    protected onLoad(): void {
        if (MatchManager.Instance) { this.destroy(); return; }
        MatchManager.Instance = this;

        EventBus.getInstance().on(GameEvent.TILE_ADDED_TO_TRAY, this.onTrayChanged, this);
        EventBus.getInstance().on(GameEvent.TRAY_SETTLED, this.onTrayChanged, this);
        EventBus.getInstance().on(GameEvent.LEVEL_STARTED, this.onLevelStarted, this);
    }

    private onLevelStarted(): void {
        this._isProcessing = false;
        this._isRestarting = false;
    }

    /** Khi tray thay đổi / settled: kiểm tra match hoặc tray full ngay như ORDER_MATCH */
    private onTrayChanged(): void {
        if (this._isProcessing || this._isRestarting) return;

        if (OrderManager.getInstance().isActive()) {
            return;
        }

        const trayManager = TrayManager.getInstance();
        if (!trayManager) return;

        // Đợi tile bay xong rồi check ngay (không thêm delay glow).
        if (trayManager.getFlyCount() > 0) return;

        this.evaluateTray();
    }

    private evaluateTray(): void {
        if (this._isRestarting || this._isProcessing) return;
        const lifecycleId = TileManager.getInstance().getLifecycleId();

        const result = this.checkMatch();
        if (lifecycleId !== TileManager.getInstance().getLifecycleId()) return;

        if (result === MatchResult.GAME_OVER || result === MatchResult.TRAY_FULL) {
            this._isRestarting = true;
            LevelManager.getInstance().onLevelFailed('tray_full');
        } else if (result === MatchResult.NO_MATCH) {
            if (!this.hasValidMoves() && !this.hasPendingMatch()) {
                this._isRestarting = true;
                LevelManager.getInstance().onLevelFailed('no_valid_moves');
            }
        }
    }

    /** Kiểm tra và xử lý match trong tray */
    public checkMatch(): MatchResult {
        const trayTiles = TrayManager.getInstance().getTrayTiles();
        const matchCount = TrayManager.getInstance().getMatchCount();

        const matchTiles = this.findSameGroupMatch(trayTiles, matchCount);
        if (matchTiles) {
            this.processMatch(matchTiles);
            return MatchResult.MATCHED;
        }

        if (TrayManager.getInstance().isDeadEnd()) {
            return MatchResult.GAME_OVER;
        }

        if (TrayManager.getInstance().isFull()) {
            return MatchResult.TRAY_FULL;
        }

        return MatchResult.NO_MATCH;
    }

    /**
     * Tìm 3 tile cùng groupId bất kỳ trên tray (không cần liền kề),
     * tương tự ORDER_MATCH chỉ khác yêu cầu là cùng loại.
     */
    private findSameGroupMatch(tiles: ITileData[], matchCount: number): ITileData[] | null {
        if (!tiles || tiles.length < matchCount) return null;

        const groups: Record<string, ITileData[]> = {};
        for (const tile of tiles) {
            const list = groups[tile.groupId] || (groups[tile.groupId] = []);
            list.push(tile);
            if (list.length >= matchCount) {
                return list.slice(0, matchCount);
            }
        }
        return null;
    }

    /** Kiểm tra có match nào trong tray không (không trigger xử lý) */
    public hasPendingMatch(): boolean {
        const trayTiles = TrayManager.getInstance().getTrayTiles();
        const matchCount = TrayManager.getInstance().getMatchCount();
        return this.findSameGroupMatch(trayTiles, matchCount) !== null;
    }

    /** Clear ngay bằng jump-out effect như ORDER_MATCH (không delay) */
    private processMatch(tiles: ITileData[]): void {
        if (!tiles || tiles.length === 0) return;
        this._isProcessing = true;
        const lifecycleId = TileManager.getInstance().getLifecycleId();

        AudioManager.getInstance()?.playSfx('order_complete');
        TrayManager.getInstance().clearTilesWithJumpEffect(tiles.map(tile => tile.id));

        LevelManager.getInstance().addScore(100 * tiles.length);
        EventBus.getInstance().emit(GameEvent.TILES_MATCHED, tiles);
        LevelManager.getInstance().checkLevelComplete();

        this._isProcessing = false;
        if (lifecycleId !== TileManager.getInstance().getLifecycleId()) return;

        const result = this.checkMatch();
        if (result !== MatchResult.MATCHED) {
            TileManager.getInstance().setInputLocked(false);
            if (LevelManager.getInstance().isLevelActive() && !this.hasValidMoves() && !this.hasPendingMatch()) {
                this._isRestarting = true;
                LevelManager.getInstance().onLevelFailed('no_valid_moves');
            }
        }
    }

    /** Kiểm tra có đang xử lý match không */
    public isProcessing(): boolean {
        return this._isProcessing;
    }

    /** Kiểm tra còn nước đi hợp lệ không */
    public hasValidMoves(): boolean {
        const allTiles = TileManager.getInstance().getAllTileData();
        const selectable = allTiles.filter(t => t.active && t.selectable);
        return selectable.length > 0;
    }

    protected onDestroy(): void {
        if (MatchManager.Instance === this) {
            MatchManager.Instance = null;
            EventBus.getInstance().off(GameEvent.TILE_ADDED_TO_TRAY, this.onTrayChanged, this);
            EventBus.getInstance().off(GameEvent.TRAY_SETTLED, this.onTrayChanged, this);
            EventBus.getInstance().off(GameEvent.LEVEL_STARTED, this.onLevelStarted, this);
            this.unscheduleAllCallbacks();
        }
    }
}
