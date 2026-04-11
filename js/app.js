/* Файл: js/app.js (БЛОК 1: Ядро, Настройки, История, Справочник) */

// === ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ===
let state = {}; 
let details = {}; 
let photos = {}; 
let contractorArray = []; 
let userTemplates = {};
let currentTemplateKey = ''; 
let currentChecklist = [];
let currentPhotoId = null;
let chartInstances = {};
let customExpertConclusions = {};

// Переменные зума фото
let currentZoom = 1;
let isDragging = false;
let startX, startY, translateX = 0, translateY = 0;

// Демо-режим
let isDemoMode = false;
let realState = {}, realDetails = {}, realPhotos = {}, realContractorArray = [], realTemplateKey = '';

// Настройки приложения (v16.0)
let appSettings = {
    theme: 'auto',
    fontSize: 'medium',
    navPosition: 'auto',
    swipeEnabled: true,
    autoCollapseOk: false,
    fastMode: false,
    sortFailTop: false,
    soundEnabled: true,
    autoSave: true,
    aiEnabled: false,   
    aiAuto: false,      
    apiKey: '',
    dashboardMode: 'compact' // НОВОЕ
};

// Звуковые эффекты (base64 для офлайна)
const audioOk = new Audio("data:audio/mp3;base64,//NExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"); 
const audioFail = new Audio("data:audio/mp3;base64,//NExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq");
// (В реале сюда можно вставить короткие base64 писки, сейчас они просто заглушки, чтобы не было ошибки)

// Таймер для дебаунса сохранений (оптимизация)
let __saveSessionTimer = null;

// === ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ===
document.addEventListener("DOMContentLoaded", async () => {
    try {
        await loadSettings();
        applySettingsToUI();
        
        // РАДАР ВЫСОТЫ ШАПКИ (решает проблему наплывания)
        const headerEl = document.getElementById('main-header');
        if (headerEl) new ResizeObserver(updateBodyPadding).observe(headerEl);
        window.addEventListener('resize', updateBodyPadding);
        
        let lastScroll = 0;
        window.addEventListener('scroll', () => {
            const currentScroll = window.scrollY;
            if (currentScroll > 50 && currentScroll > lastScroll) {
                if(headerEl) headerEl.classList.add('header-collapsed');
            } else if (currentScroll < 50) {
                if(headerEl) headerEl.classList.remove('header-collapsed');
            }
            lastScroll = currentScroll;
        }, { passive: true });

        const storedTmpls = await dbGet(STORES.TEMPLATES, 'custom');
        userTemplates = storedTmpls ? storedTmpls.data : JSON.parse(localStorage.getItem('rbi_audit_user_templates_ent_v12') || '{}');
        
        renderSelector();
        await restoreSession();

        if(!currentTemplateKey) {
            document.getElementById('empty-checklist-state').style.display = 'block';
            document.getElementById('audit-items').style.display = 'none';
            document.getElementById('audit-actions').style.display = 'none'; // Скрываем кнопки
        } else {
            document.getElementById('empty-checklist-state').style.display = 'none';
            document.getElementById('audit-items').style.display = 'block';
            document.getElementById('audit-actions').style.display = 'grid'; // ПОКАЗЫВАЕМ КНОПКИ при запуске!
            if (typeof render === 'function') render(); 
        }
        
        setupNavigation();

    } catch (error) { console.error("Ошибка при загрузке:", error); }
});

// === СОХРАНЕНИЕ И ВОССТАНОВЛЕНИЕ СЕССИИ ===
function scheduleSessionSave() {
    clearTimeout(__saveSessionTimer);
    __saveSessionTimer = setTimeout(() => {
        saveSessionData();
    }, 500); // Debounce 500ms
}

async function saveSessionData() {
    if (isDemoMode) return;    
    try {
        await dbPut(STORES.STATE, {
            key: 'current_session',
            templateKey: currentTemplateKey,
            project: document.getElementById('inp-project') ? document.getElementById('inp-project').value : '',
            inspector: document.getElementById('inp-inspector') ? document.getElementById('inp-inspector').value : '',
            contractor: document.getElementById('inp-contractor') ? document.getElementById('inp-contractor').value : '',
            location: document.getElementById('inp-location') ? document.getElementById('inp-location').value : '',
            state, details, photos,
            customExpertConclusions  // ← ДОБАВЛЕНО: сохраняем редактуры заключений
        });
    } catch (e) {
        console.error('Ошибка сохранения в IndexedDB:', e);
        showToast('⚠️ Ошибка автосохранения!');  // ← ДОБАВЛЕНО: уведомляем пользователя
    }
}

async function restoreSession() {
    try {
        const data = await dbGet(STORES.STATE, 'current_session');
        const hist = await dbGetAll(STORES.HISTORY);
        
        contractorArray = hist || [];
        
        if (!data) return;

        if (data.templateKey) currentTemplateKey = data.templateKey;

        if (currentTemplateKey) {
            const type = currentTemplateKey.split('_')[0];
            const key = currentTemplateKey.slice(type.length + 1);
            if (type === 'sys' && SYSTEM_TEMPLATES[key]) currentChecklist = SYSTEM_TEMPLATES[key].groups;
            else if (type === 'user' && userTemplates[key]) currentChecklist = userTemplates[key].groups;
        }

        state = data.state || {};
        details = data.details || {};
        photos = data.photos || {};
        customExpertConclusions = data.customExpertConclusions || {};  // ← ДОБАВЛЕНО

        if (currentTemplateKey && document.getElementById('checklist-selector')) {
            document.getElementById('checklist-selector').value = currentTemplateKey;
        }

        if(document.getElementById('inp-project')) document.getElementById('inp-project').value = data.project || '';
        if(document.getElementById('inp-inspector')) document.getElementById('inp-inspector').value = data.inspector || '';
        if(document.getElementById('inp-contractor')) document.getElementById('inp-contractor').value = data.contractor || '';
        if(document.getElementById('inp-location')) document.getElementById('inp-location').value = data.location || '';

        if (typeof updateDataSummary === 'function') updateDataSummary();
    } catch (e) {
        console.error('Ошибка восстановления:', e);
    }
}

// === УВЕДОМЛЕНИЯ И МОДАЛКИ (v15 100% совместимость) ===
function showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3000);
}

function closeModal() { 
    const overlay = document.getElementById('modal-overlay');
    if(overlay) overlay.style.display = 'none'; 
    document.body.classList.remove('modal-open');
}

// === НАВИГАЦИЯ (5 ВКЛАДОК v16.0) ===
function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', function() {
            const tabId = this.getAttribute('data-tab');
            switchTab(tabId, this);
        });
    });
}

// === ДИНАМИЧЕСКИЕ ОТСТУПЫ ===
function updateBodyPadding() {
    const headerEl = document.getElementById('main-header');
    const navEl = document.querySelector('.bottom-nav');
    let totalTop = 0;
    
    // Проверяем, где находится навигация (сверху или снизу)
    const isNavTop = (document.body.classList.contains('nav-pos-top')) || 
                     (document.body.classList.contains('nav-pos-auto') && window.innerWidth >= 768);

    // Добавляем высоту навигации, если она сверху
    if (isNavTop && navEl) {
        totalTop += navEl.offsetHeight; // Обычно 60px
    }

    // Проверяем, находимся ли мы на вкладке "Осмотр"
    const isAuditActive = document.getElementById('tab-audit')?.classList.contains('active');

    // Если активна вкладка "Осмотр" и шапка есть — добавляем её высоту
    if (isAuditActive && headerEl && headerEl.style.display !== 'none') {
        totalTop += headerEl.offsetHeight;
    }

    // Применяем отступ
    document.body.style.paddingTop = totalTop > 0 ? `${totalTop + 15}px` : '20px';
}

function switchTab(tabId, navElement = null) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    
    const targetTab = document.getElementById(tabId);
    if(targetTab) targetTab.classList.add('active');
    
    if (navElement) navElement.classList.add('active');
    else {
        const btn = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
        if(btn) btn.classList.add('active');
    }

    const header = document.getElementById('main-header');
    if (header) header.style.display = (tabId === 'tab-audit') ? 'block' : 'none';

    if (tabId === 'tab-audit' && typeof render === 'function') {
        render(); updateUI();
    } else if (tabId === 'tab-history') {
        renderHistoryTab();
        initCollapsiblePanel('hist-sticky-panel', 'hist-panel-body', 'hist-panel-header', 'hist-panel-toggle-icon');
    } else if (tabId === 'tab-analytics' && typeof updateAnalyticsFilters === 'function') {
        updateAnalyticsFilters(); 
        if (typeof renderCurrentAnalyticsTab === 'function') renderCurrentAnalyticsTab();
        else renderAnalyticsTab();
        // Включаем плавное iOS-сворачивание для фильтров аналитики
        initCollapsiblePanel('analytics-filters-block', 'analytics-panel-body', 'analytics-panel-header', 'analytics-panel-toggle-icon');
    } else if (tabId === 'tab-reference') {
        renderReferenceTab();
        initCollapsiblePanel('ref-sticky-panel', 'ref-panel-body', 'ref-panel-header', 'ref-panel-toggle-icon');
    } else if (tabId === 'tab-settings') {
        renderSettingsTab();
    }

    // FAB-кнопка: показываем только на аналитике
    if (typeof updateFabButton === 'function') updateFabButton(tabId);

    setTimeout(updateBodyPadding, 50);
    window.scrollTo(0, 0);
}
// === FAB-КНОПКА СКАЧАТЬ (умная, знает контекст) ===
function updateFabButton(tabId) {
    const fab = document.getElementById('fab-download-btn');
    if (!fab) return;

    // Определяем текущую активную подвкладку аналитики
    const isAnalytics = tabId === 'tab-analytics';
    const isRatingActive = document.getElementById('sub-rating') && !document.getElementById('sub-rating').classList.contains('hidden');

    if (isAnalytics) {
        fab.classList.remove('hidden');
        fab.classList.add('fab-visible');
        // Данные для кнопки — что качать
        fab.dataset.context = isRatingActive ? 'rating' : 'pdf';
    } else {
        fab.classList.add('hidden');
        fab.classList.remove('fab-visible');
    }
}

function handleFabDownload() {
    const fab = document.getElementById('fab-download-btn');
    const context = fab?.dataset.context || 'pdf';
    if (context === 'rating') exportRatingPdf();
    else exportPdfReport();
}
// === СВОРАЧИВАЕМ МИНИДАШБОРД ===
function toggleDashboardExpand() {
    const expView = document.getElementById('dash-expanded-view');
    if (!expView) return;
    expView.classList.toggle('hidden');
    // Обновляем отступ страницы
    setTimeout(() => {
        const headerEl = document.getElementById('main-header');
        if (headerEl && window.scrollY < 60) document.body.style.paddingTop = `${headerEl.offsetHeight + 10}px`;
    }, 50);
}

// === ВКЛАДКА: НАСТРОЙКИ ===
async function loadSettings() {
    try {
        const data = await dbGet(STORES.SETTINGS, 'user_prefs');
        if (data) appSettings = { ...appSettings, ...data };
    } catch (e) { console.error("Ошибка загрузки настроек", e); }
}

async function saveSettings(key, value) {
    appSettings[key] = value;
    applySettingsToUI();
    try { await dbPut(STORES.SETTINGS, { key: 'user_prefs', ...appSettings }); } 
    catch (e) { console.error("Ошибка сохранения настроек", e); }
}

function applySettingsToUI() {
    let isDark = false;
    if (appSettings.theme === 'dark') isDark = true;
    else if (appSettings.theme === 'auto') {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) isDark = true;
    }

    if (isDark) {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
    } else {
        document.documentElement.setAttribute('data-theme', 'light'); // ← ГЛАВНОЕ ИСПРАВЛЕНИЕ
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
    }
    
    if (appSettings.fastMode) document.body.classList.add('fast-mode');
    else document.body.classList.remove('fast-mode');

    document.body.classList.remove('font-small', 'font-medium', 'font-large', 'font-xlarge');
    if(appSettings.fontSize !== 'medium') document.body.classList.add(`font-${appSettings.fontSize}`);
    
    document.body.classList.remove('nav-pos-auto', 'nav-pos-top', 'nav-pos-bottom');
    document.body.classList.add(`nav-pos-${appSettings.navPosition || 'auto'}`);
    // Применяем режим мини-дашборда
    const dash = document.getElementById('header-dashboard');
    const dashExp = document.getElementById('dash-expanded-view');
    const dashIcon = document.getElementById('dash-expand-icon');

    if (appSettings.dashboardMode === 'hidden') {
        if(dash) dash.style.display = 'none';
    } else if (appSettings.dashboardMode === 'expanded') {
        if(dash) dash.style.display = 'block';
        if(dashExp) dashExp.classList.remove('hidden');
        if(dashIcon) dashIcon.style.display = 'none'; // Прячем стрелку, так как он всегда развернут
    } else {
        // Компактный режим (по умолчанию)
        if(dash) dash.style.display = 'block';
        if(dashExp) dashExp.classList.add('hidden');
        if(dashIcon) dashIcon.style.display = 'flex';
    }
    setTimeout(() => {
        const headerEl = document.getElementById('main-header');
        if (headerEl) document.body.style.paddingTop = `${headerEl.offsetHeight + 10}px`;
    }, 100);

    if (document.getElementById('tab-audit')?.classList.contains('active') && typeof render === 'function') render();
// НОВОЕ: Обновляем положение кнопки PDF, если мы сейчас в Аналитике
    const activeTab = document.querySelector('.view-section.active');
    if (activeTab) updateFabButton(activeTab.id);
}

function renderSettingsTab() {
    const map = {
        'set-swipe': appSettings.swipeEnabled,
        'set-collapse': appSettings.autoCollapseOk,
        'set-fast': appSettings.fastMode,
        'set-sortfail': appSettings.sortFailTop,
        'set-ai': appSettings.aiEnabled,
        'set-aiauto': appSettings.aiAuto
    };
    for (let id in map) {
        const el = document.getElementById(id);
        if(el) el.checked = map[id];
    }
    
    // Новые селекторы
    if(document.getElementById('set-theme')) document.getElementById('set-theme').value = appSettings.theme || 'auto';
    if(document.getElementById('set-fontsize')) document.getElementById('set-fontsize').value = appSettings.fontSize || 'medium';
    if(document.getElementById('set-navpos')) document.getElementById('set-navpos').value = appSettings.navPosition || 'auto';
    if(document.getElementById('set-apikey')) document.getElementById('set-apikey').value = appSettings.apiKey || '';
    if(document.getElementById('set-dashmode')) document.getElementById('set-dashmode').value = appSettings.dashboardMode || 'compact';
    updateStorageInfo();
}

function toggleSetting(settingKey, element) {
    let val = element.type === 'checkbox' ? element.checked : element.value;
    
    // Мы удалили старую строчку, которая ломала выбор темы
    
    appSettings[settingKey] = val;
    saveSettings(settingKey, val);
}

// НОВАЯ ФУНКЦИЯ: Очистка кэша (заглушка для будущего функционала PDF)
function clearPdfCache() {
    if(confirm('Удалить скачанные нормативы из памяти телефона?')) {
        showToast('Кэш PDF очищен');
        updateStorageInfo();
    }
}

// === ВКЛАДКА: СПРАВОЧНИК ===
function renderReferenceTab() {
    const root = document.getElementById('reference-items');
    const refSelect = document.getElementById('ref-checklist-selector');
    if (!root || !refSelect) return;

    const selectedKey = refSelect.value;
    if (!selectedKey) return;

    let checklist = [];
    const type = selectedKey.split('_')[0];
    const key = selectedKey.replace(type + '_', '');
    if (type === 'sys' && SYSTEM_TEMPLATES[key]) checklist = SYSTEM_TEMPLATES[key].groups;
    else if (type === 'user' && userTemplates[key]) checklist = userTemplates[key].groups;

    const searchTerm = document.getElementById('ref-search')?.value.toLowerCase() || "";
    let html = '';

    checklist.forEach(g => {
        const filteredItems = g.items.filter(i => 
            i.n.toLowerCase().includes(searchTerm) || 
            (i.t && i.t.toLowerCase().includes(searchTerm))
        );

        if (filteredItems.length === 0) return;

        html += `
        <div class="mb-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
            <div class="bg-slate-50 dark:bg-slate-900 p-3 text-xs font-black text-slate-600 dark:text-slate-300 uppercase border-b border-slate-200 dark:border-slate-700">${g.group || g.title}</div>
            <div class="p-2 space-y-2">`;
        
        filteredItems.forEach(i => {
            html += `
                <div class="p-3 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-lg">
                    <div class="text-[13px] font-bold text-slate-800 dark:text-white mb-2 leading-snug">
                        <span class="weight-tag wt-${i.w}">B${i.w}</span> ${i.n}
                    </div>
                    <div class="text-[11px] text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 p-2 rounded border border-slate-100 dark:border-slate-800 leading-relaxed mb-2">
                        ${i.t || 'Норматив не указан'}
                    </div>
                    <div class="flex gap-2">
                        <button class="bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 px-3 py-1.5 rounded text-[10px] font-bold uppercase flex items-center gap-1 active:scale-95 transition-colors" onclick="showToast('📄 Загрузка PDF норматива...')">📄 Норматив</button>
                        <button class="bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400 px-3 py-1.5 rounded text-[10px] font-bold uppercase flex items-center gap-1 active:scale-95 transition-colors" onclick="showToast('🗺️ Техкарта недоступна')">🗺️ ТК/Карта</button>
                    </div>
                </div>`;
        });
        html += `</div></div>`;
    });

    root.innerHTML = html || `<div class="text-center py-8 text-slate-500 text-sm font-bold bg-slate-50 dark:bg-slate-800 rounded-xl">Ничего не найдено по запросу "${searchTerm}"</div>`;
}

// === ВКЛАДКА: ИСТОРИЯ (С ФИЛЬТРАМИ v16.0) ===
function applyHistoryFilters() {
    renderHistoryTab();
}

