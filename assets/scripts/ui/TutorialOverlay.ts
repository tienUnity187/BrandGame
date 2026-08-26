import {
    _decorator,
    BlockInputEvents,
    Button,
    Color,
    Component,
    EventTouch,
    Graphics,
    Label,
    Layers,
    Node,
    resources,
    Size,
    Sprite,
    SpriteFrame,
    UIOpacity,
    UITransform,
    Vec3,
    Widget,
    view,
} from 'cc';
import { TutorialStep } from '../enums/TutorialStep';
import { HINT_STAR_COST, SKIP_STAR_COST, UNDO_STAR_COST } from '../TeviConstants';
import { SkinManager } from '../managers/SkinManager';
import { AudioManager } from '../managers/AudioManager';

const { ccclass, property } = _decorator;

/**
 * Per-step layout for the hand + speech bubble group.
 * Edit these in the panel_tutorial prefab so the pointer sits on the real UI.
 */
@ccclass('TutorialStepLayout')
export class TutorialStepLayout {
    @property({ tooltip: 'Offset of GuideGroup from the target UI center.' })
    public groupOffset: Vec3 = new Vec3(0, 0, 0);

    @property({ tooltip: 'Hand position inside GuideGroup.' })
    public handOffset: Vec3 = new Vec3(90, -80, 0);

    @property({ tooltip: 'Speech bubble position inside GuideGroup.' })
    public popupOffset: Vec3 = new Vec3(0, 180, 0);

    @property({ tooltip: 'Hand rotation in degrees. 0 = finger up.' })
    public handAngle: number = 0;

    @property({ tooltip: 'Hand scale.' })
    public handScale: number = 1;
}

export interface ITutorialStepView {
    title: string;
    body: string;
    nextLabel?: string;
    showNext: boolean;
    showHand: boolean;
    showHotspot: boolean;
    followTarget: Node | null;
    layout: TutorialStepLayout;
    hotspotSize?: { width: number; height: number };
    showCostIcons?: boolean;
    centerPopup?: boolean;
}

/**
 * First-time tutorial overlay. Prefab: prefabs/ui/panel_tutorial.
 * Move GuideGroup / Hand / Popup in the editor; runtime only repositions the group
 * onto the live UI target.
 */
@ccclass('TutorialOverlay')
export class TutorialOverlay extends Component {
    public static Instance: TutorialOverlay | null = null;

    @property(Node)
    public overlay: Node | null = null;

    @property(Node)
    public hotspot: Node | null = null;

    @property(Node)
    public highlight: Node | null = null;

    @property({ type: Node, tooltip: 'Root that moves with the target UI (hand + popup).' })
    public guideGroup: Node | null = null;

    @property({ type: Node, tooltip: 'Hand root. Spine skeleton lives here or on a child named Spine.' })
    public handNode: Node | null = null;

    @property({ type: Node, tooltip: 'Optional Spine child of Hand. Leave empty to auto-find.' })
    public handMotion: Node | null = null;

    @property(Node)
    public popupNode: Node | null = null;

    @property(Label)
    public titleLabel: Label | null = null;

    @property(Label)
    public bodyLabel: Label | null = null;

    @property(Button)
    public nextButton: Button | null = null;

    @property(Label)
    public nextButtonLabel: Label | null = null;

    @property({ type: Node, tooltip: 'Booster cost rows (label + money icon). Shown only on the booster step.' })
    public costList: Node | null = null;

    @property({ type: SpriteFrame, tooltip: 'Coin icon from UI (money.png). Leave empty to load skins/<skin>/ui/money.' })
    public moneySprite: SpriteFrame | null = null;

    @property({ tooltip: 'Spine animation to loop on the Hand skeleton (finger_ui uses push).' })
    public spineAnimationName: string = 'push';

    @property({ tooltip: 'Display size of the money icon on booster cost rows.' })
    public moneyIconSize: number = 48;

    @property({ tooltip: 'Scale multiplier applied to the money icon on booster cost rows.' })
    public moneyIconScale: number = 1.3;

    @property({ tooltip: 'Extra X offset applied to the hand pointer.' })
    public handExtraOffsetX: number = 40;

    @property
    public hotspotPadding: number = 28;

    @property
    public bobDistance: number = 22;

    @property
    public bobDuration: number = 0.38;

    @property({ type: TutorialStepLayout, tooltip: 'Layout when pointing at the Order tray.' })
    public orderLayout: TutorialStepLayout = TutorialOverlay.createLayout(0, 0, 0, 0, 0, -260, 0, 1);

    @property({ type: TutorialStepLayout, tooltip: 'Layout when pointing at the first tile.' })
    public tileLayout: TutorialStepLayout = TutorialOverlay.createLayout(0, 0, 0, 0, 0, 240, 0, 1);

