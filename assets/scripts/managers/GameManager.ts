import { _decorator, Component, director, Node, Prefab, resources, input, Input, KeyCode, EventKeyboard, UITransform, EditBox, Button, view, ResolutionPolicy, tween, UIOpacity, Vec3, Tween } from 'cc';
import { EDITOR, PREVIEW } from 'cc/env';
import { GameState } from '../enums/GameState';
import { GameEvent } from '../enums/GameEvent';
import { EventBus } from '../core/EventBus';
import { ConfigManager } from '../core/ConfigManager';
import { PoolManager } from '../core/PoolManager';
import { LevelManager } from './LevelManager';
import { UIManager } from './UIManager';
import { AudioManager } from './AudioManager';
import { SkinManager } from './SkinManager';
import { SaveManager } from '../core/SaveManager';
import type { SavedLeadInfo } from '../core/SaveManager';
import { OrderTrayManager } from './OrderTrayManager';
import { WrongTrayManager } from './WrongTrayManager';
import { BoosterManager } from './BoosterManager';
import { LeadCaptureService } from '../services/LeadCaptureService';
import { ExitTrackingService } from '../services/ExitTrackingService';
import { GAME_NAME } from '../core/GameBrandConfig';

const { ccclass, property } = _decorator;
const WIN_GAME_CHEAT_KEY_CODE = 87; // W
const WIN_LEVEL_5_CHEAT_KEY_CODE = 84; // T
const FINAL_FORM_LEVEL_ID = 5;

/**
 * GameManager - Entry point controller, quản lý vòng đời game.
 * Điều phối các manager khác, giữ state machine tổng thể.
 * Không chứa logic gameplay cụ thể.
 */
@ccclass('GameManager')
export class GameManager extends Component {
    public static Instance: GameManager;

    @property(Node)
    public uiRoot: Node | null = null;

    @property(Node)
    public gameplayRoot: Node | null = null;

    @property(Prefab)
    public tilePrefab: Prefab | null = null;

    private _currentState: GameState = GameState.NONE;
    private _previousState: GameState = GameState.NONE;
    private _startLevelToken: number = 0;
    private _elapsedSeconds: number = 0;
    private _timerRunning: boolean = false;
    private _transitionRunning: boolean = false;
    private _playButtonBaseScale: Vec3 | null = null;
    private _runtimePreloadPromise: Promise<void> | null = null;
    private _preparingHomeLevelId: number = 0;
    private _preparedHomeLevelId: number = 0;
    private _initPromise: Promise<void> | null = null;
    private _isInitialized: boolean = false;
    private _postInitHomeStarted: boolean = false;
    private _currentSessionId: string = '';
    private _forceShowLeadCaptureOnce: boolean = false;

    @property(EditBox)
    public levelJumpInput: EditBox | null = null;

    @property(Button)
    public levelJumpOk: Button | null = null;

    @property(Node)
    public splashNode: Node | null = null;

    @property(Node)
    public splashLogoNode: Node | null = null;

    @property(Node)
    public homeScreen: Node | null = null;

    @property(Button)
    public playGameButton: Button | null = null;

    @property(Node)
    public gameScreen: Node | null = null;

    protected onLoad(): void {
        if (GameManager.Instance) {
            this.destroy();
            return;
        }
        GameManager.Instance = this;
        director.addPersistRootNode(this.node);
        this.ensureSessionId();
        ExitTrackingService.getInstance().initialize({
            getSessionId: () => this.getCurrentSessionId(),
        });
        this.applyWebDocumentTitle();

        // Lock web build to 1080x1920 aspect ratio, fit inside browser without stretching.
        view.setDesignResolutionSize(1080, 1920, ResolutionPolicy.SHOW_ALL);
    }