function renderHistoryTab() {
    const listDiv = document.getElementById('history-list'); 
    const emptyMsg = document.getElementById('hist-empty-msg');
    const countEl = document.getElementById('hist-count-total');
    if(!listDiv) return;

    if (contractorArray.length === 0) { 
        listDiv.innerHTML = ''; 
        if(emptyMsg) emptyMsg.style.display = 'block'; 
        if(countEl) countEl.innerText = '0';
        return; 
    }
    
    if(emptyMsg) emptyMsg.style.display = 'none';

    // Сбор фильтров из DOM
    const fSearch = document.getElementById('hist-search-text')?.value.toLowerCase() || '';
    const fContr = document.getElementById('hist-filter-contractor')?.value || 'ALL';
    const fTmpl = document.getElementById('hist-filter-template')?.value || 'ALL';
    const fPeriod = document.getElementById('hist-filter-period')?.value || 'ALL';
    const fPhoto = document.getElementById('hist-filter-photo')?.checked || false;
    const fB3 = document.getElementById('hist-filter-b3')?.checked || false;

    // Применение фильтров
    let filteredArr = contractorArray;
    const now = new Date();
    
    // Текстовый поиск
    if (fSearch) {
        filteredArr = filteredArr.filter(i => 
            (i.location && i.location.toLowerCase().includes(fSearch)) ||
            (i.projectName && i.projectName.toLowerCase().includes(fSearch)) ||
            (i.inspectorName && i.inspectorName.toLowerCase().includes(fSearch)) ||
            (i.contractorName && i.contractorName.toLowerCase().includes(fSearch))
        );
    }
    
    if (fContr !== 'ALL') filteredArr = filteredArr.filter(i => i.contractorName === fContr);
    if (fTmpl !== 'ALL') filteredArr = filteredArr.filter(i => i.templateKey === fTmpl);
    
    if (fPeriod === 'DAY') filteredArr = filteredArr.filter(i => new Date(i.date).toDateString() === now.toDateString());
    else if (fPeriod === 'WEEK') { const w = new Date(); w.setDate(now.getDate()-7); filteredArr = filteredArr.filter(i => new Date(i.date) >= w); }
    else if (fPeriod === 'MONTH') { const m = new Date(); m.setDate(now.getDate()-30); filteredArr = filteredArr.filter(i => new Date(i.date) >= m); }

    if (fPhoto) filteredArr = filteredArr.filter(i => i.photos && Object.keys(i.photos).length > 0);
    if (fB3) filteredArr = filteredArr.filter(i => i.metrics && i.metrics.n_B3_fail > 0);

    if(countEl) countEl.innerText = filteredArr.length;

    if (filteredArr.length === 0) {
        listDiv.innerHTML = `<div class="text-sm text-slate-500 text-center bg-slate-50 dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700">По заданным фильтрам проверок не найдено.</div>`;
        return;
    }

    // Группировка: Подрядчик -> Вид работ
    const grouped = {};
    filteredArr.forEach(item => {
        const cName = item.contractorName || 'Не указан'; 
        const tTitle = item.templateTitle || 'Неизвестный вид работ';
        if (!grouped[cName]) grouped[cName] = {}; 
        if (!grouped[cName][tTitle]) grouped[cName][tTitle] = [];
        grouped[cName][tTitle].push(item);
    });

    let html = '';
    let groupIndex = 0; // Для уникальных ID блоков
    for (let cName in grouped) {
        const safeGroupName = `hist-group-${groupIndex++}`;
        
        // Кликабельный заголовок подрядчика
        html += `
        <div class="font-black text-slate-700 dark:text-slate-300 text-xs mt-4 mb-2 uppercase tracking-tight pl-2 border-l-4 border-indigo-500 cursor-pointer flex justify-between items-center" onclick="document.getElementById('${safeGroupName}').classList.toggle('hidden')">
            <span>🏗️ ${cName}</span>
            <span class="text-[10px] text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">СВЕРНУТЬ</span>
        </div>
        <div id="${safeGroupName}" class="transition-all duration-300 origin-top">`; // Начало обертки
        
        for (let tTitle in grouped[cName]) {
            html += `<div class="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-2 ml-2 mt-2">${tTitle} (${grouped[cName][tTitle].length} изд.)</div>`;
            const reversed = [...grouped[cName][tTitle]].reverse();
            
            html += reversed.map((item) => {
                const photoIcon = (item.photos && Object.keys(item.photos).length > 0) ? `📸` : '';
                return `
                <div class="flex items-center gap-2 mb-2">
                    <input type="checkbox" class="hist-checkbox w-5 h-5 accent-indigo-600 rounded shrink-0" value="${item.id}">
                    <div class="flex-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 shadow-sm cursor-pointer hover:border-indigo-300 transition-colors active:scale-[0.98]" onclick="showHistoryDetail(${item.id})">
                        <div class="flex justify-between items-start mb-1">
                            <div>
                                <div class="text-xs font-bold text-slate-800 dark:text-white">${item.location} <span class="text-[10px] ml-1">${photoIcon}</span></div>
                                <div class="text-[9px] text-slate-400 mt-0.5">${new Date(item.date).toLocaleString('ru-RU')}</div>
                            </div>
                            <span class="status-tag ${item.metrics.statusCls}">${item.metrics.final}%</span>
                        </div>
                        <div class="text-[10px] text-slate-500 dark:text-slate-400 mt-2 bg-slate-50 dark:bg-slate-900/50 p-1.5 rounded">
                            Ошибки: <span class="text-blue-600 font-bold">B1: ${item.metrics.n_B1_fail}</span> | 
                            <span class="text-orange-600 font-bold">B2: ${item.metrics.n_B2_fail}</span> | 
                            <span class="text-red-600 font-bold">B3: ${item.metrics.n_B3_fail}</span>
                        </div>
                    </div>
                </div>`
            }).join('');
        }
        html += `</div>`; // Закрываем обертку подрядчика
    }
    listDiv.innerHTML = html;
}
// === МАССОВЫЕ ОПЕРАЦИИ (ИСТОРИЯ) ===
function toggleAllHistory(checkbox) {
    const checkboxes = document.querySelectorAll('.hist-checkbox');
    checkboxes.forEach(cb => cb.checked = checkbox.checked);
}

function getSelectedHistoryIds() {
    return Array.from(document.querySelectorAll('.hist-checkbox:checked')).map(cb => parseInt(cb.value));
}

async function deleteSelectedHistory() {
    const ids = getSelectedHistoryIds();
    if (ids.length === 0) return showToast('Выберите элементы для удаления');
    if (!confirm(`Удалить выбранные проверки (${ids.length} шт)?`)) return;

    contractorArray = contractorArray.filter(i => !ids.includes(i.id));
    
    // Удаляем из базы
    for (let id of ids) { await dbDelete(STORES.HISTORY, id); }
    
    document.getElementById('hist-select-all').checked = false;
    renderHistoryTab();
    showToast('Удалено успешно');
}

function exportSelectedCsv() {
    const ids = getSelectedHistoryIds();
    if (ids.length === 0) return showToast('Выберите элементы для выгрузки');
    
    const selectedData = contractorArray.filter(i => ids.includes(i.id));
    const csv = exportToCSV(selectedData);
    if(csv) downloadFile(csv, `rbi_selected_${new Date().toLocaleDateString()}.csv`, 'text/csv');
}

// 100% СОВМЕСТИМАЯ МОДАЛКА ИСТОРИИ ИЗ v15
function showHistoryDetail(id) {
    const sortedArray = [...contractorArray].sort((a, b) => new Date(b.date) - new Date(a.date));
    const currIdx = sortedArray.findIndex(x => x.id === id);
    if (currIdx === -1) return;
    
    const item = sortedArray[currIdx];
    const newerId = currIdx > 0 ? sortedArray[currIdx - 1].id : null;
    const olderId = currIdx < sortedArray.length - 1 ? sortedArray[currIdx + 1].id : null;

    const type = item.templateKey.split('_')[0]; 
    const key = item.templateKey.replace(type + '_', '');
    const specificChecklist = type === 'sys' && SYSTEM_TEMPLATES[key] ? SYSTEM_TEMPLATES[key].groups : (userTemplates[key] ? userTemplates[key].groups : []);
    
    let nOk = 0, nTotal = 0;

    const resultItems = getFlatList(specificChecklist).filter(i => item.state[i.id]).map(i => {
        nTotal++;
        let stTxt = 'OK', stCls = 'tag-green', cat = `B${i.w}`;
        if (item.state[i.id] === 'ok') nOk++;
        if (item.state[i.id] === 'fail') { stTxt = 'FAIL'; stCls = 'tag-red'; }
        if (item.state[i.id] === 'fail_escalated') { stTxt = '>1.5x (B3)'; stCls = 'tag-red shadow-sm'; cat = 'B3'; }
        
        let photoHtml = (item.photos && item.photos[i.id]) ? `<img src="${item.photos[i.id]}" class="mt-2 w-20 h-20 object-cover rounded border border-slate-200 shadow-sm cursor-pointer" onclick="openPhotoViewer('${item.photos[i.id]}')">` : '';
        
        let extraData = '';
        if(item.details && item.details[i.id]) {
            const d = item.details[i.id];
            if(d.fact && d.tol) extraData += `<div class="text-[10px] font-bold text-orange-600 mt-1">Факт: ${d.fact}${d.unit} при допуске ${d.tol}${d.unit} (Превышение ${(d.fact/d.tol).toFixed(1)}x)</div>`;
            if(d.comment) extraData += `<div class="text-[10px] text-slate-500 italic mt-1">${d.comment}</div>`;
        }

        return `<div class="border-b border-slate-100 dark:border-slate-700 py-2.5"><div class="flex items-start justify-between gap-3"><div class="text-[11px] font-bold text-slate-700 dark:text-slate-300 leading-snug"><span class="weight-tag wt-${i.w}">${cat}</span> ${i.n}${extraData}</div><span class="status-tag ${stCls}">${stTxt}</span></div>${photoHtml}</div>`;
    }).join('');

    const modal = document.getElementById('modal-overlay');
    document.getElementById('modal-title').innerHTML = `
        <div class="flex justify-between items-center w-full">
            <button class="p-2 -ml-2 text-slate-400 hover:text-indigo-600 disabled:opacity-20 active:scale-90" ${newerId ? `onclick="showHistoryDetail(${newerId})"` : 'disabled'}><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M15 19l-7-7 7-7"></path></svg></button>
            <div class="text-center truncate flex-1 px-2 text-lg dark:text-white">${item.location}</div>
            <button class="p-2 -mr-2 text-slate-400 hover:text-indigo-600 disabled:opacity-20 active:scale-90" ${olderId ? `onclick="showHistoryDetail(${olderId})"` : 'disabled'}><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M9 5l7 7-7 7"></path></svg></button>
        </div>`;
    
    document.getElementById('modal-body').innerHTML = `
        <div class="text-xs font-bold text-slate-500 mb-1">${item.contractorName}</div>
        <div class="text-[10px] font-bold text-slate-400 mb-1">${item.templateTitle}</div>
        <div class="text-[10px] text-slate-400 mb-4">${new Date(item.date).toLocaleString('ru-RU')}</div>
        
        <div class="grid grid-cols-2 gap-3 mb-4">
            <div class="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col justify-center">
                <div class="text-[9px] text-slate-400 uppercase font-bold mb-1">УрК Изделия</div>
                <div class="text-3xl font-black ${item.metrics.isDanger ? 'text-red-600' : (item.metrics.final < 85 ? 'text-orange-500' : 'text-green-600')}">${item.metrics.final}%</div>
            </div>
        </div>
        
        ${item.metrics.reason ? `<div class="text-[10px] font-bold text-red-600 mb-3 bg-red-50 p-3 rounded-lg border border-red-100 shadow-sm">${item.metrics.reason}</div>` : ''}
        
        <div class="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 mb-4">
            <div class="text-[10px] font-bold text-slate-500 uppercase mb-2 border-b border-slate-200 dark:border-slate-700 pb-1">Инженерный breakdown</div>
            <div class="grid grid-cols-2 gap-2 text-xs text-slate-700 dark:text-slate-300">
                <div>Проверено: <b>${nTotal} из ${item.metrics.totalCount}</b></div>
                <div>Соответствует: <b class="text-green-600">${nOk}</b></div>
                <div>Нарушения: <b class="text-red-600">${nTotal - nOk}</b></div>
                <div class="col-span-2 text-[10px] mt-1">B1: <b>${item.metrics.n_B1_fail}</b> | B2: <b>${item.metrics.n_B2_fail}</b> | B3: <b>${item.metrics.n_B3_fail}</b></div>
                <div class="col-span-2 text-[10px] font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-1.5 rounded mt-1 text-center font-bold">Формула: ${item.metrics.baseUrkPerc}% × ${item.metrics.kc.toFixed(2)} × ${item.metrics.kcrit.toFixed(2)} = ${item.metrics.final}%</div>
            </div>
        </div>
        <div class="text-[11px] font-bold text-slate-400 uppercase mb-2 mt-6">Детализация проверки</div>
        <div class="pb-6">${resultItems}</div>
    `;
    
    document.body.classList.add('modal-open'); 
    modal.style.display = 'flex';
}
/* Файл: js/app.js (БЛОК 2: Инспекция, Свайпы, Аналитика, Данные) */

// === ШАПКА И ВЫБОР ЧЕК-ЛИСТА ===
// === ШАПКА И ВЫБОР ЧЕК-ЛИСТА ===
function renderSelector() {
    // 1. Селектор в Осмотре
    const sysGroup = document.getElementById('system-group');
    const userGroup = document.getElementById('user-group');
    
    // 2. Селектор в Справочнике
    const refSysGroup = document.getElementById('ref-system-group');
    const refUserGroup = document.getElementById('ref-user-group');

    let sysHtml = Object.keys(SYSTEM_TEMPLATES).map(key => `<option value="sys_${key}">${SYSTEM_TEMPLATES[key].title}</option>`).join('');
    let userKeys = Object.keys(userTemplates);
    let userHtml = userKeys.length > 0 ? userKeys.map(key => `<option value="user_${key}">${userTemplates[key].title}</option>`).join('') : `<option disabled>Своих шаблонов нет</option>`;

    if(sysGroup) sysGroup.innerHTML = sysHtml;
    if(userGroup) userGroup.innerHTML = userHtml;
    
    if(refSysGroup) refSysGroup.innerHTML = sysHtml;
    if(refUserGroup) refUserGroup.innerHTML = userHtml;

    if(currentTemplateKey) {
        const sel = document.getElementById('checklist-selector');
        if(sel) sel.value = currentTemplateKey;
    }
}

// Изменение селектора ТОЛЬКО в Справочнике
function changeRefTemplate(selectEl) {
    const label = document.getElementById('ref-selector-label');
    if (label) label.innerHTML = `${selectEl.options[selectEl.selectedIndex].text} <span>▼</span>`;
    renderReferenceTab();
}

function changeTemplate(val) {
    if (val === 'HOME') {
        currentTemplateKey = ''; 
        if(document.getElementById('checklist-selector')) document.getElementById('checklist-selector').value = ''; 
        state = {}; details = {}; photos = {};
        switchTab('tab-audit');
        document.getElementById('empty-checklist-state').style.display = 'block';
        document.getElementById('audit-items').style.display = 'none';
        document.getElementById('audit-actions').style.display = 'none';
        document.getElementById('data-block-summary').innerText = '';
        if(document.getElementById('current-checklist-label')) document.getElementById('current-checklist-label').innerText = 'Чек-лист не выбран';
        saveSessionData();
        return;
    }

    if (val === 'UPLOAD') {
        document.getElementById('json-input').click();
        document.getElementById('checklist-selector').value = currentTemplateKey || "";
        return;
    }

    currentTemplateKey = val;
    const type = val.split('_')[0];
    const key = val.replace(type + '_', '');
    
    if (type === 'sys' && SYSTEM_TEMPLATES[key]) currentChecklist = SYSTEM_TEMPLATES[key].groups;
    else if (type === 'user' && userTemplates[key]) currentChecklist = userTemplates[key].groups;
    
    state = {}; details = {}; photos = {}; 
    saveSessionData(); updateDataSummary();
    
    document.getElementById('empty-checklist-state').style.display = 'none';
    document.getElementById('audit-items').style.display = 'block';
    document.getElementById('audit-actions').style.display = 'grid';

    if(document.getElementById('tab-audit').classList.contains('active')) { render(); updateUI(); }
}

function updateDataSummary() {
    const proj = document.getElementById('inp-project')?.value.trim() || 'Объект';
    const contr = document.getElementById('inp-contractor')?.value.trim() || 'Подрядчик';
    const loc = document.getElementById('inp-location')?.value.trim() || 'Локация';
    
    const selectEl = document.getElementById('checklist-selector');
    const clName = selectEl?.options[selectEl.selectedIndex]?.text.replace('▼', '').trim() || 'Чек-лист не выбран';
    
    const summary = document.getElementById('data-block-summary');
    if(summary) summary.innerText = `✏️ ${clName} | ${proj} | ${contr} | ${loc}`;
    
    const labelEl = document.getElementById('current-checklist-label');
    if(labelEl) labelEl.innerText = clName;
}

function toggleDataBlock(forceOpen = false) {
    const content = document.getElementById('data-block-content');
    const summary = document.getElementById('data-block-summary');
    const icon = document.getElementById('data-toggle-icon');
    if(!content || !summary) return;
    
    if (forceOpen || content.style.display === 'none') {
        content.style.display = 'grid'; summary.classList.add('hidden'); icon.innerText = 'СВЕРНУТЬ ▲';
    } else {
        updateDataSummary(); content.style.display = 'none'; summary.classList.remove('hidden'); icon.innerText = 'РАЗВЕРНУТЬ ▼';
    }
}

// === ЛОГИКА ВЗАИМОДЕЙСТВИЯ (ОТКАЗ ОТ ПОЛНОЙ ПЕРЕРИСОВКИ) ===
function toggleOk(id) {
    if (state[id] === 'ok') state[id] = null;
    else { state[id] = 'ok'; delete photos[id]; delete details[id]; }
    updateCardDOM(id); updateUI(); scheduleSessionSave(); /* Заменили прямое сохранение на отложенное */
}

function toggleFail(id) {
    if (state[id] === 'fail' || state[id] === 'fail_escalated') { state[id] = null; delete photos[id]; delete details[id]; } 
    else { state[id] = 'fail'; delete photos[id]; delete details[id]; }
    updateCardDOM(id); updateUI(); scheduleSessionSave();
}

function toggleEscalation(id) {
    if (state[id] === 'fail_escalated') state[id] = 'fail';
    else if (state[id] === 'fail') state[id] = 'fail_escalated';
    updateCardDOM(id); updateUI(); scheduleSessionSave();
}