    @property({ type: TutorialStepLayout, tooltip: 'Layout when pointing at the holding tray.' })
    public trayLayout: TutorialStepLayout = TutorialOverlay.createLayout(0, 0, 0, 0, 0, 280, 0, 1);

    @property({ type: TutorialStepLayout, tooltip: 'Layout when pointing at booster buttons.' })
    public boosterLayout: TutorialStepLayout = TutorialOverlay.createLayout(0, 0, 0, 0, 0, 300, 0, 1);

    @property({ type: TutorialStepLayout, tooltip: 'Layout when pointing at the coin bar.' })
    public coinLayout: TutorialStepLayout = TutorialOverlay.createLayout(0, 0, 0, 0, -40, -260, 0, 1);

    @property({ type: TutorialStepLayout, tooltip: 'Centered layout for the final notice.' })
    public clipsLayout: TutorialStepLayout = TutorialOverlay.createLayout(0, 0, 0, 0, 0, 0, 0, 1);

    public onNext: (() => void) | null = null;
    public onHotspot: (() => void) | null = null;

    private _followTarget: Node | null = null;
    private _layout: TutorialStepLayout = new TutorialStepLayout();
    private _hotspotSize: { width: number; height: number } | null = null;
    private _runtimeBuilt = false;
    private _costListReady = false;
    private _popupBaseSize: Size | null = null;
    private _bodyBasePos: Vec3 | null = null;
    private _nextBasePos: Vec3 | null = null;
    private _titleBasePos: Vec3 | null = null;
    private _centerPopup = false;
    private _pointHandAtNext = false;

    private static createLayout(
        gx: number,
        gy: number,
        hx: number,
        hy: number,
        px: number,
        py: number,
        angle: number,
        scale: number,
    ): TutorialStepLayout {
        const layout = new TutorialStepLayout();
        layout.groupOffset = new Vec3(gx, gy, 0);
        layout.handOffset = new Vec3(hx, hy, 0);
        layout.popupOffset = new Vec3(px, py, 0);
        layout.handAngle = angle;
        layout.handScale = scale;
        return layout;
    }

    public getLayoutForStep(step: TutorialStep): TutorialStepLayout {
        switch (step) {
            case TutorialStep.ORDER: return this.orderLayout;
            case TutorialStep.TILE: return this.tileLayout;
            case TutorialStep.TRAY: return this.trayLayout;
            case TutorialStep.BOOSTER: return this.boosterLayout;
            case TutorialStep.COIN: return this.coinLayout;
            case TutorialStep.CLIPS: return this.clipsLayout;
            default: return this.tileLayout;
        }
    }

    protected onLoad(): void {
        if (TutorialOverlay.Instance && TutorialOverlay.Instance !== this) {
            this.destroy();
            return;
        }
        TutorialOverlay.Instance = this;
        this.resolveReferences();
        this.ensureRuntimeLayout();
        this.bindButtons();
        this.node.active = false;
    }

    protected onDestroy(): void {
        this.unbindButtons();
        if (TutorialOverlay.Instance === this) {
            TutorialOverlay.Instance = null;
        }
    }

    protected lateUpdate(): void {
        if (!this.node.active) return;
        this.refreshFollow();
    }

    public showStep(view: ITutorialStepView): void {
        this.ensureRuntimeLayout();
        this.node.active = true;
        if (this.overlay) this.overlay.active = true;
        if (this.guideGroup) this.guideGroup.active = true;
        if (this.popupNode) this.popupNode.active = true;

        if (this.titleLabel) this.titleLabel.string = view.title;
        if (this.bodyLabel) this.bodyLabel.string = view.body;
        if (this.nextButtonLabel) this.nextButtonLabel.string = view.nextLabel || 'Next';
        if (this.nextButton?.node) this.nextButton.node.active = view.showNext;
        this.setCostListVisible(!!view.showCostIcons);

        this._followTarget = view.followTarget;
        this._layout = view.layout;
        this._hotspotSize = view.hotspotSize ?? null;
        this._centerPopup = !!view.centerPopup;
        this._pointHandAtNext = !!view.showHand && !!view.showNext;
        this.setHotspotVisible(view.showHotspot, !!this.onHotspot);
        this.applyLayout();
        this.ensureHandOnOverlay();
        this.refreshFollow();
        if (this.handNode) this.handNode.active = view.showHand;
        if (view.showHand) this.playHandSpine();
        AudioManager.getInstance()?.bindButtonSounds(this.node);
        this.bringToFront();
    }

