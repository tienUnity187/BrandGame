import { director, instantiate, Node, Prefab, resources } from 'cc';
import { EventBus } from '../core/EventBus';
import { SaveManager } from '../core/SaveManager';
import { TutorialGate } from '../core/TutorialGate';
import { GameEvent } from '../enums/GameEvent';
import { TutorialStep } from '../enums/TutorialStep';
import { ITileData } from '../interfaces/ITileData';
import { BoosterManager } from './BoosterManager';
import { OrderManager } from './OrderManager';
import { OrderTrayManager } from './OrderTrayManager';
import { TileManager } from './TileManager';
import { TrayManager } from './TrayManager';
import { UIManager } from './UIManager';
import { GameplayPanel } from '../ui/GameplayPanel';
import { StarWalletHud } from '../ui/StarWalletHud';
import { ITutorialStepView, TutorialOverlay, TutorialStepLayout } from '../ui/TutorialOverlay';
import { AudioManager } from './AudioManager';

const TUTORIAL_PREFAB_PATH = 'prefabs/ui/panel_tutorial';
const DROP_WAIT_SECONDS = 0.9;
const TRAY_WAIT_SECONDS = 1.35;

/** Set true to always show tutorial on level 1 (ignores save). Turn off before release. */
const ALWAYS_SHOW_TUTORIAL = true;

const COPY = {
    orderTitle: 'Your Order',
    orderBody:
        'This is your Order. Collect each item shown here in the same sequence.',
    tileTitle: 'Pick a Tile',
    tileBody: 'Tap the highlighted tile to send it to your tray.',
    trayTitle: 'The Tray',
    trayBody:
        'Picked tiles appear here. You must select them in the same order as the Order above. Clear every item to win. If the Wrong Tray fills up, you lose.',
    boosterTitle: 'Boosters',
    boosterBody: 'Need help? These items assist you during a run. Each booster costs:',
    coinTitle: 'Your Coins',
    coinBody: 'This is your coin bar. After the tutorial, tap it anytime to open the Top Up screen.',
    clipsTitle: 'Unlock Video Clips',
    clipsBody: 'Complete levels to unlock exciting video clips. Have fun!',
};

/**
 * First-time tutorial flow. Shown once on level 1, then saved.
 * Only the current hint target can be clicked until the sequence finishes.
 */
export class TutorialManager {
    private static _instance: TutorialManager | null = null;

    private _running = false;
    private _step: TutorialStep = TutorialStep.NONE;
    private _overlay: TutorialOverlay | null = null;
    private _prefab: Prefab | null = null;
    private _loadingPrefab = false;
    private _hintTileId: string | null = null;
    private _startGeneration = 0;
    private _trayWaitCallback: (() => void) | null = null;
    private _tileHintConsumed = false;

    public static getInstance(): TutorialManager {
        if (!TutorialManager._instance) {
            TutorialManager._instance = new TutorialManager();
        }
        return TutorialManager._instance;
    }

    public isRunning(): boolean {
        return this._running;
    }

    /**
     * Called after GameplayPanel is open. Starts the tutorial on the first visit to level 1.
     */
    public onGameplayReady(levelId: number, options?: { skipTutorial?: boolean }): void {
        if (this._running) this.abortInternal(false);
        if (levelId !== 1) return;
        if (options?.skipTutorial) return;
        if (!ALWAYS_SHOW_TUTORIAL && SaveManager.getInstance().hasCompletedTutorial()) return;

        this._startGeneration += 1;
        const generation = this._startGeneration;
        TutorialGate.begin();
        TileManager.getInstance()?.setInputLocked(true);
        this._running = true;
        this._step = TutorialStep.NONE;

        this.delay(DROP_WAIT_SECONDS, () => {
            if (generation !== this._startGeneration) return;
            void this.beginFlow(generation);
        });
    }

    public abort(): void {
        this.abortInternal(false);
    }

    private abortInternal(completed: boolean): void {
        this._startGeneration += 1;
        this.clearTrayWait();
        EventBus.getInstance().off(GameEvent.TRAY_SETTLED, this.onTraySettled, this);
        this.setHintTileGlow(false);
        this._hintTileId = null;
        const wasRunning = this._running;
        this._running = false;
        this._step = TutorialStep.NONE;
        if (this._overlay?.node?.isValid) {
            this._overlay.hide();
        }
        TutorialGate.end();
        if (wasRunning && !completed) {
            TileManager.getInstance()?.setInputLocked(false);
        }
    }

    private async beginFlow(generation: number): Promise<void> {
        const overlay = await this.ensureOverlay();
        if (generation !== this._startGeneration) return;
        if (!overlay) {
            this.finishTutorial();
            return;
        }
        TileManager.getInstance()?.setInputLocked(true);
        this.showOrderStep();
    }

    private showOrderStep(): void {
        this._step = TutorialStep.ORDER;
        TutorialGate.setAllowedTile(null);
        TutorialGate.setAllowShop(false);
        this.present({
            title: COPY.orderTitle,
            body: COPY.orderBody,
            nextLabel: 'Next',
            showNext: true,
            showHand: true,
            showHotspot: true,
            followTarget: this.findOrderTarget(),
            layout: this.layout(TutorialStep.ORDER),
            onNext: () => this.showTileStep(),
            onHotspot: null,
        });
    }

