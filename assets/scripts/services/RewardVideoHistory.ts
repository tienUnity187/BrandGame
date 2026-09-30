import { getUnlockedRewardClips, getRewardVideoFileName, isRewardVideoLevel } from '../TeviConstants';
import { SaveManager } from '../core/SaveManager';

/** Clip thưởng suy ra từ level hiện tại, không lưu local. */
export interface WatchedRewardVideo {
    levelId: number;
    file: string;
    watchedAt: number;
}

/**
 * Danh sách clip = các mốc thưởng đã qua so với level đang chơi.
 */
export class RewardVideoHistory {
    private static _instance: RewardVideoHistory | null = null;

    public static getInstance(): RewardVideoHistory {
        if (!RewardVideoHistory._instance) {
            RewardVideoHistory._instance = new RewardVideoHistory();
        }
        return RewardVideoHistory._instance;
    }

    /** Giữ chữ ký cũ. Clip không ghi local — level đã lưu là đủ. */
    public markWatched(levelId: number): WatchedRewardVideo | null {
        const id = Math.floor(levelId);
        if (!Number.isFinite(id) || id <= 0 || !isRewardVideoLevel(id)) return null;
        const file = getRewardVideoFileName(id);
        if (!file) return null;
        return { levelId: id, file, watchedAt: 0 };
    }

    public hasWatched(levelId: number): boolean {
        const id = Math.floor(levelId);
        return this.getWatched().some((item) => item.levelId === id);
    }

    /** Clip của mọi mốc nhỏ hơn level hiện tại. */
    public getWatched(): WatchedRewardVideo[] {
        const currentLevel = SaveManager.getInstance().getCurrentLevel();
        return getUnlockedRewardClips(currentLevel > 0 ? currentLevel : 1).map((clip) => ({
            levelId: clip.levelId,
            file: clip.file,
            watchedAt: 0,
        }));
    }

    public getCount(): number {
        return this.getWatched().length;
    }
}