    public hide(): void {
        this._followTarget = null;
        this._centerPopup = false;
        this.onNext = null;
        this.onHotspot = null;
        this.setCostListVisible(false);
        this.node.active = false;
    }

    public getLayoutClone(step: TutorialStep): TutorialStepLayout {
        const src = this.getLayoutForStep(step);
        const copy = new TutorialStepLayout();
        copy.groupOffset = src.groupOffset.clone();
        copy.handOffset = src.handOffset.clone();
        copy.popupOffset = src.popupOffset.clone();
        copy.handAngle = src.handAngle;
        copy.handScale = src.handScale;
        return copy;
    }

    private resolveReferences(): void {
        if (!this.overlay) this.overlay = this.node.getChildByName('Overlay');
        if (!this.hotspot) this.hotspot = this.node.getChildByName('Hotspot');
        if (!this.highlight) this.highlight = this.node.getChildByName('Highlight');
        if (!this.guideGroup) this.guideGroup = this.node.getChildByName('GuideGroup');
        const group = this.guideGroup;
        if (group) {
            if (!this.handNode) this.handNode = group.getChildByName('Hand');
            if (!this.popupNode) this.popupNode = group.getChildByName('Popup');
        }
        if (this.handNode && !this.handMotion) {
            this.handMotion = this.handNode.getChildByName('Spine')
                || this.handNode.getChildByName('HandMotion')
                || this.handNode;
        }
        const popup = this.popupNode;
        if (popup) {
            if (!this.titleLabel) {
                this.titleLabel = popup.getChildByName('Title')?.getComponent(Label) ?? null;
            }
            if (!this.bodyLabel) {
                this.bodyLabel = popup.getChildByName('Body')?.getComponent(Label) ?? null;
            }
            if (!this.nextButton) {
                this.nextButton = popup.getChildByName('BtnNext')?.getComponent(Button) ?? null;
            }
            if (!this.costList) {
                this.costList = popup.getChildByName('CostList');
            }
        }
        if (this.nextButton && !this.nextButtonLabel) {
            this.nextButtonLabel = this.nextButton.node.getChildByName('Label')?.getComponent(Label)
                ?? this.nextButton.node.getComponentInChildren(Label)
                ?? null;
        }
    }

    private bindButtons(): void {
        this.nextButton?.node.on(Button.EventType.CLICK, this.onNextClicked, this);
        this.hotspot?.on(Node.EventType.TOUCH_END, this.onHotspotTouched, this);
    }

    private unbindButtons(): void {
        this.nextButton?.node.off(Button.EventType.CLICK, this.onNextClicked, this);
        this.hotspot?.off(Node.EventType.TOUCH_END, this.onHotspotTouched, this);
    }

    private onNextClicked(): void {
        this.onNext?.();
    }

    private onHotspotTouched(event: EventTouch): void {
        event.propagationStopped = true;
        this.onHotspot?.();
    }

    private setCostListVisible(visible: boolean): void {
        if (visible) this.ensureCostList();
        if (this.costList?.isValid) this.costList.active = visible;
        this.applyBoosterPopupLayout(visible);
    }

    private applyBoosterPopupLayout(expanded: boolean): void {
        if (!this.popupNode?.isValid) return;
        const popupUt = this.popupNode.getComponent(UITransform);
        if (!popupUt) return;

        const titleNode = this.titleLabel?.node;
        const titleWidget = titleNode?.getComponent(Widget) ?? null;
        if (!this._popupBaseSize) {
            this._popupBaseSize = new Size(popupUt.width, popupUt.height);
        }
        if (this.bodyLabel?.node && !this._bodyBasePos) {
            this._bodyBasePos = this.bodyLabel.node.position.clone();
        }
        if (this.nextButton?.node && !this._nextBasePos) {
            this._nextBasePos = this.nextButton.node.position.clone();
        }
        if (titleNode && !this._titleBasePos) {
            this._titleBasePos = titleNode.position.clone();
        }

        if (expanded) {
            const popupW = Math.max(this._popupBaseSize.width, 640);
            const popupH = 620;
            popupUt.setContentSize(popupW, popupH);
            const topY = popupH * 0.5;
            const bottomY = -popupH * 0.5;

            // Widget keeps the prefab Y after resize, so pin title to the new top.
            if (titleWidget) titleWidget.enabled = false;
            if (titleNode) titleNode.setPosition(0, topY - 28, 0);

            const titleUt = titleNode?.getComponent(UITransform);
            const titleBottom = titleNode && titleUt
                ? titleNode.position.y - titleUt.height * titleUt.anchorY
                : topY - 88;

            if (this.bodyLabel?.node) {
                const bodyUt = this.bodyLabel.node.getComponent(UITransform);
                const bodyH = Math.min(bodyUt?.height || 120, 110);
                this.bodyLabel.node.setPosition(0, titleBottom - 10 - bodyH * 0.5, 0);
            }

            const nextNode = this.nextButton?.node;
            const nextH = nextNode?.getComponent(UITransform)?.height || 83;
            if (nextNode) {
                nextNode.setPosition(0, bottomY + 22 + nextH * 0.5, 0);
            }

            if (this.costList?.isValid) {
                const bodyNode = this.bodyLabel?.node;
                const bodyUt = bodyNode?.getComponent(UITransform);
                const bodyBottom = bodyNode && bodyUt
                    ? bodyNode.position.y - bodyUt.height * bodyUt.anchorY
                    : 40;
                const nextTop = nextNode ? nextNode.position.y + nextH * 0.5 : -180;
                this.costList.setPosition(0, (bodyBottom + nextTop) * 0.5, 0);
            }
            return;
        }

        popupUt.setContentSize(this._popupBaseSize.width, this._popupBaseSize.height);
        if (titleWidget) titleWidget.enabled = true;
        if (titleNode && this._titleBasePos) titleNode.setPosition(this._titleBasePos);
        titleWidget?.updateAlignment();
        if (this.bodyLabel?.node && this._bodyBasePos) {
            this.bodyLabel.node.setPosition(this._bodyBasePos);
        }
        if (this.nextButton?.node && this._nextBasePos) {
            this.nextButton.node.setPosition(this._nextBasePos);
        }
    }

