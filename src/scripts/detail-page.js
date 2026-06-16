document.addEventListener('DOMContentLoaded', async function () {
    const pageName = window.location.pathname.split('/').pop() || '';
    const urlLang = new URLSearchParams(window.location.search).get('lang');
    const savedLang = localStorage.getItem('greensmart-lang');
    const supportedLangs = new Set(['en', 'zh', 'vi', 'th', 'id']);
    const preferredLang = supportedLangs.has(urlLang) ? urlLang : (supportedLangs.has(savedLang) ? savedLang : 'en');
    const lang = preferredLang;
    const detailPages = new Set([
        'bamboo-fiber-planter.html',
        'self-watering-ceramic-planter.html',
        'stackable-nursery-tray.html',
        'terracotta-planter.html',
        'balcony-planter-box.html',
        'hanging-coir-basket.html'
    ]);

    function mountLanguageSwitcher(currentLang) {
        const switcher = document.createElement('div');
        switcher.className = 'lang-switcher detail-lang-switcher';
        switcher.innerHTML = `
            <button type="button" class="lang-btn${currentLang === 'en' ? ' active' : ''}" data-lang="en">EN</button>
            <button type="button" class="lang-btn${currentLang === 'zh' ? ' active' : ''}" data-lang="zh">中文</button>
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
        'bamboo-fiber-planter.html': {
            moq: [
                '100-299 pcs: mixed color support within standard palette',
                '300-799 pcs: custom carton mark and barcode label support',
                '800+ pcs: OEM logo and retail pack options available'
            ],
            lead: [
                'Sampling: 5-7 days for standard size and color',
                'Bulk order: 20-30 days after deposit and artwork confirmation',
                'Peak season buffer: suggest booking 2-3 weeks earlier'
            ]
        },
        'self-watering-ceramic-planter.html': {
            moq: [
                '50-199 pcs: standard glaze and color combinations',
                '200-499 pcs: gift box and insert card options',
                '500+ pcs: OEM logo placement and premium finish program'
            ],
            lead: [
                'Sampling: 7-10 days including structure check',
                'Bulk order: 25-35 days after deposit and packaging approval',
                'Peak season buffer: recommend 3-4 weeks extra planning'
            ]
        },
        'stackable-nursery-tray.html': {
            moq: [
                '500-1499 pcs: standard tray depth and hole format',
                '1500-3999 pcs: mixed cavity options per shipment',
                '4000+ pcs: tailored carton loading and private label marks'
            ],
            lead: [
                'Sampling: 4-6 days for standard tray structure',
                'Bulk order: 18-28 days after deposit and quantity lock',
                'Peak season buffer: reserve 2 weeks for logistics slots'
            ]
        },
        'terracotta-planter.html': {
            moq: [
                '100-399 pcs: standard shape and classic terracotta tone',
                '400-999 pcs: mixed size assortment in one order',
                '1000+ pcs: customized label and reinforced packing option'
            ],
            lead: [
                'Sampling: 6-8 days for selected sizes',
                'Bulk order: 22-32 days after deposit and packing sign-off',
                'Peak season buffer: suggest 2-3 weeks for kiln scheduling'
            ]
        },
        'balcony-planter-box.html': {
            moq: [
                '20-99 sets: standard planter box and tray',
                '100-299 sets: mixed sizes with project-ready packing',
                '300+ sets: OEM color and project label support'
            ],
            lead: [
                'Sampling: 5-7 days for standard dimensions',
                'Bulk order: 20-30 days after deposit and final spec confirmation',
                'Peak season buffer: recommend 2 weeks ahead for project windows'
            ]
        },
        'hanging-coir-basket.html': {
            moq: [
                '100-299 sets: standard basket frame and chain length',
                '300-799 sets: mixed diameter combinations available',
                '800+ sets: custom chain finish and branded retail packing'
            ],
            lead: [
                'Sampling: 5-8 days for basket and chain verification',
                'Bulk order: 20-30 days after deposit and accessory confirmation',
                'Peak season buffer: reserve 2-3 weeks before spring peak'
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

        const zh = {
            title: '采购执行包（可直接用于询盘沟通）',
            desc: '把 MOQ 阶梯、交期安排和 RFQ 模板一次发给客户，可明显减少来回确认时间。',
            moqTitle: 'MOQ 阶梯参考',
            leadTitle: '交期与排产建议',
            fileTitle: 'RFQ 模板下载',
            fileRows: [
                '已包含核心字段：产品、尺寸、数量、目的港、交期、包装、条款。',
                '可直接转发给客户填写，回收后可用于内部快速报价。',
                '建议每次报价附上模板版本和有效期。'
            ],
            ctaFile: '下载 RFQ 模板 (CSV)'
        };
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
        const copyMap = { en, zh, vi, th, id };
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

    if (backBtn) backBtn.href = `index.html?lang=${encodeURIComponent(lang)}#products`;
    if (quoteBtn) quoteBtn.href = `index.html?lang=${encodeURIComponent(lang)}#contact`;

    localStorage.setItem('greensmart-lang', lang);
    mountLanguageSwitcher(lang);

    if (lang === 'en') {
        mountProcurementPack(pageName, lang, null);
        return;
    }

    const dict = await loadDetailDict(lang);
    const uiCopy = dict?.ui || {};

    if (backBtn) backBtn.textContent = uiCopy.backBtn || 'Back to Homepage';
    if (quoteBtn) quoteBtn.textContent = uiCopy.quoteBtn || 'Request Quote';

    mountProcurementPack(pageName, lang, dict?.pages || null);

    if (!dict || !detailPages.has(pageName)) return;
    const content = dict.pages?.[pageName];
    if (!content) return;

    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) metaDescription.setAttribute('content', content.description);
    document.title = content.title;
    document.documentElement.lang = uiCopy.htmlLang || lang;

    const heading = document.querySelector('.detail-copy h1');
    const intro = document.querySelector('.detail-copy > p');
    const pointItems = document.querySelectorAll('.detail-points li');
    const specsHeading = document.querySelector('.detail-card h2');
    const tableRows = document.querySelectorAll('.detail-spec-table tr');
    const buyerHeading = document.querySelectorAll('.detail-card h3')[0];
    const tagItems = document.querySelectorAll('.detail-tags span');
    const focusCards = document.querySelectorAll('.detail-focus .detail-card');

    if (heading) heading.textContent = content.h1;
    if (intro) intro.textContent = content.intro;
    pointItems.forEach((item, index) => {
        const icon = item.querySelector('i');
        item.textContent = content.points[index] || item.textContent;
        if (icon) {
            item.prepend(icon);
            item.insertBefore(document.createTextNode(' '), icon.nextSibling);
        }
    });
    if (specsHeading) specsHeading.textContent = content.specsTitle;
    tableRows.forEach((row, index) => {
        const th = row.querySelector('th');
        const td = row.querySelector('td');
        const line = content.specsRows[index];
        if (!line) return;
        if (th) th.textContent = line[0];
        if (td) td.textContent = line[1];
    });
    if (buyerHeading) buyerHeading.textContent = content.buyerTitle;
    tagItems.forEach((tag, index) => {
        tag.textContent = content.tags[index] || tag.textContent;
    });

    const focus = content.focus;
    if (focus && focusCards.length >= 2) {
        const leftHeading = focusCards[0].querySelector('h3');
        const rightHeading = focusCards[1].querySelector('h3');
        const leftList = focusCards[0].querySelector('.detail-mini-list');
        const rightList = focusCards[1].querySelector('.detail-mini-list');
        if (leftHeading) leftHeading.textContent = focus.leftTitle;
        if (rightHeading) rightHeading.textContent = focus.rightTitle;
        if (leftList) {
            leftList.innerHTML = focus.leftItems
                .map(([label, text]) => `<li><strong>${label}：</strong>${text}</li>`)
                .join('');
        }
        if (rightList) {
            rightList.innerHTML = focus.rightItems
                .map(([label, text]) => `<li><strong>${label}：</strong>${text}</li>`)
                .join('');
        }
    }
});