// === РЕНДЕР ОСМОТРА ===
function render() {
    if(!currentTemplateKey) return;
    const root = document.getElementById('audit-items');
    const navRoot = document.getElementById('audit-group-nav');
    if(!root) return;

    let html = ""; let navHtml = "";

    currentChecklist.forEach((g, gIndex) => {
        navHtml += `<button id="nav-btn-${gIndex}" onclick="scrollToGroup(${gIndex})" class="inline-block px-3 py-1.5 min-w-fit text-[10px] font-bold uppercase rounded-xl bg-[var(--hover-bg)] text-[var(--text-muted)] border border-[var(--card-border)] transition-colors active:scale-95 shrink-0">${g.group || g.title}</button>`;

        html += `<div class="block-title flex justify-between items-center cursor-pointer select-none rounded-lg px-2 mt-4" onclick="toggleGroup(${gIndex})">
            <span id="group-title-${gIndex}">▼ ${g.group || g.title}</span>
            <span id="group-counter-${gIndex}" class="text-[10px] bg-[var(--card-border)] px-2 py-0.5 rounded text-[var(--text-muted)]">0/${g.items.length}</span>
        </div><div id="group_content_${gIndex}" class="transition-all origin-top">`;
        
        // Безопасная сортировка FAIL наверх
        let itemsToRender = [...g.items];
        if (appSettings.sortFailTop) {
            itemsToRender.sort((a, b) => {
                const sA = (state[a.id] === 'fail' || state[a.id] === 'fail_escalated') ? 1 : 0;
                const sB = (state[b.id] === 'fail' || state[b.id] === 'fail_escalated') ? 1 : 0;
                return sB - sA;
            });
        }
        
        itemsToRender.forEach((i) => { html += `<div id="card_wrapper_${i.id}"></div>`; });
        html += `</div>`;
    });

    root.innerHTML = html;
    if (navRoot) { navRoot.innerHTML = navHtml; navRoot.classList.remove('hidden'); }

    // Рендер карточек
    currentChecklist.forEach(g => {
        g.items.forEach(i => updateCardDOM(i.id, i));
    });

    if (appSettings.swipeEnabled) initSwipes();
    updateGroupCounters();
}

function toggleGroup(index) {
    const content = document.getElementById(`group_content_${index}`);
    const title = document.getElementById(`group-title-${index}`);
    if (!content || !title) return;
    
    if (content.style.display === 'none') {
        content.style.display = 'block';
        title.innerText = title.innerText.replace('▶', '▼');
    } else {
        content.style.display = 'none';
        title.innerText = title.innerText.replace('▼', '▶');
    }
}

function scrollToGroup(index) {
    const content = document.getElementById(`group_content_${index}`);
    if (content && content.previousElementSibling) {
        // Динамически вычисляем высоту текущей шапки
        const headerEl = document.getElementById('main-header');
        const headerOffset = headerEl ? headerEl.offsetHeight + 10 : 120; 
        
        const elementPosition = content.previousElementSibling.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
        window.scrollTo({ top: offsetPosition, behavior: "smooth" });
    }
}

// === КНОПКИ ЭТАПОВ (РАСКРАСКА ПО КАЧЕСТВУ) ===
function updateGroupCounters() {
    if(!currentTemplateKey) return;
    
    currentChecklist.forEach((g, gIndex) => {
        let answered = 0;
        let stageState = {};
        
        // Собираем стейт только для этого этапа
        g.items.forEach(i => {
            if (state[i.id]) {
                answered++;
                stageState[i.id] = state[i.id];
            }
        });
        
        const counterEl = document.getElementById(`group-counter-${gIndex}`);
        const navBtnEl = document.getElementById(`nav-btn-${gIndex}`);
        
        if (counterEl) counterEl.innerText = `${answered}/${g.items.length}`;
        
        if (navBtnEl) {
            // Если этап не начали проверять
            if (answered === 0) {
                navBtnEl.className = `inline-block px-3 py-2 mr-2 text-[10px] font-bold uppercase rounded-xl bg-[var(--hover-bg)] text-[var(--text-muted)] border border-[var(--card-border)] transition-colors active:scale-95`;
            } else {
                // Если начали, считаем его УрК
                const stageMetrics = getProductMetrics(stageState, [g]);
                const f = stageMetrics.final;
                
                // Красим в соответствии с УрК
                if (f < 70 || stageMetrics.isDanger) {
                    navBtnEl.className = `inline-block px-3 py-2 mr-2 text-[10px] font-black uppercase rounded-xl border-2 transition-all shadow-sm bg-red-50 text-red-700 border-red-400 dark:bg-red-900/30 dark:border-red-600 dark:text-red-300`;
                } else if (f < 85) {
                    navBtnEl.className = `inline-block px-3 py-2 mr-2 text-[10px] font-black uppercase rounded-xl border-2 transition-all shadow-sm bg-yellow-50 text-yellow-800 border-yellow-400 dark:bg-yellow-900/30 dark:border-yellow-600 dark:text-yellow-300`;
                } else {
                    navBtnEl.className = `inline-block px-3 py-2 mr-2 text-[10px] font-black uppercase rounded-xl border-2 transition-all shadow-sm bg-green-50 text-green-800 border-green-400 dark:bg-green-900/30 dark:border-green-600 dark:text-green-300`;
                }
            }
        }
    });
}

function updateCardDOM(id, itemData = null) {
    const wrapper = document.getElementById(`card_wrapper_${id}`);
    if(!wrapper) return;

    // Если данные не переданы (вызов при клике), ищем их в справочнике
    if (!itemData) {
        const flat = getFlatList(currentChecklist);
        itemData = flat.find(x => x.id === id);
    }
    if(!itemData) return;

    const s = state[id];
    const i = itemData;
    
    let isEscalated = s === 'fail_escalated';
    let failActive = s === 'fail' || s === 'fail_escalated';
    let okActive = s === 'ok';

    let cardBgClass = failActive ? 'bg-red-50 border-red-100 dark:bg-red-900/20 dark:border-red-800' : (okActive ? 'bg-green-50 border-green-100 dark:bg-green-900/20 dark:border-green-800' : '');
    let indicatorClass = `indicator-${s ? (okActive ? 'ok' : (isEscalated ? 3 : i.w)) : i.w}`;
    
    // Схлопывание ОК
    let collapseClass = '';
    if (okActive && appSettings.autoCollapseOk) {
        collapseClass = 'card-collapsed';
        cardBgClass = ''; // Убираем зеленый фон карточки, он задается в CSS
    }

    // Звуки
    if (appSettings.soundEnabled && state[id] && !itemData._justRendered) {
        if (state[id] === 'ok') audioOk.play().catch(()=>{});
        else audioFail.play().catch(()=>{});
    }
    itemData._justRendered = true; // Защита от проигрывания при загрузке

    let extraBtnsHtml = ''; let commentBlockHtml = ''; let visualIndicatorHtml = '';

    if (failActive) {
        let hasComment = details[id]?.comment && details[id].comment.trim() !== "";
        let commBtn = hasComment ? 
            `<div class="relative inline-block"><button onclick="toggleCommentField(${id})" class="btn-status text-indigo-600 bg-indigo-100 border-indigo-300 dark:bg-indigo-900 dark:text-indigo-300 !w-10 !h-10 !rounded-md"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg></button><div onclick="deleteComment(${id}, event)" class="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-[12px] font-bold cursor-pointer shadow-md border border-white">✕</div></div>` : 
            `<button onclick="toggleCommentField(${id})" class="btn-status !w-10 !h-10 !rounded-md"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg></button>`;
        
        let photoBtn = photos[id] ? 
            `<div class="relative inline-block"><img src="${photos[id]}" class="photo-thumb !w-10 !h-10 !rounded-md border-2 border-indigo-200" onclick="openPhotoViewer('${photos[id]}')"><div onclick="removePhoto(${id}, event)" class="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-[12px] font-bold cursor-pointer shadow-md border border-white">✕</div></div>` : 
            `<button onclick="triggerPhotoInput(${id})" class="btn-status !w-10 !h-10 !rounded-md"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><circle cx="12" cy="13" r="3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></circle></svg></button>`;

        let escBtn = (i.w === 2) ? `<button onclick="toggleEscalation(${id})" class="btn-status ${isEscalated ? 'bg-red-600 text-white border-red-600 shadow-md' : 'text-orange-500 bg-orange-50 border-orange-200'} !w-10 !h-10 !rounded-md transition-all"><span class="text-[12px] font-black">>1.5</span></button>` : '';

        extraBtnsHtml = `<div class="flex gap-1.5 shrink-0 ml-2 items-center justify-end">${commBtn}${photoBtn}${escBtn}</div>`;
        if (hasComment) commentBlockHtml = `<div class="mt-2 text-[12px] font-semibold text-slate-700 dark:text-slate-300 italic bg-white dark:bg-slate-800 p-2 rounded-md border border-red-100 dark:border-red-800">💬 ${details[id].comment}</div>`;
        if (isEscalated) visualIndicatorHtml = `<div class="text-[10px] font-black text-white bg-red-600 px-2 py-0.5 rounded inline-block mt-1">Дефект учтен как B3</div>`;
    }

    let mainBtnsHtml = `
    <div class="flex gap-1.5 shrink-0 ml-2">
        <button onclick="toggleOk(${id})" class="btn-status ${okActive ? 'bg-green-500 text-white border-green-500' : ''} !w-12 !h-12">
            <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button onclick="toggleFail(${id})" class="btn-status ${failActive ? 'bg-red-500 text-white border-red-500' : ''} !w-12 !h-12">
            <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
    </div>`;

    const cardHtml = `
    <div class="card-audit swipe-container ${indicatorClass} ${cardBgClass} ${collapseClass}" data-id="${id}" onclick="if(this.classList.contains('card-collapsed')) toggleOk(${id})">
        <div class="swipe-actions-bg swipe-bg-ok"><span class="ml-4">OK</span></div>
        <div class="swipe-actions-bg swipe-bg-fail"><span class="mr-4">FAIL</span></div>
        <div class="swipe-content p-2.5 bg-inherit border-inherit rounded-inherit h-full w-full bg-[var(--card-bg)] dark:bg-slate-800 transition-colors">
            <div class="flex justify-between items-center min-h-[48px] card-body-content">
                <div class="flex-1 mr-2 min-w-0 pointer-events-none">
                    <div class="text-[13px] font-bold leading-snug mb-1 card-title-text"><span class="weight-tag wt-${i.w}">B${i.w}</span> ${i.n}</div>
                    <div class="text-[11px] text-[var(--text-muted)] leading-snug norm-desc-text">${i.t}</div>
                    ${visualIndicatorHtml}
                </div>
                ${extraBtnsHtml}
                ${mainBtnsHtml}
            </div>
            ${commentBlockHtml}
        </div>
    </div>`;
    
    wrapper.innerHTML = cardHtml;
}

// === СВАЙПЫ (ЛОГИКА) ===
function initSwipes() {
    const container = document.getElementById('audit-items');
    let startX = 0, currentX = 0, isDragging = false, currentCard = null, content = null;

    container.addEventListener('touchstart', (e) => {
        if (!appSettings.swipeEnabled) return;
        const target = e.target.closest('.swipe-container');
        if (!target || e.target.closest('.btn-status')) return; // Не свайпаем, если нажали на кнопку
        
        currentCard = target;
        content = currentCard.querySelector('.swipe-content');
        startX = e.touches[0].clientX;
        isDragging = true;
        currentCard.classList.add('swiping');
    }, {passive: true});

    container.addEventListener('touchmove', (e) => {
        if (!isDragging || !currentCard || !content) return;
        currentX = e.touches[0].clientX;
        const diff = currentX - startX;
        
        // Показываем подложку нужного цвета в зависимости от направления
        const bgOk = currentCard.querySelector('.swipe-bg-ok');
        const bgFail = currentCard.querySelector('.swipe-bg-fail');
        if(diff > 0) { bgOk.style.zIndex = 1; bgFail.style.zIndex = 0; } 
        else { bgOk.style.zIndex = 0; bgFail.style.zIndex = 1; }

        if (Math.abs(diff) < 150) { // Ограничитель свайпа
            content.style.transform = `translateX(${diff}px)`;
        }
    }, {passive: true});

    container.addEventListener('touchend', (e) => {
        if (!isDragging || !currentCard || !content) return;
        isDragging = false;
        currentCard.classList.remove('swiping');
        
        const diff = currentX - startX;
        const id = parseInt(currentCard.dataset.id);

        if (diff > 80) toggleOk(id); // Свайп вправо
        else if (diff < -80) toggleFail(id); // Свайп влево
        
        content.style.transform = `translateX(0)`;
        currentCard = null; content = null;
    });
}

// === ОБНОВЛЕНИЕ МИНИ-ДАШБОРДА ===
// === ОБНОВЛЕНИЕ МИНИ-ДАШБОРДА ===
function updateUI() {
    const p = currentTemplateKey ? getProductMetrics(state, currentChecklist) : null;
    
    // Функция контраста текста
    const getTextColor = (val, isDanger) => {
        if(isDanger || val < 70) return 'text-white drop-shadow-md';
        if(val < 85) return 'text-slate-900'; // На желтом черный текст лучше читается
        return 'text-white drop-shadow-md'; // На зеленом белый норм
    };

    // Обновляем изделие
    if (!p) {
        if(document.getElementById('dash-p-text')) document.getElementById('dash-p-text').innerText = "0/0";
        if(document.getElementById('dash-p-bar')) document.getElementById('dash-p-bar').style.width = "0%";
        if(document.getElementById('dash-p-percent')) document.getElementById('dash-p-percent').innerText = "--%";
        ['dash-p-kc', 'dash-p-kcrit', 'dash-p-b2', 'dash-p-b3'].forEach(id => { if(document.getElementById(id)) document.getElementById(id).innerText = "-"; });
    } else {
        if(document.getElementById('dash-p-text')) document.getElementById('dash-p-text').innerText = `${p.checkedCount}/${p.totalCount}`;
        if(document.getElementById('dash-p-bar')) {
            document.getElementById('dash-p-bar').style.width = `${p.final}%`;
            document.getElementById('dash-p-bar').className = `absolute top-0 left-0 h-full transition-all duration-500 ${p.isDanger ? 'bg-red-500' : (p.final < 85 ? 'bg-yellow-400' : 'bg-green-500')}`;
        }
        if(document.getElementById('dash-p-percent')) {
            document.getElementById('dash-p-percent').innerText = `${p.final}%`;
            document.getElementById('dash-p-percent').className = `absolute inset-0 flex items-center justify-center text-[11px] font-black z-10 ${getTextColor(p.final, p.isDanger)}`;
        }
        
        // Детали развернутого вида
        if(document.getElementById('dash-p-kc')) document.getElementById('dash-p-kc').innerText = p.kc.toFixed(2);
        if(document.getElementById('dash-p-kcrit')) document.getElementById('dash-p-kcrit').innerText = p.kcrit.toFixed(2);
        if(document.getElementById('dash-p-b2')) document.getElementById('dash-p-b2').innerText = p.n_B2_fail;
        if(document.getElementById('dash-p-b3')) document.getElementById('dash-p-b3').innerText = p.n_B3_fail;
    }

    // Обновляем подрядчика
    const currentContr = document.getElementById('inp-contractor')?.value.trim();
    const filteredArr = currentContr ? contractorArray.filter(i => i.contractorName === currentContr && i.templateKey === currentTemplateKey) : [];
    
    if (filteredArr.length < 3) { // Порог достоверности
        if(document.getElementById('dash-c-text')) document.getElementById('dash-c-text').innerText = `${filteredArr.length} шт.`;
        if(document.getElementById('dash-c-bar')) document.getElementById('dash-c-bar').style.width = "0%";
        if(document.getElementById('dash-c-percent')) document.getElementById('dash-c-percent').innerText = "СБОР";
        ['dash-c-ks', 'dash-c-kcrit', 'dash-c-b3'].forEach(id => { if(document.getElementById(id)) document.getElementById(id).innerText = "-"; });
    } else {
        const c = getContractorMetrics(filteredArr, userTemplates);
        if(c) {
            if(document.getElementById('dash-c-text')) document.getElementById('dash-c-text').innerText = `${c.count} шт.`;
            if(document.getElementById('dash-c-bar')) {
                document.getElementById('dash-c-bar').style.width = `${c.finalC}%`;
                document.getElementById('dash-c-bar').className = `absolute top-0 left-0 h-full transition-all duration-500 ${c.isRedZone ? 'bg-red-500' : (c.finalC < 85 ? 'bg-yellow-400' : 'bg-green-500')}`;
            }
            if(document.getElementById('dash-c-percent')) {
                document.getElementById('dash-c-percent').innerText = `${c.finalC}%`;
                document.getElementById('dash-c-percent').className = `absolute inset-0 flex items-center justify-center text-[11px] font-black z-10 ${getTextColor(c.finalC, c.isRedZone)}`;
            }
            
            // Детали развернутого вида
            if(document.getElementById('dash-c-ks')) {
                const ksEl = document.getElementById('dash-c-ks');
                ksEl.innerText = c.ks.toFixed(2);
                ksEl.className = `font-black ${c.ks < 1 ? 'text-red-500' : 'text-green-600'}`;
            }
            if(document.getElementById('dash-c-kcrit')) {
                const kcritEl = document.getElementById('dash-c-kcrit');
                kcritEl.innerText = c.kcritC.toFixed(2);
                kcritEl.className = `font-black ${c.kcritC < 1 ? 'text-red-500' : 'text-green-600'}`;
            }
            if(document.getElementById('dash-c-b3')) document.getElementById('dash-c-b3').innerText = c.n_изделий_с_B3;
        }
    }
    
    // Обновляем заголовок чек-листа в шапке
    const selectEl = document.getElementById('checklist-selector');
    const clName = selectEl?.options[selectEl.selectedIndex]?.text.replace('▼', '').trim() || 'Вид работ не выбран';
    const labelEl = document.getElementById('current-checklist-label');
    if(labelEl) labelEl.innerText = clName;

    updateGroupCounters();
}

