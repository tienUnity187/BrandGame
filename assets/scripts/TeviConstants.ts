/** App ID Sandbox do Tevi cấp cho Mini App. */
export const APP_ID = 'SRB06792';

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
 * 6 clip / 50 level — tạm thời 1 clip / 5 màn lúc đầu, sau giãn ra:
 *   5 / 10 / 15   (mỗi 5 level)
 *   25 / 38 / 50  (giãn dần, clip cuối = thắng campaign)
 * Upload R2 (private) đúng 6 file episode, không đặt tên theo level:
 *   vn_reward_01.mp4 … vn_reward_06.mp4
 * Worker nhận body `{ "file": "<tên file>" }` và ký URL cho object đó.
 */
export const REWARD_VIDEO_UNLOCK_LEVELS: readonly number[] = [5, 10, 15, 25, 38, 50];

export function isRewardVideoLevel(levelId: number): boolean {
    return REWARD_VIDEO_UNLOCK_LEVELS.indexOf(Math.floor(levelId)) >= 0;
}

/** Tên object R2 theo thứ tự clip 1–6. Level không phải mốc → null. */
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
    console.log(`${tag} === PLAN: 6 clip tại level ${REWARD_VIDEO_UNLOCK_LEVELS.join(', ')} ===`);
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

/**
 * Giá booster (1 Tevi ★ = 1 sao game).
 * $3 = 300★ ≈ 40 Undo, hoặc 15 Hint + vài Undo, hoặc ~7 Skip.
 */
export const UNDO_STAR_COST = 3;
export const HINT_STAR_COST = 8;
export const SKIP_STAR_COST = 40;

/** Sao tặng lần đầu mở game (chưa có key ví). */
export const STARTING_STAR_BALANCE = 20;

/** Gói nạp sandbox: amount gửi Tevi + Star cộng vào ví local. */
export interface StarTopUpPack {
    id: string;
    label: string;
    /** Số tiền gửi lên top-up-signature / TeviJS.topup (USD sandbox). */
    amount: number;
    stars: number;
}

/** Gói nhỏ nhất $3 — neo spend. Gói lớn hơn có bonus ★. */
export const STAR_TOPUP_PACKS: readonly StarTopUpPack[] = [
    { id: 'pack_3', label: '$3 → 300★', amount: 3, stars: 300 },
    { id: 'pack_5', label: '$5 → 550★', amount: 5, stars: 550 },
    { id: 'pack_10', label: '$10 → 1200★', amount: 10, stars: 1200 },
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
