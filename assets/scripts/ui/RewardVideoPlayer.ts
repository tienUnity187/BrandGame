import {
    _decorator,
    BlockInputEvents,
    Button,
    Color,
    Component,
    Graphics,
    Label,
    Layers,
    Node,
    UITransform,
    VideoPlayer,
    Widget,
    view,
} from 'cc';
import { AudioManager } from '../managers/AudioManager';
import { REWARD_VIDEO_TOKEN_URL } from '../TeviConstants';
import { TeviLoginManager } from '../TeviLoginManager';

const { ccclass, property } = _decorator;

/** Tỷ lệ mặc định khi chưa đọc được metadata (landscape 16:9). */
const DEFAULT_VIDEO_ASPECT = 16 / 9;

interface RewardVideoTokenResponse {
    videoUrl?: string;
    expiresAt?: number;
    error?: string;
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
     * @param onClosedCallback Gọi đúng một lần khi đóng (xem hết hoặc bấm X).
     */
    public playSecretVideo(onClosedCallback?: () => void): void {
        void this.loadAndPlaySecretVideo(onClosedCallback);
    }

    /** Xin URL tạm từ Worker rồi mới phát, không giữ URL R2 trong game. */
    private async loadAndPlaySecretVideo(onClosedCallback?: () => void): Promise<void> {
        this.ensureUi();
        if (!this.videoPlayer || !this.videoContainer) {
            this.logStatus('Lỗi: thiếu VideoPlayer/container.');
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
        const requestId = ++this._loadRequestId;

        this.pauseGameAudio();
        this.applyFitWidthLayout();

        this.videoContainer.active = true;
        const parent = this.videoContainer.parent;
        if (parent) {
            this.videoContainer.setSiblingIndex(parent.children.length - 1);
        }
        this.logStatus('Popup video đã mở, đang xin token...');

        try {
            const secureVideoUrl = await this.requestSecureVideoUrl();
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
                // Không gọi onClosedCallback để status lỗi không bị ghi đè thành "Đã đóng video".
                this.closeInternal(false);
            }
        }
    }

    /** Gửi user_app_token để Worker xác thực Tevi và cấp signed URL. */
    private async requestSecureVideoUrl(): Promise<string> {
        const userToken = TeviLoginManager.Instance?.getUserToken().trim() || '';
        if (!userToken) {
            throw new Error('Chưa có user_app_token. Hãy mở game bên trong ứng dụng Tevi.');
        }

        const pageOrigin = this.getPageOrigin();
        this.logStatus(`Origin=${pageOrigin || '?'} | POST /video-token`);
        TeviLoginManager.Instance?.setDebugUserInfo(`ORIGIN = ${pageOrigin || '?'}`);

        let response: Response;
        try {
            response = await fetch(REWARD_VIDEO_TOKEN_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${userToken}`,
                    'Content-Type': 'application/json',
                },
                body: '{}',
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
            throw new Error(result.error || `Worker từ chối cấp video (HTTP ${response.status}).`);
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

        this.logStatus(`Token OK exp=${result.expiresAt ?? '?'} | ${this.shortenUrl(parsedUrl.toString())}`);
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
            const detail = ok
                ? 'OK'
                : `type=${contentType} ${sizeText}`;

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
        this._isPlaying = false;
        this._hasStartedPlaying = false;
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

        this.resumeGameAudio();

        const callback = this._onClosedCallback;
        this._onClosedCallback = null;
        this._isClosing = false;

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

        if (this._closeButton) {
            this._closeButton.node.setPosition(screenW * 0.5 - 72, screenH * 0.5 - 96, 0);
        }
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
            if (!this._closeButton) {
                this._closeButton = this.videoContainer.getComponentInChildren(Button);
            }
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

        const closeNode = new Node('BtnClose');
        closeNode.layer = Layers.Enum.UI_2D;
        closeNode.setParent(container);
        const closeTransform = closeNode.addComponent(UITransform);
        closeTransform.setContentSize(96, 96);
        closeNode.setPosition(width * 0.5 - 72, height * 0.5 - 96, 0);
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
        closeLabel.fontSize = 56;
        closeLabel.lineHeight = 64;
        closeLabel.color = Color.WHITE;
        closeLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        closeLabel.verticalAlign = Label.VerticalAlign.CENTER;

        container.active = false;
        this.videoContainer = container;
        this.videoPlayer = videoPlayer;
        this._closeButton = closeButton;
    }
}
