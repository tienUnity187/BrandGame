import { TeviLoginManager } from '../TeviLoginManager';
import {
    APP_ID,
    ENV,
    STAR_TOPUP_PACKS,
    StarTopUpPack,
    TEVI_API_BASE,
    TEVI_TOP_UP_CLAIM_URL,
    TEVI_TOP_UP_SIGNATURE_PROXY_URL,
    TEVI_TOP_UP_SIGNATURE_URL,
    TEVI_TOP_UP_STATUS_URL,
    TEVI_TOP_UP_SDK_REPORT_URL,
    TEVI_TOP_UP_UNCLAIMED_URL,
    TEVI_USER_BALANCE_URL,
    VERSION,
} from '../TeviConstants';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../enums/GameEvent';
import { StarWallet } from './StarWallet';
import { TopUpPendingStore } from './TopUpPendingStore';
import { StarWalletHud } from '../ui/StarWalletHud';

export type PaymentStatusCallback = (message: string) => void;

/** Callback UI theo từng giai đoạn nạp (Tevi popup, chờ webhook, thành công). */
export interface PurchasePackOptions {
    onStatus?: PaymentStatusCallback;
    /** Trước khi gọi TeviJS.topup — hiện màn hình chờ. */
    onTeviDialog?: () => void;
    /** Sau khi Tevi popup trả callback (ok hoặc hủy/lỗi). */
    onTeviDialogClosed?: (ok: boolean) => void;
    /** Tevi xác nhận xong — cộng sao ngay. */
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
 * 4) TeviJS.topup call=ok = Tevi đã trừ Star — cộng ★ ngay (không chờ KV/webhook ~60s)
 * 5) Báo Worker sdk-report để mark paid cùng colo user; webhook chỉ là backup claim
 */
export class TeviPaymentService {
    private static _instance: TeviPaymentService | null = null;
    private _busy = false;
    private _claimRunning = false;

    /** Xác nhận nhanh sau SDK OK — Worker cùng colo sẽ mark paid ngay. */
    private static readonly FAST_CONFIRM_ATTEMPTS = 4;
    private static readonly FAST_CONFIRM_INTERVAL_MS = 250;
    /** Retry claim khi tắt app giữa chừng — webhook có thể tới sau khi mở lại. */
    private static readonly CLAIM_RETRY_INTERVAL_MS = 15000;
    private static readonly CLAIM_RETRY_MAX = 20;

    private _claimRetryCount = 0;
    private _claimRetryScheduled = false;

    public static getInstance(): TeviPaymentService {
        if (!TeviPaymentService._instance) {
            TeviPaymentService._instance = new TeviPaymentService();
        }
        return TeviPaymentService._instance;
    }

    /** Editor/test: trần thời gian xác nhận sau SDK — phải << 60s KV lag. */
    public static getPostSdkConfirmBudgetMs(): number {
        return TeviPaymentService.FAST_CONFIRM_ATTEMPTS
            * TeviPaymentService.FAST_CONFIRM_INTERVAL_MS;
    }

    public getPacks(): readonly StarTopUpPack[] {
        return STAR_TOPUP_PACKS;
    }

    public isBusy(): boolean {
        return this._busy;
    }

