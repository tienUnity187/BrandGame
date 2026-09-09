import { _decorator, BlockInputEvents, Color, Component, Graphics, Label, Layers, Node, UITransform, Widget, instantiate, Prefab, view } from 'cc';
import { SkinManager } from './SkinManager';
import { BasePanel } from '../ui/BasePanel';
import { AudioManager } from './AudioManager';

const { ccclass, property } = _decorator;

/**
 * UIManager - Quản lý vòng đời UI panels: open, close, stack, overlay.
 * Load prefab panels qua SkinManager để hỗ trợ reskin.
 * Không chứa logic gameplay, chỉ quản lý UI flow.
 */
@ccclass('UIManager')
export class UIManager extends Component {
    public static Instance: UIManager;
    public static getInstance(): UIManager { return UIManager.Instance; }

    @property(Node)
    public uiRoot: Node | null = null;

    @property(Node)
    public popupLayer: Node | null = null;

    @property(Node)
    public overlayLayer: Node | null = null;

    private _panelMap: Map<string, BasePanel> = new Map();
    private _panelStack: string[] = [];
    private _prefabCache: Map<string, Prefab> = new Map();
    private _loadingNode: Node | null = null;
    private _loadingLabel: Label | null = null;

    /** Panel ít mở — destroy instance khi đóng, giữ prefab cache. */
    private static readonly DESTROY_ON_CLOSE = new Set([
        'LevelSelectPanel',
        'RewardVideoGalleryPanel',
    ]);

    protected onLoad(): void {
        if (UIManager.Instance) { this.destroy(); return; }
        UIManager.Instance = this;
    }

    /** Khởi tạo với UI root node */
    public initialize(uiRoot: Node | null): void {
        this.uiRoot = uiRoot || this.node;
        this.prepareLoadingOverlay();
    }

    /** Chỉ cache prefab — không instantiate cây node. */
    public async preloadPanel(panelName: string): Promise<void> {
        if (this._panelMap.has(panelName) || this._prefabCache.has(panelName)) return;
        const prefab = await SkinManager.getInstance().getPanelPrefab(panelName);
        if (prefab) this._prefabCache.set(panelName, prefab);
    }

    public async preloadPanels(panelNames: string[]): Promise<void> {
        await Promise.all(panelNames.map(panelName => this.preloadPanel(panelName)));
    }

    /** Mở panel theo tên */
    public async openPanel(panelName: string, data?: any): Promise<BasePanel | null> {
        if (this._panelMap.has(panelName)) {
            const panel = this._panelMap.get(panelName)!;
            AudioManager.getInstance()?.bindButtonSounds(panel.node);
            panel.show(data);
            this.bringPanelToFront(panelName);
            if (this._panelStack.indexOf(panelName) === -1) {
                this._panelStack.push(panelName);
            }
            return panel;
        }

        let prefab = this._prefabCache.get(panelName) || null;
        if (!prefab) {
            prefab = await SkinManager.getInstance().getPanelPrefab(panelName);
            if (prefab) this._prefabCache.set(panelName, prefab);
        }
        if (!prefab) {
            return null;
        }

        return this.createPanelInstance(panelName, prefab, true, data);
    }

    private createPanelInstance(panelName: string, prefab: Prefab, showNow: boolean, data?: any): BasePanel | null {
        if (!this.uiRoot) {
            return null;
        }
        const node = instantiate(prefab);
        node.name = panelName;
        node.layer = this.popupLayer?.layer ?? this.uiRoot.layer;
        node.setParent(this.popupLayer || this.uiRoot);
        node.setPosition(0, 0, 0);

        const panel = node.getComponent(BasePanel);
        if (panel) {
            panel.initialize(this);
            AudioManager.getInstance()?.bindButtonSounds(node);
            this._panelMap.set(panelName, panel);
            if (showNow) {
                panel.show(data);
                this.bringPanelToFront(panelName);
                this._panelStack.push(panelName);
            } else {
                node.active = false;
            }
            return panel;
        }

        console.warn(
            `[UIManager] Prefab "${panelName}" thiếu BasePanel (Missing Script?). Node bị hủy.`,
        );
        node.destroy();
        return null;
    }

    /** Đóng panel theo tên */
    private bringPanelToFront(panelName: string): void {
        const panel = this._panelMap.get(panelName);
        const node = panel?.node;
        if (!node || !node.isValid || !node.parent) return;
        node.setSiblingIndex(node.parent.children.length - 1);
    }

