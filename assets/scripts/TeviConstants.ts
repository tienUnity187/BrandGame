/** App ID Sandbox do Tevi cấp cho Mini App. */
export const APP_ID = 'DQX81404';

/** Môi trường chạy hiện tại của Mini App. */
export const ENV = 'SANDBOX';

/** Phiên bản cấu hình gửi sang Tevi container. */
export const VERSION = '1.0.15';

/**
 * Bật bridge Tevi giả khi chạy Editor Preview hoặc Development Build.
 * Phải đặt về false khi không còn cần kiểm thử.
 */
export const ENABLE_TEVI_DEVELOPER_MOCK = false;

/** Endpoint Worker cấp URL video thưởng có chữ ký và thời hạn ngắn. */
export const REWARD_VIDEO_TOKEN_URL =
    'https://fancy-sun-962d.tienunity1987.workers.dev/api/video-token';

/**
 * 13 clip / 50 level — hook sớm, giãn dần để thúc Hint/Undo/Skip:
 *   1, 5, 8, 12     (Act 1: dễ, tạo thói quen xem)
 *   16, 20, 24, 28  (Act 2: vừa, 20★ tặng hết → nạp lần đầu)
 *   32, 36, 41, 46, 50 (Act 3: khó, clip = phần thưởng sau cụm grind)
 * Upload R2 (private): vn_reward_01.mp4 … vn_reward_13.mp4
 * Worker nhận body `{ "file": "<tên file>" }` và ký URL cho object đó.
 */
export const REWARD_VIDEO_UNLOCK_LEVELS: readonly number[] = [
    1, 5, 8, 12, 16, 20, 24, 28, 32, 36, 41, 46, 50,
];

export function isRewardVideoLevel(levelId: number): boolean {
    return REWARD_VIDEO_UNLOCK_LEVELS.indexOf(Math.floor(levelId)) >= 0;
}

/** Tên object R2 theo thứ tự clip 1–13. Level không phải mốc → null. */
export function getRewardVideoFileName(levelId: number): string | null {
    const index = REWARD_VIDEO_UNLOCK_LEVELS.indexOf(Math.floor(levelId));
    if (index < 0) return null;
    const episode = index + 1;
    const padded = episode < 10 ? `0${episode}` : `${episode}`;
    return `vn_reward_${padded}.mp4`;
}

/** Log bảng map level → file R2 (dùng kiểm tra Editor). */
export function logRewardVideoFilePlan(tag: string = '[RewardVideo]'): void {
    const rows = REWARD_VIDEO_UNLOCK_LEVELS.map((level, index) => ({
        clip: index + 1,
        level,
        file: getRewardVideoFileName(level),
    }));
    console.log(`${tag} === PLAN: 13 clip tại level ${REWARD_VIDEO_UNLOCK_LEVELS.join(', ')} ===`);
    console.table(rows);
    console.log(`${tag} Worker body mẫu:`, JSON.stringify({ file: getRewardVideoFileName(REWARD_VIDEO_UNLOCK_LEVELS[0]) }));
}

/**
 * Base URL Tevi Sandbox theo docs Environments:
 * Portal: https://developers.sbx.tevi.dev/
 * API:    https://developer-api.sbx.tevi.dev
 */
export const TEVI_API_BASE = 'https://developer-api.sbx.tevi.dev';

/**
 * Docs: top-up-signature gọi từ backend.
 * Game → Cloudflare Worker → Tevi Sandbox API (không lộ API Key trên client).
 */
/** Cloudflare Worker base (video + top-up + webhook). */
export const WORKER_BASE_URL =
    'https://fancy-sun-962d.tienunity1987.workers.dev';

export const TEVI_TOP_UP_SIGNATURE_PROXY_URL =
    `${WORKER_BASE_URL}/api/top-up-signature`;

/** Game poll Worker sau TeviJS.topup — đợi webhook user_topup xác nhận. */
export const TEVI_TOP_UP_STATUS_URL =
    `${WORKER_BASE_URL}/api/top-up-status`;

/** Game gửi kết quả TeviJS.topup callback lên Worker (debug bước 5/6). */
export const TEVI_TOP_UP_SDK_REPORT_URL =
    `${WORKER_BASE_URL}/api/top-up-sdk-report`;

/** Danh sách order paid chưa claim (mở lại game sau khi tắt giữa chừng). */
export const TEVI_TOP_UP_UNCLAIMED_URL =
    `${WORKER_BASE_URL}/api/top-up-unclaimed`;

/** Đánh dấu order đã cộng ★ vào game (tránh claim lại). */
export const TEVI_TOP_UP_CLAIM_URL =
    `${WORKER_BASE_URL}/api/top-up-claim`;

/** Endpoint Tevi trực tiếp (Worker dùng; game không gọi thẳng). */
export const TEVI_TOP_UP_SIGNATURE_URL =
    `${TEVI_API_BASE}/api/v1/payments/top-up-signature`;

/** Số dư Star Tevi của user (Bearer user_app_token). */
export const TEVI_USER_BALANCE_URL =
    `${TEVI_API_BASE}/api/v1/auth/user/balance`;

/**
 * Giá booster (1 Tevi Star = 1 Star game).
 */
export const UNDO_STAR_COST = 3;
export const HINT_STAR_COST = 8;
export const SKIP_STAR_COST = 40;

/** Sao tặng lần đầu mở game (chưa có key ví). */
export const STARTING_STAR_BALANCE = 20;

/** Gói nạp: 1 Tevi Star = 1 Star trong game. */
export interface StarTopUpPack {
    id: string;
    label: string;
    /** Số Star Tevi trả (TeviJS.topup / top-up-signature). */
    amount: number;
    /** Star cộng vào ví game (1:1 với amount). */
    stars: number;
}

/** Gói nạp Star → Star (1:1). */
export const STAR_TOPUP_PACKS: readonly StarTopUpPack[] = [
    { id: 'pack_100', label: '100 → 100', amount: 100, stars: 100 },
    { id: 'pack_500', label: '500 → 500', amount: 500, stars: 500 },
    { id: 'pack_1000', label: '1000 → 1000', amount: 1000, stars: 1000 },
] as const;

/** Các key localStorage dùng chung trong toàn bộ game. */
export const STORAGE_KEYS = {
    USER_TOKEN: 'tevi_user_app_token',
    USER_ID: 'tevi_user_id',
    /** App ID lần login cuối — đổi APP_ID trong code thì xóa token cũ. */
    LAST_APP_ID: 'tevi_last_app_id',
    GAME_PROGRESS: 'tevi_game_progress',
    STAR_BALANCE: 'velvet_star_balance',
    /** Danh sách clip thưởng đã xem (JSON array). */
    WATCHED_REWARD_VIDEOS: 'velvet_watched_reward_videos',
    /** Orders top-up chưa cộng ★ (JSON array). */
    PENDING_TOPUP_ORDERS: 'velvet_pending_topup_orders',
    /** order_id đã cộng ★ local (JSON string[]). */
    CREDITED_TOPUP_ORDERS: 'velvet_credited_topup_orders',
    /** Backup order gần nhất (JSON) — Tevi WebView đôi khi xóa pending array. */
    LAST_TOPUP_ORDER: 'velvet_last_topup_order',
} as const;
