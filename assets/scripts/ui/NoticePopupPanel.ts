import {
    _decorator,
    BlockInputEvents,
    Button,
    Color,
    Component,
    director,
    Graphics,
    Label,
    Layers,
    Node,
    UITransform,
    Widget,
    view,
} from 'cc';
import { AudioManager } from '../managers/AudioManager';

const { ccclass, property } = _decorator;

/**
 * Popup thông báo full-screen (top-up success / level 50 coming soon).
 * Kéo prefab `prefabs/ui/panel_notice` vào Canvas để chỉnh layout trong Editor.
 */
@ccclass('NoticePopupPanel')
export class NoticePopupPanel extends Component {
    public static Instance: NoticePopupPanel | null = null;

    @property(Node)
    public backgroundBlocker: Node | null = null;

    @property(Node)
    public contentNode: Node | null = null;

    @property(Label)
    public titleLabel: Label | null = null;

    @property(Label)
    public bodyLabel: Label | null = null;

    @property(Button)
    public okButton: Button | null = null;

    private _onClose: (() => void) | null = null;
    private _runtimeBuilt = false;

    protected onLoad(): void {
        if (NoticePopupPanel.Instance && NoticePopupPanel.Instance !== this) {
            this.destroy();
            return;
        }
        NoticePopupPanel.Instance = this;
        this.resolveReferences();
        this.ensureEditorLayout();
        this.node.active = false;
        this.bindOkButton();
    }

    private resolveReferences(): void {
        if (!this.backgroundBlocker) {
            this.backgroundBlocker = this.node.getChildByName('Overlay');
        }
        if (!this.contentNode) {
            this.contentNode = this.node.getChildByName('Panel');
        }
        const panel = this.contentNode;
        if (panel) {
            if (!this.titleLabel) {
                this.titleLabel = panel.getChildByName('Title')?.getComponent(Label) ?? null;
            }
            if (!this.bodyLabel) {
                this.bodyLabel = panel.getChildByName('Body')?.getComponent(Label) ?? null;
            }
            if (!this.okButton) {
                this.okButton = panel.getChildByName('BtnOk')?.getComponent(Button) ?? null;
            }
        }
    }

    protected onDestroy(): void {
        this.unbindOkButton();
        if (NoticePopupPanel.Instance === this) {
            NoticePopupPanel.Instance = null;
        }
    }

    public show(title: string, message: string, onClose?: () => void): void {
        this.ensureEditorLayout();
        this._onClose = onClose ?? null;
        if (this.titleLabel) this.titleLabel.string = title;
        if (this.bodyLabel) this.bodyLabel.string = message;
        this.mountOnCanvas();
        AudioManager.getInstance()?.bindButtonSounds(this.node);
        this.node.active = true;
        if (this.backgroundBlocker) this.backgroundBlocker.active = true;
        if (this.contentNode) {
            this.contentNode.active = true;
            this.contentNode.setScale(1, 1, 1);
        }
    }

    public hide(): void {
        this.node.active = false;
        this._onClose = null;
    }

    private bindOkButton(): void {
        this.okButton?.node.on(Button.EventType.CLICK, this.onOkClicked, this);
    }

    private unbindOkButton(): void {
        this.okButton?.node.off(Button.EventType.CLICK, this.onOkClicked, this);
    }

    private onOkClicked(): void {
        const onClose = this._onClose;
        this._onClose = null;
        this.hide();
        onClose?.();
    }

    private mountOnCanvas(): void {
        const canvas = this.getCanvasNode();
        if (!canvas?.isValid) return;
        if (this.node.parent !== canvas) {
            this.node.setParent(canvas);
        }
        this.node.setPosition(0, 0, 0);
        this.node.layer = canvas.layer;
        this.applyFullStretchWidget(this.node);
        this.node.setSiblingIndex(canvas.children.length - 1);
    }

    private getCanvasNode(): Node | null {
        const parent = this.node.parent;
        if (parent?.isValid && parent.name === 'Canvas') return parent;
        return director.getScene()?.getChildByName('Canvas') ?? null;
    }

    private applyFullStretchWidget(node: Node): void {
        let widget = node.getComponent(Widget);
        if (!widget) widget = node.addComponent(Widget);
        const canvas = this.getCanvasNode();
        if (canvas?.isValid) widget.target = canvas;
        widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
        widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
        widget.isAlignHorizontalCenter = false;
        widget.top = widget.bottom = widget.left = widget.right = 0;
        widget.updateAlignment();
    }

