import { sys } from 'cc';
import { STORAGE_KEYS, TEVI_PROGRESS_URL } from '../TeviConstants';

function readToken(): string {
    try {
        return sys.localStorage.getItem(STORAGE_KEYS.USER_TOKEN)?.trim() || '';
    } catch {
        return '';
    }
}

/** Gửi level đã mở khóa lên Worker. Không chặn gameplay nếu mạng lỗi. */
export function pushLevelProgress(levelId: number): void {
    const token = readToken();
    const level = Math.floor(levelId);
    if (!token || level <= 0) return;
    void fetch(TEVI_PROGRESS_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify({ levelId: level }),
    }).catch(() => {});
}

/** Level cao nhất Worker đang giữ cho user này. 0 nếu chưa có hoặc lỗi mạng. */
export async function pullLevelProgress(): Promise<number> {
    const token = readToken();
    if (!token) return 0;
    try {
        const response = await fetch(TEVI_PROGRESS_URL, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
            },
        });
        if (!response.ok) return 0;
        const payload = await response.json() as { levelId?: number };
        const level = Math.floor(Number(payload.levelId) || 0);
        return level > 0 ? level : 0;
    } catch {
        return 0;
    }
}
