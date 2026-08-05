import { sys } from 'cc';
import { GAME_NAME } from './GameBrandConfig';

/**
 * SaveManager - Lưu/đọc tiến trình game trên thiết bị.
 */
export class SaveManager {
    private static _instance: SaveManager;
    private static readonly ENABLE_LEVEL_PROGRESS_SAVE = true;
    private static readonly SAVE_PREFIX = `MiniGame1_${GAME_NAME}`;
    private static readonly KEY = `${SaveManager.SAVE_PREFIX}_currentLevel`;
    private static readonly SKIP_COUNT_KEY = `${SaveManager.SAVE_PREFIX}_skipCount`;
    private static readonly DEFAULT_SKIP_COUNT = 1;
    private static readonly MAX_SKIP_COUNT = 1;
    private static readonly MAX_LEVEL_ID = 50;

    private constructor() {}

    public static getInstance(): SaveManager {
        if (!SaveManager._instance) {
            SaveManager._instance = new SaveManager();
        }
        return SaveManager._instance;
    }

    public saveCurrentLevel(levelId: number): void {
        if (!SaveManager.ENABLE_LEVEL_PROGRESS_SAVE) return;
        try {
            const safeId = SaveManager.clampLevelId(levelId);
            sys.localStorage.setItem(SaveManager.KEY, `${safeId}`);
            console.log(`[SaveManager] Lưu level đang chơi: ${safeId}`);
        } catch (err) {
        }
    }

    public getCurrentLevel(): number {
        if (!SaveManager.ENABLE_LEVEL_PROGRESS_SAVE) return 0;
        try {
            const value = sys.localStorage.getItem(SaveManager.KEY);
            if (value === null || value === '') return 0;
            const num = parseInt(value, 10);
            return isNaN(num) ? 0 : SaveManager.clampLevelId(num);
        } catch (err) {
            return 0;
        }
    }

    private static clampLevelId(levelId: number): number {
        return Math.min(SaveManager.MAX_LEVEL_ID, Math.max(1, Math.floor(levelId)));
    }

    public clear(): void {
        try {
            sys.localStorage.removeItem(SaveManager.KEY);
            sys.localStorage.removeItem(SaveManager.SKIP_COUNT_KEY);
        } catch (err) {
        }
    }

    public resetProgressToLevelOne(): void {
        if (SaveManager.ENABLE_LEVEL_PROGRESS_SAVE) {
            this.saveCurrentLevel(1);
        } else {
            this.clearSavedLevelProgress();
        }
        this.saveSkipCount(SaveManager.DEFAULT_SKIP_COUNT);
    }

    private clearSavedLevelProgress(): void {
        try {
            sys.localStorage.removeItem(SaveManager.KEY);
        } catch (err) {
        }
    }

    public getSkipCount(): number {
        try {
            const value = sys.localStorage.getItem(SaveManager.SKIP_COUNT_KEY);
            if (value === null || value === '') {
                this.saveSkipCount(SaveManager.DEFAULT_SKIP_COUNT);
                return SaveManager.DEFAULT_SKIP_COUNT;
            }

            const num = parseInt(value, 10);
            const safeCount = isNaN(num) ? 0 : SaveManager.clampSkipCount(num);
            if (`${safeCount}` !== value) {
                this.saveSkipCount(safeCount);
            }
            return safeCount;
        } catch (err) {
            return SaveManager.DEFAULT_SKIP_COUNT;
        }
    }

    public saveSkipCount(count: number): void {
        try {
            const safeCount = SaveManager.clampSkipCount(count);
            sys.localStorage.setItem(SaveManager.SKIP_COUNT_KEY, `${safeCount}`);
        } catch (err) {
        }
    }

    private static clampSkipCount(count: number): number {
        return Math.min(SaveManager.MAX_SKIP_COUNT, Math.max(0, Math.floor(count)));
    }

    public static reset(): void {
        SaveManager._instance = null;
    }
}