    private ensureCostList(): void {
        if (!this.popupNode?.isValid) return;
        if (!this.costList?.isValid) {
            this.costList = this.popupNode.getChildByName('CostList');
        }
        if (!this.costList?.isValid) {
            this.costList = new Node('CostList');
            this.costList.layer = this.popupNode.layer;
            this.costList.setParent(this.popupNode);
            const ut = this.costList.addComponent(UITransform);
            ut.setContentSize(480, 150);
            this.costList.setPosition(0, -40, 0);
        }
        this.buildCostRows();
        this._costListReady = true;
        this.applyMoneySprite(this.moneySprite);
        if (!this.moneySprite) this.loadMoneySprite();
    }

    private buildCostRows(): void {
        if (!this.costList?.isValid) return;
        const rows = [
            { name: 'Undo', cost: UNDO_STAR_COST },
            { name: 'Hint', cost: HINT_STAR_COST },
            { name: 'Skip', cost: SKIP_STAR_COST },
        ];
        const rowH = 56;
        const startY = (rows.length - 1) * rowH * 0.5;
        const iconSize = this.moneyIconSize;
        const costListUt = this.costList.getComponent(UITransform);
        if (costListUt) costListUt.setContentSize(520, rowH * rows.length);
        for (let i = 0; i < rows.length; i++) {
            const row = this.ensureChild(this.costList, `Cost_${rows[i].name}`, 520, rowH);
            this.setNodeSize(row, 520, rowH);
            row.setPosition(0, startY - i * rowH, 0);

            const nameNode = this.ensureChild(row, 'Name', 220, rowH);
            this.setNodeSize(nameNode, 220, rowH);
            nameNode.setPosition(-80, 0, 0);
            let nameLabel = nameNode.getComponent(Label);
            if (!nameLabel) nameLabel = nameNode.addComponent(Label);
            nameLabel.string = rows[i].name;
            nameLabel.fontSize = 38;
            nameLabel.lineHeight = 46;
            nameLabel.color = Color.WHITE;
            nameLabel.horizontalAlign = Label.HorizontalAlign.RIGHT;
            nameLabel.verticalAlign = Label.VerticalAlign.CENTER;
            nameLabel.isBold = true;
            nameLabel.overflow = Label.Overflow.NONE;

            const costNode = this.ensureChild(row, 'Cost', 80, rowH);
            this.setNodeSize(costNode, 80, rowH);
            costNode.setPosition(48, 0, 0);
            let costLabel = costNode.getComponent(Label);
            if (!costLabel) costLabel = costNode.addComponent(Label);
            costLabel.string = `${rows[i].cost}`;
            costLabel.fontSize = 38;
            costLabel.lineHeight = 46;
            costLabel.color = new Color(255, 220, 90, 255);
            costLabel.horizontalAlign = Label.HorizontalAlign.RIGHT;
            costLabel.verticalAlign = Label.VerticalAlign.CENTER;
            costLabel.isBold = true;

            const iconNode = this.ensureChild(row, 'Money', iconSize, iconSize);
            this.setNodeSize(iconNode, iconSize, iconSize);
            iconNode.setPosition(94, 0, 0);
            iconNode.setScale(this.moneyIconScale, this.moneyIconScale, 1);
            if (!iconNode.getComponent(Sprite)) iconNode.addComponent(Sprite);
        }
        this.applyMoneySprite(this.moneySprite);
    }

