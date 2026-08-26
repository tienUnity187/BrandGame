import {
    _decorator,
    BlockInputEvents,
    Button,
    Color,
    Component,
    director,
    Graphics,
    instantiate,
    Label,
    Layers,
    Node,
    Prefab,
    resources,
    UITransform,
    Widget,
    view,
} from 'cc';
import { EDITOR, PREVIEW } from 'cc/env';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../enums/GameEvent';
import { APP_ID, STAR_TOPUP_PACKS, VERSION } from '../TeviConstants';
import { StarWallet } from '../services/StarWallet';
import { TeviPaymentService, PurchasePackOptions } from '../services/TeviPaymentService';
import { TopUpPendingStore } from '../services/TopUpPendingStore';
import { TeviLoginManager } from '../TeviLoginManager';
import { NoticePopupPanel } from './NoticePopupPanel';
import { TopUpResultPopupPanel } from './TopUpResultPopupPanel';
import { TutorialGate } from '../core/TutorialGate';
import { AudioManager } from '../managers/AudioManager';

const { ccclass, property } = _decorator;

/**
 * HUD Star trên Canvas: bar + panel nạp kéo thả trong editor.
 */
@ccclass('StarWalletHud')
export class StarWalletHud extends Component {
    public static Instance: StarWalletHud | null = null;

    @property({ type: Node, tooltip: 'Bar ★ (Balance + Top Up) trên Canvas.' })
    public topBar: Node | null = null;

    @property({ type: Label, tooltip: 'Label số dư trên bar.' })
    public balanceLabel: Label | null = null;

    @property({ type: Button, tooltip: 'Nút mở panel nạp.' })
    public openShopButton: Button | null = null;

    @property({ type: Node, tooltip: 'Panel nạp Star — kéo thả / chỉnh layout trong editor.' })
    public shopPanel: Node | null = null;

    @property({ type: Button, tooltip: 'Nút đóng panel nạp.' })
    public closeShopButton: Button | null = null;

    @property({ type: Label, tooltip: 'Label status debug (optional).' })
    public statusLabel: Label | null = null;

    private _balanceLabel: Label | null = null;
    private _statusLabel: Label | null = null;
    private _shopRoot: Node | null = null;
    private _waitingRoot: Node | null = null;
    private _waitingLabel: Label | null = null;
    private _pendingBannerRoot: Node | null = null;
    private _pendingBannerLabel: Label | null = null;
    private _resultPopupRoot: Node | null = null;
    private _resultPopupOnClose: (() => void) | null = null;
    private _openShopButton: Button | null = null;
    private _built = false;
    private _topUpResultLoading = false;
    private _topUpResultReadyQueue: Array<() => void> = [];
    /** Giữ vài dòng status gần nhất — tránh mất JWT.app vì chạy quá nhanh. */
    private _statusLines: string[] = [];
    private static readonly STATUS_MAX_LINES = 8;
    /** Popup claim chờ HUD/splash sẵn sàng. */
    private static _queuedClaimPopup: { stars: number; balance: number } | null = null;

    protected onLoad(): void {
        if (StarWalletHud.Instance && StarWalletHud.Instance !== this) {
            this.destroy();
            return;
        }
        StarWalletHud.Instance = this;
        this.ensureUi();
        this.refreshBalance();
        EventBus.getInstance().on(GameEvent.STAR_BALANCE_CHANGED, this.onBalanceChanged, this);
        EventBus.getInstance().on(GameEvent.PENDING_TOPUP_CLAIMED, this.onPendingTopUpClaimed, this);
        this.scheduleOnce(() => this.checkPendingTopUpOnBoot(), 1);
        this.flushQueuedClaimPopup();
        this.ensureTopUpResultPopup();
    }

    /**
     * Hiện popup khi claim ★ từ lần nạp trước (tắt app giữa chừng).
     * Gọi trực tiếp từ TeviPaymentService — không phụ thuộc EventBus timing.
     */
    public static notifyTopUpClaimSuccess(totalStars: number, balance: number): void {
        if (totalStars <= 0) return;
        const stars = Math.floor(totalStars);
        const bal = Math.floor(balance);
        const hud = StarWalletHud.Instance;
        if (hud?.node?.isValid) {
            hud.queueClaimSuccessPopup(stars, bal);
            return;
        }
        StarWalletHud._queuedClaimPopup = { stars, balance: bal };
    }

    private flushQueuedClaimPopup(): void {
        if (!StarWalletHud._queuedClaimPopup) return;
        const queued = StarWalletHud._queuedClaimPopup;
        StarWalletHud._queuedClaimPopup = null;
        this.queueClaimSuccessPopup(queued.stars, queued.balance);
    }

