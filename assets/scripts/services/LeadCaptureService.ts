import { GAME_NAME } from '../core/GameBrandConfig';

export type Gender = 'male' | 'female' | 'secret';
export type ContactChannel = 'zalo' | 'email';

export interface LeadCaptureData {
    full_name: string;
    phone: string;
    gender: Gender;
    contact_channel: ContactChannel;
    email: string;
    birth_year: number;
    province: string;
}

interface SubmitPayload extends LeadCaptureData {
    secret_key: string;
    game_name: string;
    session_id: string;
}

interface SubmitResponse {
    status: 'success' | 'error';
    code?: string;
    message?: string;
}

interface LeadInfoFormOptions {
    initialInfo?: LeadCaptureData | null;
    onSave: (info: LeadCaptureData) => void;
}

interface LeadSubmitFormOptions extends LeadInfoFormOptions {
    getSessionId: () => string;
}

type LeadFormMode = 'collect' | 'submit';

const API_ENDPOINT = 'https://script.google.com/macros/s/AKfycbx7gaC7d-UrZIVF8zZ8Vxe-ToFhiGQX5vd5Z_7fgpL9ESaW3LhrcED986lYWJN-rSr3Ug/exec';
const SECRET_KEY = 'GTB@2026';
const API_CONTENT_TYPE = 'text/plain;charset=UTF-8';
const REQUEST_TIMEOUT_MS = 10000;
const MAX_RETRIES = 2;

const PROVINCES = [
    'An Giang',
    'Bắc Ninh',
    'Cà Mau',
    'Cao Bằng',
    'Cần Thơ',
    'Đà Nẵng',
    'Đắk Lắk',
    'Điện Biên',
    'Đồng Nai',
    'Đồng Tháp',
    'Gia Lai',
    'Hà Nội',
    'Hà Tĩnh',
    'Hải Phòng',
    'Hồ Chí Minh',
    'Huế',
    'Hưng Yên',
    'Khánh Hòa',
    'Lai Châu',
    'Lâm Đồng',
    'Lạng Sơn',
    'Lào Cai',
    'Nghệ An',
    'Ninh Bình',
    'Phú Thọ',
    'Quảng Ngãi',
    'Quảng Ninh',
    'Quảng Trị',
    'Sơn La',
    'Tây Ninh',
    'Thái Nguyên',
    'Thanh Hóa',
    'Tuyên Quang',
    'Vĩnh Long',
];

const ERROR_MESSAGES: Record<string, string> = {
    UNAUTHORIZED: 'Không thể xác thực yêu cầu. Vui lòng thử lại sau.',
    MISSING_FIELD: 'Vui lòng nhập đầy đủ thông tin bắt buộc.',
    MISSING_EMAIL: 'Vui lòng nhập email để nhận tin nhắn qua Email.',
    INVALID_PHONE: 'Số điện thoại chưa đúng định dạng Việt Nam.',
    INVALID_GENDER: 'Vui lòng chọn giới tính hợp lệ.',
    INVALID_CHANNEL: 'Vui lòng chọn kênh nhận tin hợp lệ.',
    DUPLICATE_SESSION: 'Lượt chơi này đã được ghi nhận. Vui lòng chơi lại để tạo lượt chơi mới.',
    SERVER_ERROR: 'Hệ thống đang bận, vui lòng thử lại.',
};

const LEAD_CAPTURE_LOG_PREFIX = '[LeadCapture]';

export class LeadCaptureService {
    private static _instance: LeadCaptureService | null = null;
    private _activeRoot: HTMLDivElement | null = null;
    private _stylesInjected = false;
    private _disabledGamePointerTargets: Array<{ element: HTMLElement; pointerEvents: string }> = [];

    public static getInstance(): LeadCaptureService {
        if (!LeadCaptureService._instance) {
            LeadCaptureService._instance = new LeadCaptureService();
        }
        return LeadCaptureService._instance;
    }

    public isSupported(): boolean {
        return typeof document !== 'undefined' && typeof window !== 'undefined' && typeof fetch !== 'undefined';
    }

