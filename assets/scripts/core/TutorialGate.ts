/**
 * Lightweight input lock used while the first-time tutorial is on screen.
 * Other gameplay modules query this instead of importing TutorialManager
 * (avoids circular references).
 */
export class TutorialGate {
    private static _active = false;
    private static _allowedTileId: string | null = null;
    private static _allowBoosters = false;
    private static _allowShop = false;
    private static _allowReset = false;

    public static isActive(): boolean {
        return TutorialGate._active;
    }

    public static canClickTile(tileId: string): boolean {
        if (!TutorialGate._active) return true;
        return !!tileId && TutorialGate._allowedTileId === tileId;
    }

    public static canUseBooster(): boolean {
        return !TutorialGate._active || TutorialGate._allowBoosters;
    }

    public static canOpenShop(): boolean {
        return !TutorialGate._active || TutorialGate._allowShop;
    }

    public static canReset(): boolean {
        return !TutorialGate._active || TutorialGate._allowReset;
    }

    public static getAllowedTileId(): string | null {
        return TutorialGate._allowedTileId;
    }

    public static begin(): void {
        TutorialGate._active = true;
        TutorialGate._allowedTileId = null;
        TutorialGate._allowBoosters = false;
        TutorialGate._allowShop = false;
        TutorialGate._allowReset = false;
    }

    public static setAllowedTile(tileId: string | null): void {
        TutorialGate._allowedTileId = tileId;
    }

    public static setAllowShop(allow: boolean): void {
        TutorialGate._allowShop = allow;
    }

    public static setAllowBoosters(allow: boolean): void {
        TutorialGate._allowBoosters = allow;
    }

    public static end(): void {
        TutorialGate._active = false;
        TutorialGate._allowedTileId = null;
        TutorialGate._allowBoosters = true;
        TutorialGate._allowShop = true;
        TutorialGate._allowReset = true;
    }
}
