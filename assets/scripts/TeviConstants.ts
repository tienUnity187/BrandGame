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

/** Các key localStorage dùng chung trong toàn bộ game. */
export const STORAGE_KEYS = {
    USER_TOKEN: 'tevi_user_app_token',
    USER_ID: 'tevi_user_id',
    GAME_PROGRESS: 'tevi_game_progress',
} as const;