    protected async start(): Promise<void> {
        const bootStartedAt = Date.now();

        // SplashScreen active=true, GameScreen active=false at start.
        if (this.splashNode) this.splashNode.active = true;
        if (this.homeScreen) this.homeScreen.active = false;
        if (this.gameScreen) this.gameScreen.active = false;

        // Ensure splash has UIOpacity for fade-out.
        if (this.splashNode && !this.splashNode.getComponent(UIOpacity)) {
            this.splashNode.addComponent(UIOpacity);
        }

        this._initPromise = this.initializeGame()
            .then(() => {
                this._isInitialized = true;
                this.onInitializationReadyForHome();
            })
            .catch(() => {
                this._initPromise = null;
            });

        await this._initPromise;
        const elapsedMs = Date.now() - bootStartedAt;
        const remainingSplashMs = Math.max(0, 2000 - elapsedMs);
        if (remainingSplashMs > 0) {
            await new Promise<void>(resolve => setTimeout(resolve, remainingSplashMs));
        }

        if (this.homeScreen) {
            this.homeScreen.active = true;
            const homeOpacity = this.ensureOpacity(this.homeScreen);
            homeOpacity.opacity = 0;
            tween(homeOpacity).to(0.25, { opacity: 255 }).start();
        }

        if (this.splashNode) {
            const splashOpacity = this.splashNode.getComponent(UIOpacity)!;
            await new Promise<void>(resolve => {
                tween(splashOpacity)
                    .to(0.25, { opacity: 0 })
                    .call(() => {
                        if (this.splashNode) this.splashNode.active = false;
                        resolve();
                    })
                    .start();
            });
        }

        // Listen for level end events to switch panels
        EventBus.getInstance().on(GameEvent.LEVEL_COMPLETED, this.onLevelCompleted, this);
        EventBus.getInstance().on(GameEvent.LEVEL_FAILED, this.onLevelFailed, this);

        // Cheat keys: 1-9 change level, R restart, N next level
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        this.bindLevelJumpUI();
        this.bindHomeUI();
        this.startPlayButtonPulse();
        this.onInitializationReadyForHome();
        await this.ensureInitialLeadInfo();
    }

    /** Phím cheat: 1-9 đổi level, R restart, N next level */
    private onKeyDown(event: EventKeyboard): void {
        if (!this.isEditorCheatEnabled()) return;
        const key = event.keyCode;
        if (key === WIN_GAME_CHEAT_KEY_CODE) {
            void this.runLevel5FormTestCheat();
            return;
        }
        if (key === WIN_LEVEL_5_CHEAT_KEY_CODE) {
            void this.runLevel5WinCheat();
            return;
        }
        if (this._currentState !== GameState.GAMEPLAY) return;
        if (key >= KeyCode.DIGIT_1 && key <= KeyCode.DIGIT_9) {
            const levelId = key - KeyCode.DIGIT_1 + 1;
            this.startLevel(levelId);
        } else if (key === KeyCode.KEY_R) {
            const currentLevelId = LevelManager.getInstance().getCurrentLevelId();
            if (currentLevelId > 0) {
                this.startLevel(currentLevelId);
            }
        } else if (key === KeyCode.KEY_N) {
            const nextLevelId = LevelManager.getInstance().getCurrentLevelId() + 1;
            this.startLevel(nextLevelId);
        }
    }

    private isEditorCheatEnabled(): boolean {
        return EDITOR || PREVIEW;
    }

    private applyWebDocumentTitle(): void {
        if (typeof document !== 'undefined') {
            document.title = GAME_NAME;
        }
    }

    private async runLevel5FormTestCheat(): Promise<void> {
        if (this._transitionRunning) return;
        this._forceShowLeadCaptureOnce = true;
        if (this._currentState !== GameState.GAMEPLAY) {
            await this.waitForInitialization();
            await this.transitionToGame();
        }
        await this.startLevel(FINAL_FORM_LEVEL_ID);
        setTimeout(() => {
            LevelManager.getInstance().completeLevel(false);
        }, 300);
    }

    private async runLevel5WinCheat(): Promise<void> {
        if (this._transitionRunning) return;
        if (this._currentState !== GameState.GAMEPLAY) {
            await this.waitForInitialization();
            await this.transitionToGame();
        }
        await this.startLevel(FINAL_FORM_LEVEL_ID);
        setTimeout(() => {
            LevelManager.getInstance().completeLevel(false);
        }, 300);
    }