// === СОХРАНЕНИЕ / ОЧИСТКА ===
function saveProductToArray() {
    // --- ПРОВЕРКА ЗАПОЛНЕННОСТИ ПОЛЕЙ (Валидация) ---
    const fields = ['inp-project', 'inp-inspector', 'inp-contractor', 'inp-location'];
    let hasError = false;
    
    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.value.trim()) {
            el.classList.add('border-red-500', 'bg-red-50');
            setTimeout(() => el.classList.remove('border-red-500', 'bg-red-50'), 3000);
            hasError = true;
        }
    });

    if (hasError) {
        showToast('⚠️ Заполните все поля объекта в шапке!');
        toggleDataBlock(true); // Принудительно открываем шапку
        window.scrollTo({ top: 0, behavior: 'smooth' }); // Скроллим наверх
        return;
    }

    // --- НОВАЯ ЛОГИКА (ШАГ 1): ПОЭТАПНОЕ СОХРАНЕНИЕ ---
    let savedStagesCount = 0;

    // Проходим по всем группам (этапам) текущего чек-листа
    currentChecklist.forEach((group, gIndex) => {
        // Контейнеры для данных конкретно этого этапа
        let stageState = {};
        let stageDetails = {};
        let stagePhotos = {};
        let hasAnswers = false;

        // Перебираем пункты только текущей группы
        group.items.forEach(item => {
            if (state[item.id]) {
                stageState[item.id] = state[item.id];
                if (details[item.id]) stageDetails[item.id] = details[item.id];
                if (photos[item.id]) stagePhotos[item.id] = photos[item.id];
                hasAnswers = true;
            }
        });

        // Если в этом этапе инженер ответил хотя бы на 1 пункт - сохраняем этап отдельно
        if (hasAnswers) {
            // Считаем метрики локально только для этого этапа
            const stageMetrics = getProductMetrics(stageState, [group]);

            const newItem = { 
                id: Date.now() + Math.floor(Math.random() * 1000) + gIndex, // Уникальный ID (добавляем индекс, чтобы ID были разными при быстром сохранении)
                date: new Date().toISOString(), 
                projectName: document.getElementById('inp-project').value.trim(), 
                inspectorName: document.getElementById('inp-inspector').value.trim(), 
                contractorName: document.getElementById('inp-contractor').value.trim(),
                templateKey: currentTemplateKey, 
                templateTitle: document.getElementById('checklist-selector').options[document.getElementById('checklist-selector').selectedIndex].text,
                location: document.getElementById('inp-location').value.trim(), 
                
                // НОВЫЕ ПОЛЯ АРХИТЕКТУРЫ
                stageId: gIndex,
                stageName: group.group || group.title,
                isCompleted: false, // Флаг полного завершения изделия (будет меняться позже)
                
                // ДАННЫЕ ЭТАПА
                state: JSON.parse(JSON.stringify(stageState)), 
                details: JSON.parse(JSON.stringify(stageDetails)), 
                photos: JSON.parse(JSON.stringify(stagePhotos)), 
                metrics: stageMetrics 
            };

            contractorArray.push(newItem);
            dbPut(STORES.HISTORY, newItem); // Пишем в IndexedDB
            savedStagesCount++;
        }
    });

    if (savedStagesCount === 0) {
        return showToast('Чек-лист пуст. Заполните данные хотя бы одного этапа.');
    }
    
    // Очищаем форму, НО не трогаем Локацию (инженер может продолжить проверять этот же объект)
    state = {}; details = {}; photos = {}; 
    scheduleSessionSave(); 
    
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast(`✅ Сохранено этапов: ${savedStagesCount}`);
    render(); updateUI();
}

function resetChecklist() {
    if(!confirm('Очистить только текущий чек-лист?')) return;
    state = {}; details = {}; photos = {}; document.getElementById('inp-location').value = ''; 
    saveSessionData(); render(); updateUI();
}

async function clearHistory() {
    if(!confirm('Удалить всю историю проверок?')) return;
    contractorArray = []; await dbClear(STORES.HISTORY); renderHistoryTab();
}

async function fullFactoryReset() {
    if(!confirm('УДАЛИТЬ ВООБЩЕ ВСЁ? Это действие необратимо!')) return;
    await dbClear(STORES.HISTORY);
    await dbClear(STORES.STATE);
    await dbClear(STORES.SETTINGS);
    await dbClear(STORES.TEMPLATES);
    localStorage.clear();
    location.reload();
}

// === АНАЛИТИКА И ОТЧЕТЫ ===
function updateAnalyticsFilters() {
    const selectC = document.getElementById('analytics-contractor-select');
    if(!selectC) return;
    const uniqueCs = [...new Set(contractorArray.map(i => i.contractorName).filter(Boolean))];
    selectC.innerHTML = `<option value="ALL">Все подрядчики</option>` + uniqueCs.map(c => `<option value="${c}">${c}</option>`).join('');
}

function renderAnalyticsTab() {
    const container = document.getElementById('analytics-contractors-container');
    if(!container) return;
    for (const key in chartInstances) { if (chartInstances[key]) chartInstances[key].destroy(); }
    chartInstances = {};

    if (contractorArray.length === 0) {
        container.innerHTML = `<p class="text-center py-6 text-slate-500 text-sm">Нет данных для аналитики.</p>`; return;
    }

    let baseArray = contractorArray;
    const fContr = document.getElementById('analytics-contractor-select')?.value || 'ALL';
    if(fContr !== "ALL") baseArray = baseArray.filter(i => i.contractorName === fContr);

    if (baseArray.length === 0) {
        container.innerHTML = `<p class="text-center py-6 text-slate-500 text-sm">По выбранным фильтрам нет данных.</p>`; return;
    }

    // Сокращенная версия генерации дашборда для совместимости с v15 (графики и эксперт)
    let sumUrk = 0; baseArray.forEach(i => sumUrk += i.metrics.final);
    const avgUrk = Math.round(sumUrk / baseArray.length);

    let html = `
    <div class="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 mb-6">
        <div class="text-[10px] text-slate-400 font-bold uppercase mb-2">Общая сводка</div>
        <div class="flex justify-between items-center mb-4">
            <div>Средний УрК: <b class="text-2xl">${avgUrk}%</b></div>
            <div>Проверок: <b>${baseArray.length}</b></div>
        </div>
    </div>`;

    // Генерация карточек по подрядчикам
    const uniqueCs = [...new Set(baseArray.map(i => i.contractorName))];
    uniqueCs.forEach(cName => {
        const cData = baseArray.filter(i => i.contractorName === cName);
        const uniqueTs = [...new Set(cData.map(i => i.templateKey))];
        
        uniqueTs.forEach(tKey => {
            const tData = cData.filter(i => i.templateKey === tKey);
            const tmplTitle = tData[0].templateTitle;
            const safeId = cName.replace(/\W/g, '_') + '_' + tKey;
            
            let expHtml = "";
            if (tData.length >= 7) {
                const metrics = getContractorMetrics(tData, userTemplates);
                const expert = getExpertConclusion(metrics, cName, tmplTitle, tData.length, safeId, customExpertConclusions);
                expHtml = expert.uiHtml;
            } else {
                expHtml = `<div class="bg-yellow-50 text-yellow-800 p-3 rounded-lg text-[10px] mt-4 mb-4">Собрано ${tData.length} изд. Для расчета УрК нужно минимум 7.</div>`;
            }

            html += `
            <div class="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 mb-6">
                <div class="font-black text-sm uppercase mb-1">${cName}</div>
                <div class="text-[10px] text-slate-500 mb-2 border-b pb-2">${tmplTitle}</div>
                ${expHtml}
            </div>`;
        });
    });

    container.innerHTML = html;
}

// === ИМПОРТ И ЭКСПОРТ ДАННЫХ (v16.0) ===
function handleDataExport(type) {
    if (type === 'json') {
        const data = JSON.stringify(contractorArray);
        downloadFile(data, `rbi_backup_${new Date().toLocaleDateString()}.json`, 'application/json');
    } else if (type === 'csv') {
        const csv = exportToCSV(contractorArray);
        if(csv) downloadFile(csv, `rbi_report_${new Date().toLocaleDateString()}.csv`, 'text/csv');
        else showToast('Нет данных для выгрузки');
    }
}

function triggerDataImport() { document.getElementById('db-import-input').click(); }

function processDataImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!Array.isArray(data)) throw new Error("Неверный формат бэкапа");
            
            for(const item of data) {
                // Если нет такого ID, добавляем
                if(!contractorArray.find(x => x.id === item.id)) {
                    contractorArray.push(item);
                    await dbPut(STORES.HISTORY, item);
                }
            }
            showToast('База успешно объединена!');
            if (document.getElementById('tab-history').classList.contains('active')) renderHistoryTab();
        } catch (err) { alert("Ошибка файла бэкапа."); }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// === ФОТО И КОММЕНТАРИИ (СОВМЕСТИМОСТЬ v15) ===
// === ФОТО И КОММЕНТАРИИ (С ПРИЧИНАМИ ДЕФЕКТОВ) ===
const DEFECT_CAUSES = [
    { code: 'C01', name: 'Нарушение технологии (ППР)', group: 'Технология' },
    { code: 'C02', name: 'Отклонение от проекта/РД', group: 'Проект' },
    { code: 'C03', name: 'Некачественный материал', group: 'Материалы' },
    { code: 'C04', name: 'Низкая квалификация рабочих', group: 'Персонал' },
    { code: 'C05', name: 'Отсутствие контроля (ИТР)', group: 'Организация' },
    { code: 'C06', name: 'Спешка / Нарушение сроков', group: 'Организация' },
    { code: 'C07', name: 'Погодные условия', group: 'Внешние факторы' },
    { code: 'C00', name: 'Иное (указать в комментарии)', group: 'Другое' }
];

let currentCommentId = null;

function toggleCommentField(id) {
    currentCommentId = id;
    const select = document.getElementById('modal-cause-select');
    const textarea = document.getElementById('modal-cause-comment');
    
    // Заполняем селектор причин один раз
    if(select.options.length === 0) {
        let html = '<option value="">Не выбрано (Без причины)</option>';
        DEFECT_CAUSES.forEach(c => html += `<option value="${c.code}">${c.name}</option>`);
        select.innerHTML = html;
    }
    
    const currentData = details[id] || {};
    select.value = currentData.causeCode || '';
    
    // Если комментарий содержит причину в скобках [Причина], вырезаем её для чистого отображения в textarea
    let pureComment = currentData.comment || '';
    if(pureComment.startsWith('[')) {
        pureComment = pureComment.replace(/^\[.*?\]\s*/, '');
    }
    textarea.value = pureComment;
    
    document.getElementById('comment-modal-overlay').style.display = 'flex';
    document.body.classList.add('modal-open');
}

function closeCommentModal() {
    document.getElementById('comment-modal-overlay').style.display = 'none';
    document.body.classList.remove('modal-open');
    currentCommentId = null;
}

function saveCommentModal() {
    if(!currentCommentId) return;
    const code = document.getElementById('modal-cause-select').value;
    const text = document.getElementById('modal-cause-comment').value.trim();
    
    details[currentCommentId] = details[currentCommentId] || {};
    details[currentCommentId].causeCode = code;
    
    let causeName = code ? DEFECT_CAUSES.find(c => c.code === code)?.name : '';
    // Формируем красивый итоговый комментарий для карточки
    let finalComment = text;
    if(causeName) {
        finalComment = text ? `[${causeName}] ${text}` : `[${causeName}]`;
    }
    
    details[currentCommentId].comment = finalComment;
    
    updateCardDOM(currentCommentId);
    saveSessionData();
    closeCommentModal();
}

function deleteComment(id, e) {
    if(e) e.stopPropagation();
    if(details[id]) {
        details[id].comment = "";
        details[id].causeCode = "";
    }
    updateCardDOM(id); saveSessionData();
}

function triggerPhotoInput(id) {
    currentPhotoId = id;
    document.getElementById('photo-input').click();
}
function removePhoto(id, e) {
    if(e) e.stopPropagation();
    if(!confirm('Удалить фото?')) return;
    delete photos[id];
    updateCardDOM(id); saveSessionData();
}

// Обработка загрузки фото (Конвертация в сжатый формат для экономии IndexedDB)
function handlePhotoUpload(event) {
    const file = event.target.files[0];
    if (!file || !currentPhotoId) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.getElementById('photo-canvas') || document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            const MAX_WIDTH = 800; const MAX_HEIGHT = 800;
            let width = img.width; let height = img.height;

            if (width > height) { if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } } 
            else { if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; } }

            canvas.width = width; canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            
            // --- НАЛОЖЕНИЕ ДАТЫ И ВРЕМЕНИ ---
            const now = new Date();
            const timestamp = now.toLocaleDateString('ru-RU') + ' ' + now.toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'});
            
            ctx.fillStyle = 'rgba(0,0,0,0.6)'; 
            ctx.fillRect(10, height - 30, 140, 24);
            ctx.font = '14px Arial'; 
            ctx.fillStyle = 'white'; 
            ctx.fillText(timestamp, 16, height - 13);

            photos[currentPhotoId] = canvas.toDataURL('image/jpeg', 0.6);
            showToast("📸 Фото добавлено");
            
            updateCardDOM(currentPhotoId); 
            scheduleSessionSave();
        }
        img.src = e.target.result;
    }
    reader.readAsDataURL(file);
    event.target.value = ''; 
}

function openPhotoViewer(src) {
    // Открытие модалки с фото (как в v15)
    // Разметка будет в HTML
    const viewer = document.getElementById('photo-viewer-overlay');
    const img = document.getElementById('photo-viewer-img');
    if(viewer && img) {
        img.src = src; viewer.style.display = 'flex';
    }
}
/* Файл: js/app.js (БЛОК 3: Демо-режим, Справки, Модалки расчетов) */

