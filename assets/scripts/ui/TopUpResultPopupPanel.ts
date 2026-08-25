import {
    _decorator,
    Button,
    Component,
    director,
    Label,
    Node,
    UITransform,
    Widget,
} from 'cc';

const { ccclass, property } = _decorator;

const SAMPLE_TITLE = 'Insufficient Tevi Stars';
const SAMPLE_BODY =
    'Not enough Tevi Stars.\n\n'
    + 'Your wallet: 0 ★\n'
    + 'This pack needs: 100 ★\n\n'
    + 'Top up your Tevi wallet first, then try again.';

/**
 * Popup kết quả / lỗi nạp sao (thiếu sao Tevi, top-up failed…).
 * Prefab: `resources/prefabs/ui/panel_topup_result`
 *
 * Vị trí / size Title, Body, BtnOk, Panel — chỉnh trong prefab Editor.
 * Runtime chỉ gán text và (tuỳ chọn) co Body cho vừa khoảng giữa Title ↔ BtnOk.
 */
@ccclass('TopUpResultPopupPanel')
export class TopUpResultPopupPanel extends Component {
    public static Instance: TopUpResultPopupPanel | null = null;

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

    @property({
        tooltip: 'Co chiều cao Body theo nội dung, nằm giữa Title và BtnOk (không đổi BtnOk).',
    })
    public autoFitBody = true;

    private _onClose: (() => void) | null = null;

    protected onLoad(): void {
        if (TopUpResultPopupPanel.Instance && TopUpResultPopupPanel.Instance !== this) {
            this.destroy();
            return;
        }
        TopUpResultPopupPanel.Instance = this;
        this.resolveReferences();
        this.applyPreviewText();
        this.node.active = false;
        this.bindOkButton();
    }

    protected onDestroy(): void {
        this.unbindOkButton();
        if (TopUpResultPopupPanel.Instance === this) {
            TopUpResultPopupPanel.Instance = null;
        }
    }

    public show(title: string, message: string, onClose?: () => void): void {
        this.resolveReferences();
        this._onClose = onClose ?? null;
        if (this.titleLabel) this.titleLabel.string = title;
        if (this.bodyLabel) this.bodyLabel.string = message;
        this.ensureLabelWrap(this.titleLabel, false);
        this.ensureLabelWrap(this.bodyLabel, true);
        if (this.autoFitBody) {
            this.fitBodyBetweenTitleAndButton(message);
        }
        this.mountOnCanvas();
        this.node.active = true;
        if (this.backgroundBlocker) this.backgroundBlocker.active = true;
        if (this.contentNode) this.contentNode.active = true;
    }

    public hide(): void {
        this.node.active = false;
        this._onClose = null;
    }

    /** Editor preview — chỉ gán text mẫu, giữ layout prefab. */
    private applyPreviewText(): void {
        if (this.titleLabel && !this.titleLabel.string) {
            this.titleLabel.string = SAMPLE_TITLE;
        }
        if (this.bodyLabel && !this.bodyLabel.string) {
            this.bodyLabel.string = SAMPLE_BODY;
        }
        this.ensureLabelWrap(this.titleLabel, false);
        this.ensureLabelWrap(this.bodyLabel, true);
        if (this.autoFitBody) {
            this.fitBodyBetweenTitleAndButton(this.bodyLabel?.string || SAMPLE_BODY);
        }
    }

    private resolveReferences(): void {
        if (!this.backgroundBlocker) {
            this.backgroundBlocker = this.node.getChildByName('Overlay');
        }
        if (!this.contentNode) {
            this.contentNode = this.node.getChildByName('Panel');
        }
        const panel = this.contentNode;
        if (!panel) return;

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

    /** Chỉ bật wrap/clamp — không đổi font, màu, vị trí. */
    private ensureLabelWrap(label: Label | null, wrap: boolean): void {
        if (!label) return;
        label.enableWrapText = wrap;
        label.overflow = Label.Overflow.CLAMP;
    }

    /**
     * Co Body theo text, giữa Title và BtnOk.
     * BtnOk / Title / Panel — không bị ghi đè từ code.
     */
    private fitBodyBetweenTitleAndButton(message: string): void {
        const titleNode = this.titleLabel?.node;
        const bodyNode = this.bodyLabel?.node;
        const btnNode = this.okButton?.node ?? this.contentNode?.getChildByName('BtnOk');
        if (!titleNode || !bodyNode || !btnNode || !this.bodyLabel) return;

        const titleUt = titleNode.getComponent(UITransform);
        const bodyUt = bodyNode.getComponent(UITransform);
        const btnUt = btnNode.getComponent(UITransform);
        if (!titleUt || !bodyUt || !btnUt) return;

        const innerW = bodyUt.contentSize.width;
        const fontSize = this.bodyLabel.fontSize;
        const lineH = this.bodyLabel.lineHeight || fontSize + 8;
        const bodyLines = this.estimateLines(message, fontSize, innerW);
        const neededH = Math.max(48, bodyLines * lineH + 8);

        const titleBottom = titleNode.position.y - titleUt.contentSize.height / 2;
        const btnTop = btnNode.position.y + btnUt.contentSize.height / 2;
        const gap = 12;
        const maxH = Math.max(48, titleBottom - btnTop - gap * 2);
        const bodyH = Math.min(neededH, maxH);

        bodyUt.setContentSize(innerW, bodyH);
        bodyNode.setPosition(bodyNode.position.x, (titleBottom - gap + btnTop + gap) / 2, 0);
    }

    private estimateLines(text: string, fontSize: number, maxWidth: number): number {
        const charsPerLine = Math.max(8, Math.floor(maxWidth / (fontSize * 0.52)));
        const parts = `${text}`.split('\n');
        let lines = 0;
        for (const part of parts) {
            lines += Math.max(1, Math.ceil(part.length / charsPerLine));
        }
        return lines;
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
}
