import { _decorator, Component, director, instantiate, Node, Prefab, resources, input, Input, KeyCode, EventKeyboard, UITransform, EditBox, Button, Label, view, ResolutionPolicy, tween, UIOpacity, Vec3, Tween } from 'cc';
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
import { OrderTrayManager } from './OrderTrayManager';
import { WrongTrayManager } from './WrongTrayManager';
import { BoosterManager } from './BoosterManager';
import { TutorialManager } from './TutorialManager';
import { GAME_NAME } from '../core/GameBrandConfig';
import { TeviLoginManager } from '../TeviLoginManager';
import {
    getRewardVideoFileName,
    isRewardVideoLevel,
    logRewardVideoFilePlan,
    REWARD_VIDEO_TOKEN_URL,
    REWARD_VIDEO_UNLOCK_LEVELS,
} from '../TeviConstants';
import { RewardVideoHistory } from '../services/RewardVideoHistory';
import { RewardVideoGalleryPanel } from '../ui/RewardVideoGalleryPanel';
import { RewardVideoPlayer } from '../ui/RewardVideoPlayer';
import { TeviPaymentService } from '../services/TeviPaymentService';
import { StarWalletHud } from '../ui/StarWalletHud';
import { NoticePopupPanel } from '../ui/NoticePopupPanel';

