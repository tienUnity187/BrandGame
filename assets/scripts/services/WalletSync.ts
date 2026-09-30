import { sys } from 'cc';
import { STORAGE_KEYS, TEVI_WALLET_URL } from '../TeviConstants';

function readToken(): string {
    try {
        return sys.localStorage.getItem(STORAGE_KEYS.USER_TOKEN)?.trim() || '';
    } catch {
        return '';
    }
}

function authHeaders(): Record<string, string> {
    return {
        Authorization: `Bearer ${readToken()}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
    };
}

/** Ghi số dư tuyệt đối. allowDecrease chỉ khi người chơi vừa tiêu coin. */
export async function pushWalletBalance(
    balance: number,
    allowDecrease: boolean = false,
    knownOrderIds: string[] = [],
): Promise<boolean> {
    const token = readToken();
    if (!token) return false;
    try {
        const response = await fetch(TEVI_WALLET_URL, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                op: 'set',
                balance: Math.max(0, Math.floor(balance)),
                allowDecrease,
                knownOrderIds,
            }),
        });
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Cộng coin của một order. Worker bỏ qua nếu order đã cộng.
 * Trả số dư server, hoặc null nếu không gửi được.
 */
export async function pushWalletCredit(
    orderId: string,
    stars: number,
    balance: number,
): Promise<{ balance: number; already: boolean } | null> {
    const token = readToken();
    if (!token || !orderId || stars <= 0) return null;
    try {
        const response = await fetch(TEVI_WALLET_URL, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                op: 'credit',
                orderId,
                stars: Math.floor(stars),
                balance: Math.max(0, Math.floor(balance)),
            }),
        });
        if (!response.ok) return null;
        const payload = await response.json() as { balance?: number; already?: boolean };
        return {
            balance: Math.max(0, Math.floor(Number(payload.balance) || 0)),
            already: payload.already === true,
        };
    } catch {
        return null;
    }
}

export type WalletPullResult =
    | { status: 'ok'; balance: number }
    | { status: 'missing' }
    | { status: 'unavailable' };

/** missing = user chưa có ví. unavailable = lỗi mạng, không được ghi đè server. */
export async function pullWalletBalance(): Promise<WalletPullResult> {
    const token = readToken();
    if (!token) return { status: 'unavailable' };
    try {
        const response = await fetch(TEVI_WALLET_URL, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
            },
        });
        if (!response.ok) return { status: 'unavailable' };
        const payload = await response.json() as { exists?: boolean; balance?: number };
        if (payload.exists !== true) return { status: 'missing' };
        return {
            status: 'ok',
            balance: Math.max(0, Math.floor(Number(payload.balance) || 0)),
        };
    } catch {
        return { status: 'unavailable' };
    }
}