    private loadMoneySprite(): void {
        const skinId = SkinManager.getInstance()?.getCurrentSkin()?.skinId || 'uma';
        const paths = [
            `skins/${skinId}/ui/money/spriteFrame`,
            'skins/uma/ui/money/spriteFrame',
        ];
        this.tryLoadMoneyPath(paths, 0);
    }

    private tryLoadMoneyPath(paths: string[], index: number): void {
        if (index >= paths.length) return;
        resources.load(paths[index], SpriteFrame, (err, sf) => {
            if (err || !sf) {
                this.tryLoadMoneyPath(paths, index + 1);
                return;
            }
            this.moneySprite = sf;
            this.applyMoneySprite(sf);
        });
    }

    private applyMoneySprite(sf: SpriteFrame | null): void {
        if (!sf || !this.costList?.isValid) return;
        for (const row of this.costList.children) {
            const icon = row.getChildByName('Money')?.getComponent(Sprite);
            if (icon) {
                icon.spriteFrame = sf;
                icon.sizeMode = Sprite.SizeMode.CUSTOM;
                icon.trim = true;
                const ut = icon.node.getComponent(UITransform) || icon.node.addComponent(UITransform);
                ut.setContentSize(this.moneyIconSize, this.moneyIconSize);
                icon.node.setScale(this.moneyIconScale, this.moneyIconScale, 1);
            }
        }
    }

    private applyLayout(): void {
        const layout = this._layout;
        if (this.handNode) {
            this.handNode.setScale(layout.handScale, layout.handScale, 1);
        }
        if (this.popupNode) {
            this.popupNode.setPosition(layout.popupOffset);
        }
    }

    /** Hand tracks the highlight in overlay space — not the popup bubble. */
    private ensureHandOnOverlay(): void {
        if (!this.handNode?.isValid || !this.node?.isValid) return;
        if (this.handNode.parent === this.node) return;
        const world = this.handNode.worldPosition.clone();
        this.handNode.setParent(this.node);
        const ui = this.node.getComponent(UITransform);
        if (ui) {
            this.handNode.setPosition(ui.convertToNodeSpaceAR(world));
        }
    }

    private applyTutorialLayerOrder(): void {
        const ordered = this._pointHandAtNext
            ? [this.overlay, this.highlight, this.hotspot, this.guideGroup, this.handNode]
            : [this.overlay, this.highlight, this.handNode, this.hotspot, this.guideGroup];
        let index = 0;
        for (const node of ordered) {
            if (!node?.isValid || !node.parent) continue;
            node.setSiblingIndex(index++);
        }
    }

    private placeHandOnTarget(targetLocal: Vec3): void {
        if (!this.handNode?.active || !this.handNode.isValid || this._centerPopup) return;

        if (this._pointHandAtNext && this.nextButton?.node?.active) {
            this.placeHandOnNextButton();
            return;
        }

        if (!this._followTarget) return;

        this.handNode.setPosition(this.getHandPosition(targetLocal.x, targetLocal.y));
        this.handNode.angle = 0;
        this.handNode.setScale(this._layout.handScale, this._layout.handScale, 1);
    }

    private placeHandOnNextButton(): void {
        if (!this.handNode?.isValid || !this.nextButton?.node?.isValid) return;
        const ui = this.node.getComponent(UITransform);
        if (!ui) return;

        const nextLocal = ui.convertToNodeSpaceAR(this.nextButton.node.worldPosition);

        this.handNode.setPosition(this.getHandPosition(nextLocal.x, nextLocal.y));
        this.handNode.angle = 0;
        this.handNode.setScale(this._layout.handScale, this._layout.handScale, 1);
    }

    private getHandPosition(x: number, y: number): Vec3 {
        return new Vec3(
            x + this._layout.handOffset.x + this.handExtraOffsetX,
            y + this._layout.handOffset.y,
            0,
        );
    }

    private refreshFollow(): void {
        if (!this.guideGroup?.isValid) return;
        if (this._centerPopup) {
            this.guideGroup.setPosition(0, 0, 0);
            if (this.popupNode?.isValid) {
                this.popupNode.setPosition(0, 0, 0);
            }
            this.placeHandOnTarget(new Vec3(0, 0, 0));
            this.applyTutorialLayerOrder();
            return;
        }
        const local = this.getTargetLocal();
        const offset = this._layout.groupOffset;
        this.guideGroup.setPosition(local.x + offset.x, local.y + offset.y, 0);
        this.refreshHotspot(local);
        this.placePopupClearOfTarget(local);
        this.placeHandOnTarget(local);
        this.applyTutorialLayerOrder();
    }

