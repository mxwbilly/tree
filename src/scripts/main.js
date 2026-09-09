document.addEventListener('DOMContentLoaded', async function () {
    const header = document.getElementById('header');
    const mobileToggle = document.getElementById('mobileToggle');
    const mobileMenu = document.getElementById('mobileMenu');
    const contactForm = document.getElementById('contactForm');
    const productMultiSelect = contactForm?.querySelector('[data-multi-select]') || null;
    const backToTop = document.getElementById('backToTop');
    const langButtons = document.querySelectorAll('.lang-btn');
    const metaDescription = document.querySelector('meta[name="description"]');
    const metaKeywords = document.querySelector('meta[name="keywords"]');
    const siteConfig = window.GREENSMART_CONFIG || {};
    const detailPageFiles = new Set([
        'self-watering-double-layer.html',
        'root-control-gallon-pot.html',
        'transparent-orchid-pot.html',
        'creative-shaped-planter.html'
    ]);
    const abParam = new URLSearchParams(window.location.search).get('ab');
    const heroTitleVariant = (abParam === 'hero-b' || abParam === 'b') ? 'hero_b' : 'hero_a';
    const heroTitleVariants = {
        hero_a: {
            en: 'Wholesale Flower Pots & Self-Watering Planters from China',
            vi: 'Chau hoa si va chau tuoi nuoc tu dong tu Trung Quoc',
            th: 'ขายส่งกระถางต้นไม้และกระถางรดน้ำอัตโนมัติจากจีน',
            id: 'Pot bunga grosir dan planter self-watering dari China',
        },
        hero_b: {
            en: 'Reliable OEM Flower Pots with Fast Export Delivery',
            vi: 'Nha cung cap chau hoa OEM dang tin cay, giao hang xuat khau nhanh',
            th: 'ซัพพลายเออร์กระถาง OEM ที่เชื่อถือได้ พร้อมส่งออกรวดเร็ว',
            id: 'Pemasok pot bunga OEM andal dengan pengiriman ekspor cepat',
        }
    };

    function initGa4(measurementId) {
        if (!measurementId) {
            return;
        }

        window.dataLayer = window.dataLayer || [];
        window.gtag = window.gtag || function () {
            window.dataLayer.push(arguments);
        };

        if (!document.querySelector('script[data-greensmart-ga4]')) {
            const gaScript = document.createElement('script');
            gaScript.async = true;
            gaScript.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
            gaScript.setAttribute('data-greensmart-ga4', '1');
            document.head.appendChild(gaScript);
        }

        if (!window.__greensmartGaConfigured) {
            window.gtag('js', new Date());
            window.gtag('config', measurementId, { send_page_view: true });
            window.__greensmartGaConfigured = true;
        }
    }

    function trackEvent(eventName, params = {}) {
        if (typeof window.gtag === 'function') {
            window.gtag('event', eventName, params);
        }
        if (Array.isArray(window.dataLayer)) {
            window.dataLayer.push({ event: eventName, ...params });
        }
    }

    function getTrackingLabel(element, fallback = 'unknown') {
        const text = element.textContent ? element.textContent.trim() : '';
        return text || fallback;
    }

    function getTrackingSection(element) {
        const section = element.closest('section');
        return section?.id || 'unknown_section';
    }

    function withTrackingMeta(params = {}) {
        return {
            ab_variant: heroTitleVariant,
            ...params
        };
    }

    function applyHeroTitleVariant(lang) {
        const heroTitleNode = document.querySelector('[data-i18n="hero_title"]');
        if (!heroTitleNode) {
            return;
        }

        const variantBundle = heroTitleVariants[heroTitleVariant] || heroTitleVariants.hero_a;
        heroTitleNode.textContent = variantBundle[lang] || variantBundle.en || heroTitleNode.textContent;
    }

    function updateDetailPageLinks(lang) {
        document.querySelectorAll('a[href]').forEach((anchor) => {
            const href = anchor.getAttribute('href');
            if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:')) {
                return;
            }

            const [pathWithQuery, hashPart] = href.split('#');
            const [basePath] = pathWithQuery.split('?');
            if (!detailPageFiles.has(basePath)) {
                return;
            }

            const hashSuffix = hashPart ? `#${hashPart}` : '';
            anchor.setAttribute('href', `${basePath}?lang=${encodeURIComponent(lang)}${hashSuffix}`);
        });
    }

    initGa4(siteConfig.gaMeasurementId);
    const defaultInquiryApiUrl = siteConfig.inquiryApiUrl
        || ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? '/api/inquiries' : '');
    const homeLanguagePaths = { en: '/', vi: '/vi/', th: '/th/', id: '/id/' };
    const staticHomeLanguage = document.documentElement.dataset.siteLanguage || '';
    let turnstileWidgetId = null;
    let turnstileToken = '';
    let turnstileTokenWaiter = null;

    function loadTurnstileScript() {
        if (window.turnstile) return Promise.resolve();

        return new Promise((resolve, reject) => {
            const existingScript = document.querySelector('script[data-greensmart-turnstile]');
            if (existingScript) {
                existingScript.addEventListener('load', resolve, { once: true });
                existingScript.addEventListener('error', reject, { once: true });
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
            script.async = true;
            script.defer = true;
            script.setAttribute('data-greensmart-turnstile', '1');
            script.addEventListener('load', resolve, { once: true });
            script.addEventListener('error', reject, { once: true });
            document.head.appendChild(script);
        });
    }

    async function initTurnstile() {
        const container = contactForm?.querySelector('[data-turnstile-container]');
        const submitButton = contactForm?.querySelector('button[type="submit"]');
        if (!container || !submitButton || !defaultInquiryApiUrl) return;

        try {
            const configResponse = await fetch('/api/public-config');
            const config = await configResponse.json();
            if (!configResponse.ok || !config.turnstileSiteKey) {
                throw new Error('Turnstile public configuration is unavailable.');
            }

            await loadTurnstileScript();
            if (!window.turnstile) throw new Error('Turnstile did not load.');
            turnstileWidgetId = window.turnstile.render(container, {
                sitekey: config.turnstileSiteKey,
                theme: 'light',
                size: 'flexible',
                appearance: 'interaction-only',
                action: 'inquiry',
                callback: (token) => {
                    turnstileToken = token;
                    if (turnstileTokenWaiter) {
                        turnstileTokenWaiter.resolve(token);
                        turnstileTokenWaiter = null;
                    }
                },
                'expired-callback': () => {
                    turnstileToken = '';
                },
                'error-callback': () => {
                    if (turnstileTokenWaiter) {
                        turnstileTokenWaiter.reject(new Error('Security verification is unavailable.'));
                        turnstileTokenWaiter = null;
                    }
                }
            });
        } catch (error) {
            container.classList.add('is-unavailable');
            container.textContent = 'Security verification is unavailable. Please try again later.';
            submitButton.disabled = true;
            trackEvent('turnstile_unavailable', withTrackingMeta({
                reason: error.message || 'unknown'
            }));
        }
    }

    function getTurnstileToken() {
        if (turnstileToken) return Promise.resolve(turnstileToken);
        if (turnstileWidgetId === null || !window.turnstile?.execute) {
            return Promise.reject(new Error('Security verification is unavailable.'));
        }

        return new Promise((resolve, reject) => {
            const timeout = window.setTimeout(() => {
                if (turnstileTokenWaiter) {
                    turnstileTokenWaiter = null;
                    reject(new Error('Security verification timed out.'));
                }
            }, 12000);
            turnstileTokenWaiter = {
                resolve: (token) => {
                    window.clearTimeout(timeout);
                    resolve(token);
                },
                reject: (error) => {
                    window.clearTimeout(timeout);
                    reject(error);
                }
            };
            window.turnstile.execute(turnstileWidgetId);
        });
    }

    function updateProductMultiSelectDisplay() {
        if (!productMultiSelect) {
            return;
        }

        const trigger = productMultiSelect.querySelector('[data-multi-select-trigger]');
        const checkedOptions = Array.from(productMultiSelect.querySelectorAll('input[name="product"]:checked'));
        if (!trigger) {
            return;
        }

        const placeholderText = trigger.dataset.placeholderText || trigger.textContent || '';
        if (!checkedOptions.length) {
            trigger.textContent = placeholderText;
            return;
        }

        const labels = checkedOptions
            .map((input) => input.closest('label')?.querySelector('span')?.textContent?.trim() || '')
            .filter(Boolean);

        if (labels.length <= 2) {
            trigger.textContent = labels.join(' / ');
            return;
        }

        trigger.textContent = `${labels.slice(0, 2).join(' / ')} +${labels.length - 2}`;
    }

    function initProductMultiSelect() {
        if (!productMultiSelect) {
            return;
        }

        const trigger = productMultiSelect.querySelector('[data-multi-select-trigger]');
        const checkboxes = productMultiSelect.querySelectorAll('input[name="product"]');
        if (!trigger || !checkboxes.length) {
            return;
        }

        const closeMultiSelect = () => {
            productMultiSelect.classList.remove('is-open');
            trigger.setAttribute('aria-expanded', 'false');
        };

        trigger.addEventListener('click', function () {
            const isOpen = productMultiSelect.classList.toggle('is-open');
            trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });

        checkboxes.forEach((checkbox) => {
            checkbox.addEventListener('change', function () {
                productMultiSelect.classList.remove('is-invalid');
                updateProductMultiSelectDisplay();
            });
        });

        document.addEventListener('click', function (event) {
            if (!productMultiSelect.contains(event.target)) {
                closeMultiSelect();
            }
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                closeMultiSelect();
            }
        });

        updateProductMultiSelectDisplay();
    }

    const _dictCache = new Map();
    let _translationGeneration = 0;

    async function loadDictionary(lang) {
        if (_dictCache.has(lang)) return _dictCache.get(lang);
        const res = await fetch(`/src/i18n/${lang}.json`);
        const data = await res.json();
        _dictCache.set(lang, data);
        return data;
    }

    async function applyTranslations(lang) {
        const generation = ++_translationGeneration;
        const [bundle, fallback] = await Promise.all([
            loadDictionary(lang),
            loadDictionary('en')
        ]);
        if (generation !== _translationGeneration) return;
        const strings = bundle.strings || {};
        const fallbackStrings = fallback.strings || {};

        function pick(key) {
            return strings[key] || fallbackStrings[key] || '';
        }

        function updateFaqStructuredData() {
            const faqScript = document.getElementById('faqStructuredData');
            if (!faqScript) return;
            const faqQuestions = [
                { q: pick('faq_q1'), a: pick('faq_a1') },
                { q: pick('faq_q2'), a: pick('faq_a2') },
                { q: pick('faq_q3'), a: pick('faq_a3') },
                { q: pick('faq_q4'), a: pick('faq_a4') },
                { q: pick('faq_q5'), a: pick('faq_a5') }
            ].filter((item) => item.q && item.a);

            const faqJsonLd = {
                '@context': 'https://schema.org',
                '@type': 'FAQPage',
                mainEntity: faqQuestions.map((item) => ({
                    '@type': 'Question',
                    name: item.q,
                    acceptedAnswer: {
                        '@type': 'Answer',
                        text: item.a
                    }
                }))
            };
            faqScript.textContent = JSON.stringify(faqJsonLd);
        }

        document.documentElement.lang = lang;
        document.title = bundle.title || fallback.title;
        if (metaDescription) metaDescription.setAttribute('content', bundle.description || fallback.description);
        if (metaKeywords) metaKeywords.setAttribute('content', bundle.keywords || fallback.keywords);

        document.querySelectorAll('[data-i18n]').forEach((node) => {
            const key = node.getAttribute('data-i18n');
            node.textContent = strings[key] || fallbackStrings[key] || node.textContent;
        });

        const productTrigger = document.querySelector('[data-multi-select-trigger]');
        if (productTrigger) {
            productTrigger.dataset.placeholderText = pick('form_product_placeholder');
        }

        document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
            const key = node.getAttribute('data-i18n-placeholder');
            node.setAttribute('placeholder', strings[key] || fallbackStrings[key] || node.getAttribute('placeholder') || '');
        });

        document.querySelectorAll('[data-i18n-alt]').forEach((node) => {
            const key = node.getAttribute('data-i18n-alt');
            node.setAttribute('alt', strings[key] || fallbackStrings[key] || node.getAttribute('alt') || '');
        });

        applyHeroTitleVariant(lang);
        updateDetailPageLinks(lang);
        updateFaqStructuredData();
        updateProductMultiSelectDisplay();

        langButtons.forEach((button) => {
            button.classList.toggle('active', button.dataset.lang === lang);
        });

        localStorage.setItem('greensmart-lang', lang);
    }

    window.addEventListener('scroll', function () {
        header.classList.toggle('scrolled', window.scrollY > 50);
        if (backToTop) {
            backToTop.classList.toggle('visible', window.scrollY > 360);
        }
    });

    backToTop?.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    if (mobileToggle) {
        mobileToggle.addEventListener('click', function () {
            mobileMenu.classList.toggle('active');
            const icon = mobileToggle.querySelector('i');
            icon.classList.toggle('fa-bars', !mobileMenu.classList.contains('active'));
            icon.classList.toggle('fa-times', mobileMenu.classList.contains('active'));
        });
    }

    document.querySelectorAll('.navbar-nav a, .mobile-menu a').forEach((link) => {
        link.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (href && href.startsWith('#')) {
                e.preventDefault();
                const targetElement = document.querySelector(href);
                if (targetElement) {
                    window.scrollTo({ top: targetElement.offsetTop - 80, behavior: 'smooth' });
                }
                mobileMenu.classList.remove('active');
                const icon = mobileToggle ? mobileToggle.querySelector('i') : null;
                if (icon) {
                    icon.classList.remove('fa-times');
                    icon.classList.add('fa-bars');
                }
            }
        });
    });

    langButtons.forEach((button) => {
        button.addEventListener('click', async function () {
            const targetLang = button.dataset.lang;
            if (staticHomeLanguage && homeLanguagePaths[targetLang]) {
                const params = new URLSearchParams(window.location.search);
                params.delete('lang');
                const query = params.toString();
                window.location.assign(`${homeLanguagePaths[targetLang]}${query ? `?${query}` : ''}${window.location.hash}`);
                return;
            }
            localStorage.setItem('greensmart-lang', targetLang);
            updateDetailPageLinks(targetLang);
            await applyTranslations(targetLang);
            loadAndApplyTrends(targetLang);
            loadPublishedProducts();
        });
    });

    document.querySelectorAll('a[href*="wa.me/"]').forEach((link) => {
        link.addEventListener('click', function () {
            trackEvent('click_whatsapp', withTrackingMeta({
                section: getTrackingSection(this),
                label: getTrackingLabel(this, 'whatsapp'),
                href: this.getAttribute('href') || ''
            }));
        });
    });

    document.querySelectorAll('a[href^="tel:"]').forEach((link) => {
        link.addEventListener('click', function () {
            trackEvent('click_phone', withTrackingMeta({
                section: getTrackingSection(this),
                label: getTrackingLabel(this, 'phone'),
                href: this.getAttribute('href') || ''
            }));
        });
    });

    document.querySelectorAll('.products-grid a[href*=".html"]').forEach((link) => {
        link.addEventListener('click', function () {
            trackEvent('view_product_detail', withTrackingMeta({
                product_url: this.getAttribute('href') || '',
                label: getTrackingLabel(this, 'product_detail')
            }));
        });
    });

    initProductMultiSelect();
    initTurnstile();

    function escapePublishedProductText(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    async function loadPublishedProducts() {
        const grid = document.getElementById('publishedProductsGrid');
        if (!grid) return;

        const lang = document.documentElement.lang || staticHomeLanguage || localStorage.getItem('greensmart-lang') || 'en';
        const labels = {
            en: { imagePending: 'Product image coming soon', fallback: 'Contact us for specifications, MOQ, and wholesale pricing.', details: 'View Details', quote: 'Get Wholesale Quote' },
            vi: { imagePending: 'Hinh anh san pham dang cap nhat', fallback: 'Lien he de nhan thong so, MOQ va bao gia si.', details: 'Xem chi tiet', quote: 'Yeu cau bao gia si' },
            th: { imagePending: 'กําลังอัปเดตรูปภาพสินค้า', fallback: 'ติดต่อเราเพื่อรับสเปก MOQ และราคาโรงงาน', details: 'ดูรายละเอียด', quote: 'ขอใบเสนอราคาขายส่ง' },
            id: { imagePending: 'Gambar produk segera diperbarui', fallback: 'Hubungi kami untuk spesifikasi, MOQ, dan harga grosir.', details: 'Lihat detail', quote: 'Minta penawaran grosir' }
        };
        const copy = labels[lang] || labels.en;

        try {
            const response = await fetch('/api/public-products');
            const result = await response.json();
            const items = response.ok && Array.isArray(result.items) ? result.items : [];
            if (!items.length) return;

            grid.innerHTML = items.map((item) => {
                const image = item.imageUrl
                    ? `<img src="${escapePublishedProductText(item.imageUrl)}" alt="${escapePublishedProductText(item.title)}" width="960" height="720" loading="lazy" decoding="async">`
                    : `<div class="product-placeholder"><i class="fas fa-seedling"></i><span>${copy.imagePending}</span></div>`;
                const secondaryImage = item.secondaryImageUrl
                    ? `<img class="product-img-secondary" src="${escapePublishedProductText(item.secondaryImageUrl)}" alt="" width="960" height="720" loading="lazy" decoding="async">`
                    : '';
                const badge = item.badge ? `<div class="product-badge">${escapePublishedProductText(item.badge)}</div>` : '';
                const chip = item.chip ? `<div class="product-stock-chip${item.chipIcon === 'fa-star' ? ' chip-new' : ''}"><i class="fas ${escapePublishedProductText(item.chipIcon || 'fa-check-circle')}"></i><span>${escapePublishedProductText(item.chip)}</span></div>` : '';
                const highlights = item.highlights?.length ? `<ul class="product-specs">${item.highlights.map((highlight) => `<li><i class="fas fa-check"></i>${escapePublishedProductText(highlight)}</li>`).join('')}</ul>` : '';
                const meta = item.meta?.length ? `<div class="product-meta">${item.meta.map((value) => `<span>${escapePublishedProductText(value)}</span>`).join('')}</div>` : '';
                const details = item.detailUrl ? `<a class="btn btn-secondary btn-card" href="${escapePublishedProductText(item.detailUrl)}">${copy.details}<i class="fas fa-arrow-right" aria-hidden="true"></i></a>` : '';
                return `<article class="product-card published-product-card">
                    <div class="product-image-wrapper">${image}${secondaryImage}${badge}${chip}</div>
                    <div class="product-info">
                        <h3>${escapePublishedProductText(item.title)}</h3>
                        <p>${escapePublishedProductText(item.description || copy.fallback)}</p>
                        ${highlights}
                        ${meta}
                        <div class="product-actions-row${details ? '' : ' single-action'}">${details}<a class="btn btn-primary btn-card" href="#contact" data-published-product="${escapePublishedProductText(item.title)}"><i class="fas fa-file-signature" aria-hidden="true"></i>${copy.quote}</a></div>
                    </div>
                </article>`;
            }).join('');
            grid.querySelectorAll('a[href="#contact"]').forEach((link) => link.addEventListener('click', () => {
                if (contactForm) {
                    let productInput = contactForm.querySelector('[data-published-product-input]');
                    if (!productInput) {
                        productInput = document.createElement('input');
                        productInput.type = 'hidden';
                        productInput.name = 'product';
                        productInput.dataset.publishedProductInput = 'true';
                        contactForm.appendChild(productInput);
                    }
                    productInput.value = link.dataset.publishedProduct || '';
                }
                trackEvent('request_published_product_quote', withTrackingMeta({
                    label: link.dataset.publishedProduct || 'published_product'
                }));
            }));
        } catch (error) {
            console.warn('Published products could not be loaded.', error);
        }
    }

    loadPublishedProducts();

    contactForm?.addEventListener('submit', async function (e) {
        e.preventDefault();
        const lang = localStorage.getItem('greensmart-lang') || 'en';
        const formData = new FormData(this);
        const selectedProducts = formData.getAll('product').filter((item) => String(item || '').trim());
        const formStatus = this.querySelector('[data-form-status]');
        const messages = {
            en: { sending: 'Sending...', sent: 'Inquiry sent. We will reply within 24 business hours.', failed: 'Unable to send your inquiry. Please try again.', invalid: 'Please complete the required fields and use a valid business email.', verifying: 'Verifying security...', unavailable: 'The inquiry service is temporarily unavailable. Please try again later.' },
            vi: { sending: 'Dang gui...', sent: 'Da gui inquiry. Chung toi se phan hoi trong 24 gio lam viec.', failed: 'Khong the gui inquiry. Vui long thu lai.', invalid: 'Vui long dien cac truong bat buoc va dung email doanh nghiep hop le.', verifying: 'Dang xac minh bao mat...', unavailable: 'Dich vu inquiry tam thoi khong kha dung. Vui long thu lai sau.' },
            th: { sending: 'กําลังส่ง...', sent: 'ส่งคำถามแล้ว เราจะตอบกลับภายใน 24 ชั่วโมงทำการ', failed: 'ไม่สามารถส่งคำถามได้ โปรดลองอีกครั้ง', invalid: 'โปรดกรอกข้อมูลที่จำเป็นและใช้อีเมลธุรกิจที่ถูกต้อง', verifying: 'กําลังยืนยันความปลอดภัย...', unavailable: 'บริการรับคำถามไม่พร้อมใช้งานชั่วคราว โปรดลองใหม่ภายหลัง' },
            id: { sending: 'Mengirim...', sent: 'Inquiry terkirim. Kami akan membalas dalam 24 jam kerja.', failed: 'Inquiry tidak dapat dikirim. Silakan coba lagi.', invalid: 'Lengkapi kolom wajib dan gunakan email bisnis yang valid.', verifying: 'Memverifikasi keamanan...', unavailable: 'Layanan inquiry sementara tidak tersedia. Silakan coba lagi nanti.' }
        };
        const submitButton = this.querySelector('button[type="submit"]');
        const originalText = submitButton.textContent;
        const current = messages[lang] || messages.en;
        const showFormStatus = (message, tone) => {
            if (!formStatus) return;
            formStatus.textContent = message;
            formStatus.className = `form-status is-${tone}`;
            formStatus.hidden = false;
        };
        const clearFormStatus = () => {
            if (!formStatus) return;
            formStatus.textContent = '';
            formStatus.className = 'form-status';
            formStatus.hidden = true;
        };
        clearFormStatus();
        const invalidField = Array.from(this.elements).find((field) => field.willValidate && !field.checkValidity());
        if (invalidField) {
            showFormStatus(current.invalid, 'error');
            invalidField.focus();
            return;
        }
        if (!selectedProducts.length) {
            productMultiSelect?.classList.add('is-invalid');
            productMultiSelect?.classList.add('is-open');
            const trigger = productMultiSelect?.querySelector('[data-multi-select-trigger]');
            trigger?.setAttribute('aria-expanded', 'true');
            trigger?.focus();
            return;
        }
        let securityToken = formData.get('cf-turnstile-response') || turnstileToken;
        if (!securityToken) {
            submitButton.disabled = true;
            submitButton.textContent = current.verifying;
            showFormStatus(current.verifying, 'success');
            try {
                securityToken = await getTurnstileToken();
            } catch (error) {
                submitButton.disabled = false;
                submitButton.textContent = originalText;
                showFormStatus(error.message || current.unavailable, 'error');
                return;
            }
        }
        formData.set('cf-turnstile-response', securityToken);
        submitButton.disabled = true;
        submitButton.textContent = current.sending;
        productMultiSelect?.classList.remove('is-invalid');
        const payload = Object.fromEntries(formData.entries());
        payload.product = selectedProducts.join(',');
        payload.lang = lang;
        payload.source = 'website';
        payload.pageUrl = window.location.href;

        try {
            if (defaultInquiryApiUrl) {
                const requestHeaders = { 'Content-Type': 'application/json' };
                if (siteConfig.inquiryApiBearer) {
                    requestHeaders.Authorization = `Bearer ${siteConfig.inquiryApiBearer}`;
                }
                const response = await fetch(defaultInquiryApiUrl, {
                    method: 'POST',
                    headers: requestHeaders,
                    body: JSON.stringify(payload)
                });
                if (!response.ok) {
                    const result = await response.json().catch(() => ({}));
                    const detail = String(result.error || result.message || '').trim();
                    const message = response.status >= 500
                        ? current.unavailable
                        : (detail || current.failed);
                    throw new Error(message);
                }
            } else {
                await new Promise((resolve) => setTimeout(resolve, 800));
            }

            submitButton.textContent = current.sent;
            submitButton.style.backgroundColor = '#28a745';
            showFormStatus(current.sent, 'success');
            trackEvent('submit_inquiry_success', withTrackingMeta({
                lang,
                product: selectedProducts.join('|') || 'unknown',
                country: formData.get('country') || 'unknown'
            }));
            this.reset();
            productMultiSelect?.classList.remove('is-open');
            productMultiSelect?.querySelector('[data-multi-select-trigger]')?.setAttribute('aria-expanded', 'false');
            updateProductMultiSelectDisplay();
        } catch (error) {
            submitButton.textContent = current.failed;
            submitButton.style.backgroundColor = '#dc2626';
            showFormStatus(error.message || current.failed, 'error');
            trackEvent('submit_inquiry_failed', withTrackingMeta({
                lang,
                reason: error.message || 'unknown'
            }));
        } finally {
            if (turnstileWidgetId !== null && window.turnstile) {
                window.turnstile.reset(turnstileWidgetId);
                turnstileToken = '';
            }
            setTimeout(() => {
                submitButton.textContent = originalText;
                submitButton.style.backgroundColor = '#22c55e';
                submitButton.disabled = false;
            }, 1800);
        }
    });

    const TREND_URL_KEY_MAP = {
        'self-watering-double-layer.html': 'self_watering_planter',
        'root-control-gallon-pot.html': 'nursery_tray',
    };
    const LANG_COUNTRY_MAP = { en: 'SG', vi: 'VN', th: 'TH', id: 'ID' };
    const TREND_BADGE_LABELS = {
        en: 'Trending ↑', vi: 'Trending ↑', th: 'กำลังฮิต ↑', id: 'Trending ↑'
    };
    let _trendData = null;

    async function fetchTrendData() {
        if (_trendData) return _trendData;
        try {
            const res = await fetch('/trend-data.json');
            if (!res.ok) return null;
            _trendData = await res.json();
            return _trendData;
        } catch {
            return null;
        }
    }

    function getTrendScore(trendData, productKey, countryCode) {
        const entry = trendData?.products?.[productKey]?.byCountry?.[countryCode];
        if (!entry || entry.error) return null;
        return typeof entry.averageValue === 'number' ? entry.averageValue : null;
    }

    function applyTrendBadges(lang, trendData) {
        const countryCode = LANG_COUNTRY_MAP[lang] || 'SG';
        const cards = document.querySelectorAll('.products-grid .product-card');
        cards.forEach((card) => {
            const detailLink = card.querySelector('a[href*=".html"]');
            if (!detailLink) return;
            const href = detailLink.getAttribute('href').split('?')[0];
            const productKey = TREND_URL_KEY_MAP[href];
            if (!productKey) return;
            const score = getTrendScore(trendData, productKey, countryCode);
            const badge = card.querySelector('.product-badge');
            if (!badge) return;
            card.removeAttribute('data-trend-score');
            badge.classList.remove('badge-trending', 'badge-rising');
            if (score === null) return;
            card.dataset.trendScore = score;
            if (score >= 60) {
                badge.classList.add('badge-trending');
                badge.textContent = TREND_BADGE_LABELS[lang] || TREND_BADGE_LABELS.en;
            } else if (score >= 45) {
                badge.classList.add('badge-rising');
            }
        });
        trackEvent('trend_badges_applied', { country: countryCode, lang });
    }

    function sortProductCardsByTrend(lang, trendData) {
        const countryCode = LANG_COUNTRY_MAP[lang] || 'SG';
        const grid = document.querySelector('.products-grid');
        if (!grid) return;
        const cards = Array.from(grid.querySelectorAll('.product-card'));
        cards.forEach((card) => {
            const scoreAttr = card.dataset.trendScore;
            card._trendSort = scoreAttr !== undefined ? Number(scoreAttr) : -1;
        });
        const sorted = [...cards].sort((a, b) => b._trendSort - a._trendSort);
        const hasChanged = sorted.some((card, i) => card !== cards[i]);
        if (hasChanged) {
            sorted.forEach((card) => grid.appendChild(card));
        }
    }

    async function loadAndApplyTrends(lang) {
        const trendData = await fetchTrendData();
        if (!trendData) return;
        applyTrendBadges(lang, trendData);
        sortProductCardsByTrend(lang, trendData);
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

    document.querySelectorAll('.product-card, .feature-card, .review-card, .proof-card, .market-card').forEach((el) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(24px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });

    const urlLangParam = new URLSearchParams(window.location.search).get('lang');
    const savedLangParam = localStorage.getItem('greensmart-lang');
    const supportedLangList = ['en', 'vi', 'th', 'id'];

    if (staticHomeLanguage && supportedLangList.includes(urlLangParam) && homeLanguagePaths[urlLangParam]) {
        const currentPath = window.location.pathname.replace(/\/index\.html$/i, '/').replace(/\/+$/, '/') || '/';
        const targetPath = homeLanguagePaths[urlLangParam];
        if (currentPath !== targetPath) {
            const params = new URLSearchParams(window.location.search);
            params.delete('lang');
            const query = params.toString();
            window.location.replace(`${targetPath}${query ? `?${query}` : ''}${window.location.hash}`);
            return;
        }
    }

    let initialLang;
    if (supportedLangList.includes(staticHomeLanguage)) {
        initialLang = staticHomeLanguage;
    } else if (supportedLangList.includes(urlLangParam)) {
        initialLang = urlLangParam;
    } else if (supportedLangList.includes(savedLangParam)) {
        initialLang = savedLangParam;
    } else {
        initialLang = 'en';
    }
    await applyTranslations(initialLang);
    trackEvent('ab_variant_exposure', withTrackingMeta({
        test: 'hero_title',
        lang: initialLang
    }));

    loadAndApplyTrends(initialLang);
});
