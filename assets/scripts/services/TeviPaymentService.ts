import { TeviLoginManager } from '../TeviLoginManager';
import {
    STAR_TOPUP_PACKS,
    StarTopUpPack,
    TEVI_TOP_UP_SIGNATURE_URL,
} from '../TeviConstants';
import { StarWallet } from './StarWallet';

export type PaymentStatusCallback = (message: string) => void;

interface TopUpSignatureResponse {
    success?: boolean;
    message?: string;
    error_code?: string | number | null;
    data?: {
        deposit_token?: string;
        signature?: string;
        token?: string;
        top_up_signature?: string;
        [key: string]: unknown;
    } | null;
    deposit_token?: string;
    signature?: string;
    [key: string]: unknown;
}

/**
 * Nạp Star qua Tevi:
 * 1) POST /payments/top-up-signature (Bearer user_app_token)
 * 2) TeviJS.topup({ deposit_token, amount })
 * 3) Cộng Star local khi callback thành công
 */
export class TeviPaymentService {
    private static _instance: TeviPaymentService | null = null;
    private _busy = false;

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
        onStatus?: PaymentStatusCallback,
    ): Promise<{ ok: boolean; message: string; balance: number }> {
        const report = (msg: string) => {
            onStatus?.(msg);
            console.log('[TeviPayment]', msg);
        };

        if (this._busy) {
            const message = 'Đang xử lý giao dịch trước đó...';
            report(message);
            return { ok: false, message, balance: StarWallet.getInstance().getBalance() };
        }

        const pack = this.getPackById(packId);
        if (!pack) {
            const message = `Không tìm thấy gói ${packId}`;
            report(message);
            return { ok: false, message, balance: StarWallet.getInstance().getBalance() };
        }

        this._busy = true;
        try {
            const userToken = TeviLoginManager.Instance?.getUserToken().trim() || '';
            report(`1/4 Kiểm tra token... ${userToken ? `OK (${userToken.length} chars)` : 'MISSING'}`);
            if (!userToken) {
                const message = 'Chưa có user_app_token. Mở game trong Tevi và đăng nhập trước.';
                report(message);
                return { ok: false, message, balance: StarWallet.getInstance().getBalance() };
            }

            report(`2/4 GỬI API top-up-signature amount=${pack.amount} ... đang chờ response`);
            const depositToken = await this.requestTopUpSignature(userToken, pack.amount, report);

            report(`3/4 Gọi TeviJS.topup(deposit_token, amount=${pack.amount}) ... đang chờ callback`);
            await this.invokeTeviTopup(depositToken, pack.amount, report);

            const balance = StarWallet.getInstance().addStars(pack.stars, `topup:${pack.id}`);
            const message = `4/4 NHẬN OK → +${pack.stars}★ | Tổng ★ ${balance}`;
            report(message);
            return { ok: true, message, balance };
        } catch (error) {
            const message = error instanceof Error ? error.message : `${error}`;
            report(`LỖI nạp: ${message}`);
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
        onStatus?: PaymentStatusCallback,
    ): Promise<{ ok: boolean; message: string; balance: number }> {
        const report = (msg: string) => {
            onStatus?.(msg);
            console.log('[TeviPayment][Mock]', msg);
        };

        const pack = this.getPackById(packId);
        if (!pack) {
            const message = `Không tìm thấy gói ${packId}`;
            report(message);
            return { ok: false, message, balance: StarWallet.getInstance().getBalance() };
        }

        report(`[Mock] 1/4 Chuẩn bị gói ${pack.label}`);
        await this.delay(250);

        report(`[Mock] 2/4 GỬI fake top-up-signature { amount: ${pack.amount} } ... chờ`);
        await this.delay(450);

        report(`[Mock] 3/4 NHẬN fake deposit_token=mock-token-${pack.id} | giả lập TeviJS.topup`);
        await this.delay(350);

        const balance = StarWallet.getInstance().addStars(pack.stars, `mock:${pack.id}`);
        const message = `[Mock] 4/4 NHẬN OK → +${pack.stars}★ | Tổng ★ ${balance} (không gọi Tevi thật)`;
        report(message);
        return { ok: true, message, balance };
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async requestTopUpSignature(
        userToken: string,
        amount: number,
        report: PaymentStatusCallback,
    ): Promise<string> {
        const body = { amount };
        report(`POST ${TEVI_TOP_UP_SIGNATURE_URL}`);
        report(`Body ${JSON.stringify(body)} | Auth Bearer ${userToken.slice(0, 10)}...`);

        let response: Response;
        try {
            response = await fetch(TEVI_TOP_UP_SIGNATURE_URL, {
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
            throw new Error(`Gọi top-up-signature thất bại: ${message}`);
        }

        report(`Đã nhận HTTP ${response.status} từ top-up-signature, đang parse JSON...`);

        let payload: TopUpSignatureResponse = {};
        try {
            payload = await response.json() as TopUpSignatureResponse;
        } catch {
            throw new Error(`top-up-signature HTTP ${response.status}, body không phải JSON.`);
        }

        console.log('[TeviPayment] top-up-signature payload:', payload);
        report(`Payload success=${payload.success} error_code=${payload.error_code ?? '-'}`);

        if (!response.ok || payload.success === false) {
            const apiMsg = typeof payload.message === 'string' ? payload.message.trim() : '';
            throw new Error(
                `top-up-signature HTTP ${response.status}`
                + (apiMsg ? `: ${apiMsg}` : '')
                + (payload.error_code != null ? ` (code=${payload.error_code})` : '')
                + (response.status === 401
                    ? ' — token Tevi không hợp lệ/hết hạn. Editor hãy dùng nút Mock.'
                    : ''),
            );
        }

        const depositToken = this.extractDepositToken(payload);
        if (!depositToken) {
            throw new Error('API không trả deposit_token/signature hợp lệ.');
        }
        report(`Nhận deposit_token OK (${depositToken.slice(0, 12)}... len=${depositToken.length})`);
        return depositToken;
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
        report: PaymentStatusCallback,
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            if (typeof window === 'undefined' || !window.TeviJS?.topup) {
                reject(new Error('Không có TeviJS.topup. Hãy chạy trong app Tevi (hoặc dùng Mock).'));
                return;
            }

            try {
                report('Đã gọi TeviJS.topup — đang chờ native callback...');
                window.TeviJS.topup(
                    { deposit_token: depositToken, amount },
                    (response) => {
                        console.log('[TeviPayment] topup callback:', response);
                        const code = response?.error_code;
                        const hasError = code !== undefined && code !== null && `${code}` !== '' && `${code}` !== '0';
                        if (hasError) {
                            reject(new Error(
                                `TeviJS.topup lỗi code=${code}`
                                + (response.error_message ? `: ${response.error_message}` : '')
                                + (response.message ? ` (${response.message})` : ''),
                            ));
                            return;
                        }
                        report(`TeviJS.topup callback OK (code=${code ?? 0})`);
                        resolve();
                    },
                );
            } catch (error) {
                reject(error instanceof Error ? error : new Error(`${error}`));
            }
        });
    }
}
