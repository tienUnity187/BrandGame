/** App ID Sandbox do Tevi cấp cho Mini App. */
export const APP_ID = 'HXM37297';

/** Môi trường chạy hiện tại của Mini App. */
export const ENV = 'SANDBOX';

/** Phiên bản cấu hình gửi sang Tevi container. */
export const VERSION = '1.0.6';

/**
 * Bật bridge Tevi giả khi chạy Editor Preview hoặc Development Build.
 * Phải đặt về false khi không còn cần kiểm thử.
 */
export const ENABLE_TEVI_DEVELOPER_MOCK = false;

/** Endpoint Worker cấp URL video thưởng có chữ ký và thời hạn ngắn. */
export const REWARD_VIDEO_TOKEN_URL =
    'https://fancy-sun-962d.tienunity1987.workers.dev/api/video-token';

/**
 * Mỗi khi thắng level bội số của 5 (5, 10, 15…50), xin video tương ứng.
 * Upload lên Cloudflare R2 (private) đúng tên file sau:
 *   vn_reward_lv05.mp4
 *   vn_reward_lv10.mp4
 *   vn_reward_lv15.mp4
 *   ...
 *   vn_reward_lv50.mp4
 * Worker nhận body `{ "file": "<tên file>" }` và ký URL cho object đó.
 */
export const REWARD_VIDEO_LEVEL_INTERVAL = 5;

/** Tên object R2 theo mốc level (ví dụ level 5 → vn_reward_lv05.mp4). */
export function getRewardVideoFileName(levelId: number): string {
    const padded = levelId < 10 ? `0${levelId}` : `${levelId}`;
    return `vn_reward_lv${padded}.mp4`;
}

/** Log bảng map level → file R2 (dùng kiểm tra Editor). */
export function logRewardVideoFilePlan(tag: string = '[RewardVideo]'): void {
    const rows: Array<{ level: number; file: string }> = [];
    for (let level = REWARD_VIDEO_LEVEL_INTERVAL; level <= 50; level += REWARD_VIDEO_LEVEL_INTERVAL) {
        rows.push({ level, file: getRewardVideoFileName(level) });
    }
    console.log(`${tag} === PLAN: mỗi ${REWARD_VIDEO_LEVEL_INTERVAL} level → 1 video R2 ===`);
    console.table(rows);
    console.log(`${tag} Worker body mẫu:`, JSON.stringify({ file: getRewardVideoFileName(5) }));
}

/** Endpoint Tevi tạo chữ ký nạp (sandbox). */
export const TEVI_TOP_UP_SIGNATURE_URL =
    'https://developer-api.sbx.tevi.dev/api/v1/payments/top-up-signature';

/** Mỗi lần dùng Hint / Undo / Skip tốn bao nhiêu Star. */
export const BOOSTER_STAR_COST = 1;

/** Gói nạp sandbox: amount gửi Tevi + Star cộng vào ví local. */
export interface StarTopUpPack {
    id: string;
    label: string;
    /** Số tiền gửi lên top-up-signature / TeviJS.topup (USD sandbox). */
    amount: number;
    stars: number;
}

export const STAR_TOPUP_PACKS: readonly StarTopUpPack[] = [
    { id: 'pack_1', label: '$1 → 100★', amount: 1, stars: 100 },
    { id: 'pack_5', label: '$5 → 600★', amount: 5, stars: 600 },
    { id: 'pack_10', label: '$10 → 1500★', amount: 10, stars: 1500 },
] as const;

/** Các key localStorage dùng chung trong toàn bộ game. */
export const STORAGE_KEYS = {
    USER_TOKEN: 'tevi_user_app_token',
    USER_ID: 'tevi_user_id',
    GAME_PROGRESS: 'tevi_game_progress',
    STAR_BALANCE: 'velvet_star_balance',
} as const;
