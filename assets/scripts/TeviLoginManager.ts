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

/** Số lần thử lại khi bridge native chưa sẵn sàng. */
const GET_USER_INFO_MAX_RETRY = 5;
/** Khoảng cách giữa các lần retry (ms). */
const GET_USER_INFO_RETRY_DELAY_MS = 500;

/**
 * Khởi tạo Tevi container và đăng nhập người chơi qua JS Bridge.
 * Component có thể được gắn vào một Node và nối Label trực tiếp trong Inspector.
 */
@ccclass('TeviLoginManager')
export class TeviLoginManager extends Component {
    public static Instance: TeviLoginManager | null = null;
    private _usingDeveloperMock = false;
    private _getUserInfoRetryCount = 0;
    private _isRequestingUserInfo = false;
    private _hasStartedUserInfoFlow = false;

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
        tooltip: 'Cho phép Tevi hiển thị popup xin quyền khi lấy thông tin người dùng. Docs Tevi mặc định false trong Mini App.',
    })
    public showLoginPopup = false;

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
        this._hasStartedUserInfoFlow = false;
        this._isRequestingUserInfo = false;
        this._getUserInfoRetryCount = 0;

        // Lần mở lại Mini App: hiện ngay user cache để không kẹt ở "Đang loadConfig...".
        this.restoreCachedLoginUi();

        if (typeof window === 'undefined' || !window.TeviJS) {
            if (!this.getUserToken()) {
                this.setStatus('Không tìm thấy TeviJS. Hãy chạy game trong ứng dụng Tevi.');
            }
            return;
        }

        const pageOrigin = typeof window !== 'undefined' ? (window.location?.origin || '') : '';
        console.log('[TeviLogin] page origin:', pageOrigin);
        // Hiện Origin trên userInfoLabel để dễ chụp màn hình điện thoại.
        if (pageOrigin) {
            this.setUserInfo(`ORIGIN = ${pageOrigin}`);
        }

        const teviJS = window.TeviJS as any;
        if (!this.getUserToken()) {
            this.setStatus(`Đang loadConfig... Origin=${pageOrigin || '?'}`);
        } else {
            this.setStatus(`Làm mới phiên... Origin=${pageOrigin || '?'}`);
        }

        try {
            // Theo docs Tevi: loadConfig trước, đợi callback/native sẵn sàng rồi mới getUserInfo.
            // helper_tevi.js nhận (config, callback); một số bản type cũ chỉ khai báo 1 tham số.
            teviJS.loadConfig(
                {
                    optionMenu: true,
                    config: {
                        app_id: APP_ID,
                        env: ENV,
                    },
                    version: VERSION,
                },
                (response: TeviBridgeResponse) => this.onLoadConfigFinished(response),
            );

            // Native đôi khi không callback loadConfig ở lần mở lại → vẫn luôn tiếp tục getUserInfo.
            this.scheduleOnce(() => {
                if (!this._hasStartedUserInfoFlow) {
                    console.warn('[TeviLogin] loadConfig chưa callback, tiếp tục getUserInfo.');
                    this.beginUserInfoFlow();
                }
            }, 1.0);
        } catch (error) {
            this.handleFailure('LOAD_CONFIG_ERROR', error);
        }
    }

    /** Hiện lại user đã lưu để UI không trống khi reload Mini App. */
    private restoreCachedLoginUi(): void {
        const token = this.getUserToken();
        const userId = this.getUserId();
        if (!token || !userId) {
            this.setStatus('Đang kết nối...');
            this.setUserInfo('');
            return;
        }

        this.setStatus('Đăng nhập Tevi thành công (cache)');
        this.setUserInfo(`User ID: ${userId}`);
    }

    /** Có thể nối hàm này với Button để người dùng thử đăng nhập lại. */
    public requestUserInfo(): void {
        if (this._isRequestingUserInfo) return;

        this.setStatus('Đang lấy thông tin người dùng...');

        if (typeof window === 'undefined' || !window.TeviJS) {
            this.setStatus('Không tìm thấy TeviJS. Hãy chạy game trong ứng dụng Tevi.');
            return;
        }

        const teviJS = window.TeviJS;
        this._isRequestingUserInfo = true;

        try {
            teviJS.getUserInfo(
                {
                    is_popup: this.showLoginPopup,
                    app_id: APP_ID,
                },
                response => this.handleUserInfoResponse(response),
            );
        } catch (error) {
            this._isRequestingUserInfo = false;
            this.handleFailure('GET_USER_INFO_ERROR', error);
        }
    }

    /** Token hiện tại để module Topup/Video sử dụng sau này. */
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

    private onLoadConfigFinished(response?: TeviBridgeResponse): void {
        console.log('[TeviLogin] loadConfig response:', response);

        if (response && this.hasErrorCode(response.error_code)) {
            // loadConfig lỗi vẫn thử getUserInfo vì một số bản native trả callback chung.
            console.warn('[TeviLogin] loadConfig báo lỗi, vẫn thử getUserInfo:', response);
        }

        this.beginUserInfoFlow();
    }

    private beginUserInfoFlow(): void {
        if (this._hasStartedUserInfoFlow) return;
        this._hasStartedUserInfoFlow = true;
        this.requestUserInfo();
    }

    private handleUserInfoResponse(response: TeviGetUserInfoResponse): void {
        this._isRequestingUserInfo = false;
        const normalized = this.normalizeBridgePayload(response);
        console.log('[TeviLogin] getUserInfo raw:', response);
        console.log('[TeviLogin] getUserInfo normalized:', normalized);

        if (!normalized) {
            this.handleFailure('EMPTY_RESPONSE');
            return;
        }

        if (this.hasErrorCode(normalized.error_code)) {
            const code = `${normalized.error_code}`;
            const detail = this.getBridgeErrorMessage(normalized);

            // Bridge chưa sẵn sàng / timeout → retry theo docs flow khởi tạo.
            if (this.shouldRetryGetUserInfo(code) && this._getUserInfoRetryCount < GET_USER_INFO_MAX_RETRY) {
                this._getUserInfoRetryCount++;
                this.setStatus(`Bridge chưa sẵn sàng, thử lại ${this._getUserInfoRetryCount}/${GET_USER_INFO_MAX_RETRY}...`);
                this.scheduleOnce(() => this.requestUserInfo(), GET_USER_INFO_RETRY_DELAY_MS / 1000);
                return;
            }

            this.handleFailure(code, detail);
            return;
        }

        const extracted = this.extractUserCredentials(normalized);
        if (!extracted.token || !extracted.userId) {
            const preview = this.buildResponsePreview(normalized);
            this.handleFailure(
                'INVALID_USER_INFO',
                `Thiếu user_app_token/id. Preview: ${preview}`,
            );
            return;
        }

        try {
            sys.localStorage.setItem(STORAGE_KEYS.USER_TOKEN, extracted.token);
            sys.localStorage.setItem(STORAGE_KEYS.USER_ID, extracted.userId);
        } catch (error) {
            this.handleFailure('LOCAL_STORAGE_ERROR', error);
            return;
        }

        this._getUserInfoRetryCount = 0;
        this.setStatus(this._usingDeveloperMock
            ? 'Đăng nhập Tevi thành công (Developer Mock)'
            : 'Đăng nhập Tevi thành công');
        this.setUserInfo(extracted.userName
            ? `${extracted.userName} (ID: ${extracted.userId})`
            : `User ID: ${extracted.userId}`);
        console.log('[TeviLogin] Đăng nhập thành công:', {
            userId: extracted.userId,
            userName: extracted.userName,
            appId: APP_ID,
            env: ENV,
        });
    }

    /**
     * Tevi native đôi khi trả object, JSON string, hoặc bọc trong { action, data }.
     * Chuẩn hóa về object phẳng hơn trước khi đọc credential.
     */
    private normalizeBridgePayload(payload: unknown): any {
        let current: any = payload;
        for (let i = 0; i < 3; i++) {
            if (typeof current === 'string') {
                const text = current.trim();
                if (!text) return null;
                try {
                    current = JSON.parse(text);
                    continue;
                } catch {
                    // Một số bản Android/iOS trả Base64 JSON.
                    try {
                        current = JSON.parse(atob(text));
                        continue;
                    } catch {
                        return null;
                    }
                }
            }
            break;
        }

        if (!current || typeof current !== 'object') return null;

        // Nếu data là string JSON thì parse tiếp.
        if (typeof current.data === 'string') {
            const parsedData = this.normalizeBridgePayload(current.data);
            if (parsedData) {
                current = { ...current, data: parsedData };
            }
        }

        return current;
    }

    /** Tìm user_app_token/id ở nhiều vị trí response khác nhau của Tevi. */
    private extractUserCredentials(payload: any): { token: string; userId: string; userName: string } {
        const candidates: any[] = [
            payload?.userInfo,
            payload?.data?.userInfo,
            payload?.data?.user,
            payload?.data,
            payload?.result?.userInfo,
            payload?.result,
            payload,
        ];

        let token = '';
        let userId = '';
        let userName = '';

        for (const candidate of candidates) {
            if (!candidate || typeof candidate !== 'object') continue;

            if (!token) {
                const tokenRaw = candidate.user_app_token
                    ?? candidate.userAppToken
                    ?? candidate.token
                    ?? candidate.access_token
                    ?? candidate.app_token;
                if (typeof tokenRaw === 'string' && tokenRaw.trim()) {
                    token = tokenRaw.trim();
                }
            }

            if (!userId) {
                const rawUserId = candidate.id
                    ?? candidate.user_id
                    ?? candidate.userId
                    ?? candidate.uid;
                if (rawUserId !== undefined && rawUserId !== null && `${rawUserId}`.trim()) {
                    const value = `${rawUserId}`.trim();
                    // Tránh lấy nhầm action id của bridge.
                    if (!value.includes('action.')) {
                        userId = value;
                    }
                }
            }

            if (!userName) {
                if (typeof candidate.name === 'string' && candidate.name.trim()) {
                    userName = candidate.name.trim();
                } else if (typeof candidate.user_name === 'string' && candidate.user_name.trim()) {
                    userName = candidate.user_name.trim();
                }
            }

            if (token && userId) {
                return { token, userId, userName };
            }
        }

        if (!token) {
            token = this.findStringByKeys(payload, [
                'user_app_token',
                'userAppToken',
                'access_token',
                'app_token',
            ]);
        }
        if (!userId) {
            userId = this.findStringByKeys(payload, [
                'user_id',
                'userId',
                'uid',
                'id',
            ]);
        }
        if (!userName) {
            userName = this.findStringByKeys(payload, ['name', 'user_name', 'userName']);
        }

        // Tevi thường chỉ trả JWT trong user_app_token, không có field id riêng.
        if (token && !userId) {
            const jwtClaims = this.decodeJwtPayload(token);
            const jwtUserId = jwtClaims?.sub
                ?? jwtClaims?.user_id
                ?? jwtClaims?.userId
                ?? jwtClaims?.uid
                ?? jwtClaims?.id;
            if (jwtUserId !== undefined && jwtUserId !== null && `${jwtUserId}`.trim()) {
                userId = `${jwtUserId}`.trim();
            }
            if (!userName && typeof jwtClaims?.name === 'string') {
                userName = jwtClaims.name.trim();
            }
        }

        // Token hợp lệ là đủ để đăng nhập; id fallback ổn định từ JWT.
        if (token && !userId) {
            userId = `tevi_${token.slice(-12)}`;
            console.warn('[TeviLogin] Không có user id trong response/JWT, dùng fallback:', userId);
        }

        return { token, userId, userName };
    }

    /** Decode phần payload của JWT (không verify chữ ký — chỉ lấy claim hiển thị). */
    private decodeJwtPayload(token: string): Record<string, unknown> | null {
        try {
            const parts = token.split('.');
            if (parts.length < 2) return null;

            let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            while (base64.length % 4 !== 0) {
                base64 += '=';
            }

            const jsonText = atob(base64);
            const parsed = JSON.parse(jsonText);
            return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
        } catch (error) {
            console.warn('[TeviLogin] Không decode được JWT payload:', error);
            return null;
        }
    }

    private findStringByKeys(root: unknown, keys: string[]): string {
        const queue: any[] = [root];
        const seen = new Set<any>();

        while (queue.length > 0) {
            const node = queue.shift();
            if (!node || typeof node !== 'object' || seen.has(node)) continue;
            seen.add(node);

            for (const key of keys) {
                const value = (node as any)[key];
                if (typeof value === 'string' && value.trim()) {
                    // Tránh lấy nhầm action id kiểu "action.user.core.getInfo".
                    if (key === 'id' && value.includes('action.')) continue;
                    return value.trim();
                }
                if ((key === 'id' || key === 'user_id' || key === 'userId' || key === 'uid')
                    && (typeof value === 'number' || typeof value === 'bigint')) {
                    return `${value}`;
                }
            }

            for (const key in node) {
                if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
                const value = (node as any)[key];
                if (value && typeof value === 'object') {
                    queue.push(value);
                } else if (typeof value === 'string' && value.trim().startsWith('{')) {
                    const parsed = this.normalizeBridgePayload(value);
                    if (parsed) queue.push(parsed);
                }
            }
        }

        return '';
    }

    private buildResponsePreview(payload: unknown): string {
        try {
            const text = JSON.stringify(payload) || '';
            return text.length > 160 ? `${text.slice(0, 160)}...` : text;
        } catch {
            return Object.prototype.toString.call(payload);
        }
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
            loadConfig: (options: TeviLoadConfigOptions, callback?: (response: TeviBridgeResponse) => void) => {
                console.log('[TeviMock] loadConfig:', options);
                window.setTimeout(() => callback?.({ call: 'ok' }), 100);
            },
            getUserInfo: (options: TeviGetUserInfoOptions, callback: (response: TeviGetUserInfoResponse) => void) => {
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
            topup: (options: TeviTopupOptions, callback: (response: TeviBridgeResponse) => void) => {
                console.log('[TeviMock] topup:', options);
                callback({ call: 'ok', message: 'Developer mock topup thành công' });
            },
            executeLink: (options: TeviExecuteLinkOptions, callback: (response: TeviBridgeResponse) => void) => {
                console.log('[TeviMock] executeLink:', options);
                callback({ call: 'ok', message: 'Developer mock executeLink thành công' });
            },
        } as TeviJSBridge;

        console.warn('[TeviMock] Đang sử dụng TeviJS giả cho môi trường phát triển.');
    }

    private shouldRetryGetUserInfo(code: string): boolean {
        // Theo helper_tevi.js: -5 Not ready, -6 Not Available Device, -14 Timeout.
        return code === '-5' || code === '-6' || code === '-14';
    }

    private hasErrorCode(errorCode: unknown): boolean {
        if (errorCode === undefined || errorCode === null || errorCode === '') return false;
        return `${errorCode}` !== '0';
    }

    private getBridgeErrorMessage(response: TeviGetUserInfoResponse | TeviBridgeResponse): string {
        const anyResponse = response as any;
        if (typeof anyResponse.error_message === 'string' && anyResponse.error_message.trim()) {
            return anyResponse.error_message.trim();
        }
        if (typeof anyResponse.message === 'string' && anyResponse.message.trim()) {
            return anyResponse.message.trim();
        }
        return '';
    }

    private handleFailure(code: string, detail?: unknown): void {
        const message = this.getErrorMessage(detail);
        this.setStatus(`Đăng nhập Tevi thất bại (${code})${message ? `: ${message}` : ''}`);
        this.setUserInfo('');
        console.error(`[TeviLogin] ${code}:`, detail, { appId: APP_ID, env: ENV, version: VERSION });
    }

    private getErrorMessage(detail: unknown): string {
        if (typeof detail === 'string') return detail;
        if (detail instanceof Error) return detail.message;
        return '';
    }

    /** Cho module khác (video, API…) ghi trạng thái debug tạm lên label. */
    public setDebugStatus(message: string): void {
        this.setStatus(message);
        console.log('[TeviDebug]', message);
    }

    /** Hiện text debug trên userInfoLabel (dễ chụp màn hình hơn status dài). */
    public setDebugUserInfo(message: string): void {
        this.setUserInfo(message);
        console.log('[TeviDebug][UserInfo]', message);
    }

    /** Origin trang Mini App hiện tại. */
    public getPageOrigin(): string {
        try {
            return typeof window !== 'undefined' ? (window.location?.origin || '') : '';
        } catch {
            return '';
        }
    }

    private setStatus(message: string): void {
        if (this.statusLabel) {
            this.statusLabel.string = `v${VERSION} | ${message}`;
        }
    }

    private setUserInfo(message: string): void {
        if (this.userInfoLabel) {
            this.userInfoLabel.string = message;
        }
    }
}