    private showTileStep(): void {
        const tile = this.findHintTile();
        const tileNode = tile ? TileManager.getInstance()?.getTileNode(tile.id) ?? null : null;
        this._hintTileId = tile?.id ?? null;
        this._tileHintConsumed = false;
        this._step = TutorialStep.TILE;
        TutorialGate.setAllowedTile(this._hintTileId);
        TutorialGate.setAllowShop(false);

        if (!this._hintTileId || !tileNode?.isValid) {
            this.showTrayStep();
            return;
        }
        this.setHintTileGlow(true);

        this.present({
            title: COPY.tileTitle,
            body: COPY.tileBody,
            showNext: false,
            showHand: true,
            showHotspot: true,
            followTarget: tileNode,
            layout: this.layout(TutorialStep.TILE),
            onNext: null,
            onHotspot: () => this.onHintTileClicked(),
        });
    }

    private onHintTileClicked(): void {
        if (this._step !== TutorialStep.TILE || !this._hintTileId || this._tileHintConsumed) return;
        const tileId = this._hintTileId;
        TutorialGate.setAllowedTile(tileId);
        const clicked = TileManager.getInstance()?.tryClickTile(tileId, true);
        if (!clicked) {
            TileManager.getInstance()?.refreshBlockStatus();
            if (!TileManager.getInstance()?.tryClickTile(tileId, true)) return;
        }
        TutorialGate.setAllowedTile(null);
        this._tileHintConsumed = true;
        if (this._overlay) this._overlay.onHotspot = null;
        this.waitForTrayThenContinue();
    }

    private waitForTrayThenContinue(): void {
        this.clearTrayWait();
        EventBus.getInstance().off(GameEvent.TRAY_SETTLED, this.onTraySettled, this);
        EventBus.getInstance().on(GameEvent.TRAY_SETTLED, this.onTraySettled, this);
        this._trayWaitCallback = () => this.showTrayStep();
        this.delay(TRAY_WAIT_SECONDS, () => {
            if (this._step !== TutorialStep.TILE) return;
            this.onTraySettled();
        });
    }

    private onTraySettled = (): void => {
        if (this._step !== TutorialStep.TILE) return;
        this.clearTrayWait();
        EventBus.getInstance().off(GameEvent.TRAY_SETTLED, this.onTraySettled, this);
        this.showTrayStep();
    };

    private showTrayStep(): void {
        this.setHintTileGlow(false);
        this._step = TutorialStep.TRAY;
        TutorialGate.setAllowedTile(null);
        this.present({
            title: COPY.trayTitle,
            body: COPY.trayBody,
            nextLabel: 'Next',
            showNext: true,
            showHand: true,
            showHotspot: true,
            followTarget: this.findTrayTarget(),
            layout: this.layout(TutorialStep.TRAY),
            hotspotSize: { width: 820, height: 230 },
            onNext: () => this.showBoosterStep(),
            onHotspot: null,
        });
    }

    private showBoosterStep(): void {
        this._step = TutorialStep.BOOSTER;
        this.present({
            title: COPY.boosterTitle,
            body: COPY.boosterBody,
            nextLabel: 'Next',
            showNext: true,
            showHand: true,
            showHotspot: true,
            followTarget: this.findBoosterTarget(),
            layout: this.layout(TutorialStep.BOOSTER),
            hotspotSize: { width: 780, height: 240 },
            showCostIcons: true,
            onNext: () => this.showCoinStep(),
            onHotspot: null,
        });
    }

    private showCoinStep(): void {
        this._step = TutorialStep.COIN;
        TutorialGate.setAllowShop(false);
        this.present({
            title: COPY.coinTitle,
            body: COPY.coinBody,
            nextLabel: 'Next',
            showNext: true,
            showHand: true,
            showHotspot: true,
            followTarget: this.findCoinTarget(),
            layout: this.layout(TutorialStep.COIN),
            onNext: () => this.showClipsStep(),
            onHotspot: null,
        });
    }

    private showClipsStep(): void {
        this._step = TutorialStep.CLIPS;
        TutorialGate.setAllowShop(false);
        this.present({
            title: COPY.clipsTitle,
            body: COPY.clipsBody,
            nextLabel: 'OK',
            showNext: true,
            showHand: false,
            showHotspot: false,
            followTarget: null,
            layout: this.layout(TutorialStep.CLIPS),
            centerPopup: true,
            onNext: () => this.finishTutorial(),
            onHotspot: null,
        });
    }

    private finishTutorial(): void {
        if (!ALWAYS_SHOW_TUTORIAL) {
            SaveManager.getInstance().markTutorialCompleted();
        }
        this.abortInternal(true);
        TileManager.getInstance()?.setInputLocked(false);
    }

