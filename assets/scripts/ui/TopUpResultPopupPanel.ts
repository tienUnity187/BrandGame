import {
    _decorator,
    Button,
    Color,
    Component,
    director,
    instantiate,
    Label,
    Layout,
    Node,
    resources,
    Size,
    Sprite,
    SpriteFrame,
    UITransform,
    Vec3,
    Widget,
} from 'cc';
import { StarWallet } from '../services/StarWallet';
import { AudioManager } from '../managers/AudioManager';
import { SkinManager } from '../managers/SkinManager';

export interface IBoosterShortageInfo {
    cost: number;
    actionName: string;
    balance: number;
}

export interface ITopUpSuccessInfo {
    stars: number;
    balance: number;
    fromPreviousPurchase?: boolean;
}

export interface IWalletShortageInfo {
    wallet: number;
    need: number;
}

const { ccclass, property } = _decorator;

const SAMPLE_TITLE = 'Not enough coins';
const SAMPLE_BODY =
    'Not enough coins.\n\n'
    + 'Your wallet: 0\n'
    + 'This pack needs: 100\n\n'
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
    private _onTopUpClicked: (() => void) | null = null;
    private _topUpBar: Node | null = null;
    private _coinMessageRoot: Node | null = null;
    private _moneySprite: SpriteFrame | null = null;
    private _bodyOriginalSize: Size | null = null;
    private _bodyOriginalPos: Vec3 | null = null;

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
        this.unbindTopUpBar();
        if (TopUpResultPopupPanel.Instance === this) {
            TopUpResultPopupPanel.Instance = null;
        }
    }

    public show(
        title: string,
        message: string,
        onClose?: () => void,
        options?: {
            topUpBarSource?: Node | null;
            onTopUpClicked?: () => void;
            boosterShortage?: IBoosterShortageInfo;
            walletShortage?: IWalletShortageInfo;
            topUpSuccess?: ITopUpSuccessInfo;
        },
    ): void {
        this.resolveReferences();
        this._onClose = onClose ?? null;
        this._onTopUpClicked = options?.onTopUpClicked ?? null;
        if (this.titleLabel) this.titleLabel.string = title;
        const shortage = options?.boosterShortage;
        const walletShortage = options?.walletShortage;
        const success = options?.topUpSuccess;
        const useCoinMessage = !!(shortage || walletShortage || success);
        if (this.bodyLabel) {
            this.bodyLabel.string = useCoinMessage ? '' : message;
        }
        this.ensureLabelWrap(this.titleLabel, false);
        this.ensureLabelWrap(this.bodyLabel, true);
        const showTopUpBar = !!options?.topUpBarSource?.isValid && !walletShortage;
        this.setTopUpBarVisible(showTopUpBar, options?.topUpBarSource ?? null);
        if (!showTopUpBar && !useCoinMessage && this.autoFitBody) {
            this.centerBodyInPanel(message);
        }
        this.setCoinMessageVisible(
            useCoinMessage,
            shortage,
            walletShortage,
            success,
            title,
            options?.topUpBarSource ?? null,
        );
        this.mountOnCanvas();
        AudioManager.getInstance()?.bindButtonSounds(this.node);
        this.node.active = true;
        if (this.backgroundBlocker) this.backgroundBlocker.active = true;
        if (this.contentNode) this.contentNode.active = true;
    }

    public hide(): void {
        this.node.active = false;
        this._onClose = null;
        this._onTopUpClicked = null;
        this.setTopUpBarVisible(false, null);
        this.setCoinMessageVisible(false, null, null, null, '', null);
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
            this.centerBodyInPanel(this.bodyLabel?.string || SAMPLE_BODY);
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

    private setTopUpBarVisible(visible: boolean, source: Node | null): void {
        if (visible && source?.isValid) {
            this.ensureTopUpBar(source);
            this.refreshTopUpBarBalance();
            if (this._topUpBar?.isValid) {
                this._topUpBar.active = true;
                this.layoutBodyForTopUpBar();
            }
            return;
        }
        if (this._topUpBar?.isValid) this._topUpBar.active = false;
        this.restoreBodyLayout();
    }

    private ensureTopUpBar(source: Node): void {
        const panel = this.contentNode;
        if (!panel?.isValid) return;
        if (this._topUpBar?.isValid) {
            this.bindTopUpBar();
            this.placeTopUpBar();
            return;
        }

        const clone = instantiate(source);
        clone.name = 'StarTopBarClone';
        clone.setParent(panel);
        clone.layer = panel.layer;
        this.applyLayer(clone, panel.layer);
        const widget = clone.getComponent(Widget);
        if (widget) {
            widget.enabled = false;
            widget.destroy();
        }
        this._topUpBar = clone;
        this.bindTopUpBar();
        this.placeTopUpBar();
    }

    private placeTopUpBar(): void {
        const bar = this._topUpBar;
        const panel = this.contentNode;
        if (!bar?.isValid || !panel?.isValid) return;
        const panelH = panel.getComponent(UITransform)?.contentSize.height ?? 446;
        const barH = bar.getComponent(UITransform)?.contentSize.height ?? 80;
        bar.setPosition(0, -panelH * 0.5 + barH * 0.5 + 24, 0);
        bar.setScale(1, 1, 1);
        bar.setSiblingIndex(panel.children.length - 1);
    }

    private refreshTopUpBarBalance(): void {
        const label = this._topUpBar?.getChildByName('BalanceLabel')?.getComponent(Label);
        if (label) label.string = `${StarWallet.getInstance().getBalance()}`;
    }

    private setCoinMessageVisible(
        visible: boolean,
        shortage: IBoosterShortageInfo | null | undefined,
        walletShortage: IWalletShortageInfo | null | undefined,
        success: ITopUpSuccessInfo | null | undefined,
        title: string,
        source: Node | null,
    ): void {
        const isSuccess = !!success;
        if (this.titleLabel?.node?.isValid) {
            this.titleLabel.node.active = !isSuccess;
        }
        if (this.bodyLabel?.node?.isValid) {
            this.bodyLabel.node.active = !visible;
        }
        if (!visible) {
            if (this._coinMessageRoot?.isValid) this._coinMessageRoot.active = false;
            return;
        }
        this.ensureCoinMessage(source);
        if (success) {
            this.fillSuccessMessage(title, success);
        } else if (shortage) {
            this.fillShortageMessage(shortage);
        } else if (walletShortage) {
            this.fillWalletShortageMessage(walletShortage);
        }
        this.placeCoinMessage(isSuccess || !!walletShortage);
        if (this._coinMessageRoot) this._coinMessageRoot.active = true;
        this.resolveMoneySprite(source);
    }

    private ensureCoinMessage(source: Node | null): void {
        const panel = this.contentNode;
        if (!panel?.isValid) return;
        if (this._coinMessageRoot?.isValid) return;

        const root = new Node('CoinMessage');
        root.layer = panel.layer;
        root.setParent(panel);
        const rootUt = root.addComponent(UITransform);
        rootUt.setContentSize(616, 180);
        const rootLayout = root.addComponent(Layout);
        rootLayout.type = Layout.Type.VERTICAL;
        rootLayout.resizeMode = Layout.ResizeMode.CONTAINER;
        rootLayout.spacingY = 14;
        rootLayout.affectedByScale = true;

        this.buildTitleRow(root);
        this.buildCoinRow(root, 'NeedRow');
        this.buildCoinRow(root, 'BalanceRow');
        this._coinMessageRoot = root;
        this.applyMoneySprite(this.spriteFromSource(source));
    }

    private buildTitleRow(parent: Node): Node {
        const row = new Node('TitleRow');
        row.layer = parent.layer;
        row.setParent(parent);
        const rowUt = row.addComponent(UITransform);
        rowUt.setContentSize(616, 62);
        const layout = row.addComponent(Layout);
        layout.type = Layout.Type.HORIZONTAL;
        layout.resizeMode = Layout.ResizeMode.CONTAINER;
        layout.affectedByScale = true;
        const labelNode = new Node('Label');
        labelNode.layer = parent.layer;
        labelNode.setParent(row);
        const ut = labelNode.addComponent(UITransform);
        ut.setContentSize(220, 62);
        const label = labelNode.addComponent(Label);
        label.string = '';
        label.overflow = Label.Overflow.NONE;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        this.styleLikeTitle(label);
        return row;
    }

    private buildCoinRow(parent: Node, name: string): Node {
        const row = new Node(name);
        row.layer = parent.layer;
        row.setParent(parent);
        const rowUt = row.addComponent(UITransform);
        rowUt.setContentSize(616, 52);
        const layout = row.addComponent(Layout);
        layout.type = Layout.Type.HORIZONTAL;
        layout.resizeMode = Layout.ResizeMode.CONTAINER;
        layout.spacingX = 8;
        layout.affectedByScale = true;

        this.makeRowLabel(row, 'Left');
        this.makeRowCoin(row);
        this.makeRowLabel(row, 'Right');
        return row;
    }

    private makeRowLabel(parent: Node, name: string): Label {
        const node = new Node(name);
        node.layer = parent.layer;
        node.setParent(parent);
        const ut = node.addComponent(UITransform);
        ut.setContentSize(80, 48);
        const label = node.addComponent(Label);
        label.string = '';
        label.overflow = Label.Overflow.NONE;
        label.horizontalAlign = Label.HorizontalAlign.LEFT;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        this.styleLikeBody(label);
        return label;
    }

    private makeRowCoin(parent: Node): Node {
        const node = new Node('Coin');
        node.layer = parent.layer;
        node.setParent(parent);
        const ut = node.addComponent(UITransform);
        ut.setContentSize(44, 44);
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.trim = true;
        return node;
    }

    private styleLikeBody(label: Label): void {
        const src = this.bodyLabel;
        label.fontSize = src?.fontSize || 30;
        label.lineHeight = src?.lineHeight || 38;
        label.color = src?.color?.clone() || Color.WHITE;
        label.isBold = true;
        label.enableWrapText = false;
        if (src?.font) {
            label.font = src.font;
            label.useSystemFont = false;
        }
        if (src) {
            label.enableOutline = src.enableOutline;
            label.outlineColor = src.outlineColor;
            label.outlineWidth = src.outlineWidth;
        }
    }

    private styleLikeTitle(label: Label): void {
        const src = this.titleLabel;
        label.fontSize = src?.fontSize || 38;
        label.lineHeight = src?.lineHeight || 44;
        label.color = src?.color?.clone() || new Color(255, 220, 90, 255);
        label.isBold = true;
        label.enableWrapText = false;
        if (src?.font) {
            label.font = src.font;
            label.useSystemFont = false;
        }
        if (src) {
            label.enableOutline = src.enableOutline;
            label.outlineColor = src.outlineColor;
            label.outlineWidth = src.outlineWidth;
        }
    }

    private fillShortageMessage(shortage: IBoosterShortageInfo): void {
        const root = this._coinMessageRoot;
        if (!root?.isValid) return;
        const titleRow = root.getChildByName('TitleRow');
        if (titleRow) titleRow.active = false;
        this.fillCoinRow(
            root.getChildByName('NeedRow'),
            `You need ${shortage.cost}`,
            `to use ${shortage.actionName}.`,
        );
        this.fillCoinRow(
            root.getChildByName('BalanceRow'),
            `Your balance: ${shortage.balance}`,
            '',
        );
        this.refreshCoinMessageLayout();
    }

    private fillWalletShortageMessage(shortage: IWalletShortageInfo): void {
        const root = this._coinMessageRoot;
        if (!root?.isValid) return;
        const titleRow = root.getChildByName('TitleRow');
        if (titleRow) titleRow.active = false;
        this.fillCoinRow(
            root.getChildByName('NeedRow'),
            `Your wallet: ${shortage.wallet}`,
            '',
        );
        this.fillCoinRow(
            root.getChildByName('BalanceRow'),
            `This pack needs: ${shortage.need}`,
            '',
        );
        this.refreshCoinMessageLayout();
    }

    private fillSuccessMessage(title: string, success: ITopUpSuccessInfo): void {
        const root = this._coinMessageRoot;
        if (!root?.isValid) return;
        const titleRow = root.getChildByName('TitleRow');
        const titleLabel = titleRow?.getChildByName('Label')?.getComponent(Label);
        if (titleRow) titleRow.active = true;
        if (titleLabel) titleLabel.string = title;
        this.fillCoinRow(
            root.getChildByName('NeedRow'),
            `+${success.stars}`,
            success.fromPreviousPurchase ? 'added to your wallet!' : 'added!',
        );
        this.fillCoinRow(
            root.getChildByName('BalanceRow'),
            `Total: ${success.balance}`,
            '',
        );
        this.refreshCoinMessageLayout();
    }

    private refreshCoinMessageLayout(): void {
        this.scheduleOnce(() => {
            if (!this._coinMessageRoot?.isValid) return;
            for (const row of this._coinMessageRoot.children) {
                row.getComponent(Layout)?.updateLayout();
                row.setPosition(0, row.position.y, 0);
            }
            this._coinMessageRoot.getComponent(Layout)?.updateLayout();
            this.placeCoinMessage(!!this._coinMessageRoot.getChildByName('TitleRow')?.active);
        }, 0);
    }

    private fillCoinRow(row: Node | null, left: string, right: string): void {
        if (!row?.isValid) return;
        const leftLabel = row.getChildByName('Left')?.getComponent(Label);
        const rightLabel = row.getChildByName('Right')?.getComponent(Label);
        const rightNode = row.getChildByName('Right');
        if (leftLabel) leftLabel.string = left;
        if (rightLabel) rightLabel.string = right;
        if (rightNode) rightNode.active = !!right;
        row.getComponent(Layout)?.updateLayout();
    }

    private placeCoinMessage(centerInPanel: boolean): void {
        const root = this._coinMessageRoot;
        if (!root?.isValid) return;
        const panel = this.contentNode;
        const bodyNode = this.bodyLabel?.node;
        const rootUt = root.getComponent(UITransform);
        if (centerInPanel && panel?.isValid) {
            root.setPosition(0, 0, 0);
        } else if (bodyNode?.isValid) {
            const bodyUt = bodyNode.getComponent(UITransform);
            if (bodyUt && rootUt) {
                rootUt.setContentSize(bodyUt.contentSize.width, Math.min(160, bodyUt.contentSize.height));
            }
            root.setPosition(bodyNode.position.x, bodyNode.position.y, 0);
        }
        root.setSiblingIndex(this.contentNode ? this.contentNode.children.length - 1 : 0);
        if (this._topUpBar?.isValid) {
            this._topUpBar.setSiblingIndex(this.contentNode ? this.contentNode.children.length - 1 : 0);
        }
        root.getComponent(Layout)?.updateLayout();
        for (const row of root.children) {
            row.setPosition(0, row.position.y, 0);
        }
    }

    private spriteFromSource(source: Node | null): SpriteFrame | null {
        const fromBar = this._topUpBar?.getChildByName('Coin')?.getComponent(Sprite)?.spriteFrame;
        if (fromBar) return fromBar;
        return source?.getChildByName('Coin')?.getComponent(Sprite)?.spriteFrame || this._moneySprite;
    }

    private resolveMoneySprite(source: Node | null): void {
        const sf = this.spriteFromSource(source);
        if (sf) {
            this._moneySprite = sf;
            this.applyMoneySprite(sf);
            return;
        }
        const skinId = SkinManager.getInstance()?.getCurrentSkin()?.skinId || 'uma';
        const paths = [`skins/${skinId}/ui/money/spriteFrame`, 'skins/uma/ui/money/spriteFrame'];
        this.tryLoadMoneyPath(paths, 0);
    }

    private tryLoadMoneyPath(paths: string[], index: number): void {
        if (index >= paths.length) return;
        resources.load(paths[index], SpriteFrame, (err, sf) => {
            if (err || !sf) {
                this.tryLoadMoneyPath(paths, index + 1);
                return;
            }
            this._moneySprite = sf;
            this.applyMoneySprite(sf);
        });
    }

    private applyMoneySprite(sf: SpriteFrame | null): void {
        if (!sf || !this._coinMessageRoot?.isValid) return;
        for (const row of this._coinMessageRoot.children) {
            const icon = row.getChildByName('Coin')?.getComponent(Sprite);
            if (!icon) continue;
            icon.spriteFrame = sf;
            icon.sizeMode = Sprite.SizeMode.CUSTOM;
            const ut = icon.node.getComponent(UITransform);
            ut?.setContentSize(44, 44);
        }
    }

    private layoutBodyForTopUpBar(): void {
        const titleNode = this.titleLabel?.node;
        const bodyNode = this.bodyLabel?.node;
        const bar = this._topUpBar;
        if (!titleNode || !bodyNode || !bar?.isValid || !this.bodyLabel) return;

        this.backupBodyLayout();
        const titleUt = titleNode.getComponent(UITransform);
        const bodyUt = bodyNode.getComponent(UITransform);
        const barUt = bar.getComponent(UITransform);
        if (!titleUt || !bodyUt || !barUt) return;

        const titleBottom = titleNode.position.y - titleUt.contentSize.height / 2;
        const barTop = bar.position.y + barUt.contentSize.height / 2;
        const gap = 16;
        const maxH = Math.max(48, titleBottom - barTop - gap * 2);
        const innerW = bodyUt.contentSize.width;
        bodyUt.setContentSize(innerW, maxH);
        bodyNode.setPosition(bodyNode.position.x, (titleBottom + barTop) / 2, 0);
    }

    private backupBodyLayout(): void {
        const bodyNode = this.bodyLabel?.node;
        const bodyUt = bodyNode?.getComponent(UITransform);
        if (!bodyNode || !bodyUt) return;
        if (!this._bodyOriginalSize) {
            this._bodyOriginalSize = bodyUt.contentSize.clone();
            this._bodyOriginalPos = bodyNode.position.clone();
        }
    }

    private applyLayer(node: Node, layer: number): void {
        node.layer = layer;
        for (const child of node.children) {
            this.applyLayer(child, layer);
        }
    }

    private restoreBodyLayout(): void {
        const bodyNode = this.bodyLabel?.node;
        const bodyUt = bodyNode?.getComponent(UITransform);
        if (!bodyNode || !bodyUt || !this._bodyOriginalSize || !this._bodyOriginalPos) return;
        bodyUt.setContentSize(this._bodyOriginalSize);
        bodyNode.setPosition(this._bodyOriginalPos);
    }

    private bindTopUpBar(): void {
        const bar = this._topUpBar;
        if (!bar?.isValid) return;
        this.unbindTopUpBar();
        bar.on(Node.EventType.TOUCH_END, this.onTopUpBarClicked, this);
        const shopBtn = bar.getChildByName('BtnOpenShop');
        shopBtn?.on(Button.EventType.CLICK, this.onTopUpBarClicked, this);
    }

    private unbindTopUpBar(): void {
        const bar = this._topUpBar;
        if (!bar?.isValid) return;
        bar.off(Node.EventType.TOUCH_END, this.onTopUpBarClicked, this);
        const shopBtn = bar.getChildByName('BtnOpenShop');
        shopBtn?.off(Button.EventType.CLICK, this.onTopUpBarClicked, this);
    }

    private onTopUpBarClicked(): void {
        AudioManager.getInstance()?.playSfx('button-click');
        const onTopUp = this._onTopUpClicked;
        this._onTopUpClicked = null;
        this._onClose = null;
        this.hide();
        onTopUp?.();
    }

    /** Chỉ bật wrap/clamp — không đổi font, màu, vị trí. */
    private ensureLabelWrap(label: Label | null, wrap: boolean): void {
        if (!label) return;
        label.enableWrapText = wrap;
        label.overflow = Label.Overflow.CLAMP;
    }

    /**
     * Canh Body giữa panel (dưới Title). Không dùng BtnOk — nút X nằm góc trên.
     */
    private centerBodyInPanel(message: string): void {
        const panel = this.contentNode;
        const titleNode = this.titleLabel?.node;
        const bodyNode = this.bodyLabel?.node;
        if (!panel || !titleNode || !bodyNode || !this.bodyLabel) return;

        this.backupBodyLayout();
        const panelUt = panel.getComponent(UITransform);
        const titleUt = titleNode.getComponent(UITransform);
        const bodyUt = bodyNode.getComponent(UITransform);
        if (!panelUt || !titleUt || !bodyUt) return;

        const innerW = bodyUt.contentSize.width;
        const fontSize = this.bodyLabel.fontSize;
        const lineH = this.bodyLabel.lineHeight || fontSize + 8;
        const bodyLines = this.estimateLines(message, fontSize, innerW);
        const neededH = Math.max(48, bodyLines * lineH + 8);

        const titleBottom = titleNode.position.y - titleUt.contentSize.height / 2;
        const panelBottom = -panelUt.contentSize.height * 0.5 + 24;
        const gap = 16;
        const maxH = Math.max(48, titleBottom - panelBottom - gap * 2);
        const bodyH = Math.min(neededH, maxH);

        bodyUt.setContentSize(innerW, bodyH);
        bodyNode.setPosition(0, (titleBottom - gap + panelBottom + gap) / 2, 0);
        this.bodyLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        this.bodyLabel.verticalAlign = Label.VerticalAlign.CENTER;
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
