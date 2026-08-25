import { _decorator, Component, Button } from 'cc';
import { GameManager } from '../managers/GameManager';
import { LevelManager } from '../managers/LevelManager';
import { BoosterManager } from '../managers/BoosterManager';
import { TileManager } from '../managers/TileManager';
import { OrderManager } from '../managers/OrderManager';
import { TrayManager } from '../managers/TrayManager';
import { AudioManager } from '../managers/AudioManager';

const { ccclass, property } = _decorator;

/**
 * ResetButton - Attach vào Button trên HUD gameplay (không nằm trong Main).
 * Restart ván hiện tại, không hiện popup thua.
 */
@ccclass('ResetButton')
export class ResetButton extends Component {
    protected onLoad(): void {
        const button = this.getComponent(Button);
        if (button) {
            button.node.on(Button.EventType.CLICK, this.onResetClicked, this);
        }
    }

    private onResetClicked(): void {
        AudioManager.getInstance()?.playSfx('button-click');
        OrderManager.getInstance().abortPendingCompletion();
        TrayManager.getInstance()?.cancelPendingOrderClearEffects();
        BoosterManager.getInstance()?.clearUndoStack();
        TileManager.getInstance()?.setInputLocked(false);
        const levelId = LevelManager.getInstance().getCurrentLevelId();
        if (levelId > 0) {
            void GameManager.Instance?.startLevel(levelId);
        }
    }

    protected onDestroy(): void {
        const button = this.getComponent(Button);
        if (button) {
            button.node.off(Button.EventType.CLICK, this.onResetClicked, this);
        }
    }
}
