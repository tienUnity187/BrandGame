/**
 * Khai báo kiểu cho Tevi JS Bridge được ứng dụng native inject vào WebView.
 * File này chỉ cung cấp type cho TypeScript, không import SDK hay tạo mã runtime.
 */

interface TeviLoadConfigOptions {
    optionMenu: boolean | Record<string, unknown>;
    config: Record<string, unknown>;
    version: string;
}

interface TeviGetUserInfoOptions {
    is_popup: boolean;
    app_id: string;
}

interface TeviUserInfo {
    user_app_token: string;
    id: string | number;
    name?: string;
    [key: string]: unknown;
}

interface TeviGetUserInfoResponse {
    error_code?: string | number;
    message?: string;
    userInfo?: TeviUserInfo;

    // Một số phiên bản bridge có thể trả thông tin user ở cấp ngoài cùng.
    user_app_token?: string;
    id?: string | number;
    name?: string;
    [key: string]: unknown;
}

interface TeviTopupOptions {
    deposit_token: string;
    amount?: number;
    channel_id?: string | number;
    [key: string]: unknown;
}

interface TeviExecuteLinkOptions {
    link: string;
}

interface TeviBridgeResponse {
    error_code?: string | number;
    message?: string;
    call?: string;
    [key: string]: unknown;
}

interface TeviJSBridge {
    loadConfig(options: TeviLoadConfigOptions): void;
    getUserInfo(
        options: TeviGetUserInfoOptions,
        callback: (response: TeviGetUserInfoResponse) => void,
    ): void;
    topup(
        options: TeviTopupOptions,
        callback: (response: TeviBridgeResponse) => void,
    ): void;
    executeLink(
        options: TeviExecuteLinkOptions,
        callback: (response: TeviBridgeResponse) => void,
    ): void;
}

interface Window {
    TeviJS?: TeviJSBridge;
}
