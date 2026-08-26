import {
    _decorator,
    BlockInputEvents,
    Button,
    Color,
    Graphics,
    Label,
    Layers,
    Node,
    UITransform,
    Widget,
    director,
    view,
} from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../enums/GameEvent';
import { RewardVideoHistory, WatchedRewardVideo } from '../services/RewardVideoHistory';
import { REWARD_VIDEO_UNLOCK_LEVELS } from '../TeviConstants';
import { TeviLoginManager } from '../TeviLoginManager';
import { BasePanel } from './BasePanel';
import { RewardVideoPlayer } from './RewardVideoPlayer';
import { AudioManager } from '../managers/AudioManager';

const { ccclass, property } = _decorator;

const ITEM_HEIGHT = 76;
const ITEM_GAP = 10;

/**
 * Prefab panel danh sách clip đã xem.
 * Mở qua UIManager.openPanel('RewardVideoGalleryPanel').
 * Nếu thiếu property (fallback runtime) sẽ tự dựng UI.
 */
@ccclass('RewardVideoGalleryPanel')
export class RewardVideoGalleryPanel extends BasePanel {
    public static Instance: RewardVideoGalleryPanel | null = null;

    @property(Label)
    public titleLabel: Label | null = null;

    @property(Label)
    public emptyLabel: Label | null = null;

    @property(Node)
    public listRoot: Node | null = null;

    @property(Button)
    public closeButton: Button | null = null;

    private _runtimeBuilt = false;

    protected onLoad(): void {
        if (RewardVideoGalleryPanel.Instance && RewardVideoGalleryPanel.Instance !== this) {
            this.destroy();
            return;
        }
        RewardVideoGalleryPanel.Instance = this;
        EventBus.getInstance().on(GameEvent.REWARD_VIDEO_HISTORY_CHANGED, this.onHistoryChanged, this);
    }

    protected onDestroy(): void {
        EventBus.getInstance().off(GameEvent.REWARD_VIDEO_HISTORY_CHANGED, this.onHistoryChanged, this);
        if (RewardVideoGalleryPanel.Instance === this) {
            RewardVideoGalleryPanel.Instance = null;
        }
    }

    protected onShow(data?: any): void {
        this.ensureRuntimeUi();
        super.onShow(data);
        if (this.titleLabel) this.titleLabel.string = 'Watched Clips';
        this.bindButtons();
        this.rebuildList();
    }

    protected onHide(): void {
        this.unbindButtons();
        super.onHide();
    }

    public open(): void {
        this.show();
    }

    public close(): void {
        if (this._uiManager) {
            this.closePanel();
            return;
        }
        this.hide();
    }

    public refresh(): void {
        if (!this._isVisible) return;
        this.rebuildList();
        AudioManager.getInstance()?.bindButtonSounds(this.node);
    }

    private onHistoryChanged(): void {
        this.refresh();
    }

    private bindButtons(): void {
        this.closeButton?.node.off(Button.EventType.CLICK, this.onCloseClicked, this);
        this.closeButton?.node.on(Button.EventType.CLICK, this.onCloseClicked, this);
    }

    private unbindButtons(): void {
        this.closeButton?.node.off(Button.EventType.CLICK, this.onCloseClicked, this);
    }

    private onCloseClicked(): void {
        this.close();
    }

    private rebuildList(): void {
        this.ensureRuntimeUi();
        if (!this.listRoot) return;
        this.listRoot.removeAllChildren();

        const watched = RewardVideoHistory.getInstance().getWatched();
        if (this.emptyLabel) {
            this.emptyLabel.node.active = watched.length === 0;
            if (watched.length === 0) {
                this.emptyLabel.string = `No clips yet.\nBeat levels ${REWARD_VIDEO_UNLOCK_LEVELS.join(', ')} to unlock clips.`;
            }
        }
        if (watched.length === 0) return;

        const itemWidth = 560;
        const totalH = watched.length * ITEM_HEIGHT + Math.max(0, watched.length - 1) * ITEM_GAP;
        const startY = totalH * 0.5 - ITEM_HEIGHT * 0.5;

        for (let i = 0; i < watched.length; i++) {
            const entry = watched[i];
            const y = startY - i * (ITEM_HEIGHT + ITEM_GAP);
            this.createListItem(this.listRoot, entry, itemWidth, ITEM_HEIGHT, 0, y);
        }
    }

