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
    VideoPlayer,
    Widget,
    view,
} from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvent } from '../enums/GameEvent';
import { AudioManager } from '../managers/AudioManager';
import { RewardVideoHistory } from '../services/RewardVideoHistory';
import { REWARD_VIDEO_TOKEN_URL } from '../TeviConstants';
import { TeviLoginManager } from '../TeviLoginManager';

const { ccclass, property } = _decorator;

/** Tỷ lệ mặc định khi chưa đọc được metadata (landscape 16:9). */
const DEFAULT_VIDEO_ASPECT = 16 / 9;

interface RewardVideoTokenResponse {
    videoUrl?: string;
    expiresAt?: number;
    error?: string;
    hint?: string;
    tried?: string[];
    resolvedKey?: string;
    canonical?: string;
}

/**
 * RewardVideoPlayer - Popup phát video phần thưởng trong game.
 *
 * Lưu ý Cocos 3.8: keepAspectRatio=true sẽ reset UITransform về đúng pixel gốc
 * của file video (nên khung bị nhỏ). Ta tắt option đó và tự scale khít bề ngang.
 */
@ccclass('RewardVideoPlayer')
export class RewardVideoPlayer extends Component {
    public static Instance: RewardVideoPlayer | null = null;

    @property(VideoPlayer)
    public videoPlayer: VideoPlayer | null = null;

    @property(Node)
    public videoContainer: Node | null = null;

    private _closeButton: Button | null = null;
    /** Nút X HTML nằm trên thẻ <video> (web/Tevi) vì video DOM thường đè canvas. */
    private _domCloseButton: HTMLButtonElement | null = null;
    private _onClosedCallback: (() => void) | null = null;
    private _isClosing: boolean = false;
    private _isPlaying: boolean = false;
    private _eventsBound: boolean = false;
    private _audioPausedByVideo: boolean = false;
    private _videoAspect: number = DEFAULT_VIDEO_ASPECT;
    private _loadRequestId: number = 0;
    /** Chỉ đóng bằng COMPLETED sau khi video thực sự bắt đầu phát. */
    private _hasStartedPlaying: boolean = false;
    /** URL video tạm gần nhất để in log/debug. */
    private _lastVideoUrl: string = '';
    /** Level mốc tương ứng clip đang phát (để lưu local khi xem được). */
    private _currentLevelId: number = 0;

    protected onLoad(): void {
        if (RewardVideoPlayer.Instance && RewardVideoPlayer.Instance !== this) {
            this.destroy();
            return;
        }
        RewardVideoPlayer.Instance = this;
        this.ensureUi();
        this.bindEvents();
        if (this.videoContainer) {
            this.videoContainer.active = false;
        }
    }

    protected onDestroy(): void {
        this.unbindEvents();
        this.removeDomCloseButton();
        if (this._audioPausedByVideo) {
            AudioManager.getInstance()?.resumeAllGameAudio();
            this._audioPausedByVideo = false;
        }
        if (RewardVideoPlayer.Instance === this) {
            RewardVideoPlayer.Instance = null;
        }
    }

    /**
     * Mở popup và phát video thưởng.
     * @param videoFile Tên object trên R2, ví dụ `vn_reward_01.mp4`.
     * @param onClosedCallback Gọi đúng một lần khi đóng (xem hết hoặc bấm X).
     * @param levelId Level mốc (5/10/15/25/38/50) — dùng lưu local sau khi video đã PLAYING.
     */
    public playSecretVideo(
        videoFile: string,
        onClosedCallback?: () => void,
        levelId?: number,
    ): void {
        console.log('[RewardVideoPlayer] playSecretVideo() called', {
            videoFile,
            levelId: levelId ?? 0,
            tokenUrl: REWARD_VIDEO_TOKEN_URL,
            plannedBody: { file: videoFile },
            hasTeviToken: !!(TeviLoginManager.Instance?.getUserToken()?.trim()),
        });
        void this.loadAndPlaySecretVideo(videoFile, onClosedCallback, levelId);
    }

    /** Gắn player lên Canvas (luôn visible) — cần khi replay clip từ Home. */
    public mountOnVisibleRoot(): void {
        const scene = director.getScene();
        if (!scene?.isValid) return;

        const canvas = scene.getChildByName('Canvas');
        const parent = canvas?.isValid ? canvas : scene;
        if (this.node.parent !== parent) {
            this.node.setParent(parent);
        }
        this.node.setPosition(0, 0, 0);
        this.node.layer = parent.layer;
        this.node.active = true;
        this.node.setSiblingIndex(parent.children.length - 1);
    }