    /** Delay ngắn để popup không bị splash/Home che. */
    private queueClaimSuccessPopup(totalStars: number, balance: number): void {
        this.unschedule(this.presentClaimSuccessPopup);
        this.scheduleOnce(this.presentClaimSuccessPopup, 0.9);
        this._queuedPopupStars = totalStars;
        this._queuedPopupBalance = balance;
    }

    private _queuedPopupStars = 0;
    private _queuedPopupBalance = 0;

    private presentClaimSuccessPopup = (): void => {
        const stars = this._queuedPopupStars;
        const balance = this._queuedPopupBalance;
        if (stars <= 0) return;
        this.presentTopUpSuccessPopup(stars, balance, true);
    };

    /** Popup thành công nạp / claim (fromPreviousPurchase = mở lại app sau khi tắt). */
    public presentTopUpSuccessPopup(
        stars: number,
        balance: number,
        fromPreviousPurchase: boolean,
    ): void {
        this.hidePendingBanner();
        this.hideWaiting();
        this.refreshBalance();
        const title = fromPreviousPurchase ? 'Top-up received!' : 'Top-up successful!';
        const message = fromPreviousPurchase
            ? 'Your payment was confirmed.\n\n'
                + `+${stars} added to your wallet!\n`
                + `Total: ${balance}`
            : `+${stars} added!\nTotal: ${balance}`;
        this.ensureTopUpResultPopup(() => {
            const panel = TopUpResultPopupPanel.Instance;
            if (!panel?.node?.isValid) {
                this.showResultPopup(title, message);
                return;
            }
            panel.show(title, message, undefined, {
                topUpSuccess: { stars, balance, fromPreviousPurchase },
            });
        });
        StarWalletHud.logStatus(`Popup: ${title} +${stars}`);
    }

    protected onDestroy(): void {
        this.unschedule(this.presentClaimSuccessPopup);
        EventBus.getInstance().off(GameEvent.STAR_BALANCE_CHANGED, this.onBalanceChanged, this);
        EventBus.getInstance().off(GameEvent.PENDING_TOPUP_CLAIMED, this.onPendingTopUpClaimed, this);
        if (StarWalletHud.Instance === this) {
            StarWalletHud.Instance = null;
        }
    }

    /** Ghi log lên shop Status label + Tevi statusLabel (dùng từ payment/claim mọi lúc). */
    public static logStatus(message: string): void {
        const line = `${message}`.trim();
        if (!line) return;
        if (StarWalletHud.Instance?.node?.isValid) {
            StarWalletHud.Instance.appendStatus(line);
            return;
        }
        TeviLoginManager.Instance?.setDebugStatus(`Star: ${line}`);
        console.log('[StarWalletHud]', line);
    }

    public refreshBalance(): void {
        const balance = StarWallet.getInstance().getBalance();
        if (this._balanceLabel) {
            this._balanceLabel.string = `${balance}`;
        }
    }

    private onBalanceChanged(balance: number): void {
        if (this._balanceLabel) {
            this._balanceLabel.string = `${balance}`;
        }
    }

    private onPendingTopUpClaimed(_totalStars: number, _balance: number): void {
        // Popup via StarWalletHud.notifyTopUpClaimSuccess() in TeviPaymentService.
    }

    /** Sau khi mở lại app — chỉ hiện banner nếu Tevi đã confirm mua mà sao chưa về. */
    private checkPendingTopUpOnBoot(): void {
        const store = TopUpPendingStore.getInstance();
        store.discardUnconfirmedLeftovers();
        if (!store.hasConfirmedUncreditedPurchase()) {
            this.hidePendingBanner();
            EventBus.getInstance().emit(GameEvent.REQUEST_CLAIM_PENDING_TOPUPS);
            return;
        }
        const last = store.getLastTopUpOrder();
        StarWalletHud.logStatus(
            `Claim: waiting for stars${last ? ` (${last.orderId})` : ''}...`,
        );
        this.showPendingBanner(
            'Payment successful!\nWaiting for stars...',
        );
        EventBus.getInstance().emit(GameEvent.REQUEST_CLAIM_PENDING_TOPUPS);
    }

    /** Thêm 1 dòng vào buffer Status (shop panel + Tevi label). */
    public appendStatus(message: string): void {
        this.setStatus(message);
    }

