import { _decorator, Component, Button } from 'cc';
import { GameManager } from '../managers/GameManager';
import { LevelManager } from '../managers/LevelManager';

const { ccclass, property } = _decorator;

/**
 * ResetButton - Attach vào một Button node trong scene.
 * Khi nhấn sẽ reset ngay màn hiện tại.
 */
@ccclass('ResetButton')
export class ResetButton extends Component {
    protected onLoad(): void {
        const button = this.getComponent(Button);
        if (button) {
            button.node.on('click', this.onResetClicked, this);
        }
    }

    private onResetClicked(): void {
        const levelId = LevelManager.getInstance().getCurrentLevelId();
        if (levelId > 0) {
            GameManager.Instance?.startLevel(levelId);
        }
    }

    protected onDestroy(): void {
        const button = this.getComponent(Button);
        if (button) {
            button.node.off('click', this.onResetClicked, this);
        }
    }
}
