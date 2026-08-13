import { TeviLoginManager } from '../TeviLoginManager';
import {
    APP_ID,
    ENV,
    STAR_TOPUP_PACKS,
    StarTopUpPack,
    TEVI_API_BASE,
    TEVI_TOP_UP_SIGNATURE_PROXY_URL,
    TEVI_TOP_UP_SIGNATURE_URL,
    TEVI_TOP_UP_STATUS_URL,
    TEVI_TOP_UP_SDK_REPORT_URL,
    VERSION,
} from '../TeviConstants';
import { StarWallet } from './StarWallet';

export type PaymentStatusCallback = (message: string) => void;

/** Callback UI theo từng giai đoạn nạp (Tevi popup, chờ webhook, thành công). */
export interface PurchasePackOptions {
    onStatus?: PaymentStatusCallback;
    /** Trước khi gọi TeviJS.topup — hiện màn hình chờ. */
    onTeviDialog?: () => void;
    /** Sau khi Tevi popup trả callback (ok hoặc hủy/lỗi). */
    onTeviDialogClosed?: (ok: boolean) => void;
    /** Tevi xác nhận xong, bắt đầu poll webhook — hiện thông báo chờ sao. */
    onAwaitingStars?: () => void;
    /** Bước 6/6 — sao đã cộng vào ví. */
    onSuccess?: (stars: number, balance: number) => void;
    onError?: (message: string) => void;
}