    private async onLevelCompleted(levelId: number, score: number, stars: number): Promise<void> {
        try {
            this.stopTimer();
            const panel = await UIManager.getInstance().openPanel('LevelCompletePanel', { levelId, score, stars, elapsedSeconds: this._elapsedSeconds });
            if (!panel) {
                this.returnToMenu();
                return;
            }

            if ((levelId === FINAL_FORM_LEVEL_ID && !SaveManager.getInstance().hasSubmittedLeadCapture()) || this._forceShowLeadCaptureOnce) {
                this._forceShowLeadCaptureOnce = false;
                const submitted = await this.showLeadCaptureForm();
                if (submitted) {
                    SaveManager.getInstance().saveLeadCaptureSubmitted();
                    SaveManager.getInstance().resetProgressToLevelOne();
                    await this.returnToMenu();
                }
            }
        } catch (err) {
            this._forceShowLeadCaptureOnce = false;
            this.returnToMenu();
        }
    }

    private async onLevelFailed(levelId: number): Promise<void> {
        try {
            this.stopTimer();
            const panel = await UIManager.getInstance().openPanel('LevelFailedPanel', { levelId });
            if (!panel) {
                this.returnToMenu();
            }
        } catch (err) {
            this.returnToMenu();
        }
    }


    /** Khởi tạo tuần tự các hệ thống */
    private async initializeGame(): Promise<void> {
        this.setState(GameState.LOADING);

                                        
        await ConfigManager.getInstance().loadConfig();

        const skinMgr = SkinManager.getInstance();
        if (!skinMgr) {
                        return;
        }
        if (typeof skinMgr.loadDefaultSkin !== 'function') {
                        return;
        }
        await skinMgr.loadDefaultSkin();
        await skinMgr.prewarmSkinSprites();

        const audioMgr = AudioManager.getInstance();
        if (!audioMgr) {
                        return;
        }
        await audioMgr.initialize();
        audioMgr.bindButtonSounds(this.node);

        await LevelManager.getInstance().initialize();

        // Register tile prefab for object pooling
        await this.registerTilePrefab();

        UIManager.getInstance().initialize(this.uiRoot);
        AudioManager.getInstance()?.bindButtonSounds(this.uiRoot);
        await UIManager.getInstance().preloadPanels([
            'GameplayPanel',
            'LevelCompletePanel',
            'LevelFailedPanel',
            'LevelSelectPanel',
        ]);
        this.ensureOrderManagers();

        this.setState(GameState.MAIN_MENU);
    }

    /** Đăng ký tile prefab vào PoolManager */
    private registerTilePrefab(): Promise<void> {
        return new Promise((resolve) => {
            if (this.tilePrefab) {
                PoolManager.getInstance().registerPrefab('tile_default', this.tilePrefab);
                                resolve();
                return;
            }

            // Fallback: load from resources bundle.
            // Prefab must be placed under assets/resources/prefabs/tiles/
            resources.load('prefabs/tiles/tile_default', Prefab, (err, prefab) => {
                if (err) {
                                        resolve();
                    return;
                }
                PoolManager.getInstance().registerPrefab('tile_default', prefab);
                                resolve();
            });
        });
    }

    /** Chuyển state */
    public setState(newState: GameState): void {
        if (this._currentState === newState) return;

        this._previousState = this._currentState;
        this._currentState = newState;

        EventBus.getInstance().emit(GameEvent.STATE_CHANGED, this._currentState, this._previousState);
    }

    /** Lấy state hiện tại */
    public getState(): GameState {
        return this._currentState;
    }

    /** Quay lại state trước đó */
    public revertState(): void {
        this.setState(this._previousState);
    }

    /** Bắt đầu level mới */
    public async startLevel(levelId: number, options?: { parallelTransition?: boolean }): Promise<void> {
        const startToken = ++this._startLevelToken;
        ExitTrackingService.getInstance().setLevel(levelId);
        await this.waitForInitialization();
        await this.ensureHomeLevelPrepared(levelId);
        if (startToken !== this._startLevelToken) return;
        this.setState(GameState.GAMEPLAY);
        if (!options?.parallelTransition) {
            if (this.gameScreen) this.gameScreen.active = true;
            if (this.homeScreen) this.homeScreen.active = false;
        }

        // Ensure ORDER_MATCH managers exist in scene
                this.ensureOrderManagers();

        // Close menu panels and show loading BEFORE loading assets
        UIManager.getInstance().closePanel('LevelSelectPanel');
        UIManager.getInstance().closePanel('LevelCompletePanel');
        UIManager.getInstance().closePanel('LevelFailedPanel');

        try {
                        await LevelManager.getInstance().playPreparedLevel(levelId);
            this._preparedHomeLevelId = 0;
            if (startToken !== this._startLevelToken) return;
            
            // Only open GameplayPanel AFTER everything is loaded and ready
                        const gameplayPanel = await UIManager.getInstance().openPanel('GameplayPanel');
            if (!gameplayPanel) {
                            } else {
                            }
            this.stopTimer();
            this._elapsedSeconds = 0;
            this.startTimer();
        } catch (err) {
                        this.returnToMenu();
        } finally {
            if (startToken === this._startLevelToken) {
                UIManager.getInstance().hideLoading();
            }
        }
    }