    private getTargetLocal(): Vec3 {
        const target = this._followTarget;
        if (!target?.isValid) return new Vec3(0, 0, 0);
        const world = target.worldPosition;
        const ui = this.node.getComponent(UITransform);
        if (!ui) return world.clone();
        return ui.convertToNodeSpaceAR(world);
    }

    private setHotspotVisible(showHighlight: boolean, clickable: boolean): void {
        if (this.highlight) this.highlight.active = showHighlight;
        if (this.hotspot) this.hotspot.active = showHighlight && clickable;
    }

    private refreshHotspot(local: Vec3): void {
        const highlightOn = !!this.highlight?.active;
        const hotspotOn = !!this.hotspot?.active && !!this.hotspot?.isValid;
        if (!highlightOn && !hotspotOn) return;

        const size = this.getTargetSize();
        if (hotspotOn && this.hotspot) {
            const hotspotUt = this.hotspot.getComponent(UITransform) || this.hotspot.addComponent(UITransform);
            hotspotUt.setContentSize(size.width, size.height);
            this.hotspot.setPosition(local.x, local.y, 0);
        }
        if (highlightOn && this.highlight?.isValid) {
            this.highlight.setPosition(local.x, local.y, 0);
            this.drawHighlight(size.width, size.height);
        }
    }

    private getTargetSize(): { width: number; height: number } {
        if (this._hotspotSize) return this._hotspotSize;
        const target = this._followTarget;
        if (target?.isValid) {
            const ut = target.getComponent(UITransform);
            if (ut) {
                const scaleX = Math.abs(target.worldScale.x) || 1;
                const scaleY = Math.abs(target.worldScale.y) || 1;
                return {
                    width: Math.max(80, ut.width * scaleX) + this.hotspotPadding,
                    height: Math.max(80, ut.height * scaleY) + this.hotspotPadding,
                };
            }
        }
        return { width: 140, height: 140 };
    }

    private drawHighlight(width: number, height: number): void {
        if (!this.highlight?.isValid) return;
        const gfx = this.highlight.getComponent(Graphics) || this.highlight.addComponent(Graphics);
        gfx.clear();
        const hw = width * 0.5;
        const hh = height * 0.5;
        gfx.lineWidth = 8;
        gfx.strokeColor = new Color(255, 214, 70, 230);
        gfx.roundRect(-hw, -hh, width, height, 24);
        gfx.stroke();
    }

    private playHandSpine(): void {
        const skeleton = this.findSpineSkeleton();
        if (!skeleton || typeof skeleton.setAnimation !== 'function') return;
        const anim = this.spineAnimationName || 'push';
        try {
            skeleton.setAnimation(0, anim, true);
        } catch {
            try {
                skeleton.setAnimation(0, skeleton.animation || 'push', true);
            } catch {
            }
        }
    }

    private findSpineSkeleton(): any {
        const hosts = [this.handMotion, this.handNode];
        for (const host of hosts) {
            if (!host?.isValid) continue;
            const direct: any = host.getComponent('sp.Skeleton');
            if (direct) return direct;
            for (const child of host.children) {
                const nested: any = child.getComponent('sp.Skeleton');
                if (nested) return nested;
            }
        }
        return null;
    }

