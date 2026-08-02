import { GAME_NAME } from '../core/GameBrandConfig';
import { SaveManager } from '../core/SaveManager';

interface ExitTrackingOptions {
    getSessionId: () => string;
}

interface ExitTrackingPayload {
    secret_key: string;
    action: 'track_exit';
    session_id: string;
    level_game: number;
    game_name: string;
    full_name: string;
    phone: string;
}

const EXIT_TRACKING_ENDPOINT = 'https://script.google.com/macros/s/AKfycbx7gaC7d-UrZIVF8zZ8Vxe-ToFhiGQX5vd5Z_7fgpL9ESaW3LhrcED986lYWJN-rSr3Ug/exec';
const SECRET_KEY = 'GTB@2026';
const BEACON_CONTENT_TYPE = 'text/plain;charset=UTF-8';
const EXIT_TRACKING_LOG_PREFIX = '[ExitTracking]';

export class ExitTrackingService {
    private static _instance: ExitTrackingService | null = null;
    private _getSessionId: (() => string) | null = null;
    private _currentLevel: number = 0;
    private _isInGameplay = false;
    private _hasSentExit = false;
    private _isInitialized = false;

    public static getInstance(): ExitTrackingService {
        if (!ExitTrackingService._instance) {
            ExitTrackingService._instance = new ExitTrackingService();
        }
        return ExitTrackingService._instance;
    }

    public initialize(options: ExitTrackingOptions): void {
        if (!this.isSupported()) return;

        this._getSessionId = options.getSessionId;
        if (this._isInitialized) return;

        document.addEventListener('visibilitychange', this.onVisibilityChange);
        window.addEventListener('pagehide', this.onPageHide);
        this._isInitialized = true;
    }

    /** Gọi khi user đã mở / bắt đầu 1 level (vào trong game). */
    public setLevel(level: number): void {
        if (!Number.isFinite(level)) return;
        const nextLevel = Math.max(0, Math.floor(level));
        if (nextLevel <= 0) {
            this.clearGameplay();
            return;
        }
        this._currentLevel = nextLevel;
        this._isInGameplay = true;
        this._hasSentExit = false;
        console.log(`${EXIT_TRACKING_LOG_PREFIX} level_game set:`, this._currentLevel);
    }

    /** Gọi khi quay về Home / thoát khỏi phiên chơi level. */
    public clearGameplay(): void {
        this._isInGameplay = false;
        this._currentLevel = 0;
        this._hasSentExit = false;
        console.log(`${EXIT_TRACKING_LOG_PREFIX} gameplay cleared (Home)`);
    }

    private isSupported(): boolean {
        return typeof window !== 'undefined' &&
            typeof document !== 'undefined' &&
            typeof navigator !== 'undefined' &&
            typeof navigator.sendBeacon === 'function';
    }

    private onVisibilityChange = (): void => {
        if (document.visibilityState === 'hidden') {
            this.sendExitBeacon('visibilitychange');
            return;
        }

        if (document.visibilityState === 'visible') {
            this._hasSentExit = false;
        }
    };

    private onPageHide = (): void => {
        this.sendExitBeacon('pagehide');
    };

    private sendExitBeacon(reason: string): void {
        if (this._hasSentExit) return;
        if (!this._getSessionId) return;
        // Chỉ track khi user đang trong game và đã mở 1 level — bỏ qua lúc còn ở Home.
        if (!this._isInGameplay || this._currentLevel <= 0) {
            console.log(`${EXIT_TRACKING_LOG_PREFIX} skip (${reason}): not in gameplay`);
            return;
        }

        const leadInfo = SaveManager.getInstance().getLeadInfo();
        const payload: ExitTrackingPayload = {
            secret_key: SECRET_KEY,
            action: 'track_exit',
            session_id: this._getSessionId(),
            level_game: this._currentLevel,
            game_name: GAME_NAME,
            full_name: leadInfo?.full_name || '',
            phone: leadInfo?.phone || '',
        };
        const blob = new Blob([JSON.stringify(payload)], { type: BEACON_CONTENT_TYPE });
        const queued = navigator.sendBeacon(EXIT_TRACKING_ENDPOINT, blob);

        this._hasSentExit = queued;
        console.log(`${EXIT_TRACKING_LOG_PREFIX} sendBeacon ${queued ? 'queued' : 'failed'} (${reason}):`, {
            ...payload,
            secret_key: '***',
        });
    }
}