    /** Tạo OrderTrayManager và WrongTrayManager nếu chưa có trong scene */
    private ensureOrderManagers(): void {
        const parent = this.gameplayRoot || this.uiRoot || this.node;
        const scene = director.getScene();
        if (!parent && scene) {
            // Fallback: gắn vào scene root
        }
        const effectiveParent = parent || scene as any;

        // Helper: check if a manager instance is valid (node not destroyed)
        const isManagerValid = (mgr: any) => mgr && mgr.node && mgr.node.isValid;

        if (!isManagerValid(OrderTrayManager.Instance)) {
            if (OrderTrayManager.Instance) (OrderTrayManager as any).Instance = null;
            const orderTrayNode = new Node('OrderTrayManager');
            orderTrayNode.layer = effectiveParent?.layer ?? 0;
            orderTrayNode.addComponent(UITransform);
            orderTrayNode.addComponent(OrderTrayManager);
            orderTrayNode.setParent(effectiveParent);
            orderTrayNode.setPosition(540, 320, 0);
                    }

        if (!isManagerValid(WrongTrayManager.Instance)) {
            if (WrongTrayManager.Instance) (WrongTrayManager as any).Instance = null;
            const wrongTrayNode = new Node('WrongTrayManager');
            wrongTrayNode.layer = effectiveParent?.layer ?? 0;
            wrongTrayNode.addComponent(UITransform);
            wrongTrayNode.addComponent(WrongTrayManager);
            wrongTrayNode.setParent(effectiveParent);
            wrongTrayNode.setPosition(850, 320, 0);
                    }

        if (!isManagerValid(BoosterManager.Instance)) {
            if (BoosterManager.Instance) (BoosterManager as any).Instance = null;
            const boosterNode = new Node('BoosterManager');
            boosterNode.layer = effectiveParent?.layer ?? 0;
            boosterNode.addComponent(BoosterManager);
            boosterNode.setParent(effectiveParent);
                    }
    }

    /** Tạm dừng game */
    public pauseGame(): void {
        if (this._currentState === GameState.GAMEPLAY) {
            this.setState(GameState.PAUSED);
        }
    }

    /** Tiếp tục game */
    public resumeGame(): void {
        if (this._currentState === GameState.PAUSED) {
            this.setState(GameState.GAMEPLAY);
        }
    }

    /** Thoát về menu */
    public async returnToMenu(): Promise<void> {
        this.stopTimer();
        this.setState(GameState.MAIN_MENU);
        this._preparedHomeLevelId = 0;
        LevelManager.getInstance().unloadCurrentLevel();
        UIManager.getInstance().closePanel('GameplayPanel');
        UIManager.getInstance().closePanel('LevelCompletePanel');
        UIManager.getInstance().closePanel('LevelFailedPanel');
        UIManager.getInstance().closePanel('LevelSelectPanel');
        UIManager.getInstance().hideLoading();
        await this.transitionToHome();
    }

    protected onDestroy(): void {
        if (GameManager.Instance === this) {
            GameManager.Instance = null;
            EventBus.getInstance().off(GameEvent.LEVEL_COMPLETED, this.onLevelCompleted, this);
            EventBus.getInstance().off(GameEvent.LEVEL_FAILED, this.onLevelFailed, this);
            input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
            if (this.levelJumpOk) {
                this.levelJumpOk.node.off(Button.EventType.CLICK, this.onClickLevelJump, this);
            }
            if (this.playGameButton) {
                this.playGameButton.node.off(Button.EventType.CLICK, this.onPlayGameClicked, this);
            }
            this.stopPlayButtonPulse();
        }
    }