    public closePanel(panelName: string): void {
        const panel = this._panelMap.get(panelName);
        if (panel) {
            panel.hide();
            if (UIManager.DESTROY_ON_CLOSE.has(panelName)) {
                this.destroyPanelInstance(panelName);
                return;
            }
        }

        const index = this._panelStack.indexOf(panelName);
        if (index !== -1) {
            this._panelStack.splice(index, 1);
        }
    }

    public destroyPanelInstance(panelName: string): void {
        const panel = this._panelMap.get(panelName);
        this._panelMap.delete(panelName);
        const index = this._panelStack.indexOf(panelName);
        if (index !== -1) {
            this._panelStack.splice(index, 1);
        }
        if (panel?.node?.isValid) {
            panel.node.destroy();
        }
    }

    public destroyClosedPanels(panelNames: string[]): void {
        for (const panelName of panelNames) {
            this.destroyPanelInstance(panelName);
        }
    }

    /** Đóng panel hiện tại */
    public closeCurrentPanel(): void {
        const current = this._panelStack.pop();
        if (current) {
            this.closePanel(current);
        }
    }

    /** Đóng tất cả panels */
    public closeAllPanels(): void {
        const names = Array.from(this._panelMap.keys());
        for (const name of names) {
            this.closePanel(name);
        }
        this._panelStack = [];
    }

    /** Lấy panel đang mở */
    public getOpenPanel(panelName: string): BasePanel | undefined {
        return this._panelMap.get(panelName);
    }

    /** Kiểm tra panel đang mở */
    public isPanelOpen(panelName: string): boolean {
        return this._panelMap.has(panelName) && this._panelMap.get(panelName)!.isVisible();
    }

    /** Hiển thị loading overlay (tạo programmatically) */
    public showLoading(message: string = 'Loading...'): void {
        this.prepareLoadingOverlay();
        if (!this._loadingNode) return;
        if (this._loadingLabel) {
            this._loadingLabel.string = message;
        }
        this._loadingNode.active = true;
        const parent = this._loadingNode.parent;
        if (parent) {
            this._loadingNode.setSiblingIndex(parent.children.length - 1);
        }
    }

    private prepareLoadingOverlay(): void {
        if (this._loadingNode && this._loadingNode.isValid) return;

        const design = view.getDesignResolutionSize();
        const width = design.width || 1080;
        const height = design.height || 1920;

        const overlay = new Node('LoadingOverlay');
        overlay.layer = this.popupLayer?.layer ?? this.uiRoot?.layer ?? Layers.Enum.UI_2D;
        overlay.addComponent(BlockInputEvents);

        const transform = overlay.addComponent(UITransform);
        transform.setContentSize(width, height);

        const parent = this.popupLayer || this.uiRoot || this.node;
        overlay.setParent(parent);

        const widget = overlay.addComponent(Widget);
        widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
        widget.top = widget.bottom = widget.left = widget.right = 0;
        widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;

        const bg = new Node('Bg');
        bg.layer = overlay.layer;
        bg.setParent(overlay);
        const bgTransform = bg.addComponent(UITransform);
        bgTransform.setContentSize(width, height);
        const bgGfx = bg.addComponent(Graphics);
        bgGfx.fillColor = new Color(0, 0, 0, 180);
        bgGfx.rect(-width * 0.5, -height * 0.5, width, height);
        bgGfx.fill();

        const labelNode = new Node('Label');
        labelNode.layer = overlay.layer;
        labelNode.setParent(overlay);
        const labelTransform = labelNode.addComponent(UITransform);
        labelTransform.setContentSize(width - 80, 120);
        labelNode.setPosition(0, 0, 0);
        this._loadingLabel = labelNode.addComponent(Label);
        this._loadingLabel.string = 'Loading...';
        this._loadingLabel.fontSize = 36;
        this._loadingLabel.lineHeight = 44;
        this._loadingLabel.color = Color.WHITE;
        this._loadingLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        this._loadingLabel.verticalAlign = Label.VerticalAlign.CENTER;
        this._loadingLabel.enableWrapText = true;

        overlay.setPosition(0, 0, 999);
        overlay.active = false;
        this._loadingNode = overlay;
    }

    /** Ẩn loading overlay */
    public hideLoading(): void {
        if (this._loadingNode) {
            this._loadingNode.active = false;
        }
    }

    protected onDestroy(): void {
        if (UIManager.Instance === this) {
            UIManager.Instance = null;
        }
    }
}