    public showInitialInfoForm(options: LeadInfoFormOptions): Promise<boolean> {
        return this.showForm('collect', options);
    }

    public showCompletionForm(options: LeadSubmitFormOptions): Promise<boolean> {
        return this.showForm('submit', options);
    }

    private showForm(mode: LeadFormMode, options: LeadInfoFormOptions | LeadSubmitFormOptions): Promise<boolean> {
        if (!this.isSupported()) {
            return Promise.resolve(false);
        }

        this.destroyActiveRoot();
        this.injectStyles();

        return new Promise(resolve => {
            const root = document.createElement('div');
            root.className = 'sg-lead-overlay';
            root.innerHTML = this.renderForm(mode);
            this.bindOverlayInputGuards(root);
            this.disableGamePointerEvents();
            document.body.appendChild(root);
            this._activeRoot = root;

            const form = root.querySelector<HTMLFormElement>('[data-lead-form]');
            const submitButton = root.querySelector<HTMLButtonElement>('[data-submit]');
            const statusNode = root.querySelector<HTMLDivElement>('[data-status]');
            const emailWrap = root.querySelector<HTMLDivElement>('[data-email-wrap]');
            const emailInput = root.querySelector<HTMLInputElement>('[name="email"]');
            const channelInputs = Array.from(root.querySelectorAll<HTMLInputElement>('[name="contact_channel"]'));
            const continueButton = root.querySelector<HTMLButtonElement>('[data-continue]');

            if (form && options.initialInfo) {
                this.fillForm(form, options.initialInfo);
            }

            const updateEmailVisibility = () => {
                const selectedChannel = this.getCheckedValue<ContactChannel>(form, 'contact_channel');
                const needsEmail = selectedChannel === 'email';
                if (emailWrap) emailWrap.style.display = needsEmail ? 'block' : 'none';
                if (emailInput) emailInput.required = needsEmail;
            };

            channelInputs.forEach(input => input.addEventListener('change', updateEmailVisibility));
            updateEmailVisibility();

            continueButton?.addEventListener('click', () => {
                this.destroyActiveRoot();
                resolve(true);
            });

            form?.addEventListener('submit', async event => {
                event.preventDefault();
                if (!form || !submitButton || !statusNode) return;

                const validation = this.buildLeadInfo(form);
                if (!validation.info) {
                    this.showStatus(statusNode, validation.error || 'Vui lòng kiểm tra lại thông tin.', true);
                    return;
                }

                options.onSave(validation.info);

                if (mode === 'collect') {
                    console.log(`${LEAD_CAPTURE_LOG_PREFIX} Saved lead info locally:`, validation.info);
                    this.destroyActiveRoot();
                    resolve(true);
                    return;
                }

                const submitOptions = options as LeadSubmitFormOptions;
                const payload = this.buildSubmitPayload(validation.info, submitOptions.getSessionId());
                console.log(`${LEAD_CAPTURE_LOG_PREFIX} Submit payload:`, this.toLogPayload(payload));
                submitButton.disabled = true;
                submitButton.textContent = 'Đang gửi...';
                this.showStatus(statusNode, 'Đang gửi thông tin...', false);

                const result = await this.submitWithRetry(payload);
                if (result.status === 'success') {
                    console.log(`${LEAD_CAPTURE_LOG_PREFIX} Submit success. session_id:`, payload.session_id);
                    this.showThankYou(root);
                    return;
                }

                if (result.code === 'DUPLICATE_SESSION') {
                    console.warn(`${LEAD_CAPTURE_LOG_PREFIX} Duplicate session:`, payload.session_id);
                }

                submitButton.disabled = false;
                submitButton.textContent = 'Xác nhận / Submit';
                this.showStatus(statusNode, this.getErrorMessage(result), true);
            });
        });
    }