// === ДЕМО-РЕЖИМ (С ИСПРАВЛЕННЫМИ ШАБЛОНАМИ) ===
function startDemoMode() {
    realState = JSON.parse(JSON.stringify(state));
    realDetails = JSON.parse(JSON.stringify(details));
    realPhotos = JSON.parse(JSON.stringify(photos));
    realContractorArray = JSON.parse(JSON.stringify(contractorArray));
    realTemplateKey = currentTemplateKey;

    isDemoMode = true;
    document.body.classList.add('demo-mode');
    
    // Генерируем фейковую базу (она уже исправлена нами в Шаге 2)
    contractorArray = generateDemoHistory();

    document.getElementById('inp-project').value = 'ЖК "Демонстрационный"';
    document.getElementById('inp-inspector').value = 'Иванов И.И. (Демо)';
    document.getElementById('inp-contractor').value = 'ООО "Монолит-Строй"';
    document.getElementById('inp-location').value = 'Секция 2, Пилон П-10';

    // Включаем РЕАЛЬНЫЙ системный шаблон "Арматурные работы"
    currentTemplateKey = 'sys_armature';
    if(document.getElementById('checklist-selector')) document.getElementById('checklist-selector').value = currentTemplateKey;
    currentChecklist = SYSTEM_TEMPLATES['armature'].groups;
    
    // Имитируем заполнение чек-листа реальными ID из шаблона armature
    state = {}; details = {}; photos = {};
    
    // 201 - Документация (Этап 1)
    state['201'] = 'ok';
    // 204 - Отклонение шага (B2) (Этап 2)
    state['204'] = 'fail'; 
    details['204'] = { causeCode: 'C04', comment: '[Персонал] Отклонение превышает допуск на 5мм' };
    // 210 - Защитный слой (Критический B3 через эскалацию) (Этап 2)
    state['210'] = 'fail_escalated'; 
    details['210'] = { causeCode: 'C01', comment: '[Технология] Жесткое нарушение, арматура торчит' };

    updateDataSummary();
    document.getElementById('empty-checklist-state').style.display = 'none';
    document.getElementById('audit-items').style.display = 'block';
    document.getElementById('audit-actions').style.display = 'grid';
    
    render(); updateUI();
    // НОВОЕ: Принудительно рендерим остальные вкладки, чтобы данные появились сразу
    renderHistoryTab(); 
    renderCurrentAnalyticsTab(); 
    
    showToast('🎮 Демо-режим активирован!');
    toggleDataBlock(true); 
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function exitDemoMode() {
    // Восстанавливаем реальные данные
    state = JSON.parse(JSON.stringify(realState));
    details = JSON.parse(JSON.stringify(realDetails));
    photos = JSON.parse(JSON.stringify(realPhotos));
    contractorArray = JSON.parse(JSON.stringify(realContractorArray));
    
    isDemoMode = false;
    document.body.classList.remove('demo-mode');
    
    document.getElementById('inp-project').value = '';
    document.getElementById('inp-inspector').value = '';
    document.getElementById('inp-contractor').value = '';
    document.getElementById('inp-location').value = '';
    
    if (realTemplateKey) {
        changeTemplate(realTemplateKey);
    } else {
        currentTemplateKey = '';
        if(document.getElementById('checklist-selector')) document.getElementById('checklist-selector').value = '';
        document.getElementById('empty-checklist-state').style.display = 'block';
        document.getElementById('audit-items').style.display = 'none';
        document.getElementById('audit-actions').style.display = 'none';
    }

    switchTab('tab-audit');
    updateDataSummary();
    render(); updateUI();
    showToast('Возврат к реальным данным');
}

function generateDemoHistory() {
    let mockArray = [];
    const now = new Date();
    
    const demoPhoto = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'><rect width='400' height='300' fill='%23f1f5f9'/><path d='M150 100 L250 100 L200 200 Z' fill='%23cbd5e1'/><circle cx='200' cy='80' r='20' fill='%23fbbf24'/><text x='200' y='250' font-family='Arial' font-size='20' font-weight='bold' fill='%23475569' text-anchor='middle'>ФОТО НАРУШЕНИЯ</text></svg>";

    const createStageRecord = (id, daysAgo, contr, tmplKey, tmplTitle, loc, stageId, stageName, states, detailsData, photoData, metricsData) => {
        let d = new Date(now); d.setDate(now.getDate() - daysAgo);
        return {
            id, date: d.toISOString(), projectName: 'ЖК "Демонстрационный"', inspectorName: 'Иванов И.И.',
            contractorName: contr, templateKey: tmplKey, templateTitle: tmplTitle, location: loc,
            stageId, stageName, isCompleted: true,
            state: states, details: detailsData, photos: photoData, metrics: metricsData
        };
    };

    const mockMetrics = (f, b1, b2, b3) => ({
        final: f, baseUrkPerc: f+5, checkedCount: 5, totalCount: 5, n_B1_fail: b1, n_B2_fail: b2, n_B3_fail: b3, b3_found: b3>0, 
        kc: b2>2?0.85:1.0, kcrit: b3>0?0.5:1.0, isDanger: b3>0
    });

    // --- Подрядчик 1: Топовый ---
    for(let i=0; i<8; i++) {
        // Изделие i. Состоит из двух этапов
        mockArray.push(createStageRecord(1000+i*2, i*2, 'ООО "Альфа-Отделка"', 'sys_nvf_facade', 'Вент. фасад', `Секция 1, Ось ${i+1}`, 
            0, "1. Документация", {'101':'ok', '102':'ok'}, {}, {}, mockMetrics(100,0,0,0)));
            
        let hasDefect = i === 3;
        mockArray.push(createStageRecord(1001+i*2, i*2, 'ООО "Альфа-Отделка"', 'sys_nvf_facade', 'Вент. фасад', `Секция 1, Ось ${i+1}`, 
            1, "2. Подготовка", {'106':hasDefect?'fail':'ok', '107':'ok'}, 
            hasDefect ? {'106': {causeCode: 'C06', comment: '[Спешка] Не убрали пыль'}} : {}, {}, 
            mockMetrics(hasDefect?80:100, 0, hasDefect?1:0, 0)));
    }

    // --- Подрядчик 2: Средний с косяками ---
    for(let i=0; i<7; i++) {
        let hasDefect = (i % 2 === 0);
        mockArray.push(createStageRecord(2000+i*2, i*3, 'ООО "Монолит-Строй"', 'sys_armature', 'Арматура', `Пилон П-${i+1}`, 
            0, "1. Документация", {'201':'ok'}, {}, {}, mockMetrics(100,0,0,0)));
            
        mockArray.push(createStageRecord(2001+i*2, i*3, 'ООО "Монолит-Строй"', 'sys_armature', 'Арматура', `Пилон П-${i+1}`, 
            1, "2. Монтаж", {'204':hasDefect?'fail':'ok', '206':'ok', '210':'ok'}, 
            hasDefect ? {'204': {causeCode: 'C04', comment: '[Персонал] Шаг арматуры нарушен'}} : {}, 
            hasDefect ? {'204': demoPhoto} : {}, 
            mockMetrics(hasDefect?76:100, 1, hasDefect?2:0, 0)));
    }

    // --- Подрядчик 3: Плохой (С дефектами B3) ---
    for(let i=0; i<9; i++) {
        let hasB3 = i === 2 || i === 5 || i === 7; 
        mockArray.push(createStageRecord(3000+i*2, i, 'ИП Петров (Вентблоки)', 'sys_vent_stairs', 'Вент. блоки', `Секция 3, Эт ${i+1}`, 
            1, "2. Вент. блоки", {'305':'fail', '310':hasB3?'fail_escalated':'ok'}, 
            hasB3 ? {'310': {causeCode: 'C03', comment: '[Материалы] Трещины >0.2мм'}} : {'305': {causeCode: 'C01', comment: '[Технология] Смещение'}}, 
            hasB3 ? {'310': demoPhoto} : {}, 
            mockMetrics(hasB3?45:82, 0, 1, hasB3?1:0)));
    }

    return mockArray;
}

// === ПОДСКАЗКИ СПРАВКИ (v15) ===
function showHelp(type) {
    const modal = document.getElementById('modal-overlay');
    const title = document.getElementById('modal-title');
    const body = document.getElementById('modal-body');
    document.getElementById('modal-icon').innerHTML = ``;

    if (type === 'contractor') {
        title.innerText = "Краткая инфо-справка об УрК";
        body.innerHTML = `
        <div class="space-y-3 text-sm leading-6">
            <div class="rounded-2xl border border-sky-200 bg-sky-50 dark:bg-sky-900/20 dark:border-sky-800 p-4">
                <div class="flex items-center gap-2 mb-2"><div class="h-2.5 w-2.5 rounded-full bg-sky-500"></div><p class="font-semibold text-sky-900 dark:text-sky-300">Что считает система</p></div>
                <div class="space-y-2 text-sky-900 dark:text-sky-400">
                    <p><b>УрК изделия</b> — качество конкретного узла или участка работ.</p>
                    <p><b>УрК подрядчика</b> — качество подрядчика по массиву однотипных проверок.</p>
                    <p class="text-sky-800 dark:text-sky-200"><b>Чем выше процент, тем выше качество.</b></p>
                </div>
            </div>
            <div class="rounded-2xl border border-violet-200 bg-violet-50 dark:bg-violet-900/20 dark:border-violet-800 p-4">
                <div class="flex items-center gap-2 mb-2"><div class="h-2.5 w-2.5 rounded-full bg-violet-500"></div><p class="font-semibold text-violet-900 dark:text-violet-300">Категории дефектов</p></div>
                <div class="grid grid-cols-1 gap-2 text-violet-900 dark:text-violet-400">
                    <div class="rounded-xl border border-violet-100 dark:border-violet-800 bg-white/80 dark:bg-slate-800 p-3"><b>B1</b> — незначительный дефект</div>
                    <div class="rounded-xl border border-violet-100 dark:border-violet-800 bg-white/80 dark:bg-slate-800 p-3"><b>B2</b> — значительный дефект</div>
                    <div class="rounded-xl border border-violet-100 dark:border-violet-800 bg-white/80 dark:bg-slate-800 p-3"><b>B3</b> — критический дефект</div>
                </div>
                <div class="mt-3 rounded-xl border border-violet-200 dark:border-violet-800 bg-white/80 dark:bg-slate-800 p-3 text-violet-800 dark:text-violet-300">
                    <p class="font-medium mb-1">Правило 1.5</p><p>Если дефект относится к <b>B2</b>, но отклонение превышает допустимое более чем в <b>1.5 раза</b>, он переводится в <b>B3</b>.</p>
                </div>
            </div>
            <div class="rounded-2xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 p-4">
                <div class="flex items-center gap-2 mb-2"><div class="h-2.5 w-2.5 rounded-full bg-emerald-500"></div><p class="font-semibold text-emerald-900 dark:text-emerald-300">УрК изделия</p></div>
                <div class="space-y-3 text-emerald-900 dark:text-emerald-400">
                    <p>Считается базовый процент качества, затем применяются штрафы за концентрацию дефектов и за критичность.</p>
                    <code class="inline-block rounded-lg border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-800 px-2 py-1 text-xs">УрК = Базовый УрК × Kc × Kcrit</code>
                </div>
            </div>
            <div class="rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-4">
                <div class="flex items-center gap-2 mb-2"><div class="h-2.5 w-2.5 rounded-full bg-amber-500"></div><p class="font-semibold text-amber-900 dark:text-amber-300">Ключевые правила</p></div>
                <div class="space-y-2">
                    <div class="rounded-xl border border-amber-200 dark:border-amber-800 bg-white/80 dark:bg-slate-800 p-3 text-amber-900 dark:text-amber-400">Если есть <b>B2</b> или штрафы, итог <b>не выше 84%</b>.</div>
                    <div class="rounded-xl border border-amber-200 dark:border-amber-800 bg-white/80 dark:bg-slate-800 p-3 text-amber-900 dark:text-amber-400">Если есть <b>B3</b>, изделие считается <b>непринятым</b>.</div>
                </div>
            </div>
        </div>`;
    } else if (type === 'analytics' || type === 'rating') {
        title.innerText = "Справка по Аналитике";
        body.innerHTML = `<div class="space-y-3 text-sm leading-relaxed">
            <p>В этом разделе отображается статистика на основе сохраненных проверок.</p>
            <ul class="list-disc pl-4 space-y-2 text-xs">
                <li><b>Рейтинг</b> строится только если подрядчик имеет <b>минимум 7 проверок</b> по одному виду работ.</li>
                <li>Учитывается не только балл, но и стабильность качества (волатильность).</li>
                <li>Вы можете выгрузить графики и отчеты в PDF для отправки руководству.</li>
            </ul>
        </div>`;
    }

    document.body.classList.add('modal-open'); 
    modal.style.display = 'flex';
}

// === МОДАЛКИ РАСЧЕТОВ (По клику на мини-дашборд) ===
// Назначаем клики на мини-дашборд
document.addEventListener("DOMContentLoaded", () => {
    const pCard = document.getElementById('mini-p-bar')?.parentElement;
    const cCard = document.getElementById('mini-c-urk')?.parentElement;
    
    if(pCard) pCard.addEventListener('click', showProductMath);
    if(cCard) cCard.addEventListener('click', showContractorDetails);
});

function showProductMath() {
    if(!currentTemplateKey) return;
    const p = getProductMetrics(state, currentChecklist);
    const modal = document.getElementById('modal-overlay');
    const title = document.getElementById('modal-title');
    const body = document.getElementById('modal-body');
    
    document.getElementById('modal-icon').innerHTML = `<div class="w-14 h-14 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center font-black text-2xl">∑</div>`;
    title.innerText = "Расчет УрК Изделия";
    
    if (!p) {
        body.innerHTML = "<p>Заполните хотя бы один пункт для отображения оценки.</p>";
    } else {
        body.innerHTML = `
        <div class="bg-[var(--hover-bg)] p-4 rounded-xl border border-[var(--card-border)] mb-4">
            <div class="text-[10px] uppercase font-bold text-[var(--text-muted)] mb-2">Формула</div>
            <div class="text-sm font-black font-mono bg-[var(--card-bg)] p-2 rounded border border-[var(--card-border)] text-center">УрК = База × Kc × Kcrit</div>
            <div class="text-center mt-2 text-2xl font-black text-blue-600">${p.final}%</div>
        </div>
        <ul class="text-sm space-y-3 mb-4">
            <li class="flex justify-between items-center border-b border-[var(--card-border)] pb-2">
                <span><b>Базовый балл</b><br><span class="text-[10px] text-[var(--text-muted)]">Доля пройденных проверок</span></span>
                <span class="font-black text-lg">${p.baseUrkPerc}%</span>
            </li>
            <li class="flex justify-between items-center border-b border-[var(--card-border)] pb-2">
                <span><b>Концентрация (Kc)</b><br><span class="text-[10px] text-[var(--text-muted)]">Штраф за множественные B2</span></span>
                <span class="font-black text-lg ${p.kc < 1 ? 'text-red-500' : 'text-green-600'}">${p.kc.toFixed(2)}</span>
            </li>
            <li class="flex justify-between items-center border-b border-[var(--card-border)] pb-2">
                <span><b>Критичность (Kcrit)</b><br><span class="text-[10px] text-[var(--text-muted)]">Штраф за наличие B3</span></span>
                <span class="font-black text-lg ${p.kcrit < 1 ? 'text-red-500' : 'text-green-600'}">${p.kcrit.toFixed(2)}</span>
            </li>
        </ul>
        <div class="text-[11px] font-bold bg-slate-100 dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm leading-relaxed">
            <b>Правило потолка (Cap84):</b> Если допущен B2 или применены штрафы, итоговый балл не может превышать 84%.
        </div>`;
    }
    document.body.classList.add('modal-open'); modal.style.display = 'flex';
}

function showContractorDetails() {
    if(!currentTemplateKey) return;
    const currentContr = document.getElementById('inp-contractor').value.trim();
    const filteredArr = currentContr ? contractorArray.filter(i => i.contractorName === currentContr && i.templateKey === currentTemplateKey) : [];
    
    const modal = document.getElementById('modal-overlay');
    document.getElementById('modal-icon').innerHTML = `<div class="w-14 h-14 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center font-black text-2xl">M</div>`;
    document.getElementById('modal-title').innerText = currentContr ? `Аналитика: ${currentContr}` : "Аналитика подрядчика";
    const body = document.getElementById('modal-body');

    if (filteredArr.length < 7) {
        body.innerHTML = `<p class="bg-yellow-50 text-yellow-800 p-4 rounded-xl border border-yellow-200 font-bold leading-snug">Собрано: <b class="text-lg">${filteredArr.length}</b> изд.<br><br>Для расчета УрК Подрядчика требуется минимум <b>7</b> проверок.</p>`;
    } else {
        const c = getContractorMetrics(filteredArr, userTemplates);
        body.innerHTML = `
            <div class="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl border border-indigo-200 dark:border-indigo-800 mb-5 shadow-sm">
                <div class="text-[10px] uppercase font-bold text-indigo-500 mb-2">Формула УрК Подрядчика</div>
                <div class="text-[11px] font-black text-indigo-900 dark:text-indigo-300 font-mono bg-white dark:bg-slate-800 p-2 rounded border border-indigo-100 dark:border-slate-700 text-center shadow-inner">УрК = База × Ks × Kcrit</div>
                <div class="flex items-center justify-between mt-3 border-t border-indigo-100 dark:border-indigo-800 pt-3">
                    <div class="text-4xl font-black text-indigo-700 dark:text-indigo-400">${c.finalC}%</div>
                    <div class="text-right">
                        <span class="${c.confCls} block mb-1 w-fit ml-auto">${c.confStatus}</span>
                        <span class="text-[10px] font-bold text-indigo-800 bg-indigo-100 px-2 py-1 rounded uppercase block w-fit ml-auto">${c.statusTxt}</span>
                    </div>
                </div>
            </div>
            <ul class="text-[13px] space-y-3 mb-5">
                <li class="flex justify-between items-center border-b border-[var(--card-border)] pb-2">
                    <span class="leading-snug"><b>Системный брак (Ks)</b><br><span class="text-[10px] text-[var(--text-muted)] mt-0.5">Повтор дефекта в ${c.maxFailRate.toFixed(1)}%</span></span>
                    <span class="font-black text-lg ${c.ks < 1 ? 'text-red-500' : 'text-green-600'}">${c.ks.toFixed(2)}</span>
                </li>
                <li class="flex justify-between items-center border-b border-[var(--card-border)] pb-2">
                    <span class="leading-snug"><b>Критичность (Kcrit)</b><br><span class="text-[10px] text-[var(--text-muted)] mt-0.5">Доля изделий с B3: ${c.rateB3.toFixed(1)}%</span></span>
                    <span class="font-black text-lg ${c.kcritC < 1 ? 'text-red-500' : 'text-green-600'}">${c.kcritC.toFixed(2)}</span>
                </li>
            </ul>
            <div class="text-[11px] font-bold text-red-700 mt-2 bg-red-50 p-3 rounded-xl border border-red-200 shadow-sm leading-snug">
                <span class="uppercase text-[9px] block mb-1 text-red-400">Основание</span>${c.reason}
            </div>`;
    }
    document.body.classList.add('modal-open'); modal.style.display = 'flex';
}
/* Файл: js/app.js (БЛОК 4: Полная Аналитика, Chart.js, Рейтинг, PDF) */
// === FAB-КНОПКА СКАЧАТЬ ===
function updateFabButton(tabId) {
    const fab = document.getElementById('fab-download-btn');
    if (!fab) return;
    if (tabId === 'tab-analytics') {
        // Смотрим какая подвкладка сейчас активна
        const isRating = !document.getElementById('sub-rating')?.classList.contains('hidden');
        fab.classList.remove('hidden');
        fab.classList.add('fab-visible');
        fab.dataset.context = isRating ? 'rating' : 'pdf';
    } else {
        fab.classList.add('hidden');
        fab.classList.remove('fab-visible');
    }
}

function handleFabDownload() {
    const fab = document.getElementById('fab-download-btn');
    const ctx = fab?.dataset.context || 'pdf';
    if (ctx === 'rating') exportRatingPdf();
    else exportPdfReport();
}
// === ПЕРЕКЛЮЧАТЕЛЬ ПОДВКЛАДОК АНАЛИТИКИ ===
function switchAnalyticsSubTab(tabId, btnElement) {
    document.querySelectorAll('.analytics-sub-section').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.sub-tab-btn').forEach(el => {
        el.classList.remove('bg-white', 'shadow-sm', 'text-indigo-600', 'dark:bg-slate-700', 'dark:text-indigo-400');
        el.classList.add('text-[var(--text-muted)]');
    });
    document.getElementById(tabId).classList.remove('hidden');
    btnElement.classList.add('bg-white', 'shadow-sm', 'text-indigo-600', 'dark:bg-slate-700', 'dark:text-indigo-400');
    btnElement.classList.remove('text-[var(--text-muted)]');

    if (tabId === 'sub-charts') renderAnalyticsTab();
    if (tabId === 'sub-rating') renderRatingTab();

    // FAB: виден только на рейтинге и аналитике
    const fab = document.getElementById('fab-download-btn');
    if (fab) {
        const showFab = (tabId === 'sub-rating' || tabId === 'sub-charts');
        fab.style.display = showFab ? 'flex' : 'none';
        fab.dataset.context = (tabId === 'sub-rating') ? 'rating' : 'pdf';
    }
}

// === АНАЛИТИКА И ОТЧЕТЫ (ПРО 4.0) ===

let currentActiveAnalyticsTab = 'sub-rating';

function updateAnalyticsFilters() {
    const selectC = document.getElementById('global-filter-contractor');
    const selectT = document.getElementById('global-filter-template');
    if(!selectC || !selectT) return;
    
    const uniqueCs = [...new Set(contractorArray.map(i => i.contractorName).filter(Boolean))];
    selectC.innerHTML = `<option value="ALL">Все подрядчики</option>` + uniqueCs.map(c => `<option value="${c}">${c}</option>`).join('');
    
    // Обновляем шаблоны из селектора на главной
    const tmplSelect = document.getElementById('checklist-selector');
    if(tmplSelect) {
        let opts = `<option value="ALL">Все виды работ</option>`;
        Array.from(tmplSelect.options).forEach(o => {
            if(o.value && o.value !== "HOME" && o.value !== "UPLOAD") opts += `<option value="${o.value}">${o.text}</option>`;
        });
        selectT.innerHTML = opts;
    }
}

function switchAnalyticsSubTab(tabId, btnElement) {
    currentActiveAnalyticsTab = tabId;
    document.querySelectorAll('.analytics-sub-section').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.sub-tab-btn').forEach(el => {
        el.classList.remove('bg-white', 'shadow-sm', 'text-indigo-600', 'dark:bg-slate-700', 'dark:text-indigo-400');
        el.classList.add('text-[var(--text-muted)]');
    });
    
    document.getElementById(tabId).classList.remove('hidden');
    if(btnElement) {
        btnElement.classList.add('bg-white', 'shadow-sm', 'text-indigo-600', 'dark:bg-slate-700', 'dark:text-indigo-400');
        btnElement.classList.remove('text-[var(--text-muted)]');
    }

    renderCurrentAnalyticsTab();
    
    const fab = document.getElementById('fab-download-btn');
    if (fab) {
        fab.style.display = 'flex';
        fab.dataset.context = tabId;
    }
}

// Фильтрация данных для всех вкладок аналитики
function getFilteredAnalyticsData() {
    const selPeriod = document.getElementById('global-filter-period')?.value || 'ALL';
    const selTmpl = document.getElementById('global-filter-template')?.value || 'ALL';
    const selContr = document.getElementById('global-filter-contractor')?.value || 'ALL';
    
    let arr = contractorArray;
    const now = new Date();
    
    if (selPeriod === 'DAY') arr = arr.filter(i => new Date(i.date).toDateString() === now.toDateString()); 
    else if (selPeriod === 'MONTH') { const m = new Date(); m.setDate(now.getDate()-30); arr = arr.filter(i => new Date(i.date) >= m); } 
    else if (selPeriod === 'WEEK') { const w = new Date(); w.setDate(now.getDate()-7); arr = arr.filter(i => new Date(i.date) >= w); }

    if(selContr !== "ALL") arr = arr.filter(i => i.contractorName === selContr);
    if(selTmpl !== "ALL") arr = arr.filter(i => i.templateKey === selTmpl);
    
    return arr;
}

function renderCurrentAnalyticsTab() {
    for (const key in chartInstances) { if (chartInstances[key]) chartInstances[key].destroy(); }
    chartInstances = {};

    const data = getFilteredAnalyticsData();
    
    if (currentActiveAnalyticsTab === 'sub-rating') renderRatingSubTab(data);
    else if (currentActiveAnalyticsTab === 'sub-engineering') renderEngineeringSubTab(data);
    else if (currentActiveAnalyticsTab === 'sub-onepager') renderOnePagerSubTab(data);
    else if (currentActiveAnalyticsTab === 'sub-data') renderDataSubTab(data);
}

