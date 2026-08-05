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
import { STAR_TOPUP_PACKS } from '../TeviConstants';
import { StarWallet } from '../services/StarWallet';
import { TeviPaymentService } from '../services/TeviPaymentService';
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
    private _openShopButton: Button | null = null;
    private _built = false;

    protected onLoad(): void {
        if (StarWalletHud.Instance && StarWalletHud.Instance !== this) {
            this.destroy();
            return;
        }
        StarWalletHud.Instance = this;
        this.ensureUi();
        this.refreshBalance();
        EventBus.getInstance().on(GameEvent.STAR_BALANCE_CHANGED, this.onBalanceChanged, this);
    }

    protected onDestroy(): void {
        EventBus.getInstance().off(GameEvent.STAR_BALANCE_CHANGED, this.onBalanceChanged, this);
        if (StarWalletHud.Instance === this) {
            StarWalletHud.Instance = null;
        }
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

    private setStatus(message: string): void {
        if (this._statusLabel) {
            this._statusLabel.string = message;
        }
        // Đồng bộ lên label Tevi login để thấy ngay cả khi shop đóng / chụp màn hình.
        TeviLoginManager.Instance?.setDebugStatus(`Star: ${message}`);
        TeviLoginManager.Instance?.setDebugUserInfo(message);
        console.log('[StarWalletHud]', message);
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

        const openNode = this.createButton(topBar, 'BtnOpenShop', 'Nạp', 120, 56, 110, 0);
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
        title.string = 'Sandbox Nạp Star';
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
            ? 'Editor: gói/Mock đều giả lập. Status từng bước hiện ở đây.'
            : 'Bản Tevi thật: nạp qua top-up-signature + TeviJS.topup. Status hiện ở đây.';
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

        const closeBtn = this.createButton(panel, 'BtnCloseShop', 'Đóng', 200, 64, 0, -300);
        closeBtn.on(Button.EventType.CLICK, this.closeShop, this);
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
        this.setStatus('Chọn gói Tevi sandbox, hoặc Mock để test offline.');
        this.refreshBalance();
        const parent = this.node.parent;
        if (parent) {
            this.node.setSiblingIndex(parent.children.length - 1);
        }
    }

    private closeShop(): void {
        if (this._shopRoot) this._shopRoot.active = false;
    }

    private isEditorOrPreview(): boolean {
        return !!(EDITOR || PREVIEW);
    }

    private hasTeviTopupBridge(): boolean {
        return typeof window !== 'undefined' && typeof window.TeviJS?.topup === 'function';
    }

    private async onPurchaseClicked(packId: string): Promise<void> {
        if (TeviPaymentService.getInstance().isBusy()) {
            this.setStatus('Đang xử lý giao dịch trước...');
            return;
        }

        // Editor/Preview: Mock để test UI. Bản build thật KHÔNG được fallback Mock.
        if (this.isEditorOrPreview()) {
            this.setStatus(`[Editor] Gói ${packId} → Mock (không gọi Tevi API thật)`);
            const mockResult = await TeviPaymentService.getInstance().mockGrantPack(
                packId,
                (msg) => this.setStatus(msg),
            );
            this.setStatus(mockResult.message);
            this.refreshBalance();
            return;
        }

        if (!this.hasTeviTopupBridge()) {
            this.setStatus('FAIL: Bản build thiếu TeviJS.topup — mở trong app Tevi (không Mock).');
            return;
        }

        const token = TeviLoginManager.Instance?.getUserToken()?.trim() || '';
        if (!token) {
            this.setStatus('FAIL: Chưa login Tevi (thiếu user_app_token).');
            return;
        }

        this.setStatus(`Bắt đầu nạp THẬT pack=${packId}`);
        const result = await TeviPaymentService.getInstance().purchasePack(
            packId,
            (msg) => this.setStatus(msg),
        );
        this.setStatus(result.ok
            ? result.message
            : `FAIL: ${result.message} | ★ ${result.balance}`);
        this.refreshBalance();
    }

    private async onMockClicked(packId: string): Promise<void> {
        this.setStatus(`[Mock] Bắt đầu pack=${packId}`);
        const result = await TeviPaymentService.getInstance().mockGrantPack(
            packId,
            (msg) => this.setStatus(msg),
        );
        this.setStatus(result.message);
        this.refreshBalance();
    }
}