    /** Xin URL tạm từ Worker rồi mới phát, không giữ URL R2 trong game. */
    private async loadAndPlaySecretVideo(
        videoFile: string,
        onClosedCallback?: () => void,
        levelId?: number,
    ): Promise<void> {
        this.ensureUi();
        this.mountOnVisibleRoot();
        if (!this.videoPlayer || !this.videoContainer) {
            this.logStatus('Error: missing VideoPlayer/container.');
            onClosedCallback?.();
            return;
        }

        const fileName = (videoFile || '').trim();
        if (!fileName) {
            this.logStatus('Error: missing video file name.');
            onClosedCallback?.();
            return;
        }

        if (this._isPlaying) {
            this.closeInternal(false);
        }

        this._onClosedCallback = onClosedCallback ?? null;
        this._isClosing = false;
        this._isPlaying = true;
        this._hasStartedPlaying = false;
        this._currentLevelId = Math.floor(levelId || 0);
        const requestId = ++this._loadRequestId;

        this.pauseGameAudio();
        this.applyFitWidthLayout();

        this.videoContainer.active = true;
        // Đưa cả player + container lên trên cùng (trên nút Clip / HUD khác).
        const sceneParent = this.node.parent;
        if (sceneParent) {
            this.node.setSiblingIndex(sceneParent.children.length - 1);
        }
        const parent = this.videoContainer.parent;
        if (parent) {
            this.videoContainer.setSiblingIndex(parent.children.length - 1);
        }
        this.placeCloseButtonTopRight();
        this.showDomCloseButton();
        this.logStatus(`Popup video đã mở, đang xin token cho ${fileName}...`);

        try {
            const secureVideoUrl = await this.requestSecureVideoUrl(fileName);
            // Người dùng có thể đã đóng popup trong lúc đang chờ API.
            if (requestId !== this._loadRequestId || !this._isPlaying) return;

            this._lastVideoUrl = secureVideoUrl;
            this.logStatus(`LINK tải: ${secureVideoUrl}`);
            console.log('[RewardVideoPlayer] FULL VIDEO URL:', secureVideoUrl);

            // Probe trước: biết file có tải được không trước khi đưa vào VideoPlayer.
            const probe = await this.probeVideoDownload(secureVideoUrl);
            if (requestId !== this._loadRequestId || !this._isPlaying) return;

            if (!probe.ok) {
                throw new Error(`Probe tải FAIL HTTP ${probe.status}: ${probe.detail}`);
            }

            this.logStatus(`Tải OK ${probe.status} ${probe.contentType} ${probe.sizeText}`);

            // BẮT BUỘC false: true sẽ ép node về đúng pixel gốc video (khung nhỏ).
            this.videoPlayer.keepAspectRatio = false;
            this.videoPlayer.resourceType = VideoPlayer.ResourceType.REMOTE;
            this.videoPlayer.remoteURL = secureVideoUrl;
            this.videoPlayer.play();
            this.logStatus(`Đã gán remoteURL + play(). LINK=${this.shortenUrl(secureVideoUrl)}`);
            // Áp lại sau 1 frame vì engine có thể sync size khi tạo thẻ <video>.
            this.scheduleOnce(() => this.applyFitWidthLayout(), 0);
        } catch (error) {
            if (requestId === this._loadRequestId) {
                const message = error instanceof Error ? error.message : `${error}`;
                this.logStatus(`Lỗi load video: ${message}`);
                if (this._lastVideoUrl) {
                    console.error('[RewardVideoPlayer] URL lúc lỗi:', this._lastVideoUrl);
                }
                console.error('[RewardVideoPlayer] Không phát được video:', error);
                // Vẫn gọi callback để game không treo (level 50 notice, v.v.). Lịch sử clip chỉ lưu khi đã PLAYING.
                this.closeInternal(true);
            }
        }
    }