    private renderForm(mode: LeadFormMode): string {
        const provinceOptions = PROVINCES.map(province => `<option value="${province}"></option>`).join('');
        const isSubmitMode = mode === 'submit';
        const title = isSubmitMode
            ? 'CHÚC MỪNG BẠN ĐÃ THU THẬP ĐỦ CÁC VẬT PHẨM!'
            : 'THÔNG TIN NHẬN QUÀ';
        const intro = isSubmitMode
            ? 'SGFood x Guess the Brands xin gửi tặng bạn Voucher giảm tối đa 100K vì đã trở thành 1 trong những người chơi hoàn thành xuất sắc trò chơi.<br>Xin vui lòng để lại thông tin để nhận quà:'
            : 'Vui lòng để lại thông tin trước khi bắt đầu. Thông tin sẽ được lưu trên thiết bị này và chưa gửi lên hệ thống.';
        const buttonText = isSubmitMode ? 'Xác nhận / Submit' : 'Lưu thông tin';

        return `
            <div class="sg-lead-card" data-card>
                <form data-lead-form>
                    <div class="sg-lead-heading">
                        <h2>${title}</h2>
                        <p class="sg-lead-intro">${intro}</p>
                    </div>
                    <div class="sg-lead-grid">
                        <label>
                            <span>Họ tên *</span>
                            <input name="full_name" type="text" autocomplete="name" />
                        </label>
                        <label>
                            <span>SĐT *</span>
                            <input name="phone" type="tel" inputmode="tel" autocomplete="tel" />
                        </label>
                    </div>

                    <fieldset>
                        <legend>Giới tính *</legend>
                        <label><input type="radio" name="gender" value="male" /> Nam</label>
                        <label><input type="radio" name="gender" value="female" /> Nữ</label>
                        <label><input type="radio" name="gender" value="secret" /> Bí mật</label>
                    </fieldset>

                    <fieldset>
                        <legend>Bạn muốn nhận tin nhắn qua *</legend>
                        <label><input type="radio" name="contact_channel" value="zalo" /> Zalo</label>
                        <label><input type="radio" name="contact_channel" value="email" /> Email</label>
                    </fieldset>

                    <label data-email-wrap class="sg-lead-hidden">
                        <span>Email *</span>
                        <input name="email" type="email" autocomplete="email" />
                    </label>

                    <div class="sg-lead-grid">
                        <label>
                            <span>Năm sinh *</span>
                            <input name="birth_year" type="number" inputmode="numeric" min="1900" max="2026" />
                        </label>
                        <label>
                            <span>Bạn đang ở tại *</span>
                            <input name="province" type="text" list="sg-provinces" autocomplete="address-level1" />
                            <datalist id="sg-provinces">${provinceOptions}</datalist>
                        </label>
                    </div>

                    <div data-status class="sg-lead-status"></div>
                    <button type="submit" data-submit>${buttonText}</button>
                </form>
                <div class="sg-lead-thanks" data-thanks>
                    <h2>Cảm ơn bạn!</h2>
                    <p>Thông tin đã được ghi nhận. Chúc mừng bạn đã hoàn thành lượt chơi.</p>
                    <button type="button" data-continue>Nhận quà</button>
                </div>
            </div>
        `;
    }

    private fillForm(form: HTMLFormElement, info: LeadCaptureData): void {
        this.setInputValue(form, 'full_name', info.full_name);
        this.setInputValue(form, 'phone', info.phone);
        this.setInputValue(form, 'email', info.email);
        this.setInputValue(form, 'birth_year', `${info.birth_year}`);
        this.setInputValue(form, 'province', info.province);
        this.setCheckedValue(form, 'gender', info.gender);
        this.setCheckedValue(form, 'contact_channel', info.contact_channel);
    }