    private bindLevelJumpUI(): void {
        if (this.levelJumpOk) {
            this.levelJumpOk.node.on(Button.EventType.CLICK, this.onClickLevelJump, this);
        }
        AudioManager.getInstance()?.bindButtonSounds(this.levelJumpOk?.node || null);
    }

    private bindHomeUI(): void {
        if (this.playGameButton) {
            this.playGameButton.node.on(Button.EventType.CLICK, this.onPlayGameClicked, this);
        }
        AudioManager.getInstance()?.bindButtonSounds(this.homeScreen);
    }

    /** Hiệu ứng zoom in/out lặp lại để gợi ý người chơi bấm Play */
    private startPlayButtonPulse(): void {
        if (!this.playGameButton || !this.homeScreen?.active) return;

        const node = this.playGameButton.node;
        this._playButtonBaseScale = node.scale.clone();
        this.stopPlayButtonPulse(false);

        const base = this._playButtonBaseScale;
        const enlarged = new Vec3(base.x * 1.1, base.y * 1.1, base.z);

        tween(node)
            .to(0.55, { scale: enlarged }, { easing: 'sineInOut' })
            .to(0.55, { scale: base }, { easing: 'sineInOut' })
            .union()
            .repeatForever()
            .start();
    }

    private stopPlayButtonPulse(resetScale: boolean = true): void {
        if (this.playGameButton) {
            Tween.stopAllByTarget(this.playGameButton.node);
            if (resetScale && this._playButtonBaseScale) {
                this.playGameButton.node.setScale(this._playButtonBaseScale);
            }
        }
    }

    private async onPlayGameClicked(): Promise<void> {
        if (this._transitionRunning) return;
        const hasLeadInfo = await this.ensureInitialLeadInfo();
        if (!hasLeadInfo) return;
        const levelId = this.getSavedLevelId();

        await this.waitForInitialization();
        await this.ensureHomeLevelPrepared(levelId);

        await Promise.all([
            this.transitionToGame(),
            this.startLevel(levelId, { parallelTransition: true }),
        ]);
    }

    /** Preload skin, sprite và JSON level đã save khi Home idle */
    private preloadHomeGameplayAssets(): void {
        void this.runHomeGameplayPreload();
    }

    private async runHomeGameplayPreload(): Promise<void> {
        await this.ensureHomeLevelPrepared(this.getSavedLevelId());
    }

    private getSavedLevelId(): number {
        const savedLevel = SaveManager.getInstance().getCurrentLevel();
        return savedLevel > 0 ? savedLevel : 1;
    }

    private async waitForInitialization(): Promise<void> {
        if (this._isInitialized) return;
        if (this._initPromise) {
            await this._initPromise;
        }
    }

    private onInitializationReadyForHome(): void {
        if (!this._isInitialized) return;
        if (this._postInitHomeStarted) return;
        if (!this.homeScreen?.active) return;

        this._postInitHomeStarted = true;
        AudioManager.getInstance()?.playMusic('bg_main');
        AudioManager.getInstance()?.bindButtonSounds(this.homeScreen);
        this.preloadHomeGameplayAssets();
    }

    private async ensureHomeLevelPrepared(levelId: number): Promise<void> {
        if (this._preparedHomeLevelId === levelId) return;
        if (this._runtimePreloadPromise && this._preparingHomeLevelId === levelId) {
            await this._runtimePreloadPromise;
            return;
        }
        if (this._runtimePreloadPromise) {
            await this._runtimePreloadPromise;
            if (this._preparedHomeLevelId === levelId) return;
        }

        PoolManager.getInstance().setAllowRuntimeInstantiate(true);
        this._preparingHomeLevelId = levelId;
        this._runtimePreloadPromise = LevelManager.getInstance().prepareLevelWaitingDrop(levelId);
        try {
            await this._runtimePreloadPromise;
            this._preparedHomeLevelId = levelId;
            this._preparingHomeLevelId = 0;
        } catch (err) {
            this._runtimePreloadPromise = null;
            this._preparingHomeLevelId = 0;
            throw err;
        }
    }