    /**
     * Mở lại game sau khi tắt giữa chừng — quét order paid chưa cộng ★.
     * Gọi sau khi có user_app_token (login xong).
     */
    public async claimPendingTopUps(): Promise<{
        claimed: Array<{ orderId: string; stars: number }>;
        totalStars: number;
        balance: number;
        pendingCount: number;
        unclaimedFetchOk: boolean;
    }> {
        const store = TopUpPendingStore.getInstance();
        store.discardUnconfirmedLeftovers();
        const pendingCount = store.getPending().filter(p => p.confirmed && !store.isCredited(p.orderId)).length
            + (store.getLastTopUpOrder()?.confirmed && !store.isCredited(store.getLastTopUpOrder()!.orderId) ? 1 : 0);

        const login = TeviLoginManager.Instance;
        let userToken = login?.getUserToken()?.trim() || '';
        const hasConfirmedPending = pendingCount > 0;
        if (login && hasConfirmedPending) {
            try {
                userToken = await login.refreshLoginForPayment();
                StarWalletHud.logStatus('Claim: token refreshed for claim');
            } catch (refreshError) {
                userToken = login.getUserToken()?.trim() || '';
                const refreshMsg = refreshError instanceof Error ? refreshError.message : `${refreshError}`;
                if (userToken) {
                    StarWalletHud.logStatus(`Claim: using cached token (${refreshMsg})`);
                }
            }
        }
        if (!userToken) {
            if (hasConfirmedPending) {
                StarWalletHud.logStatus('Claim: waiting for login (no token yet)...');
                this.scheduleClaimRetryIfNeeded(pendingCount);
            }
            return {
                claimed: [],
                totalStars: 0,
                balance: StarWallet.getInstance().getBalance(),
                pendingCount,
                unclaimedFetchOk: false,
            };
        }
        if (this._busy || this._claimRunning) {
            return {
                claimed: [],
                totalStars: 0,
                balance: StarWallet.getInstance().getBalance(),
                pendingCount,
                unclaimedFetchOk: false,
            };
        }

        if (hasConfirmedPending) {
            StarWalletHud.logStatus(
                `Claim: start pending=${pendingCount} url=${TEVI_TOP_UP_UNCLAIMED_URL}`,
            );
        }

        this._claimRunning = true;
        try {
            const result = await this.runClaimPendingTopUps(userToken);
            if (result.totalStars > 0) {
                StarWalletHud.logStatus(
                    `Claim OK +${result.totalStars} balance=${result.balance}`,
                );
            } else if (result.pendingCount > 0) {
                StarWalletHud.logStatus(
                    `Claim: ${result.pendingCount} order(s) — webhook not paid yet, retrying...`,
                );
            } else if (!result.unclaimedFetchOk && hasConfirmedPending) {
                StarWalletHud.logStatus(
                    'Claim: Worker unclaimed API failed — deploy Worker v1.0.13?',
                );
            } else if (hasConfirmedPending) {
                StarWalletHud.logStatus('Claim: nothing to receive');
            }
            console.log('[TeviPayment] claimPendingTopUps done', result);
            if (result.totalStars > 0) {
                this._claimRetryCount = 0;
            } else {
                this.scheduleClaimRetryIfNeeded(result.pendingCount, !result.unclaimedFetchOk && hasConfirmedPending);
            }
            return result;
        } finally {
            this._claimRunning = false;
        }
    }

    private scheduleClaimRetryIfNeeded(pendingCount: number, forceRetry: boolean = false): void {
        if (!forceRetry && pendingCount <= 0 && !TopUpPendingStore.getInstance().hasUncreditedWork()) return;
        if (this._claimRetryCount >= TeviPaymentService.CLAIM_RETRY_MAX) {
            StarWalletHud.logStatus(
                'Claim: timeout — check KV order paid + Worker v1.0.13',
            );
            console.warn('[TeviPayment] claim retry exhausted');
            return;
        }
        if (this._claimRetryScheduled) return;
        this._claimRetryScheduled = true;
        this._claimRetryCount++;
        const delaySec = TeviPaymentService.CLAIM_RETRY_INTERVAL_MS / 1000;
        StarWalletHud.logStatus(
            `Claim: retry ${this._claimRetryCount}/${TeviPaymentService.CLAIM_RETRY_MAX} in ${delaySec}s`,
        );
        setTimeout(() => {
            this._claimRetryScheduled = false;
            EventBus.getInstance().emit(GameEvent.REQUEST_CLAIM_PENDING_TOPUPS);
        }, TeviPaymentService.CLAIM_RETRY_INTERVAL_MS);
    }

    private hasUncreditedPending(): boolean {
        return TopUpPendingStore.getInstance().hasUncreditedWork();
    }

