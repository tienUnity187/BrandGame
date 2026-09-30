import { sys } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../enums/GameEvent';
import { ENABLE_DEBUG_LOGS, STORAGE_KEYS } from '../TeviConstants';
import { pushWalletBalance } from './WalletSync';

/**
 * Ví Star. Máy giữ bản nhanh; Worker giữ bản theo user (không hết hạn).
 */
export class StarWallet {
    private static _instance: StarWallet | null = null;
    /** Chỉ đẩy số dư tuyệt đối sau khi đã kéo ví từ Worker, tránh ghi đè coin đã nạp. */
    private _canPush = false;

    public static getInstance(): StarWallet {
        if (!StarWallet._instance) {
            StarWallet._instance = new StarWallet();
        }
        return StarWallet._instance;
    }

    /** Có số đã ghi máy hay chưa. Trống thì chưa được tự ghi 20 coin. */
    public hasStoredBalance(): boolean {
        try {
            const raw = sys.localStorage.getItem(STORAGE_KEYS.STAR_BALANCE);
            return raw !== null && raw !== '';
        } catch {
            return false;
        }
    }

    public getBalance(): number {
        try {
            const raw = sys.localStorage.getItem(STORAGE_KEYS.STAR_BALANCE);
            if (raw === null || raw === '') return 0;
            const value = parseInt(raw, 10);
            return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
        } catch {
            return 0;
        }
    }

    public markRemoteReady(): void {
        this._canPush = true;
    }

    /** Ghi số dư lấy từ Worker. Không đẩy ngược lên server. */
    public replaceBalance(value: number): void {
        const next = Math.max(0, Math.floor(value));
        this.writeBalance(next);
        EventBus.getInstance().emit(GameEvent.STAR_BALANCE_CHANGED, next, 0);
    }

    public addStars(amount: number, reason: string = '', pushRemote: boolean = true): number {
        const add = Math.max(0, Math.floor(amount));
        if (add <= 0) return this.getBalance();
        const next = this.getBalance() + add;
        this.saveBalance(next, pushRemote);
        if (ENABLE_DEBUG_LOGS) {
            console.log(`[StarWallet] +${add} (${reason || 'add'}) → ${next}`);
        }
        EventBus.getInstance().emit(GameEvent.STAR_BALANCE_CHANGED, next, add);
        return next;
    }

    public trySpend(amount: number, reason: string = ''): boolean {
        const cost = Math.max(0, Math.floor(amount));
        if (cost <= 0) return true;
        const balance = this.getBalance();
        if (balance < cost) return false;
        const next = balance - cost;
        this.saveBalance(next, true, true);
        if (ENABLE_DEBUG_LOGS) {
            console.log(`[StarWallet] -${cost} (${reason || 'spend'}) → ${next}`);
        }
        EventBus.getInstance().emit(GameEvent.STAR_BALANCE_CHANGED, next, -cost);
        return true;
    }

    public canAfford(amount: number): boolean {
        return this.getBalance() >= Math.max(0, Math.floor(amount));
    }

    private saveBalance(value: number, pushRemote: boolean = true, allowDecrease: boolean = false): void {
        const next = this.writeBalance(value);
        if (pushRemote && this._canPush) pushWalletBalance(next, allowDecrease);
    }

    private writeBalance(value: number): number {
        const next = Math.max(0, Math.floor(value));
        try {
            sys.localStorage.setItem(STORAGE_KEYS.STAR_BALANCE, `${next}`);
        } catch (error) {
            console.warn('[StarWallet] Không lưu được số Star:', error);
        }
        return next;
    }
}
