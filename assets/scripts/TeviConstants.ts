/** App ID Sandbox do Tevi cấp cho Mini App. */
export const APP_ID = 'STK45135';

/** Môi trường chạy hiện tại của Mini App. */
export const ENV = 'SANDBOX';

/** Phiên bản cấu hình gửi sang Tevi container. */
export const VERSION = '1.0.0';

/**
 * Bật bridge Tevi giả khi chạy Editor Preview hoặc Development Build.
 * Phải đặt về false khi không còn cần kiểm thử.
 */
export const ENABLE_TEVI_DEVELOPER_MOCK = false;

/** Các key localStorage dùng chung trong toàn bộ game. */
export const STORAGE_KEYS = {
    USER_TOKEN: 'tevi_user_app_token',
    USER_ID: 'tevi_user_id',
    GAME_PROGRESS: 'tevi_game_progress',
} as const;
