import { _decorator, Component, Label, sys } from 'cc';
import { DEV, PREVIEW } from 'cc/env';
import { EventBus } from './core/EventBus';
import { GameEvent } from './enums/GameEvent';
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
    /** Đã thử popup khi JWT.app lệch APP_ID (tránh loop). */
    private _jwtMismatchPopupAttempted = false;

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
        this._jwtMismatchPopupAttempted = false;

        // Đổi APP_ID hoặc token JWT thuộc app khác → xóa cache trước khi gọi bridge.
        this.purgeStaleSessionIfNeeded('startup');

        // Lần mở lại Mini App: hiện user cache (đã validate JWT.app).
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
        const loadConfigPayload = {
            optionMenu: true,
            config: {
                app_id: APP_ID,
                env: ENV,
            },
            version: VERSION,
        };
        console.log('[TeviLogin] loadConfig payload:', loadConfigPayload);

        if (!this.getUserToken()) {
            this.setStatus(`loadConfig app=${APP_ID} env=${ENV} v${VERSION}`);
        } else {
            this.setStatus(`Refresh session app=${APP_ID} JWT.app=${this.getTokenAppId() || '?'}`);
        }

        try {
            teviJS.loadConfig(
                loadConfigPayload,
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

    /** Hiện lại user đã lưu (chỉ khi JWT.app khớp APP_ID). */
    private restoreCachedLoginUi(): void {
        const token = this.getUserToken();
        const userId = this.getUserId();
        if (!token || !userId) {
            this.setStatus('Đang kết nối Tevi...');
            const origin = typeof window !== 'undefined' ? (window.location?.origin || '') : '';
            this.setUserInfo(origin ? `ORIGIN = ${origin}` : '');
            return;
        }

        const jwtApp = this.readTokenAppId(token);
        if (jwtApp && jwtApp !== APP_ID) {
            this.setStatus(`Token cache sai app: JWT.app=${jwtApp} ≠ ${APP_ID}`);
            this.setUserInfo('Clear Token hoặc mở đúng Mini App trên Tevi');
            return;
        }

        this.setStatus(`Login cache OK JWT.app=${jwtApp || APP_ID}`);
        this.setUserInfo(`User ID: ${userId} | JWT.app=${jwtApp || APP_ID}`);
        this.scheduleOnce(() => this.tryClaimPendingTopUps(), 0.5);
    }

    /**
     * Xóa token nếu đổi APP_ID trong build mới, hoặc JWT không thuộc app hiện tại.
     * @returns true nếu đã xóa session
     */
    private purgeStaleSessionIfNeeded(reason: string): boolean {
        let lastAppId = '';
        try {
            lastAppId = sys.localStorage.getItem(STORAGE_KEYS.LAST_APP_ID) || '';
        } catch {
            // ignore
        }

        const token = this.getUserToken();
        const jwtApp = token ? this.readTokenAppId(token) : '';
        const appIdChanged = lastAppId !== '' && lastAppId !== APP_ID;
        const jwtMismatch = jwtApp !== '' && jwtApp !== APP_ID;

        if (appIdChanged || jwtMismatch) {
            console.warn('[TeviLogin] Purging stale session:', {
                reason,
                lastAppId,
                jwtApp,
                expect: APP_ID,
                appIdChanged,
                jwtMismatch,
            });
            this.clearTeviSessionInternal(
                appIdChanged
                    ? `APP_ID đổi ${lastAppId}→${APP_ID}`
                    : `JWT.app=${jwtApp}≠${APP_ID}`,
            );
            return true;
        }

        if (!lastAppId) {
            try {
                sys.localStorage.setItem(STORAGE_KEYS.LAST_APP_ID, APP_ID);
            } catch {
                // ignore
            }
        }
        return false;
    }

    private clearTeviSessionInternal(reason: string): void {
        try {
            sys.localStorage.removeItem(STORAGE_KEYS.USER_TOKEN);
            sys.localStorage.removeItem(STORAGE_KEYS.USER_ID);
            sys.localStorage.setItem(STORAGE_KEYS.LAST_APP_ID, APP_ID);
        } catch (error) {
            console.warn('[TeviLogin] clearTeviSessionInternal failed:', error);
        }
        this.setUserInfo('');
        this.setStatus(`Đã xóa token (${reason})`);
        console.log('[TeviLogin] Cleared session:', reason);
    }

    /** Có thể nối hàm này với Button để người dùng thử đăng nhập lại. */
    public requestUserInfo(forcePopup = false): void {
        if (this._isRequestingUserInfo) return;

        this.setStatus(forcePopup
            ? `getUserInfo popup app=${APP_ID}...`
            : `getUserInfo app=${APP_ID} popup=${this.showLoginPopup}`);

        if (typeof window === 'undefined' || !window.TeviJS) {
            this.setStatus('Không tìm thấy TeviJS. Hãy chạy game trong ứng dụng Tevi.');
            return;
        }

        const teviJS = window.TeviJS;
        this._isRequestingUserInfo = true;
        const usePopup = forcePopup || this.showLoginPopup;

        console.log('[TeviLogin] getUserInfo request:', { app_id: APP_ID, is_popup: usePopup });

        try {
            teviJS.getUserInfo(
                {
                    is_popup: usePopup,
                    app_id: APP_ID,
                },
                response => this.handleUserInfoResponse(response),
            );
        } catch (error) {
            this._isRequestingUserInfo = false;
            this.handleFailure('GET_USER_INFO_ERROR', error);
        }
    }

    /** Ép login popup — dùng khi JWT.app lệch hoặc sau Clear Token. */
    public forceReLoginWithPopup(): void {
        this._jwtMismatchPopupAttempted = false;
        this.clearTeviSessionInternal('forceReLogin');
        this._hasStartedUserInfoFlow = false;
        this._isRequestingUserInfo = false;
        if (typeof window !== 'undefined' && window.TeviJS) {
            this.requestUserInfo(true);
        } else {
            this.initializeTevi();
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

    /**
     * Xóa token/user cache trên máy (localStorage).
     * Dùng khi JWT.app thuộc app khác dù config APP_ID đang là app hiện tại.
     */
    public clearTeviSession(reason: string = 'manual'): void {
        this.clearTeviSessionInternal(reason);
        this.setStatus(`Đã xóa token cache (${reason}). Mở lại Mini App ${APP_ID} trên Tevi.`);
    }

    /** app_id trong JWT hiện tại (rỗng nếu chưa login / không decode được). */
    public getTokenAppId(): string {
        return this.readTokenAppId(this.getUserToken());
    }

    private readTokenAppId(token: string): string {
        const claims = this.decodeJwtPayload(token);
        if (!claims) return '';
        const raw = claims.app_id ?? claims.appId ?? claims.aud ?? '';
        return raw === undefined || raw === null ? '' : `${raw}`.trim();
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

    /**
     * Xin lại user_app_token với popup (sau khi bật Payment trên Console).
     * Token cũ có thể thiếu scope payment.write → APP_003.
     */
    public refreshLoginForPayment(): Promise<string> {
        return new Promise((resolve, reject) => {
            if (typeof window === 'undefined' || !window.TeviJS) {
                reject(new Error('Không có TeviJS — mở trong app Tevi.'));
                return;
            }
            if (this._isRequestingUserInfo) {
                reject(new Error('Đang xin login — thử lại sau vài giây.'));
                return;
            }

            try {
                sys.localStorage.removeItem(STORAGE_KEYS.USER_TOKEN);
            } catch {
                // ignore
            }

            this._isRequestingUserInfo = true;
            this.setStatus('Xin lại quyền Payment (popup)...');

            const prevPopup = this.showLoginPopup;
            this.showLoginPopup = true;

            try {
                window.TeviJS.getUserInfo(
                    {
                        is_popup: true,
                        app_id: APP_ID,
                        scopes: ['payment.write'],
                    },
                    (response) => {
                        this.showLoginPopup = prevPopup;
                        this._isRequestingUserInfo = false;

                        const normalized = this.normalizeBridgePayload(response);
                        if (!normalized || this.hasErrorCode(normalized?.error_code)) {
                            reject(new Error(
                                this.getBridgeErrorMessage(normalized || {})
                                || `Refresh login thất bại (${normalized?.error_code ?? '?'})`,
                            ));
                            return;
                        }

                        const extracted = this.extractUserCredentials(normalized);
                        if (!extracted.token) {
                            reject(new Error('Refresh login: thiếu user_app_token.'));
                            return;
                        }

                        const jwtApp = this.readTokenAppId(extracted.token);
                        if (jwtApp && jwtApp !== APP_ID) {
                            reject(new Error(
                                `Token Payment thuộc app khác: JWT.app=${jwtApp}, cần ${APP_ID}. `
                                + 'Mở game từ Portal Mini App đúng, không phải app cũ trên Tevi.',
                            ));
                            return;
                        }

                        try {
                            sys.localStorage.setItem(STORAGE_KEYS.USER_TOKEN, extracted.token);
                            sys.localStorage.setItem(STORAGE_KEYS.LAST_APP_ID, APP_ID);
                            if (extracted.userId) {
                                sys.localStorage.setItem(STORAGE_KEYS.USER_ID, extracted.userId);
                            }
                        } catch (error) {
                            reject(error instanceof Error ? error : new Error(`${error}`));
                            return;
                        }

                        this.setStatus('Đã xin lại token Payment');
                        this.setUserInfo(extracted.userName
                            ? `${extracted.userName} (ID: ${extracted.userId})`
                            : `User ID: ${extracted.userId}`);
                        resolve(extracted.token);
                    },
                );
            } catch (error) {
                this.showLoginPopup = prevPopup;
                this._isRequestingUserInfo = false;
                reject(error instanceof Error ? error : new Error(`${error}`));
            }
        });
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

        const jwtApp = this.readTokenAppId(extracted.token);
        const appMatch = jwtApp === APP_ID || jwtApp === '';

        if (!appMatch && jwtApp) {
            console.error('[TeviLogin] getUserInfo trả JWT app khác:', {
                jwtApp,
                expect: APP_ID,
                sentAppId: APP_ID,
                hint: 'Tevi native gắn token theo Mini App đang mở trên app Tevi, không chỉ theo JS app_id.',
            });

            if (!this._jwtMismatchPopupAttempted) {
                this._jwtMismatchPopupAttempted = true;
                this.clearTeviSessionInternal(`JWT.app=${jwtApp}`);
                this.setStatus(`JWT.app=${jwtApp} ≠ ${APP_ID} → thử popup login...`);
                this.scheduleOnce(() => this.requestUserInfo(true), 0.3);
                return;
            }

            this.handleFailure(
                'JWT_APP_MISMATCH',
                `JWT.app=${jwtApp} nhưng game cần ${APP_ID}. `
                + `Đóng Mini App → mở lại từ Portal app ${APP_ID}. `
                + 'URL GitHub chỉ nên gắn 1 app trên Portal.',
            );
            return;
        }

        try {
            sys.localStorage.setItem(STORAGE_KEYS.USER_TOKEN, extracted.token);
            sys.localStorage.setItem(STORAGE_KEYS.USER_ID, extracted.userId);
            sys.localStorage.setItem(STORAGE_KEYS.LAST_APP_ID, APP_ID);
        } catch (error) {
            this.handleFailure('LOCAL_STORAGE_ERROR', error);
            return;
        }

        this._getUserInfoRetryCount = 0;
        this._jwtMismatchPopupAttempted = false;
        this.setStatus(this._usingDeveloperMock
            ? `Login OK (Mock) JWT.app=${jwtApp || APP_ID} expect=${APP_ID}`
            : `Login OK JWT.app=${jwtApp || APP_ID} expect=${APP_ID} match=true`);
        this.setUserInfo(
            (extracted.userName
                ? `${extracted.userName} (ID: ${extracted.userId})`
                : `User ID: ${extracted.userId}`)
            + ` | JWT.app=${jwtApp || APP_ID}`,
        );
        console.log('[TeviLogin] Đăng nhập thành công:', {
            userId: extracted.userId,
            userName: extracted.userName,
            appId: APP_ID,
            jwtApp,
            match: true,
            env: ENV,
        });
        void this.tryClaimPendingTopUps();
    }

    /** Báo GameManager quét order paid (tránh import vòng TeviPaymentService). */
    private tryClaimPendingTopUps(): void {
        EventBus.getInstance().emit(GameEvent.REQUEST_CLAIM_PENDING_TOPUPS);
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