    private createListItem(
        parent: Node,
        entry: WatchedRewardVideo,
        w: number,
        h: number,
        x: number,
        y: number,
    ): void {
        const node = new Node(`Clip_Lv${entry.levelId}`);
        node.layer = Layers.Enum.UI_2D;
        node.setParent(parent);
        const transform = node.addComponent(UITransform);
        transform.setContentSize(w, h);
        node.setPosition(x, y, 0);

        const gfx = node.addComponent(Graphics);
        gfx.fillColor = new Color(55, 48, 72, 255);
        gfx.roundRect(-w * 0.5, -h * 0.5, w, h, 16);
        gfx.fill();

        const button = node.addComponent(Button);
        button.transition = Button.Transition.SCALE;
        button.zoomScale = 0.96;

        const titleNode = new Node('Title');
        titleNode.layer = Layers.Enum.UI_2D;
        titleNode.setParent(node);
        const titleTransform = titleNode.addComponent(UITransform);
        titleTransform.setContentSize(w - 40, h - 16);
        const title = titleNode.addComponent(Label);
        title.string = `Level ${entry.levelId}  ·  Replay`;
        title.fontSize = 30;
        title.lineHeight = 36;
        title.color = Color.WHITE;
        title.horizontalAlign = Label.HorizontalAlign.CENTER;
        title.verticalAlign = Label.VerticalAlign.CENTER;

        node.on(Button.EventType.CLICK, () => this.onClipClicked(entry), this);
    }

    private onClipClicked(entry: WatchedRewardVideo): void {
        console.log('[RewardVideoGallery] Clip clicked', {
            levelId: entry.levelId,
            file: entry.file,
        });
        TeviLoginManager.Instance?.setDebugStatus(
            `Clip replay Lv${entry.levelId} → ${entry.file}`,
        );

        const player = this.resolveVideoPlayer();
        if (!player) {
            console.warn('[RewardVideoGallery] RewardVideoPlayer not available.');
            TeviLoginManager.Instance?.setDebugStatus('Clip replay FAIL: no RewardVideoPlayer');
            return;
        }
        this.close();
        // Defer 1 frame so gallery close does not hide the player layer underneath.
        this.scheduleOnce(() => {
            console.log('[RewardVideoGallery] Starting replay', entry.file);
            player.mountOnVisibleRoot();
            player.playSecretVideo(entry.file, undefined, entry.levelId);
        }, 0);
    }

    private resolveVideoPlayer(): RewardVideoPlayer | null {
        if (RewardVideoPlayer.Instance?.node?.isValid) {
            return RewardVideoPlayer.Instance;
        }
        const found = director.getScene()?.getComponentInChildren(RewardVideoPlayer) ?? null;
        if (found) {
            RewardVideoPlayer.Instance = found;
        }
        return found;
    }

