import { sys } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../enums/GameEvent';
import { STARTING_STAR_BALANCE, STORAGE_KEYS } from '../TeviConstants';

/**
 * Ví Star lưu local (game offline, không backend).
 * Không chống cheat — chỉ đủ cho Mini App client-side.
 */
export class StarWallet {
    private static _instance: StarWallet | null = null;

    public static getInstance(): StarWallet {
        if (!StarWallet._instance) {
            StarWallet._instance = new StarWallet();
        }
        return StarWallet._instance;
    }

    public getBalance(): number {
        try {
            const raw = sys.localStorage.getItem(STORAGE_KEYS.STAR_BALANCE);
            if (raw === null || raw === '') {
                this.saveBalance(STARTING_STAR_BALANCE);
                console.log(`[StarWallet] Welcome grant ${STARTING_STAR_BALANCE}★`);
                return STARTING_STAR_BALANCE;
            }
            const value = parseInt(raw, 10);
            return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
        } catch {
            return 0;
        }
    }

    public addStars(amount: number, reason: string = ''): number {
        const add = Math.max(0, Math.floor(amount));
        if (add <= 0) return this.getBalance();
        const next = this.getBalance() + add;
        this.saveBalance(next);
        console.log(`[StarWallet] +${add} (${reason || 'add'}) → ${next}`);
        EventBus.getInstance().emit(GameEvent.STAR_BALANCE_CHANGED, next, add);
        return next;
    }

    public trySpend(amount: number, reason: string = ''): boolean {
        const cost = Math.max(0, Math.floor(amount));
        if (cost <= 0) return true;
        const balance = this.getBalance();
        if (balance < cost) return false;
        const next = balance - cost;
        this.saveBalance(next);
        console.log(`[StarWallet] -${cost} (${reason || 'spend'}) → ${next}`);
        EventBus.getInstance().emit(GameEvent.STAR_BALANCE_CHANGED, next, -cost);
        return true;
    }

    public canAfford(amount: number): boolean {
        return this.getBalance() >= Math.max(0, Math.floor(amount));
    }

    private saveBalance(value: number): void {
        try {
            sys.localStorage.setItem(STORAGE_KEYS.STAR_BALANCE, `${Math.max(0, Math.floor(value))}`);
        } catch (error) {
            console.warn('[StarWallet] Không lưu được số Star:', error);
        }
    }
}
