import { GAME_NAME } from '../core/GameBrandConfig';

interface ExitTrackingOptions {
    getSessionId: () => string;
}

interface ExitTrackingPayload {
    secret_key: string;
    action: 'track_exit';
    session_id: string;
    level_game: number;
    game_name: string;
}

const EXIT_TRACKING_ENDPOINT = 'https://script.google.com/macros/s/AKfycbx7gaC7d-UrZIVF8zZ8Vxe-ToFhiGQX5vd5Z_7fgpL9ESaW3LhrcED986lYWJN-rSr3Ug/exec';
const SECRET_KEY = 'GTB@2026';
const BEACON_CONTENT_TYPE = 'text/plain;charset=UTF-8';
const EXIT_TRACKING_LOG_PREFIX = '[ExitTracking]';

export class ExitTrackingService {
    private static _instance: ExitTrackingService | null = null;
    private _getSessionId: (() => string) | null = null;
    private _currentLevel: number = 0;
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

    public setLevel(level: number): void {
        if (!Number.isFinite(level)) return;
        this._currentLevel = Math.max(0, Math.floor(level));
        this._hasSentExit = false;
        console.log(`${EXIT_TRACKING_LOG_PREFIX} level_game set:`, this._currentLevel);
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

        const payload: ExitTrackingPayload = {
            secret_key: SECRET_KEY,
            action: 'track_exit',
            session_id: this._getSessionId(),
            level_game: this._currentLevel,
            game_name: GAME_NAME,
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