const { ccclass, property } = _decorator;
const WIN_CURRENT_LEVEL_CHEAT_KEY_CODE = 84; // T
const BOOSTER_CHEAT_KEY_CODE = 66; // B
const PENDING_BANNER_DEBUG_KEY_CODE = 85; // U — Editor: toggle top-up pending banner
const PENDING_BOOT_DEBUG_KEY_CODE = 89; // Y — Editor: simulate pending top-up on boot
const FINAL_LEVEL_ID = 50;
const FINAL_LEVEL_NOTICE_TITLE = 'Level 50 Complete!';
const FINAL_LEVEL_NOTICE_MESSAGE =
    'Stay tuned for the next update to unlock more exciting videos!';

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

    /** Nút mở thư viện clip trên Home (prefab panel_clips). */
    @property(Button)
    public clipsButton: Button | null = null;

    /** Label trên nút Clip (hiện "Clip" / "Clip (n)"). */
    @property(Label)
    public clipsButtonLabel: Label | null = null;

    @property(Node)
    public gameScreen: Node | null = null;

    protected onLoad(): void {
        if (GameManager.Instance) {
            this.destroy();
            return;
        }
        GameManager.Instance = this;
        director.addPersistRootNode(this.node);
        this.ensureTeviLoginManager();
        this.applyWebDocumentTitle();

        // Lock web build to 1080x1920 aspect ratio, fit inside browser without stretching.
        view.setDesignResolutionSize(1080, 1920, ResolutionPolicy.SHOW_ALL);

        // Bind sớm — Tevi login có thể xong trước khi hết splash.
        EventBus.getInstance().on(GameEvent.LEVEL_COMPLETED, this.onLevelCompleted, this);
        EventBus.getInstance().on(GameEvent.LEVEL_FAILED, this.onLevelFailed, this);
        EventBus.getInstance().on(GameEvent.REWARD_VIDEO_HISTORY_CHANGED, this.refreshClipsButtonLabel, this);
        EventBus.getInstance().on(GameEvent.REQUEST_CLAIM_PENDING_TOPUPS, this.onRequestClaimPendingTopUps, this);
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
        this.setClipsButtonVisible(true);

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

        // Listen for level end events to switch panels (registered early in onLoad).
        // Editor cheats: 1-9 level, R restart, N next, T win level hiện tại, B booster cheat, U pending banner.
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        this.bindLevelJumpUI();
        this.bindHomeUI();
        this.refreshClipsButtonLabel();
        this.startPlayButtonPulse();
        this.onInitializationReadyForHome();
        void this.tryClaimPendingTopUps();
    }

    /** Editor cheats: 1-9 đổi level, R restart, N next, T thắng, B booster, U banner chờ nạp, Y giả lập boot pending. */
    private onKeyDown(event: EventKeyboard): void {
        if (!this.isEditorCheatEnabled()) return;
        const key = event.keyCode;
        if (key === PENDING_BANNER_DEBUG_KEY_CODE) {
            StarWalletHud.Instance?.debugTogglePendingBanner();
            return;
        }
        if (key === PENDING_BOOT_DEBUG_KEY_CODE) {
            StarWalletHud.Instance?.debugSimulatePendingTopUpOnBoot();
            return;
        }
        if (key === WIN_CURRENT_LEVEL_CHEAT_KEY_CODE) {
            void this.runWinCurrentLevelCheat();
            return;
        }
        if (this._currentState !== GameState.GAMEPLAY) return;
        if (key === BOOSTER_CHEAT_KEY_CODE) {
            const enabled = BoosterManager.getInstance()?.toggleTestBoosterCheat() ?? false;
            console.log(`[Cheat] HINT/UNDO x99: ${enabled ? 'ON' : 'OFF'}`);
        } else if (key >= KeyCode.DIGIT_1 && key <= KeyCode.DIGIT_9) {
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

    /** Cheat T: thắng ngay level đang chơi (không nhảy sang level 5). */
    private async runWinCurrentLevelCheat(): Promise<void> {
        if (this._transitionRunning) return;
        await this.waitForInitialization();

        let currentLevelId = LevelManager.getInstance().getCurrentLevelId();
        if (this._currentState !== GameState.GAMEPLAY || currentLevelId <= 0) {
            currentLevelId = this.getSavedLevelId();
            await this.transitionToGame();
            await this.startLevel(currentLevelId);
        }

        currentLevelId = LevelManager.getInstance().getCurrentLevelId() || currentLevelId;
        console.log(`[Cheat] T → Win level hiện tại: ${currentLevelId}`);
        setTimeout(() => {
            LevelManager.getInstance().completeLevel(false);
        }, 100);
    }

    private async onLevelCompleted(levelId: number, score: number, stars: number): Promise<void> {
        TutorialManager.getInstance().abort();
        try {
            this.stopTimer();
            // Thắng rồi: lưu level tiếp theo để mở lại game tiếp tục đúng tiến trình.
            const nextLevelId = Math.min(FINAL_LEVEL_ID, Math.max(1, levelId + 1));
            SaveManager.getInstance().saveCurrentLevel(nextLevelId);

            if (levelId >= FINAL_LEVEL_ID) {
                await this.handleFinalLevelCompleted(levelId);
                return;
            }

            const panel = await UIManager.getInstance().openPanel('LevelCompletePanel', { levelId, score, stars, elapsedSeconds: this._elapsedSeconds });
            if (!panel) {
                this.returnToMenu();
                return;
            }

            // Thắng mốc clip thì mở video thưởng tương ứng trên R2.
            this.playRewardVideoIfNeeded(levelId);
        } catch (err) {
            this.returnToMenu();
        }
    }

    /** Level 50: bỏ popup win prefab — dùng panel_notice (chỉnh trong Editor). */
    private async handleFinalLevelCompleted(levelId: number): Promise<void> {
        this.ensureNoticePopupPanel();
        const showComingSoonNotice = (): void => {
            NoticePopupPanel.Instance?.show(
                FINAL_LEVEL_NOTICE_TITLE,
                FINAL_LEVEL_NOTICE_MESSAGE,
                () => this.returnToMenu(),
            );
        };

        // Editor/Preview: không có Tevi token → bỏ qua video, hiện thông báo ngay.
        if (EDITOR || PREVIEW) {
            showComingSoonNotice();
            return;
        }

        const isRewardLevel = isRewardVideoLevel(levelId);
        const videoFile = isRewardLevel ? getRewardVideoFileName(levelId) : null;
        if (isRewardLevel && videoFile) {
            this.ensureRewardVideoPlayer();
            TeviLoginManager.Instance?.setDebugStatus(
                `Level ${levelId} xong → xin video ${videoFile}...`,
            );
            RewardVideoPlayer.Instance?.playSecretVideo(videoFile, () => {
                TeviLoginManager.Instance?.setDebugStatus('Đã đóng video level 50 — hiện thông báo coming soon.');
                showComingSoonNotice();
            }, levelId);
            return;
        }

        showComingSoonNotice();
    }

    private playRewardVideoIfNeeded(levelId: number): void {
        const isRewardLevel = isRewardVideoLevel(levelId);
        const videoFile = isRewardLevel ? getRewardVideoFileName(levelId) : null;
        console.log('[RewardVideo][LevelComplete]', {
            levelId,
            unlockLevels: REWARD_VIDEO_UNLOCK_LEVELS,
            isRewardLevel,
            videoFile,
            willCallWorker: isRewardLevel,
            tokenUrl: REWARD_VIDEO_TOKEN_URL,
            requestBody: videoFile ? { file: videoFile } : null,
        });

        if (isRewardLevel && videoFile) {
            this.ensureRewardVideoPlayer();
            TeviLoginManager.Instance?.setDebugStatus(
                `Level ${levelId} xong → xin video ${videoFile}...`,
            );
            console.log(
                `[RewardVideo][LevelComplete] OK → playSecretVideo("${videoFile}")`,
            );
            RewardVideoPlayer.Instance?.playSecretVideo(videoFile, () => {
                TeviLoginManager.Instance?.setDebugStatus('Đã đóng video (xem xong/X), tiếp tục game.');
                console.log('[RewardVideo] Đã đóng video, tiếp tục game.');
            }, levelId);
        } else {
            console.log(
                `[RewardVideo][LevelComplete] Skip video (level ${levelId} không nằm trong ${REWARD_VIDEO_UNLOCK_LEVELS.join('/')})`,
            );
        }
    }

    private async onLevelFailed(levelId: number): Promise<void> {
        TutorialManager.getInstance().abort();
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


    /**
     * Boot tối thiểu để hiện Home nhanh trên web.
     * BGM / panel / tile sprite load lazy — chỉ warm prefab HUD sau Home.
     */
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

        const audioMgr = AudioManager.getInstance();
        if (audioMgr) {
            await audioMgr.initialize();
            audioMgr.bindButtonSounds(this.node);
            audioMgr.bindButtonSounds(this.homeScreen);
            audioMgr.bindButtonSounds(this.gameScreen);
            const canvas = director.getScene()?.getChildByName('Canvas') ?? null;
            audioMgr.bindButtonSounds(canvas);
        }

        await LevelManager.getInstance().initialize();

        // Tile prefab cần sẵn trước khi Play; nhẹ hơn nhiều so với audio/sprites.
        await this.registerTilePrefab();

        UIManager.getInstance().initialize(this.uiRoot);
        AudioManager.getInstance()?.bindButtonSounds(this.uiRoot);
        this.ensureOrderManagers();
        this.ensureRewardVideoPlayer();
        this.ensureStarWalletHud();
        this.ensureNoticePopupPanel();
        // Editor: in sẵn bảng map level→file để xác nhận wiring đúng (không cần máy thật).
        logRewardVideoFilePlan('[RewardVideo][Boot]');
        console.log('[RewardVideo][Boot] Token endpoint =', REWARD_VIDEO_TOKEN_URL);
        console.log(
            '[RewardVideo][Boot] Unlock tại level',
            REWARD_VIDEO_UNLOCK_LEVELS.join(', '),
            '. Cheat Editor: phím T = thắng level hiện tại.',
        );
        console.log('[Save] Level đã lưu khi mở game =', this.getSavedLevelId());

        this.setState(GameState.MAIN_MENU);
    }

    /** Home idle: chỉ cache prefab HUD — không load hết audio/sprite/panel. */
    private deferredBootWarmup(): void {
        void this.runDeferredBootWarmup();
    }

    private async runDeferredBootWarmup(): Promise<void> {
        try {
            await UIManager.getInstance().preloadPanel('GameplayPanel');
        } catch (err) {
            console.warn('[Boot] Deferred warmup failed (non-blocking):', err);
        }
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
    public async startLevel(levelId: number, options?: { parallelTransition?: boolean; skipTutorial?: boolean }): Promise<void> {
        const startToken = ++this._startLevelToken;
        await this.waitForInitialization();
        await this.ensureHomeLevelPrepared(levelId);
        if (startToken !== this._startLevelToken) return;
        this.setState(GameState.GAMEPLAY);
        if (!options?.parallelTransition) {
            if (this.gameScreen) this.gameScreen.active = true;
            if (this.homeScreen) this.homeScreen.active = false;
        }

        // Random BGM + crossfade mỗi lần vào / qua level
        AudioManager.getInstance()?.playRandomMainMusic();
        void AudioManager.getInstance()?.preloadGameplaySfx();

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
            AudioManager.getInstance()?.bindButtonSounds(this.gameScreen);
            this.stopTimer();
            this._elapsedSeconds = 0;
            this.startTimer();
            TutorialManager.getInstance().onGameplayReady(levelId, { skipTutorial: options?.skipTutorial });
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
        TutorialManager.getInstance().abort();
        this.stopTimer();
        this.setState(GameState.MAIN_MENU);
        this._preparedHomeLevelId = 0;
        LevelManager.getInstance().unloadCurrentLevel();
        UIManager.getInstance().closePanel('GameplayPanel');
        UIManager.getInstance().closePanel('LevelCompletePanel');
        UIManager.getInstance().closePanel('LevelFailedPanel');
        UIManager.getInstance().closePanel('LevelSelectPanel');
        UIManager.getInstance().destroyClosedPanels([
            'GameplayPanel',
            'LevelCompletePanel',
            'LevelFailedPanel',
            'LevelSelectPanel',
            'RewardVideoGalleryPanel',
        ]);
        UIManager.getInstance().hideLoading();
        await this.transitionToHome();
    }

    protected onDestroy(): void {
        if (GameManager.Instance === this) {
            GameManager.Instance = null;
            EventBus.getInstance().off(GameEvent.LEVEL_COMPLETED, this.onLevelCompleted, this);
            EventBus.getInstance().off(GameEvent.LEVEL_FAILED, this.onLevelFailed, this);
            EventBus.getInstance().off(GameEvent.REWARD_VIDEO_HISTORY_CHANGED, this.refreshClipsButtonLabel, this);
            EventBus.getInstance().off(GameEvent.REQUEST_CLAIM_PENDING_TOPUPS, this.onRequestClaimPendingTopUps, this);
            input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
            if (this.levelJumpOk) {
                this.levelJumpOk.node.off(Button.EventType.CLICK, this.onClickLevelJump, this);
            }
            if (this.playGameButton) {
                this.playGameButton.node.off(Button.EventType.CLICK, this.onPlayGameClicked, this);
            }
            if (this.clipsButton) {
                this.clipsButton.node.off(Button.EventType.CLICK, this.onClipsButtonClicked, this);
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
        this.bindClipsButton();
        AudioManager.getInstance()?.bindButtonSounds(this.homeScreen);
    }

    /**
     * Nút Clip nằm dưới Home, nhưng label Status/UserInfo trên Canvas che hit-test.
     * Resolve button + đưa lên trên cùng Canvas rồi mới bind CLICK.
     */
    private bindClipsButton(): void {
        if (!this.clipsButton) {
            const found = this.homeScreen?.getChildByName('BtnClips')?.getComponent(Button)
                || this.node.getChildByName('BtnClips')?.getComponent(Button)
                || null;
            if (found) {
                this.clipsButton = found;
                if (!this.clipsButtonLabel) {
                    this.clipsButtonLabel = found.node.getComponentInChildren(Label);
                }
                console.log('[RewardVideo] clipsButton resolve bằng tên BtnClips');
            }
        }

        if (!this.clipsButton) {
            console.warn('[RewardVideo] Chưa gán clipsButton trên GameManager / không tìm thấy BtnClips');
            return;
        }

        this.raiseClipsButtonAboveOverlays();
        this.clipsButton.node.off(Button.EventType.CLICK, this.onClipsButtonClicked, this);
        this.clipsButton.node.on(Button.EventType.CLICK, this.onClipsButtonClicked, this);
        console.log('[RewardVideo] Đã bind CLICK cho BtnClips');
    }

    /** Đưa BtnClips ra Canvas (sau Status) để không bị label debug chặn click. */
    private raiseClipsButtonAboveOverlays(): void {
        const btnNode = this.clipsButton?.node;
        if (!btnNode?.isValid) return;

        const canvas = this.node.parent;
        if (!canvas?.isValid) return;

        const worldPos = btnNode.worldPosition.clone();
        if (btnNode.parent !== canvas) {
            btnNode.setParent(canvas);
            btnNode.setWorldPosition(worldPos);
        }
        btnNode.setSiblingIndex(canvas.children.length - 1);
        btnNode.layer = canvas.layer;
        this.setClipsButtonVisible(!!this.homeScreen?.active);
    }

    private setClipsButtonVisible(visible: boolean): void {
        if (this.clipsButton?.node?.isValid) {
            this.clipsButton.node.active = visible;
        }
    }

    private async onClipsButtonClicked(): Promise<void> {
        console.log('[RewardVideo] Click Clip → open RewardVideoGalleryPanel');
        await this.waitForInitialization();
        this.ensureRewardVideoPlayer();
        RewardVideoPlayer.Instance?.mountOnVisibleRoot();
        const panel = await UIManager.getInstance().openPanel('RewardVideoGalleryPanel');
        if (!panel) {
            console.warn(
                '[RewardVideo] Không mở được panel_clips qua UIManager. Thử fallback runtime...',
            );
            this.openClipsGalleryFallback();
            return;
        }
        // PopupLayer nằm trong GameScreen — khi đang Home thì GameScreen inactive → panel "mở" nhưng không thấy.
        this.mountPanelOnHomeVisibleRoot(panel.node);
        console.log('[RewardVideo] Đã mở gallery clip (prefab) trên Canvas/Home root.');
    }

    /**
     * Gắn panel lên root luôn visible trên Home (Canvas), không để dưới GameScreen/UI.
     */
    private mountPanelOnHomeVisibleRoot(panelNode: Node): void {
        if (!panelNode?.isValid) return;
        const canvas = this.node.parent;
        const parent = canvas?.isValid ? canvas : this.node;
        panelNode.setParent(parent);
        panelNode.setPosition(0, 0, 0);
        panelNode.layer = parent.layer;
        panelNode.active = true;
        panelNode.setSiblingIndex(parent.children.length - 1);

        // Bảo đảm content không bị kẹt scale 0 nếu tween show bị skip khi parent inactive.
        const panel = panelNode.getComponent(RewardVideoGalleryPanel);
        if (panel?.contentNode?.isValid) {
            panel.contentNode.setScale(1, 1, 1);
            panel.contentNode.active = true;
        }
        if (panel?.backgroundBlocker?.isValid) {
            panel.backgroundBlocker.active = true;
        }
    }

    /** Fallback khi prefab Missing Script / load fail: tạo panel runtime trên Canvas. */
    private openClipsGalleryFallback(): void {
        this.ensureRewardVideoPlayer();
        RewardVideoPlayer.Instance?.mountOnVisibleRoot();
        const canvas = this.node.parent;
        const parent = canvas?.isValid ? canvas : this.node;
        let panel = RewardVideoGalleryPanel.Instance;
        if (!panel || !panel.node?.isValid) {
            const node = new Node('RewardVideoGalleryPanel');
            node.layer = parent.layer;
            node.addComponent(UITransform);
            node.setParent(parent);
            node.setPosition(0, 0, 0);
            panel = node.addComponent(RewardVideoGalleryPanel);
        }
        panel.initialize(UIManager.getInstance());
        panel.show();
        this.mountPanelOnHomeVisibleRoot(panel.node);
        console.log('[RewardVideo] Đã mở gallery clip (fallback runtime).');
    }

    private refreshClipsButtonLabel(): void {
        if (!this.clipsButtonLabel) return;
        const count = RewardVideoHistory.getInstance().getCount();
        this.clipsButtonLabel.string = count > 0 ? `Clip (${count})` : 'Clip';
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
        const levelId = this.getSavedLevelId();

        await this.waitForInitialization();
        UIManager.getInstance()?.showLoading('Loading game...');

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
        await LevelManager.getInstance().preloadLevelRuntime(this.getSavedLevelId());
    }

    private getSavedLevelId(): number {
        const savedLevel = SaveManager.getInstance().getCurrentLevel();
        const levelId = savedLevel > 0 ? savedLevel : 1;
        console.log('[Save] getSavedLevelId →', levelId);
        return levelId;
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
        // Music tự load 1 BGM khi play; phần còn lại warm nền.
        void AudioManager.getInstance()?.playRandomMainMusic();
        AudioManager.getInstance()?.bindButtonSounds(this.homeScreen);
        this.deferredBootWarmup();
        this.preloadHomeGameplayAssets();
        void this.tryClaimPendingTopUps();
    }

    /** Sau login / mở Home — nhận ★ order paid nếu user tắt app giữa chừng. */
    private onRequestClaimPendingTopUps(): void {
        void this.tryClaimPendingTopUps();
    }

    private async tryClaimPendingTopUps(): Promise<void> {
        await this.waitForInitialization();
        try {
            await TeviPaymentService.getInstance().claimPendingTopUps();
        } catch (error) {
            const message = error instanceof Error ? error.message : `${error}`;
            StarWalletHud.logStatus(`Claim error: ${message}`);
            console.warn('[GameManager] claimPendingTopUps failed:', error);
        }
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

    /** Tự mount đăng nhập Tevi nếu Scene chưa gắn sẵn component này. */
    private ensureTeviLoginManager(): void {
        const existingManager = director.getScene()?.getComponentInChildren(TeviLoginManager);
        if (!existingManager) {
            this.node.addComponent(TeviLoginManager);
        }
    }

    /** Tự tạo popup VideoPlayer thưởng nếu Scene chưa gắn sẵn. */
    private ensureRewardVideoPlayer(): void {
        const existing = RewardVideoPlayer.Instance
            || director.getScene()?.getComponentInChildren(RewardVideoPlayer)
            || null;
        const canvas = this.node.parent;
        const parent = canvas?.isValid ? canvas : this.node;

        if (existing && existing.node?.isValid) {
            RewardVideoPlayer.Instance = existing;
            existing.node.setParent(parent);
            existing.node.setPosition(0, 0, 0);
            existing.node.layer = parent.layer;
            existing.node.setSiblingIndex(parent.children.length - 1);
            return;
        }

        const rewardNode = new Node('RewardVideoPlayer');
        rewardNode.layer = parent.layer;
        rewardNode.addComponent(UITransform);
        rewardNode.setParent(parent);
        rewardNode.setPosition(0, 0, 0);
        rewardNode.addComponent(RewardVideoPlayer);
        rewardNode.setSiblingIndex(parent.children.length - 1);
        AudioManager.getInstance()?.bindButtonSounds(rewardNode);
    }

    /** HUD ★ trên Canvas (kéo thả StarTopBar trong editor). */
    private ensureStarWalletHud(): void {
        const existing = StarWalletHud.Instance
            || director.getScene()?.getComponentInChildren(StarWalletHud)
            || null;
        if (existing && existing.node?.isValid) {
            StarWalletHud.Instance = existing;
            existing.node.setSiblingIndex(existing.node.parent ? existing.node.parent.children.length - 1 : 0);
            return;
        }

        const parent = this.uiRoot || this.node;
        const hudNode = new Node('StarWalletHud');
        hudNode.layer = parent.layer;
        hudNode.addComponent(UITransform);
        hudNode.setParent(parent);
        hudNode.setPosition(0, 0, 0);
        hudNode.addComponent(StarWalletHud);
        hudNode.setSiblingIndex(parent.children.length - 1);
        AudioManager.getInstance()?.bindButtonSounds(hudNode);
    }

    /** Popup thông báo (level 50 / top-up) — prefab `prefabs/ui/panel_notice`, kéo vào Canvas để chỉnh. */
    private ensureNoticePopupPanel(): void {
        const existing = NoticePopupPanel.Instance
            || director.getScene()?.getComponentInChildren(NoticePopupPanel)
            || null;
        if (existing?.node?.isValid) {
            NoticePopupPanel.Instance = existing;
            return;
        }

        const canvas = director.getScene()?.getChildByName('Canvas');
        const parent = canvas?.isValid ? canvas : this.uiRoot || this.node;
        resources.load('prefabs/ui/panel_notice', Prefab, (err, prefab) => {
            if (err || !prefab) {
                console.warn(
                    '[GameManager] Không load được prefabs/ui/panel_notice. Kéo prefab panel_notice vào Canvas trong Editor.',
                    err,
                );
                return;
            }
            if (NoticePopupPanel.Instance?.node?.isValid) return;
            const node = instantiate(prefab);
            node.name = 'NoticePopupPanel';
            node.setParent(parent);
            node.setPosition(0, 0, 0);
            node.layer = parent.layer;
            node.active = false;
            AudioManager.getInstance()?.bindButtonSounds(node);
            console.log('[GameManager] Đã spawn NoticePopupPanel từ prefab — mở prefab/scene để chỉnh layout.');
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
        this.setClipsButtonVisible(false);
        return this.transitionScreens(this.homeScreen, this.gameScreen);
    }

    private async transitionToHome(): Promise<void> {
        await this.transitionScreens(this.gameScreen, this.homeScreen);
        this.setClipsButtonVisible(true);
        this.raiseClipsButtonAboveOverlays();
        AudioManager.getInstance()?.playRandomMainMusic();
        AudioManager.getInstance()?.bindButtonSounds(this.homeScreen);
        this.startPlayButtonPulse();
        this.preloadHomeGameplayAssets();
    }
}
