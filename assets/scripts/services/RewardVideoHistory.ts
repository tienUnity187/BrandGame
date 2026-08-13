import { sys } from 'cc';
import { getRewardVideoFileName, STORAGE_KEYS } from '../TeviConstants';

/** Một clip thưởng đã xem, lưu local để xem lại. */
export interface WatchedRewardVideo {
    levelId: number;
    file: string;
    watchedAt: number;
}

/**
 * Lưu / đọc danh sách clip thưởng đã xem qua sys.localStorage.
 * Chỉ lưu levelId + tên file (không lưu signed URL tạm).
 */
export class RewardVideoHistory {
    private static _instance: RewardVideoHistory | null = null;

    public static getInstance(): RewardVideoHistory {
        if (!RewardVideoHistory._instance) {
            RewardVideoHistory._instance = new RewardVideoHistory();
        }
        return RewardVideoHistory._instance;
    }

    /** Đánh dấu clip của mốc level đã xem (upsert theo levelId). */
    public markWatched(levelId: number): WatchedRewardVideo | null {
        const id = Math.floor(levelId);
        if (!Number.isFinite(id) || id <= 0) return null;

        const file = getRewardVideoFileName(id);
        const entry: WatchedRewardVideo = {
            levelId: id,
            file,
            watchedAt: Date.now(),
        };

        const list = this.getWatched();
        const index = list.findIndex((item) => item.levelId === id);
        if (index >= 0) {
            list[index] = entry;
        } else {
            list.push(entry);
        }
        list.sort((a, b) => a.levelId - b.levelId);
        this.save(list);
        console.log(`[RewardVideoHistory] Đã lưu clip level ${id} (${file})`);
        return entry;
    }

    public hasWatched(levelId: number): boolean {
        const id = Math.floor(levelId);
        return this.getWatched().some((item) => item.levelId === id);
    }

    /** Danh sách đã xem, sắp theo level tăng dần. */
    public getWatched(): WatchedRewardVideo[] {
        try {
            const raw = sys.localStorage.getItem(STORAGE_KEYS.WATCHED_REWARD_VIDEOS);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];

            const result: WatchedRewardVideo[] = [];
            for (const item of parsed) {
                const levelId = Math.floor(Number(item?.levelId));
                if (!Number.isFinite(levelId) || levelId <= 0) continue;
                const file = typeof item?.file === 'string' && item.file.trim()
                    ? item.file.trim()
                    : getRewardVideoFileName(levelId);
                const watchedAt = Number(item?.watchedAt);
                result.push({
                    levelId,
                    file,
                    watchedAt: Number.isFinite(watchedAt) && watchedAt > 0 ? watchedAt : 0,
                });
            }
            result.sort((a, b) => a.levelId - b.levelId);
            return result;
        } catch (error) {
            console.warn('[RewardVideoHistory] Không đọc được lịch sử clip:', error);
            return [];
        }
    }

    public getCount(): number {
        return this.getWatched().length;
    }

    private save(list: WatchedRewardVideo[]): void {
        try {
            sys.localStorage.setItem(STORAGE_KEYS.WATCHED_REWARD_VIDEOS, JSON.stringify(list));
        } catch (error) {
            console.warn('[RewardVideoHistory] Không lưu được lịch sử clip:', error);
        }
    }
}