    private present(options: ITutorialStepView & {
        onNext: (() => void) | null;
        onHotspot: (() => void) | null;
    }): void {
        const overlay = this._overlay;
        if (!overlay?.node?.isValid) return;
        overlay.onNext = options.onNext;
        overlay.onHotspot = options.onHotspot;
        overlay.showStep(options);
    }

    private layout(step: TutorialStep): TutorialStepLayout {
        if (this._overlay?.node?.isValid) {
            return this._overlay.getLayoutClone(step);
        }
        return new TutorialStepLayout();
    }

    private setHintTileGlow(active: boolean): void {
        if (!this._hintTileId) return;
        const node = TileManager.getInstance()?.getTileNode(this._hintTileId);
        const tile = node?.getComponent('Tile') as { setGlow?: (on: boolean) => void } | null;
        tile?.setGlow?.(active);
    }

    private findOrderTarget(): Node | null {
        const orderTray = OrderTrayManager.getInstance();
        return orderTray?.getFocusNode()
            || orderTray?.trayContainer
            || orderTray?.node
            || null;
    }

    private findHintTile(): ITileData | null {
        const hinted = BoosterManager.getInstance()?.GetBestHintTile();
        if (hinted?.active && hinted.selectable) return hinted;
        const expected = OrderManager.getInstance().getExpectedItem();
        const tiles = TileManager.getInstance()?.getAllTileData() || [];
        const selectable = tiles.filter(t => t.active && t.selectable);
        if (expected) {
            const match = selectable.find(t => t.groupId === expected);
            if (match) return match;
        }
        return selectable[0] || null;
    }

    private findTrayTarget(): Node | null {
        const tray = TrayManager.getInstance();
        if (!tray?.node?.isValid) return null;
        const frame = tray.node.getChildByName('Popup');
        if (frame?.isValid) return frame;
        return tray.trayContainer || tray.node;
    }

    private findBoosterTarget(): Node | null {
        const panel = UIManager.getInstance()?.getOpenPanel('GameplayPanel') as GameplayPanel | undefined;
        return panel?.getBoosterBarNode() || null;
    }

    private findCoinTarget(): Node | null {
        return StarWalletHud.Instance?.getCoinBarNode() || null;
    }

    private async ensureOverlay(): Promise<TutorialOverlay | null> {
        if (this._overlay?.node?.isValid) {
            this.mountOverlay(this._overlay);
            return this._overlay;
        }
        const existing = TutorialOverlay.Instance;
        if (existing?.node?.isValid) {
            this._overlay = existing;
            this.mountOverlay(existing);
            return existing;
        }

        const prefab = await this.loadPrefab();
        const canvas = this.getCanvasNode();
        const parent = canvas || director.getScene();
        if (!parent) return this.createRuntimeOverlay();

        let node: Node;
        if (prefab) {
            node = instantiate(prefab);
        } else {
            node = new Node('panel_tutorial');
            node.addComponent(TutorialOverlay);
        }
        node.name = 'panel_tutorial';
        node.setParent(parent);
        const overlay = node.getComponent(TutorialOverlay) || node.addComponent(TutorialOverlay);
        this._overlay = overlay;
        this.mountOverlay(overlay);
        return overlay;
    }

    private createRuntimeOverlay(): TutorialOverlay | null {
        const canvas = this.getCanvasNode();
        if (!canvas) return null;
        const node = new Node('panel_tutorial');
        node.setParent(canvas);
        const overlay = node.addComponent(TutorialOverlay);
        this._overlay = overlay;
        this.mountOverlay(overlay);
        return overlay;
    }

    private mountOverlay(overlay: TutorialOverlay): void {
        const canvas = this.getCanvasNode();
        if (canvas) overlay.mountOnCanvas(canvas);
        overlay.node.active = true;
        AudioManager.getInstance()?.bindButtonSounds(overlay.node);
    }

    private loadPrefab(): Promise<Prefab | null> {
        if (this._prefab) return Promise.resolve(this._prefab);
        if (this._loadingPrefab) {
            return new Promise(resolve => {
                const wait = () => {
                    if (!this._loadingPrefab) resolve(this._prefab);
                    else setTimeout(wait, 50);
                };
                wait();
            });
        }
        this._loadingPrefab = true;
        return new Promise(resolve => {
            resources.load(TUTORIAL_PREFAB_PATH, Prefab, (err, prefab) => {
                this._loadingPrefab = false;
                if (err || !prefab) {
                    console.warn('[Tutorial] Missing prefab prefabs/ui/panel_tutorial. Using runtime layout.');
                    resolve(null);
                    return;
                }
                this._prefab = prefab;
                resolve(prefab);
            });
        });
    }

    private getCanvasNode(): Node | null {
        const scene = director.getScene();
        return scene?.getChildByName('Canvas')
            || UIManager.getInstance()?.uiRoot
            || null;
    }

    private delay(seconds: number, callback: () => void): void {
        const gen = this._startGeneration;
        setTimeout(() => {
            if (gen !== this._startGeneration) return;
            callback();
        }, Math.max(0, seconds) * 1000);
    }

    private clearTrayWait(): void {
        this._trayWaitCallback = null;
    }
}
