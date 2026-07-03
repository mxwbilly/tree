document.addEventListener('DOMContentLoaded', async function () {
    const pageName = window.location.pathname.split('/').pop() || '';
    const urlLang = new URLSearchParams(window.location.search).get('lang');
    const savedLang = localStorage.getItem('greensmart-lang');
    const supportedLangs = new Set(['en', 'vi', 'th', 'id']);
    const lang = supportedLangs.has(urlLang) ? urlLang : (supportedLangs.has(savedLang) ? savedLang : 'en');
    const detailPages = new Set([
        'self-watering-double-layer.html',
        'root-control-gallon-pot.html',
        'transparent-orchid-pot.html',
        'creative-shaped-planter.html'
    ]);

    if (!detailPages.has(pageName)) return;

    function mountLanguageSwitcher(currentLang) {
        const switcher = document.createElement('div');
        switcher.className = 'lang-switcher detail-lang-switcher';
        switcher.innerHTML = `
            <button type="button" class="lang-btn${currentLang === 'en' ? ' active' : ''}" data-lang="en">EN</button>
            <button type="button" class="lang-btn${currentLang === 'vi' ? ' active' : ''}" data-lang="vi">VI</button>
            <button type="button" class="lang-btn${currentLang === 'th' ? ' active' : ''}" data-lang="th">TH</button>
            <button type="button" class="lang-btn${currentLang === 'id' ? ' active' : ''}" data-lang="id">ID</button>
        `;

        switcher.addEventListener('click', function (event) {
            const target = event.target.closest('.lang-btn');
            if (!target) return;
            const nextLang = target.dataset.lang;
            if (nextLang === currentLang) return;

            const nextUrl = new URL(window.location.href);
            nextUrl.searchParams.set('lang', nextLang);
            window.location.href = nextUrl.toString();
        });

        document.body.appendChild(switcher);
    }

    const procurementData = {
        'self-watering-double-layer.html': {
            moq: [
                '50-199 pcs: standard colors, mixed sizes in same color accepted',
                '200-499 pcs: custom color program and gift-box packaging',
                '500+ pcs: OEM logo, retail-ready program, water-level window option'
            ],
            lead: [
                'Sampling: 5-10 days for standard size and color',
                'Bulk order: 20-35 days after deposit and artwork confirmation',
                'Peak season buffer: suggest booking 2-3 weeks earlier'
            ]
        },
        'root-control-gallon-pot.html': {
            moq: [
                '500-1499 pcs: standard sizes and colors, up to 4 sizes mixed',
                '1500-3999 pcs: full gallon range mix with carton marks',
                '4000+ pcs: private label marks and tailored container loading'
            ],
            lead: [
                'Sampling: 5-8 days for standard gallon sizes',
                'Bulk order: 20-30 days after deposit and quantity lock',
                'Peak season buffer: reserve 2 weeks for logistics slots'
            ]
        },
        'transparent-orchid-pot.html': {
            moq: [
                '200-499 pcs per size: stock moulds, crystal clear standard',
                '500-1999 pcs: mixed sizes and seedling cup combinations',
                '2000+ pcs: custom tint, screen print, or shrink sleeve label'
            ],
            lead: [
                'Sampling: 5-10 days including clarity check',
                'Bulk order: 15-25 days after deposit confirmation',
                'Peak season buffer: suggest 2 weeks before orchid trade peaks'
            ]
        },
        'creative-shaped-planter.html': {
            moq: [
                '50-199 pcs per design: mixed designs in same order accepted',
                '200-499 pcs: gift-box packaging and OEM insert card',
                '500+ pcs per design: exclusive OEM mould program available'
            ],
            lead: [
                'Sampling: 7-10 days for catalogue designs',
                'Bulk order: 20-35 days after deposit and packaging approval',
                'Peak season buffer: book 3-4 weeks before gift seasons'
            ]
        }
    };

    const _dictCache = new Map();
    async function loadDetailDict(langKey) {
        if (_dictCache.has(langKey)) return _dictCache.get(langKey);
        try {
            const res = await fetch(`/src/i18n/detail-${langKey}.json`);
            if (!res.ok) return null;
            const data = await res.json();
            _dictCache.set(langKey, data);
            return data;
        } catch (_) {
            return null;
        }
    }

    function mountProcurementPack(currentPage, currentLang, dictPages) {
        const pagePackDefault = procurementData[currentPage];
        const pagePack = (currentLang !== 'en' && dictPages?.[currentPage]?.moq)
            ? { moq: dictPages[currentPage].moq, lead: dictPages[currentPage].lead }
            : pagePackDefault;
        const anchor = document.querySelector('.detail-section');
        if (!pagePack || !anchor || document.querySelector('.detail-procurement')) {
            return;
        }

        const en = {
            title: 'Procurement Execution Pack',
            desc: 'Share MOQ ladder, lead-time plan, and RFQ template in the first reply to reduce back-and-forth.',
            moqTitle: 'MOQ Ladder Reference',
            leadTitle: 'Lead-Time and Planning Notes',
            fileTitle: 'RFQ Template Download',
            fileRows: [
                'Includes key fields: product, size, quantity, destination port, timeline, packing, and terms.',
                'Can be sent directly to buyers and reused for faster internal quoting.',
                'Recommend attaching template version and quote validity in every offer.'
            ],
            ctaFile: 'Download RFQ Template (CSV)'
        };
        const vi = {
            title: 'Bo tai lieu thuc thi mua hang',
            desc: 'Gui moc MOQ, ke hoach lead time, va mau RFQ ngay lan phan hoi dau de giam trao doi qua lai.',
            moqTitle: 'Moc MOQ tham chieu',
            leadTitle: 'Ghi chu lead time va lap ke hoach',
            fileTitle: 'Tai mau RFQ',
            fileRows: [
                'Da gom truong cot loi: san pham, kich thuoc, so luong, cang dich, tien do, dong goi, va dieu khoan.',
                'Co the gui truc tiep cho nguoi mua va dung lai de bao gia noi bo nhanh hon.',
                'Nen gui kem phien ban mau va thoi han hieu luc bao gia.'
            ],
            ctaFile: 'Tai mau RFQ (CSV)'
        };
        const th = {
            title: 'ชุดเอกสารปฏิบัติการจัดซื้อ',
            desc: 'ส่งช่วง MOQ, แผน lead time และเทมเพลต RFQ ตั้งแต่การตอบครั้งแรก เพื่อลดการคุยวนซ้ำ.',
            moqTitle: 'ช่วง MOQ อ้างอิง',
            leadTitle: 'หมายเหตุ lead time และการวางแผน',
            fileTitle: 'ดาวน์โหลดเทมเพลต RFQ',
            fileRows: [
                'มีฟิลด์สำคัญครบ: สินค้า, ขนาด, จำนวน, ท่าเรือปลายทาง, timeline, แพ็กกิ้ง และเงื่อนไข.',
                'ส่งให้ผู้ซื้อกรอกได้ทันที และใช้ต่อสำหรับออกใบเสนอราคาในทีม.',
                'แนะนำให้แนบเวอร์ชันเทมเพลตและวันหมดอายุราคาในทุกใบเสนอราคา.'
            ],
            ctaFile: 'ดาวน์โหลดเทมเพลต RFQ (CSV)'
        };
        const id = {
            title: 'Paket Eksekusi Pengadaan',
            desc: 'Kirim tangga MOQ, rencana lead time, dan template RFQ pada balasan pertama untuk mengurangi bolak-balik.',
            moqTitle: 'Referensi Tangga MOQ',
            leadTitle: 'Catatan Lead Time dan Perencanaan',
            fileTitle: 'Unduh Template RFQ',
            fileRows: [
                'Mencakup field inti: produk, ukuran, jumlah, pelabuhan tujuan, timeline, kemasan, dan ketentuan.',
                'Bisa langsung dikirim ke pembeli dan dipakai ulang agar penawaran internal lebih cepat.',
                'Disarankan menyertakan versi template dan masa berlaku harga di setiap penawaran.'
            ],
            ctaFile: 'Unduh Template RFQ (CSV)'
        };
        const copyMap = { en, vi, th, id };
        const copy = copyMap[currentLang] || en;

        const section = document.createElement('section');
        section.className = 'detail-procurement';
        section.innerHTML = `
            <div class="container">
                <div class="section-header compact-header">
                    <h2>${copy.title}</h2>
                    <p>${copy.desc}</p>
                </div>
                <div class="procurement-grid">
                    <article class="detail-card">
                        <h3>${copy.moqTitle}</h3>
                        <ul class="detail-mini-list">
                            ${pagePack.moq.map((item) => `<li>${item}</li>`).join('')}
                        </ul>
                    </article>
                    <article class="detail-card">
                        <h3>${copy.leadTitle}</h3>
                        <ul class="detail-mini-list">
                            ${pagePack.lead.map((item) => `<li>${item}</li>`).join('')}
                        </ul>
                    </article>
                    <article class="detail-card">
                        <h3>${copy.fileTitle}</h3>
                        <ul class="detail-mini-list">
                            ${copy.fileRows.map((item) => `<li>${item}</li>`).join('')}
                        </ul>
                        <a class="btn btn-primary" href="rfq-template.csv" download>${copy.ctaFile}</a>
                    </article>
                </div>
            </div>
        `;
        anchor.insertAdjacentElement('afterend', section);
    }

    const backBtn = document.querySelector('.detail-copy .btn.btn-secondary');
    const quoteBtn = document.querySelector('.detail-cta-bar .btn.btn-primary');
    const whatsappBtn = document.querySelector('.detail-cta-bar .btn.btn-whatsapp');

    if (backBtn) backBtn.href = `/?lang=${encodeURIComponent(lang)}#products`;
    if (quoteBtn) quoteBtn.href = `/?lang=${encodeURIComponent(lang)}#contact`;

    localStorage.setItem('greensmart-lang', lang);
    mountLanguageSwitcher(lang);

    if (lang === 'en') {
        mountProcurementPack(pageName, lang, null);
        return;
    }

    const dict = await loadDetailDict(lang);
    const uiCopy = dict?.ui || {};

    if (backBtn) backBtn.textContent = uiCopy.backBtn || '← Back to Products';

    mountProcurementPack(pageName, lang, dict?.pages || null);

    const content = dict?.pages?.[pageName];
    if (!content) return;

    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription && content.description) metaDescription.setAttribute('content', content.description);
    if (content.title) document.title = content.title;
    document.documentElement.lang = uiCopy.htmlLang || lang;

    if (quoteBtn) quoteBtn.textContent = content.ctaPrimary || uiCopy.quoteBtn || quoteBtn.textContent;
    if (whatsappBtn) whatsappBtn.textContent = content.ctaWhatsapp || uiCopy.whatsappBtn || whatsappBtn.textContent;

    const heading = document.querySelector('.detail-copy h1');
    const intro = document.querySelector('.detail-copy > p');
    if (heading && content.h1) heading.textContent = content.h1;
    if (intro && content.intro) intro.textContent = content.intro;

    document.querySelectorAll('.detail-points li').forEach((item, index) => {
        if (!content.points?.[index]) return;
        const icon = item.querySelector('i');
        item.textContent = content.points[index];
        if (icon) {
            item.prepend(icon);
            item.insertBefore(document.createTextNode(' '), icon.nextSibling);
        }
    });

    document.querySelectorAll('.quick-specs-bar .spec-item').forEach((item, index) => {
        const pair = content.quickSpecs?.[index];
        if (!pair) return;
        const label = item.querySelector('.spec-label');
        const value = item.querySelector('.spec-value');
        if (label) label.textContent = pair[0];
        if (value) value.textContent = pair[1];
    });

    const specsHeading = document.querySelector('.detail-grid .detail-card h2');
    if (specsHeading && content.specsTitle) specsHeading.textContent = content.specsTitle;

    document.querySelectorAll('.detail-spec-table tr').forEach((row, index) => {
        const line = content.specsRows?.[index];
        if (!line) return;
        const th = row.querySelector('th');
        const td = row.querySelector('td');
        if (th) th.textContent = line[0];
        if (td) td.textContent = line[1];
    });

    const gridHeadings = document.querySelectorAll('.detail-grid .detail-card h3');
    if (gridHeadings[0] && content.buyerTitle) gridHeadings[0].textContent = content.buyerTitle;
    if (gridHeadings[1] && content.whyTitle) gridHeadings[1].textContent = content.whyTitle;

    document.querySelectorAll('.detail-tags span').forEach((tag, index) => {
        if (content.tags?.[index]) tag.textContent = content.tags[index];
    });

    const whyList = document.querySelector('.detail-grid .detail-card:last-child .detail-mini-list');
    if (whyList && content.whyItems) {
        whyList.innerHTML = content.whyItems
            .map(([label, text]) => `<li><strong>${label}:</strong> ${text}</li>`)
            .join('');
    }

    const galleryHeading = document.querySelector('.gallery-section h2');
    const galleryNote = document.querySelector('.gallery-section .variant-note');
    if (galleryHeading && content.galleryTitle) galleryHeading.textContent = content.galleryTitle;
    if (galleryNote && content.galleryNote) galleryNote.textContent = content.galleryNote;
    document.querySelectorAll('.gallery-section .gallery-caption').forEach((cap, index) => {
        if (content.galleryCaptions?.[index]) cap.textContent = content.galleryCaptions[index];
    });

    const focusCards = document.querySelectorAll('.detail-focus .detail-card');
    if (focusCards.length >= 2 && content.focus) {
        const focus = content.focus;
        const leftHeading = focusCards[0].querySelector('h3');
        const rightHeading = focusCards[1].querySelector('h3');
        const leftList = focusCards[0].querySelector('.detail-mini-list');
        const rightList = focusCards[1].querySelector('.detail-mini-list');
        if (leftHeading && focus.leftTitle) leftHeading.textContent = focus.leftTitle;
        if (rightHeading && focus.rightTitle) rightHeading.textContent = focus.rightTitle;
        if (leftList && focus.leftItems) {
            leftList.innerHTML = focus.leftItems
                .map(([label, text]) => `<li><strong>${label}</strong> ${text}</li>`)
                .join('');
        }
        if (rightList && focus.rightItems) {
            rightList.innerHTML = focus.rightItems
                .map((text) => `<li>${text}</li>`)
                .join('');
        }
    }

    const relatedHeading = document.querySelector('.detail-related h3');
    if (relatedHeading && uiCopy.relatedTitle) relatedHeading.textContent = uiCopy.relatedTitle;
});
