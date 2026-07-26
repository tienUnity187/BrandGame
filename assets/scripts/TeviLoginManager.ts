import { _decorator, Component, Label, sys } from 'cc';
import { DEV, PREVIEW } from 'cc/env';
import {
    APP_ID,
    ENABLE_TEVI_DEVELOPER_MOCK,
    ENV,
    STORAGE_KEYS,
    VERSION,
} from './TeviConstants';

const { ccclass, property } = _decorator;

/**
 * Khởi tạo Tevi container và đăng nhập người chơi qua JS Bridge.
 * Component có thể được gắn vào một Node và nối Label trực tiếp trong Inspector.
 */
@ccclass('TeviLoginManager')
export class TeviLoginManager extends Component {
    public static Instance: TeviLoginManager | null = null;
    private _usingDeveloperMock = false;

    @property({
        type: Label,
        tooltip: 'Hiển thị trạng thái kết nối/đăng nhập Tevi.',
    })
    public statusLabel: Label | null = null;

    @property({
        type: Label,
        tooltip: 'Hiển thị tên và ID của người dùng sau khi đăng nhập.',
    })
    public userInfoLabel: Label | null = null;

    @property({
        tooltip: 'Cho phép Tevi hiển thị popup xin quyền khi lấy thông tin người dùng.',
    })
    public showLoginPopup = true;

    protected onLoad(): void {
        if (TeviLoginManager.Instance && TeviLoginManager.Instance !== this) {
            this.destroy();
            return;
        }
        TeviLoginManager.Instance = this;
    }

    protected start(): void {
        this.initializeTevi();
    }

    protected onDestroy(): void {
        if (TeviLoginManager.Instance === this) {
            TeviLoginManager.Instance = null;
        }
    }

    /** Nạp cấu hình container trước, sau đó yêu cầu thông tin người dùng. */
    public initializeTevi(): void {
        this.installDeveloperMockBridge();
        this.setStatus('Đang kết nối...');
        this.setUserInfo('');

        if (typeof window === 'undefined' || !window.TeviJS) {
            this.setStatus('Không tìm thấy TeviJS. Hãy chạy game trong ứng dụng Tevi.');
            return;
        }

        const teviJS = window.TeviJS;
        try {
            teviJS.loadConfig({
                optionMenu: true,
                config: {
                    app_id: APP_ID,
                    env: ENV,
                },
                version: VERSION,
            });
        } catch (error) {
            this.handleFailure('LOAD_CONFIG_ERROR', error);
            return;
        }

        this.requestUserInfo();
    }

    /** Có thể nối hàm này với Button để người dùng thử đăng nhập lại. */
    public requestUserInfo(): void {
        this.setStatus('Đang lấy thông tin người dùng...');

        // Luôn kiểm tra bridge để game không crash trong Editor hoặc trình duyệt thường.
        if (typeof window === 'undefined' || !window.TeviJS) {
            this.setStatus('Không tìm thấy TeviJS. Hãy chạy game trong ứng dụng Tevi.');
            return;
        }

        const teviJS = window.TeviJS;
        try {
            teviJS.getUserInfo(
                {
                    is_popup: this.showLoginPopup,
                    app_id: APP_ID,
                },
                response => this.handleUserInfoResponse(response),
            );
        } catch (error) {
            this.handleFailure('GET_USER_INFO_ERROR', error);
        }
    }

    /** Token hiện tại để module Topup sử dụng sau này. */
    public getUserToken(): string {
        try {
            return sys.localStorage.getItem(STORAGE_KEYS.USER_TOKEN) || '';
        } catch (error) {
            console.warn('[TeviLogin] Không thể đọc user token:', error);
            return '';
        }
    }

    /** User ID hiện tại để các module tích hợp Tevi sử dụng sau này. */
    public getUserId(): string {
        try {
            return sys.localStorage.getItem(STORAGE_KEYS.USER_ID) || '';
        } catch (error) {
            console.warn('[TeviLogin] Không thể đọc user ID:', error);
            return '';
        }
    }

    private handleUserInfoResponse(response: TeviGetUserInfoResponse): void {
        if (!response) {
            this.handleFailure('EMPTY_RESPONSE');
            return;
        }

        if (response.error_code && `${response.error_code}` !== '0') {
            this.handleFailure(`${response.error_code}`, response.message);
            return;
        }

        // SDK hiện tại trả trong userInfo; fallback ngoài cùng giúp tương thích bridge cũ.
        const userInfo = response.userInfo || response;
        const token = typeof userInfo.user_app_token === 'string'
            ? userInfo.user_app_token.trim()
            : '';
        const rawUserId = userInfo.id;
        const userId = rawUserId === undefined || rawUserId === null
            ? ''
            : `${rawUserId}`.trim();
        const userName = typeof userInfo.name === 'string'
            ? userInfo.name.trim()
            : '';

        if (!token || !userId) {
            this.handleFailure('INVALID_USER_INFO', response.message);
            return;
        }

        try {
            sys.localStorage.setItem(STORAGE_KEYS.USER_TOKEN, token);
            sys.localStorage.setItem(STORAGE_KEYS.USER_ID, userId);
        } catch (error) {
            this.handleFailure('LOCAL_STORAGE_ERROR', error);
            return;
        }

        this.setStatus(this._usingDeveloperMock
            ? 'Đăng nhập Tevi thành công (Developer Mock)'
            : 'Đăng nhập Tevi thành công');
        this.setUserInfo(userName ? `${userName} (ID: ${userId})` : `User ID: ${userId}`);
        console.log('[TeviLogin] Đăng nhập thành công:', { userId, userName });
    }

    /**
     * Tạo bridge giả phục vụ Editor Preview/Development Build.
     * Production Build không bao giờ cài mock, kể cả khi biến developer đang bật.
     */
    private installDeveloperMockBridge(): void {
        if (!ENABLE_TEVI_DEVELOPER_MOCK || (!DEV && !PREVIEW)) return;
        if (typeof window === 'undefined' || window.TeviJS) return;

        this._usingDeveloperMock = true;
        window.TeviJS = {
            loadConfig: options => {
                console.log('[TeviMock] loadConfig:', options);
            },
            getUserInfo: (options, callback) => {
                console.log('[TeviMock] getUserInfo:', options);
                window.setTimeout(() => {
                    callback({
                        userInfo: {
                            user_app_token: 'mock-user-app-token',
                            id: 'mock-user-001',
                            name: 'Tevi Developer',
                        },
                    });
                }, 300);
            },
            topup: (options, callback) => {
                console.log('[TeviMock] topup:', options);
                callback({ call: 'ok', message: 'Developer mock topup thành công' });
            },
            executeLink: (options, callback) => {
                console.log('[TeviMock] executeLink:', options);
                callback({ call: 'ok', message: 'Developer mock executeLink thành công' });
            },
        };

        console.warn('[TeviMock] Đang sử dụng TeviJS giả cho môi trường phát triển.');
    }

    private handleFailure(code: string, detail?: unknown): void {
        const message = this.getErrorMessage(detail);
        this.setStatus(`Đăng nhập Tevi thất bại (${code})${message ? `: ${message}` : ''}`);
        this.setUserInfo('');
        console.error(`[TeviLogin] ${code}:`, detail);
    }

    private getErrorMessage(detail: unknown): string {
        if (typeof detail === 'string') return detail;
        if (detail instanceof Error) return detail.message;
        return '';
    }

    private setStatus(message: string): void {
        if (this.statusLabel) {
            this.statusLabel.string = message;
        }
    }

    private setUserInfo(message: string): void {
        if (this.userInfoLabel) {
            this.userInfoLabel.string = message;
        }
    }
}