    private setStatus(message: string): void {
        const line = `${message}`.trim();
        if (line) {
            this._statusLines.push(line);
            if (this._statusLines.length > StarWalletHud.STATUS_MAX_LINES) {
                this._statusLines.splice(0, this._statusLines.length - StarWalletHud.STATUS_MAX_LINES);
            }
        }
        const joined = this._statusLines.join('\n');
        if (this._statusLabel) {
            this._statusLabel.string = joined;
        }
        // Dòng cuối (quan trọng nhất / JWT) lên label Tevi để chụp dễ.
        const last = this._statusLines[this._statusLines.length - 1] || message;
        TeviLoginManager.Instance?.setDebugStatus(`Star: ${last}`);
        // Ưu tiên hiện dòng JWT.app nếu còn trong buffer.
        const jwtLine = [...this._statusLines].reverse().find(l => /JWT\.app=/i.test(l)) || last;
        TeviLoginManager.Instance?.setDebugUserInfo(jwtLine);
        console.log('[StarWalletHud]', message);
    }

    private resetStatusLog(seed?: string): void {
        this._statusLines = [];
        if (seed) this.setStatus(seed);
    }

    private ensureUi(): void {
        if (this._built) return;
        this._built = true;

        const root = this.node;
        root.layer = Layers.Enum.UI_2D;
        if (!root.getComponent(UITransform)) root.addComponent(UITransform);

        this.bindEditorTopBar();
        if (!this._balanceLabel || !this._openShopButton) {
            this.createRuntimeTopBar();
        } else if (this._openShopButton.node?.isValid) {
            this._openShopButton.node.off(Button.EventType.CLICK, this.openShop, this);
            this._openShopButton.node.on(Button.EventType.CLICK, this.openShop, this);
        }

        this.bindEditorShop();
        AudioManager.getInstance()?.bindButtonSounds(this.node);
    }

    private bindEditorShop(): void {
        if (!this.shopPanel?.isValid) {
            this.shopPanel = this.node.getChildByName('StarShopPanel');
        }
        if (!this.shopPanel?.isValid) {
            console.warn('[StarWalletHud] Chưa gán StarShopPanel — tạo panel trong editor và kéo vào shopPanel.');
            return;
        }

        this._shopRoot = this.shopPanel;
        this.shopPanel.active = false;

        if (!this.closeShopButton?.node?.isValid) {
            this.closeShopButton = this.shopPanel.getChildByName('BtnCloseShop')?.getComponent(Button) || null;
        }
        if (!this.statusLabel?.node?.isValid) {
            this.statusLabel = this.shopPanel.getChildByName('Status')?.getComponent(Label)
                || this.shopPanel.getChildByPath('Panel/Status')?.getComponent(Label)
                || null;
        }
        this._statusLabel = this.statusLabel;

        if (this.closeShopButton?.node?.isValid) {
            this.closeShopButton.node.off(Button.EventType.CLICK, this.closeShop, this);
            this.closeShopButton.node.on(Button.EventType.CLICK, this.closeShop, this);
        }

        this.bindPackButtons(this.shopPanel);
        const panel = this.shopPanel.getChildByName('Panel');
        if (panel?.isValid) {
            this.bindPackButtons(panel);
        }
    }

    private bindPackButtons(root: Node): void {
        for (const pack of STAR_TOPUP_PACKS) {
            const btnNode = root.getChildByName(`Btn_${pack.id}`);
            if (!btnNode?.isValid) continue;
            const btn = btnNode.getComponent(Button);
            if (!btn) continue;
            btnNode.off(Button.EventType.CLICK);
            btnNode.on(Button.EventType.CLICK, () => void this.onPurchaseClicked(pack.id), this);

            if (EDITOR || PREVIEW) {
                const mockNode = root.getChildByName(`Mock_${pack.id}`);
                if (mockNode?.isValid) {
                    mockNode.off(Button.EventType.CLICK);
                    mockNode.on(Button.EventType.CLICK, () => this.onMockClicked(pack.id), this);
                }
            }
        }

        const clearNode = root.getChildByName('BtnClearToken')
            || root.getChildByPath('Panel/BtnClearToken');
        if (clearNode?.isValid) {
            clearNode.off(Button.EventType.CLICK, this.onClearTokenClicked, this);
            clearNode.on(Button.EventType.CLICK, this.onClearTokenClicked, this);
        }
    }

    private bindEditorTopBar(): void {
        if (!this.topBar?.isValid) {
            this.topBar = this.node.getChildByName('StarTopBar');
        }
        if (!this.balanceLabel && this.topBar?.isValid) {
            this.balanceLabel = this.topBar.getChildByName('BalanceLabel')?.getComponent(Label) || null;
        }
        if (!this.openShopButton && this.topBar?.isValid) {
            this.openShopButton = this.topBar.getChildByName('BtnOpenShop')?.getComponent(Button) || null;
        }
        this._balanceLabel = this.balanceLabel;
        this._openShopButton = this.openShopButton;
    }