    /**
     * Keep Popup on-screen and off the highlighted UI, using the popup's real rect.
     * layout.popupOffset is the preferred side (above / below / left / right).
     */
    private placePopupClearOfTarget(targetLocal: Vec3): void {
        if (!this.popupNode?.isValid || !this.guideGroup?.isValid) return;
        const popupUt = this.popupNode.getComponent(UITransform);
        const rootUt = this.node.getComponent(UITransform);
        if (!popupUt || !rootUt) return;

        const popupW = popupUt.width;
        const popupH = popupUt.height;
        if (popupW <= 0 || popupH <= 0) return;

        const group = this.guideGroup.position;
        const preferred = this._layout.popupOffset;
        const targetSize = this.getTargetSize();
        const gap = 24;
        const margin = 20;
        const screenHalfW = rootUt.width * 0.5;
        const screenHalfH = rootUt.height * 0.5;

        const candidates: Vec3[] = [preferred.clone()];
        const belowY = (targetLocal.y - group.y) - (targetSize.height * 0.5 + popupH * 0.5 + gap);
        const aboveY = (targetLocal.y - group.y) + (targetSize.height * 0.5 + popupH * 0.5 + gap);
        const leftX = (targetLocal.x - group.x) - (targetSize.width * 0.5 + popupW * 0.5 + gap);
        const rightX = (targetLocal.x - group.x) + (targetSize.width * 0.5 + popupW * 0.5 + gap);
        if (preferred.y <= 0) {
            candidates.push(new Vec3(preferred.x, belowY, 0), new Vec3(preferred.x, aboveY, 0));
        } else {
            candidates.push(new Vec3(preferred.x, aboveY, 0), new Vec3(preferred.x, belowY, 0));
        }
        candidates.push(new Vec3(leftX, preferred.y, 0), new Vec3(rightX, preferred.y, 0));

        const overlapsTarget = (overlayX: number, overlayY: number): boolean => {
            const pL = overlayX - popupW * 0.5;
            const pR = overlayX + popupW * 0.5;
            const pB = overlayY - popupH * 0.5;
            const pT = overlayY + popupH * 0.5;
            const tL = targetLocal.x - targetSize.width * 0.5;
            const tR = targetLocal.x + targetSize.width * 0.5;
            const tB = targetLocal.y - targetSize.height * 0.5;
            const tT = targetLocal.y + targetSize.height * 0.5;
            return pL < tR && pR > tL && pB < tT && pT > tB;
        };

        const clampCenter = (overlayX: number, overlayY: number): { x: number; y: number } => {
            const minX = -screenHalfW + margin + popupW * 0.5;
            const maxX = screenHalfW - margin - popupW * 0.5;
            const minY = -screenHalfH + margin + popupH * 0.5;
            const maxY = screenHalfH - margin - popupH * 0.5;
            return {
                x: Math.min(maxX, Math.max(minX, overlayX)),
                y: Math.min(maxY, Math.max(minY, overlayY)),
            };
        };

        let chosen = clampCenter(group.x + preferred.x, group.y + preferred.y);
        for (const candidate of candidates) {
            const overlayX = group.x + candidate.x;
            const overlayY = group.y + candidate.y;
            const clamped = clampCenter(overlayX, overlayY);
            if (!this._followTarget || !overlapsTarget(clamped.x, clamped.y)) {
                chosen = clamped;
                break;
            }
        }

        this.popupNode.setPosition(chosen.x - group.x, chosen.y - group.y, 0);
    }

    private bringToFront(): void {
        const parent = this.node.parent;
        if (parent) this.node.setSiblingIndex(parent.children.length - 1);
    }

    public mountOnCanvas(canvas: Node): void {
        if (!canvas?.isValid) return;
        if (this.node.parent !== canvas) this.node.setParent(canvas);
        this.node.setPosition(0, 0, 0);
        this.node.layer = canvas.layer;
        this.applyFullStretch(this.node, canvas);
        this.bringToFront();
    }

    private applyFullStretch(node: Node, canvas: Node): void {
        let widget = node.getComponent(Widget);
        if (!widget) widget = node.addComponent(Widget);
        widget.target = canvas;
        widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
        widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
        widget.isAlignHorizontalCenter = false;
        widget.top = widget.bottom = widget.left = widget.right = 0;
        widget.updateAlignment();
    }