    /** Fallback khi prefab/scene chưa gán label — vẫn chạy được runtime. */
    private ensureEditorLayout(): void {
        if (this.titleLabel && this.bodyLabel && this.okButton) return;
        if (this._runtimeBuilt) return;
        this._runtimeBuilt = true;

        const design = view.getDesignResolutionSize();
        const width = design.width || 1080;
        const height = design.height || 1920;

        let rootTransform = this.node.getComponent(UITransform);
        if (!rootTransform) rootTransform = this.node.addComponent(UITransform);
        rootTransform.setContentSize(width, height);
        this.node.layer = Layers.Enum.UI_2D;
        if (!this.node.getComponent(BlockInputEvents)) {
            this.node.addComponent(BlockInputEvents);
        }
        this.applyFullStretchWidget(this.node);

        if (!this.backgroundBlocker) {
            const dim = new Node('Overlay');
            dim.layer = Layers.Enum.UI_2D;
            dim.setParent(this.node);
            const dimTransform = dim.addComponent(UITransform);
            dimTransform.setContentSize(width, height);
            dim.addComponent(BlockInputEvents);
            const dimGfx = dim.addComponent(Graphics);
            dimGfx.fillColor = new Color(0, 0, 0, 160);
            dimGfx.rect(-width * 0.5, -height * 0.5, width, height);
            dimGfx.fill();
            this.backgroundBlocker = dim;
        }

        if (!this.contentNode) {
            const panel = new Node('Panel');
            panel.layer = Layers.Enum.UI_2D;
            panel.setParent(this.node);
            const panelTransform = panel.addComponent(UITransform);
            panelTransform.setContentSize(560, 360);
            const panelGfx = panel.addComponent(Graphics);
            panelGfx.fillColor = new Color(36, 32, 48, 250);
            panelGfx.roundRect(-280, -180, 560, 360, 24);
            panelGfx.fill();
            this.contentNode = panel;
        }

        const panel = this.contentNode!;

        if (!this.titleLabel) {
            const titleNode = new Node('Title');
            titleNode.layer = Layers.Enum.UI_2D;
            titleNode.setParent(panel);
            titleNode.setPosition(0, 100, 0);
            const titleTransform = titleNode.addComponent(UITransform);
            titleTransform.setContentSize(500, 64);
            this.titleLabel = titleNode.addComponent(Label);
            this.titleLabel.string = 'Notice';
            this.titleLabel.fontSize = 38;
            this.titleLabel.lineHeight = 44;
            this.titleLabel.color = new Color(255, 220, 90, 255);
            this.titleLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        }

        if (!this.bodyLabel) {
            const bodyNode = new Node('Body');
            bodyNode.layer = Layers.Enum.UI_2D;
            bodyNode.setParent(panel);
            bodyNode.setPosition(0, 10, 0);
            const bodyTransform = bodyNode.addComponent(UITransform);
            bodyTransform.setContentSize(500, 140);
            this.bodyLabel = bodyNode.addComponent(Label);
            this.bodyLabel.string = '';
            this.bodyLabel.fontSize = 30;
            this.bodyLabel.lineHeight = 38;
            this.bodyLabel.color = Color.WHITE;
            this.bodyLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
            this.bodyLabel.verticalAlign = Label.VerticalAlign.CENTER;
            this.bodyLabel.enableWrapText = true;
        }

        if (!this.okButton) {
            const btnNode = new Node('BtnOk');
            btnNode.layer = Layers.Enum.UI_2D;
            btnNode.setParent(panel);
            btnNode.setPosition(0, -120, 0);
            const btnTransform = btnNode.addComponent(UITransform);
            btnTransform.setContentSize(220, 64);
            const btnGfx = btnNode.addComponent(Graphics);
            btnGfx.fillColor = new Color(90, 170, 255, 255);
            btnGfx.roundRect(-110, -32, 220, 64, 16);
            btnGfx.fill();
            this.okButton = btnNode.addComponent(Button);
            this.okButton.transition = Button.Transition.SCALE;
            this.okButton.zoomScale = 1.05;

            const labelNode = new Node('Label');
            labelNode.layer = Layers.Enum.UI_2D;
            labelNode.setParent(btnNode);
            const labelTransform = labelNode.addComponent(UITransform);
            labelTransform.setContentSize(200, 52);
            const label = labelNode.addComponent(Label);
            label.string = 'OK';
            label.fontSize = 30;
            label.lineHeight = 34;
            label.color = Color.WHITE;
            label.horizontalAlign = Label.HorizontalAlign.CENTER;
            label.verticalAlign = Label.VerticalAlign.CENTER;
        }
    }
}
