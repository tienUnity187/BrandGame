import { sys } from 'cc';
import { STORAGE_KEYS } from '../TeviConstants';

/** Order đang chờ webhook / chưa cộng ★ local (user có thể tắt app giữa chừng). */
export interface PendingTopUpRecord {
    orderId: string;
    packId: string;
    stars: number;
    createdAt: number;
    /** Chỉ true sau khi TeviJS.topup callback OK — chưa confirm thì không hiện banner chờ. */
    confirmed: boolean;
}

export interface LastTopUpOrderRecord {
    orderId: string;
    packId: string;
    stars: number;
    createdAt: number;
    confirmed: boolean;
}

/**
 * localStorage: pending orders + order_id đã cộng ★ (tránh double-credit khi claim lại).
 */
export class TopUpPendingStore {
    private static _instance: TopUpPendingStore | null = null;

    public static getInstance(): TopUpPendingStore {
        if (!TopUpPendingStore._instance) {
            TopUpPendingStore._instance = new TopUpPendingStore();
        }
        return TopUpPendingStore._instance;
    }

    public addPending(record: PendingTopUpRecord): void {
        const orderId = record.orderId.trim();
        if (!orderId) return;
        const entry: PendingTopUpRecord = {
            orderId,
            packId: record.packId,
            stars: Math.max(0, Math.floor(record.stars)),
            createdAt: record.createdAt || Date.now(),
            confirmed: !!record.confirmed,
        };
        const list = this.getPending().filter(item => item.orderId !== orderId);
        list.push(entry);
        this.savePending(list);
        this.saveLastTopUpOrder(entry);
    }

    public removePending(orderId: string): void {
        const id = orderId.trim();
        if (!id) return;
        this.savePending(this.getPending().filter(item => item.orderId !== id));
    }

    public getLastTopUpOrder(): LastTopUpOrderRecord | null {
        try {
            const raw = sys.localStorage.getItem(STORAGE_KEYS.LAST_TOPUP_ORDER);
            if (!raw) return null;
            const item = JSON.parse(raw);
            const orderId = `${item?.orderId || ''}`.trim();
            if (!orderId) return null;
            return {
                orderId,
                packId: `${item?.packId || ''}`.trim(),
                stars: Math.max(0, Math.floor(Number(item?.stars) || 0)),
                createdAt: Number(item?.createdAt) || 0,
                confirmed: item?.confirmed === true,
            };
        } catch {
            return null;
        }
    }

    public clearLastTopUpOrder(orderId: string): void {
        const last = this.getLastTopUpOrder();
        if (last?.orderId === orderId.trim()) {
            try {
                sys.localStorage.removeItem(STORAGE_KEYS.LAST_TOPUP_ORDER);
            } catch {
                // ignore
            }
        }
    }

    /** Còn order Tevi đã xác nhận mua, sao chưa về ví. */
    public hasConfirmedUncreditedPurchase(): boolean {
        if (this.getPending().some(p => p.confirmed && !this.isCredited(p.orderId))) return true;
        const last = this.getLastTopUpOrder();
        return !!(last?.confirmed && !this.isCredited(last.orderId));
    }

    /** Order cũ lưu trước khi Tevi confirm — không hiện banner, không retry vô hạn. */
    public discardUnconfirmedLeftovers(): void {
        const kept = this.getPending().filter(p => p.confirmed && !this.isCredited(p.orderId));
        this.savePending(kept);
        const last = this.getLastTopUpOrder();
        if (last && !last.confirmed) {
            this.clearLastTopUpOrder(last.orderId);
        }
    }

    /** Còn order chưa cộng ★ (chỉ tính giao dịch Tevi đã confirm). */
    public hasUncreditedWork(): boolean {
        return this.hasConfirmedUncreditedPurchase();
    }

    public getPending(): PendingTopUpRecord[] {
        try {
            const raw = sys.localStorage.getItem(STORAGE_KEYS.PENDING_TOPUP_ORDERS);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            const result: PendingTopUpRecord[] = [];
            for (const item of parsed) {
                const orderId = `${item?.orderId || ''}`.trim();
                if (!orderId) continue;
                result.push({
                    orderId,
                    packId: `${item?.packId || ''}`.trim(),
                    stars: Math.max(0, Math.floor(Number(item?.stars) || 0)),
                    createdAt: Number(item?.createdAt) || 0,
                    confirmed: item?.confirmed === true,
                });
            }
            return result;
        } catch {
            return [];
        }
    }

    public isCredited(orderId: string): boolean {
        return this.getCreditedIds().has(orderId.trim());
    }

    public markCredited(orderId: string): void {
        const id = orderId.trim();
        if (!id) return;
        const set = this.getCreditedIds();
        set.add(id);
        this.saveCredited(set);
        this.removePending(id);
        this.clearLastTopUpOrder(id);
    }

    private getCreditedIds(): Set<string> {
        try {
            const raw = sys.localStorage.getItem(STORAGE_KEYS.CREDITED_TOPUP_ORDERS);
            if (!raw) return new Set();
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return new Set();
            return new Set(parsed.map((id) => `${id}`.trim()).filter(Boolean));
        } catch {
            return new Set();
        }
    }

    private savePending(list: PendingTopUpRecord[]): void {
        try {
            sys.localStorage.setItem(STORAGE_KEYS.PENDING_TOPUP_ORDERS, JSON.stringify(list));
        } catch (error) {
            console.warn('[TopUpPendingStore] save pending failed:', error);
        }
    }

    private saveLastTopUpOrder(record: PendingTopUpRecord): void {
        try {
            sys.localStorage.setItem(STORAGE_KEYS.LAST_TOPUP_ORDER, JSON.stringify(record));
        } catch (error) {
            console.warn('[TopUpPendingStore] save last topup failed:', error);
        }
    }

    private saveCredited(set: Set<string>): void {
        try {
            sys.localStorage.setItem(
                STORAGE_KEYS.CREDITED_TOPUP_ORDERS,
                JSON.stringify([...set]),
            );
        } catch (error) {
            console.warn('[TopUpPendingStore] save credited failed:', error);
        }
    }
}
