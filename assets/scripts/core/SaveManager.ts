import { sys } from 'cc';
import { GAME_NAME } from './GameBrandConfig';

export interface SavedLeadInfo {
    full_name: string;
    phone: string;
    gender: 'male' | 'female' | 'secret';
    contact_channel: 'zalo' | 'email';
    email: string;
    birth_year: number;
    province: string;
}

/**
 * SaveManager - Luu/doc tien trinh va thong tin nguoi choi tren thiet bi.
 */
export class SaveManager {
    private static _instance: SaveManager;
    private static readonly ENABLE_LEVEL_PROGRESS_SAVE = false;
    private static readonly SAVE_PREFIX = `MiniGame1_${GAME_NAME}`;
    private static readonly SHARED_SAVE_PREFIX = 'MiniGame1_shared';
    private static readonly KEY = `${SaveManager.SAVE_PREFIX}_currentLevel`;
    private static readonly SKIP_COUNT_KEY = `${SaveManager.SAVE_PREFIX}_skipCount`;
    private static readonly LEAD_CAPTURE_SUBMITTED_KEY = `${SaveManager.SAVE_PREFIX}_leadCaptureSubmitted`;
    private static readonly LEAD_INFO_KEY = `${SaveManager.SHARED_SAVE_PREFIX}_leadInfo`;
    private static readonly DEFAULT_SKIP_COUNT = 1;
    private static readonly MAX_SKIP_COUNT = 1;

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
            sys.localStorage.setItem(SaveManager.KEY, `${levelId}`);
        } catch (err) {
        }
    }

    public getCurrentLevel(): number {
        if (!SaveManager.ENABLE_LEVEL_PROGRESS_SAVE) return 0;
        try {
            const value = sys.localStorage.getItem(SaveManager.KEY);
            if (value === null || value === '') return 0;
            const num = parseInt(value, 10);
            return isNaN(num) ? 0 : num;
        } catch (err) {
            return 0;
        }
    }

    public clear(): void {
        try {
            sys.localStorage.removeItem(SaveManager.KEY);
            sys.localStorage.removeItem(SaveManager.SKIP_COUNT_KEY);
            sys.localStorage.removeItem(SaveManager.LEAD_CAPTURE_SUBMITTED_KEY);
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

    public hasSubmittedLeadCapture(): boolean {
        try {
            return sys.localStorage.getItem(SaveManager.LEAD_CAPTURE_SUBMITTED_KEY) === '1';
        } catch (err) {
            return false;
        }
    }

    public saveLeadCaptureSubmitted(): void {
        try {
            sys.localStorage.setItem(SaveManager.LEAD_CAPTURE_SUBMITTED_KEY, '1');
        } catch (err) {
        }
    }

    public hasLeadInfo(): boolean {
        return this.getLeadInfo() !== null;
    }

    public getLeadInfo(): SavedLeadInfo | null {
        try {
            const raw = sys.localStorage.getItem(SaveManager.LEAD_INFO_KEY);
            if (!raw) return null;
            const value = JSON.parse(raw) as Partial<SavedLeadInfo>;
            if (!value.full_name || !value.phone || !value.gender || !value.contact_channel || !value.birth_year || !value.province) {
                return null;
            }
            if (value.contact_channel === 'email' && !value.email) {
                return null;
            }
            return {
                full_name: `${value.full_name}`,
                phone: `${value.phone}`,
                gender: value.gender,
                contact_channel: value.contact_channel,
                email: value.email ? `${value.email}` : '',
                birth_year: Number(value.birth_year),
                province: `${value.province}`,
            };
        } catch (err) {
            return null;
        }
    }

    public saveLeadInfo(info: SavedLeadInfo): void {
        try {
            sys.localStorage.setItem(SaveManager.LEAD_INFO_KEY, JSON.stringify(info));
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