    /** Gửi user_app_token + tên file để Worker xác thực Tevi và cấp signed URL. */
    private async requestSecureVideoUrl(videoFile: string): Promise<string> {
        const userToken = TeviLoginManager.Instance?.getUserToken().trim() || '';
        const pageOrigin = this.getPageOrigin();
        const requestBody = { file: videoFile };

        console.log('[RewardVideoPlayer] === REQUEST /video-token (verify wiring) ===');
        console.log('[RewardVideoPlayer] POST', REWARD_VIDEO_TOKEN_URL);
        console.log('[RewardVideoPlayer] Origin', pageOrigin || '(editor/no window.origin)');
        console.log('[RewardVideoPlayer] Body', JSON.stringify(requestBody));
        console.log(
            '[RewardVideoPlayer] Authorization',
            userToken ? `Bearer ${userToken.slice(0, 12)}...(${userToken.length} chars)` : '(MISSING — Editor thường không có)',
        );

        if (!userToken) {
            console.warn(
                '[RewardVideoPlayer] DRY-RUN OK: tên file + body đúng, nhưng Editor thiếu user_app_token nên không gọi Worker thật.',
            );
            throw new Error('Chưa có user_app_token. Hãy mở game bên trong ứng dụng Tevi.');
        }

        this.logStatus(`Origin=${pageOrigin || '?'} | POST /video-token file=${videoFile}`);
        TeviLoginManager.Instance?.setDebugUserInfo(`ORIGIN = ${pageOrigin || '?'}`);

        let response: Response;
        try {
            response = await fetch(REWARD_VIDEO_TOKEN_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${userToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : `${error}`;
            // Browser gom CORS/network thành "Failed to fetch".
            throw new Error(
                `Fetch token thất bại: ${message}. Origin game=${pageOrigin || '?'}. `
                + 'Kiểm tra ALLOWED_ORIGIN trên Worker phải khớp đúng Origin này.',
            );
        }

        this.logStatus(`Worker token HTTP ${response.status}`);

        let result: RewardVideoTokenResponse = {};
        try {
            result = await response.json() as RewardVideoTokenResponse;
        } catch {
            throw new Error(`Worker HTTP ${response.status} nhưng body không phải JSON.`);
        }

        console.log('[RewardVideoPlayer] /video-token response:', result);

        if (!response.ok) {
            const parts = [
                result.error || `Worker từ chối cấp video (HTTP ${response.status}).`,
                result.hint,
                result.tried?.length ? `Đã thử: ${result.tried.join(', ')}` : '',
            ].filter(Boolean);
            throw new Error(parts.join(' — '));
        }

        const videoUrl = typeof result.videoUrl === 'string' ? result.videoUrl.trim() : '';
        if (!videoUrl) {
            throw new Error('Worker không trả về videoUrl hợp lệ.');
        }

        const parsedUrl = new URL(videoUrl);
        const tokenEndpoint = new URL(REWARD_VIDEO_TOKEN_URL);
        if (parsedUrl.protocol !== 'https:' || parsedUrl.origin !== tokenEndpoint.origin) {
            throw new Error('Worker trả về videoUrl không đúng domain được phép.');
        }

        this.logStatus(`Token OK exp=${result.expiresAt ?? '?'} key=${result.resolvedKey ?? fileName}`);
        return parsedUrl.toString();
    }

    /**
     * Thử tải vài byte đầu của video để biết link có dùng được không.
     * Range 0-1023 giúp không tải cả file.
     */
    private async probeVideoDownload(videoUrl: string): Promise<{
        ok: boolean;
        status: number;
        contentType: string;
        sizeText: string;
        detail: string;
    }> {
        this.logStatus('Probe tải Range 0-1023...');
        try {
            const response = await fetch(videoUrl, {
                method: 'GET',
                headers: {
                    Range: 'bytes=0-1023',
                },
            });

            const contentType = response.headers.get('content-type') || '?';
            const contentLength = response.headers.get('content-length') || '?';
            const contentRange = response.headers.get('content-range') || '';
            const sizeText = contentRange
                ? `range=${contentRange}`
                : `len=${contentLength}`;

            // 200 = full file, 206 = partial — cả hai đều chứng tỏ tải được.
            const ok = response.status === 200 || response.status === 206;
            let detail = ok ? 'OK' : `type=${contentType} ${sizeText}`;
            if (!ok) {
                try {
                    const errBody = await response.clone().json() as { error?: string; hint?: string };
                    if (errBody.error) detail = errBody.hint ? `${errBody.error} — ${errBody.hint}` : errBody.error;
                } catch {
                    // not JSON
                }
            }

            console.log('[RewardVideoPlayer] Probe result:', {
                url: videoUrl,
                status: response.status,
                contentType,
                contentLength,
                contentRange,
            });

            this.logStatus(
                `Probe HTTP ${response.status} | ${contentType} | ${sizeText} | LINK=${this.shortenUrl(videoUrl)}`,
            );

            return {
                ok,
                status: response.status,
                contentType,
                sizeText,
                detail,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : `${error}`;
            console.error('[RewardVideoPlayer] Probe fetch error:', error);
            return {
                ok: false,
                status: 0,
                contentType: '?',
                sizeText: 'len=?',
                detail: message,
            };
        }
    }

    private getPageOrigin(): string {
        try {
            if (typeof window !== 'undefined' && window.location?.origin) {
                return window.location.origin;
            }
        } catch {
            // ignore
        }
        return '';
    }

    private logStatus(message: string): void {
        const text = `Video: ${message}`;
        console.log('[RewardVideoPlayer]', message);
        TeviLoginManager.Instance?.setDebugStatus(text);
    }

    private shortenUrl(url: string): string {
        try {
            const parsed = new URL(url);
            const token = parsed.searchParams.get('token') || '';
            const shortToken = token
                ? `${token.slice(0, 8)}...${token.slice(-8)}`
                : 'no-token';
            return `${parsed.origin}${parsed.pathname}?token=${shortToken}`;
        } catch {
            return url.length > 64 ? `${url.slice(0, 64)}...` : url;
        }
    }

    /** Nút X đóng video sớm — có thể nối từ Inspector Click Events. */
    public btnClose(): void {
        this.closeInternal(true);
    }

    private onVideoCompleted(): void {
        if (!this._isPlaying) return;

        // Cocos/WebView đôi khi bắn COMPLETED ngay khi gán URL thất bại.
        if (!this._hasStartedPlaying) {
            this.logStatus(`COMPLETED sớm FAIL | LINK=${this.shortenUrl(this._lastVideoUrl)}`);
            console.error('[RewardVideoPlayer] COMPLETED sớm, URL:', this._lastVideoUrl);
            this.closeInternal(false);
            return;
        }

        this.logStatus(`COMPLETED OK | LINK=${this.shortenUrl(this._lastVideoUrl)}`);
        this.closeInternal(true);
    }

    private onVideoError(): void {
        this.logStatus(`VideoPlayer ERROR | LINK=${this.shortenUrl(this._lastVideoUrl)}`);
        console.error('[RewardVideoPlayer] VideoPlayer ERROR, URL:', this._lastVideoUrl);
        // Không auto-close; user bấm X. Tránh ghi đè status bằng "Đã đóng video".
    }

    private onVideoPlaying(): void {
        this._hasStartedPlaying = true;
        this.logStatus(`PLAYING OK | LINK=${this.shortenUrl(this._lastVideoUrl)}`);
        this.applyFitWidthLayout();
    }

    /** Metadata sẵn sàng: đọc tỷ lệ thật rồi scale khít bề ngang. */
    private onVideoMetaLoaded(): void {
        const aspect = this.readNativeVideoAspect();
        if (aspect > 0) {
            this._videoAspect = aspect;
        }
        this.logStatus(
            `META OK aspect=${aspect > 0 ? aspect.toFixed(3) : '?'} | LINK=${this.shortenUrl(this._lastVideoUrl)}`,
        );
        this.applyFitWidthLayout();
        // Engine có thể sync size ngay sau event → áp lại ở frame kế.
        this.scheduleOnce(() => this.applyFitWidthLayout(), 0);
    }

    private closeInternal(invokeCallback: boolean): void {
        if (this._isClosing) return;
        this._isClosing = true;
        const didWatch = this._hasStartedPlaying;
        const levelId = this._currentLevelId;
        this._isPlaying = false;
        this._hasStartedPlaying = false;
        this._currentLevelId = 0;
        this._loadRequestId++;
        this.unscheduleAllCallbacks();

        if (this.videoPlayer) {
            try {
                this.videoPlayer.stop();
            } catch {
                // Một số nền tảng có thể throw nếu chưa sẵn sàng.
            }
            this.videoPlayer.remoteURL = '';
        }

        if (this.videoContainer) {
            this.videoContainer.active = false;
        }

        this.removeDomCloseButton();
        this.resumeGameAudio();

        const callback = this._onClosedCallback;
        this._onClosedCallback = null;
        this._isClosing = false;

        // Chỉ lưu khi video đã thực sự PLAYING (xem hết hoặc bấm X giữa chừng).
        if (invokeCallback && didWatch && levelId > 0) {
            RewardVideoHistory.getInstance().markWatched(levelId);
            EventBus.getInstance().emit(GameEvent.REWARD_VIDEO_HISTORY_CHANGED, levelId);
        }

        if (invokeCallback) {
            callback?.();
        }
    }

    private pauseGameAudio(): void {
        const audio = AudioManager.getInstance();
        if (!audio) return;
        audio.pauseAllGameAudio();
        this._audioPausedByVideo = true;
    }

    private resumeGameAudio(): void {
        if (!this._audioPausedByVideo) return;
        AudioManager.getInstance()?.resumeAllGameAudio();
        this._audioPausedByVideo = false;
    }

    /**
     * Scale khung video khít 2 cạnh trái/phải theo chiều ngang màn hình.
     * Chiều cao = width / aspect để không bị méo.
     */
    private applyFitWidthLayout(): void {
        if (!this.videoPlayer || !this.videoPlayer.isValid) return;

        const designSize = view.getDesignResolutionSize();
        const screenW = designSize.width || 1080;
        const screenH = designSize.height || 1920;
        const aspect = this._videoAspect > 0 ? this._videoAspect : DEFAULT_VIDEO_ASPECT;

        let videoW = screenW;
        let videoH = videoW / aspect;
        if (videoH > screenH) {
            videoH = screenH;
            videoW = videoH * aspect;
        }

        // Giữ false để engine không ghi đè contentSize về pixel gốc.
        this.videoPlayer.keepAspectRatio = false;

        const videoTransform = this.videoPlayer.node.getComponent(UITransform);
        if (videoTransform) {
            videoTransform.setContentSize(videoW, videoH);
        }
        this.videoPlayer.node.setPosition(0, 0, 0);
        this.videoPlayer.node.setScale(1, 1, 1);

        // Ép thẻ <video> DOM theo đúng khung đã tính (web / Tevi WebView).
        this.forceDomVideoFit(videoW, videoH);

        this.placeCloseButtonTopRight(screenW, screenH);
    }

    /** Nút đóng luôn góc trên bên phải, trên cùng để bấm được. */
    private placeCloseButtonTopRight(screenW?: number, screenH?: number): void {
        if (!this._closeButton?.node?.isValid) {
            this.ensureCloseButton();
        }
        if (!this._closeButton?.node?.isValid) return;

        const designSize = view.getDesignResolutionSize();
        const w = screenW || designSize.width || 1080;
        const h = screenH || designSize.height || 1920;
        // Góc trên bên phải (anchor center của nút).
        this._closeButton.node.setPosition(w * 0.5 - 72, h * 0.5 - 96, 0);
        this._closeButton.node.active = true;

        const parent = this._closeButton.node.parent;
        if (parent) {
            this._closeButton.node.setSiblingIndex(parent.children.length - 1);
        }
    }

    /** Web/Tevi: nút X HTML góc trên phải, z-index cao hơn thẻ video. */
    private showDomCloseButton(): void {
        if (typeof document === 'undefined') return;
        this.removeDomCloseButton();

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'X';
        btn.setAttribute('aria-label', 'Đóng video');
        btn.style.cssText = [
            'position:fixed',
            'top:16px',
            'right:16px',
            'z-index:2147483647',
            'width:48px',
            'height:48px',
            'border:2px solid #fff',
            'border-radius:12px',
            'background:rgba(0,0,0,0.65)',
            'color:#fff',
            'font-size:28px',
            'font-weight:700',
            'line-height:44px',
            'padding:0',
            'cursor:pointer',
            'pointer-events:auto',
            '-webkit-tap-highlight-color:transparent',
        ].join(';');
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.btnClose();
        });
        document.body.appendChild(btn);
        this._domCloseButton = btn;
    }

    private removeDomCloseButton(): void {
        if (!this._domCloseButton) return;
        try {
            this._domCloseButton.remove();
        } catch {
            // ignore
        }
        this._domCloseButton = null;
    }

    /** Báo engine sync lại DOM theo contentSize mới (không dùng pixel gốc). */
    private forceDomVideoFit(_videoW: number, _videoH: number): void {
        if (!this.videoPlayer) return;

        const anyPlayer = this.videoPlayer as any;
        const impl = anyPlayer._impl;
        if (impl) {
            // Buộc updateMatrix lấy width/height từ UITransform đã scale.
            impl._forceUpdate = true;
            impl._keepAspectRatio = false;
            impl._w = -1;
            impl._h = -1;
        }

        const videoEl: HTMLVideoElement | null =
            impl?._video ||
            impl?.video ||
            anyPlayer.video ||
            null;

        if (videoEl && videoEl.style) {
            // fill an toàn vì contentSize đã đúng tỷ lệ video.
            videoEl.style.objectFit = 'fill';
        }
    }

    /** Đọc width/height thật từ thẻ video native (web/Tevi WebView). */
    private readNativeVideoAspect(): number {
        if (!this.videoPlayer) return 0;

        const anyPlayer = this.videoPlayer as any;
        const candidates: any[] = [
            anyPlayer._impl?._video,
            anyPlayer._impl?.video,
            anyPlayer.video,
        ];

        for (const el of candidates) {
            const w = Number(el?.videoWidth || 0);
            const h = Number(el?.videoHeight || 0);
            if (w > 0 && h > 0) {
                return w / h;
            }
        }

        if (typeof document !== 'undefined') {
            const videos = document.querySelectorAll('video');
            for (let i = 0; i < videos.length; i++) {
                const video = videos[i];
                if (video.videoWidth > 0 && video.videoHeight > 0) {
                    return video.videoWidth / video.videoHeight;
                }
            }
        }

        return 0;
    }

    private bindEvents(): void {
        if (this._eventsBound) return;
        this._eventsBound = true;

        if (this.videoPlayer) {
            this.videoPlayer.node.on(VideoPlayer.EventType.COMPLETED, this.onVideoCompleted, this);
            this.videoPlayer.node.on(VideoPlayer.EventType.META_LOADED, this.onVideoMetaLoaded, this);
            this.videoPlayer.node.on(VideoPlayer.EventType.READY_TO_PLAY, this.onVideoMetaLoaded, this);
            this.videoPlayer.node.on(VideoPlayer.EventType.PLAYING, this.onVideoPlaying, this);
            this.videoPlayer.node.on(VideoPlayer.EventType.ERROR, this.onVideoError, this);
        }
        if (this._closeButton) {
            this._closeButton.node.on(Button.EventType.CLICK, this.btnClose, this);
        }
    }

    private unbindEvents(): void {
        if (!this._eventsBound) return;
        this._eventsBound = false;

        if (this.videoPlayer && this.videoPlayer.node?.isValid) {
            this.videoPlayer.node.off(VideoPlayer.EventType.COMPLETED, this.onVideoCompleted, this);
            this.videoPlayer.node.off(VideoPlayer.EventType.META_LOADED, this.onVideoMetaLoaded, this);
            this.videoPlayer.node.off(VideoPlayer.EventType.READY_TO_PLAY, this.onVideoMetaLoaded, this);
            this.videoPlayer.node.off(VideoPlayer.EventType.PLAYING, this.onVideoPlaying, this);
            this.videoPlayer.node.off(VideoPlayer.EventType.ERROR, this.onVideoError, this);
        }
        if (this._closeButton && this._closeButton.node?.isValid) {
            this._closeButton.node.off(Button.EventType.CLICK, this.btnClose, this);
        }
    }

    /** Tạo UI tối thiểu nếu chưa gán trong Inspector. */
    private ensureUi(): void {
        if (this.videoPlayer && this.videoContainer) {
            this.ensureCloseButton();
            return;
        }

        const parent = this.node;
        const designSize = view.getDesignResolutionSize();
        const width = designSize.width || 1080;
        const height = designSize.height || 1920;

        const container = new Node('RewardVideoContainer');
        container.layer = Layers.Enum.UI_2D;
        container.setParent(parent);
        container.setPosition(0, 0, 0);

        const containerTransform = container.addComponent(UITransform);
        containerTransform.setContentSize(width, height);
        const containerWidget = container.addComponent(Widget);
        containerWidget.isAlignTop = true;
        containerWidget.isAlignBottom = true;
        containerWidget.isAlignLeft = true;
        containerWidget.isAlignRight = true;
        containerWidget.top = 0;
        containerWidget.bottom = 0;
        containerWidget.left = 0;
        containerWidget.right = 0;
        containerWidget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
        container.addComponent(BlockInputEvents);

        const overlay = new Node('Overlay');
        overlay.layer = Layers.Enum.UI_2D;
        overlay.setParent(container);
        const overlayTransform = overlay.addComponent(UITransform);
        overlayTransform.setContentSize(width, height);
        const overlayWidget = overlay.addComponent(Widget);
        overlayWidget.isAlignTop = true;
        overlayWidget.isAlignBottom = true;
        overlayWidget.isAlignLeft = true;
        overlayWidget.isAlignRight = true;
        overlayWidget.top = 0;
        overlayWidget.bottom = 0;
        overlayWidget.left = 0;
        overlayWidget.right = 0;
        overlayWidget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
        const graphics = overlay.addComponent(Graphics);
        graphics.fillColor = new Color(0, 0, 0, 230);
        graphics.rect(-width * 0.5, -height * 0.5, width, height);
        graphics.fill();

        const videoNode = new Node('RewardVideo');
        videoNode.layer = Layers.Enum.UI_2D;
        videoNode.setParent(container);
        const videoTransform = videoNode.addComponent(UITransform);
        videoTransform.setContentSize(width, width / DEFAULT_VIDEO_ASPECT);
        const videoPlayer = videoNode.addComponent(VideoPlayer);
        videoPlayer.resourceType = VideoPlayer.ResourceType.REMOTE;
        // false: tự scale theo màn hình, không dùng pixel gốc của file.
        videoPlayer.keepAspectRatio = false;
        videoPlayer.playOnAwake = false;

        container.active = false;
        this.videoContainer = container;
        this.videoPlayer = videoPlayer;
        this.ensureCloseButton();
    }

    /** Luôn có nút X góc trên phải để đóng video. */
    private ensureCloseButton(): void {
        if (!this.videoContainer) return;

        if (this._closeButton?.node?.isValid) {
            return;
        }

        const existing = this.videoContainer.getChildByName('BtnClose')
            || this.videoContainer.getComponentInChildren(Button)?.node
            || null;
        if (existing?.isValid) {
            this._closeButton = existing.getComponent(Button);
            if (this._eventsBound && this._closeButton) {
                this._closeButton.node.off(Button.EventType.CLICK, this.btnClose, this);
                this._closeButton.node.on(Button.EventType.CLICK, this.btnClose, this);
            }
            return;
        }

        const designSize = view.getDesignResolutionSize();
        const width = designSize.width || 1080;
        const height = designSize.height || 1920;

        const closeNode = new Node('BtnClose');
        closeNode.layer = Layers.Enum.UI_2D;
        closeNode.setParent(this.videoContainer);
        const closeTransform = closeNode.addComponent(UITransform);
        closeTransform.setContentSize(96, 96);
        closeNode.setPosition(width * 0.5 - 72, height * 0.5 - 96, 0);

        const bg = closeNode.addComponent(Graphics);
        bg.fillColor = new Color(0, 0, 0, 160);
        bg.roundRect(-48, -48, 96, 96, 16);
        bg.fill();
        bg.strokeColor = new Color(255, 255, 255, 220);
        bg.lineWidth = 3;
        bg.roundRect(-48, -48, 96, 96, 16);
        bg.stroke();

        const closeButton = closeNode.addComponent(Button);
        closeButton.transition = Button.Transition.SCALE;
        closeButton.zoomScale = 0.92;

        const closeLabelNode = new Node('Label');
        closeLabelNode.layer = Layers.Enum.UI_2D;
        closeLabelNode.setParent(closeNode);
        const closeLabelTransform = closeLabelNode.addComponent(UITransform);
        closeLabelTransform.setContentSize(96, 96);
        const closeLabel = closeLabelNode.addComponent(Label);
        closeLabel.string = 'X';
        closeLabel.fontSize = 52;
        closeLabel.lineHeight = 60;
        closeLabel.color = Color.WHITE;
        closeLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        closeLabel.verticalAlign = Label.VerticalAlign.CENTER;
        closeLabel.isBold = true;

        this._closeButton = closeButton;
        if (this._eventsBound) {
            this._closeButton.node.on(Button.EventType.CLICK, this.btnClose, this);
        }
    }
}