interface TopUpSignatureResponse {
    success?: boolean;
    message?: string;
    error_code?: string | number | null;
    order_id?: string;
    data?: {
        deposit_token?: string;
        signature?: string;
        token?: string;
        top_up_signature?: string;
        channel_id?: string | number;
        [key: string]: unknown;
    } | null;
    deposit_token?: string;
    signature?: string;
    channel_id?: string | number;
    /** Debug do Worker trả khi lỗi / luôn kèm khi deploy bản mới. */
    debug?: {
        worker_version?: string;
        tevi_url?: string;
        tevi_http_status?: number;
        tevi_body_sent?: unknown;
        tevi_raw?: string;
        auth_mode?: string;
        has_api_key?: boolean;
        app_id?: string;
        user_id?: string;
        order_id?: string;
        jwt_app_id?: string;
        jwt_aud?: string;
        jwt_scopes?: string;
        request_body_keys?: string[];
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

/**
 * Nạp Star qua Tevi (flow đầy đủ theo docs):
 * 1) Xin user_app_token (payment.write)
 * 2) POST Worker top-up-signature → deposit_token + order_id
 * 3) TeviJS.topup({ deposit_token, amount })
 * 4) Poll Worker /api/top-up-status — đợi webhook user_topup (paid)
 * 5) Cộng ★ local khi status=paid
 */
export class TeviPaymentService {
    private static _instance: TeviPaymentService | null = null;
    private _busy = false;

    /** Poll webhook tối đa ~90s (45 × 2s). */
    private static readonly WEBHOOK_POLL_ATTEMPTS = 45;
    private static readonly WEBHOOK_POLL_INTERVAL_MS = 2000;

    public static getInstance(): TeviPaymentService {
        if (!TeviPaymentService._instance) {
            TeviPaymentService._instance = new TeviPaymentService();
        }
        return TeviPaymentService._instance;
    }

    public getPacks(): readonly StarTopUpPack[] {
        return STAR_TOPUP_PACKS;
    }

    public isBusy(): boolean {
        return this._busy;
    }

    public getPackById(packId: string): StarTopUpPack | null {
        return STAR_TOPUP_PACKS.find(pack => pack.id === packId) || null;
    }

    /** Nạp thật qua Tevi sandbox (cần chạy trong app Tevi). */
    public async purchasePack(
        packId: string,
        options?: PaymentStatusCallback | PurchasePackOptions,
    ): Promise<{ ok: boolean; message: string; balance: number }> {
        const lifecycle = this.resolvePurchaseOptions(options);
        const report = (msg: string) => {
            lifecycle.onStatus?.(msg);
            console.log('[TeviPayment]', msg);
        };

        if (this._busy) {
            const message = 'Processing previous transaction...';
            report(message);
            return { ok: false, message, balance: StarWallet.getInstance().getBalance() };
        }

        const pack = this.getPackById(packId);
        if (!pack) {
            const message = `Pack not found: ${packId}`;
            report(message);
            return { ok: false, message, balance: StarWallet.getInstance().getBalance() };
        }

        this._busy = true;
        try {
            report(
                `1/5 v${VERSION} APP_ID=${APP_ID} ENV=${ENV}`
                + ` | TeviAPI=${TEVI_API_BASE}`
                + ` | expect=${TEVI_TOP_UP_SIGNATURE_URL}`,
            );
            report(`1/5 WorkerProxy=${TEVI_TOP_UP_SIGNATURE_PROXY_URL}`);
            report(`1/5 refreshing Payment token...`);
            const login = TeviLoginManager.Instance;
            if (!login) {
                throw new Error('Missing TeviLoginManager.');
            }

            let userToken = '';
            try {
                userToken = await login.refreshLoginForPayment();
                report(`1/5 New token OK (${userToken.length} chars)`);
            } catch (refreshError) {
                userToken = login.getUserToken().trim();
                const refreshMsg = refreshError instanceof Error ? refreshError.message : `${refreshError}`;
                report(`1/5 Refresh popup skipped (${refreshMsg}) — using cached token`);
                if (!userToken) {
                    throw new Error('Missing user_app_token. Log in again in Tevi.');
                }
            }

            const tokenAppId = this.readJwtClaim(userToken, 'app_id')
                || this.readJwtClaim(userToken, 'appId')
                || '';
            const tokenAud = this.readJwtClaim(userToken, 'aud') || '';
            const scopes = this.readJwtClaim(userToken, 'scopes')
                || this.readJwtClaim(userToken, 'scope')
                || '';
            const jwtUserId = this.readJwtClaim(userToken, 'user_id')
                || this.readJwtClaim(userToken, 'userId')
                || this.readJwtClaim(userToken, 'sub')
                || '';
            const jwtIss = this.readJwtClaim(userToken, 'iss') || '';
            const jwtEnv = this.readJwtClaim(userToken, 'env')
                || this.readJwtClaim(userToken, 'environment')
                || '';
            const matchApp = tokenAppId === APP_ID || tokenAud === APP_ID;
            // Giữ dòng này trong message cuối (status log UI sẽ giữ nhiều dòng).
            const jwtSummary =
                `JWT.app=${tokenAppId || '?'} aud=${tokenAud || '?'}`
                + ` user=${jwtUserId || '?'} scope=${scopes || '?'}`
                + ` iss=${jwtIss || '?'} jwtEnv=${jwtEnv || '?'}`
                + ` matchApp=${matchApp} expect=${APP_ID}`;
            report(`1/5 ${jwtSummary}`);

            if (!matchApp) {
                throw new Error(
                    `STOP: token thuộc Mini App khác. ${jwtSummary}. `
                    + `STK/HXM là App ID do Tevi ghi vào JWT khi getUserInfo — `
                    + `không có trong code game, không do Cloudflare tạo. `
                    + `Bấm Clear Token trong shop → login lại trong app ${APP_ID}. `
                    + `Nếu JWT.app vẫn khác: Portal ${APP_ID} đang mở nhầm WebView/session của app kia.`,
                );
            }

            report(`2/6 SEND Worker top-up-signature amount=${pack.amount} stars=${pack.stars} ...`);
            const { depositToken, channelId, orderId } = await this.requestTopUpSignatureViaWorker(
                userToken,
                pack,
                report,
            );

            report(`3/6 TeviJS.topup amount=${pack.amount} order=${orderId} channel=${channelId ?? '-'}`);
            lifecycle.onTeviDialog?.();
            let sdkCallback: Record<string, unknown>;
            try {
                sdkCallback = await this.invokeTeviTopup(depositToken, pack.amount, channelId, report);
                lifecycle.onTeviDialogClosed?.(true);
            } catch (topupError) {
                lifecycle.onTeviDialogClosed?.(false);
                throw topupError;
            }
            await this.reportSdkCallbackToWorker(userToken, orderId, sdkCallback, report);

            report(`4/6 Waiting webhook user_topup (poll ${TEVI_TOP_UP_STATUS_URL})...`);
            lifecycle.onAwaitingStars?.();
            await this.waitForWebhookPaid(userToken, orderId, sdkCallback, report);

            const balance = StarWallet.getInstance().addStars(pack.stars, `topup:${pack.id}:${orderId}`);
            const message = `6/6 SUCCESS webhook paid → +${pack.stars}★ | Total ★ ${balance} | order=${orderId}`;
            report(message);
            lifecycle.onSuccess?.(pack.stars, balance);
            return { ok: true, message, balance };
        } catch (error) {
            const message = error instanceof Error ? error.message : `${error}`;
            report(`Top-up error: ${message}`);
            lifecycle.onError?.(message);
            return { ok: false, message, balance: StarWallet.getInstance().getBalance() };
        } finally {
            this._busy = false;
        }
    }

    /**
     * Nạp giả lập Editor: vẫn in đủ bước GỬI → CHỜ → NHẬN trên label
     * (giả lập delay API, không gọi Tevi thật).
     */
    public async mockGrantPack(
        packId: string,
        options?: PaymentStatusCallback | PurchasePackOptions,
    ): Promise<{ ok: boolean; message: string; balance: number }> {
        const lifecycle = this.resolvePurchaseOptions(options);
        const report = (msg: string) => {
            lifecycle.onStatus?.(msg);
            console.log('[TeviPayment][Mock]', msg);
        };

        const pack = this.getPackById(packId);
        if (!pack) {
            const message = `Pack not found: ${packId}`;
            report(message);
            return { ok: false, message, balance: StarWallet.getInstance().getBalance() };
        }

        report(`[Mock] 1/4 Preparing pack ${pack.label}`);
        await this.delay(250);

        report(`[Mock] 2/4 SEND fake top-up-signature { amount: ${pack.amount} } ... waiting`);
        await this.delay(450);

        report(`[Mock] 3/4 RECEIVED fake deposit_token=mock-token-${pack.id} | simulating TeviJS.topup`);
        await this.delay(350);

        const balance = StarWallet.getInstance().addStars(pack.stars, `mock:${pack.id}`);
        const message = `[Mock] 4/4 SUCCESS → +${pack.stars}★ | Total ★ ${balance} (Tevi not called)`;
        report(message);
        lifecycle.onSuccess?.(pack.stars, balance);
        return { ok: true, message, balance };
    }

    private resolvePurchaseOptions(
        input?: PaymentStatusCallback | PurchasePackOptions,
    ): PurchasePackOptions {
        if (typeof input === 'function') {
            return { onStatus: input };
        }
        return input ?? {};
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /** Game → Worker → Tevi API; Worker lưu order pending (KV). */
    private async requestTopUpSignatureViaWorker(
        userToken: string,
        pack: StarTopUpPack,
        report: PaymentStatusCallback,
    ): Promise<{ depositToken: string; channelId?: string | number; orderId: string }> {
        const body = {
            amount: pack.amount,
            stars: pack.stars,
            pack_id: pack.id,
            app_id: APP_ID,
            client_version: VERSION,
        };
        report(`POST Worker ${TEVI_TOP_UP_SIGNATURE_PROXY_URL}`);
        report(`Game→Worker body ${JSON.stringify(body)}`);
        report(`Worker MUST forward → ${TEVI_TOP_UP_SIGNATURE_URL}`);

        let response: Response;
        try {
            response = await fetch(TEVI_TOP_UP_SIGNATURE_PROXY_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${userToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify(body),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : `${error}`;
            throw new Error(
                `Worker top-up-signature call failed: ${message}. `
                + 'Is /api/top-up-signature deployed on fancy-sun-962d?',
            );
        }

        report(`Worker HTTP ${response.status}, parsing...`);

        let payload: TopUpSignatureResponse = {};
        try {
            payload = await response.json() as TopUpSignatureResponse;
        } catch {
            throw new Error(`Worker HTTP ${response.status}, body is not JSON.`);
        }

        console.log('[TeviPayment] proxy top-up-signature FULL:', payload);
        report(
            `Payload success=${payload.success} error_code=${payload.error_code ?? '-'}`
            + ` order_id=${payload.order_id || payload.debug?.order_id || '-'}`,
        );
        report(this.formatWorkerDebug(payload.debug));

        if (!response.ok || payload.success === false) {
            const apiMsg = typeof payload.message === 'string' ? payload.message.trim() : '';
            const errorCode = payload.error_code != null ? `${payload.error_code}` : '';
            let hint = '';
            if (errorCode === 'APP_003' || /app not found/i.test(apiMsg)) {
                hint = ` | HINT APP_003: check Worker debug.tevi_url == ${TEVI_TOP_UP_SIGNATURE_URL}`
                    + ` | JWT.app must be ${APP_ID} | Payment+Webhook ON Portal | Bearer-only (no X-API-Key)`;
            }
            throw new Error(
                `FAIL top-up-signature HTTP ${response.status}`
                + (apiMsg ? `: ${apiMsg}` : '')
                + (errorCode ? ` (code=${errorCode})` : '')
                + ` | ${this.formatWorkerDebug(payload.debug)}`
                + hint,
            );
        }

        const depositToken = this.extractDepositToken(payload);
        if (!depositToken) {
            throw new Error(
                'API did not return a valid deposit_token/signature. '
                + this.formatWorkerDebug(payload.debug),
            );
        }

        const channelId = this.extractChannelId(payload, depositToken);
        const orderId = String(
            payload.order_id
            || payload.debug?.order_id
            || '',
        ).trim();
        if (!orderId) {
            throw new Error('Worker did not return order_id — deploy Worker v1.0.11 + KV TOPUP_ORDERS.');
        }
        report(
            `4/6 deposit_token OK len=${depositToken.length}`
            + (channelId != null ? ` channel=${channelId}` : '')
            + ` order=${orderId}`,
        );
        return { depositToken, channelId, orderId };
    }

    /** Poll Worker cho đến khi webhook user_topup đánh dấu paid. */
    private async waitForWebhookPaid(
        userToken: string,
        orderId: string,
        sdkCallback: Record<string, unknown>,
        report: PaymentStatusCallback,
    ): Promise<void> {
        let lastHint = '';
        let lastStatus = '?';

        for (let attempt = 1; attempt <= TeviPaymentService.WEBHOOK_POLL_ATTEMPTS; attempt++) {
            const url = `${TEVI_TOP_UP_STATUS_URL}?order_id=${encodeURIComponent(orderId)}`;
            let response: Response;
            try {
                response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${userToken}`,
                        'Accept': 'application/json',
                    },
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : `${error}`;
                throw new Error(`Poll top-up-status failed: ${message}`);
            }

            let payload: {
                success?: boolean;
                status?: string;
                reason?: string;
                hint?: string;
                message?: string;
                stars?: number;
                exchange_id?: string;
                pending_seconds?: number;
                webhook_note?: string | null;
                sdk_callback?: Record<string, unknown> | null;
                worker_version?: string;
            } = {};
            try {
                payload = await response.json();
            } catch {
                throw new Error(`top-up-status HTTP ${response.status}, not JSON`);
            }

            lastStatus = payload.status ?? '?';
            lastHint = payload.reason || payload.hint || payload.message || '';

            report(
                `5/6 poll ${attempt}/${TeviPaymentService.WEBHOOK_POLL_ATTEMPTS}`
                + ` status=${lastStatus} wait=${payload.pending_seconds ?? '?'}s`,
            );
            if (lastHint) {
                report(`5/6 WHY: ${lastHint}`);
            }
            if (payload.webhook_note) {
                report(`5/6 webhook_note: ${payload.webhook_note}`);
            }

            if (payload.status === 'paid') {
                report(`5/6 webhook user_topup confirmed order=${orderId}`
                    + (payload.exchange_id ? ` exchange=${payload.exchange_id}` : ''));
                return;
            }

            if (payload.status === 'failed') {
                throw new Error(
                    `Giao dịch failed (order ${orderId}). ${lastHint || 'Webhook báo thất bại.'}`,
                );
            }

            if (payload.status === 'unknown') {
                throw new Error(
                    `Order ${orderId} không có trong Worker KV. `
                    + `${lastHint || 'Bind TOPUP_ORDERS và deploy Worker v1.0.12.'}`,
                );
            }

            await this.delay(TeviPaymentService.WEBHOOK_POLL_INTERVAL_MS);
        }

        const sdkSummary = this.formatSdkCallbackSummary(sdkCallback);
        throw new Error(
            `TIMEOUT 5/6 — webhook user_topup chưa paid (order ${orderId}). `
            + `Last status=${lastStatus}. ${lastHint || ''} `
            + `SDK: ${sdkSummary}. `
            + 'Nguyên nhân thường gặp: (1) Tevi chưa gửi webhook — kiểm Portal Topup + Worker Logs; '
            + '(2) TEVI_WEBHOOK_SECRET sai → webhook 401; '
            + '(3) exchange_id webhook không khớp order_id; '
            + '(4) thanh toán Tevi thất bại dù popup OK.',
        );
    }

    private formatSdkCallbackSummary(sdk: Record<string, unknown>): string {
        const call = sdk.call ?? '-';
        const code = sdk.error_code ?? '-';
        const msg = sdk.error_message ?? sdk.message ?? '';
        return `call=${call} code=${code}${msg ? ` msg=${msg}` : ''}`;
    }

    private async reportSdkCallbackToWorker(
        userToken: string,
        orderId: string,
        sdkCallback: Record<string, unknown>,
        report: PaymentStatusCallback,
    ): Promise<void> {
        report(`3/6 SDK callback: ${this.formatSdkCallbackSummary(sdkCallback)}`);
        report(`3/6 SDK raw: ${this.truncateJson(sdkCallback, 220)}`);

        try {
            const response = await fetch(TEVI_TOP_UP_SDK_REPORT_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${userToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({ order_id: orderId, sdk_callback: sdkCallback }),
            });
            const payload = await response.json().catch(() => ({})) as { hint?: string; message?: string };
            if (payload.hint) {
                report(`3/6 Worker hint: ${payload.hint}`);
            } else if (!response.ok) {
                report(`3/6 Worker sdk-report HTTP ${response.status} ${payload.message || ''}`);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : `${error}`;
            report(`3/6 Worker sdk-report skip: ${message}`);
        }
    }

    private truncateJson(obj: unknown, maxLen: number): string {
        try {
            const text = JSON.stringify(obj);
            return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
        } catch {
            return `${obj}`;
        }
    }

    /** Rút gọn debug Worker để hiện trên label + console. */
    private formatWorkerDebug(debug: TopUpSignatureResponse['debug']): string {
        if (!debug || typeof debug !== 'object') {
            return 'dbg=(none — redeploy Worker bản có debug.worker_version)';
        }
        const parts = [
            `wv=${debug.worker_version || '?'}`,
            `tevi_url=${debug.tevi_url || '?'}`,
            `tevi_http=${debug.tevi_http_status ?? '?'}`,
            `auth=${debug.auth_mode || '?'}`,
            `app=${debug.app_id || '?'}`,
            `jwt_app=${debug.jwt_app_id || '?'}`,
            `jwt_aud=${debug.jwt_aud || '?'}`,
            `user=${debug.user_id || '?'}`,
            `order=${debug.order_id || '?'}`,
            `keys=${Array.isArray(debug.request_body_keys) ? debug.request_body_keys.join(',') : '?'}`,
            `body_sent=${debug.tevi_body_sent != null ? JSON.stringify(debug.tevi_body_sent) : '?'}`,
            `tevi_raw=${typeof debug.tevi_raw === 'string' ? debug.tevi_raw.slice(0, 180) : '-'}`,
        ];
        return `dbg ${parts.join(' | ')}`;
    }

    private extractChannelId(
        payload: TopUpSignatureResponse,
        depositToken: string,
    ): string | number | undefined {
        const data = payload.data && typeof payload.data === 'object' ? payload.data : null;
        const direct = data?.channel_id ?? payload.channel_id;
        if (direct !== undefined && direct !== null && `${direct}` !== '') return direct as string | number;

        const fromJwt = this.readJwtClaim(depositToken, 'channel_id')
            || this.readJwtClaim(depositToken, 'channelId');
        return fromJwt || undefined;
    }

    /** Đọc claim thô từ JWT (không verify) để đối chiếu app_id trên label. */
    private readJwtClaim(token: string, claim: string): string {
        try {
            const parts = token.split('.');
            if (parts.length < 2) return '';
            const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
            if (typeof atob !== 'function') return '';
            const data = JSON.parse(atob(padded)) as Record<string, unknown>;
            const value = data[claim];
            return value === undefined || value === null ? '' : `${value}`.trim();
        } catch {
            return '';
        }
    }

    private extractDepositToken(payload: TopUpSignatureResponse): string {
        const data = payload.data && typeof payload.data === 'object' ? payload.data : null;
        const candidates = [
            data?.deposit_token,
            data?.signature,
            data?.token,
            data?.top_up_signature,
            payload.deposit_token,
            payload.signature,
        ];
        for (const value of candidates) {
            if (typeof value === 'string' && value.trim()) return value.trim();
        }
        return '';
    }

    private invokeTeviTopup(
        depositToken: string,
        amount: number,
        channelId: string | number | undefined,
        report: PaymentStatusCallback,
    ): Promise<Record<string, unknown>> {
        return new Promise((resolve, reject) => {
            if (typeof window === 'undefined' || !window.TeviJS?.topup) {
                reject(new Error('TeviJS.topup is unavailable. Run in the Tevi app (or use Mock).'));
                return;
            }

            try {
                report('Called TeviJS.topup — waiting for native callback...');
                const options: TeviTopupOptions = {
                    deposit_token: depositToken,
                    amount: Number(amount),
                };
                if (channelId !== undefined && channelId !== null && `${channelId}` !== '') {
                    options.channel_id = channelId;
                }

                window.TeviJS.topup(
                    options,
                    (response) => {
                        console.log('[TeviPayment] topup callback:', response);
                        const normalized = (response && typeof response === 'object')
                            ? response as Record<string, unknown>
                            : { raw: response };
                        const code = response?.error_code;
                        const callOk = `${(response as any)?.call || ''}` === 'ok';
                        const hasError = code !== undefined && code !== null && `${code}` !== '' && `${code}` !== '0';
                        if (hasError && !callOk) {
                            reject(new Error(
                                `TeviJS.topup error code=${code}`
                                + (response.error_message ? `: ${response.error_message}` : '')
                                + (response.message ? ` (${response.message})` : ''),
                            ));
                            return;
                        }
                        report(`TeviJS.topup callback OK (code=${code ?? 0}, call=${(response as any)?.call ?? '-'})`);
                        resolve(normalized);
                    },
                );
            } catch (error) {
                reject(error instanceof Error ? error : new Error(`${error}`));
            }
        });
    }
}