    private onClickLevelJump(): void {
        const val = this.levelJumpInput?.string?.trim() || '';
        const num = parseInt(val, 10);
        if (!isNaN(num) && num > 0) {
            this.startLevel(num);
        }
        if (this.levelJumpInput) {
            this.levelJumpInput.string = '';
        }
    }

    private startTimer(): void {
        if (this._timerRunning) return;
        this._timerRunning = true;
        this.schedule(this._timerTick, 1);
    }

    private stopTimer(): void {
        if (!this._timerRunning) return;
        this._timerRunning = false;
        this.unschedule(this._timerTick);
    }

    private _timerTick(): void {
        this._elapsedSeconds++;
        EventBus.getInstance().emit(GameEvent.LEVEL_TIME_UPDATED, this._elapsedSeconds);
    }

    public getElapsedSeconds(): number {
        return this._elapsedSeconds;
    }

    public getCurrentSessionId(): string {
        this.ensureSessionId();
        return this._currentSessionId;
    }

    private ensureSessionId(): string {
        if (this._currentSessionId) return this._currentSessionId;
        this._currentSessionId = this.createSessionId();
        console.log('[GameSession] New session_id:', this._currentSessionId);
        return this._currentSessionId;
    }

    private createSessionId(): string {
        const cryptoObj = (globalThis as any).crypto;
        if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
            return cryptoObj.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
            const value = Math.random() * 16 | 0;
            const next = char === 'x' ? value : (value & 0x3 | 0x8);
            return next.toString(16);
        });
    }

    private async showLeadCaptureForm(): Promise<boolean> {
        const leadCapture = LeadCaptureService.getInstance();
        if (!leadCapture.isSupported()) return false;

        return leadCapture.showCompletionForm({
            initialInfo: SaveManager.getInstance().getLeadInfo(),
            onSave: info => SaveManager.getInstance().saveLeadInfo(info as SavedLeadInfo),
            getSessionId: () => this.getCurrentSessionId(),
        });
    }

    private async ensureInitialLeadInfo(): Promise<boolean> {
        // Skip lead form in Editor so preview play doesn't block on HTML form
        if (EDITOR) return true;

        const saveManager = SaveManager.getInstance();
        if (saveManager.hasLeadInfo()) return true;

        const leadCapture = LeadCaptureService.getInstance();
        if (!leadCapture.isSupported()) return true;

        return leadCapture.showInitialInfoForm({
            initialInfo: saveManager.getLeadInfo(),
            onSave: info => saveManager.saveLeadInfo(info as SavedLeadInfo),
        });
    }

    private ensureOpacity(node: Node): UIOpacity {
        let opacity = node.getComponent(UIOpacity);
        if (!opacity) {
            opacity = node.addComponent(UIOpacity);
        }
        return opacity;
    }

    private async transitionScreens(fromNode: Node | null, toNode: Node | null): Promise<void> {
        if (!fromNode && !toNode) return;

        this._transitionRunning = true;

        if (toNode) {
            toNode.active = true;
            const toOpacity = this.ensureOpacity(toNode);
            toOpacity.opacity = 0;
            tween(toOpacity).to(0.4, { opacity: 255 }).start();
        }

        if (fromNode) {
            const fromOpacity = this.ensureOpacity(fromNode);
            fromOpacity.opacity = 255;
            await new Promise<void>(resolve => {
                tween(fromOpacity)
                    .to(0.4, { opacity: 0 })
                    .call(() => {
                        fromNode.active = false;
                        resolve();
                    })
                    .start();
            });
        } else {
            await new Promise<void>(resolve => this.scheduleOnce(() => resolve(), 0.4));
        }

        if (toNode) {
            this.ensureOpacity(toNode).opacity = 255;
        }

        this._transitionRunning = false;
    }

    private transitionToGame(): Promise<void> {
        this.stopPlayButtonPulse();
        return this.transitionScreens(this.homeScreen, this.gameScreen);
    }

    private async transitionToHome(): Promise<void> {
        await this.transitionScreens(this.gameScreen, this.homeScreen);
        AudioManager.getInstance()?.playMusic('bg_main');
        AudioManager.getInstance()?.bindButtonSounds(this.homeScreen);
        this.startPlayButtonPulse();
        this.preloadHomeGameplayAssets();
    }
}
