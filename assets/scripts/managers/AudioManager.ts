import { _decorator, AudioClip, AudioSource, Button, Component, Node, resources } from 'cc';

const { ccclass } = _decorator;

/**
 * AudioManager - loads clips from resources/audio and plays music/UI/SFX.
 */
@ccclass('AudioManager')
export class AudioManager extends Component {
    public static Instance: AudioManager;
    public static getInstance(): AudioManager { return AudioManager.Instance; }

    private _musicSource: AudioSource | null = null;
    private _sfxSource: AudioSource | null = null;
    private _loopSfxSources: Map<string, AudioSource> = new Map();
    private _activeLoopSfxKeys: Set<string> = new Set();
    private _repeatingSfxTimers: Map<string, any> = new Map();
    private _clipCache: Map<string, AudioClip> = new Map();
    private _currentMusicKey: string | null = null;
    private _musicVolume: number = 0.45;
    private _sfxVolume: number = 1;
    private _musicMuted: boolean = false;
    private _sfxMuted: boolean = false;

    protected onLoad(): void {
        if (AudioManager.Instance) { this.destroy(); return; }
        AudioManager.Instance = this;
        this._musicSource = this.node.addComponent(AudioSource);
        this._sfxSource = this.node.addComponent(AudioSource);
    }

    public async initialize(): Promise<void> {
        await Promise.all([
            this.loadClip('bg_main'),
            this.loadClip('button_click'),
            this.loadClip('order_complete'),
            this.loadClip('panel_lose'),
            this.loadClip('panel_win'),
            this.loadClip('tile_click'),
            this.loadClip('tile_fall'),
        ]);
    }

    public async playSfx(key: string): Promise<void> {
        if (this._sfxMuted) return;
        const clip = await this.loadClip(key);
        if (!clip || !this._sfxSource) return;
        this._sfxSource.playOneShot(clip, this._sfxVolume);
    }

    public async playLoopSfx(key: string): Promise<void> {
        this._activeLoopSfxKeys.add(key);

        const clip = await this.loadClip(key);
        if (!clip || !this._activeLoopSfxKeys.has(key)) return;

        let source = this._loopSfxSources.get(key) || null;
        if (!source) {
            source = this.node.addComponent(AudioSource);
            this._loopSfxSources.set(key, source);
        }
        if (source.playing) return;

        source.clip = clip;
        source.loop = true;
        source.volume = this._sfxVolume;
        if (!this._sfxMuted) source.play();
    }

    public stopLoopSfx(key: string): void {
        this._activeLoopSfxKeys.delete(key);
        const source = this._loopSfxSources.get(key);
        if (source) source.stop();
    }

    public playRepeatingSfx(key: string, intervalSeconds: number = 0.08): void {
        this.stopRepeatingSfx(key);
        this.playSfx(key);
        const intervalMs = Math.max(16, intervalSeconds * 1000);
        const timer = setInterval(() => {
            this.playSfx(key);
        }, intervalMs);
        this._repeatingSfxTimers.set(key, timer);
    }

    public stopRepeatingSfx(key: string): void {
        const timer = this._repeatingSfxTimers.get(key);
        if (!timer) return;
        clearInterval(timer);
        this._repeatingSfxTimers.delete(key);
    }

    public async playUi(key: string): Promise<void> {
        await this.playSfx(key);
    }

    public async playMusic(key: string): Promise<void> {
        if (this._musicMuted) return;
        if (this._currentMusicKey === key && this._musicSource?.playing) return;

        const clip = await this.loadClip(key);
        if (!clip || !this._musicSource) return;

        this._currentMusicKey = key;
        this._musicSource.stop();
        this._musicSource.clip = clip;
        this._musicSource.loop = true;
        this._musicSource.volume = this._musicVolume;
        this._musicSource.play();
    }

    public stopMusic(): void {
        this._musicSource?.stop();
        this._currentMusicKey = null;
    }

    public pauseMusic(): void {
        this._musicSource?.pause();
    }

    public resumeMusic(): void {
        if (!this._musicMuted) this._musicSource?.play();
    }

    public setMusicVolume(volume: number): void {
        this._musicVolume = Math.max(0, Math.min(1, volume));
        if (this._musicSource) this._musicSource.volume = this._musicVolume;
    }

    public setSfxVolume(volume: number): void {
        this._sfxVolume = Math.max(0, Math.min(1, volume));
        this._loopSfxSources.forEach(source => source.volume = this._sfxVolume);
    }

    public toggleMusicMute(): void {
        this._musicMuted = !this._musicMuted;
        if (this._musicMuted) {
            this._musicSource?.pause();
        } else {
            this._musicSource?.play();
        }
    }

    public toggleSfxMute(): void {
        this._sfxMuted = !this._sfxMuted;
        this._loopSfxSources.forEach((source, key) => {
            if (this._sfxMuted) {
                source.pause();
            } else if (source.clip && this._activeLoopSfxKeys.has(key)) {
                source.play();
            }
        });
    }

    public bindButtonSounds(root: Node | null): void {
        if (!root || !root.isValid) return;
        const buttons = root.getComponentsInChildren(Button);
        for (const button of buttons) {
            const node = button.node as any;
            if (node.__buttonClickAudioBound) continue;
            node.__buttonClickAudioBound = true;
            button.node.on(Button.EventType.CLICK, this.onAnyButtonClicked, this);
        }
    }

    public unbindButtonSound(buttonNode: Node | null): void {
        if (!buttonNode || !buttonNode.isValid) return;
        const node = buttonNode as any;
        if (!node.__buttonClickAudioBound) return;
        buttonNode.off(Button.EventType.CLICK, this.onAnyButtonClicked, this);
        node.__buttonClickAudioBound = false;
    }

    private onAnyButtonClicked(): void {
        this.playUi('button_click');
        if (this._currentMusicKey && !this._musicMuted && !this._musicSource?.playing) {
            this._musicSource?.play();
        }
    }

    private loadClip(key: string): Promise<AudioClip | null> {
        const cached = this._clipCache.get(key);
        if (cached) return Promise.resolve(cached);

        return new Promise(resolve => {
            resources.load(`audio/${key}`, AudioClip, (err, clip) => {
                if (err || !clip) {
                    resolve(null);
                    return;
                }
                this._clipCache.set(key, clip);
                resolve(clip);
            });
        });
    }

    protected onDestroy(): void {
        this._repeatingSfxTimers.forEach(timer => clearInterval(timer));
        this._repeatingSfxTimers.clear();
        if (AudioManager.Instance === this) {
            AudioManager.Instance = null;
        }
    }
}