    /** Builds a usable overlay if the prefab is missing child nodes. */
    private ensureRuntimeLayout(): void {
        this.resolveReferences();
        if (this.overlay && this.guideGroup && this.popupNode && this.titleLabel && this.bodyLabel && this.nextButton) {
            this.ensureOverlayBlocker();
            if (this.popupNode && !this.popupNode.getComponent(BlockInputEvents)) {
                this.popupNode.addComponent(BlockInputEvents);
            }
            if (this.handNode && !this.handMotion) {
                this.handMotion = this.handNode.getChildByName('Spine') || this.handNode;
            }
            return;
        }
        if (this._runtimeBuilt) return;
        this._runtimeBuilt = true;

        const design = view.getDesignResolutionSize();
        const width = design.width || 1080;
        const height = design.height || 1920;
        this.node.layer = Layers.Enum.UI_2D;
        const rootUt = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        rootUt.setContentSize(width, height);

        if (!this.overlay) {
            this.overlay = this.createFullNode('Overlay', width, height);
            const gfx = this.overlay.addComponent(Graphics);
            gfx.fillColor = new Color(0, 0, 0, 120);
            gfx.rect(-width * 0.5, -height * 0.5, width, height);
            gfx.fill();
            this.overlay.addComponent(BlockInputEvents);
            const opacity = this.overlay.addComponent(UIOpacity);
            opacity.opacity = 160;
        }
        this.ensureOverlayBlocker();

        if (!this.highlight) {
            this.highlight = this.ensureChild(this.node, 'Highlight', 160, 160);
            this.highlight.active = false;
        }
        if (!this.hotspot) {
            this.hotspot = this.ensureChild(this.node, 'Hotspot', 160, 160);
            this.hotspot.addComponent(Button).transition = Button.Transition.NONE;
            this.hotspot.active = false;
        }
        if (!this.guideGroup) {
            this.guideGroup = this.ensureChild(this.node, 'GuideGroup', 10, 10);
        }
        if (!this.handNode) {
            this.handNode = this.ensureChild(this.guideGroup, 'Hand', 90, 140);
        }
        this.handMotion = this.handNode.getChildByName('Spine') || this.handNode;
        if (!this.popupNode) {
            this.popupNode = this.ensureChild(this.guideGroup, 'Popup', 620, 280);
            const popupGfx = this.popupNode.addComponent(Graphics);
            popupGfx.fillColor = new Color(36, 32, 48, 245);
            popupGfx.roundRect(-310, -140, 620, 280, 24);
            popupGfx.fill();
            popupGfx.strokeColor = new Color(255, 214, 90, 255);
            popupGfx.lineWidth = 4;
            popupGfx.roundRect(-310, -140, 620, 280, 24);
            popupGfx.stroke();
        }
        if (!this.titleLabel) {
            const titleNode = this.ensureChild(this.popupNode, 'Title', 560, 52);
            titleNode.setPosition(0, 86, 0);
            this.titleLabel = titleNode.addComponent(Label);
            this.titleLabel.fontSize = 36;
            this.titleLabel.lineHeight = 42;
            this.titleLabel.color = new Color(255, 220, 90, 255);
            this.titleLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
            this.titleLabel.verticalAlign = Label.VerticalAlign.CENTER;
            this.titleLabel.isBold = true;
        }
        if (!this.bodyLabel) {
            const bodyNode = this.ensureChild(this.popupNode, 'Body', 560, 130);
            bodyNode.setPosition(0, 8, 0);
            this.bodyLabel = bodyNode.addComponent(Label);
            this.bodyLabel.fontSize = 26;
            this.bodyLabel.lineHeight = 34;
            this.bodyLabel.color = Color.WHITE;
            this.bodyLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
            this.bodyLabel.verticalAlign = Label.VerticalAlign.CENTER;
            this.bodyLabel.enableWrapText = true;
            this.bodyLabel.overflow = Label.Overflow.SHRINK;
        }
        if (!this.nextButton) {
            const btnNode = this.ensureChild(this.popupNode, 'BtnNext', 220, 64);
            btnNode.setPosition(0, -92, 0);
            const btnGfx = btnNode.addComponent(Graphics);
            btnGfx.fillColor = new Color(90, 170, 255, 255);
            btnGfx.roundRect(-110, -32, 220, 64, 16);
            btnGfx.fill();
            this.nextButton = btnNode.addComponent(Button);
            this.nextButton.transition = Button.Transition.SCALE;
            this.nextButton.zoomScale = 0.94;
            const labelNode = this.ensureChild(btnNode, 'Label', 200, 52);
            this.nextButtonLabel = labelNode.addComponent(Label);
            this.nextButtonLabel.string = 'Next';
            this.nextButtonLabel.fontSize = 30;
            this.nextButtonLabel.lineHeight = 34;
            this.nextButtonLabel.color = Color.WHITE;
            this.nextButtonLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
            this.nextButtonLabel.verticalAlign = Label.VerticalAlign.CENTER;
        }
        this.bindButtons();
    }

    private ensureOverlayBlocker(): void {
        if (!this.overlay?.isValid) return;
        if (!this.overlay.getComponent(BlockInputEvents)) {
            this.overlay.addComponent(BlockInputEvents);
        }
        const design = view.getDesignResolutionSize();
        const ut = this.overlay.getComponent(UITransform) || this.overlay.addComponent(UITransform);
        ut.setContentSize(design.width || 1080, design.height || 1920);
    }

    private createFullNode(name: string, width: number, height: number): Node {
        const node = new Node(name);
        node.layer = this.node.layer;
        node.setParent(this.node);
        const ut = node.addComponent(UITransform);
        ut.setContentSize(width, height);
        return node;
    }

    private ensureChild(parent: Node, name: string, width: number, height: number): Node {
        let node = parent.getChildByName(name);
        if (!node) {
            node = new Node(name);
            node.layer = parent.layer;
            node.setParent(parent);
        }
        const ut = node.getComponent(UITransform) || node.addComponent(UITransform);
        if (ut.width <= 0 || ut.height <= 0) ut.setContentSize(new Size(width, height));
        return node;
    }

    private setNodeSize(node: Node, width: number, height: number): void {
        const ut = node.getComponent(UITransform) || node.addComponent(UITransform);
        ut.setContentSize(width, height);
    }
}
