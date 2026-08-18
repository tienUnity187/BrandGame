import {
    _decorator,
    BlockInputEvents,
    Button,
    Color,
    Component,
    Graphics,
    Label,
    Layers,
    Node,
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

const { ccclass } = _decorator;

/**
 * HUD Star luôn hiện trên cùng + panel sandbox nạp Star (tự tạo runtime).
 */
@ccclass('StarWalletHud')
export class StarWalletHud extends Component {
    public static Instance: StarWalletHud | null = null;

    private _balanceLabel: Label | null = null;
    private _statusLabel: Label | null = null;
    private _shopRoot: Node | null = null;
    private _waitingRoot: Node | null = null;
    private _waitingLabel: Label | null = null;
    private _pendingBannerRoot: Node | null = null;
    private _pendingBannerLabel: Label | null = null;
    private _resultPopupRoot: Node | null = null;
    private _openShopButton: Button | null = null;
    private _built = false;
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
                + `+${stars}★ added to your wallet!\n`
                + `Total: ${balance}★`
            : `+${stars}★ added!\nTotal: ${balance}★`;
        this.showResultPopup(title, message);
        StarWalletHud.logStatus(`Popup: ${title} +${stars}★`);
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
            this._balanceLabel.string = `★ ${balance}`;
        }
    }

    private onBalanceChanged(balance: number): void {
        if (this._balanceLabel) {
            this._balanceLabel.string = `★ ${balance}`;
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

        const design = view.getDesignResolutionSize();
        const width = design.width || 1080;
        const height = design.height || 1920;

        const root = this.node;
        root.layer = Layers.Enum.UI_2D;
        let rootTransform = root.getComponent(UITransform);
        if (!rootTransform) rootTransform = root.addComponent(UITransform);
        rootTransform.setContentSize(width, height);

        // --- Top bar balance + open shop ---
        const topBar = new Node('StarTopBar');
        topBar.layer = Layers.Enum.UI_2D;
        topBar.setParent(root);
        const topTransform = topBar.addComponent(UITransform);
        topTransform.setContentSize(420, 72);
        topBar.setPosition(0, height * 0.5 - 56, 0);

        const topBg = topBar.addComponent(Graphics);
        topBg.fillColor = new Color(20, 20, 28, 180);
        topBg.roundRect(-210, -36, 420, 72, 16);
        topBg.fill();

        const balanceNode = new Node('BalanceLabel');
        balanceNode.layer = Layers.Enum.UI_2D;
        balanceNode.setParent(topBar);
        const balanceTransform = balanceNode.addComponent(UITransform);
        balanceTransform.setContentSize(240, 60);
        balanceNode.setPosition(-60, 0, 0);
        this._balanceLabel = balanceNode.addComponent(Label);
        this._balanceLabel.string = '★ 0';
        this._balanceLabel.fontSize = 36;
        this._balanceLabel.lineHeight = 40;
        this._balanceLabel.color = new Color(255, 220, 90, 255);
        this._balanceLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        this._balanceLabel.verticalAlign = Label.VerticalAlign.CENTER;

        const openNode = this.createButton(topBar, 'BtnOpenShop', 'Top Up', 120, 56, 110, 0);
        this._openShopButton = openNode.getComponent(Button);
        openNode.on(Button.EventType.CLICK, this.openShop, this);

        // --- Shop overlay ---
        const shop = new Node('StarShopPanel');
        shop.layer = Layers.Enum.UI_2D;
        shop.setParent(root);
        shop.active = false;
        this._shopRoot = shop;

        const shopTransform = shop.addComponent(UITransform);
        shopTransform.setContentSize(width, height);
        const shopWidget = shop.addComponent(Widget);
        shopWidget.isAlignTop = true;
        shopWidget.isAlignBottom = true;
        shopWidget.isAlignLeft = true;
        shopWidget.isAlignRight = true;
        shopWidget.top = 0;
        shopWidget.bottom = 0;
        shopWidget.left = 0;
        shopWidget.right = 0;
        shopWidget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
        shop.addComponent(BlockInputEvents);

        const overlay = new Node('Overlay');
        overlay.layer = Layers.Enum.UI_2D;
        overlay.setParent(shop);
        const overlayTransform = overlay.addComponent(UITransform);
        overlayTransform.setContentSize(width, height);
        const overlayGfx = overlay.addComponent(Graphics);
        overlayGfx.fillColor = new Color(0, 0, 0, 200);
        overlayGfx.rect(-width * 0.5, -height * 0.5, width, height);
        overlayGfx.fill();

        const panel = new Node('Panel');
        panel.layer = Layers.Enum.UI_2D;
        panel.setParent(shop);
        const panelTransform = panel.addComponent(UITransform);
        panelTransform.setContentSize(640, 720);
        const panelGfx = panel.addComponent(Graphics);
        panelGfx.fillColor = new Color(32, 28, 40, 245);
        panelGfx.roundRect(-320, -360, 640, 720, 24);
        panelGfx.fill();

        const titleNode = new Node('Title');
        titleNode.layer = Layers.Enum.UI_2D;
        titleNode.setParent(panel);
        const titleTransform = titleNode.addComponent(UITransform);
        titleTransform.setContentSize(560, 64);
        titleNode.setPosition(0, 280, 0);
        const title = titleNode.addComponent(Label);
        title.string = 'Sandbox Top Up Stars';
        title.fontSize = 40;
        title.lineHeight = 48;
        title.color = Color.WHITE;
        title.horizontalAlign = Label.HorizontalAlign.CENTER;

        const statusNode = new Node('Status');
        statusNode.layer = Layers.Enum.UI_2D;
        statusNode.setParent(panel);
        const statusTransform = statusNode.addComponent(UITransform);
        statusTransform.setContentSize(560, 140);
        statusNode.setPosition(0, 210, 0);
        this._statusLabel = statusNode.addComponent(Label);
        this._statusLabel.string = this.isEditorOrPreview()
            ? 'Editor: packs/Mock are simulated. Step-by-step status appears here.'
            : 'Tevi build: top up via top-up-signature + TeviJS.topup. Status appears here.';
        this._statusLabel.fontSize = 20;
        this._statusLabel.lineHeight = 26;
        this._statusLabel.overflow = Label.Overflow.RESIZE_HEIGHT;
        this._statusLabel.enableWrapText = true;
        this._statusLabel.color = new Color(200, 200, 210, 255);
        this._statusLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        this._statusLabel.verticalAlign = Label.VerticalAlign.TOP;

        const showMockButtons = EDITOR || PREVIEW;
        let y = 80;
        for (const pack of STAR_TOPUP_PACKS) {
            const btn = this.createButton(panel, `Btn_${pack.id}`, pack.label, 480, 72, 0, y);
            btn.on(Button.EventType.CLICK, () => void this.onPurchaseClicked(pack.id), this);

            // Mock chỉ hiện Editor/Preview — bản build Tevi thật không có nút cộng ★ miễn phí.
            if (showMockButtons) {
                const mockBtn = this.createButton(
                    panel,
                    `Mock_${pack.id}`,
                    `Mock ${pack.stars}★`,
                    200,
                    48,
                    0,
                    y - 56,
                );
                const mockLabel = mockBtn.getComponentInChildren(Label);
                if (mockLabel) mockLabel.fontSize = 22;
                mockBtn.on(Button.EventType.CLICK, () => this.onMockClicked(pack.id), this);
                y -= 140;
            } else {
                y -= 96;
            }
        }

        const clearBtn = this.createButton(panel, 'BtnClearToken', 'Clear Token', 240, 56, 0, -280);
        const clearLabel = clearBtn.getComponentInChildren(Label);
        if (clearLabel) clearLabel.fontSize = 24;
        clearBtn.on(Button.EventType.CLICK, this.onClearTokenClicked, this);

        const closeBtn = this.createButton(panel, 'BtnCloseShop', 'Close', 200, 64, 0, -350);
        closeBtn.on(Button.EventType.CLICK, this.closeShop, this);
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

    private openShop(): void {
        if (!this._shopRoot) return;
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
    }

    private closeShop(): void {
        if (this._shopRoot) this._shopRoot.active = false;
    }

    private bringToFront(): void {
        const parent = this.node.parent;
        if (parent) {
            this.node.setSiblingIndex(parent.children.length - 1);
        }
    }

    private ensureWaitingOverlay(): void {
        if (this._waitingRoot) return;

        const design = view.getDesignResolutionSize();
        const width = design.width || 1080;
        const height = design.height || 1920;

        const overlay = new Node('TopUpWaiting');
        overlay.layer = Layers.Enum.UI_2D;
        overlay.setParent(this.node);
        overlay.active = false;
        overlay.addComponent(BlockInputEvents);

        const transform = overlay.addComponent(UITransform);
        transform.setContentSize(width, height);
        const widget = overlay.addComponent(Widget);
        widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
        widget.top = widget.bottom = widget.left = widget.right = 0;
        widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;

        const bgGfx = overlay.addComponent(Graphics);
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
        if (this._waitingRoot) this._waitingRoot.active = true;
        this.bringToFront();
    }

    private hideWaiting(): void {
        if (this._waitingRoot) this._waitingRoot.active = false;
    }

    private ensurePendingBanner(): void {
        if (this._pendingBannerRoot) return;

        const design = view.getDesignResolutionSize();
        const width = design.width || 1080;
        const height = design.height || 1920;

        const banner = new Node('TopUpPendingBanner');
        banner.layer = Layers.Enum.UI_2D;
        banner.setParent(this.node);
        banner.active = false;

        const transform = banner.addComponent(UITransform);
        transform.setContentSize(640, 120);
        banner.setPosition(0, height * 0.5 - 180, 0);

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

    private ensureResultPopup(): void {
        if (this._resultPopupRoot) return;

        const design = view.getDesignResolutionSize();
        const width = design.width || 1080;
        const height = design.height || 1920;

        const popup = new Node('TopUpResultPopup');
        popup.layer = Layers.Enum.UI_2D;
        popup.setParent(this.node);
        popup.active = false;
        popup.addComponent(BlockInputEvents);

        const rootTransform = popup.addComponent(UITransform);
        rootTransform.setContentSize(width, height);
        const widget = popup.addComponent(Widget);
        widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
        widget.top = widget.bottom = widget.left = widget.right = 0;
        widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;

        const dim = new Node('Dim');
        dim.layer = Layers.Enum.UI_2D;
        dim.setParent(popup);
        const dimTransform = dim.addComponent(UITransform);
        dimTransform.setContentSize(width, height);
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
        okBtn.on(Button.EventType.CLICK, () => this.hideResultPopup(), this);

        this._resultPopupRoot = popup;
    }

    private showResultPopup(title: string, message: string): void {
        this.ensureResultPopup();
        if (!this._resultPopupRoot) return;

        const titleLabel = this._resultPopupRoot.getChildByName('Panel')
            ?.getChildByName('Title')
            ?.getComponent(Label);
        const bodyLabel = this._resultPopupRoot.getChildByName('Panel')
            ?.getChildByName('Body')
            ?.getComponent(Label);
        if (titleLabel) titleLabel.string = title;
        if (bodyLabel) bodyLabel.string = message;

        this._resultPopupRoot.active = true;
        const popupParent = this._resultPopupRoot.parent;
        if (popupParent?.isValid) {
            this._resultPopupRoot.setSiblingIndex(popupParent.children.length - 1);
        }
        this.bringToFront();
    }

    private hideResultPopup(): void {
        if (this._resultPopupRoot) this._resultPopupRoot.active = false;
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
                this.showResultPopup('Top-up failed', message);
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
