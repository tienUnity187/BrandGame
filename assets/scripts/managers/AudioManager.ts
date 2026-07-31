import { _decorator, AudioClip, AudioSource, Button, Component, Node, resources, tween, Tween } from 'cc';

const { ccclass } = _decorator;

const MUSIC_CROSSFADE_SECONDS = 1.2;

/**
 * AudioManager - loads clips from resources/audio and plays music/UI/SFX.
 */
@ccclass('AudioManager')
export class AudioManager extends Component {
    public static Instance: AudioManager;
    public static getInstance(): AudioManager { return AudioManager.Instance; }

    private _musicSources: AudioSource[] = [];
    private _activeMusicIndex: number = 0;
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
    private _musicFadeToken: number = 0;

    private static readonly MAIN_MUSIC_KEYS = [
        'bg-main-1',
        'bg-main-2',
        'bg-main-3',
        'bg-main-4',
        'bg-main-5',
        'bg-main-6',
    ] as const;

    private static readonly PANEL_WIN_KEYS = [
        'panel-win-1',
        'panel-win-2',
        'panel-win-3',
        'panel-win-4',
    ] as const;

    private static readonly PANEL_LOSE_KEYS = [
        'panel-lose-1',
        'panel-lose-2',
        'panel-lose-3',
        'panel-lose-4',
    ] as const;

    private _lastPanelWinKey: string | null = null;
    private _lastPanelLoseKey: string | null = null;

    protected onLoad(): void {
        if (AudioManager.Instance) { this.destroy(); return; }
        AudioManager.Instance = this;
        this._musicSources = [
            this.node.addComponent(AudioSource),
            this.node.addComponent(AudioSource),
        ];
        this._sfxSource = this.node.addComponent(AudioSource);
    }