    /** Fallback khi chưa kéo bar trên editor — ghim top-right Canvas. */
    private createRuntimeTopBar(): void {
        const topBar = new Node('StarTopBar');
        topBar.layer = Layers.Enum.UI_2D;
        topBar.setParent(this.node);
        const topTransform = topBar.addComponent(UITransform);
        topTransform.setContentSize(300, 64);
        this.alignToCanvas(topBar, { top: 16, right: 16 });

        const topBg = topBar.addComponent(Graphics);
        topBg.fillColor = new Color(20, 20, 28, 200);
        topBg.roundRect(-150, -32, 300, 64, 14);
        topBg.fill();

        const balanceNode = new Node('BalanceLabel');
        balanceNode.layer = Layers.Enum.UI_2D;
        balanceNode.setParent(topBar);
        const balanceTransform = balanceNode.addComponent(UITransform);
        balanceTransform.setContentSize(170, 52);
        balanceNode.setPosition(-58, 0, 0);
        this._balanceLabel = balanceNode.addComponent(Label);
        this._balanceLabel.string = '0';
        this._balanceLabel.fontSize = 30;
        this._balanceLabel.lineHeight = 34;
        this._balanceLabel.color = new Color(255, 220, 90, 255);
        this._balanceLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        this._balanceLabel.verticalAlign = Label.VerticalAlign.CENTER;

        const openNode = this.createButton(topBar, 'BtnOpenShop', 'Top Up', 108, 48, 86, 0);
        this._openShopButton = openNode.getComponent(Button);
        openNode.on(Button.EventType.CLICK, this.openShop, this);

        this.topBar = topBar;
        this.balanceLabel = this._balanceLabel;
        this.openShopButton = this._openShopButton;
    }

    private getCanvasNode(): Node | null {
        const parent = this.node.parent;
        if (parent?.isValid && parent.name === 'Canvas') return parent;
        return director.getScene()?.getChildByName('Canvas') ?? parent ?? null;
    }

    /** Modal full-screen trên Canvas — luôn trên cùng, chặn tap xuống game. */
    private mountModalOnCanvas(modal: Node): void {
        const canvas = this.getCanvasNode();
        if (!canvas?.isValid || !modal?.isValid) return;
        modal.setParent(canvas);
        modal.setPosition(0, 0, 0);
        modal.layer = canvas.layer;
        this.alignToCanvas(modal, { fullStretch: true });
        modal.setSiblingIndex(canvas.children.length - 1);
        const widget = modal.getComponent(Widget);
        widget?.updateAlignment();
    }

    private alignToCanvas(
        node: Node,
        opts: { top?: number; right?: number; fullStretch?: boolean; topCenter?: boolean } = {},
    ): void {
        const canvas = this.getCanvasNode();
        let widget = node.getComponent(Widget);
        if (!widget) widget = node.addComponent(Widget);
        if (canvas?.isValid) widget.target = canvas;
        widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
        if (opts.fullStretch) {
            widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
            widget.isAlignHorizontalCenter = false;
            widget.top = widget.bottom = widget.left = widget.right = 0;
            return;
        }
        widget.isAlignBottom = false;
        widget.isAlignLeft = false;
        widget.isAlignTop = true;
        widget.top = opts.top ?? 16;
        if (opts.topCenter) {
            widget.isAlignRight = false;
            widget.isAlignHorizontalCenter = true;
            widget.horizontalCenter = 0;
            return;
        }
        widget.isAlignHorizontalCenter = false;
        widget.isAlignRight = true;
        widget.right = opts.right ?? 16;
    }

    private onClearTokenClicked(): void {
        const before = TeviLoginManager.Instance?.getTokenAppId() || '?';
        TeviLoginManager.Instance?.clearTeviSession(`was JWT.app=${before}`);
        this.resetStatusLog(
            `Cleared token (was JWT.app=${before}). Đóng Mini App → mở lại ${APP_ID} trên Tevi → login.`,
        );
        // Thử xin token mới ngay nếu bridge còn sống.
        TeviLoginManager.Instance?.forceReLoginWithPopup();
    }

    private createButton(
        parent: Node,
        name: string,
        text: string,
        w: number,
        h: number,
        x: number,
        y: number,
    ): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.setParent(parent);
        const transform = node.addComponent(UITransform);
        transform.setContentSize(w, h);
        node.setPosition(x, y, 0);