// === ПОДВКЛАДКА 1: РЕЙТИНГ ПОДРЯДЧИКОВ ===
function renderRatingSubTab(data) {
    const container = document.getElementById('rating-content-container');
    if(data.length === 0) { container.innerHTML = `<div class="p-6 text-center text-slate-500 text-sm">Нет данных по фильтрам</div>`; return; }

    const grouped = {};
    data.forEach(item => { const cName = item.contractorName || 'Не указан'; if(!grouped[cName]) grouped[cName] = []; grouped[cName].push(item); });
    
    const ratingData = [];
    for(let cName in grouped) { const metrics = getContractorMetrics(grouped[cName], userTemplates); if (metrics) ratingData.push({ name: cName, metrics: metrics, raw: grouped[cName] }); }
    
    if (ratingData.length === 0) { container.innerHTML = '<p class="p-6 text-center text-slate-500 text-sm">Мало данных. Для расчета рейтинга нужно мин. 3 изделия.</p>'; return; }

    ratingData.sort((a,b) => b.metrics.finalC - a.metrics.finalC);

    const cLabels = ratingData.map(r => r.name.length > 12 ? r.name.substring(0,12)+'...' : r.name);
    const cData = ratingData.map(r => r.metrics.finalC);

    let html = `
        <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-3 mb-6 shadow-sm mx-1">
            <div class="text-[10px] font-bold text-[var(--text-muted)] uppercase mb-2 text-center">Сравнение Подрядчиков (УрК)</div>
            <div style="height: 180px; position: relative;"><canvas id="chart_rating_compare"></canvas></div>
        </div>
        <div class="mx-1">`;

    html += ratingData.map((r, index) => `
        <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 mb-3 shadow-sm relative overflow-hidden">
            <div class="flex items-start gap-3 border-b border-[var(--card-border)] pb-3 mb-3">
                <div class="w-8 h-8 rounded-lg flex items-center justify-center font-black text-lg shadow-md shrink-0 bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300">${index + 1}</div>
                <div class="flex-1 min-w-0">
                    <div class="text-[13px] font-black leading-tight truncate">${r.name}</div>
                    <span class="${r.metrics.confCls} mt-1 inline-block text-[9px]">${r.metrics.confStatus} (Изделий: ${r.metrics.count})</span>
                </div>
                <div class="text-right shrink-0">
                    <div class="text-3xl font-black leading-none ${r.metrics.finalC < 70 ? 'text-red-500' : (r.metrics.finalC < 85 ? 'text-orange-500' : 'text-green-600')}">${r.metrics.finalC}%</div>
                    <span class="${r.metrics.riskCls} text-[9px] uppercase block mt-1">${r.metrics.riskStatus}</span>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-2 text-[10px] font-bold mb-3">
                <div class="bg-[var(--hover-bg)] p-2 rounded border border-[var(--card-border)]"><span class="text-[var(--text-muted)] block mb-0.5">Системный брак (Ks):</span> <span class="${r.metrics.ks < 1 ? 'text-red-500' : 'text-green-600'} text-[12px]">${r.metrics.ks.toFixed(2)}</span> <span class="font-normal">(${r.metrics.maxFailRate.toFixed(1)}%)</span></div>
                <div class="bg-[var(--hover-bg)] p-2 rounded border border-[var(--card-border)]"><span class="text-[var(--text-muted)] block mb-0.5">Критичность (Kcrit):</span> <span class="${r.metrics.kcritC < 1 ? 'text-red-500' : 'text-green-600'} text-[12px]">${r.metrics.kcritC.toFixed(2)}</span> <span class="font-normal">(B3: ${r.metrics.n_изделий_с_B3} шт)</span></div>
                <div class="bg-[var(--hover-bg)] p-2 rounded border border-[var(--card-border)]"><span class="text-[var(--text-muted)] block mb-0.5">Индекс стабильности:</span> <span class="text-[12px]">${r.metrics.stabilityIndex} / 100</span></div>
                <div class="bg-[var(--hover-bg)] p-2 rounded border border-[var(--card-border)]"><span class="text-[var(--text-muted)] block mb-0.5">Волатильность (СКО):</span> <span class="text-[12px]">${r.metrics.volatility.toFixed(1)}</span></div>
            </div>
        </div>`).join('');
    
    html += `</div>`;
    container.innerHTML = html;

    const ctx = document.getElementById('chart_rating_compare').getContext('2d');
    chartInstances['chart_rating_compare'] = new Chart(ctx, {
        type: 'bar',
        data: { labels: cLabels, datasets: [{ data: cData, backgroundColor: cData.map(v => v<70?'#ef4444':(v<85?'#f59e0b':'#22c55e')), borderRadius: 4 }] },
        options: { animation: false, responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100 } }, plugins: { legend: { display: false } } }
    });
}