    /** Prefab thiếu property / fallback: dựng shell UI tối thiểu. */
    private ensureRuntimeUi(): void {
        if (this.listRoot && this.closeButton) return;
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

        if (!this.backgroundBlocker) {
            const overlay = new Node('Overlay');
            overlay.layer = Layers.Enum.UI_2D;
            overlay.setParent(this.node);
            const ot = overlay.addComponent(UITransform);
            ot.setContentSize(width, height);
            const og = overlay.addComponent(Graphics);
            og.fillColor = new Color(0, 0, 0, 210);
            og.rect(-width * 0.5, -height * 0.5, width, height);
            og.fill();
            this.backgroundBlocker = overlay;
        }

        if (!this.contentNode) {
            const card = new Node('Panel');
            card.layer = Layers.Enum.UI_2D;
            card.setParent(this.node);
            const ct = card.addComponent(UITransform);
            ct.setContentSize(720, 980);
            const cg = card.addComponent(Graphics);
            cg.fillColor = new Color(28, 24, 36, 250);
            cg.roundRect(-360, -490, 720, 980, 24);
            cg.fill();
            this.contentNode = card;
        }

        const card = this.contentNode!;

        if (!this.titleLabel) {
            const titleNode = new Node('Title');
            titleNode.layer = Layers.Enum.UI_2D;
            titleNode.setParent(card);
            titleNode.setPosition(0, 400, 0);
            const tt = titleNode.addComponent(UITransform);
            tt.setContentSize(640, 64);
            this.titleLabel = titleNode.addComponent(Label);
            this.titleLabel.string = 'Watched Clips';
            this.titleLabel.fontSize = 42;
            this.titleLabel.lineHeight = 50;
            this.titleLabel.color = Color.WHITE;
            this.titleLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        }

        if (!this.emptyLabel) {
            const emptyNode = new Node('EmptyLabel');
            emptyNode.layer = Layers.Enum.UI_2D;
            emptyNode.setParent(card);
            emptyNode.setPosition(0, 40, 0);
            const et = emptyNode.addComponent(UITransform);
            et.setContentSize(600, 160);
            this.emptyLabel = emptyNode.addComponent(Label);
            this.emptyLabel.fontSize = 26;
            this.emptyLabel.lineHeight = 34;
            this.emptyLabel.color = new Color(170, 170, 180, 255);
            this.emptyLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
            this.emptyLabel.verticalAlign = Label.VerticalAlign.CENTER;
            this.emptyLabel.enableWrapText = true;
            this.emptyLabel.overflow = Label.Overflow.RESIZE_HEIGHT;
        }

        if (!this.listRoot) {
            const list = new Node('ListRoot');
            list.layer = Layers.Enum.UI_2D;
            list.setParent(card);
            list.setPosition(0, 20, 0);
            const lt = list.addComponent(UITransform);
            lt.setContentSize(640, 700);
            this.listRoot = list;
        }

        if (!this.closeButton) {
            const closeNode = new Node('BtnClose');
            closeNode.layer = Layers.Enum.UI_2D;
            closeNode.setParent(card);
            closeNode.setPosition(0, -400, 0);
            const ct = closeNode.addComponent(UITransform);
            ct.setContentSize(220, 80);
            const cg = closeNode.addComponent(Graphics);
            cg.fillColor = new Color(90, 60, 160, 255);
            cg.roundRect(-110, -40, 220, 80, 14);
            cg.fill();
            this.closeButton = closeNode.addComponent(Button);
            this.closeButton.transition = Button.Transition.SCALE;
            this.closeButton.zoomScale = 0.94;

            const labelNode = new Node('Label');
            labelNode.layer = Layers.Enum.UI_2D;
            labelNode.setParent(closeNode);
            const lt = labelNode.addComponent(UITransform);
            lt.setContentSize(200, 60);
            const label = labelNode.addComponent(Label);
            label.string = 'Close';
            label.fontSize = 30;
            label.lineHeight = 36;
            label.color = Color.WHITE;
            label.horizontalAlign = Label.HorizontalAlign.CENTER;
            label.verticalAlign = Label.VerticalAlign.CENTER;
        }

        // Widget full-screen nếu chưa có.
        if (!this.node.getComponent(Widget)) {
            const widget = this.node.addComponent(Widget);
            widget.isAlignTop = true;
            widget.isAlignBottom = true;
            widget.isAlignLeft = true;
            widget.isAlignRight = true;
            widget.top = 0;
            widget.bottom = 0;
            widget.left = 0;
            widget.right = 0;
            widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
        }
    }
}
