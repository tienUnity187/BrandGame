import { _decorator, Label, Button } from 'cc';
import { BasePanel } from './BasePanel';
import { GameManager } from '../managers/GameManager';
import { AudioManager } from '../managers/AudioManager';

const { ccclass, property } = _decorator;
const FINAL_LEVEL_ID = 5;

/**
 * LevelCompletePanel - Popup win.
 * Su dung prefab co san, gom nut Home va Next.
 */
@ccclass('LevelCompletePanel')
export class LevelCompletePanel extends BasePanel {
    @property(Label)
    public titleLabel: Label | null = null;

    @property(Button)
    public homeButton: Button | null = null;

    @property(Button)
    public nextButton: Button | null = null;

    @property(Label)
    public timeLabel: Label | null = null;

    private _data: any = null;

    protected onShow(data?: any): void {
        super.onShow(data);
        AudioManager.getInstance()?.playUi('panel_win');
        this._data = data || {};
        this.updateUI();
        this.bindButtons();
    }

    protected onHide(): void {
        this.unbindButtons();
        super.onHide();
    }

    private updateUI(): void {
        const levelId = this._data?.levelId || 1;
        if (this.titleLabel) this.titleLabel.string = `Level ${levelId} Complete!`;
        if (this.timeLabel) this.timeLabel.string = this.formatTime(this._data?.elapsedSeconds || 0);
        if (this.nextButton) {
            this.nextButton.interactable = levelId < FINAL_LEVEL_ID;
            this.nextButton.node.active = levelId < FINAL_LEVEL_ID;
        }
    }

    private formatTime(totalSeconds: number): string {
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const mm = minutes < 10 ? '0' + minutes : minutes;
        const ss = seconds < 10 ? '0' + seconds : seconds;
        return `${mm}:${ss}`;
    }

    private bindButtons(): void {
        this.homeButton?.node.on(Button.EventType.CLICK, this.onHomeClicked, this);
        this.nextButton?.node.on(Button.EventType.CLICK, this.onNextClicked, this);
    }

    private unbindButtons(): void {
        this.homeButton?.node.off(Button.EventType.CLICK, this.onHomeClicked, this);
        this.nextButton?.node.off(Button.EventType.CLICK, this.onNextClicked, this);
    }

    private onHomeClicked(): void {
        this.closePanel();
        GameManager.Instance?.returnToMenu();
    }

    private onNextClicked(): void {
        const nextLevel = (this._data?.levelId || 1) + 1;
        if (nextLevel > FINAL_LEVEL_ID) return;
        this.closePanel();
        GameManager.Instance?.startLevel(nextLevel);
    }
}