// === ПОДВКЛАДКА 2: ИНЖЕНЕРНЫЙ АНАЛИЗ ===
// === ПОДВКЛАДКА 2: ИНЖЕНЕРНЫЙ АНАЛИЗ (ОБНОВЛЕНО) ===
function renderEngineeringSubTab(data) {
    const container = document.getElementById('engineering-content-container');
    if(data.length === 0) { container.innerHTML = `<div class="p-6 text-center text-slate-500 text-sm">Нет данных по выбранным фильтрам</div>`; return; }

    const causesCount = {}; let totalB2B3 = 0;
    const stageData = {}; 
    const critList = [];
    const allPhotos = [];

    data.forEach(unit => {
        const sKey = `${unit.templateTitle} | ${unit.stageName}`;
        if(!stageData[sKey]) stageData[sKey] = { checks: 0, sumUrk: 0, b3Count: 0 };
        stageData[sKey].checks++;
        if(unit.metrics) {
            stageData[sKey].sumUrk += unit.metrics.final;
            stageData[sKey].b3Count += unit.metrics.n_B3_fail;
        }

        if(unit.state && unit.details) {
            Object.keys(unit.state).forEach(itemId => {
                const state = unit.state[itemId];
                if(state === 'fail' || state === 'fail_escalated') {
                    totalB2B3++;
                    let causeCode = unit.details[itemId]?.causeCode || 'C00';
                    causesCount[causeCode] = (causesCount[causeCode] || 0) + 1;
                    
                    if(state === 'fail_escalated' || (unit.metrics && unit.metrics.n_B3_fail > 0 && state==='fail')) {
                        critList.push({ loc: unit.location, stage: unit.stageName, date: unit.date, text: unit.details[itemId]?.comment });
                    }
                }
                if(unit.photos && unit.photos[itemId]) {
                    allPhotos.push({ src: unit.photos[itemId], loc: unit.location, stage: unit.stageName, date: unit.date });
                }
            });
        }
    });

    let stagesHtml = Object.keys(stageData).map(k => {
        const avg = Math.round(stageData[k].sumUrk / stageData[k].checks);
        return `<tr class="border-b border-[var(--card-border)] last:border-0"><td class="p-2 text-[10px] font-bold whitespace-normal">${k}</td><td class="p-2 text-center text-[11px]">${stageData[k].checks}</td><td class="p-2 text-center text-[11px] font-black ${avg<70?'text-red-500':(avg<85?'text-orange-500':'text-green-600')}">${avg}%</td><td class="p-2 text-center">${stageData[k].b3Count>0?'Да':'-'}</td></tr>`;
    }).join('');

    let causesChartLabels = []; let causesChartData = [];
    let causesHtml = Object.keys(causesCount).map(code => {
        const name = DEFECT_CAUSES.find(c => c.code === code)?.name || 'Иное';
        const perc = ((causesCount[code] / totalB2B3) * 100).toFixed(1);
        causesChartLabels.push(name.substring(0,10)+'.'); causesChartData.push(causesCount[code]);
        return `<div class="flex justify-between items-center text-[10px] mb-1 font-bold"><span class="truncate pr-2">${name}</span><span>${perc}% (${causesCount[code]})</span></div>`;
    }).join('');

    // --- УМНЫЕ КОММЕНТАРИИ (СТРОГИЙ СТИЛЬ) ---
    let smartComments = [];
    const b3Rate = critList.length;
    
    if(b3Rate > 0) {
        smartComments.push({
            type: 'critical',
            text: `Выявлено ${b3Rate} инцидентов с дефектами B3. Требуется приостановка работ на зафиксированных участках и вызов комиссии.`
        });
    } else {
        smartComments.push({
            type: 'success',
            text: `Критических нарушений (категории B3) в текущей выборке не зафиксировано.`
        });
    }

    if(causesChartData.length > 0) {
        const maxCauseIdx = causesChartData.indexOf(Math.max(...causesChartData));
        const dominantCause = causesChartLabels[maxCauseIdx];
        const domPerc = ((causesChartData[maxCauseIdx] / totalB2B3) * 100).toFixed(0);
        smartComments.push({
            type: 'warning',
            text: `Доминирующая причина брака — «${dominantCause}» (${domPerc}% от всех дефектов). Рекомендуется направить предписание для корректировки процесса.`
        });
    }

    let galleryHtml = allPhotos.length > 0 ? `<div class="grid grid-cols-2 md:grid-cols-4 gap-2">${allPhotos.slice(-8).reverse().map(p => `<div class="border border-[var(--card-border)] rounded-lg overflow-hidden relative" onclick="openPhotoViewer('${p.src}')"><img src="${p.src}" class="w-full h-24 object-cover" /><div class="absolute bottom-0 w-full bg-black/80 text-white text-[8px] p-1.5 font-bold leading-tight">${p.loc}<br><span class="text-slate-300 font-normal">${p.stage}</span></div></div>`).join('')}</div>` : `<p class="text-xs text-[var(--text-muted)] text-center py-4">Нет фотографий.</p>`;

    let html = `
        <div class="mx-1 space-y-4">
            
            <!-- Смарт-комментарии -->
            <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 shadow-sm">
                <div class="text-[10px] font-black text-slate-400 uppercase mb-3 flex items-center gap-1.5">
                    <svg class="w-3.5 h-3.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                    Аналитический срез
                </div>
                <div class="space-y-2">
                    ${smartComments.map(c => {
                        let borderCls = c.type === 'critical' ? 'border-red-500 bg-red-50 text-red-800' : (c.type === 'warning' ? 'border-orange-500 bg-orange-50 text-orange-800' : 'border-green-500 bg-green-50 text-green-800');
                        let darkBorderCls = c.type === 'critical' ? 'dark:bg-red-900/20 dark:text-red-300' : (c.type === 'warning' ? 'dark:bg-orange-900/20 dark:text-orange-300' : 'dark:bg-green-900/20 dark:text-green-300');
                        return `
                        <div class="border-l-4 ${borderCls} ${darkBorderCls} p-2.5 rounded-r text-[11px] font-bold leading-snug flex justify-between gap-2 items-start">
                            <span>${c.text}</span>
                            <button onclick="navigator.clipboard.writeText('${c.text}'); showToast('Текст скопирован');" class="text-[var(--text-muted)] hover:text-indigo-600 shrink-0 active:scale-90 transition-colors">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                            </button>
                        </div>`;
                    }).join('')}
                </div>
            </div>

            <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-3 shadow-sm">
                <div class="text-[10px] font-black text-[var(--text-muted)] uppercase mb-2">Сводка по этапам</div>
                <div class="overflow-x-auto">
                    <table class="w-full text-left whitespace-nowrap"><thead class="bg-[var(--hover-bg)] text-[10px] text-[var(--text-muted)] border-b border-[var(--card-border)]"><tr><th class="p-2">Этап</th><th class="p-2 text-center">Пров.</th><th class="p-2 text-center">УрК</th><th class="p-2 text-center">B3</th></tr></thead><tbody class="divide-y divide-[var(--card-border)]">${stagesHtml}</tbody></table>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-3 shadow-sm">
                    <div class="text-[10px] font-black text-[var(--text-muted)] uppercase mb-2">Причины дефектов</div>
                    <div style="height: 150px; position: relative; margin-bottom: 10px;"><canvas id="chart_eng_causes"></canvas></div>
                    ${causesHtml || '<div class="text-xs text-center text-slate-500">Нет дефектов</div>'}
                </div>
                <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-3 shadow-sm">
                    <div class="text-[10px] font-black text-red-500 uppercase mb-2 flex items-center gap-1">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                        Журнал B3
                    </div>
                    <div class="max-h-[200px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                        ${critList.length>0 ? critList.map(c => `<div class="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/50 p-2 rounded text-[10px]"><span class="font-black text-red-700 block">${c.loc}</span><span class="text-red-500 block mb-1">${c.stage}</span><span class="italic font-bold text-red-800 dark:text-red-300">Комментарий: ${c.text}</span></div>`).join('') : '<div class="text-[11px] text-green-600 font-bold text-center py-4">Критических отклонений нет.</div>'}
                    </div>
                </div>
            </div>

            <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-3 shadow-sm">
                <div class="text-[10px] font-black text-[var(--text-muted)] uppercase mb-2">Фотоотчет</div>
                ${galleryHtml}
            </div>
        </div>`;

    container.innerHTML = html;

    if(causesChartData.length > 0) {
        const ctx = document.getElementById('chart_eng_causes').getContext('2d');
        chartInstances['chart_eng_causes'] = new Chart(ctx, {
            type: 'bar', indexAxis: 'y',
            data: { labels: causesChartLabels, datasets: [{ data: causesChartData, backgroundColor: '#6366f1', borderRadius: 4 }] },
            options: { animation: false, responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }
}

// === ПОДВКЛАДКА 3: ONE-PAGER ДЛЯ РУКОВОДСТВА ===
function renderOnePagerSubTab(data) {
    const container = document.getElementById('onepager-content-container');
    if(data.length === 0) { container.innerHTML = `<div class="text-center text-slate-500 text-sm">Нет данных</div>`; return; }

    const uniqueLocs = [...new Set(data.map(i => i.location))];
    const uniqueContrs = [...new Set(data.map(i => i.contractorName))];
    
    let sumUrk = 0; let sumB3 = 0;
    data.forEach(i => { if(i.metrics) { sumUrk += i.metrics.final; sumB3 += i.metrics.n_B3_fail; } });
    const globalUrk = Math.round(sumUrk / data.length);
    
    const urkColor = globalUrk < 70 ? 'text-red-600' : (globalUrk < 85 ? 'text-orange-500' : 'text-green-600');
    
    // Динамика (группировка по дням)
    const trendMap = {};
    data.forEach(i => {
        const d = new Date(i.date).toLocaleDateString();
        if(!trendMap[d]) trendMap[d] = { sum: 0, count: 0 };
        trendMap[d].sum += i.metrics.final; trendMap[d].count++;
    });
    const trendLabels = Object.keys(trendMap).slice(-7); // Последние 7 дней активности
    const trendData = trendLabels.map(k => Math.round(trendMap[k].sum / trendMap[k].count));

    let html = `
        <div class="text-center border-b border-[var(--card-border)] pb-4 mb-4">
            <h2 class="text-lg font-black uppercase tracking-tight text-slate-800 dark:text-white">Сводный статус качества</h2>
            <div class="text-[10px] font-bold text-[var(--text-muted)]">${new Date().toLocaleDateString('ru-RU')} | Выборка: ${data.length} проверок</div>
        </div>
        
        <div class="grid grid-cols-2 gap-3 mb-6">
            <div class="bg-[var(--hover-bg)] rounded-xl p-3 border border-[var(--card-border)] text-center shadow-inner">
                <div class="text-[9px] uppercase font-bold text-[var(--text-muted)] mb-1">Глобальный УрК</div>
                <div class="text-3xl font-black ${urkColor}">${globalUrk}%</div>
            </div>
            <div class="bg-[var(--hover-bg)] rounded-xl p-3 border border-[var(--card-border)] text-center shadow-inner">
                <div class="text-[9px] uppercase font-bold text-[var(--text-muted)] mb-1">Критические дефекты</div>
                <div class="text-3xl font-black ${sumB3>0?'text-red-600':'text-green-600'}">${sumB3}</div>
            </div>
            <div class="bg-[var(--hover-bg)] rounded-xl p-3 border border-[var(--card-border)] text-center shadow-inner">
                <div class="text-[9px] uppercase font-bold text-[var(--text-muted)] mb-1">Осмотрено изделий</div>
                <div class="text-xl font-black text-slate-700 dark:text-slate-200 mt-1">${uniqueLocs.length}</div>
            </div>
            <div class="bg-[var(--hover-bg)] rounded-xl p-3 border border-[var(--card-border)] text-center shadow-inner">
                <div class="text-[9px] uppercase font-bold text-[var(--text-muted)] mb-1">Подрядчиков</div>
                <div class="text-xl font-black text-slate-700 dark:text-slate-200 mt-1">${uniqueContrs.length}</div>
            </div>
        </div>

        <div class="mb-6">
            <div class="text-[11px] font-black text-[var(--text-muted)] uppercase mb-2 pl-1">Тренд качества (последние осмотры)</div>
            <div style="height: 140px; position: relative;"><canvas id="chart_onepager_trend"></canvas></div>
        </div>

        <div class="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900 rounded-xl p-3">
            <div class="text-[11px] font-black text-red-600 uppercase mb-2 flex items-center gap-1"><span>🚨</span> Зоны риска</div>
            <ul class="text-[11px] font-bold text-red-800 dark:text-red-300 space-y-1 ml-4 list-disc marker:text-red-400">
                ${globalUrk < 85 ? `<li>Глобальный рейтинг объекта ниже нормы (Цель: >85%)</li>` : `<li>Глобальный рейтинг в норме</li>`}
                ${sumB3 > 0 ? `<li>Зафиксировано ${sumB3} инцидентов с дефектами категории B3.</li>` : `<li>Критических дефектов на объекте не зафиксировано.</li>`}
            </ul>
        </div>
    `;

    container.innerHTML = html;

    const ctx = document.getElementById('chart_onepager_trend').getContext('2d');
    chartInstances['chart_onepager_trend'] = new Chart(ctx, {
        type: 'line', 
        data: { labels: trendLabels, datasets: [{ data: trendData, borderColor: '#4f46e5', backgroundColor: 'rgba(79, 70, 229, 0.1)', fill: true, tension: 0.3, borderWidth: 2, pointRadius: 4 }] },
        options: { animation: false, responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100 } }, plugins: { legend: { display: false } } }
    });
}

// === ПОДВКЛАДКА 4: СЫРЫЕ ДАННЫЕ (ТАБЛИЦА) ===
function renderDataSubTab(data) {
    const tbody = document.getElementById('data-table-body');
    if(!tbody) return;

    if(data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-[var(--text-muted)]">Нет данных</td></tr>`;
        return;
    }

    const sortedData = [...data].sort((a,b) => new Date(b.date) - new Date(a.date));

    // Выводим максимум 50 последних записей для производительности мобилок
    const limit = Math.min(sortedData.length, 50);
    let html = '';

    for(let i=0; i<limit; i++) {
        const r = sortedData[i];
        const d = new Date(r.date).toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit'});
        const m = r.metrics;
        const color = m ? (m.final < 70 ? 'text-red-500' : (m.final < 85 ? 'text-orange-500' : 'text-green-600')) : '';
        const bText = m ? `<span class="text-orange-500">${m.n_B2_fail}</span> / <span class="text-red-500">${m.n_B3_fail}</span>` : '-';
        
        html += `
            <tr class="hover:bg-[var(--hover-bg)] cursor-pointer" onclick="showHistoryDetail(${r.id})">
                <td class="p-2 pl-3">${d}</td>
                <td class="p-2 max-w-[80px] truncate" title="${r.contractorName}">${r.contractorName}</td>
                <td class="p-2 max-w-[80px] truncate font-bold text-slate-700 dark:text-slate-300" title="${r.location}">${r.location}</td>
                <td class="p-2 max-w-[80px] truncate text-slate-500" title="${r.stageName}">${r.stageName}</td>
                <td class="p-2 text-center font-black ${color}">${m ? m.final+'%' : '-'}</td>
                <td class="p-2 text-center font-bold bg-slate-50 dark:bg-slate-900 border-l border-[var(--card-border)]">${bText}</td>
            </tr>
        `;
    }

    tbody.innerHTML = html;
}

// === РЕЙТИНГ ПОДРЯДЧИКОВ ===
function renderRatingTab() {
    const listDiv = document.getElementById('rating-list'); 
    const emptyMsg = document.getElementById('rating-empty-msg');
    if(!listDiv) return;

    const selTmpl = document.getElementById('rating-template-select')?.value || 'ALL'; 
    const selPeriod = document.getElementById('rating-period-select')?.value || 'ALL';
    
    let filteredArr = contractorArray; const now = new Date();
    if (selPeriod === 'DAY') filteredArr = filteredArr.filter(i => new Date(i.date).toDateString() === now.toDateString());
    else if (selPeriod === 'MONTH') { const m = new Date(); m.setDate(now.getDate() - 30); filteredArr = filteredArr.filter(i => new Date(i.date) >= m); } 
    else if (selPeriod === 'WEEK') { const w = new Date(); w.setDate(now.getDate() - 7); filteredArr = filteredArr.filter(i => new Date(i.date) >= w); }
    if (selTmpl !== "ALL") filteredArr = filteredArr.filter(i => i.templateKey === selTmpl);

    if (filteredArr.length === 0) { listDiv.innerHTML = ''; emptyMsg.style.display = 'block'; return; }
    emptyMsg.style.display = 'none';

    const grouped = {};
    filteredArr.forEach(item => { const cName = item.contractorName || 'Не указан'; if(!grouped[cName]) grouped[cName] = []; grouped[cName].push(item); });
    
    const ratingData = [];
    for(let cName in grouped) { const metrics = getContractorMetrics(grouped[cName], userTemplates); if (metrics) ratingData.push({ name: cName, metrics: metrics }); }
    
    if (ratingData.length === 0) { listDiv.innerHTML = '<p class="text-sm text-[var(--text-muted)] text-center bg-[var(--card-bg)] border border-[var(--card-border)] p-6 rounded-xl">Для рейтинга нужно мин. 7 проверок по одному виду работ.</p>'; return; }

    ratingData.sort((a,b) => {
        if (b.metrics.finalC !== a.metrics.finalC) return b.metrics.finalC - a.metrics.finalC;
        if (b.metrics.stabilityIndex !== a.metrics.stabilityIndex) return b.metrics.stabilityIndex - a.metrics.stabilityIndex;
        return a.metrics.rateB3 - b.metrics.rateB3;
    });

    listDiv.innerHTML = ratingData.map((r, index) => {
        const isGold = index === 0; const isSilver = index === 1; const isBronze = index === 2;
        const rankClass = isGold ? 'bg-gradient-to-br from-yellow-400 to-yellow-600 text-white' : (isSilver ? 'bg-gradient-to-br from-slate-300 to-slate-500 text-white' : (isBronze ? 'bg-gradient-to-br from-orange-400 to-orange-700 text-white' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'));
        
        return `
        <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 mb-3 shadow-sm relative overflow-hidden">
            ${isGold ? '<div class="absolute top-0 right-0 bg-yellow-400 text-yellow-900 text-[8px] font-black px-2 py-1 rounded-bl-lg uppercase">Лидер</div>' : ''}
            <div class="flex items-start gap-3 border-b border-[var(--card-border)] pb-3 mb-3">
                <div class="w-8 h-8 rounded-lg flex items-center justify-center font-black text-lg shadow-md shrink-0 ${rankClass}">${index + 1}</div>
                <div class="flex-1 min-w-0">
                    <div class="text-sm font-black leading-tight truncate">${r.name}</div>
                    <span class="${r.metrics.confCls} mt-1 inline-block">${r.metrics.confStatus}</span>
                </div>
                <div class="text-right shrink-0">
                    <div class="text-3xl font-black leading-none">${r.metrics.finalC}%</div>
                    <span class="${r.metrics.riskCls} text-[10px] uppercase block mt-1">${r.metrics.riskStatus}</span>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-2 text-[11px] font-bold mb-3 pb-3 border-b border-[var(--card-border)]">
                <div><span class="text-[var(--text-muted)]">Выборка:</span> ${r.metrics.count} шт.</div>
                <div><span class="text-[var(--text-muted)]">Доля B3:</span> ${r.metrics.rateB3.toFixed(1)}%</div>
                <div><span class="text-[var(--text-muted)]">Индекс стаб.:</span> ${r.metrics.stabilityIndex}</div>
                <div><span class="text-[var(--text-muted)]">Волатильность:</span> ${r.metrics.volatility.toFixed(1)}</div>
            </div>
            <div class="text-[10px] font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded border border-red-100 dark:border-red-900/50 leading-snug">
                <span class="text-[var(--text-muted)] block mb-0.5">Основание:</span> ${r.metrics.reason}
            </div>
        </div>`;
    }).join('');
}

// === ФУНКЦИИ РЕДАКТИРОВАНИЯ ЗАКЛЮЧЕНИЯ ИИ ===
let currentEditingExpertKey = null;
let currentEditingTextAreaId = null;

function editExpertText(expertKey, textAreaId) {
    currentEditingExpertKey = expertKey;
    currentEditingTextAreaId = textAreaId;
    
    const textArea = document.getElementById(textAreaId);
    const modalInput = document.getElementById('modal-expert-input');
    const overlay = document.getElementById('expert-modal-overlay');
    
    if(!textArea || !modalInput || !overlay) return;
    
    // Переносим текст из скрытого поля в модалку
    modalInput.value = textArea.value;
    
    // Показываем модалку
    overlay.style.display = 'flex';
    document.body.classList.add('modal-open');
}

function cancelExpertEdit() {
    const overlay = document.getElementById('expert-modal-overlay');
    if(overlay) overlay.style.display = 'none';
    document.body.classList.remove('modal-open');
    currentEditingExpertKey = null;
    currentEditingTextAreaId = null;
}

function resetExpertEdit() {
    if(!currentEditingExpertKey) return;
    if(confirm('Сбросить текст до оригинального заключения ИИ? Ваша редакция будет удалена.')) {
        delete customExpertConclusions[currentEditingExpertKey];
        cancelExpertEdit();
        renderAnalyticsTab(); // Перерисовываем аналитику
        showToast('Текст сброшен к исходному');
    }
}

function saveExpertEdit() {
    const modalInput = document.getElementById('modal-expert-input');
    if(!modalInput || !currentEditingExpertKey) return;
    
    const newText = modalInput.value.trim();
    if(newText === "") {
        showToast('Текст не может быть пустым!');
        return;
    }
    
    // Сохраняем в глобальный объект
    customExpertConclusions[currentEditingExpertKey] = newText;
    
    cancelExpertEdit();
    renderAnalyticsTab(); // Перерисовываем с новым текстом
    showToast('Изменения сохранены!');
}

function copyExpertText(btnId, textAreaId) {
    const textArea = document.getElementById(textAreaId);
    const btn = document.getElementById(btnId);
    
    if(!textArea || !btn) return;
    
    navigator.clipboard.writeText(textArea.value).then(() => {
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '✅<span class="hidden min-[400px]:inline"> Скопировано</span>';
        btn.classList.add('bg-green-50', 'text-green-700', 'border-green-200');
        
        setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.classList.remove('bg-green-50', 'text-green-700', 'border-green-200');
        }, 2000);
        showToast('Текст скопирован в буфер!');
    }).catch(() => {
        showToast('Ошибка копирования');
    });
}

// === УМНЫЙ ГЕНЕРАТОР СЦЕНАРИЕВ ИИ (ПРОДВИНУТЫЙ) ===
function generateSmartComment(scenario) {
    if(!currentEditingExpertKey) return;
    const parts = currentEditingExpertKey.split('_||_');
    const cName = parts[0];
    const tTitle = parts[1];
    
    const cDataAll = contractorArray.filter(i => i.contractorName === cName && i.templateTitle === tTitle);
    if(cDataAll.length < 7) {
        showToast("Мало данных для генерации (нужно минимум 7 изделий)");
        return;
    }
    
    const metrics = getContractorMetrics(cDataAll, userTemplates);
    const text = buildSmartText(scenario, metrics, cName, tTitle, cDataAll.length);
    document.getElementById('modal-expert-input').value = text;
    showToast("Текст успешно сгенерирован!");
}

function buildSmartText(scenario, c, cName, tTitle, count) {
    const isRed = c.finalC < 70 || c.rateB3 >= 30 || c.isRedZone;
    const isYellow = c.finalC >= 70 && c.finalC < 85 && !isRed;
    const b3Str = c.n_изделий_с_B3 > 0 ? `ЗАФИКСИРОВАН КРИТИЧЕСКИЙ БРАК (B3): на ${c.n_изделий_с_B3} ед.` : `Критический брак (B3) отсутствует.`;
    
    switch(scenario) {
        case 'strict':
            return `ОФИЦИАЛЬНАЯ ПРЕТЕНЗИЯ (ПРЕДПИСАНИЕ)\n\nКому: Руководителю проекта от организации "${cName}".\nКасательно: Неудовлетворительное качество работ по виду "${tTitle}".\n\nПо результатам строительного аудита (выборка: ${count} ед.) зафиксирован Уровень Качества (УрК) = ${c.finalC}%. Данный показатель ${isRed ? 'является КРИТИЧЕСКИ НИЗКИМ и свидетельствует о грубом нарушении технологии производства работ' : (isYellow ? 'находится НИЖЕ НОРМЫ, зафиксировано несоблюдение ППР' : 'находится в пределах допуска, однако выявлены системные отклонения')}.\n\nФакты нарушений:\n- ${b3Str}\n- Системное повторение одного и того же дефекта: ${c.maxFailRate.toFixed(1)}%\n- Индекс стабильности бригад: ${c.stabilityIndex}/100\n\nТРЕБОВАНИЯ СТРОИТЕЛЬНОГО КОНТРОЛЯ:\n1. В срок до __.__.202__ предоставить план корректирующих мероприятий.\n2. ${isRed ? 'НЕМЕДЛЕННО ОСТАНОВИТЬ производство работ. Вызвать комиссию для составления дефектной ведомости.' : 'Провести внеплановый инструктаж линейного ИТР и исполнителей.'}\n3. Предъявить исправленные объемы по акту.\n\nВ случае невыполнения требований, объемы к приемке (КС-2) не допускаются, будут применены штрафные санкции.`;
            
        case 'tech':
            return `ТЕХНИЧЕСКИЙ АУДИТ КАЧЕСТВА\n\nПодрядчик: ${cName}\nРаздел: ${tTitle}\nОбъем выборки: ${count} независимых проверок\n\n[МЕТРИКИ ИНЖИНИРИНГА]\n• Итоговый УрК: ${c.finalC}%\n• Базовый балл соответствия (до штрафов): ${c.baseUrkContrPerc}%\n• Коэф. системного брака (Ks): ${c.ks.toFixed(2)} (макс. частота дефекта ${c.maxFailRate.toFixed(1)}%)\n• Коэф. критичности (Kcrit): ${c.kcritC.toFixed(2)} (доля брака B3: ${c.rateB3.toFixed(1)}%)\n• Волатильность качества (СКО): ${c.volatility.toFixed(1)}\n\n[СТАТУС И ВЫВОДЫ]\nРиск-профиль: ${c.riskStatus.toUpperCase()}\nДостоверность данных: ${c.confStatus}\n\nРезюме инженера: ${c.reason}. ${isRed ? 'Технологический процесс не соблюдается. Требуется 100% входной и операционный контроль.' : (isYellow ? 'Технология соблюдается частично, требуется фокус на узлах с дефектами B2.' : 'Техпроцесс в норме. Стандартный летучий контроль.')}`;
            
        case 'boss':
            return `ИНФОРМАЦИОННАЯ СПРАВКА ДЛЯ РУКОВОДСТВА\n\n🏗 Подрядчик: ${cName}\n📊 Зона качества: ${isRed ? '🔴 КРАСНАЯ (Высокий риск срыва сроков)' : (isYellow ? '🟡 ЖЕЛТАЯ (Требует внимания)' : '🟢 ЗЕЛЕНАЯ (В норме)')}\n📉 Рейтинг (УрК): ${c.finalC}%\n\nКлючевые тезисы:\n1. Проверено: ${count} единиц продукции.\n2. ${b3Str}\n3. Стабильность: ${c.stabilityIndex < 70 ? 'Качество скачет. Бригады работают нестабильно, нет единого стандарта.' : 'Подрядчик выдает предсказуемый результат.'}\n\nРезюме:\n${isRed ? 'Рекомендуется вызвать руководство подрядчика на штаб. Высока вероятность переделок и смещения графика.' : (isYellow ? 'Подрядчик справляется, но есть тенденция к системному браку. Взят на контроль.' : 'Проблем не выявлено. Можно доверять дополнительные объемы.')}`;
            
        case 'action_plan':
            return `ПЛАН КОРРЕКТИРУЮЩИХ МЕРОПРИЯТИЙ (CAPA)\n\nПодрядчик: ${cName}\nАнализируемый вид работ: ${tTitle}\nТекущий УрК: ${c.finalC}% (Целевой: >85%)\n\nШАГ 1. ЛОКАЛИЗАЦИЯ (${b3Str})\n- Выявить все конструкции с аналогичными дефектами.\n- Обозначить их в натуре (сигнальная лента, краска).\n\nШАГ 2. АНАЛИЗ ПРИЧИН (Системность: ${c.maxFailRate.toFixed(1)}%)\n- Проверить наличие утвержденных ТК у прорабов.\n- Оценить квалификацию звена, допускающего брак.\n\nШАГ 3. ИСПРАВЛЕНИЕ\n- Демонтаж/исправление дефектных участков за счет подрядчика.\n- Повторный вызов инспектора СК.\n\nШАГ 4. ПРЕВЕНТИВНЫЕ МЕРЫ\n- ${isRed ? 'Заменить бригадира/звено.' : 'Ежедневный фотоотчет скрытых работ в чат.'}\n- Ужесточить допуски на входной контроль материалов.`;
            
        case 'finance':
            return `СЛУЖЕБНАЯ ЗАПИСКА (В ДОГОВОРНОЙ ОТДЕЛ)\n\nТема: Блокировка/согласование объемов к оплате.\nПодрядчик: ${cName}\nВид работ: ${tTitle}\n\nНа основании проведенного строительного аудита (проверено ${count} ед.), Уровень Качества составил ${c.finalC}%. ${b3Str}\n\nЗАКЛЮЧЕНИЕ ТЕХНАДЗОРА:\n${isRed ? 'СТРОГО ЗАПРЕЩАЕТСЯ подписание актов КС-2 по данному виду работ. Инициировать удержание обеспечения по договору до полного устранения дефектов B3.' : (isYellow ? 'Акты КС-2 подписывать с удержанием стоимости некачественно выполненных узлов. Применить штраф за систематическое нарушение технологии.' : 'Ограничений по качеству для подписания актов КС-2 нет. Работы выполнены в соответствии с нормативной документацией.')}\n\nОбоснование: Индекс стабильности ${c.stabilityIndex}/100, Системный брак ${c.maxFailRate.toFixed(1)}%.`;
            
        default:
            return `ЭКСПЕРТНОЕ ЗАКЛЮЧЕНИЕ\n\nКачество работ подрядчика "${cName}" по виду "${tTitle}" оценивается как ${isRed ? 'НИЗКОЕ' : (isYellow ? 'ПРИЕМЛЕМОЕ' : 'ВЫСОКОЕ')} (${c.finalC}%).\n\n[Выявленные проблемы]\n• ${c.maxFailRate >= 20 ? `Системный брак: дефект повторяется в ${c.maxFailRate.toFixed(1)}% случаев.` : 'Значимых системных отклонений не выявлено.'}\n• ${b3Str}\n\n[Рекомендации]\n• ${isRed ? 'ОСТАНОВКА РАБОТ. Требуется полная переделка.' : (isYellow ? 'Усилить операционный контроль.' : 'Продолжить производство работ.')}`;
    }
}

// === УМНЫЕ ПРИЛИПАЮЩИЕ ПАНЕЛИ ПОИСКА (История / Справочник) ===
// Работают как мини-дашборд: сворачиваются при скролле вниз, разворачиваются вверх

function initCollapsibleSearchPanel(panelId, bodyId, headerId) {
    let lastScrollY = 0;
    let isCollapsed = false;

    const panel = document.getElementById(panelId);
    const body  = document.getElementById(bodyId);
    if (!panel || !body) return;

    // Клик по заголовку — принудительный тоггл
    const header = document.getElementById(headerId);
    if (header) {
        header.style.cursor = 'pointer';
        header.addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            applyPanelState(body, isCollapsed);
        });
    }

    // Скролл — авто-сворачивание
    window.addEventListener('scroll', () => {
        const currentYF = window.scrollY;
        if (currentY > lastScrollY + 10 && currentY > 60 && !isCollapsed) {
            isCollapsed = true;
            applyPanelState(body, true);
        } else if (currentY < lastScrollY - 10 && isCollapsed) {
            isCollapsed = false;
            applyPanelState(body, false);
        }
        lastScrollY = currentY;
    }, { passive: true });
}