    private async runClaimPendingTopUps(userToken: string): Promise<{
        claimed: Array<{ orderId: string; stars: number }>;
        totalStars: number;
        balance: number;
        pendingCount: number;
        unclaimedFetchOk: boolean;
    }> {
        const store = TopUpPendingStore.getInstance();
        const candidates = new Map<string, number>();
        /** Order Worker đã xác nhận paid qua /unclaimed — không cần poll lại. */
        const paidFromWorker = new Map<string, number>();

        for (const pending of store.getPending()) {
            if (pending.confirmed && !store.isCredited(pending.orderId)) {
                candidates.set(pending.orderId, pending.stars);
            }
        }

        const lastOrder = store.getLastTopUpOrder();
        if (lastOrder?.confirmed && !store.isCredited(lastOrder.orderId)) {
            candidates.set(lastOrder.orderId, lastOrder.stars);
            StarWalletHud.logStatus(`Claim: backup last order=${lastOrder.orderId}`);
        }

        let unclaimedFetchOk = false;
        try {
            const unclaimed = await this.fetchUnclaimedOrders(userToken);
            unclaimedFetchOk = true;
            if (unclaimed.length > 0 || store.hasConfirmedUncreditedPurchase()) {
                StarWalletHud.logStatus(
                    `Claim: Worker unclaimed=${unclaimed.length} order(s)`,
                );
            }
            console.log('[TeviPayment] unclaimed orders from Worker:', unclaimed);
            for (const order of unclaimed) {
                if (!order.order_id || store.isCredited(order.order_id)) continue;
                const stars = Math.max(0, Math.floor(Number(order.stars) || 0));
                candidates.set(order.order_id, stars);
                paidFromWorker.set(order.order_id, stars);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : `${error}`;
            StarWalletHud.logStatus(`Claim: unclaimed API error — ${message}`);
            console.warn('[TeviPayment] top-up-unclaimed failed:', message);
        }

        if (candidates.size === 0) {
            const pendingCount = store.hasUncreditedWork() ? 1 : 0;
            return {
                claimed: [],
                totalStars: 0,
                balance: StarWallet.getInstance().getBalance(),
                pendingCount,
                unclaimedFetchOk,
            };
        }

        StarWalletHud.logStatus(`Claim: processing ${candidates.size} order(s)...`);
        console.log('[TeviPayment] claim candidates:', [...candidates.keys()]);

        const claimed: Array<{ orderId: string; stars: number }> = [];
        let totalStars = 0;

        for (const [orderId, fallbackStars] of candidates) {
            if (store.isCredited(orderId)) continue;

            let stars = fallbackStars;

            // Worker /unclaimed chỉ trả paid — tin tưởng trực tiếp, tránh poll 401 khi mở app lạnh.
            if (paidFromWorker.has(orderId)) {
                stars = Math.max(stars, paidFromWorker.get(orderId) || 0);
                StarWalletHud.logStatus(
                    `Claim: Worker paid ${orderId} → +${stars} (no re-poll)`,
                );
            } else {
                try {
                    const statusPayload = await this.fetchTopUpStatus(userToken, orderId);
                    StarWalletHud.logStatus(
                        `Claim poll ${orderId} → status=${statusPayload.status ?? '?'}`,
                    );
                    if (statusPayload.status !== 'paid') continue;
                    stars = Math.max(
                        stars,
                        Math.floor(Number(statusPayload.stars) || 0),
                    );
                } catch (error) {
                    const message = error instanceof Error ? error.message : `${error}`;
                    StarWalletHud.logStatus(`Claim skip ${orderId}: ${message}`);
                    console.warn(`[TeviPayment] claim skip ${orderId}:`, error);
                    continue;
                }
            }

            if (stars <= 0) continue;

            const balance = this.creditPaidOrder(orderId, stars, `topup:claim:${orderId}`);
            claimed.push({ orderId, stars });
            totalStars += stars;
            void this.notifyWorkerClaim(userToken, orderId);
            StarWalletHud.logStatus(`Claim credited +${stars} order=${orderId}`);
            console.log(`[TeviPayment] Claimed pending top-up ${orderId} → +${stars} (balance ${balance})`);
        }

        if (totalStars > 0) {
            const balance = StarWallet.getInstance().getBalance();
            StarWalletHud.notifyTopUpClaimSuccess(totalStars, balance);
            EventBus.getInstance().emit(
                GameEvent.PENDING_TOPUP_CLAIMED,
                totalStars,
                balance,
                claimed.map(item => item.orderId),
            );
        }

        const pendingCount = store.hasUncreditedWork() ? 1 : 0;

        return {
            claimed,
            totalStars,
            balance: StarWallet.getInstance().getBalance(),
            pendingCount,
            unclaimedFetchOk,
        };
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

            report(`1/6 Checking Tevi wallet (${TEVI_USER_BALANCE_URL})...`);
            const teviBalance = await this.fetchTeviWalletBalance(userToken, report);
            report(`1/6 Tevi wallet balance=${teviBalance} need=${pack.amount}`);
            if (teviBalance < pack.amount) {
                throw new Error(
                    `Not enough coins.\n`
                    + `Your wallet: ${teviBalance}\n`
                    + `This pack needs: ${pack.amount}\n\n`
                    + `Top up your Tevi wallet first, then try again.`,
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
            TopUpPendingStore.getInstance().addPending({
                orderId,
                packId: pack.id,
                stars: pack.stars,
                createdAt: Date.now(),
                confirmed: true,
            });
            const sdkReportedPaid = await this.reportSdkCallbackToWorker(
                userToken,
                orderId,
                sdkCallback,
                report,
            );

            report(`4/6 TeviJS.topup OK — crediting now (no KV webhook wait)`);
            lifecycle.onAwaitingStars?.();
            const confirmed = sdkReportedPaid
                || await this.confirmPaidFast(userToken, orderId, report);
            if (!confirmed) {
                report('5/6 Worker status still pending — credit from SDK (Tevi already charged)');
            }

            const balance = this.creditPaidOrder(
                orderId,
                pack.stars,
                `topup:${pack.id}:${orderId}`,
            );
            void this.notifyWorkerClaim(userToken, orderId);
            const message = `6/6 SUCCESS → +${pack.stars} | Total ${balance} | order=${orderId}`
                + (confirmed ? ' | worker=paid' : ' | worker=sdk');
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
     * Nạp giả lập Editor — cùng logic mới: SDK OK → cộng ngay, không poll webhook 90s.
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

        const started = Date.now();
        const budgetMs = TeviPaymentService.getPostSdkConfirmBudgetMs();
        report(`[Mock] 1/6 Editor flow=credit-on-sdk-ok confirmBudget=${budgetMs}ms (old poll=90000ms)`);
        await this.delay(120);

        report(`[Mock] 2/6 fake top-up-signature amount=${pack.amount} stars=${pack.stars}`);
        await this.delay(160);

        report(`[Mock] 3/6 TeviJS.topup callback OK (call=ok)`);
        lifecycle.onTeviDialog?.();
        await this.delay(180);
        lifecycle.onTeviDialogClosed?.(true);

        report(`[Mock] 4/6 TeviJS.topup OK — crediting now (no KV webhook wait)`);
        lifecycle.onAwaitingStars?.();
        await this.delay(80);

        const orderId = `mock-${pack.id}-${Date.now()}`;
        const balance = this.creditPaidOrder(orderId, pack.stars, `mock:${pack.id}:${orderId}`);
        const elapsed = Date.now() - started;
        const message =
            `[Mock] 6/6 SUCCESS → +${pack.stars} | Total ${balance}`
            + ` | elapsed=${elapsed}ms | must be << 60000`;
        report(message);
        lifecycle.onSuccess?.(pack.stars, balance);
        return { ok: true, message, balance };
    }

    /**
     * Editor/unit test: cộng sao như sau TeviJS.topup OK — không gọi Worker/webhook.
     */
    public debugCreditOnSdkOk(packId: string): {
        ok: boolean;
        stars: number;
        balance: number;
        confirmBudgetMs: number;
        orderId: string;
    } {
        const pack = this.getPackById(packId);
        const confirmBudgetMs = TeviPaymentService.getPostSdkConfirmBudgetMs();
        if (!pack) {
            return {
                ok: false,
                stars: 0,
                balance: StarWallet.getInstance().getBalance(),
                confirmBudgetMs,
                orderId: '',
            };
        }
        const orderId = `editor-sdk-${pack.id}-${Date.now()}`;
        const balance = this.creditPaidOrder(orderId, pack.stars, `editor-sdk:${pack.id}`);
        return { ok: true, stars: pack.stars, balance, confirmBudgetMs, orderId };
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

    /** GET Tevi user balance — trả về số Star trong ví Tevi (không phải ví game). */
    private async fetchTeviWalletBalance(
        userToken: string,
        report?: PaymentStatusCallback,
    ): Promise<number> {
        let response: Response;
        try {
            response = await fetch(TEVI_USER_BALANCE_URL, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${userToken}`,
                    'Accept': 'application/json',
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : `${error}`;
            throw new Error(`Cannot check Tevi wallet balance: ${message}`);
        }

        let payload: {
            success?: boolean;
            message?: string;
            error_code?: string | number | null;
            data?: { amount?: number; currency?: string } | null;
            amount?: number;
        } = {};
        try {
            payload = await response.json();
        } catch {
            throw new Error(`Tevi balance HTTP ${response.status}, body is not JSON.`);
        }

        if (!response.ok || payload.success === false) {
            const apiMsg = typeof payload.message === 'string' ? payload.message.trim() : '';
            const errorCode = payload.error_code != null ? `${payload.error_code}` : '';
            throw new Error(
                `Tevi balance HTTP ${response.status}`
                + (apiMsg ? `: ${apiMsg}` : '')
                + (errorCode ? ` (code=${errorCode})` : ''),
            );
        }

        const rawAmount = payload.data?.amount ?? payload.amount ?? 0;
        const balance = Math.max(0, Math.floor(Number(rawAmount) || 0));
        report?.(`Tevi wallet: ${balance} coins`);
        return balance;
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
            if (/origin not allowed/i.test(apiMsg)) {
                hint = ' | HINT: Cloudflare Worker → fancy-sun-962d → Variables'
                    + ' → ALLOWED_ORIGIN=https://velvetnight.pages.dev (no trailing slash) → Deploy';
            } else if (errorCode === 'APP_003' || /app not found/i.test(apiMsg)) {
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

    /**
     * Sau SDK OK: poll ngắn để lấy Worker paid (sdk-report cùng colo).
     * Không timeout — Tevi đã trừ Star, game vẫn cộng nếu Worker chưa kịp.
     */
    private async confirmPaidFast(
        userToken: string,
        orderId: string,
        report: PaymentStatusCallback,
    ): Promise<boolean> {
        for (let attempt = 1; attempt <= TeviPaymentService.FAST_CONFIRM_ATTEMPTS; attempt++) {
            try {
                const payload = await this.fetchTopUpStatus(userToken, orderId);
                const status = payload.status ?? '?';
                report(
                    `5/6 confirm ${attempt}/${TeviPaymentService.FAST_CONFIRM_ATTEMPTS} status=${status}`,
                );
                if (status === 'paid') return true;
                if (status === 'failed') {
                    TopUpPendingStore.getInstance().removePending(orderId);
                    throw new Error(`Giao dịch failed (order ${orderId}).`);
                }
            } catch (error) {
                if (error instanceof Error && /failed \(order/i.test(error.message)) {
                    throw error;
                }
                const message = error instanceof Error ? error.message : `${error}`;
                report(`5/6 confirm skip: ${message}`);
            }
            if (attempt < TeviPaymentService.FAST_CONFIRM_ATTEMPTS) {
                await this.delay(TeviPaymentService.FAST_CONFIRM_INTERVAL_MS);
            }
        }
        return false;
    }

    private creditPaidOrder(orderId: string, stars: number, reason: string): number {
        const store = TopUpPendingStore.getInstance();
        if (store.isCredited(orderId)) {
            return StarWallet.getInstance().getBalance();
        }
        const balance = StarWallet.getInstance().addStars(stars, reason);
        store.markCredited(orderId);
        return balance;
    }

    private async fetchTopUpStatus(
        userToken: string,
        orderId: string,
    ): Promise<{ status?: string; stars?: number }> {
        const url = `${TEVI_TOP_UP_STATUS_URL}?order_id=${encodeURIComponent(orderId)}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${userToken}`,
                'Accept': 'application/json',
            },
        });
        let payload: { status?: string; stars?: number; message?: string } = {};
        try {
            payload = await response.json();
        } catch {
            throw new Error(`top-up-status HTTP ${response.status}, not JSON`);
        }
        if (!response.ok && response.status !== 401) {
            throw new Error(payload.message || `top-up-status HTTP ${response.status}`);
        }
        return payload;
    }

    private async fetchUnclaimedOrders(userToken: string): Promise<Array<{
        order_id: string;
        stars?: number;
    }>> {
        const response = await fetch(TEVI_TOP_UP_UNCLAIMED_URL, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${userToken}`,
                'Accept': 'application/json',
            },
        });
        let payload: { success?: boolean; orders?: Array<{ order_id: string; stars?: number }> } = {};
        try {
            payload = await response.json();
        } catch {
            throw new Error(`top-up-unclaimed HTTP ${response.status}, not JSON`);
        }
        if (!response.ok) {
            throw new Error(
                `top-up-unclaimed HTTP ${response.status}`
                + (response.status === 404 ? ' — deploy Worker v1.0.13' : ''),
            );
        }
        return Array.isArray(payload.orders) ? payload.orders : [];
    }

    private async notifyWorkerClaim(userToken: string, orderId: string): Promise<void> {
        try {
            await fetch(TEVI_TOP_UP_CLAIM_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${userToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({ order_id: orderId }),
            });
        } catch (error) {
            console.warn(`[TeviPayment] Worker claim notify failed (${orderId}):`, error);
        }
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
    ): Promise<boolean> {
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
            const payload = await response.json().catch(() => ({})) as {
                hint?: string;
                message?: string;
                status?: string;
                paid_via?: string;
            };
            if (payload.hint) {
                report(`3/6 Worker hint: ${payload.hint}`);
            } else if (!response.ok) {
                report(`3/6 Worker sdk-report HTTP ${response.status} ${payload.message || ''}`);
            }
            if (payload.status === 'paid') {
                report(`3/6 Worker marked paid via ${payload.paid_via || 'sdk'}`);
                return true;
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : `${error}`;
            report(`3/6 Worker sdk-report skip: ${message}`);
        }
        return false;
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