        const gfx = node.addComponent(Graphics);
        gfx.fillColor = new Color(90, 60, 160, 255);
        gfx.roundRect(-w * 0.5, -h * 0.5, w, h, 14);
        gfx.fill();

        const button = node.addComponent(Button);
        button.transition = Button.Transition.SCALE;
        button.zoomScale = 0.94;

        const labelNode = new Node('Label');
        labelNode.layer = Layers.Enum.UI_2D;
        labelNode.setParent(node);
        const labelTransform = labelNode.addComponent(UITransform);
        labelTransform.setContentSize(w - 16, h - 8);
        const label = labelNode.addComponent(Label);
        label.string = text;
        label.fontSize = 28;
        label.lineHeight = 32;
        label.color = Color.WHITE;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        return node;
    }

    /** Coin / star bar used by the first-time tutorial pointer. */
    public getCoinBarNode(): Node | null {
        return this.topBar
            || this._openShopButton?.node
            || this.node.getChildByName('StarTopBar')
            || null;
    }

    public isShopOpen(): boolean {
        return !!this._shopRoot?.isValid && this._shopRoot.active;
    }

    /** Open the top-up shop. Tutorial hotspot uses force=true. */
    public openShopForced(): void {
        this.openShopInternal(true);
    }

    private openShop(): void {
        this.openShopInternal(false);
    }

    private openShopInternal(force: boolean): void {
        if (!force && !TutorialGate.canOpenShop()) return;
        if (!this._shopRoot?.isValid) {
            console.warn('[StarWalletHud] StarShopPanel chưa được gán trong editor.');
            return;
        }
        this._shopRoot.active = true;
        const jwtApp = TeviLoginManager.Instance?.getTokenAppId() || '(chưa login)';
        this.resetStatusLog(
            `Shop v${VERSION} | expect APP_ID=${APP_ID} | token JWT.app=${jwtApp}`,
        );
        this.refreshBalance();
        const parent = this.node.parent;
        if (parent) {
            this.node.setSiblingIndex(parent.children.length - 1);
        }
        EventBus.getInstance().emit(GameEvent.STAR_SHOP_OPENED);
    }

    private closeShop(): void {
        const wasOpen = !!this._shopRoot?.active;
        if (this._shopRoot) this._shopRoot.active = false;
        if (wasOpen) {
            EventBus.getInstance().emit(GameEvent.STAR_SHOP_CLOSED);
        }
    }

    private bringToFront(): void {
        const parent = this.node.parent;
        if (parent) {
            this.node.setSiblingIndex(parent.children.length - 1);
        }
    }

    private ensureWaitingOverlay(): void {
        if (this._waitingRoot?.isValid && this._waitingRoot.getChildByName('Dim')) return;
        if (this._waitingRoot?.isValid) {
            this._waitingRoot.destroy();
            this._waitingRoot = null;
            this._waitingLabel = null;
        }

        const design = view.getDesignResolutionSize();
        const width = design.width || 1080;
        const height = design.height || 1920;

        const overlay = new Node('TopUpWaiting');
        overlay.layer = Layers.Enum.UI_2D;
        overlay.setParent(this.getCanvasNode() ?? this.node);
        overlay.active = false;

        const transform = overlay.addComponent(UITransform);
        transform.setContentSize(width, height);
        overlay.addComponent(BlockInputEvents);
        this.alignToCanvas(overlay, { fullStretch: true });

        const dim = new Node('Dim');
        dim.layer = Layers.Enum.UI_2D;
        dim.setParent(overlay);
        const dimTransform = dim.addComponent(UITransform);
        dimTransform.setContentSize(width, height);
        dim.addComponent(BlockInputEvents);
        const bgGfx = dim.addComponent(Graphics);
        bgGfx.fillColor = new Color(0, 0, 0, 210);
        bgGfx.rect(-width * 0.5, -height * 0.5, width, height);
        bgGfx.fill();

        const labelNode = new Node('Label');
        labelNode.layer = Layers.Enum.UI_2D;
        labelNode.setParent(overlay);
        const labelTransform = labelNode.addComponent(UITransform);
        labelTransform.setContentSize(width - 120, 160);
        this._waitingLabel = labelNode.addComponent(Label);
        this._waitingLabel.string = 'Processing...';
        this._waitingLabel.fontSize = 34;
        this._waitingLabel.lineHeight = 42;
        this._waitingLabel.color = Color.WHITE;
        this._waitingLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        this._waitingLabel.verticalAlign = Label.VerticalAlign.CENTER;
        this._waitingLabel.enableWrapText = true;

        this._waitingRoot = overlay;
    }

    private showWaiting(message: string): void {
        this.ensureWaitingOverlay();
        if (this._waitingLabel) this._waitingLabel.string = message;
        if (this._waitingRoot) {
            this.mountModalOnCanvas(this._waitingRoot);
            this._waitingRoot.active = true;
        }
    }

    private hideWaiting(): void {
        if (this._waitingRoot) this._waitingRoot.active = false;
    }

    private ensurePendingBanner(): void {
        if (this._pendingBannerRoot) return;

        const banner = new Node('TopUpPendingBanner');
        banner.layer = Layers.Enum.UI_2D;
        banner.setParent(this.node);
        banner.active = false;

        const transform = banner.addComponent(UITransform);
        transform.setContentSize(640, 120);
        this.alignToCanvas(banner, { top: 96, topCenter: true });

        const bgGfx = banner.addComponent(Graphics);
        bgGfx.fillColor = new Color(30, 120, 70, 230);
        bgGfx.roundRect(-320, -60, 640, 120, 20);
        bgGfx.fill();

        const labelNode = new Node('Label');
        labelNode.layer = Layers.Enum.UI_2D;
        labelNode.setParent(banner);
        const labelTransform = labelNode.addComponent(UITransform);
        labelTransform.setContentSize(600, 100);
        this._pendingBannerLabel = labelNode.addComponent(Label);
        this._pendingBannerLabel.string = '';
        this._pendingBannerLabel.fontSize = 28;
        this._pendingBannerLabel.lineHeight = 34;
        this._pendingBannerLabel.color = Color.WHITE;
        this._pendingBannerLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        this._pendingBannerLabel.verticalAlign = Label.VerticalAlign.CENTER;
        this._pendingBannerLabel.enableWrapText = true;

        this._pendingBannerRoot = banner;
    }

    private showPendingBanner(message: string): void {
        this.ensurePendingBanner();
        if (this._pendingBannerLabel) this._pendingBannerLabel.string = message;
        if (this._pendingBannerRoot) this._pendingBannerRoot.active = true;
        this.bringToFront();
    }

    private hidePendingBanner(): void {
        if (this._pendingBannerRoot) this._pendingBannerRoot.active = false;
    }

    /** Popup top-up (thiếu sao / failed / success) — prefab `panel_topup_result`. */
    private ensureTopUpResultPopup(onReady?: () => void): void {
        const existing = TopUpResultPopupPanel.Instance
            || director.getScene()?.getComponentInChildren(TopUpResultPopupPanel)
            || null;
        if (existing?.node?.isValid) {
            TopUpResultPopupPanel.Instance = existing;
            onReady?.();
            return;
        }
        if (onReady) this._topUpResultReadyQueue.push(onReady);
        if (this._topUpResultLoading) return;
        this._topUpResultLoading = true;

        const canvas = this.getCanvasNode();
        const parent = canvas?.isValid ? canvas : this.node;
        resources.load('prefabs/ui/panel_topup_result', Prefab, (err, prefab) => {
            this._topUpResultLoading = false;
            if (err || !prefab) {
                console.warn(
                    '[StarWalletHud] Không load panel_topup_result — dùng popup runtime fallback.',
                    err,
                );
                this.flushTopUpResultReady();
                return;
            }
            if (!TopUpResultPopupPanel.Instance?.node?.isValid) {
                const node = instantiate(prefab);
                node.name = 'TopUpResultPopupPanel';
                node.setParent(parent);
                node.setPosition(0, 0, 0);
                node.layer = parent.layer;
                node.active = false;
                console.log('[StarWalletHud] Spawn TopUpResultPopupPanel từ prefab.');
            }
            this.flushTopUpResultReady();
        });
    }

    private flushTopUpResultReady(): void {
        const queued = this._topUpResultReadyQueue.splice(0);
        for (const fn of queued) fn();
    }

    private ensureResultPopup(): void {
        if (this._resultPopupRoot) return;

        const design = view.getDesignResolutionSize();
        const width = design.width || 1080;
        const height = design.height || 1920;

        const popup = new Node('TopUpResultPopup');
        popup.layer = Layers.Enum.UI_2D;
        popup.setParent(this.getCanvasNode() ?? this.node);
        popup.active = false;

        const rootTransform = popup.addComponent(UITransform);
        rootTransform.setContentSize(width, height);
        popup.addComponent(BlockInputEvents);
        this.alignToCanvas(popup, { fullStretch: true });

        const dim = new Node('Dim');
        dim.layer = Layers.Enum.UI_2D;
        dim.setParent(popup);
        const dimTransform = dim.addComponent(UITransform);
        dimTransform.setContentSize(width, height);
        dim.addComponent(BlockInputEvents);
        const dimGfx = dim.addComponent(Graphics);
        dimGfx.fillColor = new Color(0, 0, 0, 160);
        dimGfx.rect(-width * 0.5, -height * 0.5, width, height);
        dimGfx.fill();

        const panel = new Node('Panel');
        panel.layer = Layers.Enum.UI_2D;
        panel.setParent(popup);
        const panelTransform = panel.addComponent(UITransform);
        panelTransform.setContentSize(560, 360);
        const panelGfx = panel.addComponent(Graphics);
        panelGfx.fillColor = new Color(36, 32, 48, 250);
        panelGfx.roundRect(-280, -180, 560, 360, 24);
        panelGfx.fill();

        const titleNode = new Node('Title');
        titleNode.layer = Layers.Enum.UI_2D;
        titleNode.setParent(panel);
        titleNode.setPosition(0, 100, 0);
        const titleTransform = titleNode.addComponent(UITransform);
        titleTransform.setContentSize(500, 64);
        const titleLabel = titleNode.addComponent(Label);
        titleLabel.string = 'Notice';
        titleLabel.fontSize = 38;
        titleLabel.lineHeight = 44;
        titleLabel.color = new Color(255, 220, 90, 255);
        titleLabel.horizontalAlign = Label.HorizontalAlign.CENTER;

        const bodyNode = new Node('Body');
        bodyNode.layer = Layers.Enum.UI_2D;
        bodyNode.setParent(panel);
        bodyNode.setPosition(0, 10, 0);
        const bodyTransform = bodyNode.addComponent(UITransform);
        bodyTransform.setContentSize(500, 140);
        const bodyLabel = bodyNode.addComponent(Label);
        bodyLabel.string = '';
        bodyLabel.fontSize = 30;
        bodyLabel.lineHeight = 38;
        bodyLabel.color = Color.WHITE;
        bodyLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        bodyLabel.verticalAlign = Label.VerticalAlign.CENTER;
        bodyLabel.enableWrapText = true;

        const okBtn = this.createButton(panel, 'BtnOk', 'OK', 220, 64, 0, -120);
        okBtn.on(Button.EventType.CLICK, this.onResultPopupOkClicked, this);

        this._resultPopupRoot = popup;
        AudioManager.getInstance()?.bindButtonSounds(popup);
    }

    /** Popup khi booster không đủ ★ — dùng panel_topup_result + clone thanh nạp. */
    public notifyInsufficientStars(cost: number, actionName: string): void {
        const balance = StarWallet.getInstance().getBalance();
        const title = 'Not enough coins';
        const message =
            `You need ${cost} coins to use ${actionName}.\n`
            + `Your balance: ${balance} coins`;
        this.ensureTopUpResultPopup(() => this.presentInsufficientBoosterPopup(title, message, {
            cost,
            actionName,
            balance,
        }));
    }

    private presentInsufficientBoosterPopup(
        title: string,
        message: string,
        shortage: { cost: number; actionName: string; balance: number },
    ): void {
        const panel = TopUpResultPopupPanel.Instance;
        if (!panel?.node?.isValid) {
            this.showResultPopup(title, message);
            return;
        }
        panel.show(title, message, undefined, {
            topUpBarSource: this.getCoinBarNode(),
            onTopUpClicked: () => this.openShopForced(),
            boosterShortage: shortage,
        });
    }

    /** Popup thông báo — ưu tiên panel_notice trong scene/prefab. */
    public showNoticePopup(title: string, message: string, onClose?: () => void): void {
        if (NoticePopupPanel.Instance?.node?.isValid) {
            NoticePopupPanel.Instance.show(title, message, onClose);
            return;
        }
        this._resultPopupOnClose = onClose ?? null;
        this.showResultPopup(title, message, onClose);
    }

    private onResultPopupOkClicked(): void {
        const onClose = this._resultPopupOnClose;
        this._resultPopupOnClose = null;
        if (this._resultPopupRoot) this._resultPopupRoot.active = false;
        onClose?.();
    }

    private showResultPopup(title: string, message: string, onClose?: () => void): void {
        if (TopUpResultPopupPanel.Instance?.node?.isValid) {
            TopUpResultPopupPanel.Instance.show(title, message, onClose);
            return;
        }
        this.ensureResultPopup();
        if (!this._resultPopupRoot) return;

        const panel = this._resultPopupRoot.getChildByName('Panel');
        const titleLabel = panel?.getChildByName('Title')?.getComponent(Label);
        const bodyLabel = panel?.getChildByName('Body')?.getComponent(Label);
        if (titleLabel) titleLabel.string = title;
        if (bodyLabel) bodyLabel.string = message;

        this.mountModalOnCanvas(this._resultPopupRoot);
        this._resultPopupRoot.active = true;
    }

    private hideResultPopup(): void {
        if (this._resultPopupRoot) this._resultPopupRoot.active = false;
        this._resultPopupOnClose = null;
        TopUpResultPopupPanel.Instance?.hide();
    }

    private buildPurchaseOptions(): PurchasePackOptions {
        return {
            onStatus: (msg) => this.setStatus(msg),
            onTeviDialog: () => this.showWaiting('Confirm payment in Tevi...'),
            onTeviDialogClosed: (ok) => {
                this.hideWaiting();
                if (ok) {
                    this.showPendingBanner('Payment successful!\nWaiting for stars...');
                }
            },
            onAwaitingStars: () => {
                this.showPendingBanner('Payment successful!\nWaiting for stars...');
            },
            onSuccess: (stars, balance) => {
                this.hidePendingBanner();
                this.hideWaiting();
                this.presentTopUpSuccessPopup(stars, balance, false);
            },
            onError: (message) => {
                this.hidePendingBanner();
                this.hideWaiting();
                const title = /not enough tevi stars/i.test(message)
                    ? 'Insufficient Tevi Stars'
                    : 'Top-up failed';
                this._resultPopupOnClose = null;
                this.showResultPopup(title, message);
            },
        };
    }

    private isEditorOrPreview(): boolean {
        return !!(EDITOR || PREVIEW);
    }

    private hasTeviTopupBridge(): boolean {
        return typeof window !== 'undefined' && typeof window.TeviJS?.topup === 'function';
    }

    private async onPurchaseClicked(packId: string): Promise<void> {
        if (TeviPaymentService.getInstance().isBusy()) {
            this.showResultPopup('Processing', 'Previous transaction still in progress. Please wait.');
            return;
        }

        this.closeShop();
        this.hidePendingBanner();
        this.hideResultPopup();
        this.showWaiting('Preparing top-up...');

        const options = this.buildPurchaseOptions();

        // Editor/Preview: Mock để test UI. Bản build thật KHÔNG được fallback Mock.
        if (this.isEditorOrPreview()) {
            this.resetStatusLog(`[Editor] Pack ${packId} → Mock`);
            const mockResult = await TeviPaymentService.getInstance().mockGrantPack(packId, {
                ...options,
                onTeviDialog: () => this.showWaiting('Simulating Tevi...'),
                onTeviDialogClosed: (ok) => {
                    this.hideWaiting();
                    if (ok) this.showPendingBanner('Simulated payment OK\nWaiting for stars...');
                },
            });
            this.hideWaiting();
            this.hidePendingBanner();
            if (mockResult.ok) {
                this.refreshBalance();
            } else {
                options.onError?.(mockResult.message);
            }
            return;
        }

        if (!this.hasTeviTopupBridge()) {
            this.hideWaiting();
            this.showResultPopup(
                'Not supported',
                'Missing TeviJS.topup — open the game in the Tevi app.',
            );
            return;
        }

        const token = TeviLoginManager.Instance?.getUserToken()?.trim() || '';
        if (!token) {
            this.hideWaiting();
            this.showResultPopup('Not logged in', 'Missing user_app_token. Please log in to Tevi again.');
            return;
        }

        this.resetStatusLog(`Starting REAL top-up pack=${packId}`);
        await TeviPaymentService.getInstance().purchasePack(packId, options);
        this.refreshBalance();
    }

    private async onMockClicked(packId: string): Promise<void> {
        if (TeviPaymentService.getInstance().isBusy()) {
            this.showResultPopup('Processing', 'Previous transaction still in progress. Please wait.');
            return;
        }

        this.closeShop();
        this.showWaiting('Simulating top-up...');
        this.resetStatusLog(`[Mock] Starting pack=${packId}`);

        const options = this.buildPurchaseOptions();
        const result = await TeviPaymentService.getInstance().mockGrantPack(packId, {
            ...options,
            onTeviDialog: () => this.showWaiting('Simulating Tevi...'),
            onTeviDialogClosed: (ok) => {
                this.hideWaiting();
                if (ok) this.showPendingBanner('Simulated payment OK\nWaiting for stars...');
            },
        });

        this.hideWaiting();
        this.hidePendingBanner();
        if (!result.ok) {
            options.onError?.(result.message);
        }
        this.refreshBalance();
    }
}