function applyPanelState(bodyEl, collapsed) {
    // Находим иконку-стрелку (ищем в ближайшем родителе)
    const panel = bodyEl.closest('[id$="-sticky-panel"]') || bodyEl.parentElement;
    const icon = panel?.querySelector('[id$="-panel-toggle-icon"]');

    if (collapsed) {
        bodyEl.style.maxHeight  = '0px';
        bodyEl.style.opacity    = '0';
        bodyEl.style.overflow   = 'hidden';
        bodyEl.style.marginBottom = '0';
        if (icon) icon.style.transform = 'rotate(-90deg)';
    } else {
        bodyEl.style.maxHeight  = '400px';
        bodyEl.style.opacity    = '1';
        bodyEl.style.overflow   = '';
        bodyEl.style.marginBottom = '';
        if (icon) icon.style.transform = 'rotate(0deg)';
    }
}

// === FAB-КНОПКА СКАЧАТЬ ===
function updateFabButton(tabId) {
    const fab = document.getElementById('fab-download-btn');
    if (!fab) return;
    if (tabId === 'tab-analytics') {
        const isRating = !document.getElementById('sub-rating')?.classList.contains('hidden');
        fab.style.display = 'flex';
        fab.dataset.context = isRating ? 'rating' : 'pdf';
    } else {
        fab.style.display = 'none';
    }
}

// === КОНТЕКСТНЫЙ ЭКСПОРТ PDF (ШАГ 5) ===

function handleFabDownload() {
    const data = getFilteredAnalyticsData();
    if(data.length === 0) return showToast('Нет данных для выгрузки PDF');

    if (currentActiveAnalyticsTab === 'sub-rating') exportPdfRating(data);
    else if (currentActiveAnalyticsTab === 'sub-engineering') exportPdfEngineering(data);
    else if (currentActiveAnalyticsTab === 'sub-onepager') exportPdfOnePager(data);
    else if (currentActiveAnalyticsTab === 'sub-data') exportPdfData(data);
}

// 1. PDF: Рейтинг Подрядчиков
function exportPdfRating(data) {
    const grouped = {};
    data.forEach(item => { const cName = item.contractorName || 'Не указан'; if(!grouped[cName]) grouped[cName] = []; grouped[cName].push(item); });
    
    const ratingData = [];
    for(let cName in grouped) { const metrics = getContractorMetrics(grouped[cName], userTemplates); if (metrics) ratingData.push({ name: cName, metrics: metrics }); }
    ratingData.sort((a,b) => b.metrics.finalC - a.metrics.finalC);

    const canvas = document.getElementById('chart_rating_compare');
    const chartImg = canvas ? `<div class="chart-box"><img src="${canvas.toDataURL('image/png')}"></div>` : '';

    let rowsHtml = ratingData.map((r, i) => `
        <tr class="avoid-break">
            <td class="text-center font-bold">${i + 1}</td>
            <td><b>${r.name}</b><br><span style="font-size:10px; color:#64748b;">${r.metrics.confStatus} (Изд: ${r.metrics.count})</span></td>
            <td class="text-center font-bold text-xl" style="color:${r.metrics.finalC<70?'#dc2626':(r.metrics.finalC<85?'#f59e0b':'#16a34a')}">${r.metrics.finalC}%</td>
            <td class="text-center"><span class="badge ${r.metrics.ks<1?'badge-red':'badge-green'}">Ks: ${r.metrics.ks.toFixed(2)}</span></td>
            <td class="text-center"><span class="badge ${r.metrics.kcritC<1?'badge-red':'badge-green'}">Kcrit: ${r.metrics.kcritC.toFixed(2)}</span></td>
            <td class="text-center text-sm">${r.metrics.stabilityIndex}/100</td>
            <td class="text-center" style="color:${r.metrics.riskStatus==='Высокий риск'?'#dc2626':'#16a34a'}"><b>${r.metrics.riskStatus}</b></td>
        </tr>
    `).join('');

    const content = `
        <h2 class="section-title">Сравнение и Рейтинг Подрядчиков</h2>
        ${chartImg}
        <table class="data-table mt-20">
            <thead><tr><th>Место</th><th>Подрядчик</th><th>УрК</th><th>Системность</th><th>Критичность</th><th>Стабильность</th><th>Риск</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
        </table>
    `;
    printPdfShell("Рейтинг Подрядчиков", content);
}

// 2. PDF: Инженерный Анализ
function exportPdfEngineering(data) {
    const stageData = {}; let critList = []; let allPhotos = [];
    data.forEach(unit => {
        const sKey = `${unit.templateTitle} | ${unit.stageName}`;
        if(!stageData[sKey]) stageData[sKey] = { checks: 0, sumUrk: 0, b3Count: 0 };
        stageData[sKey].checks++;
        if(unit.metrics) { stageData[sKey].sumUrk += unit.metrics.final; stageData[sKey].b3Count += unit.metrics.n_B3_fail; }

        if(unit.state && unit.details) {
            Object.keys(unit.state).forEach(itemId => {
                const state = unit.state[itemId];
                if(state === 'fail' || state === 'fail_escalated') {
                    if(state === 'fail_escalated' || (unit.metrics && unit.metrics.n_B3_fail > 0 && state==='fail')) {
                        critList.push({ loc: unit.location, stage: unit.stageName, text: unit.details[itemId]?.comment || 'Без комментария' });
                    }
                }
                if(unit.photos && unit.photos[itemId]) {
                    allPhotos.push({ src: unit.photos[itemId], loc: unit.location, stage: unit.stageName, cause: unit.details[itemId]?.causeCode || '' });
                }
            });
        }
    });

    let stagesHtml = Object.keys(stageData).map(k => {
        const avg = Math.round(stageData[k].sumUrk / stageData[k].checks);
        return `<tr><td>${k}</td><td class="text-center">${stageData[k].checks}</td><td class="text-center font-bold" style="color:${avg<70?'#dc2626':(avg<85?'#f59e0b':'#16a34a')}">${avg}%</td><td class="text-center">${stageData[k].b3Count>0?'🚨 Да':'Нет'}</td></tr>`;
    }).join('');

    let critHtml = critList.length > 0 ? critList.map(c => `<div class="crit-box"><b>${c.loc} (${c.stage}):</b> ${c.text}</div>`).join('') : '<div class="badge badge-green">Критических дефектов не обнаружено</div>';
    
    let photoHtml = allPhotos.slice(-12).map(p => `
        <div class="photo-card avoid-break">
            <img src="${p.src}">
            <div class="photo-label"><b>${p.loc}</b><br>${p.stage}</div>
        </div>
    `).join('');

    const canvasCauses = document.getElementById('chart_eng_causes');
    const chartImg = canvasCauses ? `<div class="chart-box avoid-break mt-20"><h3 style="text-align:center; margin-bottom:10px;">Распределение причин дефектов</h3><img style="max-height: 250px;" src="${canvasCauses.toDataURL('image/png')}"></div>` : '';

    const content = `
        <h2 class="section-title">Инженерный Анализ</h2>
        <table class="data-table mb-20">
            <thead><tr><th>Этап работ</th><th>Проверок</th><th>Средний УрК</th><th>Крит. дефекты (B3)</th></tr></thead>
            <tbody>${stagesHtml}</tbody>
        </table>
        ${chartImg}
        <div class="avoid-break mt-20">
            <h3 style="border-bottom: 2px solid #ef4444; color: #991b1b; padding-bottom: 5px;">Критические Нарушения (Журнал B3)</h3>
            ${critHtml}
        </div>
        ${photoHtml ? `<div class="mt-20"><h3 style="border-bottom: 2px solid #cbd5e1; padding-bottom: 5px; margin-bottom: 15px;">Фотоотчет (последние фиксации)</h3><div class="photo-grid">${photoHtml}</div></div>` : ''}
    `;
    printPdfShell("Инженерный Отчет", content);
}

// 3. PDF: One-Pager для Руководства
function exportPdfOnePager(data) {
    const uniqueLocs = [...new Set(data.map(i => i.location))];
    const uniqueContrs = [...new Set(data.map(i => i.contractorName))];
    
    let sumUrk = 0; let sumB3 = 0;
    data.forEach(i => { if(i.metrics) { sumUrk += i.metrics.final; sumB3 += i.metrics.n_B3_fail; } });
    const globalUrk = Math.round(sumUrk / data.length);
    
    const canvasTrend = document.getElementById('chart_onepager_trend');
    const chartImg = canvasTrend ? `<div class="chart-box"><img style="max-height: 200px;" src="${canvasTrend.toDataURL('image/png')}"></div>` : '';

    const content = `
        <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="font-size: 28px; margin: 0; color: #0f172a;">СВОДНЫЙ СТАТУС КАЧЕСТВА</h1>
            <p style="color: #64748b; font-size: 14px; margin-top: 5px;">Руководителю проекта | Данные на ${new Date().toLocaleDateString('ru-RU')}</p>
        </div>
        
        <table style="width: 100%; table-layout: fixed; margin-bottom: 30px; border-collapse: separate; border-spacing: 10px;">
            <tr>
                <td style="background: #f1f5f9; padding: 20px; border-radius: 12px; text-align: center; border: 1px solid #cbd5e1;">
                    <div style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: bold;">Глобальный УрК</div>
                    <div style="font-size: 42px; font-weight: 900; color: ${globalUrk < 70 ? '#dc2626' : (globalUrk < 85 ? '#f59e0b' : '#16a34a')};">${globalUrk}%</div>
                </td>
                <td style="background: #fef2f2; padding: 20px; border-radius: 12px; text-align: center; border: 1px solid #fecaca;">
                    <div style="font-size: 12px; color: #991b1b; text-transform: uppercase; font-weight: bold;">Критические дефекты</div>
                    <div style="font-size: 42px; font-weight: 900; color: #dc2626;">${sumB3}</div>
                </td>
            </tr>
            <tr>
                <td style="background: #f8fafc; padding: 15px; border-radius: 12px; text-align: center; border: 1px solid #cbd5e1;">
                    <div style="font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: bold;">Осмотрено изделий</div>
                    <div style="font-size: 24px; font-weight: 900; color: #1e293b;">${uniqueLocs.length}</div>
                </td>
                <td style="background: #f8fafc; padding: 15px; border-radius: 12px; text-align: center; border: 1px solid #cbd5e1;">
                    <div style="font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: bold;">Активных подрядчиков</div>
                    <div style="font-size: 24px; font-weight: 900; color: #1e293b;">${uniqueContrs.length}</div>
                </td>
            </tr>
        </table>

        <div style="margin-bottom: 30px;">
            <h3 style="text-align: center; color: #475569; text-transform: uppercase; font-size: 12px;">Тренд качества (последние осмотры)</h3>
            ${chartImg}
        </div>

        <div style="background: #fef2f2; border: 2px solid #fca5a5; border-radius: 12px; padding: 20px;">
            <h3 style="margin-top: 0; color: #b91c1c; text-transform: uppercase; font-size: 16px;">🚨 Зоны риска и Внимание</h3>
            <ul style="color: #991b1b; font-weight: bold; font-size: 14px; padding-left: 20px; margin-bottom: 0;">
                ${globalUrk < 85 ? `<li style="margin-bottom: 10px;">Глобальный рейтинг объекта находится в зоне риска (<85%).</li>` : `<li style="margin-bottom: 10px;">Глобальный рейтинг объекта в пределах нормы.</li>`}
                ${sumB3 > 0 ? `<li>Необходимо срочное вмешательство: обнаружено ${sumB3} критических нарушений технологии.</li>` : `<li>Критических дефектов на текущий момент нет.</li>`}
            </ul>
        </div>
    `;
    printPdfShell("Сводка для Руководства (One-Pager)", content);
}

// 4. PDF: Таблица Данных
function exportPdfData(data) {
    const sortedData = [...data].sort((a,b) => new Date(b.date) - new Date(a.date));
    const limit = Math.min(sortedData.length, 100); // Ограничим 100 строками для PDF
    
    let rowsHtml = '';
    for(let i=0; i<limit; i++) {
        const r = sortedData[i];
        const d = new Date(r.date).toLocaleDateString('ru-RU');
        const m = r.metrics;
        const color = m ? (m.final < 70 ? '#dc2626' : (m.final < 85 ? '#f59e0b' : '#16a34a')) : '#000';
        rowsHtml += `
            <tr class="avoid-break">
                <td>${d}</td>
                <td>${r.contractorName}</td>
                <td><b>${r.location}</b></td>
                <td>${r.stageName}</td>
                <td class="text-center font-bold" style="color:${color}">${m ? m.final+'%' : '-'}</td>
                <td class="text-center"><span style="color:#f59e0b">${m ? m.n_B2_fail : 0}</span> / <span style="color:#dc2626">${m ? m.n_B3_fail : 0}</span></td>
            </tr>
        `;
    }

    const content = `
        <h2 class="section-title">Журнал инспекций (Сырые данные)</h2>
        <p style="font-size: 12px; color: #64748b;">Выгружено записей: ${limit} шт.</p>
        <table class="data-table mt-10">
            <thead><tr><th>Дата</th><th>Подрядчик</th><th>Локация</th><th>Этап</th><th>УрК</th><th>B2 / B3</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
        </table>
    `;
    printPdfShell("Журнал Данных", content);
}

// === МАСТЕР-ШАБЛОН ДЛЯ ПЕЧАТИ (A3 LANDSCAPE) ===
function printPdfShell(title, content) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return alert('Разрешите всплывающие окна в браузере для выгрузки PDF.');

    const projName = document.getElementById('inp-project')?.value || 'Не указан';
    const inspName = document.getElementById('inp-inspector')?.value || 'Не указан';
    
    const html = `
    <!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>${title}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
        /* Печать А3 Альбомная */
        @page { size: A3 landscape; margin: 15mm; }
        
        body { font-family: 'Inter', sans-serif; color: #0f172a; margin: 0; padding: 0; background: #e2e8f0; font-size: 13px; line-height: 1.5; }
        
        /* Имитация листа A3 для предпросмотра в браузере */
        .preview-container {
            max-width: 400mm; /* Ограничиваем ширину на больших экранах */
            margin: 20px auto; 
            background: white; 
            padding: 20px 25mm; 
            box-shadow: 0 10px 25px rgba(0,0,0,0.15);
            min-height: 280mm;
        }
        
        .print-controls { position: fixed; bottom: 30px; right: 20px; display: flex; flex-direction: column; gap: 12px; z-index: 1000; }
        .btn { width: 60px; height: 60px; border-radius: 30px; display: flex; justify-content: center; align-items: center; cursor: pointer; border: none; box-shadow: 0 10px 15px rgba(0,0,0,0.2); font-size: 24px; }
        .btn-print { background: #4f46e5; color: white; }
        .btn-close { background: #475569; color: white; }
        
        @media print { 
            body { background: white; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            .preview-container { margin: 0; padding: 0; box-shadow: none; max-width: none; }
            .print-controls { display: none !important; } 
            .avoid-break { page-break-inside: avoid !important; } 
        }
        
        .header { border-bottom: 3px solid #1e293b; padding-bottom: 15px; margin-bottom: 25px; display: flex; justify-content: space-between; align-items: flex-end; }
        .header-title { font-size: 24px; font-weight: 900; text-transform: uppercase; margin: 0; }
        .header-meta { font-size: 11px; color: #64748b; text-align: right; }
        
        .section-title { font-size: 18px; background: #1e293b; color: white; padding: 10px 15px; border-radius: 6px; text-transform: uppercase; margin-bottom: 20px; }
        
        .data-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 25px; }
        .data-table th { background: #f1f5f9; padding: 12px; border: 1px solid #cbd5e1; color: #475569; text-transform: uppercase; }
        .data-table td { padding: 12px; border: 1px solid #cbd5e1; }
        .data-table tr:nth-child(even) { background-color: #f8fafc; }
        
        .chart-box { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 20px; text-align: center; background: #f8fafc; margin-bottom: 25px; }
        .chart-box img { max-width: 100%; max-height: 250px; object-fit: contain; }
        
        .badge { display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 10px; font-weight: bold; text-transform: uppercase; }
        .badge-green { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
        .badge-red { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
        
        .crit-box { background: #fef2f2; border-left: 5px solid #ef4444; padding: 12px; margin-bottom: 10px; font-size: 12px; color: #7f1d1d; font-weight: 500;}
        
        .photo-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
        .photo-card { border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; background: #f8fafc; }
        .photo-card img { width: 100%; height: 160px; object-fit: cover; display: block; border-bottom: 1px solid #cbd5e1; }
        .photo-label { padding: 8px; font-size: 10px; line-height: 1.3; color: #334155; }
        
        .text-center { text-align: center; } .font-bold { font-weight: bold; } .text-xl { font-size: 20px; } .mt-20 { margin-top: 25px; } .mb-20 { margin-bottom: 25px; }
    </style></head><body>
    
    <div class="print-controls">
        <button class="btn btn-print" onclick="window.print()" title="Печать / Сохранить в PDF">🖨️</button>
        <button class="btn btn-close" onclick="window.close()" title="Закрыть">✖️</button>
    </div>
    
    <div class="preview-container">
        <div class="header">
            <div>
                <h1 class="header-title">${title}</h1>
                <div style="font-size: 13px; margin-top: 6px; font-weight: bold; color: #475569;">Объект: ${projName} | Инспектор: ${inspName}</div>
            </div>
            <div class="header-meta">Сформировано:<br>${new Date().toLocaleString('ru-RU')}<br>RBI Quality Pro 4.0</div>
        </div>
        
        ${content}
    </div>
    
    </body></html>`;
    
    printWindow.document.open(); printWindow.document.write(html); printWindow.document.close();
}

// === СВОРАЧИВАЕМЫЕ ПАНЕЛИ (История / Справочник) ===
// === СВОРАЧИВАЕМЫЕ ПАНЕЛИ (История / Справочник) ===
function initCollapsiblePanel(panelId, bodyId, headerId, iconId) {
    const panel  = document.getElementById(panelId);
    const body   = document.getElementById(bodyId);
    const header = document.getElementById(headerId);
    const icon   = document.getElementById(iconId);
    if (!panel || !body) return;
    if (panel.dataset.inited) return;
    panel.dataset.inited = '1';

    let collapsed = false;
    let lastY = 0;

    function setCollapsed(val) {
        collapsed = val;
        body.style.maxHeight  = collapsed ? '0px'   : '400px';
        body.style.opacity    = collapsed ? '0'     : '1';
        // ВАЖНО: когда панель открыта, overflow должен быть visible, чтобы списки (select) не обрезались!
        body.style.overflow   = collapsed ? 'hidden': 'visible';
        if (icon) icon.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
    }

    if (header) {
        header.addEventListener('click', () => setCollapsed(!collapsed));
    }

    window.addEventListener('scroll', () => {
        const y = window.scrollY;
        if (!panel.closest('.view-section.active') && !panel.closest('.active')) return;
        if (y > lastY + 8 && y > 40 && !collapsed) setCollapsed(true);
        if (y < lastY - 8 && collapsed)             setCollapsed(false);
        lastY = y;
    }, { passive: true });
}