    public async initialize(): Promise<void> {
        await Promise.all([
            ...AudioManager.MAIN_MUSIC_KEYS.map(key => this.loadClip(key)),
            ...AudioManager.PANEL_WIN_KEYS.map(key => this.loadClip(key)),
            ...AudioManager.PANEL_LOSE_KEYS.map(key => this.loadClip(key)),
            this.loadClip('button-click'),
            this.loadClip('order-complete'),
            this.loadClip('ohh'),
            this.loadClip('ohh2'),
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

    /** order-complete + random ohh/ohh2, phát song song. */
    public async playOrderCompleteSfx(): Promise<void> {
        if (this._sfxMuted || !this._sfxSource) return;
        const ohhKey = Math.random() < 0.5 ? 'ohh' : 'ohh2';
        const [orderClip, ohhClip] = await Promise.all([
            this.loadClip('order-complete'),
            this.loadClip(ohhKey),
        ]);
        if (!this._sfxSource) return;
        if (orderClip) this._sfxSource.playOneShot(orderClip, this._sfxVolume);
        if (ohhClip) this._sfxSource.playOneShot(ohhClip, this._sfxVolume);
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

    /** Random panel-win-1..4 khi thắng. */
    public async playRandomWinUi(): Promise<void> {
        const key = this.pickRandomKey(AudioManager.PANEL_WIN_KEYS, this._lastPanelWinKey);
        this._lastPanelWinKey = key;
        await this.playUi(key);
    }

    /** Random panel-lose-1..4 khi thua. */
    public async playRandomLoseUi(): Promise<void> {
        const key = this.pickRandomKey(AudioManager.PANEL_LOSE_KEYS, this._lastPanelLoseKey);
        this._lastPanelLoseKey = key;
        await this.playUi(key);
    }

    public async playMusic(key: string, fadeSeconds: number = 0): Promise<void> {
        if (this._musicMuted) return;
        const active = this.getActiveMusicSource();
        if (this._currentMusicKey === key && active?.playing) return;

        const clip = await this.loadClip(key);
        if (!clip || this._musicSources.length < 2) return;

        const token = ++this._musicFadeToken;
        const oldSource = this.getActiveMusicSource();
        const nextIndex = 1 - this._activeMusicIndex;
        const newSource = this._musicSources[nextIndex];
        if (!oldSource || !newSource) return;

        this.stopMusicTweens();

        const hasOldTrack = !!this._currentMusicKey && oldSource.playing && oldSource.clip;
        const duration = Math.max(0, fadeSeconds);

        this._currentMusicKey = key;
        this._activeMusicIndex = nextIndex;

        newSource.stop();
        newSource.clip = clip;
        newSource.loop = true;

        if (!hasOldTrack || duration <= 0) {
            oldSource.stop();
            newSource.volume = duration > 0 ? 0 : this._musicVolume;
            newSource.play();
            if (duration > 0) {
                await this.tweenMusicVolume(newSource, this._musicVolume, duration, token);
            }
            return;
        }

        // Crossfade: fade out bài cũ, fade in bài mới
        newSource.volume = 0;
        newSource.play();
        const fadeOut = this.tweenMusicVolume(oldSource, 0, duration, token);
        const fadeIn = this.tweenMusicVolume(newSource, this._musicVolume, duration, token);
        await Promise.all([fadeOut, fadeIn]);
        if (token !== this._musicFadeToken) return;
        oldSource.stop();
        oldSource.volume = this._musicVolume;
    }

    /** Random 1 trong 6 bài bg-main (tránh lặp bài đang phát). Mặc định crossfade. */
    public async playRandomMainMusic(fadeSeconds: number = MUSIC_CROSSFADE_SECONDS): Promise<void> {
        const keys = AudioManager.MAIN_MUSIC_KEYS;
        let candidates = keys.filter(key => key !== this._currentMusicKey);
        if (candidates.length === 0) {
            candidates = [...keys];
        }
        const key = candidates[Math.floor(Math.random() * candidates.length)];
        await this.playMusic(key, fadeSeconds);
    }

    public stopMusic(): void {
        this._musicFadeToken++;
        this.stopMusicTweens();
        for (const source of this._musicSources) {
            source.stop();
            source.volume = this._musicVolume;
        }
        this._currentMusicKey = null;
    }

    public pauseMusic(): void {
        for (const source of this._musicSources) {
            if (source.playing) source.pause();
        }
    }

    public resumeMusic(): void {
        if (this._musicMuted) return;
        const active = this.getActiveMusicSource();
        if (active?.clip) active.play();
    }

    /** Tạm dừng toàn bộ âm thanh game (nhạc + SFX) khi mở overlay video. */
    public pauseAllGameAudio(): void {
        this.pauseMusic();
        this._sfxSource?.stop();
        const loopKeys = Array.from(this._activeLoopSfxKeys);
        for (const key of loopKeys) {
            this.stopLoopSfx(key);
        }
        const repeatingKeys = Array.from(this._repeatingSfxTimers.keys());
        for (const key of repeatingKeys) {
            this.stopRepeatingSfx(key);
        }
    }

    /** Tiếp tục nhạc nền sau khi đóng overlay video. */
    public resumeAllGameAudio(): void {
        this.resumeMusic();
    }

    public setMusicVolume(volume: number): void {
        this._musicVolume = Math.max(0, Math.min(1, volume));
        const active = this.getActiveMusicSource();
        if (active && active.playing) active.volume = this._musicVolume;
    }

    public setSfxVolume(volume: number): void {
        this._sfxVolume = Math.max(0, Math.min(1, volume));
        this._loopSfxSources.forEach(source => source.volume = this._sfxVolume);
    }

    public toggleMusicMute(): void {
        this._musicMuted = !this._musicMuted;
        if (this._musicMuted) {
            this.pauseMusic();
        } else {
            this.resumeMusic();
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
        this.playUi('button-click');
        const active = this.getActiveMusicSource();
        if (this._currentMusicKey && !this._musicMuted && active && !active.playing) {
            active.play();
        }
    }

    private pickRandomKey(keys: readonly string[], lastKey: string | null): string {
        let candidates = keys.filter(key => key !== lastKey);
        if (candidates.length === 0) {
            candidates = [...keys];
        }
        return candidates[Math.floor(Math.random() * candidates.length)];
    }

    private getActiveMusicSource(): AudioSource | null {
        return this._musicSources[this._activeMusicIndex] || null;
    }

    private stopMusicTweens(): void {
        for (const source of this._musicSources) {
            Tween.stopAllByTarget(source);
        }
    }

    private tweenMusicVolume(
        source: AudioSource,
        toVolume: number,
        duration: number,
        token: number,
    ): Promise<void> {
        return new Promise(resolve => {
            if (token !== this._musicFadeToken) {
                resolve();
                return;
            }
            tween(source)
                .to(duration, { volume: toVolume })
                .call(() => resolve())
                .start();
        });
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
        this._musicFadeToken++;
        this.stopMusicTweens();
        this._repeatingSfxTimers.forEach(timer => clearInterval(timer));
        this._repeatingSfxTimers.clear();
        if (AudioManager.Instance === this) {
            AudioManager.Instance = null;
        }
    }
}