    private buildLeadInfo(form: HTMLFormElement): { info?: LeadCaptureData; error?: string } {
        const fullName = this.getInputValue(form, 'full_name');
        const phone = this.normalizePhone(this.getInputValue(form, 'phone'));
        const gender = this.getCheckedValue<Gender>(form, 'gender');
        const contactChannel = this.getCheckedValue<ContactChannel>(form, 'contact_channel');
        const email = this.getInputValue(form, 'email');
        const birthYearRaw = this.getInputValue(form, 'birth_year');
        const birthYear = Number(birthYearRaw);
        const province = this.getInputValue(form, 'province');

        if (!fullName || !phone || !gender || !contactChannel || !birthYearRaw || !province) {
            return { error: 'Vui lòng nhập đầy đủ thông tin bắt buộc.' };
        }
        if (!this.isValidVietnamPhone(phone)) {
            return { error: 'Số điện thoại chưa đúng định dạng Việt Nam.' };
        }
        if (contactChannel === 'email' && !this.isValidEmail(email)) {
            return { error: 'Vui lòng nhập email hợp lệ.' };
        }
        if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > new Date().getFullYear()) {
            return { error: 'Năm sinh chưa hợp lệ.' };
        }

        return {
            info: {
                full_name: fullName,
                phone,
                gender,
                contact_channel: contactChannel,
                email: contactChannel === 'email' ? email : '',
                birth_year: birthYear,
                province,
            },
        };
    }

    private buildSubmitPayload(info: LeadCaptureData, sessionId: string): SubmitPayload {
        return {
            secret_key: SECRET_KEY,
            game_name: GAME_NAME,
            ...info,
            session_id: sessionId,
        };
    }

    private async submitWithRetry(payload: SubmitPayload): Promise<SubmitResponse> {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                console.log(`${LEAD_CAPTURE_LOG_PREFIX} API attempt ${attempt + 1}/${MAX_RETRIES + 1}. session_id:`, payload.session_id);
                const result = await this.submitOnce(payload);
                console.log(`${LEAD_CAPTURE_LOG_PREFIX} API response:`, result);
                return result;
            } catch (error) {
                console.warn(`${LEAD_CAPTURE_LOG_PREFIX} API attempt failed ${attempt + 1}/${MAX_RETRIES + 1}. session_id:`, payload.session_id, error);
                if (attempt === MAX_RETRIES) {
                    return { status: 'error', message: 'Có lỗi kết nối, vui lòng thử lại' };
                }
            }
        }
        return { status: 'error', message: 'Có lỗi kết nối, vui lòng thử lại' };
    }

    private async submitOnce(payload: SubmitPayload): Promise<SubmitResponse> {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutId = controller ? window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : 0;

        try {
            const response = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': API_CONTENT_TYPE },
                body: JSON.stringify(payload),
                signal: controller?.signal,
            });
            console.log(`${LEAD_CAPTURE_LOG_PREFIX} HTTP status:`, response.status, response.statusText);
            const body = await response.json() as SubmitResponse;
            if (body && body.status) return body;
            return { status: 'error', message: 'Phản hồi không hợp lệ, vui lòng thử lại.' };
        } finally {
            if (timeoutId) window.clearTimeout(timeoutId);
        }
    }

    private showThankYou(root: HTMLDivElement): void {
        const form = root.querySelector<HTMLElement>('[data-lead-form]');
        const thanks = root.querySelector<HTMLElement>('[data-thanks]');
        if (form) form.style.display = 'none';
        if (thanks) thanks.style.display = 'grid';
    }

    private bindOverlayInputGuards(root: HTMLDivElement): void {
        const stopEvent = (event: Event) => {
            event.stopPropagation();
        };
        const guardedEvents = [
            'pointerdown',
            'pointermove',
            'pointerup',
            'mousedown',
            'mousemove',
            'mouseup',
            'touchstart',
            'touchmove',
            'touchend',
            'click',
            'dblclick',
            'wheel',
            'keydown',
            'keyup',
            'input',
            'change',
        ];

        guardedEvents.forEach(eventName => {
            root.addEventListener(eventName, stopEvent, false);
        });
    }

    private showStatus(node: HTMLDivElement, message: string, isError: boolean): void {
        node.textContent = message;
        node.classList.toggle('is-error', isError);
    }

    private getErrorMessage(result: SubmitResponse): string {
        if (result.code && ERROR_MESSAGES[result.code]) {
            return ERROR_MESSAGES[result.code];
        }
        return result.message || 'Có lỗi kết nối, vui lòng thử lại';
    }

    private toLogPayload(payload: SubmitPayload): SubmitPayload {
        return {
            ...payload,
            secret_key: '***',
        };
    }

    private getInputValue(form: HTMLFormElement, name: string): string {
        const input = form.querySelector<HTMLInputElement>(`[name="${name}"]`);
        return input?.value.trim() || '';
    }

    private setInputValue(form: HTMLFormElement, name: string, value: string): void {
        const input = form.querySelector<HTMLInputElement>(`[name="${name}"]`);
        if (input) input.value = value;
    }

    private getCheckedValue<T extends string>(form: HTMLFormElement | null, name: string): T | '' {
        const input = form?.querySelector<HTMLInputElement>(`[name="${name}"]:checked`);
        return (input?.value || '') as T | '';
    }

    private setCheckedValue(form: HTMLFormElement, name: string, value: string): void {
        const input = form.querySelector<HTMLInputElement>(`[name="${name}"][value="${value}"]`);
        if (input) input.checked = true;
    }

    private normalizePhone(value: string): string {
        const compact = value.replace(/[\s.-]/g, '');
        if (compact.startsWith('+84')) {
            return `0${compact.substring(3)}`;
        }
        if (compact.startsWith('84')) {
            return `0${compact.substring(2)}`;
        }
        return compact;
    }

    private isValidVietnamPhone(value: string): boolean {
        return /^(03|05|07|08|09)\d{8}$/.test(value);
    }

    private isValidEmail(value: string): boolean {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }

    private destroyActiveRoot(): void {
        if (this._activeRoot && this._activeRoot.parentElement) {
            this._activeRoot.parentElement.removeChild(this._activeRoot);
        }
        this._activeRoot = null;
        this.restoreGamePointerEvents();
    }

    private disableGamePointerEvents(): void {
        this.restoreGamePointerEvents();
        const selectors = [
            'canvas',
            '#GameCanvas',
            '#Cocos3dGameContainer',
            '#GameDiv',
            '.game-canvas',
        ];
        const targets = new Set<HTMLElement>();

        selectors.forEach(selector => {
            document.querySelectorAll<HTMLElement>(selector).forEach(element => {
                if (!element.classList.contains('sg-lead-overlay')) {
                    targets.add(element);
                }
            });
        });

        targets.forEach(element => {
            this._disabledGamePointerTargets.push({
                element,
                pointerEvents: element.style.pointerEvents,
            });
            element.style.pointerEvents = 'none';
        });

        console.log(`${LEAD_CAPTURE_LOG_PREFIX} Disabled game pointer targets:`, this._disabledGamePointerTargets.length);
    }

    private restoreGamePointerEvents(): void {
        if (this._disabledGamePointerTargets.length === 0) return;

        this._disabledGamePointerTargets.forEach(({ element, pointerEvents }) => {
            if (element && element.isConnected) {
                element.style.pointerEvents = pointerEvents;
            }
        });
        this._disabledGamePointerTargets = [];
    }

    private injectStyles(): void {
        if (this._stylesInjected || !document.head) return;
        const style = document.createElement('style');
        style.textContent = `
            .sg-lead-overlay {
                position: fixed;
                inset: 0;
                z-index: 2147483647;
                display: grid;
                place-items: center;
                box-sizing: border-box;
                width: 100vw;
                height: 100vh;
                height: 100dvh;
                overflow: hidden;
                padding: 8px;
                background: rgba(13, 26, 30, 0.72);
                font-family: Arial, Helvetica, sans-serif;
                color: #21312f;
                pointer-events: auto;
                touch-action: auto;
            }
            .sg-lead-card {
                box-sizing: border-box;
                width: min(90vw, 500px);
                max-height: calc(100vh - 16px);
                max-height: calc(100dvh - 16px);
                overflow-y: auto;
                overscroll-behavior: contain;
                -webkit-overflow-scrolling: touch;
                border-radius: 8px;
                background: #fffaf0;
                box-shadow: 0 18px 60px rgba(0, 0, 0, 0.28);
                padding: 12px;
                pointer-events: auto;
                touch-action: auto;
            }
            .sg-lead-card h2 {
                margin: 0 0 6px;
                font-size: 18px;
                line-height: 1.15;
                color: #0f5d4f;
                letter-spacing: 0;
            }
            .sg-lead-intro {
                margin: 0 0 7px;
                font-size: 12px;
                line-height: 1.28;
                color: #314541;
            }
            .sg-lead-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
            }
            .sg-lead-card label,
            .sg-lead-card fieldset {
                display: block;
                margin: 0 0 6px;
            }
            .sg-lead-card span,
            .sg-lead-card legend {
                display: block;
                margin-bottom: 3px;
                font-size: 12px;
                font-weight: 700;
            }
            .sg-lead-card fieldset {
                border: 1px solid #d9ddcf;
                border-radius: 8px;
                padding: 6px 8px 3px;
            }
            .sg-lead-card fieldset label {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                margin: 0 12px 3px 0;
                font-size: 13px;
                pointer-events: auto;
                touch-action: manipulation;
            }
            .sg-lead-card input[type="radio"] {
                pointer-events: auto;
                touch-action: manipulation;
            }
            .sg-lead-card input[type="text"],
            .sg-lead-card input[type="tel"],
            .sg-lead-card input[type="email"],
            .sg-lead-card input[type="number"] {
                box-sizing: border-box;
                width: 100%;
                min-height: 32px;
                border: 1px solid #cbd3c6;
                border-radius: 8px;
                padding: 6px 9px;
                font-size: 14px;
                background: #ffffff;
                color: #182421;
                pointer-events: auto;
                touch-action: manipulation;
            }
            .sg-lead-card button {
                width: 100%;
                min-height: 36px;
                border: 0;
                border-radius: 8px;
                background: #e14535;
                color: #ffffff;
                font-size: 15px;
                font-weight: 700;
                cursor: pointer;
                pointer-events: auto;
                touch-action: manipulation;
            }
            .sg-lead-card button:disabled {
                cursor: wait;
                opacity: 0.65;
            }
            .sg-lead-status {
                min-height: 17px;
                margin: 1px 0 6px;
                color: #1b6b58;
                font-size: 12px;
            }
            .sg-lead-status.is-error {
                color: #bd2b23;
            }
            .sg-lead-hidden {
                display: none;
            }
            .sg-lead-thanks {
                display: none;
                gap: 8px;
                text-align: center;
            }
            .sg-lead-thanks p {
                margin: 0 0 10px;
                font-size: 14px;
                line-height: 1.35;
            }
            @media (max-width: 560px) {
                .sg-lead-card {
                    width: 100%;
                    padding: 10px;
                }
                .sg-lead-card h2 {
                    font-size: 15px;
                    margin-bottom: 5px;
                }
                .sg-lead-intro {
                    font-size: 11px;
                    line-height: 1.2;
                    margin-bottom: 5px;
                }
                .sg-lead-grid {
                    grid-template-columns: 1fr 1fr;
                    gap: 6px;
                }
                .sg-lead-card label,
                .sg-lead-card fieldset {
                    margin-bottom: 5px;
                }
                .sg-lead-card span,
                .sg-lead-card legend {
                    font-size: 11px;
                }
                .sg-lead-card fieldset label {
                    margin-right: 8px;
                    font-size: 12px;
                }
                .sg-lead-card input[type="text"],
                .sg-lead-card input[type="tel"],
                .sg-lead-card input[type="email"],
                .sg-lead-card input[type="number"] {
                    min-height: 30px;
                    font-size: 13px;
                    padding: 5px 7px;
                }
                .sg-lead-card button {
                    min-height: 34px;
                    font-size: 14px;
                }
            }
        `;
        document.head.appendChild(style);
        this._stylesInjected = true;
    }
}
