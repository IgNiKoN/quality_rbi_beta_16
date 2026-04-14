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
    swipeEnabled: false,      
    autoCollapseOk: false,    
    defaultGroupsCollapsed: false, 
    fastMode: false,          
    soundEnabled: true,
    autoSave: true,
    aiEnabled: false,   
    aiAuto: false,      
    apiKey: '',
    dashboardMode: 'compact',
    anaEngPareto: true, 
    anaOpTrend: true,   
    anaOpLeader: true,
    anaEngAi: true, 
    anaEngPhotos: true,
    anaOpTopDefects: true
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
        
        // РАДАР ВЫСОТЫ ШАПКИ
        const headerEl = document.getElementById('main-header');
        // Наблюдатель (Observer) удален, так как он вызывал рывки при скролле.
        // Оставляем только реакцию на смену ориентации экрана:
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
    updateAllDynamicFilters();
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
        totalTop += navEl.offsetHeight; 
    }

    // Проверяем, находимся ли мы на вкладке "Осмотр"
    const isAuditActive = document.getElementById('tab-audit')?.classList.contains('active');

    if (isAuditActive && headerEl && headerEl.style.display !== 'none') {
        // ВАЖНО: Вычисляем отступ по ПОЛНОМУ размеру шапки, 
        // чтобы контент больше не дергался при скролле.
        const wasCollapsed = headerEl.classList.contains('header-collapsed');
        if (wasCollapsed) headerEl.classList.remove('header-collapsed'); // Временно разворачиваем для замера
        
        totalTop += headerEl.offsetHeight;
        
        if (wasCollapsed) headerEl.classList.add('header-collapsed'); // Возвращаем как было
    }

    document.body.style.paddingTop = totalTop > 0 ? `${totalTop + 15}px` : '20px';
}

// === НАВИГАЦИЯ И ВКЛАДКИ ===
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
        initCollapsiblePanel('analytics-filters-block', 'analytics-panel-body', 'analytics-panel-header', 'analytics-panel-toggle-icon');
    } else if (tabId === 'tab-reference') {
        // Обновляем текущую открытую подвкладку справочника
        const activeSub = document.querySelector('.ref-sub-section:not(.hidden)');
        if (activeSub && activeSub.id === 'ref-sub-checklists' && typeof renderReferenceTab === 'function') renderReferenceTab();
        else if (activeSub && activeSub.id === 'ref-sub-docs' && typeof renderDocsList === 'function') renderDocsList();
    } else if (tabId === 'tab-settings') {
        if (typeof renderSettingsTab === 'function') renderSettingsTab();
        if (typeof updateStorageInfo === 'function') updateStorageInfo();
    }

    if (typeof updateFabButton === 'function') updateFabButton(tabId);

    setTimeout(updateBodyPadding, 50);
    window.scrollTo(0, 0);
}

// === ПЕРЕКЛЮЧАТЕЛЬ ПОДВКЛАДОК СПРАВОЧНИКА ===
function switchReferenceSubTab(tabId, btnElement) {
    document.querySelectorAll('.ref-sub-section').forEach(el => el.classList.add('hidden'));
    
    const btnContainer = document.getElementById('reference-subtabs-block');
    if (btnContainer) {
        btnContainer.querySelectorAll('.sub-tab-btn').forEach(el => {
            el.classList.remove('bg-white', 'shadow-sm', 'text-indigo-600', 'dark:bg-slate-700', 'dark:text-indigo-400', 'active');
            el.classList.add('text-[var(--text-muted)]');
        });
    }
    
    const targetTab = document.getElementById(tabId);
    if (targetTab) targetTab.classList.remove('hidden');
    
    if (btnElement) {
        btnElement.classList.add('bg-white', 'shadow-sm', 'text-indigo-600', 'dark:bg-slate-700', 'dark:text-indigo-400', 'active');
        btnElement.classList.remove('text-[var(--text-muted)]');
    }

    // Инициализация контента при переключении
    if (tabId === 'ref-sub-checklists') {
        if (typeof renderReferenceTab === 'function') renderReferenceTab();
    } else if (tabId === 'ref-sub-docs') {
        if (typeof renderDocsList === 'function') renderDocsList();
    } else if (tabId === 'ref-sub-nodes') {
        // Запускаем рендер сетки узлов!
        if (typeof renderNodesList === 'function') renderNodesList();
    }
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

function renderSettingsTab() {
    if(document.getElementById('set-theme')) document.getElementById('set-theme').value = appSettings.theme || 'auto';
    if(document.getElementById('set-fontsize')) document.getElementById('set-fontsize').value = appSettings.fontSize || 'medium';
    if(document.getElementById('set-navpos')) document.getElementById('set-navpos').value = appSettings.navPosition || 'auto';
    if(document.getElementById('set-dashmode')) document.getElementById('set-dashmode').value = appSettings.dashboardMode || 'compact';
    
    if(document.getElementById('set-swipe')) document.getElementById('set-swipe').checked = appSettings.swipeEnabled;
    if(document.getElementById('set-collapse')) document.getElementById('set-collapse').checked = appSettings.autoCollapseOk;
    if(document.getElementById('set-groups-col')) document.getElementById('set-groups-col').checked = appSettings.defaultGroupsCollapsed;
    if(document.getElementById('set-fast')) document.getElementById('set-fast').checked = appSettings.fastMode;
    if(document.getElementById('set-ana-pareto')) document.getElementById('set-ana-pareto').checked = appSettings.anaEngPareto;
    if(document.getElementById('set-ana-trend')) document.getElementById('set-ana-trend').checked = appSettings.anaOpTrend;
    if(document.getElementById('set-ana-leader')) document.getElementById('set-ana-leader').checked = appSettings.anaOpLeader;
    if(document.getElementById('set-ana-ai')) document.getElementById('set-ana-ai').checked = appSettings.anaEngAi;
    if(document.getElementById('set-ana-photos')) document.getElementById('set-ana-photos').checked = appSettings.anaEngPhotos;
    if(document.getElementById('set-ana-top')) document.getElementById('set-ana-top').checked = appSettings.anaOpTopDefects;
}

function resetSettingsToDefault() {
    if(!confirm("Сбросить все настройки к значениям по умолчанию?")) return;
    
    // 1. Сбрасываем объект
    appSettings = {
        theme: 'auto', fontSize: 'medium', navPosition: 'auto', swipeEnabled: false,
        autoCollapseOk: false, defaultGroupsCollapsed: false, fastMode: false,
        soundEnabled: true, autoSave: true, aiEnabled: false, aiAuto: false, apiKey: '', dashboardMode: 'compact',
        anaEngPareto: true, anaOpTrend: true, anaOpLeader: true, anaEngAi: true, anaEngPhotos: true, anaOpTopDefects: true
    };
    
    // 2. Сохраняем в базу
    saveSettings('dummy', 'dummy'); 
    
    // 3. Обновляем селекторы на экране
    renderSettingsTab();
    
    // 4. ПРИМЕНЯЕМ настройки к интерфейсу (Этого не хватало!)
    applySettingsToUI(); 
    
    // 5. Пересчитываем отступы шапки с небольшой задержкой и плавно скроллим наверх
    setTimeout(() => {
        updateBodyPadding(); 
        window.scrollTo({top: 0, behavior: 'smooth'});
        document.body.classList.remove('modal-open'); // На всякий случай снимаем блокировку скролла
    }, 100);
    
    showToast("Настройки сброшены!");
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
        document.documentElement.setAttribute('data-theme', 'light');
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
    }
    
    if (appSettings.fastMode) document.body.classList.add('fast-mode');
    else document.body.classList.remove('fast-mode');

    document.documentElement.classList.remove('font-small', 'font-medium', 'font-large', 'font-xlarge');
    document.documentElement.classList.add(`font-${appSettings.fontSize || 'medium'}`);
    
    document.body.classList.remove('nav-pos-auto', 'nav-pos-top', 'nav-pos-bottom');
    document.body.classList.add(`nav-pos-${appSettings.navPosition || 'auto'}`);
    
    const dash = document.getElementById('header-dashboard');
    const dashExp = document.getElementById('dash-expanded-view');
    const dashIcon = document.getElementById('dash-expand-icon');

    if (appSettings.dashboardMode === 'hidden') {
        if(dash) dash.style.display = 'none';
    } else if (appSettings.dashboardMode === 'expanded') {
        if(dash) dash.style.display = 'block';
        if(dashExp) dashExp.classList.remove('hidden');
        if(dashIcon) dashIcon.style.display = 'none';
    } else {
        if(dash) dash.style.display = 'block';
        if(dashExp) dashExp.classList.add('hidden');
        if(dashIcon) dashIcon.style.display = 'flex';
    }
    
    // Плавный пересчет отступов без перерисовки контента
    setTimeout(() => {
        if (typeof updateBodyPadding === 'function') updateBodyPadding();
    }, 150);

    const activeTab = document.querySelector('.view-section.active');
    if (activeTab && typeof updateFabButton === 'function') updateFabButton(activeTab.id);
}

// Вывод списка пользовательских шаблонов для управления (Удаления)
    const templatesList = document.getElementById('settings-user-templates-list');
    if (templatesList) {
        const customKeys = Object.keys(userTemplates);
        if (customKeys.length === 0) {
            templatesList.innerHTML = `<div class="text-[10px] text-slate-400 italic py-2 text-center">Созданных чек-листов пока нет</div>`;
        } else {
            templatesList.innerHTML = customKeys.map(key => `
                <div class="flex justify-between items-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 rounded-lg">
                    <div class="text-[11px] font-bold text-slate-700 dark:text-slate-300 truncate pr-2 flex-1">📋 ${userTemplates[key].title}</div>
                    <button onclick="deleteUserTemplate('${key}')" class="text-[10px] font-black text-red-500 bg-red-50 dark:bg-red-900/30 px-3 py-1.5 rounded border border-red-100 dark:border-red-900 shadow-sm active:scale-95">УДАЛИТЬ</button>
                </div>
            `).join('');
        }
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

// === ВКЛАДКА: СПРАВОЧНИК (ПОДВКЛАДКА 1 - ЧЕК-ЛИСТЫ И СВЯЗИ) ===
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
    
    // --- СОРТИРОВКА ПРИВЯЗАННЫХ КАРТ ---
    const linkedTwiCards = customTwiCards.filter(c => c.checklistKey === selectedKey);
    // Карты, привязанные ко всему виду работ (ALL)
    const globalCards = linkedTwiCards.filter(c => c.itemId === 'ALL' || !c.itemId);
    // Карты, привязанные к конкретным пунктам
    const itemCards = linkedTwiCards.filter(c => c.itemId && c.itemId !== 'ALL');

    let html = '';

    // --- ШАПКА: СТАТИСТИКА И ОБЩИЕ ИНСТРУКЦИИ ---
    html += `
        <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 shadow-sm mb-4 relative overflow-hidden">
            <div class="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-1">Требования по виду работ</div>
            <div class="text-[14px] font-black text-slate-800 dark:text-white leading-tight mb-3">${refSelect.options[refSelect.selectedIndex].text.replace('▼', '').trim()}</div>
            
            <div class="flex gap-4 mb-3 pb-3 border-b border-slate-100 dark:border-slate-700">
                <div class="text-[10px] font-bold text-slate-600 dark:text-slate-400"><span class="text-indigo-600 text-[12px] font-black">${globalCards.length}</span> инстр. к разделу</div>
                <div class="text-[10px] font-bold text-slate-600 dark:text-slate-400"><span class="text-orange-600 text-[12px] font-black">${itemCards.length}</span> инстр. к пунктам</div>
            </div>
    `;

    if (globalCards.length > 0) {
        html += `<div class="space-y-2">`;
        globalCards.forEach(c => {
            const icon = c.type === 'PDF' ? '📄' : '🛠';
            const typeName = c.type === 'PDF' ? 'Внешний PDF-Регламент' : 'Пошаговое руководство (TWI)';
            html += `
                <div class="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-lg p-2.5 flex items-center justify-between cursor-pointer active:scale-95 transition-transform" onclick="openTwiViewer('${c.id}')">
                    <div class="flex items-center gap-3 min-w-0 pr-2">
                        <div class="w-8 h-8 bg-indigo-200 dark:bg-indigo-800 text-indigo-700 dark:text-indigo-300 rounded flex items-center justify-center text-lg shrink-0">${icon}</div>
                        <div class="min-w-0">
                            <div class="text-[9px] font-bold text-indigo-500 uppercase tracking-wider mb-0.5">${typeName}</div>
                            <div class="text-[11px] font-black text-indigo-900 dark:text-indigo-200 truncate">${c.title}</div>
                        </div>
                    </div>
                    <div class="text-indigo-400 font-black">➔</div>
                </div>
            `;
        });
        html += `</div>`;
    } else {
        html += `<div class="text-[10px] text-slate-400 font-bold italic">Общих инструкций к разделу пока нет</div>`;
    }
    html += `</div>`;

    // --- СПИСОК ПУНКТОВ ИЗ ЧЕК-ЛИСТА ---
    checklist.forEach(g => {
        const filteredItems = g.items.filter(i => 
            i.n.toLowerCase().includes(searchTerm) || 
            (i.t && i.t.toLowerCase().includes(searchTerm))
        );

        if (filteredItems.length === 0) return;

        html += `
        <div class="mb-4 bg-[var(--card-bg)] rounded-xl border border-[var(--card-border)] overflow-hidden shadow-sm">
            <div class="bg-[var(--hover-bg)] p-3 text-[11px] font-black text-[var(--text-muted)] uppercase border-b border-[var(--card-border)] tracking-tight">
                ${g.group || g.title}
            </div>
            <div class="p-2 space-y-2">`;
        
        filteredItems.forEach(i => {
            const safeNormText = (i.t || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            
            // Ищем карты, привязанные ТОЛЬКО к этому конкретному пункту
            const specificItemCards = itemCards.filter(c => String(c.itemId) === String(i.id));
            const twiBtnClass = specificItemCards.length > 0 
                ? "bg-indigo-600 text-white shadow-md border-indigo-700" 
                : "bg-slate-100 text-slate-400 border-slate-200 dark:bg-slate-800 dark:border-slate-700 opacity-70";
            const twiBtnAction = specificItemCards.length > 0 
                ? `openTwiViewer('${specificItemCards[0].id}')` 
                : `showToast('Для этого пункта еще не создана TWI-карта')`;
            const twiIcon = specificItemCards.length > 0 ? "🗺️" : "🚫";
            
            html += `
                <div class="p-3 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl shadow-sm">
                    <div class="text-[13px] font-bold text-slate-800 dark:text-white mb-2 leading-snug">
                        <span class="weight-tag wt-${i.w}">B${i.w}</span> ${i.n}
                    </div>
                    <div class="text-[11px] text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 leading-relaxed mb-3">
                        ${i.t || 'Норматив не указан'}
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <button class="bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800 py-2 rounded-lg text-[10px] font-bold uppercase active:scale-95 transition-all flex items-center justify-center gap-1.5" onclick="findAndOpenND('${safeNormText}')">
                            <span class="text-sm">📚</span> Норматив
                        </button>
                        <button class="${twiBtnClass} py-2 rounded-lg text-[10px] font-bold uppercase active:scale-95 transition-all flex items-center justify-center gap-1.5" onclick="${twiBtnAction}">
                            <span class="text-sm">${twiIcon}</span> TWI Карта
                        </button>
                    </div>
                </div>`;
        });
        html += `</div></div>`;
    });

    root.innerHTML = html || `<div class="text-center py-8 text-slate-500 text-sm font-bold bg-[var(--hover-bg)] rounded-xl border border-[var(--card-border)]">Ничего не найдено по запросу "${searchTerm}"</div>`;
}

// === ЛОГИКА ОТКРЫТИЯ СВЯЗАННЫХ ДОКУМЕНТОВ ===

// 1. Умный поиск Норматива
// Умный поиск Норматива (С промежуточным окном)
function findAndOpenND(normText) {
    if (!normText) return showToast('Норматив не указан');
    
    // Пытаемся вытащить ГОСТ или СП из текста для последующего поиска
    const match = normText.match(/(СП\s?\d+(\.\d+)*|ГОСТ\s?(Р\s)?\d+(-\d+)?)/i);
    const searchString = match ? match[0] : normText.substring(0, 15);

    const modal = document.getElementById('modal-overlay');
    document.getElementById('modal-icon').innerHTML = `<div class="text-4xl mb-2 flex justify-center">📚</div>`;
    document.getElementById('modal-title').innerText = "Нормативное требование";
    
    document.getElementById('modal-body').innerHTML = `
        <div class="text-[12px] font-bold text-slate-700 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 mb-4 whitespace-pre-wrap">
            ${normText}
        </div>
        
        <div class="text-[10px] text-slate-500 font-bold mb-2 uppercase text-center border-t border-slate-100 dark:border-slate-700 pt-3">Нужно больше информации?</div>
        
        <button onclick="closeModal(); switchToNdSearch('${searchString}')" class="w-full bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-400 py-3.5 rounded-xl font-black text-[10px] uppercase tracking-widest active:scale-95 shadow-sm flex items-center justify-center gap-2">
            🔍 Искать полный документ в Базе НД
        </button>
    `;
    
    document.body.classList.add('modal-open'); 
    modal.style.display = 'flex';
}

// Вспомогательная функция для перехода в Справочник -> База НД
function switchToNdSearch(searchString) {
    switchTab('tab-reference');
    setTimeout(() => {
        const btns = document.querySelectorAll('.sub-tab-btn');
        if (btns[1]) switchReferenceSubTab('ref-sub-docs', btns[1]);
        
        const searchInput = document.getElementById('doc-search-input');
        if (searchInput) {
            searchInput.value = searchString;
            currentDocFilter = 'ALL';
            renderDocsList();
            showToast(`🔍 Ищем в базе: ${searchString}`);
        }
        window.scrollTo({top: 0, behavior: 'smooth'});
    }, 150);
}

// === 2. ОТКРЫТИЕ УНИВЕРСАЛЬНОЙ ЧИТАЛКИ ИНСТРУКЦИЙ ===
function openTwiViewer(twiId) {
    const card = customTwiCards.find(c => c.id === twiId);
    if (!card) return showToast('Ошибка: Инструкция не найдена');
    // Сохраняем ID открытой карты для печати
    document.getElementById('twi-viewer-overlay').dataset.currentTwiId = twiId;
    document.getElementById('btn-print-twi').classList.remove('hidden'); // Показываем кнопку печати

    // Настраиваем шапку
    document.getElementById('viewer-twi-checklist').innerText = card.checklistName;
    document.getElementById('viewer-twi-title').innerText = card.title;
    
    const badgeEl = document.getElementById('viewer-twi-badge');
    const infoPanel = document.getElementById('viewer-twi-info-panel');
    const footer = document.getElementById('viewer-twi-footer');
    const content = document.getElementById('viewer-twi-content');
    
    // Очищаем старый контент (особенно важно для iframe)
    content.innerHTML = '';
    content.classList.remove('p-0'); // Сброс паддингов

    // === ЛОГИКА РЕНДЕРА ПО ТИПАМ ===
    
    // ТИП 1: КАРТА ИНСПЕКТОРА (Правильно / Неправильно)
    if (card.type === 'INSPECTOR') {
        badgeEl.innerText = 'Технадзор';
        badgeEl.className = 'bg-blue-500 text-white px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest shadow-sm';
        infoPanel.classList.add('hidden');
        footer.classList.remove('hidden');
        content.classList.remove('p-0');

        let photoGoodHtml = card.photoGood ? `
            <div class="relative rounded-xl overflow-hidden shadow-sm border-2 border-green-500 cursor-pointer active:scale-95 transition-transform" onclick="openPhotoViewer('${card.photoGood}')">
                <div class="absolute top-0 left-0 w-full bg-gradient-to-b from-green-600/80 to-transparent p-2 text-white font-black text-[10px] uppercase tracking-widest drop-shadow-md">✅ Правильно</div>
                <img src="${card.photoGood}" class="w-full h-48 object-cover">
            </div>` : `<div class="h-48 rounded-xl border-2 border-dashed border-green-300 flex items-center justify-center bg-green-50"><span class="text-green-600 font-bold text-[10px] uppercase">Нет эталонного фото</span></div>`;

        let photoBadHtml = card.photoBad ? `
            <div class="relative rounded-xl overflow-hidden shadow-sm border-2 border-red-500 cursor-pointer active:scale-95 transition-transform" onclick="openPhotoViewer('${card.photoBad}')">
                <div class="absolute top-0 left-0 w-full bg-gradient-to-b from-red-600/80 to-transparent p-2 text-white font-black text-[10px] uppercase tracking-widest drop-shadow-md">❌ Брак</div>
                <img src="${card.photoBad}" class="w-full h-48 object-cover">
            </div>` : `<div class="h-48 rounded-xl border-2 border-dashed border-red-300 flex items-center justify-center bg-red-50"><span class="text-red-600 font-bold text-[10px] uppercase">Нет фото брака</span></div>`;

        // Ищем текст норматива, чтобы вывести его для справки
        let normText = 'Норматив не указан';
        const flatList = getFlatList(currentChecklist.length > 0 ? currentChecklist : []); // Защита, если смотрим из Справочника
        const itemInfo = flatList.find(i => i.id === card.itemId);
        if (itemInfo) normText = itemInfo.t || normText;

        content.innerHTML = `
            <div class="p-4 space-y-4">
                <div class="grid grid-cols-2 gap-3">
                    ${photoGoodHtml}
                    ${photoBadHtml}
                </div>
                
                <div class="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
                    <div class="flex items-center gap-2 mb-2 border-b border-slate-100 dark:border-slate-700 pb-2">
                        <span class="w-6 h-6 bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400 rounded flex items-center justify-center text-sm font-black">!</span>
                        <h4 class="text-[11px] font-black text-slate-800 dark:text-white uppercase tracking-wider">Почему это важно (Риски)</h4>
                    </div>
                    <div class="text-[12px] font-medium text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">${card.whyImportant || 'Обоснование не заполнено'}</div>
                </div>

                <div class="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
                    <div class="flex items-center gap-2 mb-2 border-b border-slate-100 dark:border-slate-700 pb-2">
                        <span class="w-6 h-6 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded flex items-center justify-center text-sm font-black">🔧</span>
                        <h4 class="text-[11px] font-black text-slate-800 dark:text-white uppercase tracking-wider">Как проверять (Методика)</h4>
                    </div>
                    <div class="text-[12px] font-medium text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">${card.howToCheck || 'Методика не заполнена'}</div>
                    <div class="mt-3 pt-3 border-t border-dashed border-slate-200 dark:border-slate-700">
                        <div class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Справочно (Допуск из СНиП):</div>
                        <div class="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-relaxed bg-slate-50 dark:bg-slate-900 p-2 rounded border border-slate-100 dark:border-slate-800">${normText}</div>
                    </div>
                </div>
            </div>
        `;
    } 
    
    // ТИП 2: ПОШАГОВЫЙ TWI РАБОЧЕГО
    else if (card.type === 'WORKER') {
        badgeEl.innerText = 'Инструкция';
        badgeEl.className = 'bg-orange-500 text-white px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest shadow-sm';
        
        infoPanel.classList.remove('hidden');
        footer.classList.remove('hidden');
        content.classList.remove('p-0');

        document.getElementById('viewer-twi-time').innerText = `~${card.totalTime || 0} мин`;
        document.getElementById('viewer-twi-steps-count').innerText = `${card.steps ? card.steps.length : 0} шагов`;

        let stepsHtml = '<div class="p-4 space-y-4">';
        if (card.steps && card.steps.length > 0) {
            card.steps.forEach(step => {
                const photoHtml = step.photo ? `
                    <div class="mt-3 w-full rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm" onclick="openPhotoViewer('${step.photo}')">
                        <img src="${step.photo}" class="w-full h-40 object-cover active:scale-95 transition-transform origin-center">
                        <div class="bg-slate-100 dark:bg-slate-800 text-[9px] text-slate-500 text-center py-1 font-bold uppercase tracking-wider">Нажмите, чтобы увеличить</div>
                    </div>
                ` : '';

                stepsHtml += `
                    <div class="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 relative overflow-hidden">
                        <div class="absolute top-0 left-0 w-1 h-full bg-orange-500"></div>
                        <div class="flex justify-between items-start mb-2">
                            <div class="font-black text-orange-600 dark:text-orange-400 text-[11px] uppercase tracking-wider bg-orange-50 dark:bg-orange-900/30 px-2 py-1 rounded">Шаг ${step.order}</div>
                            ${step.time ? `<div class="text-[10px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded">⏱️ ${step.time} мин</div>` : ''}
                        </div>
                        <div class="text-[13px] font-bold text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">${step.text}</div>
                        ${photoHtml}
                    </div>
                `;
            });
        } else {
            stepsHtml += `<div class="text-center text-slate-500 text-sm font-bold py-10">Шаги не заполнены</div>`;
        }
        stepsHtml += '</div>';
        content.innerHTML = stepsHtml;
    } 
    
    // ТИП 3: ВНЕШНИЙ PDF-ДОКУМЕНТ
    // ТИП 3: ВНЕШНИЙ PDF-ДОКУМЕНТ
    else if (card.type === 'PDF') {
        badgeEl.innerText = 'PDF-Файл';
        badgeEl.className = 'bg-red-500 text-white px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest shadow-sm';
        infoPanel.classList.add('hidden');
        footer.classList.add('hidden');
        content.classList.add('p-0');

        if (card.pdfData) {
            try {
                const byteCharacters = atob(card.pdfData.split(',')[1]);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], {type: 'application/pdf'});
                const blobUrl = URL.createObjectURL(blob);

                // Окно просмотра с iframe и кнопкой скачивания внизу
                content.innerHTML = `
                    <div class="w-full h-full flex flex-col relative bg-slate-100 dark:bg-slate-900">
                        <iframe src="${blobUrl}#toolbar=0" class="w-full flex-1 border-none bg-white dark:bg-slate-800" style="min-height: 60vh;"></iframe>
                        
                        <div class="p-3 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center shrink-0 shadow-[0_-4px_10px_rgba(0,0,0,0.05)] z-10">
                            <div class="min-w-0 pr-3">
                                <div class="text-[11px] font-black text-slate-800 dark:text-white truncate">${card.pdfName}</div>
                                <div class="text-[9px] font-bold text-slate-500">${card.pdfSize}</div>
                            </div>
                            <a href="${blobUrl}" target="_blank" download="${card.pdfName}" class="bg-red-600 text-white px-4 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-md active:scale-95 transition-transform flex items-center gap-2 shrink-0">
                                📥 Скачать / Открыть
                            </a>
                        </div>
                    </div>
                `;
                content.dataset.blobUrl = blobUrl;

            } catch (err) {
                console.error(err);
                content.innerHTML = `<div class="flex flex-col items-center justify-center h-full p-6 text-center"><div class="text-4xl mb-4">⚠️</div><div class="text-sm font-bold text-slate-500">Не удалось открыть PDF.<br>Возможно, файл поврежден.</div></div>`;
            }
        } else {
            content.innerHTML = `<div class="flex flex-col items-center justify-center h-full p-6 text-center"><div class="text-4xl mb-4">📄</div><div class="text-sm font-bold text-slate-500">PDF файл отсутствует.</div></div>`;
        }
    }

    // === АНИМАЦИЯ ОТКРЫТИЯ ===
    const overlay = document.getElementById('twi-viewer-overlay');
    overlay.style.display = 'flex';
    document.body.classList.add('modal-open');
    
    // Плавное появление (Fade In)
    setTimeout(() => {
        overlay.classList.remove('opacity-0');
    }, 10);
}

function closeTwiViewer() {
    const overlay = document.getElementById('twi-viewer-overlay');
    const content = document.getElementById('viewer-twi-content');
    
    // Очищаем память, если открывали PDF (предотвращает утечки ОЗУ)
    if (content.dataset.blobUrl) {
        URL.revokeObjectURL(content.dataset.blobUrl);
        content.dataset.blobUrl = '';
    }

    overlay.classList.add('opacity-0');
    
    setTimeout(() => {
        overlay.style.display = 'none';
        document.body.classList.remove('modal-open');
        content.innerHTML = ''; // Полная очистка DOM-узла
    }, 300);
}

// === МЕНЮ СПРАВКИ В КАРТОЧКЕ ДЕФЕКТА ===
function openItemHelpMenu(id, event) {
    if (event) event.stopPropagation();

    const flat = getFlatList(currentChecklist);
    const itemData = flat.find(x => x.id === id);
    if (!itemData) return;

    document.getElementById('help-modal-title').innerText = itemData.n;

    // Ищем инструкции
    // Карта технадзора (привязана строго к пункту)
    const inspectorCard = customTwiCards.find(c => c.type === 'INSPECTOR' && String(c.itemId) === String(id));
    
    // Общие инструкции (WORKER или PDF), которые привязаны ЛИБО к этому пункту, ЛИБО ко всему чек-листу ("ALL")
    const generalCards = customTwiCards.filter(c => 
        (c.type === 'WORKER' || c.type === 'PDF') && 
        c.checklistKey === currentTemplateKey && 
        (String(c.itemId) === String(id) || c.itemId === 'ALL' || !c.itemId)
    );

    const listContainer = document.getElementById('help-modal-list');
    let html = '';

    // 1. Выводим Карту Технадзора (если есть)
    if (inspectorCard) {
        html += `
            <div class="bg-white dark:bg-slate-800 border-2 border-blue-500 rounded-xl p-3 shadow-md flex items-center justify-between cursor-pointer active:scale-95 transition-transform mb-4" 
                 onclick="closeItemHelpMenu(); setTimeout(() => openTwiViewer('${inspectorCard.id}'), 300)">
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 rounded-lg flex items-center justify-center text-2xl font-black shrink-0">🕵️‍♂️</div>
                    <div>
                        <div class="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest mb-0.5">Карта Технадзора</div>
                        <div class="text-[12px] font-bold text-slate-800 dark:text-white leading-tight">Эталон и примеры брака</div>
                    </div>
                </div>
                <div class="text-blue-500 font-black">➔</div>
            </div>
        `;
    }

    // 2. Выводим общие инструкции для всего чек-листа
    if (generalCards.length > 0) {
        html += `<div class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 pl-1 border-b border-slate-200 dark:border-slate-700 pb-2">Инструкции к виду работ</div>`;
        
        generalCards.forEach(c => {
            const icon = c.type === 'PDF' ? '📄' : '🛠';
            const color = c.type === 'PDF' ? 'text-red-500 bg-red-50 dark:bg-red-900/30' : 'text-orange-500 bg-orange-50 dark:bg-orange-900/30';
            const typeName = c.type === 'PDF' ? 'Внешний PDF-Регламент' : 'Пошаговое руководство (TWI)';
            
            html += `
                <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 shadow-sm flex items-center justify-between cursor-pointer active:scale-95 transition-transform" 
                     onclick="closeItemHelpMenu(); setTimeout(() => openTwiViewer('${c.id}'), 300)">
                    <div class="flex items-center gap-3 min-w-0 pr-2">
                        <div class="w-10 h-10 ${color} rounded-lg flex items-center justify-center text-xl font-black shrink-0">${icon}</div>
                        <div class="min-w-0">
                            <div class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">${typeName}</div>
                            <div class="text-[12px] font-bold text-slate-800 dark:text-white leading-tight truncate">${c.title}</div>
                        </div>
                    </div>
                    <div class="text-slate-400 font-black shrink-0">➔</div>
                </div>
            `;
        });
    }

    listContainer.innerHTML = html;

    const overlay = document.getElementById('item-help-modal-overlay');
    const content = document.getElementById('item-help-modal-content');
    
    overlay.style.display = 'flex';
    document.body.classList.add('modal-open');
    
    // Плавное выезжание снизу
    setTimeout(() => {
        content.classList.remove('translate-y-full');
    }, 10);
}

function closeItemHelpMenu() {
    const overlay = document.getElementById('item-help-modal-overlay');
    const content = document.getElementById('item-help-modal-content');
    
    content.classList.add('translate-y-full');
    setTimeout(() => {
        overlay.style.display = 'none';
        document.body.classList.remove('modal-open');
    }, 300);
}

// === ВКЛАДКА: ИСТОРИЯ (С ФИЛЬТРАМИ v16.0) ===
function applyHistoryFilters() {
    renderHistoryTab();
}
// --- УМНОЕ ОБНОВЛЕНИЕ ФИЛЬТРОВ (ЧТОБЫ НЕ СБРАСЫВАЛСЯ ВЫБОР) ---
function populateSelect(id, values, defaultText) {
    const el = document.getElementById(id);
    if (!el) return;
    const currentVal = el.value; // Запоминаем, что выбрано сейчас
    el.innerHTML = `<option value="ALL">${defaultText}</option>` + values.map(v => `<option value="${v}">${v}</option>`).join('');
    if (values.includes(currentVal)) el.value = currentVal; // Восстанавливаем выбор
    else el.value = "ALL";
}

function updateAllDynamicFilters() {
    const projects = [...new Set(contractorArray.map(i => i.projectName).filter(Boolean))];
    const contractors = [...new Set(contractorArray.map(i => i.contractorName).filter(Boolean))];
    const inspectors = [...new Set(contractorArray.map(i => i.inspectorName).filter(Boolean))];

    populateSelect('hist-filter-project', projects, 'Все объекты');
    populateSelect('hist-filter-contractor', contractors, 'Все подрядчики');
    populateSelect('hist-filter-inspector', inspectors, 'Все инспекторы');

    populateSelect('global-filter-project', projects, 'Все объекты');
    populateSelect('global-filter-contractor', contractors, 'Все подрядчики');
    populateSelect('global-filter-inspector', inspectors, 'Все инспекторы');
    
    // Шаблоны для Аналитики
    const tmplSelect = document.getElementById('checklist-selector');
    const targetTmpl = document.getElementById('global-filter-template');
    if(tmplSelect && targetTmpl) {
        const currentTmpl = targetTmpl.value;
        let opts = `<option value="ALL">Все виды работ</option>`;
        Array.from(tmplSelect.options).forEach(o => {
            if(o.value && o.value !== "HOME" && o.value !== "UPLOAD") opts += `<option value="${o.value}">${o.text}</option>`;
        });
        targetTmpl.innerHTML = opts;
        if(Array.from(targetTmpl.options).some(o => o.value === currentTmpl)) targetTmpl.value = currentTmpl;
    }
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
    const fProj = document.getElementById('hist-filter-project')?.value || 'ALL';
    const fContr = document.getElementById('hist-filter-contractor')?.value || 'ALL';
    const fInsp = document.getElementById('hist-filter-inspector')?.value || 'ALL';
    const fPeriod = document.getElementById('hist-filter-period')?.value || 'ALL';

    // Применение фильтров
    let filteredArr = contractorArray;
    const now = new Date();
    
    if (fSearch) {
        filteredArr = filteredArr.filter(i => 
            (i.location && i.location.toLowerCase().includes(fSearch)) ||
            (i.projectName && i.projectName.toLowerCase().includes(fSearch)) ||
            (i.inspectorName && i.inspectorName.toLowerCase().includes(fSearch)) ||
            (i.contractorName && i.contractorName.toLowerCase().includes(fSearch))
        );
    }
    
    if (fProj !== 'ALL') filteredArr = filteredArr.filter(i => i.projectName === fProj);
    if (fContr !== 'ALL') filteredArr = filteredArr.filter(i => i.contractorName === fContr);
    if (fInsp !== 'ALL') filteredArr = filteredArr.filter(i => i.inspectorName === fInsp);
    
    if (fPeriod === 'DAY') filteredArr = filteredArr.filter(i => new Date(i.date).toDateString() === now.toDateString());
    else if (fPeriod === 'WEEK') { const w = new Date(); w.setDate(now.getDate()-7); filteredArr = filteredArr.filter(i => new Date(i.date) >= w); }
    else if (fPeriod === 'MONTH') { const m = new Date(); m.setDate(now.getDate()-30); filteredArr = filteredArr.filter(i => new Date(i.date) >= m); }

    if(countEl) countEl.innerText = filteredArr.length;

    if (filteredArr.length === 0) {
        listDiv.innerHTML = `<div class="text-sm text-slate-500 text-center bg-slate-50 dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700">По заданным фильтрам проверок не найдено.</div>`;
        return;
    }

    const grouped = {};
    filteredArr.forEach(item => {
        const cName = item.contractorName || 'Не указан'; 
        const tTitle = item.templateTitle || 'Неизвестный вид работ';
        if (!grouped[cName]) grouped[cName] = {}; 
        if (!grouped[cName][tTitle]) grouped[cName][tTitle] = [];
        grouped[cName][tTitle].push(item);
    });

    let html = '';
    let groupIndex = 0;
    for (let cName in grouped) {
        const safeGroupName = `hist-group-${groupIndex++}`;
        html += `<div class="font-black text-slate-700 dark:text-slate-300 text-xs mt-4 mb-2 uppercase tracking-tight pl-2 border-l-4 border-indigo-500 cursor-pointer flex justify-between items-center" onclick="document.getElementById('${safeGroupName}').classList.toggle('hidden')">
            <span>🏗️ ${cName}</span><span class="text-[10px] text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">СВЕРНУТЬ</span>
        </div><div id="${safeGroupName}" class="transition-all duration-300 origin-top">`; 
        
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
                                <div class="text-[11px] font-bold text-slate-800 dark:text-white">${item.location} <span class="text-[10px] ml-1">${photoIcon}</span></div>
                                <div class="text-[9px] text-slate-400 mt-0.5">${new Date(item.date).toLocaleString('ru-RU')} | Инсп: ${item.inspectorName || 'Не указан'}</div>
                            </div>
                            <span class="status-tag ${item.metrics.statusCls}">${item.metrics.final}%</span>
                        </div>
                    </div>
                </div>`
            }).join('');
        }
        html += `</div>`; 
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
        <div class="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 mb-1">${item.templateTitle}</div>
        ${item.checkedStagesInfo ? `<div class="text-[9px] bg-slate-100 dark:bg-slate-800 p-2 rounded mt-2 mb-2 text-slate-500 dark:text-slate-400 font-bold leading-snug"><span class="text-slate-400 uppercase tracking-widest block mb-1">Проверенные этапы:</span> ${item.checkedStagesInfo.join('<br>')}</div>` : ''}
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
    // Селекторы в шапке
    const sysGroup = document.getElementById('system-group');
    const userGroup = document.getElementById('user-group');
    
    // Селекторы в Справочнике
    const refSysGroup = document.getElementById('ref-system-group');
    const refUserGroup = document.getElementById('ref-user-group');

    // Селекторы на стартовом экране (Фейковые)
    const fakeSysGroup = document.getElementById('fake-system-group');
    const fakeUserGroup = document.getElementById('fake-user-group');

    let sysHtml = Object.keys(SYSTEM_TEMPLATES).map(key => `<option value="sys_${key}">${SYSTEM_TEMPLATES[key].title}</option>`).join('');
    let userKeys = Object.keys(userTemplates);
    let userHtml = userKeys.length > 0 ? userKeys.map(key => `<option value="user_${key}">${userTemplates[key].title}</option>`).join('') : `<option disabled>Своих шаблонов нет</option>`;

    if(sysGroup) sysGroup.innerHTML = sysHtml;
    if(userGroup) userGroup.innerHTML = userHtml;
    
    if(refSysGroup) refSysGroup.innerHTML = sysHtml;
    if(refUserGroup) refUserGroup.innerHTML = userHtml;

    if(fakeSysGroup) fakeSysGroup.innerHTML = sysHtml;
    if(fakeUserGroup) fakeUserGroup.innerHTML = userHtml;

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
        
        // ОЧИЩАЕМ НАВИГАЦИЮ
        const nav = document.getElementById('audit-group-nav');
        if(nav) { nav.innerHTML = ''; nav.classList.add('hidden'); }
        
        document.getElementById('data-block-summary')?.classList.add('hidden');
        if(document.getElementById('current-checklist-label')) document.getElementById('current-checklist-label').innerText = 'Вид работ не выбран';
        
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

        // Проверяем настройку свернутости по умолчанию
        const isCollapsed = appSettings.defaultGroupsCollapsed;
        const arrow = isCollapsed ? '▶' : '▼';
        const displayStyle = isCollapsed ? 'display: none;' : 'display: block;';

        html += `<div class="block-title flex justify-between items-center cursor-pointer select-none rounded-lg px-2 mt-4" onclick="toggleGroup(${gIndex})">
            <span id="group-title-${gIndex}">${arrow} ${g.group || g.title}</span>
            <span id="group-counter-${gIndex}" class="text-[10px] bg-[var(--card-border)] px-2 py-0.5 rounded text-[var(--text-muted)]">0/${g.items.length}</span>
        </div><div id="group_content_${gIndex}" class="transition-all origin-top" style="${displayStyle}">`;
        
        // Рендерим пункты как есть (сортировку ошибок наверх убрали)
        let itemsToRender = [...g.items];
        
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
    
    let collapseClass = '';
    if (okActive && appSettings.autoCollapseOk) {
        collapseClass = 'card-collapsed';
        cardBgClass = ''; 
    }

    if (appSettings.soundEnabled && state[id] && !itemData._justRendered) {
        if (state[id] === 'ok') audioOk.play().catch(()=>{});
        else audioFail.play().catch(()=>{});
    }
    itemData._justRendered = true; 

    // === ИЩЕМ ПРИВЯЗАННЫЕ ИНСТРУКЦИИ (КНОПКА СПРАВКИ) ===
    // === ИЩЕМ ПРИВЯЗАННЫЕ ИНСТРУКЦИИ (КНОПКА СПРАВКИ) ===
    const inspectorCard = customTwiCards.find(c => c.type === 'INSPECTOR' && String(c.itemId) === String(id));
    const generalCards = customTwiCards.filter(c => 
        (c.type === 'WORKER' || c.type === 'PDF') && 
        c.checklistKey === currentTemplateKey && 
        (String(c.itemId) === String(id) || c.itemId === 'ALL' || !c.itemId)
    );
    const hasAnyHelp = inspectorCard || generalCards.length > 0;
    
    let helpBtnHtml = '';
    if (hasAnyHelp) {
        const btnClass = inspectorCard 
            ? 'text-blue-600 bg-blue-100 border-blue-300 dark:bg-blue-900/50 dark:text-blue-400 dark:border-blue-800' 
            : 'text-slate-600 bg-slate-100 border-slate-300 dark:bg-slate-700 dark:text-slate-400 dark:border-slate-600';
        
        helpBtnHtml = `
            <button onclick="openItemHelpMenu(${id}, event)" class="btn-status ${btnClass} !w-10 !h-10 !rounded-md relative shadow-sm shrink-0" title="Инструкции и Справка">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                ${inspectorCard ? '<span class="absolute -top-1 -right-1 flex h-3 w-3"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span><span class="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span></span>' : ''}
            </button>
        `;
    } else {
        helpBtnHtml = `
            <button onclick="showToast('К этому пункту пока не привязаны инструкции')" class="btn-status text-slate-300 bg-transparent border-dashed border-slate-200 dark:text-slate-600 dark:border-slate-700 !w-10 !h-10 !rounded-md shadow-sm shrink-0" title="Нет инструкций">
                <svg class="w-5 h-5 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            </button>
        `;
    }

    // === ОСНОВНЫЕ КНОПКИ (OK / FAIL) ===
    let mainBtnsHtml = `
        <button onclick="toggleOk(${id})" class="btn-status ${okActive ? 'bg-green-500 text-white border-green-500' : ''} !w-11 !h-11 shrink-0 shadow-sm transition-transform active:scale-90">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button onclick="toggleFail(${id})" class="btn-status ${failActive ? 'bg-red-500 text-white border-red-500' : ''} !w-11 !h-11 shrink-0 shadow-sm transition-transform active:scale-90">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
    `;

    let contentHtml = '';

    // === 1. МАКЕТ ПРИ FAIL (Двухуровневый: Текст сверху, Кнопки снизу) ===
    if (failActive) {
        let hasComment = details[id]?.comment && details[id].comment.trim() !== "";
        
        let commBtn = hasComment ? 
            `<div class="relative shrink-0"><button onclick="toggleCommentField(${id})" class="btn-status text-indigo-600 bg-indigo-100 border-indigo-300 dark:bg-indigo-900 dark:text-indigo-300 !w-10 !h-10 !rounded-md shadow-sm"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg></button><div onclick="deleteComment(${id}, event)" class="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-[12px] font-bold cursor-pointer shadow-md border border-white z-10">✕</div></div>` : 
            `<button onclick="toggleCommentField(${id})" class="btn-status !w-10 !h-10 !rounded-md shrink-0 shadow-sm"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg></button>`;
        
        let photoBtn = photos[id] ? 
            `<div class="relative shrink-0"><img src="${photos[id]}" class="photo-thumb !w-10 !h-10 !rounded-md border-2 border-indigo-200 shadow-sm object-cover" onclick="openPhotoViewer('${photos[id]}')"><div onclick="removePhoto(${id}, event)" class="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-[12px] font-bold cursor-pointer shadow-md border border-white z-10">✕</div></div>` : 
            `<button onclick="triggerPhotoInput(${id})" class="btn-status !w-10 !h-10 !rounded-md shrink-0 shadow-sm"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><circle cx="12" cy="13" r="3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></circle></svg></button>`;

        let escBtn = (i.w === 2) ? `<button onclick="toggleEscalation(${id})" class="btn-status ${isEscalated ? 'bg-red-600 text-white border-red-600' : 'text-orange-500 bg-orange-50 border-orange-200'} !w-10 !h-10 !rounded-md transition-all shrink-0 shadow-sm"><span class="text-[12px] font-black">>1.5</span></button>` : '';

        let visualIndicatorHtml = isEscalated ? `<div class="text-[10px] font-black text-white bg-red-600 px-2 py-0.5 rounded w-fit mt-1 shadow-sm">Дефект учтен как B3</div>` : '';
        let commentBlockHtml = hasComment ? `<div class="mt-2 text-[12px] font-semibold text-slate-700 dark:text-slate-300 italic bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-red-100 dark:border-red-800 shadow-sm leading-snug break-words w-full">💬 ${details[id].comment}</div>` : '';

        contentHtml = `
            <div class="flex flex-col w-full">
                <!-- Верх: Название дефекта (Нормы скрыты) -->
                <div class="w-full pointer-events-none mb-2">
                    <div class="text-[13px] font-bold leading-snug card-title-text text-slate-800 dark:text-white">
                        <span class="weight-tag wt-${i.w}">B${i.w}</span> ${i.n}
                    </div>
                    ${visualIndicatorHtml}
                    ${commentBlockHtml}
                </div>
                
                <!-- Низ: Разделенный Тулбар -->
                <div class="flex justify-between items-center w-full mt-1 border-t border-red-100 dark:border-red-800 pt-3">
                    
                    <!-- Левая сторона: Фото, Коммент, 1.5x -->
                    <div class="flex items-center gap-1.5 shrink-0">
                        ${photoBtn}
                        ${commBtn}
                        ${escBtn}
                    </div>
                    
                    <!-- Правая сторона: Справка, OK, FAIL -->
                    <div class="flex items-center gap-1.5 shrink-0">
                        ${helpBtnHtml}
                        ${mainBtnsHtml}
                    </div>
                </div>
            </div>
        `;
    } 
    // === 2. МАКЕТ ПРИ OK (Нормы скрыты) ===
    else if (okActive) {
        contentHtml = `
            <div class="flex justify-between items-center w-full min-h-[44px]">
                <div class="flex-1 mr-3 min-w-0 pointer-events-none">
                    <div class="text-[13px] font-bold leading-snug card-title-text text-slate-800 dark:text-white">
                        <span class="weight-tag wt-${i.w}">B${i.w}</span> ${i.n}
                    </div>
                    <!-- Нормы скрыты -->
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    ${helpBtnHtml}
                    ${mainBtnsHtml}
                </div>
            </div>
        `;
    }
    // === 3. НЕЙТРАЛЬНЫЙ МАКЕТ (Видно всё) ===
    else {
        contentHtml = `
            <div class="flex justify-between items-center w-full min-h-[44px]">
                <div class="flex-1 mr-3 min-w-0 pointer-events-none">
                    <div class="text-[13px] font-bold leading-snug mb-1 card-title-text text-slate-800 dark:text-white">
                        <span class="weight-tag wt-${i.w}">B${i.w}</span> ${i.n}
                    </div>
                    <div class="text-[11px] text-[var(--text-muted)] leading-snug norm-desc-text">${i.t}</div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    ${helpBtnHtml}
                    ${mainBtnsHtml}
                </div>
            </div>
        `;
    }

    const cardHtml = `
    <div class="card-audit swipe-container ${indicatorClass} ${cardBgClass} ${collapseClass}" data-id="${id}" onclick="if(this.classList.contains('card-collapsed')) toggleOk(${id})">
        <div class="swipe-actions-bg swipe-bg-ok"><span class="ml-4">OK</span></div>
        <div class="swipe-actions-bg swipe-bg-fail"><span class="mr-4">FAIL</span></div>
        <div class="swipe-content p-2.5 bg-inherit border-inherit rounded-inherit h-full w-full bg-[var(--card-bg)] dark:bg-slate-800 transition-colors">
            ${contentHtml}
        </div>
    </div>`;
    
    wrapper.innerHTML = cardHtml;
}

// === СВАЙПЫ (ЛОГИКА) ===
// === СВАЙПЫ (УМНАЯ ЛОГИКА И ПЛАВНОСТЬ iOS) ===
function initSwipes() {
    const container = document.getElementById('audit-items');
    let startX = 0, currentX = 0, isDragging = false, currentCard = null, content = null;
    let bgOk = null, bgFail = null;

    container.addEventListener('touchstart', (e) => {
        if (!appSettings.swipeEnabled) return;
        const target = e.target.closest('.swipe-container');
        if (!target || e.target.closest('.btn-status') || e.target.closest('.photo-thumb')) return; 
        
        currentCard = target;
        content = currentCard.querySelector('.swipe-content');
        bgOk = currentCard.querySelector('.swipe-bg-ok');
        bgFail = currentCard.querySelector('.swipe-bg-fail');
        
        startX = e.touches[0].clientX;
        isDragging = true;
        currentCard.classList.add('swiping');
        
        // Сбрасываем стили
        if(bgOk) bgOk.style.opacity = '0';
        if(bgFail) bgFail.style.opacity = '0';
    }, {passive: true});

    container.addEventListener('touchmove', (e) => {
        if (!isDragging || !currentCard || !content) return;
        currentX = e.touches[0].clientX;
        const diff = currentX - startX;
        
        // Ограничитель с эффектом "резинки"
        const maxSwipe = 100;
        let moveX = diff;
        if (diff > maxSwipe) moveX = maxSwipe + (diff - maxSwipe) * 0.2; 
        if (diff < -maxSwipe) moveX = -maxSwipe + (diff + maxSwipe) * 0.2;
        
        content.style.transform = `translateX(${moveX}px)`;

        // Плавное проявление цвета подложки (Opacity)
        if (diff > 0 && bgOk && bgFail) {
            bgOk.style.zIndex = 1; bgFail.style.zIndex = 0;
            bgOk.style.opacity = Math.min(diff / 80, 1).toString();
            bgFail.style.opacity = '0';
        } else if (diff < 0 && bgOk && bgFail) {
            bgOk.style.zIndex = 0; bgFail.style.zIndex = 1;
            bgFail.style.opacity = Math.min(Math.abs(diff) / 80, 1).toString();
            bgOk.style.opacity = '0';
        }
    }, {passive: true});

    container.addEventListener('touchend', (e) => {
        if (!isDragging || !currentCard || !content) return;
        isDragging = false;
        currentCard.classList.remove('swiping');
        
        const diff = currentX - startX;
        const id = parseInt(currentCard.dataset.id);

        // Возвращаем карточку на место
        content.style.transform = `translateX(0)`;
        if(bgOk) bgOk.style.opacity = '0';
        if(bgFail) bgFail.style.opacity = '0';

        // Отложенное срабатывание (ждем пока карточка визуально отскочит)
        if (diff > 80) {
            setTimeout(() => toggleOk(id), 150);
        } else if (diff < -80) {
            setTimeout(() => toggleFail(id), 150);
        }
        
        currentCard = null; content = null; bgOk = null; bgFail = null;
    });
}

// === ОБНОВЛЕНИЕ МИНИ-ДАШБОРДА ===
// === ОБНОВЛЕНИЕ МИНИ-ДАШБОРДА ===
function updateUI() {
    const p = currentTemplateKey ? getProductMetrics(state, currentChecklist) : null;
    const getTextColor = (val, isDanger) => {
        if(isDanger || val < 70) return 'text-white drop-shadow-md';
        if(val < 85) return 'text-slate-900'; 
        return 'text-white drop-shadow-md'; 
    };

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
        if(document.getElementById('dash-p-kc')) document.getElementById('dash-p-kc').innerText = p.kc.toFixed(2);
        if(document.getElementById('dash-p-kcrit')) document.getElementById('dash-p-kcrit').innerText = p.kcrit.toFixed(2);
        if(document.getElementById('dash-p-b2')) document.getElementById('dash-p-b2').innerText = p.n_B2_fail;
        if(document.getElementById('dash-p-b3')) document.getElementById('dash-p-b3').innerText = p.n_B3_fail;
    }

    const currentContr = document.getElementById('inp-contractor')?.value.trim();
    const filteredArr = currentContr ? contractorArray.filter(i => i.contractorName === currentContr && i.templateKey === currentTemplateKey) : [];
    
    // ПРАВКА 5: Порог достоверности 7 и отображение 2/7
    if (filteredArr.length < 7) { 
        if(document.getElementById('dash-c-text')) document.getElementById('dash-c-text').innerText = `${filteredArr.length}/7 изд.`;
        if(document.getElementById('dash-c-bar')) document.getElementById('dash-c-bar').style.width = "0%";
        if(document.getElementById('dash-c-percent')) document.getElementById('dash-c-percent').innerText = "СБОР";
        ['dash-c-ks', 'dash-c-kcrit', 'dash-c-b3'].forEach(id => { if(document.getElementById(id)) document.getElementById(id).innerText = "-"; });
    } else {
        const c = getContractorMetrics(filteredArr, userTemplates);
        if(c) {
            if(document.getElementById('dash-c-text')) document.getElementById('dash-c-text').innerText = `${c.count} изд.`;
            if(document.getElementById('dash-c-bar')) {
                document.getElementById('dash-c-bar').style.width = `${c.finalC}%`;
                document.getElementById('dash-c-bar').className = `absolute top-0 left-0 h-full transition-all duration-500 ${c.isRedZone ? 'bg-red-500' : (c.finalC < 85 ? 'bg-yellow-400' : 'bg-green-500')}`;
            }
            if(document.getElementById('dash-c-percent')) {
                document.getElementById('dash-c-percent').innerText = `${c.finalC}%`;
                document.getElementById('dash-c-percent').className = `absolute inset-0 flex items-center justify-center text-[11px] font-black z-10 ${getTextColor(c.finalC, c.isRedZone)}`;
            }
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
    
    const selectEl = document.getElementById('checklist-selector');
    const clName = selectEl?.options[selectEl.selectedIndex]?.text.replace('▼', '').trim() || 'Вид работ не выбран';
    const labelEl = document.getElementById('current-checklist-label');
    if(labelEl) labelEl.innerText = clName;

    updateGroupCounters();
}

// === СОХРАНЕНИЕ / ОЧИСТКА ===
function saveProductToArray() {
    const projInput = document.getElementById('inp-project');
    const inspInput = document.getElementById('inp-inspector');
    const contrInput = document.getElementById('inp-contractor');
    const locInput = document.getElementById('inp-location');

    let hasError = false;
    
    // Жесткая проверка: если поле пустое, красим в красный
    [projInput, inspInput, contrInput, locInput].forEach(el => {
        if (el && !el.value.trim()) {
            el.classList.add('border-red-500', 'bg-red-50');
            setTimeout(() => el.classList.remove('border-red-500', 'bg-red-50'), 3000);
            hasError = true;
        }
    });

    if (hasError) {
        showToast('⚠️ Заполните все поля (Объект, Проверяющий, Подрядчик, Локация)!');
        window.scrollTo({ top: 0, behavior: 'smooth' }); 
        return;
    }

    let mergedState = {};
    let mergedDetails = {};
    let mergedPhotos = {};
    let checkedStageNames = [];
    let stagesToMetric = [];

    currentChecklist.forEach(group => {
        let hasAnswersInStage = false;
        group.items.forEach(item => {
            if (state[item.id]) {
                mergedState[item.id] = state[item.id];
                if (details[item.id]) mergedDetails[item.id] = details[item.id];
                if (photos[item.id]) mergedPhotos[item.id] = photos[item.id];
                hasAnswersInStage = true;
            }
        });

        if (hasAnswersInStage) {
            checkedStageNames.push(group.group || group.title);
            stagesToMetric.push(group);
        }
    });

    if (checkedStageNames.length === 0) {
        return showToast('⚠️ Чек-лист пуст. Заполните хотя бы один пункт.');
    }

    const finalMetrics = getProductMetrics(mergedState, stagesToMetric);
    const isFullCheck = checkedStageNames.length === currentChecklist.length;
    const stageNameLabel = isFullCheck ? 'Полная проверка' : 'Частичная проверка';
    
    const selectEl = document.getElementById('checklist-selector');
    const tTitle = selectEl.options[selectEl.selectedIndex].text.replace('▼', '').trim();

    const newItem = { 
        id: Date.now() + Math.floor(Math.random() * 1000), 
        date: new Date().toISOString(), 
        projectName: projInput.value.trim(), 
        inspectorName: inspInput.value.trim(), 
        contractorName: contrInput.value.trim(),
        templateKey: currentTemplateKey, 
        templateTitle: tTitle,
        location: locInput.value.trim(), 
        stageId: 0, 
        stageName: stageNameLabel,
        checkedStagesInfo: checkedStageNames, 
        isCompleted: isFullCheck,
        state: JSON.parse(JSON.stringify(mergedState)), 
        details: JSON.parse(JSON.stringify(mergedDetails)), 
        photos: JSON.parse(JSON.stringify(mergedPhotos)), 
        metrics: finalMetrics 
    };

    contractorArray.push(newItem);
    dbPut(STORES.HISTORY, newItem);
    
    // Очищаем стейт ответов
    state = {}; details = {}; photos = {}; 
    
    // СБРОС ТОЛЬКО ПОЛЯ ЛОКАЦИЯ
    locInput.value = '';
    
    scheduleSessionSave(); 
    
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast(`✅ Сохранено в Историю!`);
    render(); 
    updateUI();
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
    updateAllDynamicFilters();
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
            
            let addedCount = 0;
            
            for(const item of data) {
                // Если в текущей базе нет проверки с таким ID, добавляем её
                if(!contractorArray.find(x => x.id === item.id)) {
                    contractorArray.push(item);
                    await dbPut(STORES.HISTORY, item);
                    addedCount++;
                }
            }
            
            // Обязательно сортируем весь массив по дате (свежие сверху)
            contractorArray.sort((a, b) => new Date(b.date) - new Date(a.date));
            updateAllDynamicFilters();
            showToast(`База объединена! Добавлено новых: ${addedCount} шт.`);
            
            // ПРИНУДИТЕЛЬНО ОБНОВЛЯЕМ ИНТЕРФЕЙС В ЗАВИСИМОСТИ ОТ ОТКРЫТОЙ ВКЛАДКИ
            if (document.getElementById('tab-history').classList.contains('active')) {
                renderHistoryTab();
            } else if (document.getElementById('tab-analytics').classList.contains('active')) {
                // Если мы на вкладке Аналитика -> База, обновляем фильтры и саму таблицу
                if (typeof updateAnalyticsFilters === 'function') updateAnalyticsFilters();
                if (typeof renderCurrentAnalyticsTab === 'function') renderCurrentAnalyticsTab();
            }
            
        } catch (err) { 
            console.error(err);
            alert("Ошибка файла бэкапа. Проверьте формат файла."); 
        }
    };
    
    reader.readAsText(file);
    // Сбрасываем input, чтобы можно было загрузить тот же файл еще раз, если нужно
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
    // Вместо прямого клика, открываем наше новое окно выбора
    document.getElementById('photo-source-modal').style.display = 'flex';
}
function removePhoto(id, e) {
    if(e) e.stopPropagation();
    if(!confirm('Удалить фото?')) return;
    delete photos[id];
    updateCardDOM(id); saveSessionData();
}

// Обработка загрузки фото (Конвертация в сжатый формат для экономии IndexedDB)
// Обработка загрузки фото (Повышенное качество для презентаций)
// === ФОТОРЕДАКТОР (ЗАГРУЗКА И РИСОВАНИЕ) ===
let editorCanvas, editorCtx, isDrawing = false;
let editorImgElement = null; // Оригинальное изображение для сброса

function handlePhotoUpload(event) {
    const file = event.target.files[0];
    if (!file || !currentPhotoId) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        editorImgElement = new Image();
        editorImgElement.onload = function() {
            // Открываем оверлей редактора
            document.getElementById('photo-editor-overlay').style.display = 'flex';
            document.body.classList.add('modal-open');
            
            initPhotoEditor();
        }
        editorImgElement.src = e.target.result;
    }
    reader.readAsDataURL(file);
    event.target.value = ''; // Сброс инпута
}

function initPhotoEditor() {
    editorCanvas = document.getElementById('drawing-canvas');
    editorCtx = editorCanvas.getContext('2d');
    
    // Оптимизируем размер (HD качество, но не гигантское)
    const MAX_WIDTH = 1280; const MAX_HEIGHT = 1280;
    let width = editorImgElement.width; 
    let height = editorImgElement.height;

    if (width > height) { 
        if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } 
    } else { 
        if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; } 
    }

    editorCanvas.width = width; 
    editorCanvas.height = height;
    
    // Рисуем картинку на холсте
    clearPhotoEditor();

    // Настраиваем кисть
    editorCtx.strokeStyle = '#ef4444'; // Красный цвет
    editorCtx.lineWidth = Math.max(4, width / 150); // Толщина зависит от размера фото
    editorCtx.lineCap = 'round';
    editorCtx.lineJoin = 'round';

    // Привязываем события рисования
    editorCanvas.onmousedown = startDrawing;
    editorCanvas.onmousemove = draw;
    editorCanvas.onmouseup = stopDrawing;
    editorCanvas.onmouseout = stopDrawing;

    editorCanvas.ontouchstart = startDrawing;
    editorCanvas.ontouchmove = draw;
    editorCanvas.ontouchend = stopDrawing;
}

function clearPhotoEditor() {
    if (!editorCtx || !editorImgElement) return;
    editorCtx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
    editorCtx.drawImage(editorImgElement, 0, 0, editorCanvas.width, editorCanvas.height);
}

function getCanvasCoordinates(e) {
    const rect = editorCanvas.getBoundingClientRect();
    const scaleX = editorCanvas.width / rect.width;
    const scaleY = editorCanvas.height / rect.height;
    
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }
    
    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
    };
}

function startDrawing(e) {
    e.preventDefault();
    isDrawing = true;
    const pos = getCanvasCoordinates(e);
    editorCtx.beginPath();
    editorCtx.moveTo(pos.x, pos.y);
}

function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const pos = getCanvasCoordinates(e);
    editorCtx.lineTo(pos.x, pos.y);
    editorCtx.stroke();
}

function stopDrawing(e) {
    if(e) e.preventDefault();
    isDrawing = false;
    editorCtx.closePath();
}

function cancelPhotoEditor() {
    document.getElementById('photo-editor-overlay').style.display = 'none';
    document.body.classList.remove('modal-open');
    currentPhotoId = null;
    editorImgElement = null;
}

function saveEditedPhoto() {
    if (!currentPhotoId || !editorCanvas) return;
    
    // Добавляем штамп времени на финальное фото
    const now = new Date();
    const timestamp = now.toLocaleDateString('ru-RU') + ' ' + now.toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'});
    
    const w = editorCanvas.width;
    const h = editorCanvas.height;
    const fontSize = Math.max(16, Math.floor(w / 35)); // Адаптивный шрифт
    
    editorCtx.fillStyle = 'rgba(0,0,0,0.6)'; 
    editorCtx.fillRect(15, h - (fontSize + 20), fontSize * 10, fontSize + 15);
    editorCtx.font = `bold ${fontSize}px Arial`; 
    editorCtx.fillStyle = 'white'; 
    editorCtx.fillText(timestamp, 25, h - 20);

    // Сохраняем как сжатый JPEG (0.85 качество)
    photos[currentPhotoId] = editorCanvas.toDataURL('image/jpeg', 0.85);
    showToast("📸 Фото с пометками сохранено!");
    
    updateCardDOM(currentPhotoId); 
    scheduleSessionSave();
    cancelPhotoEditor();
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

// === ДЕМО-РЕЖИМ (С ИСПРАВЛЕННЫМИ ШАБЛОНАМИ И TWI) ===
let realTwiCards = [];

function startDemoMode(silent = false) {
    realState = JSON.parse(JSON.stringify(state));
    realDetails = JSON.parse(JSON.stringify(details));
    realPhotos = JSON.parse(JSON.stringify(photos));
    realContractorArray = JSON.parse(JSON.stringify(contractorArray));
    realTwiCards = JSON.parse(JSON.stringify(customTwiCards));
    realTemplateKey = currentTemplateKey;

    isDemoMode = true;
    document.body.classList.add('demo-mode');
    
    const fabExit = document.getElementById('fab-exit-demo');
    if(fabExit && !silent) { fabExit.classList.remove('hidden'); fabExit.style.display = 'flex'; }
    
    contractorArray = generateDemoHistory();

    const demoPhotoGood = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'><rect width='400' height='300' fill='%23dcfce7'/><path d='M150 150 L190 190 L270 100' stroke='%2316a34a' stroke-width='20' fill='none'/><text x='200' y='260' font-family='Arial' font-size='20' font-weight='bold' fill='%23166534' text-anchor='middle'>ЭТАЛОН (ПРАВИЛЬНО)</text></svg>";
    const demoPhotoBad = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'><rect width='400' height='300' fill='%23fee2e2'/><path d='M130 100 L270 200 M130 200 L270 100' stroke='%23dc2626' stroke-width='20' fill='none'/><text x='200' y='260' font-family='Arial' font-size='20' font-weight='bold' fill='%23991b1b' text-anchor='middle'>БРАК (НЕПРАВИЛЬНО)</text></svg>";
    // Пустой PDF-файл (Base64) для демонстрации
    const demoPdf = "data:application/pdf;base64,JVBERi0xLjQKJcOkwsgKMSAwIG9iago8PAovVGl0bGUgKP7/AEQAZQBtAG8AIABQAEQARikKLUNyZWF0b3IgKP7/AEQAZQBtAG8pCi9Qcm9kdWNlciAo/v8ARABlAG0AbykKLUNyZWF0aW9uRGF0ZSAoRDoyMDI0MDEwMTAwMDAwMFopCj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9DYXRhbG9nCi9QYWdlcyAzIDAgUgo+PgplbmRvYmoKMyAwIG9iago8PAovVHlwZSAvUGFnZXMKL0NvdW50IDEKL0tpZHMgWyA0IDAgUiBdCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9QYXJlbnQgMyAwIFIKL1Jlc291cmNlcyA8PAovRm9udCA8PAovRjEgNSAwIFIKPj4KPj4KL01lZGlhQm94IFsgMCAwIDU5NS4yOCA4NDEuODkgXQovQ29udGVudHMgNiAwIFIKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL1R5cGUgL0ZvbnQKL1N1YnR5cGUgL1R5cGUxCi9CYXNlRm9udCAvSGVsdmV0aWNhCj4+CmVuZG9iago2IDAgb2JqCjw8Ci9MZW5ndGggNDQKPj4Kc3RyZWFtCkJUCjcwIDcwMCBUZAovRjEgMjQgVGYKKERlbW8gUERGIERvY3VtZW50KSBUagpFVAplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA3CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMTQxIDAwMDAwIG4gCjAwMDAwMDAxOTAgMDAwMDAgbiAKMDAwMDAwMDI0NyAwMDAwMCBuIAowMDAwMDAwMzU1IDAwMDAwIG4gCjAwMDAwMDA0NDMgMDAwMDAgbiAKdHJhaWxlcgo8PAovU2l6ZSA3Ci9Sb290IDIgMCBSCi9JbmZvIDEgMCBSCj4+CnN0YXJ0eHJlZgo1MzgKJSVFT0YK";

    customTwiCards = [
        {
            id: "demo_twi_1", title: "Контроль шага арматуры", checklistKey: "sys_armature", checklistName: "Арматурные работы", type: "INSPECTOR", itemId: 204,
            whyImportant: "Снижение несущей способности пилона. При заливке бетоном вибратор не пройдет между стержнями.",
            howToCheck: "Приложить рулетку от оси до оси стержня. Допуск ±10 мм.", photoGood: demoPhotoGood, photoBad: demoPhotoBad
        },
        {
            id: "demo_twi_2", title: "Монтаж стартового кронштейна", checklistKey: "sys_nvf_facade", checklistName: "Навесной вентилируемый фасад", type: "WORKER", itemId: "ALL", totalTime: 15,
            steps: [
                {order: 1, text: "Разметить оси установки по нивелиру.", time: 5, photo: null},
                {order: 2, text: "Установить терморазрывную прокладку под кронштейн.", time: 5, photo: demoPhotoGood},
                {order: 3, text: "Затянуть анкер.", time: 5, photo: null}
            ]
        },
        {
            id: "demo_twi_3", title: "Техкарта: Укладка бетона", checklistKey: "sys_armature", checklistName: "Арматурные работы", type: "PDF", itemId: "ALL", pdfData: demoPdf, pdfName: "tech_carta.pdf", pdfSize: "0.5 MB"
        }
    ];

    document.getElementById('inp-project').value = 'ЖК "Демонстрационный"';
    document.getElementById('inp-inspector').value = 'Иванов И.И. (Демо)';
    document.getElementById('inp-contractor').value = 'ООО "Монолит-Строй"';
    document.getElementById('inp-location').value = 'Секция 2, Пилон П-10';

    currentTemplateKey = 'sys_armature';
    if(document.getElementById('checklist-selector')) document.getElementById('checklist-selector').value = currentTemplateKey;
    currentChecklist = SYSTEM_TEMPLATES['armature'].groups;
    
    state = {}; details = {}; photos = {};
    state['201'] = 'ok';
    state['204'] = 'fail'; details['204'] = { causeCode: 'C04', comment: '[Персонал] Отклонение превышает допуск на 5мм' };
    state['210'] = 'fail_escalated'; details['210'] = { causeCode: 'C01', comment: '[Технология] Жесткое нарушение, арматура торчит' };

    updateDataSummary();
    document.getElementById('empty-checklist-state').style.display = 'none';
    document.getElementById('audit-items').style.display = 'block';
    document.getElementById('audit-actions').style.display = 'grid';
    
    render(); updateUI(); renderHistoryTab(); renderCurrentAnalyticsTab(); renderTwiList();
    
    if(!silent) {
        showToast('🎮 Демо-режим активирован!');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function exitDemoMode() {
    // ЖЕСТКАЯ ОЧИСТКА ВСЕГО
    state = {};
    details = {};
    photos = {};
    
    // Возвращаем реальные данные
    state = JSON.parse(JSON.stringify(realState));
    details = JSON.parse(JSON.stringify(realDetails));
    photos = JSON.parse(JSON.stringify(realPhotos));
    contractorArray = JSON.parse(JSON.stringify(realContractorArray));
    customTwiCards = JSON.parse(JSON.stringify(realTwiCards));
    
    isDemoMode = false;
    document.body.classList.remove('demo-mode');
    
    // Прячем кнопку Выхода
    const fabExit = document.getElementById('fab-exit-demo');
    if(fabExit) { fabExit.classList.add('hidden'); fabExit.style.display = 'none'; }
    
    document.getElementById('inp-project').value = '';
    document.getElementById('inp-inspector').value = '';
    document.getElementById('inp-contractor').value = '';
    document.getElementById('inp-location').value = '';
    
    if (realTemplateKey) changeTemplate(realTemplateKey);
    else changeTemplate('HOME');

    switchTab('tab-audit');
    updateDataSummary();
    renderHistoryTab(); 
    renderTwiList();
    showToast('Возврат к реальным данным');
}

function generateDemoHistory() {
    let mockArray = [];
    const now = new Date();
    
    const demoPhoto = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'><rect width='400' height='300' fill='%23f1f5f9'/><path d='M150 100 L250 100 L200 200 Z' fill='%23cbd5e1'/><circle cx='200' cy='80' r='20' fill='%23fbbf24'/><text x='200' y='250' font-family='Arial' font-size='20' font-weight='bold' fill='%23475569' text-anchor='middle'>ФОТО НАРУШЕНИЯ</text></svg>";

    const createRecord = (id, daysAgo, contr, tmplKey, tmplTitle, loc, stageId, stageName, states, detailsData, photoData, m) => {
        let d = new Date(now); d.setDate(now.getDate() - daysAgo);
        return {
            id, date: d.toISOString(), projectName: 'ЖК "Демонстрационный"', inspectorName: 'Иванов И.И.',
            contractorName: contr, templateKey: tmplKey, templateTitle: tmplTitle, location: loc,
            stageId, stageName, isCompleted: true, state: states, details: detailsData, photos: photoData, metrics: m
        };
    };

    const metric = (f, b1, b2, b3) => ({
        final: f, baseUrkPerc: f, checkedCount: 5, totalCount: 5, n_B1_fail: b1, n_B2_fail: b2, n_B3_fail: b3, b3_found: b3>0, 
        kc: b2>2?0.85:1.0, kcrit: b3>0?0.5:1.0, isDanger: b3>0
    });

    // 1. Подрядчик ОТЛИЧНИК (ООО "Альфа-Отделка") - Фасады
    for(let i=0; i<12; i++) {
        mockArray.push(createRecord(100+i, i, 'ООО "Альфа-Отделка"', 'sys_nvf_facade', 'Вент. фасад', `Секция 1, Ось ${i+1}`, 
            0, "1. Документация", {'101':'ok', '102':'ok'}, {}, {}, metric(100,0,0,0)));
        let hasDefect = (i === 5 || i === 9);
        mockArray.push(createRecord(150+i, i, 'ООО "Альфа-Отделка"', 'sys_nvf_facade', 'Вент. фасад', `Секция 1, Ось ${i+1}`, 
            1, "2. Подготовка", {'106':hasDefect?'fail':'ok', '107':'ok'}, 
            hasDefect ? {'106': {causeCode: 'C06', comment: '[Спешка] Пыль на основании'}} : {}, {}, 
            metric(hasDefect?80:100, 0, hasDefect?1:0, 0)));
    }

    // 2. Подрядчик ХОРОШИСТ (СМУ-7) - Арматура
    for(let i=0; i<10; i++) {
        let hasDefect = (i % 3 === 0); // Каждый 3-й с косяком
        mockArray.push(createRecord(200+i, i*2, 'СМУ-7', 'sys_armature', 'Арматура', `Секция 2, Перекрытие ${i+1}`, 
            1, "2. Монтаж", {'204':hasDefect?'fail':'ok', '206':'ok', '210':'ok'}, 
            hasDefect ? {'204': {causeCode: 'C04', comment: '[Персонал] Шаг нарушен на 10мм'}} : {}, 
            hasDefect ? {'204': demoPhoto} : {}, 
            metric(hasDefect?75:100, 1, hasDefect?2:0, 0)));
    }

    // 3. Подрядчик СРЕДНЯК (ООО "Монолит-Строй") - Арматура
    for(let i=0; i<15; i++) {
        let hasDefect = (i % 2 === 0); // Половина с косяками
        mockArray.push(createRecord(300+i, i*1.5, 'ООО "Монолит-Строй"', 'sys_armature', 'Арматура', `Пилон П-${i+1}`, 
            1, "2. Монтаж", {'204':hasDefect?'fail':'ok', '206':'ok', '210':'ok'}, 
            hasDefect ? {'204': {causeCode: 'C05', comment: '[Организация] Нет контроля'}} : {}, 
            hasDefect ? {'204': demoPhoto} : {}, 
            metric(hasDefect?70:100, 1, hasDefect?3:0, 0)));
    }

    // 4. Подрядчик ТРОЕЧНИК (ВентФасадПро) - Фасады
    for(let i=0; i<8; i++) {
        let isBad = (i < 4); 
        mockArray.push(createRecord(400+i, i*3, 'ВентФасадПро', 'sys_nvf_facade', 'Вент. фасад', `Секция 3, Этаж ${i+1}`, 
            2, "3. Монтаж кронштейнов", {'109':isBad?'fail':'ok', '112':'fail'}, 
            isBad ? {'109': {causeCode: 'C01', comment: 'Смещение >15мм'}, '112': {causeCode: 'C04', comment: 'Не чистят отверстия'}} : {}, 
            isBad ? {'109': demoPhoto} : {}, 
            metric(isBad?65:80, 0, isBad?4:2, 0)));
    }

    // 5. Подрядчик ДВОЕЧНИК С КРИТИКОЙ (ИП Петров) - Вентблоки
    for(let i=0; i<9; i++) {
        let hasB3 = (i === 1 || i === 4 || i === 7); 
        mockArray.push(createRecord(500+i, i+1, 'ИП Петров (Вентблоки)', 'sys_vent_stairs', 'Вент. блоки', `Секция 3, Эт ${i+1}`, 
            1, "2. Вент. блоки", {'305':'fail', '310':hasB3?'fail_escalated':'ok'}, 
            hasB3 ? {'310': {causeCode: 'C03', comment: '[Материалы] Трещины >0.2мм в массиве'}} : {'305': {causeCode: 'C01', comment: '[Технология] Смещение осей'}}, 
            hasB3 ? {'310': demoPhoto} : {}, 
            metric(hasB3?45:82, 0, 1, hasB3?1:0)));
    }

    // 6. Подрядчик КАТАСТРОФА (СК Эталон) - Лестницы
    for(let i=0; i<7; i++) {
        let hasB3 = (i > 2); // Больше половины с B3!
        mockArray.push(createRecord(600+i, i, 'СК Эталон', 'sys_vent_stairs', 'Вент. блоки', `Лестница ЛК-${i+1}`, 
            2, "3. Лестничные марши", {'316':'fail', '319':hasB3?'fail_escalated':'ok'}, 
            hasB3 ? {'319': {causeCode: 'C03', comment: 'Сломан марш при монтаже'}} : {'316': {causeCode: 'C04', comment: 'Ступени кривые'}}, 
            hasB3 ? {'319': demoPhoto} : {}, 
            metric(hasB3?30:75, 0, 2, hasB3?1:0)));
    }

    return mockArray.sort((a, b) => new Date(b.date) - new Date(a.date));
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
// === ПЕРЕКЛЮЧАТЕЛЬ ПОДВКЛАДОК СПРАВОЧНИКА ===
function switchReferenceSubTab(tabId, btnElement) {
    // Скрываем все подвкладки справочника
    document.querySelectorAll('.ref-sub-section').forEach(el => el.classList.add('hidden'));
    
    // Сбрасываем стили всех кнопок
    const btnContainer = document.getElementById('reference-subtabs-block');
    if (btnContainer) {
        btnContainer.querySelectorAll('.sub-tab-btn').forEach(el => {
            el.classList.remove('bg-white', 'shadow-sm', 'text-indigo-600', 'dark:bg-slate-700', 'dark:text-indigo-400', 'active');
            el.classList.add('text-[var(--text-muted)]');
        });
    }
    
    // Показываем нужную вкладку
    const targetTab = document.getElementById(tabId);
    if (targetTab) targetTab.classList.remove('hidden');
    
    // Подкрашиваем активную кнопку
    if (btnElement) {
        btnElement.classList.add('bg-white', 'shadow-sm', 'text-indigo-600', 'dark:bg-slate-700', 'dark:text-indigo-400', 'active');
        btnElement.classList.remove('text-[var(--text-muted)]');
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
function toggleDateRange() {
    const period = document.getElementById('global-filter-period')?.value;
    const rangeBlock = document.getElementById('custom-date-range');
    if (!rangeBlock) return;
    
    if (period === 'CUSTOM') {
        rangeBlock.classList.remove('hidden');
        rangeBlock.classList.add('grid');
    } else {
        rangeBlock.classList.add('hidden');
        rangeBlock.classList.remove('grid');
    }
}
// Фильтрация данных для всех вкладок аналитики
function getFilteredAnalyticsData() {
    const selPeriod = document.getElementById('global-filter-period')?.value || 'ALL';
    const selTmpl = document.getElementById('global-filter-template')?.value || 'ALL';
    const selProj = document.getElementById('global-filter-project')?.value || 'ALL';
    const selContr = document.getElementById('global-filter-contractor')?.value || 'ALL';
    const selInsp = document.getElementById('global-filter-inspector')?.value || 'ALL';
    
    let arr = contractorArray;
    const now = new Date();
    
    // ФИЛЬТР ВРЕМЕНИ
    if (selPeriod === 'DAY') {
        arr = arr.filter(i => new Date(i.date).toDateString() === now.toDateString()); 
    } else if (selPeriod === 'MONTH') { 
        const m = new Date(); m.setDate(now.getDate()-30); 
        arr = arr.filter(i => new Date(i.date) >= m); 
    } else if (selPeriod === 'WEEK') { 
        const w = new Date(); w.setDate(now.getDate()-7); 
        arr = arr.filter(i => new Date(i.date) >= w); 
    } else if (selPeriod === 'CUSTOM') {
        const dFrom = document.getElementById('filter-date-from')?.value;
        const dTo = document.getElementById('filter-date-to')?.value;
        
        if (dFrom) {
            const fDate = new Date(dFrom);
            fDate.setHours(0, 0, 0, 0); // Начало дня
            arr = arr.filter(i => new Date(i.date) >= fDate);
        }
        if (dTo) {
            const tDate = new Date(dTo);
            tDate.setHours(23, 59, 59, 999); // Конец дня
            arr = arr.filter(i => new Date(i.date) <= tDate);
        }
    }

    // ОСТАЛЬНЫЕ ФИЛЬТРЫ
    if(selProj !== "ALL") arr = arr.filter(i => i.projectName === selProj);
    if(selContr !== "ALL") arr = arr.filter(i => i.contractorName === selContr);
    if(selTmpl !== "ALL") arr = arr.filter(i => i.templateKey === selTmpl);
    if(selInsp !== "ALL") arr = arr.filter(i => i.inspectorName === selInsp);
    
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

    html += ratingData.map((r, index) => {
        const m = r.metrics;
        const barColor = m.finalC < 70 ? 'bg-red-500' : (m.finalC < 85 ? 'bg-orange-500' : 'bg-green-500');
        const isLeader = index === 0 && m.finalC >= 85;

        return `
        <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 mb-3 shadow-sm relative overflow-hidden">
            ${isLeader ? '<div class="absolute top-0 right-0 bg-yellow-400 text-yellow-900 text-[8px] font-black px-3 py-1 rounded-bl-lg uppercase shadow-sm">🏆 Лидер</div>' : ''}
            
            <div class="flex items-start gap-3 border-b border-[var(--card-border)] pb-3 mb-3">
                <div class="w-10 h-10 rounded-xl flex items-center justify-center font-black text-xl shadow-inner shrink-0 ${index === 0 ? 'bg-gradient-to-br from-yellow-300 to-yellow-500 text-yellow-900' : (index === 1 ? 'bg-gradient-to-br from-slate-300 to-slate-400 text-slate-800' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300')}">${index + 1}</div>
                <div class="flex-1 min-w-0 pt-1">
                    <div class="text-[14px] font-black leading-tight truncate text-slate-800 dark:text-white">${r.name}</div>
                    <span class="${m.confCls} mt-1 inline-block text-[9px] uppercase tracking-wide">${m.confStatus} (Выборка: ${m.count})</span>
                </div>
                <div class="text-right shrink-0">
                    <div class="text-3xl font-black leading-none ${m.finalC < 70 ? 'text-red-600' : (m.finalC < 85 ? 'text-orange-500' : 'text-green-600')}">${m.finalC}%</div>
                    <span class="${m.riskCls} text-[9px] uppercase block mt-1 font-bold">${m.riskStatus}</span>
                </div>
            </div>

            <!-- Визуальный Прогресс-бар -->
            <div class="mb-4 relative">
                <div class="flex justify-between text-[8px] font-bold text-slate-400 mb-1">
                    <span>0%</span>
                    <span class="text-red-500 absolute" style="left: 70%; transform: translateX(-50%);">СТОП (70%)</span>
                    <span class="text-green-500 absolute" style="left: 85%; transform: translateX(-50%);">НОРМА (85%)</span>
                    <span>100%</span>
                </div>
                <div class="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden relative border border-slate-200 dark:border-slate-600">
                    <div class="absolute top-0 left-[70%] w-px h-full bg-red-400 z-10"></div>
                    <div class="absolute top-0 left-[85%] w-px h-full bg-green-400 z-10"></div>
                    <div class="h-full ${barColor} transition-all duration-1000" style="width: ${m.finalC}%"></div>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-2 text-[10px] font-bold mb-3">
                <div class="bg-[var(--hover-bg)] p-2 rounded-lg border border-[var(--card-border)]">
                    <span class="text-[var(--text-muted)] block mb-0.5">Системность (Ks):</span> 
                    <span class="${m.ks < 1 ? 'text-red-500' : 'text-green-600'} text-[12px]">${m.ks.toFixed(2)}</span> 
                    <span class="font-normal">(${m.maxFailRate.toFixed(1)}%)</span>
                </div>
                <div class="bg-[var(--hover-bg)] p-2 rounded-lg border border-[var(--card-border)]">
                    <span class="text-[var(--text-muted)] block mb-0.5">Критичность (Kcrit):</span> 
                    <span class="${m.kcritC < 1 ? 'text-red-500' : 'text-green-600'} text-[12px]">${m.kcritC.toFixed(2)}</span> 
                    <span class="font-normal text-red-500">(B3: ${m.n_изделий_с_B3} шт)</span>
                </div>
            </div>
            
            <!-- Вердикт -->
            <div class="text-[10px] font-bold ${m.finalC < 70 || m.n_изделий_с_B3 > 0 ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20' : (m.finalC < 85 ? 'bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-900/20' : 'bg-green-50 text-green-800 border-green-200 dark:bg-green-900/20')} p-2.5 rounded-lg border shadow-sm leading-snug">
                <span class="uppercase text-[9px] block mb-0.5 opacity-70">Вывод системы:</span> ${m.reason}
            </div>
        </div>`;
    }).join('');
    
    html += `</div>`;
    container.innerHTML = html;

    const ctx = document.getElementById('chart_rating_compare').getContext('2d');
    chartInstances['chart_rating_compare'] = new Chart(ctx, {
        type: 'bar',
        data: { labels: cLabels, datasets: [{ data: cData, backgroundColor: cData.map(v => v<70?'#ef4444':(v<85?'#f59e0b':'#22c55e')), borderRadius: 4 }] },
        options: { animation: false, responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100 } }, plugins: { legend: { display: false } } }
    });
}

// --- НОВАЯ ФУНКЦИЯ ДЛЯ ГРАФИКОВ ДИНАМИКИ ---
function buildTrendChartData(data, fieldName, topN = 5) {
    const monthMap = {}; 
    const categoriesTotal = {}; 

    // Сортируем хронологически
    const sortedData = [...data].sort((a,b) => new Date(a.date) - new Date(b.date));

    sortedData.forEach(item => {
        if (!item.metrics) return;
        const d = new Date(item.date);
        const mLabel = d.toLocaleString('ru-RU', { month: 'short', year: '2-digit' });
        const cat = item[fieldName] || 'Неизвестно';

        categoriesTotal[cat] = (categoriesTotal[cat] || 0) + 1;

        if (!monthMap[mLabel]) monthMap[mLabel] = {};
        if (!monthMap[mLabel][cat]) monthMap[mLabel][cat] = { sum: 0, cnt: 0 };

        monthMap[mLabel][cat].sum += item.metrics.final;
        monthMap[mLabel][cat].cnt++;
    });

    const topCats = Object.keys(categoriesTotal).sort((a,b) => categoriesTotal[b] - categoriesTotal[a]).slice(0, topN);
    const labels = Object.keys(monthMap);

    const colors = ['#4f46e5', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];

    const datasets = topCats.map((cat, i) => {
        const dataPoints = labels.map(l => {
            if (monthMap[l][cat]) return Math.round(monthMap[l][cat].sum / monthMap[l][cat].cnt);
            return null; // Если в этом месяце не было проверок, линия прервется/соединится
        });
        return {
            label: cat.length > 15 ? cat.substring(0, 15) + '...' : cat,
            data: dataPoints,
            borderColor: colors[i % colors.length],
            backgroundColor: colors[i % colors.length],
            tension: 0.3,
            borderWidth: 2,
            pointRadius: 3,
            spanGaps: true // Соединять точки, если есть пропуски
        };
    });

    return { labels, datasets };
}
// --- Вспомогательная функция: номер недели ---
function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    var weekNo = Math.ceil(( ( (d - yearStart) / 86400000) + 1)/7);
    return weekNo;
}

// --- УМНЫЙ ГЕНЕРАТОР ДАННЫХ ДЛЯ ТРЕНДОВ ---
function buildTrendChartData(data, fieldName, topN = 5, period = 'MONTH') {
    const timeMap = {}; 
    const categoriesTotal = {}; 

    // Сортируем хронологически от старых к новым
    const sortedData = [...data].sort((a,b) => new Date(a.date) - new Date(b.date));

    sortedData.forEach(item => {
        if (!item.metrics) return;
        const d = new Date(item.date);
        let tLabel = '';

        // Группировка по выбранному периоду
        if (period === 'YEAR') {
            tLabel = d.getFullYear().toString();
        } else if (period === 'QUARTER') {
            tLabel = `Q${Math.floor(d.getMonth() / 3) + 1} '${d.getFullYear().toString().slice(-2)}`;
        } else if (period === 'WEEK') {
            tLabel = `Нед.${getWeekNumber(d)} '${d.getFullYear().toString().slice(-2)}`;
        } else {
            // MONTH (по умолчанию)
            tLabel = d.toLocaleString('ru-RU', { month: 'short', year: '2-digit' });
        }

        const cat = fieldName === 'TOTAL' ? 'Общий УрК' : (item[fieldName] || 'Неизвестно');

        categoriesTotal[cat] = (categoriesTotal[cat] || 0) + 1;

        if (!timeMap[tLabel]) timeMap[tLabel] = {};
        if (!timeMap[tLabel][cat]) timeMap[tLabel][cat] = { sum: 0, cnt: 0 };

        timeMap[tLabel][cat].sum += item.metrics.final;
        timeMap[tLabel][cat].cnt++;
    });

    const topCats = Object.keys(categoriesTotal).sort((a,b) => categoriesTotal[b] - categoriesTotal[a]).slice(0, topN);
    const labels = Object.keys(timeMap);

    const colors = ['#4f46e5', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];

    const datasets = topCats.map((cat, i) => {
        const dataPoints = labels.map(l => {
            if (timeMap[l][cat]) return Math.round(timeMap[l][cat].sum / timeMap[l][cat].cnt);
            return null; // Разрыв линии, если нет данных
        });
        return {
            label: cat.length > 15 ? cat.substring(0, 15) + '...' : cat,
            data: dataPoints,
            borderColor: fieldName === 'TOTAL' ? '#4f46e5' : colors[i % colors.length],
            backgroundColor: fieldName === 'TOTAL' ? 'rgba(79, 70, 229, 0.1)' : colors[i % colors.length],
            fill: fieldName === 'TOTAL', // Заливка только для общего графика
            tension: 0.4, // Плавная кривая
            borderWidth: 3,
            pointRadius: 4,
            spanGaps: true // Соединять точки при пропусках
        };
    });

    return { labels, datasets };
}

// --- ЯДРО ГРАФИКОВ ТРЕНДОВ И ФИЛЬТРОВ ---

// Теперь для каждого графика хранится свой период
let trendGroupings = { contrs: 'MONTH', works: 'MONTH', global: 'MONTH' }; 
let selectedChartFilters = { contrs: [], works: [] }; // Пустой массив = Авто (ТОП-5)

function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    return Math.ceil(( ( (d - yearStart) / 86400000) + 1)/7);
}

function buildTrendChartData(data, fieldName, allowedCats = [], period = 'MONTH') {
    const timeMap = {}; const categoriesTotal = {}; 
    const sortedData = [...data].sort((a,b) => new Date(a.date) - new Date(b.date));

    sortedData.forEach(item => {
        if (!item.metrics) return;
        const d = new Date(item.date);
        let tLabel = '';

        if (period === 'YEAR') tLabel = d.getFullYear().toString();
        else if (period === 'QUARTER') tLabel = `Q${Math.floor(d.getMonth() / 3) + 1} '${d.getFullYear().toString().slice(-2)}`;
        else if (period === 'WEEK') tLabel = `Нед.${getWeekNumber(d)} '${d.getFullYear().toString().slice(-2)}`;
        else tLabel = d.toLocaleString('ru-RU', { month: 'short', year: '2-digit' });

        const cat = fieldName === 'TOTAL' ? 'Общий УрК' : (item[fieldName] || 'Неизвестно');
        categoriesTotal[cat] = (categoriesTotal[cat] || 0) + 1;

        if (!timeMap[tLabel]) timeMap[tLabel] = {};
        if (!timeMap[tLabel][cat]) timeMap[tLabel][cat] = { sum: 0, cnt: 0 };
        timeMap[tLabel][cat].sum += item.metrics.final;
        timeMap[tLabel][cat].cnt++;
    });

    let targetCats = [];
    if (fieldName === 'TOTAL') targetCats = ['Общий УрК'];
    else if (allowedCats && allowedCats.length > 0) targetCats = allowedCats.filter(c => categoriesTotal[c]); 
    else targetCats = Object.keys(categoriesTotal).sort((a,b) => categoriesTotal[b] - categoriesTotal[a]).slice(0, 5);

    const labels = Object.keys(timeMap);
    const colors = ['#4f46e5', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#db2777', '#d97706', '#059669', '#2563eb'];

    const datasets = targetCats.map((cat, i) => {
        const dataPoints = labels.map(l => (timeMap[l][cat] ? Math.round(timeMap[l][cat].sum / timeMap[l][cat].cnt) : null));
        return {
            label: cat.length > 20 ? cat.substring(0, 20) + '...' : cat,
            data: dataPoints,
            borderColor: fieldName === 'TOTAL' ? '#4f46e5' : colors[i % colors.length],
            backgroundColor: fieldName === 'TOTAL' ? 'rgba(79, 70, 229, 0.1)' : colors[i % colors.length],
            fill: fieldName === 'TOTAL',
            tension: 0.4, borderWidth: 3, pointRadius: 4, spanGaps: true
        };
    });

    return { labels, datasets };
}

// Плавное обновление графика без перерисовки экрана
function updateTrendCharts(type, period) {
    if (period) trendGroupings[type] = period;
    const data = getFilteredAnalyticsData();

    if (currentActiveAnalyticsTab === 'sub-engineering') {
        if (type === 'contrs' && chartInstances['chart_eng_trend_contrs']) {
            chartInstances['chart_eng_trend_contrs'].data = buildTrendChartData(data, 'contractorName', selectedChartFilters.contrs, trendGroupings.contrs);
            chartInstances['chart_eng_trend_contrs'].update();
        }
        if (type === 'works' && chartInstances['chart_eng_trend_works']) {
            chartInstances['chart_eng_trend_works'].data = buildTrendChartData(data, 'templateTitle', selectedChartFilters.works, trendGroupings.works);
            chartInstances['chart_eng_trend_works'].update();
        }
    } else if (currentActiveAnalyticsTab === 'sub-onepager') {
        if (type === 'global' && chartInstances['chart_onepager_trend']) {
            chartInstances['chart_onepager_trend'].data = buildTrendChartData(data, 'TOTAL', [], trendGroupings.global);
            chartInstances['chart_onepager_trend'].update();
        }
        if (type === 'contrs' && chartInstances['chart_op_trend_contrs']) {
            chartInstances['chart_op_trend_contrs'].data = buildTrendChartData(data, 'contractorName', selectedChartFilters.contrs, trendGroupings.contrs);
            chartInstances['chart_op_trend_contrs'].update();
        }
        if (type === 'works' && chartInstances['chart_op_trend_works']) {
            chartInstances['chart_op_trend_works'].data = buildTrendChartData(data, 'templateTitle', selectedChartFilters.works, trendGroupings.works);
            chartInstances['chart_op_trend_works'].update();
        }
    }
}

function openChartFilterModal(type) {
    const data = getFilteredAnalyticsData();
    const field = type === 'contrs' ? 'contractorName' : 'templateTitle';
    const title = type === 'contrs' ? 'Линии: Подрядчики' : 'Линии: Виды работ';
    
    const counts = {};
    data.forEach(i => { if(i[field]) counts[i[field]] = (counts[i[field]]||0)+1; });
    const uniqueItems = Object.keys(counts).sort((a,b) => counts[b] - counts[a]);

    const isAuto = selectedChartFilters[type].length === 0;

    let html = `<div class="space-y-2 max-h-[50vh] overflow-y-auto custom-scrollbar mb-4 pr-1">`;
    html += `<label class="flex items-center gap-3 p-3 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 rounded-xl mb-3 font-bold cursor-pointer text-indigo-800 dark:text-indigo-300">
        <input type="checkbox" id="chart-filter-auto" class="w-5 h-5 accent-indigo-600" onchange="if(this.checked) document.querySelectorAll('.chart-filter-cb').forEach(cb => cb.checked = false)" ${isAuto ? 'checked' : ''}>
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        Автовыбор (ТОП-5)
    </label>`;

    uniqueItems.forEach(item => {
        const isChecked = !isAuto && selectedChartFilters[type].includes(item);
        html += `<label class="flex items-center gap-3 p-3 bg-[var(--card-bg)] hover:bg-[var(--hover-bg)] rounded-xl cursor-pointer border border-[var(--card-border)] transition-colors">
            <input type="checkbox" value="${item}" class="chart-filter-cb w-5 h-5 accent-indigo-600" ${isChecked ? 'checked' : ''} onchange="document.getElementById('chart-filter-auto').checked = false">
            <span class="text-[12px] truncate flex-1">${item}</span>
            <span class="text-[10px] text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md font-bold">${counts[item]} шт</span>
        </label>`;
    });
    html += `</div>
    <div class="flex gap-2">
        <button onclick="closeModal()" class="flex-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 py-3 rounded-xl font-bold uppercase active:scale-95 border border-slate-200 dark:border-slate-700">Отмена</button>
        <button onclick="saveChartFilters('${type}')" class="flex-1 bg-indigo-600 text-white py-3 rounded-xl font-bold uppercase shadow-md active:scale-95">Применить</button>
    </div>`;

    const modal = document.getElementById('modal-overlay');
    document.getElementById('modal-icon').innerHTML = ''; 
    document.getElementById('modal-title').innerHTML = `<div class="flex items-center gap-2"><svg class="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"/></svg> ${title}</div>`;
    document.getElementById('modal-body').innerHTML = html;
    document.body.classList.add('modal-open');
    modal.style.display = 'flex';
}

function saveChartFilters(type) {
    const isAuto = document.getElementById('chart-filter-auto').checked;
    if (isAuto) {
        selectedChartFilters[type] = [];
    } else {
        const checked = Array.from(document.querySelectorAll('.chart-filter-cb:checked')).map(cb => cb.value);
        if(checked.length === 0) return showToast('Выберите линии или включите Авто');
        selectedChartFilters[type] = checked;
    }
    closeModal();
    // Обновляем только измененный график плавно
    updateTrendCharts(type);
}


// === ПОДВКЛАДКА 2: ИНСТРУМЕНТ ИНЖЕНЕРА (УМНЫЙ ПОМОЩНИК И АНАЛИЗ) ===
function renderEngineeringSubTab(data) {
    const container = document.getElementById('engineering-content-container');
    if(data.length === 0) { container.innerHTML = `<div class="p-6 text-center text-slate-500 text-sm">Нет данных по выбранным фильтрам</div>`; return; }

    const causesCount = {}; 
    let tB1 = 0, tB2 = 0, tB3 = 0, tOk = 0;
    const stageData = {}; 
    const criticalPhotos = []; 
    const systemicPhotos = [];
    const critList = [];

    data.forEach(unit => {
        const sKey = `${unit.templateTitle} | ${unit.stageName}`;
        if(!stageData[sKey]) stageData[sKey] = { checks: 0, sumUrk: 0, b3Count: 0 };
        stageData[sKey].checks++;
        
        if(unit.metrics) {
            stageData[sKey].sumUrk += unit.metrics.final; stageData[sKey].b3Count += unit.metrics.n_B3_fail;
            tB1 += unit.metrics.n_B1_fail; tB2 += unit.metrics.n_B2_fail; tB3 += unit.metrics.n_B3_fail;
        }

        if(unit.state && unit.details) {
            Object.keys(unit.state).forEach(itemId => {
                const state = unit.state[itemId];
                if(state === 'ok') tOk++;
                if(state === 'fail' || state === 'fail_escalated') {
                    let causeCode = unit.details[itemId]?.causeCode || 'C00';
                    let commentText = unit.details[itemId]?.comment || 'Без комментария';
                    causesCount[causeCode] = (causesCount[causeCode] || 0) + 1;
                    
                    if(state === 'fail_escalated' || (unit.metrics && unit.metrics.n_B3_fail > 0 && state === 'fail')) critList.push({ loc: unit.location, contr: unit.contractorName, text: commentText });
                    if(unit.photos && unit.photos[itemId]) {
                        const photoObj = { src: unit.photos[itemId], loc: unit.location, contr: unit.contractorName, text: commentText, date: new Date(unit.date).getTime() };
                        if(state === 'fail_escalated' || (unit.metrics && unit.metrics.n_B3_fail > 0 && state === 'fail')) criticalPhotos.push(photoObj);
                        else systemicPhotos.push(photoObj);
                    }
                }
            });
        }
    });

    const topCriticalPhotos = criticalPhotos.sort((a,b) => b.date - a.date).slice(0, 5);
    const topSystemicPhotos = systemicPhotos.sort((a,b) => b.date - a.date).slice(0, 5);
    const smartKey = 'global_engineering_advice';
    let rawSmartText = customExpertConclusions[smartKey] || "";

    if (!customExpertConclusions[smartKey]) {
        let totalDefects = tB1 + tB2 + tB3;
        let avgTotalUrk = Math.round((stageData[Object.keys(stageData)[0]]?.sumUrk || 0) / (stageData[Object.keys(stageData)[0]]?.checks || 1));
        if (tB3 > 0) rawSmartText += `[БЛОКИРОВКА ПРИЕМКИ]\nВыявлен критический брак (B3). Финишная сдача невозможна. Необходима остановка СМР на данных участках.\n\n`;
        let opStatus = tB3 > 0 ? "ПРОЦЕСС ЗАБЛОКИРОВАН (Наличие B3)" : (avgTotalUrk < 70 ? "РАБОТЫ ОСТАНОВЛЕНЫ (УрК < 70%)" : (avgTotalUrk < 85 ? "УСЛОВНЫЙ ДОПУСК СМР (УрК 70-84%)" : "ЦЕЛЕВОЙ ПОКАЗАТЕЛЬ (Готово к сдаче с 1-го раза)"));
        rawSmartText += `[ОПЕРАЦИОННЫЙ СТАТУС]\n${opStatus}\n\n`;
        if (totalDefects > 0) {
            let sortedCauses = Object.keys(causesCount).sort((a,b) => causesCount[b] - causesCount[a]);
            let topCauseCode = sortedCauses[0];
            let topCausePercent = Math.round((causesCount[topCauseCode] / totalDefects) * 100);
            let actText = topCauseCode === 'C01' ? "Остановить работы, пересмотреть ППР." : topCauseCode === 'C04' ? "Срочная замена или переаттестация бригады." : "Усилить операционный контроль на местах.";
            rawSmartText += `[ГЛАВНАЯ ПРИЧИНА БРАКА]\n${topCausePercent}% дефектов вызвано причиной "${DEFECT_CAUSES.find(c => c.code === topCauseCode)?.name || 'Иное'}".\nРешение: ${actText}`;
        } else {
            rawSmartText += `[АНАЛИЗ]\nПроцесс стабилен. Отклонений не выявлено.`;
        }
    }

    let uiSmartText = rawSmartText.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/^\[(.*?)\]/gm, '<div class="text-[10px] font-black text-indigo-700 dark:text-indigo-400 uppercase mt-3 mb-1">$1</div>');

    const renderPhotoGallery = (photos, title, colorClass, bgClass) => {
        if(photos.length === 0) return '';
        return `
        <div class="${bgClass} border border-[var(--card-border)] rounded-xl p-3 shadow-sm mb-4">
            <div class="text-[10px] font-black ${colorClass} uppercase mb-3 flex items-center gap-1">📸 ${title}</div>
            <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
                ${photos.map(p => `
                <div class="relative group cursor-pointer active:scale-95 transition-transform" onclick="openPhotoViewer('${p.src}')">
                    <img src="${p.src}" class="w-full h-24 object-cover rounded-lg border border-slate-200 shadow-sm">
                    <div class="absolute inset-x-0 bottom-0 bg-black/70 text-white text-[8px] p-1.5 rounded-b-lg backdrop-blur-sm truncate"><b>${p.loc}</b><br>${p.text.replace(/^\[.*?\]\s*/, '').substring(0, 30)}</div>
                </div>`).join('')}
            </div>
        </div>`;
    };

    let causesChartLabels = []; let causesChartData = [];
    Object.keys(causesCount).sort((a,b) => causesCount[b] - causesCount[a]).forEach(code => {
        const name = DEFECT_CAUSES.find(c => c.code === code)?.name || 'Иное';
        causesChartLabels.push(name.substring(0,15)); causesChartData.push(causesCount[code]);
    });

    let stagesHtml = Object.keys(stageData).map(k => {
        const avg = Math.round(stageData[k].sumUrk / stageData[k].checks);
        return `<tr class="border-b border-[var(--card-border)] hover:bg-[var(--hover-bg)]"><td class="p-2 text-[10px] font-bold whitespace-normal">${k}</td><td class="p-2 text-center text-[11px]">${stageData[k].checks}</td><td class="p-2 text-center text-[11px] font-black ${avg<70?'text-red-500':(avg<85?'text-orange-500':'text-green-600')}">${avg}%</td></tr>`;
    }).join('');

    const getSelectHtml = (type) => `
        <select onchange="updateTrendCharts('${type}', this.value)" class="text-[9px] font-bold border border-indigo-200 text-indigo-700 bg-white dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-400 rounded px-1 py-1 outline-none cursor-pointer shadow-sm">
            <option value="WEEK" ${trendGroupings[type]==='WEEK'?'selected':''}>Недели</option>
            <option value="MONTH" ${trendGroupings[type]==='MONTH'?'selected':''}>Месяцы</option>
            <option value="QUARTER" ${trendGroupings[type]==='QUARTER'?'selected':''}>Кварталы</option>
            <option value="YEAR" ${trendGroupings[type]==='YEAR'?'selected':''}>Годы</option>
        </select>
    `;

    let html = '<div class="mx-1 space-y-4">';

    // ВОТ ЗДЕСЬ СРАБАТЫВАЕТ ТОГГЛ ИЗ НАСТРОЕК ДЛЯ ИИ
    if (appSettings.anaEngAi) {
        html += `
        <div class="bg-[var(--card-bg)] border border-indigo-200 rounded-xl shadow-sm relative overflow-hidden">
            <div class="bg-indigo-50 border-b border-indigo-100 p-2 flex justify-between items-center">
                <div class="text-[10px] font-black text-indigo-600 uppercase flex items-center gap-1">🤖 AI-Анализ (Методика 70/85)</div>
                <button onclick="editExpertText('${smartKey}', 'hidden_eng_text')" class="text-[10px] font-bold bg-white text-indigo-600 border border-indigo-200 px-3 py-1 rounded shadow-sm">✏️ Редак.</button>
                <textarea id="hidden_eng_text" class="hidden">${rawSmartText}</textarea>
            </div>
            <div class="p-3 text-[11px] leading-snug space-y-2 whitespace-pre-wrap">${uiSmartText}</div>
        </div>`;
    }

    // ВОТ ЗДЕСЬ СРАБАТЫВАЕТ ТОГГЛ ДЛЯ ГАЛЕРЕИ ФОТО
    if (appSettings.anaEngPhotos) {
        html += renderPhotoGallery(topCriticalPhotos, "Критические дефекты (B3)", "text-red-600", "bg-red-50");
        html += renderPhotoGallery(topSystemicPhotos, "Системные отклонения (B2)", "text-orange-600", "bg-orange-50");
    }

    html += `
        <!-- ГРАФИКИ ТРЕНДОВ С НЕЗАВИСИМЫМИ ФИЛЬТРАМИ -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-3 shadow-sm">
                <div class="flex justify-between items-center mb-2">
                    <div class="text-[10px] font-black text-[var(--text-muted)] uppercase">Динамика: Подрядчики</div>
                    <div class="flex gap-1">
                        <button onclick="openChartFilterModal('contrs')" class="text-[9px] font-bold border border-slate-200 text-slate-600 bg-white rounded px-2 py-1 active:scale-95 shadow-sm">⚙️ Линии</button>
                        ${getSelectHtml('contrs')}
                    </div>
                </div>
                <div style="height: 180px; position: relative;"><canvas id="chart_eng_trend_contrs"></canvas></div>
            </div>
            <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-3 shadow-sm">
                <div class="flex justify-between items-center mb-2">
                    <div class="text-[10px] font-black text-[var(--text-muted)] uppercase">Динамика: Виды работ</div>
                    <div class="flex gap-1">
                        <button onclick="openChartFilterModal('works')" class="text-[9px] font-bold border border-slate-200 text-slate-600 bg-white rounded px-2 py-1 active:scale-95 shadow-sm">⚙️ Линии</button>
                        ${getSelectHtml('works')}
                    </div>
                </div>
                <div style="height: 180px; position: relative;"><canvas id="chart_eng_trend_works"></canvas></div>
            </div>
        </div>`;

    // ВОТ ЗДЕСЬ СРАБАТЫВАЕТ ТОГГЛ ДЛЯ ПАРЕТО
    if (appSettings.anaEngPareto) {
        html += `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-3 shadow-sm">
                <div class="text-[10px] font-black text-[var(--text-muted)] uppercase mb-2">Причины брака (Парето)</div>
                <div style="height: 180px; position: relative;"><canvas id="chart_eng_causes"></canvas></div>
            </div>
            <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-3 shadow-sm flex flex-col justify-center">
                <div class="text-[10px] font-black text-[var(--text-muted)] uppercase mb-2">Доля брака: ${Math.round((tB1+tB2+tB3)/(tOk+tB1+tB2+tB3)*100 || 0)}%</div>
                <div style="height: 160px; position: relative; display: flex; justify-content: center;"><canvas id="chart_eng_doughnut"></canvas></div>
            </div>
        </div>`;
    }

    if (critList.length > 0) {
        html += `
        <div class="bg-red-50 border border-red-200 rounded-xl p-3 shadow-sm mt-4">
            <div class="text-[10px] font-black text-red-600 uppercase mb-3">🚨 Реестр критических инцидентов (B3)</div>
            <div class="max-h-[250px] overflow-y-auto space-y-2 custom-scrollbar">
                ${critList.map(c => `<div class="bg-white border border-red-100 p-2.5 rounded-lg shadow-sm"><div class="flex justify-between items-start mb-1"><span class="font-black text-[11px] text-red-700">${c.loc}</span><span class="text-[9px] font-bold bg-red-100 text-red-800 px-1.5 py-0.5 rounded truncate max-w-[100px]">${c.contr}</span></div><div class="text-[10px] text-slate-700 italic">"${c.text}"</div></div>`).join('')}
            </div>
        </div>`;
    }

    html += `
        <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-3 shadow-sm mt-4">
            <div class="text-[10px] font-black text-[var(--text-muted)] uppercase mb-2">Детализация по этапам</div>
            <div class="overflow-x-auto"><table class="w-full text-left whitespace-nowrap"><thead class="bg-[var(--hover-bg)] text-[10px] text-[var(--text-muted)] border-b border-[var(--card-border)]"><tr><th class="p-2">Этап контроля</th><th class="p-2 text-center">Проверок</th><th class="p-2 text-center">УрК</th></tr></thead><tbody class="divide-y divide-[var(--card-border)]">${stagesHtml}</tbody></table></div>
        </div>
    </div>`;

    container.innerHTML = html;

    // Отрисовка графиков
    const trendContrsData = buildTrendChartData(data, 'contractorName', selectedChartFilters.contrs, trendGroupings.contrs);
    const trendWorksData = buildTrendChartData(data, 'templateTitle', selectedChartFilters.works, trendGroupings.works);

    const ctxTrendC = document.getElementById('chart_eng_trend_contrs').getContext('2d');
    chartInstances['chart_eng_trend_contrs'] = new Chart(ctxTrendC, { type: 'line', data: trendContrsData, options: { animation: false, responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100 } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: {size: 9} } } } } });

    const ctxTrendW = document.getElementById('chart_eng_trend_works').getContext('2d');
    chartInstances['chart_eng_trend_works'] = new Chart(ctxTrendW, { type: 'line', data: trendWorksData, options: { animation: false, responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100 } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: {size: 9} } } } } });

    if(appSettings.anaEngPareto && causesChartData.length > 0) {
        const ctxBar = document.getElementById('chart_eng_causes').getContext('2d');
        chartInstances['chart_eng_causes'] = new Chart(ctxBar, { type: 'bar', indexAxis: 'y', data: { labels: causesChartLabels, datasets: [{ data: causesChartData, backgroundColor: '#6366f1', borderRadius: 4 }] }, options: { animation: false, responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });
    }
    if(appSettings.anaEngPareto && (tB1 > 0 || tB2 > 0 || tB3 > 0)) {
        const ctxPie = document.getElementById('chart_eng_doughnut').getContext('2d');
        chartInstances['chart_eng_doughnut'] = new Chart(ctxPie, { type: 'doughnut', data: { labels: ['B1', 'B2', 'B3'], datasets: [{ data: [tB1, tB2, tB3], backgroundColor: ['#3b82f6', '#f97316', '#ef4444'], borderWidth: 0 }] }, options: { animation: false, responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: {size: 10} } } } } });
    }
}

// === ПОДВКЛАДКА 3: ДАШБОРД РУКОВОДИТЕЛЯ (PDCA: CHECK & ACT) ===
function renderOnePagerSubTab(data) {
    const container = document.getElementById('onepager-content-container');
    if(data.length === 0) { container.innerHTML = `<div class="text-center text-slate-500 text-sm py-10">Нет данных для анализа</div>`; return; }

    const uniqueLocs = [...new Set(data.map(i => i.location))];
    const uniqueWorks = [...new Set(data.map(i => i.templateTitle))];
    const avgCoverage = uniqueWorks.length > 0 ? Math.round(data.length / uniqueWorks.length) : 0;

    // 1. Расчет УрК и Рейтинга Подрядчиков
    const groupedC = {};
    data.forEach(item => { 
        groupedC[item.contractorName] = groupedC[item.contractorName] || []; 
        groupedC[item.contractorName].push(item); 
    });
    
    let sumUrk = 0, validContrs = 0;
    let best = null, worst = null;
    const ratingData = [];

    for(let cName in groupedC) {
        if (groupedC[cName].length >= 3) {
            const m = getContractorMetrics(groupedC[cName], userTemplates);
            if (m) {
                sumUrk += m.finalC;
                validContrs++;
                ratingData.push({ name: cName, val: m.finalC });
                if (!best || m.finalC > best.val) best = { name: cName, val: m.finalC };
                if (!worst || m.finalC < worst.val) worst = { name: cName, val: m.finalC };
            }
        }
    }
    const globalUrk = validContrs > 0 ? Math.round(sumUrk / validContrs) : Math.round(data.reduce((s, i) => s + (i.metrics?.final || 0), 0) / (data.length || 1));
    ratingData.sort((a,b) => b.val - a.val);

    // 2. Динамика
    const sortedData = [...data].sort((a,b) => new Date(a.date) - new Date(b.date));
    const midPoint = Math.floor(sortedData.length / 2);
    const calcSimpleUrk = (arr) => arr.length > 0 ? Math.round(arr.reduce((s, i) => s + (i.metrics?.final || 0), 0) / arr.length) : 0;
    const delta = (calcSimpleUrk(sortedData.slice(0, midPoint)) > 0 && calcSimpleUrk(sortedData.slice(midPoint)) > 0) ? (calcSimpleUrk(sortedData.slice(midPoint)) - calcSimpleUrk(sortedData.slice(0, midPoint))) : 0;

    // 3. Сбор ТОП-5 Дефектов B3 и B2
    let b3Map = {}; 
    let b2Map = {};
    let sumB3 = 0;

    data.forEach(i => {
        if(i.metrics) sumB3 += i.metrics.n_B3_fail;
        if(i.state && i.details) {
            Object.keys(i.state).forEach(id => {
                const s = i.state[id];
                if(s === 'fail' || s === 'fail_escalated') {
                    let defName = "Дефект";
                    const tType = i.templateKey.split('_')[0];
                    const tKey = i.templateKey.replace(tType + '_', '');
                    const cl = tType === 'sys' && SYSTEM_TEMPLATES[tKey] ? SYSTEM_TEMPLATES[tKey].groups : (userTemplates[tKey] ? userTemplates[tKey].groups : []);
                    const flat = getFlatList(cl);
                    const foundItem = flat.find(x => x.id == id);
                    if(foundItem) defName = foundItem.n;

                    const photo = (i.photos && i.photos[id]) ? i.photos[id] : null;
                    const contr = i.contractorName;

                    if (s === 'fail_escalated' || (i.metrics && i.metrics.n_B3_fail > 0)) {
                        if (!b3Map[defName]) b3Map[defName] = { count: 0, photo: null, contr: contr, name: defName };
                        b3Map[defName].count++;
                        if (photo) b3Map[defName].photo = photo; 
                    } else {
                        if (!b2Map[defName]) b2Map[defName] = { count: 0, photo: null, contr: contr, name: defName };
                        b2Map[defName].count++;
                        if (photo) b2Map[defName].photo = photo;
                    }
                }
            });
        }
    });

    const topB3 = Object.values(b3Map).sort((a,b) => b.count - a.count).slice(0, 5);
    const topB2 = Object.values(b2Map).sort((a,b) => b.count - a.count).slice(0, 5);

    // Функция генерации сетки фото для UI
    const renderUIPhotoCards = (arr, isCrit) => {
        if (arr.length === 0) return `<div class="text-center py-6 text-[var(--text-muted)] text-[11px] bg-[var(--hover-bg)] rounded-lg border border-dashed border-[var(--card-border)]">Дефектов не зафиксировано</div>`;
        while(arr.length < 5) { arr.push({ empty: true }); }

        return `<div class="grid grid-cols-5 gap-1.5 min-[400px]:gap-2">
            ${arr.map(d => {
                if (d.empty) return `<div class="border border-dashed border-[var(--card-border)] rounded-lg opacity-30 bg-[var(--card-bg)] min-h-[80px]"></div>`;
                
                const imgHtml = d.photo 
                    ? `<img src="${d.photo}" class="w-full h-14 min-[400px]:h-20 object-cover border-b border-[var(--card-border)] cursor-pointer active:scale-95" onclick="openPhotoViewer('${d.photo}')">` 
                    : `<div class="w-full h-14 min-[400px]:h-20 bg-[var(--hover-bg)] flex items-center justify-center text-[var(--card-border)] text-[8px] border-b border-[var(--card-border)]">НЕТ ФОТО</div>`;
                
                const badgeColor = isCrit ? 'text-red-700 bg-red-100 border-red-200 dark:bg-red-900/50 dark:border-red-800' : 'text-orange-700 bg-orange-100 border-orange-200 dark:bg-orange-900/50 dark:border-orange-800';

                return `
                <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg overflow-hidden flex flex-col shadow-sm">
                    ${imgHtml}
                    <div class="p-1 min-[400px]:p-1.5 flex-1 flex flex-col justify-between">
                        <div class="text-[7px] min-[400px]:text-[8px] font-bold text-slate-800 dark:text-slate-200 leading-tight line-clamp-2 mb-1">${d.name}</div>
                        <div>
                            <div class="text-[6px] min-[400px]:text-[7px] text-[var(--text-muted)] mb-0.5 truncate w-full">👤 ${d.contr}</div>
                            <div class="flex justify-between items-center">
                                <span class="${badgeColor} text-[6px] min-[400px]:text-[7px] font-black px-1 rounded border">${isCrit ? 'B3' : 'B2'}</span>
                                <span class="text-[7px] min-[400px]:text-[8px] font-black text-[var(--text-muted)]">${d.count} шт</span>
                            </div>
                        </div>
                    </div>
                </div>`;
            }).join('')}
        </div>`;
    };

    const urkColor = globalUrk < 70 ? 'text-red-600' : (globalUrk < 85 ? 'text-orange-500' : 'text-green-600');

    const getSelectHtml = (type) => `
        <select onchange="updateTrendCharts('${type}', this.value)" class="text-[9px] font-bold border border-indigo-200 text-indigo-700 bg-white dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-400 rounded px-1 py-1 shadow-sm outline-none">
            <option value="WEEK" ${trendGroupings[type]==='WEEK'?'selected':''}>Недели</option>
            <option value="MONTH" ${trendGroupings[type]==='MONTH'?'selected':''}>Месяцы</option>
            <option value="QUARTER" ${trendGroupings[type]==='QUARTER'?'selected':''}>Кварталы</option>
            <option value="YEAR" ${trendGroupings[type]==='YEAR'?'selected':''}>Годы</option>
        </select>
    `;

    // ================= ГЕНЕРАЦИЯ HTML ДЛЯ ИНТЕРФЕЙСА =================
    let html = `
        <div class="text-center border-b border-[var(--card-border)] pb-3 mb-4">
            <h2 class="text-[16px] min-[400px]:text-lg font-black uppercase tracking-tight text-slate-800 dark:text-white">Сводный статус объекта</h2>
            <div class="text-[10px] font-bold text-[var(--text-muted)] mt-1">Охват: ${data.length} проверок | ${uniqueLocs.length} изделий</div>
        </div>
        
        <div class="flex flex-col md:flex-row gap-4 items-stretch">
            
            <!-- ЛЕВАЯ КОЛОНКА (МЕТРИКИ, ТРЕНД, РЕЙТИНГ) -->
            <div class="flex-1 flex flex-col gap-4 md:w-1/2 md:border-r md:border-dashed md:border-[var(--card-border)] md:pr-4">
                
                <!-- Метрики 2x2 -->
                <div class="grid grid-cols-2 gap-2 min-[400px]:gap-3">
                    <div class="bg-[var(--card-bg)] rounded-xl p-3 border border-[var(--card-border)] text-center shadow-sm relative overflow-hidden flex flex-col justify-center">
                        <div class="text-[9px] min-[400px]:text-[10px] uppercase font-black text-[var(--text-muted)] mb-1">Ср. УрК Объекта</div>
                        <div class="text-3xl min-[400px]:text-4xl font-black ${urkColor}">${globalUrk}%</div>
                        ${delta !== 0 ? `<div class="absolute top-1 right-1 min-[400px]:top-2 min-[400px]:right-2 text-[8px] min-[400px]:text-[9px] font-black px-1.5 py-0.5 rounded ${delta > 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/30' : 'bg-red-100 text-red-700 dark:bg-red-900/30'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}%</div>` : ''}
                    </div>
                    <div class="bg-[var(--card-bg)] rounded-xl p-3 border border-[var(--card-border)] text-center shadow-sm flex flex-col justify-center">
                        <div class="text-[9px] min-[400px]:text-[10px] uppercase font-black text-[var(--text-muted)] mb-1">Охват проверок</div>
                        <div class="text-3xl min-[400px]:text-4xl font-black text-blue-500">${avgCoverage}</div>
                        <div class="text-[8px] text-[var(--text-muted)] mt-1">в среднем на вид работ</div>
                    </div>
                    
                    ${appSettings.anaOpLeader ? `
                    <div class="bg-green-50 dark:bg-green-900/20 rounded-xl p-2.5 border border-green-200 dark:border-green-800 text-center shadow-sm flex flex-col justify-center">
                        <div class="text-[8px] min-[400px]:text-[9px] uppercase font-black text-green-700 dark:text-green-500 mb-1">🏆 Лидер качества</div>
                        <div class="text-[11px] min-[400px]:text-xs font-black text-green-900 dark:text-green-300 truncate">${best ? best.name : 'Нет данных'}</div>
                    </div>
                    <div class="bg-red-50 dark:bg-red-900/20 rounded-xl p-2.5 border border-red-200 dark:border-red-800 text-center shadow-sm flex flex-col justify-center">
                        <div class="text-[8px] min-[400px]:text-[9px] uppercase font-black text-red-700 dark:text-red-500 mb-1">⚠️ Зона риска</div>
                        <div class="text-[11px] min-[400px]:text-xs font-black text-red-900 dark:text-red-300 truncate">${worst ? worst.name : 'Нет данных'}</div>
                    </div>` : ''}
                </div>

                <!-- Тренд Подрядчиков -->
                ${appSettings.anaOpTrend ? `
                <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-3 shadow-sm flex flex-col">
                    <div class="flex justify-between items-center mb-2">
                        <div class="text-[10px] font-black text-[var(--text-muted)] uppercase">📉 Динамика подрядчиков</div>
                        ${getSelectHtml('contrs')}
                    </div>
                    <div style="height: 160px; position: relative;"><canvas id="chart_op_trend_contrs"></canvas></div>
                </div>` : ''}

                <!-- Рейтинг Подрядчиков (Гистограмма) -->
                <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-3 shadow-sm flex-1">
                    <div class="text-[10px] font-black text-[var(--text-muted)] uppercase mb-3">📊 Рейтинг (УрК)</div>
                    <div class="space-y-2.5">
                        ${ratingData.slice(0,5).map(r => `
                            <div class="flex items-center gap-2">
                                <div class="w-20 text-[9px] min-[400px]:text-[10px] font-bold text-slate-700 dark:text-slate-300 truncate">${r.name}</div>
                                <div class="flex-1 h-2.5 min-[400px]:h-3 bg-[var(--hover-bg)] rounded-full overflow-hidden border border-[var(--card-border)]">
                                    <div class="h-full ${r.val < 70 ? 'bg-red-500' : (r.val < 85 ? 'bg-orange-500' : 'bg-green-500')}" style="width:${r.val}%"></div>
                                </div>
                                <div class="w-6 text-right text-[9px] min-[400px]:text-[10px] font-black ${r.val < 70 ? 'text-red-500' : (r.val < 85 ? 'text-orange-500' : 'text-green-500')}">${r.val}%</div>
                            </div>
                        `).join('') || '<div class="text-[10px] text-[var(--text-muted)] text-center py-2">Недостаточно данных</div>'}
                    </div>
                </div>

            </div>

            <!-- ПРАВАЯ КОЛОНКА (ТОП-5, ФОТО, PDCA) -->
            <div class="flex-1 flex flex-col gap-4 md:w-1/2">
                
                ${appSettings.anaOpTopDefects ? `
                <!-- ТОП-5 B3 -->
                <div class="flex-1 bg-red-50 dark:bg-red-900/10 border-2 border-red-200 dark:border-red-800/50 rounded-xl p-3 shadow-sm flex flex-col">
                    <h3 class="margin-0 mb-3 font-black text-[10px] min-[400px]:text-[11px] color-red-700 text-red-700 dark:text-red-500 uppercase border-b border-red-200 dark:border-red-800 pb-2">
                        🚨 ТОП-5 Критических дефектов (B3)
                    </h3>
                    <div class="flex-1">
                        ${renderUIPhotoCards(topB3, true)}
                    </div>
                </div>

                <!-- ТОП-5 B2 -->
                <div class="flex-1 bg-orange-50 dark:bg-orange-900/10 border-2 border-orange-200 dark:border-orange-800/50 rounded-xl p-3 shadow-sm flex flex-col">
                    <h3 class="margin-0 mb-3 font-black text-[10px] min-[400px]:text-[11px] color-orange-700 text-orange-700 dark:text-orange-500 uppercase border-b border-orange-200 dark:border-orange-800 pb-2">
                        🔄 ТОП-5 Повторяющихся (B2)
                    </h3>
                    <div class="flex-1">
                        ${renderUIPhotoCards(topB2, false)}
                    </div>
                </div>
                ` : ''}

                <!-- Управленческое решение (PDCA) -->
                <div class="${globalUrk < 85 || sumB3 > 0 ? 'bg-orange-50 border-orange-200 dark:bg-orange-900/20 dark:border-orange-800' : 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'} border-2 rounded-xl p-3 shadow-sm flex-none">
                    <h3 class="margin-0 mb-2 font-black text-[10px] min-[400px]:text-[11px] ${globalUrk < 85 || sumB3 > 0 ? 'text-orange-800 dark:text-orange-500' : 'text-green-800 dark:text-green-500'} uppercase border-b ${globalUrk < 85 || sumB3 > 0 ? 'border-orange-200 dark:border-orange-800' : 'border-green-200 dark:border-green-800'} pb-2">
                        🎯 Управленческое Решение и Риски
                    </h3>
                    <div class="text-[10px] min-[400px]:text-[11px] line-height-relaxed text-slate-800 dark:text-slate-200 flex flex-col gap-2">
                        ${sumB3 > 0 ? `<div class="text-red-600 dark:text-red-400"><b>🚨 КРИТИЧЕСКИЙ РИСК:</b> Выявлено <b>${sumB3}</b> инцидентов B3. Продолжение работ без устранения грозит финансовыми потерями.</div>` : ''}
                        <div><b>📉 СТАТУС:</b> ${globalUrk < 70 ? 'Процесс вне контроля (<70%). Идет накопление брака, требуются жесткие меры.' : (globalUrk < 85 ? 'Условный допуск (70-84%). Есть системные ошибки, запрет на финишную приемку.' : 'Целевая зона (>=85%). Процесс стабилен, качество высокое.')}</div>
                        <div class="bg-white dark:bg-slate-800 p-2 rounded-lg border border-[var(--card-border)] mt-1"><b>🔨 ДИРЕКТИВА:</b> ${globalUrk < 70 || sumB3 > 0 ? `Приостановить работы аутсайдера (<b>${worst ? worst.name : 'н/д'}</b>). Выдать предписание на немедленный демонтаж/исправление брака. Ограничить оплату КС-2.` : 'Работы выполняются в соответствии с регламентом. Продолжить СМР в текущем режиме.'}</div>
                    </div>
                </div>

            </div>
        </div>
    `;

    container.innerHTML = html;

    // Инициализация графиков
    if (appSettings.anaOpTrend) {
        const trendContrsData = buildTrendChartData(data, 'contractorName', selectedChartFilters.contrs, trendGroupings.contrs);
        const ctxTC = document.getElementById('chart_op_trend_contrs').getContext('2d');
        chartInstances['chart_op_trend_contrs'] = new Chart(ctxTC, { type: 'line', data: trendContrsData, options: { animation: false, responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100 } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: {size: 9} } } } } });
    }
}

// === ПОДВКЛАДКА 4: СЫРЫЕ ДАННЫЕ (ТАБЛИЦА) ===
function renderDataSubTab(data) {
    const tbody = document.getElementById('data-table-body');
    if(!tbody) return;

    if(data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-[var(--text-muted)]">Нет данных</td></tr>`;
        return;
    }

    const sortedData = [...data].sort((a,b) => new Date(b.date) - new Date(a.date));
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
                <td class="p-2 max-w-[80px] truncate text-slate-600 font-medium" title="${r.inspectorName || 'Не указан'}">${r.inspectorName || '-'}</td>
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
        scheduleSessionSave(); // Сохраняем в память
        if (typeof renderCurrentAnalyticsTab === 'function') renderCurrentAnalyticsTab();
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
    scheduleSessionSave(); // Сохраняем в базу, чтобы не пропало после перезагрузки
    
    if (typeof renderCurrentAnalyticsTab === 'function') renderCurrentAnalyticsTab(); // Перерисовываем текущую вкладку
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
    // ВНЕДРЕНИЕ БИЗНЕС-ЛОГИКИ УРк (70% и 85%)
    const hasB3 = c.n_изделий_с_B3 > 0;
    // Наличие B3 безусловно переводит в красную зону
    const isRed = c.finalC < 70 || hasB3; 
    const isYellow = c.finalC >= 70 && c.finalC < 85 && !hasB3;
    const isGreen = c.finalC >= 85 && !hasB3;

    const b3Str = hasB3 ? `🚨 КРИТИЧЕСКИЙ БРАК (B3): выявлено на ${c.n_изделий_с_B3} ед. Это блокирует дальнейшие операции!` : `Критический брак (B3) отсутствует.`;
    
    switch(scenario) {
        case 'strict':
            return `ОФИЦИАЛЬНАЯ ПРЕТЕНЗИЯ (ПРЕДПИСАНИЕ)\n\nКому: Руководителю проекта от организации "${cName}".\nКасательно: Неудовлетворительное качество работ по виду "${tTitle}".\n\nПо результатам строительного контроля (выборка: ${count} ед.) Уровень Качества (УрК) составил ${c.finalC}%.\n\n${isRed ? '❌ ПОКАЗАТЕЛЬ НИЖЕ 70% ИЛИ ВЫЯВЛЕН B3. ПРОДОЛЖЕНИЕ РАБОТ ЗАПРЕЩЕНО.\nКачество находится в неуправляемом диапазоне. Требуется немедленная остановка СМР.' : (isYellow ? '⚠️ ПОКАЗАТЕЛЬ 70-84%. СТАТУС: "УСЛОВНО ВЫПОЛНЕНО".\nКачество в допустимом диапазоне для этапа СМР, однако финишная приемка невозможна до полного устранения дефектов.' : '✅ ПОКАЗАТЕЛЬ > 85%. РАБОТЫ ПРИНИМАЮТСЯ.')}\n\nФакты нарушений:\n- ${b3Str}\n- Системный повтор дефектов: ${c.maxFailRate.toFixed(1)}%\n\nТРЕБОВАНИЯ:\n1. Устранить все критические (B3) и значимые (B2) замечания.\n2. Предъявить исправленные объемы повторно.\nВ случае неустранения, данные дефекты напрямую повлияют на показатель "сдача клиенту с первого раза". Применить компенсационные удержания.`;
            
        case 'tech':
            return `ТЕХНИЧЕСКИЙ АУДИТ КАЧЕСТВА (МЕТОДИКА 70/85)\n\nПодрядчик: ${cName}\nРаздел: ${tTitle}\nВыборка: ${count} независимых проверок\n\n[МЕТРИКИ ИНЖИНИРИНГА]\n• Итоговый УрК: ${c.finalC}%\n• Коэф. системного брака (Ks): ${c.ks.toFixed(2)} (макс. частота дефекта ${c.maxFailRate.toFixed(1)}%)\n• Коэф. критичности (Kcrit): ${c.kcritC.toFixed(2)} (доля брака B3: ${c.rateB3.toFixed(1)}%)\n\n[СТАТУС И ВЫВОДЫ]\n${isRed ? '🔴 ПРОЦЕСС ЗАБЛОКИРОВАН (УрК < 70% или есть B3). Опасные и неуправляемые дефекты. Строительство данного участка необходимо остановить.' : (isYellow ? '🟡 ОПЕРАЦИОННЫЙ КОМПРОМИСС (УрК 70-84%). Технология соблюдается, но есть значимые отклонения. Допускается продолжение СМР (условный допуск), но финишная сдача невозможна.' : '🟢 ЦЕЛЕВОЙ ПОКАЗАТЕЛЬ (УрК >= 85%). Плотность дефектов минимальна. Остаточные дефекты носят косметический характер и не повлияют на сдачу с первого раза.')}`;
            
        case 'boss':
            return `ИНФОРМАЦИОННАЯ СПРАВКА ДЛЯ РУКОВОДСТВА\n\n🏗 Подрядчик: ${cName}\n📊 Бизнес-прогноз: ${isRed ? '🔴 ВЫСОКИЙ РИСК СРЫВА ПЕРЕДАЧИ КЛИЕНТУ' : (isYellow ? '🟡 ТРЕБУЮТСЯ ДОРАБОТКИ ПЕРЕД ФИНИШЕМ' : '🟢 ВЫСОКАЯ ВЕРОЯТНОСТЬ СДАЧИ С 1-ГО РАЗА')}\n📉 Рейтинг (УрК): ${c.finalC}%\n\nКлючевые тезисы:\n1. ${b3Str}\n2. ${isRed ? 'Работы остановлены. Идет развитие опасных дефектов.' : (isYellow ? 'Этап СМР продолжается, но на финише возможен "дефектный хвост". Нужен контроль устранения.' : 'Отличный результат. Достигнута точка оптимума, ресурсы на избыточный "перфекционизм" не тратятся.')}\n\nРезюме:\n${isRed ? 'Рекомендуется применить штрафы/удержания. Подрядчик не справляется.' : (isYellow ? 'Подрядчик работает удовлетворительно. Необходим контроль закрытия предписаний.' : 'Надежный партнер. Опережающий индикатор УрК гарантирует успешную передачу объекта.')}`;
            
        case 'action_plan':
            return `ПЛАН КОРРЕКТИРУЮЩИХ МЕРОПРИЯТИЙ (PDCA)\n\nПодрядчик: ${cName} | УрК: ${c.finalC}% (Цель: >85%)\n\nШАГ 1. БЛОКИРОВКА (${b3Str})\n- ${hasB3 ? 'Остановить работы на участках с B3 до устранения.' : 'Ограничений по B3 нет.'}\n\nШАГ 2. ПЕРЕХОД ИЗ СМР В ФИНИШ (Текущий статус: ${isYellow ? 'Условно выполнено' : (isRed ? 'Не принято' : 'Принято')})\n- Устранить все дефекты B2. Наличие не устраненного B2 блокирует подписание финального акта.\n\nШАГ 3. ПРОФИЛАКТИКА СИСТЕМНОГО БРАКА (Частота: ${c.maxFailRate.toFixed(1)}%)\n- Провести аудит квалификации исполнителей.\n- Оценить наличие и соблюдение ТК на рабочих местах.`;
            
        case 'finance':
            return `СЛУЖЕБНАЯ ЗАПИСКА (ОПЛАТА И КС-2)\n\nПодрядчик: ${cName}\nВид работ: ${tTitle} | Итоговый УрК: ${c.finalC}%\n\nЗАКЛЮЧЕНИЕ СТРОИТЕЛЬНОГО КОНТРОЛЯ:\n${isRed ? '🔴 ЗАПРЕТ НА ПОДПИСАНИЕ КС-2. УрК ниже 70% или выявлен критический дефект. Применить компенсационные удержания.' : (isYellow ? '🟡 УСЛОВНЫЙ ДОПУСК К КС-2 (Этап СМР). Разрешается частичная оплата, но финальный расчет (финишная сдача) заблокирован до доведения УрК до 85%.' : '🟢 ОПЛАТА БЕЗ ОГРАНИЧЕНИЙ. УрК >= 85%. Работы выполнены экономически и технически рационально, остаточные дефекты косметические.')}\n\n${b3Str}`;
            
        default:
            return `ЭКСПЕРТНОЕ ЗАКЛЮЧЕНИЕ\n\nКачество работ подрядчика "${cName}" оценивается на ${c.finalC}%.\n\n[Бизнес-метрика]\n${isRed ? 'Остановка работ (<70%).' : (isYellow ? 'Условный допуск СМР (70-84%). Финишная сдача невозможна.' : 'Готовность к сдаче клиенту с 1-го раза (>=85%).')}\n\n[Проблемы]\n• ${c.maxFailRate >= 20 ? `Системный брак: ${c.maxFailRate.toFixed(1)}%.` : 'Системных отклонений не выявлено.'}\n• ${b3Str}\n\n[Вывод]\n${isRed ? 'Требуется полная переделка.' : (isYellow ? 'Устранить B2 перед финишем.' : 'Работы приняты.')}`;
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
    const stageData = {}; const criticalPhotos = []; const systemicPhotos = []; const critList = [];
    let tB1 = 0, tB2 = 0, tB3 = 0, tOk = 0;

    data.forEach(unit => {
        const sKey = `${unit.templateTitle} | ${unit.stageName}`;
        if(!stageData[sKey]) stageData[sKey] = { checks: 0, sumUrk: 0, b3Count: 0 };
        stageData[sKey].checks++;
        if(unit.metrics) { stageData[sKey].sumUrk += unit.metrics.final; stageData[sKey].b3Count += unit.metrics.n_B3_fail; tB1 += unit.metrics.n_B1_fail; tB2 += unit.metrics.n_B2_fail; tB3 += unit.metrics.n_B3_fail; }

        if(unit.state && unit.details) {
            Object.keys(unit.state).forEach(itemId => {
                const state = unit.state[itemId];
                if(state === 'ok') tOk++;
                if(state === 'fail' || state === 'fail_escalated') {
                    const txt = unit.details[itemId]?.comment || 'Без описания';
                    if(state === 'fail_escalated' || (unit.metrics && unit.metrics.n_B3_fail > 0 && state==='fail')) critList.push({ loc: unit.location, contr: unit.contractorName, text: txt });
                    if(unit.photos && unit.photos[itemId]) {
                        const pData = { src: unit.photos[itemId], loc: unit.location, text: txt, date: new Date(unit.date).getTime() };
                        if(state === 'fail_escalated' || (unit.metrics && unit.metrics.n_B3_fail > 0 && state==='fail')) criticalPhotos.push(pData);
                        else systemicPhotos.push(pData);
                    }
                }
            });
        }
    });

    const topB3 = criticalPhotos.sort((a,b) => b.date - a.date).slice(0, 5);
    const topB2 = systemicPhotos.sort((a,b) => b.date - a.date).slice(0, 5);

    const cBar = document.getElementById('chart_eng_causes');
    const cPie = document.getElementById('chart_eng_doughnut');
    const cTrendC = document.getElementById('chart_eng_trend_contrs');
    const cTrendW = document.getElementById('chart_eng_trend_works');
    
    const imgBar = cBar ? `<img style="width:100%; max-height:200px; object-fit:contain;" src="${cBar.toDataURL('image/png')}">` : '';
    const imgPie = cPie ? `<img style="width:100%; max-height:200px; object-fit:contain;" src="${cPie.toDataURL('image/png')}">` : '';
    const imgTrendC = cTrendC ? `<img style="width:100%; max-height:200px; object-fit:contain;" src="${cTrendC.toDataURL('image/png')}">` : '';
    const imgTrendW = cTrendW ? `<img style="width:100%; max-height:200px; object-fit:contain;" src="${cTrendW.toDataURL('image/png')}">` : '';

    let rawSmartText = customExpertConclusions['global_engineering_advice'] || "Смарт-анализ не сгенерирован.";
    let formattedSmartText = rawSmartText.replace(/\n/g, "<br>").replace(/^\[(.*?)\]/gm, '<div style="color:#4f46e5; font-size:12px; font-weight:900; margin-top:10px; margin-bottom:2px;">$1</div>');

    let stagesHtml = Object.keys(stageData).map(k => {
        const avg = Math.round(stageData[k].sumUrk / stageData[k].checks);
        return `<tr><td>${k}</td><td class="text-center">${stageData[k].checks}</td><td class="text-center font-bold" style="color:${avg<70?'#dc2626':(avg<85?'#f59e0b':'#16a34a')}">${avg}%</td><td class="text-center">${stageData[k].b3Count>0?'🚨 Да':'Нет'}</td></tr>`;
    }).join('');

    const renderPdfGallery = (photos, title, borderColor, bgColor) => {
        if(photos.length === 0) return '';
        return `
        <div class="avoid-break mt-20" style="background:${bgColor}; border:1px solid ${borderColor}; padding:15px; border-radius:10px;">
            <h3 style="margin-top:0; border-bottom:2px solid ${borderColor}; padding-bottom:5px; color:#1e293b; font-size:14px;">📸 ${title}</h3>
            <div class="photo-grid">
                ${photos.map(p => `<div class="photo-card" style="border-color:${borderColor};"><img src="${p.src}"><div class="photo-label"><b>${p.loc}</b><br><span style="color:#475569;">${p.text.replace(/^\[.*?\]\s*/, '')}</span></div></div>`).join('')}
            </div>
        </div>`;
    };

    const content = `
        <h2 class="section-title">Инженерный Анализ (Отчет)</h2>
        <div class="avoid-break" style="background:#f8fafc; border:2px solid #cbd5e1; padding:15px; border-radius:10px; margin-bottom:20px;">
            <h3 style="margin:0 0 10px 0; color:#0f172a; font-size:14px;">🤖 Заключение и План действий</h3>
            <div style="font-size:12px; line-height:1.5;">${formattedSmartText}</div>
        </div>
        ${renderPdfGallery(topB3, "Критические дефекты (B3)", "#fecaca", "#fef2f2")}
        ${renderPdfGallery(topB2, "Системные отклонения (B2)", "#fed7aa", "#fff7ed")}

        <div class="grid-3 mt-20 mb-20 avoid-break">
            <div style="background:#f8fafc; border:1px solid #cbd5e1; padding:15px; border-radius:8px; text-align:center;"><div style="font-size:10px; color:#64748b; text-transform:uppercase; font-weight:bold;">Доля брака</div><div style="font-size:24px; font-weight:900;">${Math.round((tB1+tB2+tB3)/(tOk+tB1+tB2+tB3)*100 || 0)}%</div></div>
            <div style="background:#f8fafc; border:1px solid #cbd5e1; padding:15px; border-radius:8px; text-align:center;"><div style="font-size:10px; color:#64748b; text-transform:uppercase; font-weight:bold;">Плотность B2</div><div style="font-size:24px; font-weight:900; color:#f59e0b;">${(tB2/data.length || 0).toFixed(1)}</div></div>
            <div style="background:#fef2f2; border:1px solid #fecaca; padding:15px; border-radius:8px; text-align:center;"><div style="font-size:10px; color:#991b1b; text-transform:uppercase; font-weight:bold;">Индекс B3</div><div style="font-size:24px; font-weight:900; color:#dc2626;">${(tB3/data.length*100 || 0).toFixed(0)}%</div></div>
        </div>

        <div class="grid-2 mt-20 mb-20 avoid-break">
            <div style="background:#f8fafc; border:1px solid #cbd5e1; padding:15px; border-radius:8px; text-align:center;"><div style="font-size:11px; font-weight:bold; margin-bottom:10px; text-transform:uppercase;">Тренд Подрядчиков</div>${imgTrendC}</div>
            <div style="background:#f8fafc; border:1px solid #cbd5e1; padding:15px; border-radius:8px; text-align:center;"><div style="font-size:11px; font-weight:bold; margin-bottom:10px; text-transform:uppercase;">Тренд Видов Работ</div>${imgTrendW}</div>
        </div>

        <div class="grid-2 mt-20 mb-20 avoid-break">
            <div style="background:#f8fafc; border:1px solid #cbd5e1; padding:15px; border-radius:8px; text-align:center;"><div style="font-size:11px; font-weight:bold; margin-bottom:10px; text-transform:uppercase;">Корневые причины</div>${imgBar}</div>
            <div style="background:#f8fafc; border:1px solid #cbd5e1; padding:15px; border-radius:8px; text-align:center;"><div style="font-size:11px; font-weight:bold; margin-bottom:10px; text-transform:uppercase;">Структура нарушений</div>${imgPie}</div>
        </div>

        ${critList.length > 0 ? `
        <div class="avoid-break mt-20 mb-20" style="background:#fef2f2; border:1px solid #fecaca; padding:15px; border-radius:8px;">
            <h3 style="margin:0 0 10px 0; color:#dc2626; font-size:14px;">🚨 Реестр критических инцидентов (B3)</h3>
            ${critList.map(c => `<div style="background:white; border:1px solid #fecaca; padding:8px; border-radius:6px; margin-bottom:5px; font-size:11px;"><b>${c.loc}</b> (${c.contr}): ${c.text}</div>`).join('')}
        </div>` : ''}

        <table class="data-table mt-20 avoid-break">
            <thead><tr><th>Этап контроля</th><th>Проверок</th><th>Средний УрК</th><th>Крит. дефекты (B3)</th></tr></thead>
            <tbody>${stagesHtml}</tbody>
        </table>
    `;
    printPdfShell("Инженерный Отчет", content);
}


// 3. PDF: One-Pager для Руководства
function exportPdfOnePager(data) {
    if(data.length === 0) return showToast('Нет данных для выгрузки');

    // 1. МЕТРИКИ: Охват и База
    const uniqueWorks = [...new Set(data.map(i => i.templateTitle))];
    const avgCoverage = uniqueWorks.length > 0 ? Math.round(data.length / uniqueWorks.length) : 0;

    // 2. МЕТРИКИ: УрК Подрядчиков и Рейтинг
    const groupedC = {};
    data.forEach(item => { 
        groupedC[item.contractorName] = groupedC[item.contractorName] || []; 
        groupedC[item.contractorName].push(item); 
    });
    
    let sumUrk = 0, validContrs = 0;
    let best = null, worst = null;
    const ratingData = [];

    for(let cName in groupedC) {
        if (groupedC[cName].length >= 3) {
            const m = getContractorMetrics(groupedC[cName], userTemplates);
            if (m) {
                sumUrk += m.finalC;
                validContrs++;
                ratingData.push({ name: cName, val: m.finalC, count: m.count });
                if (!best || m.finalC > best.val) best = { name: cName, val: m.finalC };
                if (!worst || m.finalC < worst.val) worst = { name: cName, val: m.finalC };
            }
        }
    }
    const globalUrk = validContrs > 0 ? Math.round(sumUrk / validContrs) : Math.round(data.reduce((s, i) => s + (i.metrics?.final || 0), 0) / (data.length || 1));
    
    // Сортируем рейтинг по убыванию
    ratingData.sort((a,b) => b.val - a.val);

    // 3. МЕТРИКИ: Динамика (1-я половина выборки vs 2-я половина)
    const sortedData = [...data].sort((a,b) => new Date(a.date) - new Date(b.date));
    const midPoint = Math.floor(sortedData.length / 2);
    const firstHalf = sortedData.slice(0, midPoint);
    const secondHalf = sortedData.slice(midPoint);
    
    const calcSimpleUrk = (arr) => arr.length > 0 ? Math.round(arr.reduce((s, i) => s + (i.metrics?.final || 0), 0) / arr.length) : 0;
    const u1 = calcSimpleUrk(firstHalf);
    const u2 = calcSimpleUrk(secondHalf);
    const delta = (u1 > 0 && u2 > 0) ? (u2 - u1) : 0;

    // 4. ДЕФЕКТЫ: Сбор ТОП-5 B3 и B2 с фото
    let b3Map = {}; 
    let b2Map = {};
    let sumB3 = 0;

    data.forEach(i => {
        if(i.metrics) sumB3 += i.metrics.n_B3_fail;
        if(i.state && i.details) {
            Object.keys(i.state).forEach(id => {
                const s = i.state[id];
                if(s === 'fail' || s === 'fail_escalated') {
                    let defName = "Дефект";
                    const tType = i.templateKey.split('_')[0];
                    const tKey = i.templateKey.replace(tType + '_', '');
                    const cl = tType === 'sys' && SYSTEM_TEMPLATES[tKey] ? SYSTEM_TEMPLATES[tKey].groups : (userTemplates[tKey] ? userTemplates[tKey].groups : []);
                    const flat = getFlatList(cl);
                    const foundItem = flat.find(x => x.id == id);
                    if(foundItem) defName = foundItem.n;

                    const photo = (i.photos && i.photos[id]) ? i.photos[id] : null;
                    const contr = i.contractorName;

                    if (s === 'fail_escalated' || (i.metrics && i.metrics.n_B3_fail > 0)) {
                        if (!b3Map[defName]) b3Map[defName] = { count: 0, photo: null, contr: contr, name: defName };
                        b3Map[defName].count++;
                        if (photo) b3Map[defName].photo = photo; 
                    } else {
                        if (!b2Map[defName]) b2Map[defName] = { count: 0, photo: null, contr: contr, name: defName };
                        b2Map[defName].count++;
                        if (photo) b2Map[defName].photo = photo;
                    }
                }
            });
        }
    });

    const topB3 = Object.values(b3Map).sort((a,b) => b.count - a.count).slice(0, 5);
    const topB2 = Object.values(b2Map).sort((a,b) => b.count - a.count).slice(0, 5);

    // Функция генерации фото-сеток
    const renderPhotoCards = (arr, isCrit) => {
        if (arr.length === 0) return `<div style="text-align:center; padding:30px; color:#94a3b8; font-size:12px;">Нет зафиксированных дефектов</div>`;
        while(arr.length < 5) { arr.push({ empty: true }); }

        return `<div style="display:grid; grid-template-columns: repeat(5, 1fr); gap:10px; height:100%;">
            ${arr.map(d => {
                if (d.empty) return `<div style="border:1px dashed #cbd5e1; border-radius:8px; opacity:0.3; background:#f8fafc;"></div>`;
                const imgHtml = d.photo 
                    ? `<img src="${d.photo}" style="width:100%; height:90px; object-fit:cover; border-bottom:1px solid #e2e8f0;">` 
                    : `<div style="width:100%; height:90px; background:#f1f5f9; display:flex; align-items:center; justify-content:center; color:#cbd5e1; font-size:10px; border-bottom:1px solid #e2e8f0;">НЕТ ФОТО</div>`;
                const badgeColor = isCrit ? '#dc2626' : '#d97706';
                const badgeBg = isCrit ? '#fef2f2' : '#fff7ed';
                return `
                <div style="background:white; border:1px solid #cbd5e1; border-radius:8px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 2px 4px rgba(0,0,0,0.05);">
                    ${imgHtml}
                    <div style="padding:6px; flex:1; display:flex; flex-direction:column; justify-content:space-between;">
                        <div style="font-size:9px; font-weight:bold; color:#0f172a; line-height:1.2; margin-bottom:4px; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;">${d.name}</div>
                        <div>
                            <div style="font-size:8px; color:#64748b; margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">👤 ${d.contr}</div>
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="background:${badgeBg}; color:${badgeColor}; font-size:8px; font-weight:900; padding:2px 4px; border-radius:4px; border:1px solid ${badgeColor};">${isCrit ? 'B3' : 'B2'}</span>
                                <span style="font-size:9px; font-weight:900; color:#475569;">${d.count} шт</span>
                            </div>
                        </div>
                    </div>
                </div>`;
            }).join('')}
        </div>`;
    };

    // 5. График Трендов
    const cTC = document.getElementById('chart_op_trend_contrs');
    const imgTC = cTC ? `<img style="width:100%; height:150px; object-fit:contain;" src="${cTC.toDataURL('image/png')}">` : '';

    const urkColor = globalUrk < 70 ? '#dc2626' : (globalUrk < 85 ? '#f59e0b' : '#16a34a');

    // ================= ГЕНЕРАЦИЯ HTML ДЛЯ PDF =================
    const content = `
        <div style="display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid #1e293b; padding-bottom:10px; margin-bottom:15px;">
            <div>
                <h1 style="font-size:20px; margin:0; color:#0f172a; text-transform:uppercase;">Сводный статус объекта (Executive Summary)</h1>
                <p style="color:#64748b; font-size:11px; margin:4px 0 0 0; font-weight:bold;">Комплексный отчет для Руководителя</p>
            </div>
            <div style="text-align:right; font-size:10px; color:#64748b;">Охват: <b>${data.length} проверок</b></div>
        </div>
        
        <div style="display: flex; gap: 15px; height: 100%; align-items: stretch;">
            
            <!-- ЛЕВАЯ КОЛОНКА (50%): МЕТРИКИ, ТРЕНД, РЕЙТИНГ -->
            <div style="flex: 1; display: flex; flex-direction: column; gap: 12px; border-right: 2px dashed #e2e8f0; padding-right: 15px;">
                
                <!-- Метрики -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <!-- Средний УрК -->
                    <div style="background: #f8fafc; padding: 12px; border-radius: 10px; border: 1px solid #cbd5e1; position: relative;">
                        <div style="font-size: 9px; color: #64748b; text-transform: uppercase; font-weight: 900;">Ср. Уровень Качества</div>
                        <div style="font-size: 36px; font-weight: 900; color: ${urkColor}; margin-top: 5px; line-height: 1;">${globalUrk}%</div>
                        <div style="position: absolute; top: 12px; right: 12px; font-size: 9px; font-weight: bold; padding: 3px 6px; border-radius: 4px; ${delta < 0 ? 'background:#fef2f2; color:#dc2626;' : 'background:#f0fdf4; color:#16a34a;'}">
                            ${delta > 0 ? '▲' : (delta < 0 ? '▼' : '')} ${Math.abs(delta)}% к пред.
                        </div>
                    </div>
                    <!-- Охват -->
                    <div style="background: #f8fafc; padding: 12px; border-radius: 10px; border: 1px solid #cbd5e1;">
                        <div style="font-size: 9px; color: #64748b; text-transform: uppercase; font-weight: 900;">Средний Охват</div>
                        <div style="font-size: 36px; font-weight: 900; color: #3b82f6; margin-top: 5px; line-height: 1;">${avgCoverage}</div>
                        <div style="font-size: 8px; color: #94a3b8; margin-top: 5px;">проверок на 1 вид работ</div>
                    </div>
                    <!-- Лидер -->
                    <div style="background: #f0fdf4; padding: 12px; border-radius: 10px; border: 1px solid #bbf7d0;">
                        <div style="font-size: 9px; color: #166534; text-transform: uppercase; font-weight: 900;">🏆 Лидер качества</div>
                        <div style="font-size: 13px; font-weight: 900; color: #14532d; margin-top: 5px;">${best ? best.name : 'Нет данных'}</div>
                    </div>
                    <!-- Риск -->
                    <div style="background: #fef2f2; padding: 12px; border-radius: 10px; border: 1px solid #fecaca;">
                        <div style="font-size: 9px; color: #991b1b; text-transform: uppercase; font-weight: 900;">⚠️ Зона риска</div>
                        <div style="font-size: 13px; font-weight: 900; color: #7f1d1d; margin-top: 5px;">${worst ? worst.name : 'Нет данных'}</div>
                    </div>
                </div>

                <!-- График Трендов -->
                <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px; display: flex; flex-direction: column;">
                    <div style="font-size: 10px; font-weight: 900; color: #0f172a; text-transform: uppercase; margin-bottom: 5px;">📉 Динамика подрядчиков</div>
                    <div style="flex: 1; display: flex; align-items: center; justify-content: center;">
                        ${imgTC || '<span style="color:#94a3b8; font-size:12px;">График не сформирован</span>'}
                    </div>
                </div>

                <!-- НОВОЕ: Рейтинг Подрядчиков (Гистограмма) -->
                <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px; flex: 1;">
                    <div style="font-size: 10px; font-weight: 900; color: #0f172a; text-transform: uppercase; margin-bottom: 10px;">📊 Рейтинг Подрядчиков (УрК)</div>
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        ${ratingData.slice(0,5).map(r => `
                            <div style="display:flex; align-items:center; gap:10px;">
                                <div style="width:110px; font-size:10px; font-weight:bold; color:#334155; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${r.name}</div>
                                <div style="flex:1; background:#e2e8f0; height:14px; border-radius:7px; overflow:hidden; position:relative; border:1px solid #cbd5e1;">
                                    <div style="width:${r.val}%; background:${r.val < 70 ? '#ef4444' : (r.val < 85 ? '#f59e0b' : '#22c55e')}; height:100%; border-radius:7px;"></div>
                                </div>
                                <div style="width:30px; text-align:right; font-size:11px; font-weight:900; color:${r.val < 70 ? '#ef4444' : (r.val < 85 ? '#f59e0b' : '#22c55e')};">${r.val}%</div>
                            </div>
                        `).join('') || '<div style="font-size:10px; color:#94a3b8;">Недостаточно данных для рейтинга (нужно 3 проверки на подрядчика)</div>'}
                    </div>
                </div>

            </div>

            <!-- ПРАВАЯ КОЛОНКА (50%): ФОТО, ТОП-5, PDCA -->
            <div style="flex: 1; display: flex; flex-direction: column; gap: 12px;">
                
                <!-- ТОП-5 B3 (Критические) -->
                <div style="flex: 1; background: #fef2f2; border: 2px solid #fecaca; border-radius: 10px; padding: 12px; display: flex; flex-direction: column;">
                    <h3 style="margin: 0 0 10px 0; font-size: 11px; color: #dc2626; text-transform: uppercase; border-bottom: 1px solid #fca5a5; padding-bottom: 5px;">
                        🚨 ТОП-5 Критических дефектов (B3)
                    </h3>
                    <div style="flex: 1;">
                        ${renderPhotoCards(topB3, true)}
                    </div>
                </div>

                <!-- ТОП-5 B2 (Повторяющиеся) -->
                <div style="flex: 1; background: #fffbeb; border: 2px solid #fde68a; border-radius: 10px; padding: 12px; display: flex; flex-direction: column;">
                    <h3 style="margin: 0 0 10px 0; font-size: 11px; color: #d97706; text-transform: uppercase; border-bottom: 1px solid #fde047; padding-bottom: 5px;">
                        🔄 ТОП-5 Повторяющихся нарушений (B2)
                    </h3>
                    <div style="flex: 1;">
                        ${renderPhotoCards(topB2, false)}
                    </div>
                </div>

                <!-- НОВОЕ: Управленческое решение (PDCA) -->
                <div style="background: ${globalUrk < 85 || sumB3 > 0 ? '#fffbeb' : '#f0fdf4'}; border: 2px solid ${globalUrk < 85 || sumB3 > 0 ? '#fde68a' : '#bbf7d0'}; border-radius: 10px; padding: 12px; flex: 0 0 auto;">
                    <h3 style="margin: 0 0 8px 0; font-size: 11px; color: ${globalUrk < 85 || sumB3 > 0 ? '#b45309' : '#166534'}; text-transform: uppercase; border-bottom: 1px solid ${globalUrk < 85 || sumB3 > 0 ? '#fde047' : '#86efac'}; padding-bottom: 4px;">
                        🎯 Управленческое Решение и Риски
                    </h3>
                    <div style="font-size: 11px; line-height: 1.5; color: #1e293b; display: flex; flex-direction: column; gap: 6px;">
                        ${sumB3 > 0 ? `<div style="color:#dc2626;"><b>🚨 КРИТИЧЕСКИЙ РИСК:</b> Выявлено <b>${sumB3}</b> инцидентов B3. Продолжение работ без устранения грозит финансовыми и репутационными потерями.</div>` : ''}
                        <div><b>📉 СТАТУС:</b> ${globalUrk < 70 ? 'Процесс вне контроля (<70%). Идет накопление брака, требуются жесткие меры.' : (globalUrk < 85 ? 'Условный допуск (70-84%). Есть системные ошибки, запрет на финишную приемку.' : 'Целевая зона (>=85%). Процесс стабилен, качество высокое.')}</div>
                        <div style="background:white; padding:6px; border-radius:4px; border:1px solid #cbd5e1; margin-top:2px;"><b>🔨 ДИРЕКТИВА:</b> ${globalUrk < 70 || sumB3 > 0 ? `Приостановить работы аутсайдера (<b>${worst ? worst.name : 'н/д'}</b>). Выдать предписание на немедленный демонтаж/исправление брака. Ограничить оплату КС-2.` : 'Работы выполняются в соответствии с регламентом. Продолжить СМР в текущем режиме.'}</div>
                    </div>
                </div>

            </div>
        </div>
    `;
    
    printPdfShell("Сводка для Руководства (One-Pager)", content);
}

// 4. PDF: Таблица Данных
function exportPdfRating(data) {
    const grouped = {};
    data.forEach(item => { const cName = item.contractorName || 'Не указан'; if(!grouped[cName]) grouped[cName] = []; grouped[cName].push(item); });
    
    const ratingData = [];
    for(let cName in grouped) { const metrics = getContractorMetrics(grouped[cName], userTemplates); if (metrics) ratingData.push({ name: cName, metrics: metrics }); }
    ratingData.sort((a,b) => b.metrics.finalC - a.metrics.finalC);

    const canvas = document.getElementById('chart_rating_compare');
    const chartImg = canvas ? `<div class="chart-box"><img src="${canvas.toDataURL('image/png')}"></div>` : '';

    let rowsHtml = ratingData.map((r, i) => {
        const m = r.metrics;
        const color = m.finalC < 70 ? '#ef4444' : (m.finalC < 85 ? '#f59e0b' : '#22c55e');
        const isLeader = i === 0 && m.finalC >= 85;

        return `
        <div class="avoid-break" style="border: 1px solid #cbd5e1; border-radius: 10px; padding: 15px; margin-bottom: 15px; background: #f8fafc; position: relative;">
            ${isLeader ? `<div style="position: absolute; top: 0; right: 0; background: #fde047; color: #854d0e; padding: 4px 10px; font-size: 10px; font-weight: bold; border-bottom-left-radius: 10px; text-transform: uppercase;">🏆 Лидер</div>` : ''}
            
            <table style="width: 100%; border: none; margin-bottom: 10px;">
                <tr>
                    <td style="width: 40px; text-align: center;"><div style="width:30px; height:30px; background:#e2e8f0; border-radius:8px; line-height:30px; font-weight:900; font-size:16px;">${i + 1}</div></td>
                    <td><div style="font-size: 16px; font-weight: 900; color: #0f172a;">${r.name}</div><div style="font-size: 10px; color: #64748b; text-transform: uppercase;">${m.confStatus} (Выборка: ${m.count})</div></td>
                    <td style="text-align: right;"><div style="font-size: 28px; font-weight: 900; color: ${color}; line-height: 1;">${m.finalC}%</div><div style="font-size: 10px; font-weight: bold; text-transform: uppercase; color: ${m.riskStatus==='Высокий риск'?'#ef4444':'#475569'};">${m.riskStatus}</div></td>
                </tr>
            </table>

            <div style="margin-bottom: 15px;">
                <div style="display: flex; justify-content: space-between; font-size: 9px; font-weight: bold; color: #94a3b8; margin-bottom: 4px;">
                    <span>0%</span><span style="color: #ef4444;">СТОП (70%)</span><span style="color: #22c55e;">НОРМА (85%)</span><span>100%</span>
                </div>
                <div style="height: 10px; background: #e2e8f0; border-radius: 5px; position: relative; overflow: hidden; border: 1px solid #cbd5e1;">
                    <div style="position: absolute; left: 70%; top: 0; bottom: 0; width: 1px; background: #fca5a5; z-index: 2;"></div>
                    <div style="position: absolute; left: 85%; top: 0; bottom: 0; width: 1px; background: #86efac; z-index: 2;"></div>
                    <div style="height: 100%; width: ${m.finalC}%; background: ${color}; border-radius: 5px;"></div>
                </div>
            </div>

            <table style="width: 100%; border: none;">
                <tr>
                    <td style="width: 50%; padding-right: 5px;"><div style="background: #f1f5f9; border: 1px solid #cbd5e1; padding: 10px; border-radius: 6px; font-size: 11px;"><span style="color: #64748b;">Системность (Ks):</span> <b style="font-size: 14px; color: ${m.ks<1?'#ef4444':'#16a34a'};">${m.ks.toFixed(2)}</b> <span style="color: #475569;">(${m.maxFailRate.toFixed(1)}%)</span></div></td>
                    <td style="width: 50%; padding-left: 5px;"><div style="background: #f1f5f9; border: 1px solid #cbd5e1; padding: 10px; border-radius: 6px; font-size: 11px;"><span style="color: #64748b;">Критичность (Kcrit):</span> <b style="font-size: 14px; color: ${m.kcritC<1?'#ef4444':'#16a34a'};">${m.kcritC.toFixed(2)}</b> <span style="color: #ef4444;">(B3: ${m.n_изделий_с_B3} шт)</span></div></td>
                </tr>
            </table>
            <div style="margin-top: 10px; background: ${m.finalC<70?'#fef2f2':'#f0fdf4'}; border: 1px solid ${m.finalC<70?'#fecaca':'#bbf7d0'}; padding: 10px; border-radius: 6px; font-size: 11px; font-weight: bold; color: ${m.finalC<70?'#991b1b':'#166534'};">
                Вывод системы: ${m.reason}
            </div>
        </div>`;
    }).join('');

    const content = `
        <h2 class="section-title">Рейтинг Подрядчиков (WYSIWYG)</h2>
        ${chartImg}
        <div class="mt-20">${rowsHtml}</div>
    `;
    printPdfShell("Рейтинг Подрядчиков", content);
}

// === МАСТЕР-ШАБЛОН ДЛЯ ПЕЧАТИ (A3 LANDSCAPE) ===
function printPdfShell(title, content) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return alert('Разрешите всплывающие окна в браузере для выгрузки PDF.');

    const projName = document.getElementById('inp-project')?.value || 'Не указан';
    const inspName = document.getElementById('inp-inspector')?.value || 'Не указан';
    
    const html = `
    <!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>${title}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
        @page { size: A3 landscape; margin: 15mm; }
        
        body { font-family: 'Inter', sans-serif; color: #0f172a; margin: 0; padding: 0; background: #e2e8f0; font-size: 13px; line-height: 1.5; overflow-x: hidden; }
        
        .preview-container {
            width: 100%; max-width: 1200px; margin: 20px auto; background: white; 
            padding: 20px; box-sizing: border-box; box-shadow: 0 10px 25px rgba(0,0,0,0.15); min-height: 100vh; overflow-x: hidden;
        }
        
        .print-controls { position: fixed; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 10px; z-index: 10000; }
        .btn { width: 50px; height: 50px; border-radius: 25px; display: flex; justify-content: center; align-items: center; cursor: pointer; border: none; box-shadow: 0 10px 15px rgba(0,0,0,0.2); font-size: 20px; outline: none; -webkit-tap-highlight-color: transparent;}
        .btn-print { background: #4f46e5; color: white; }
        .btn-close { background: #475569; color: white; }
        
        @media print { 
            body { background: white; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            .preview-container { margin: 0; padding: 0; box-shadow: none; max-width: none; }
            .print-controls { display: none !important; } 
            .avoid-break { page-break-inside: avoid !important; } 
        }
        
        .header { border-bottom: 3px solid #1e293b; padding-bottom: 15px; margin-bottom: 25px; display: flex; justify-content: space-between; align-items: flex-end; }
        .header-title { font-size: 20px; font-weight: 900; text-transform: uppercase; margin: 0; }
        .header-meta { font-size: 10px; color: #64748b; text-align: right; }
        .section-title { font-size: 16px; background: #1e293b; color: white; padding: 10px 15px; border-radius: 6px; text-transform: uppercase; margin-bottom: 20px; }
        
        .data-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 25px; }
        .data-table th { background: #f1f5f9; padding: 10px; border: 1px solid #cbd5e1; color: #475569; text-transform: uppercase; }
        .data-table td { padding: 10px; border: 1px solid #cbd5e1; }
        .data-table tr:nth-child(even) { background-color: #f8fafc; }
        
        img { max-width: 100%; height: auto; }
        
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        .grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 15px; }
        
        /* НОВАЯ ЖЕСТКАЯ СЕТКА ФОТО (Исключает растягивание 1 фото) */
        .photo-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, 150px);
            gap: 15px;
            justify-content: start;
            align-items: start;
        }
        
        .photo-card { border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; background: #f8fafc; width: 150px; }
        .photo-card img { width: 100%; height: 120px; object-fit: cover; display: block; border-bottom: 1px solid #cbd5e1; }
        .photo-label { padding: 8px; font-size: 10px; line-height: 1.3; color: #334155; word-wrap: break-word;}
        
        .text-center { text-align: center; } .font-bold { font-weight: bold; } .text-xl { font-size: 20px; } 
        .mt-20 { margin-top: 20px; } .mb-20 { margin-bottom: 20px; }
    </style></head><body>
    
    <div class="print-controls">
        <button class="btn btn-print" onclick="window.print()" title="Печать / Сохранить в PDF">🖨️</button>
        <button class="btn btn-close" onclick="window.close()" title="Закрыть">✖️</button>
    </div>
    
    <div class="preview-container">
        <div class="header avoid-break">
            <div>
                <h1 class="header-title">${title}</h1>
                <div style="font-size: 12px; margin-top: 4px; font-weight: bold; color: #475569;">Объект: ${projName} | Ваш инспектор: ${inspName}</div>
            </div>
            <div class="header-meta">Сформировано:<br>${new Date().toLocaleString('ru-RU')}<br>RBI Quality Pro</div>
        </div>
        ${content}
    </div>
    </body></html>`;
    
    printWindow.document.open(); printWindow.document.write(html); printWindow.document.close();
}
// === ОКНО "О ПРИЛОЖЕНИИ" ===
function showAboutApp() {
    const modal = document.getElementById('modal-overlay');
    document.getElementById('modal-icon').innerHTML = `<div class="text-4xl mb-2 flex justify-center">🏛️</div>`;
    document.getElementById('modal-title').innerText = "RBI Quality Pro (v.16.2)";
    
    document.getElementById('modal-body').innerHTML = `
        <div class="space-y-4 text-[12px] leading-relaxed text-slate-700 dark:text-slate-300">
            
            <div class="text-center font-bold text-indigo-600 dark:text-indigo-400 mb-2">
                Система управления качеством на основе данных (Data-Driven Quality)
            </div>

            <div class="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 p-4 rounded-xl shadow-sm">
                <h4 class="font-black text-indigo-800 dark:text-indigo-300 mb-2 uppercase tracking-wider flex items-center gap-1.5"><span class="text-lg">⚙️</span> Архитектура PWA</h4>
                <p class="mb-2">Приложение построено по технологии <b>Progressive Web App</b>. Это значит, что оно работает в браузере, но ведет себя как нативное приложение.</p>
                <ul class="list-disc pl-4 space-y-1 text-[11px] text-indigo-900 dark:text-indigo-200">
                    <li><b>Офлайн ядро (Offline-First):</b> Все данные, PDF-файлы и фото сохраняются во встроенной БД браузера (IndexedDB). Подключение к интернету на стройке не требуется.</li>
                    <li><b>Локальные вычисления:</b> Вся математика дашбордов и генерация PDF происходит процессором вашего телефона, обеспечивая мгновенный отклик.</li>
                </ul>
            </div>

            <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 rounded-xl shadow-sm">
                <h4 class="font-black text-slate-800 dark:text-white mb-3 uppercase tracking-wider flex items-center gap-1.5"><span class="text-lg">📊</span> Функциональные модули</h4>
                
                <div class="space-y-3">
                    <div>
                        <b class="text-slate-900 dark:text-white">1. Модуль Осмотра:</b> 
                        Жестко алгоритмизированный процесс. Классификатор дефектов разделен на B1 (мелкий), B2 (значимый), B3 (критический). Внедрено правило <b>Эскалации >1.5х</b>, которое переводит B2 в B3 при сильном отклонении.
                    </div>
                    <div class="border-t border-slate-100 dark:border-slate-700 pt-2">
                        <b class="text-slate-900 dark:text-white">2. Математика УрК (Уровень Качества):</b> 
                        Оценка идет не "на глаз", а по формулам.<br>
                        • <i>УрК Изделия</i>: Базовый балл умножается на штрафы за концентрацию (Kc) и критичность (Kcrit).<br>
                        • <i>УрК Подрядчика</i>: Штрафует за повторяемость (системный брак) и волатильность (нестабильность от раза к разу).
                    </div>
                    <div class="border-t border-slate-100 dark:border-slate-700 pt-2">
                        <b class="text-slate-900 dark:text-white">3. Аналитика и BI:</b> 
                        Встроенный Business Intelligence. Строит тренды (динамику качества во времени), диаграммы Парето (корневые причины брака), сравнительные рейтинги подрядчиков и сводный One-Pager для Руководителя проекта.
                    </div>
                    <div class="border-t border-slate-100 dark:border-slate-700 pt-2">
                        <b class="text-slate-900 dark:text-white">4. Интегрированная База Знаний:</b> 
                        Модуль TWI (Training Within Industry). Прямо из карточки дефекта по кнопке "Справка" инженер переходит к эталону монтажа. Устраняется разрыв между СНиПами и реальной стройкой.
                    </div>
                </div>
            </div>

            <div class="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 p-4 rounded-xl shadow-sm">
                <h4 class="font-black text-emerald-800 dark:text-emerald-400 mb-2 uppercase tracking-wider flex items-center gap-1.5"><span class="text-lg">🎯</span> Управленческая ценность (PDCA)</h4>
                <p class="text-[11px] text-emerald-900 dark:text-emerald-200">
                    Система меняет парадигму с "поиска и исправления дефектов" на их <b>предотвращение</b>.<br>
                    Жесткие пороги (<b>Стоп-работы при УрК < 70%</b> или наличии дефекта <b>B3</b>) не позволяют "дефектному хвосту" дойти до этапа сдачи объекта клиенту. Управленческие решения принимаются на основе сухих цифр, исключая человеческий фактор.
                </p>
            </div>

            <div class="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 p-4 rounded-xl shadow-sm">
                <h4 class="font-black text-amber-800 dark:text-amber-400 mb-2 uppercase tracking-wider flex items-center gap-1.5"><span class="text-lg">🚀</span> Дальнейшее развитие (Roadmap)</h4>
                <ul class="list-disc pl-4 text-[11px] text-amber-900 dark:text-amber-200 space-y-1.5">
                    <li>Внедрение <b>AI DeepSeek</b> для автогенерации писем-предписаний подрядчикам на основе собранных данных.</li>
                    <li>Live-синхронизация локальной базы с облачным сервером для совместной работы отдела контроля качества.</li>
                    <li>Интеграция с графиком производства работ (ГПР) для корреляции качества и сроков.</li>
                </ul>
            </div>
            
            <div class="text-center text-[9px] text-slate-400 uppercase tracking-widest font-black mt-6 border-t border-slate-200 dark:border-slate-700 pt-4">
                Спроектировано и разработано для Строительного Контроля
            </div>
        </div>
    `;
    document.body.classList.add('modal-open'); 
    modal.style.display = 'flex';
}

// === СВОРАЧИВАЕМЫЕ ПАНЕЛИ (УМНАЯ ЛОГИКА БЕЗ ПРЫЖКОВ) ===
function initCollapsiblePanel(panelId, bodyId, headerId, iconId) {
    const panel  = document.getElementById(panelId);
    const body   = document.getElementById(bodyId);
    const header = document.getElementById(headerId);
    const icon   = document.getElementById(iconId);
    if (!panel || !body) return;
    if (panel.dataset.inited) return;
    panel.dataset.inited = '1';

    let collapsed = false;
    let isAnimating = false; // Блокировка от дребезга

    function setCollapsed(val) {
        if (collapsed === val || isAnimating) return;
        collapsed = val;
        isAnimating = true;
        
        body.style.maxHeight  = collapsed ? '0px'   : '400px';
        body.style.opacity    = collapsed ? '0'     : '1';
        body.style.overflow   = collapsed ? 'hidden': 'visible';
        body.style.marginTop  = collapsed ? '0px'   : '8px';
        if (icon) icon.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
        
        setTimeout(() => { isAnimating = false; }, 400); // Ждем конца CSS анимации
    }

    if (header) {
        header.addEventListener('click', () => setCollapsed(!collapsed));
    }

    window.addEventListener('scroll', () => {
        // Если панель не на активной вкладке - игнорируем
        if (!panel.closest('.view-section.active') && !panel.closest('.active')) return;
        
        // ЗАЩИТА ОТ ПРЫЖКОВ: Если страница короткая, не сворачиваем вообще!
        if (document.body.scrollHeight <= window.innerHeight + 250) {
            setCollapsed(false);
            return;
        }

        const y = window.scrollY;
        // Используем абсолютные пороги с "мертвой зоной", чтобы исключить цикличность
        if (y > 100 && !collapsed) setCollapsed(true);
        else if (y < 40 && collapsed) setCollapsed(false);
    }, { passive: true });
}
let currentTutStep = 0;
let tutOverlay, tutHighlightBox, tutTooltip, tutText, tutStepNum, tutNextBtn;

const tutorialSteps = [
    // --- 1. ВКЛАДКА ОСМОТР ---
    {
        text: "Добро пожаловать в <b>RBI Quality!</b> 👋<br><br>Я загрузил для вас <b>Демо-данные</b>, чтобы показать приложение в действии.<br><br>Здесь в шапке мы выбираем вид работ и заполняем данные объекта.",
        targetId: "header-data-block",
        action: () => { switchTab('tab-audit'); window.scrollTo({top: 0, behavior: 'smooth'}); }
    },
    {
        text: "Это <b>Умный Дашборд</b>. Он в реальном времени считает <b>УрК</b> (Уровень Качества). Если нажать на него, откроется формула с учетом всех штрафов (за критичность и системный брак).",
        targetId: "header-dashboard",
        action: () => { document.getElementById('dash-expand-icon').click(); }
    },
    {
        text: "Так выглядит карточка контроля.<br>Свайп вправо или зеленая кнопка ставит <b>OK</b>. Карточка автоматически сжимается, убирая лишний текст СНиПа.",
        targetId: "card_wrapper_201",
        action: () => {
            const el = document.getElementById('card_wrapper_201');
            if(el) el.scrollIntoView({block: 'center', behavior: 'smooth'});
        }
    },
    {
        text: "В Демо-режиме мы уже зафиксировали брак в этом пункте. Справа появилась панель управления дефектом. Здесь можно загрузить фото дефекта, оставить коментарий или выбрать причину дефекта из списка, а в случае если отклонение превышает норму более чем в 1,5 раза, можно эскалировать дефект до В3 и система учтет его как критический",
        targetId: "card_wrapper_204",
        action: () => {
            const el = document.getElementById('card_wrapper_204');
            if(el) el.scrollIntoView({block: 'center', behavior: 'smooth'});
        }
    },
    {
        text: "💡 <b>СВЯЗЬ СО СПРАВОЧНИКОМ:</b><br>Обратите внимание на <b>синюю кнопку</b>. Если кнопка синяя — значит к этому пункту привязана наглядная <b>TWI-карта</b>.<br><br>Нажав её, инспектор увидит эталонное фото, фото брака и методику проверки конкретно для этого дефекта.",
        targetSelector: "#card_wrapper_204 .btn-status.text-blue-600",
        action: () => { } 
    },
    // --- 2. ВКЛАДКА ИСТОРИЯ ---
    {
        text: "После осмотра нажимаем <b>Сохранить</b>.<br>Акт улетает в базу, а мы переходим во вкладку <b>История</b>.",
        targetSelector: ".bottom-nav .nav-item[data-tab='tab-history']",
        action: () => { switchTab('tab-history'); }
    },
    {
        text: "В Истории хранятся все инспекции. Умная липкая панель позволяет фильтровать акты по подрядчикам, датам и наличию дефектов B3.",
        targetId: "hist-sticky-panel",
        action: () => { window.scrollTo({top: 0, behavior: 'smooth'}); }
    },
    // --- 3. ВКЛАДКА АНАЛИТИКА ---
    {
        text: "Переходим в <b>Аналитику</b>. Посмотрите, система уже проанализировала демо-данные, построила графики, рейтинги и написала смарт-заключения.",
        targetSelector: ".bottom-nav .nav-item[data-tab='tab-analytics']",
        action: () => { switchTab('tab-analytics'); }
    },
    {
        text: "<b>Глобальные фильтры</b> управляют всеми дашбордами. Выберите период или подрядчика, и все графики мгновенно перестроятся.",
        targetId: "analytics-filters-block",
        action: () => { window.scrollTo({top: 0, behavior: 'smooth'}); }
    },
    {
        text: "В Аналитике 4 уровня отчетов:<br><b>Рейтинг</b> (сравнение), <b>Инженерия</b> (глубокий анализ), <b>Сводка</b> (One-Pager для шефа) и сырая <b>База</b>.",
        targetId: "analytics-subtabs-block",
        action: () => {}
    },
    {
        text: "Кнопка <b>Скачать PDF</b> выгружает готовый к печати управленческий отчет со всеми метриками, графиками и фото брака.",
        targetId: "fab-download-btn",
        action: () => {
            const fab = document.getElementById('fab-download-btn');
            if(fab) { fab.style.display = 'flex'; window.scrollTo({top: 200, behavior: 'smooth'}); }
        }
    },
    // --- 4. ВКЛАДКА СПРАВОЧНИК ---
    {
        text: "Заглянем в <b>Справочник</b>. Это единая база знаний инженера: от ГОСТов до инструкций.",
        targetSelector: ".bottom-nav .nav-item[data-tab='tab-reference']",
        action: () => { switchTab('tab-reference'); }
    },
    {
        text: "В <b>Чек-листах</b> можно создавать свои шаблоны в Конструкторе, массово загружать их из <b>Excel</b> и выгружать обратно для коллег.",
        targetId: "ref-filters-block",
        action: () => { 
            const btns = document.querySelectorAll('#reference-subtabs-block .sub-tab-btn');
            if(btns[0]) switchReferenceSubTab('ref-sub-checklists', btns[0]); 
            window.scrollTo({top: 0, behavior: 'smooth'});
            const manageBody = document.getElementById('ref-manage-body');
            if (manageBody && manageBody.style.maxHeight === '0px') toggleManagePanel();
        }
    },
    {
        text: "В <b>TWI Картах</b> создаются визуальные стандарты. Мы уже добавили пару демо-карт для примера.",
        targetId: "twi-search-input", // ЮВЕЛИРНЫЙ ПРИЦЕЛ: выделяем только маленькую строку поиска!
        action: () => { 
            const btns = document.querySelectorAll('#reference-subtabs-block .sub-tab-btn');
            if(btns[2]) switchReferenceSubTab('ref-sub-twi', btns[2]); 
        }
    },
    {
        text: "Давайте откроем <b>Конструктор TWI</b>. Здесь вы собираете инструкцию и жестко привязываете её к конкретному пункту чек-листа.",
        targetSelector: "button[onclick='openTwiConstructor()']", // ЮВЕЛИРНЫЙ ПРИЦЕЛ: только на кнопку "Создать"
        action: () => { openTwiConstructor(); window.scrollTo({top: 0, behavior: 'smooth'}); }
    },
    {
        text: "Вы можете создать 3 типа карт:<br>🕵️‍♂️ <b>Технадзор</b> (Фото Правильно/Брак)<br>🛠 <b>TWI Рабочего</b> (Пошаговый алгоритм)<br>📄 <b>PDF</b> (Готовый регламент).",
        targetId: "twi-type-btn-worker", // ЮВЕЛИРНЫЙ ПРИЦЕЛ: только на центральную вкладку типов
        action: () => { }
    },
    {
        text: "А если вы или ваш подрядчик забудете, как именно считаются проценты и штрафы — загляните в новую вкладку <b>FAQ / Логика</b>. Там всё разложено по полочкам.",
        targetSelector: "#ref-sub-faq .text-center", // ЮВЕЛИРНЫЙ ПРИЦЕЛ: выделяем только заголовок с иконкой 📊, а не весь огромный текст
        action: () => { 
            closeTwiConstructor(); 
            setTimeout(() => { 
                const btns = document.querySelectorAll('#reference-subtabs-block .sub-tab-btn');
                if(btns[4]) switchReferenceSubTab('ref-sub-faq', btns[4]); 
                window.scrollTo({top: 0, behavior: 'smooth'});
            }, 300); 
        }
    },
    // --- 5. ВКЛАДКА НАСТРОЙКИ ---
    {
        text: "И напоследок — <b>Настройки</b>. Здесь можно кастомизировать интерфейс под себя.",
        targetSelector: ".bottom-nav .nav-item[data-tab='tab-settings']",
        action: () => { 
            switchTab('tab-settings'); 
            window.scrollTo({top: 0, behavior: 'smooth'});
        }
    },
    {
        text: "Меняйте масштаб шрифтов, темную тему, свайпы, подключайте AI DeepSeek и управляйте памятью.<br><br>🚀 <b>Обучение завершено! Можете продолжить изучать демо-режим.</b>",
        targetSelector: "#tab-settings .bg-\\[var\\(--card-bg\\)\\]", 
        action: () => { window.scrollTo({top: 0, behavior: 'smooth'}); },
        isEnd: true
    }
];

function startInteractiveTutorial() {
    // 1. Включаем демо-режим тихо (silent = true), если он еще не включен
    if (!isDemoMode && typeof startDemoMode === 'function') {
        startDemoMode(true); 
    }

    // 2. Ждем полсекунды, чтобы демо-данные успели отрисоваться на экране
    setTimeout(() => {
        currentTutStep = 0;
        tutOverlay = document.getElementById('tutorial-overlay');
        tutHighlightBox = document.getElementById('tut-highlight-box');
        tutTooltip = document.getElementById('tutorial-tooltip');
        tutText = document.getElementById('tut-text');
        tutStepNum = document.getElementById('tut-step');
        tutNextBtn = document.getElementById('tut-next-btn');
        
        document.getElementById('tut-total').innerText = tutorialSteps.length;

        tutOverlay.classList.remove('hidden');
        tutTooltip.classList.remove('hidden');
        
        showTutorialStep();
    }, 500);
}

function showTutorialStep() {
    const step = tutorialSteps[currentTutStep];
    if(!step) return stopTutorial();

    // Выполняем действие для подготовки экрана (скролл, переключение вкладок)
    if(step.action) step.action();

    // Ждем 700мс, чтобы интерфейс переключился и плавно проскроллился
    setTimeout(() => {
        let target = step.targetId ? document.getElementById(step.targetId) : document.querySelector(step.targetSelector);
        
        if(target) {
            const rect = target.getBoundingClientRect();
            tutHighlightBox.style.top = `${rect.top - 4}px`;
            tutHighlightBox.style.left = `${rect.left - 4}px`;
            tutHighlightBox.style.width = `${rect.width + 8}px`;
            tutHighlightBox.style.height = `${rect.height + 8}px`;
        } else {
            tutHighlightBox.style.width = '0px';
            tutHighlightBox.style.height = '0px';
        }

        tutStepNum.innerText = currentTutStep + 1;
        tutText.innerHTML = step.text;
        
        // Даем браузеру отрисовать текст, чтобы узнать реальную высоту тултипа
        requestAnimationFrame(() => {
            const screenW = window.innerWidth;
            const screenH = window.innerHeight;
            
            // Сбрасываем позицию для замера
            tutTooltip.style.left = '50%';
            tutTooltip.style.transform = 'translate(-50%, 0)';
            
            // Читаем размеры самого тултипа
            const tRect = tutTooltip.getBoundingClientRect();
            
            if(target) {
                const targetRect = target.getBoundingClientRect();
                
                // Проверяем, куда лучше поставить: сверху или снизу от цели
                if (targetRect.top > screenH / 2) {
                    // Цель в нижней половине экрана -> тултип ставим СВЕРХУ
                    let topPos = targetRect.top - tRect.height - 20;
                    if (topPos < 10) topPos = 10; // Защита: не даем улететь за верхний край
                    tutTooltip.style.top = `${topPos}px`;
                } else {
                    // Цель в верхней половине -> тултип ставим СНИЗУ
                    let topPos = targetRect.bottom + 20;
                    if (topPos + tRect.height > screenH - 10) topPos = screenH - tRect.height - 10; // Защита: не даем улететь за нижний край
                    tutTooltip.style.top = `${topPos}px`;
                }
            } else {
                tutTooltip.style.top = `${(screenH - tRect.height) / 2}px`;
            }
            
            // Если текст слишком широкий и вылез за левый/правый край экрана:
            if (tRect.width > screenW - 20) {
                tutTooltip.style.width = `${screenW - 20}px`; // Сжимаем
            }

            if(step.isEnd) {
                tutNextBtn.innerText = "Завершить 🚀";
                tutNextBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-500');
                tutNextBtn.classList.add('bg-green-600', 'hover:bg-green-500');
            } else {
                tutNextBtn.innerText = "Далее ➔";
                tutNextBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-500');
                tutNextBtn.classList.remove('bg-green-600', 'hover:bg-green-500');
            }

            tutTooltip.classList.remove('scale-90', 'opacity-0');
        });
    }, 700);
}

function nextTutorialStep() {
    const step = tutorialSteps[currentTutStep];
    tutTooltip.classList.add('scale-90', 'opacity-0');
    
    setTimeout(() => {
        if(step.isEnd) {
            stopTutorial();
        } else {
            currentTutStep++;
            showTutorialStep();
        }
    }, 300);
}

function stopTutorial() {
    tutTooltip.classList.add('scale-90', 'opacity-0');
    tutOverlay.style.opacity = '0';
    
    // Принудительно сворачиваем дашборд, если он был развернут
    const expView = document.getElementById('dash-expanded-view');
    if (expView && !expView.classList.contains('hidden')) {
        expView.classList.add('hidden');
    }
    const dashIcon = document.getElementById('dash-expand-icon');
    if (dashIcon) dashIcon.innerText = '▼';
    
    // Возвращаем на вкладку Осмотра
    switchTab('tab-audit');
    
    setTimeout(() => { 
        tutOverlay.classList.add('hidden'); 
        tutTooltip.classList.add('hidden');
        tutOverlay.style.opacity = '1'; 
        
        const fab = document.getElementById('fab-download-btn');
        if(fab) fab.style.display = 'none';

        // ИСПРАВЛЕНИЕ: ВОЗВРАЩАЕМ КНОПКУ ВЫХОДА ИЗ ДЕМО-РЕЖИМА
        if (isDemoMode) {
            const fabExit = document.getElementById('fab-exit-demo');
            if (fabExit) {
                fabExit.classList.remove('hidden');
                fabExit.style.display = 'flex';
            }
        }
        
        const manageBody = document.getElementById('ref-manage-body');
        if (manageBody && manageBody.style.maxHeight !== '0px') toggleManagePanel();
        
        if (typeof updateBodyPadding === 'function') updateBodyPadding();
        window.scrollTo({top: 0, behavior: 'smooth'});
    }, 500);
}

// === КОНСТРУКТОР СВОИХ ЧЕК-ЛИСТОВ ===
let builderGroupCount = 0;
let builderItemCount = 0;

function openTemplateBuilder() {
    const overlay = document.getElementById('template-builder-overlay');
    document.getElementById('builder-title').value = '';
    document.getElementById('builder-groups').innerHTML = '';
    builderGroupCount = 0;
    builderItemCount = 0;
    
    addBuilderGroup(); // Добавляем первую пустую группу по умолчанию
    
    overlay.style.display = 'flex';
    document.body.classList.add('modal-open');
}

function closeTemplateBuilder() {
    document.getElementById('template-builder-overlay').style.display = 'none';
    document.body.classList.remove('modal-open');
}

function addBuilderGroup() {
    builderGroupCount++;
    const groupId = `builder-group-${builderGroupCount}`;
    const html = `
        <div id="${groupId}" class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 shadow-sm relative">
            <button onclick="document.getElementById('${groupId}').remove()" class="absolute top-2 right-2 w-7 h-7 bg-red-50 text-red-500 rounded-lg flex items-center justify-center font-bold text-xs active:scale-95 border border-red-100">✕</button>
            <label class="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase mb-1 block">Название этапа (Группы)</label>
            <input type="text" class="input-base text-xs mb-3 group-title-input" placeholder="Например: 1. Подготовительные работы" value="Этап ${builderGroupCount}">
            
            <div id="${groupId}-items" class="space-y-2 mb-3 pl-2 border-l-2 border-indigo-100 dark:border-indigo-800">
                <!-- Сюда будут падать пункты -->
            </div>
            
            <button onclick="addBuilderItem('${groupId}-items')" class="text-[10px] font-bold bg-indigo-50 text-indigo-600 border border-indigo-200 px-3 py-2 rounded-lg active:scale-95 transition-colors uppercase dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-400">
                + Добавить пункт контроля
            </button>
        </div>
    `;
    document.getElementById('builder-groups').insertAdjacentHTML('beforeend', html);
    addBuilderItem(`${groupId}-items`); // Сразу добавляем 1 пустой пункт
}

function addBuilderItem(containerId) {
    builderItemCount++;
    const itemId = `builder-item-${builderItemCount}`;
    const html = `
        <div id="${itemId}" class="bg-[var(--hover-bg)] p-2 rounded-lg border border-[var(--card-border)] relative">
            <button onclick="document.getElementById('${itemId}').remove()" class="absolute top-2 right-2 text-red-500 font-black text-sm px-2">✕</button>
            
            <div class="pr-8 mb-2">
                <input type="text" class="input-base text-xs item-name-input" placeholder="Текст нарушения (Напр: Отклонение от вертикали)">
            </div>
            
            <div class="grid grid-cols-3 gap-2 mb-2">
                <div class="col-span-1">
                    <select class="input-base text-[10px] !py-1 item-weight-select bg-white">
                        <option value="1">B1 (Мелкий)</option>
                        <option value="2" selected>B2 (Значимый)</option>
                        <option value="3">B3 (Критич.)</option>
                    </select>
                </div>
                <div class="col-span-2">
                    <input type="text" class="input-base text-[10px] !py-1 item-norm-input" placeholder="СНиП / Допуск (Напр: ±2 мм)">
                </div>
            </div>
        </div>
    `;
    document.getElementById(containerId).insertAdjacentHTML('beforeend', html);
}

async function saveCustomTemplate() {
    const titleInput = document.getElementById('builder-title').value.trim();
    if (!titleInput) return showToast("Введите название чек-листа!");

    const groupsEl = document.getElementById('builder-groups').children;
    if (groupsEl.length === 0) return showToast("Добавьте хотя бы один этап!");

    const newTemplate = {
        title: titleInput,
        templateVersion: "1.0",
        groups: []
    };

    let isValid = true;

    Array.from(groupsEl).forEach(groupEl => {
        const groupTitle = groupEl.querySelector('.group-title-input').value.trim();
        const itemsContainer = groupEl.querySelector('div[id$="-items"]');
        const itemsEl = itemsContainer.children;
        
        if (!groupTitle || itemsEl.length === 0) isValid = false;

        const groupData = { group: groupTitle || "Без названия", items: [] };

        Array.from(itemsEl).forEach(itemEl => {
            const name = itemEl.querySelector('.item-name-input').value.trim();
            const weight = parseInt(itemEl.querySelector('.item-weight-select').value);
            const norm = itemEl.querySelector('.item-norm-input').value.trim();

            if (!name) isValid = false;

            // Генерируем уникальный ID для пункта (чтобы не пересекался с системными)
            const uniqueId = Date.now() % 100000 + Math.floor(Math.random() * 1000);

            groupData.items.push({
                id: uniqueId,
                n: name || "Пустой пункт",
                w: weight,
                t: formatNorms(norm || "Без норматива")
            });
        });

        newTemplate.groups.push(groupData);
    });

    if (!isValid) return showToast("Заполните все пустые поля и пункты!");

    // Генерируем slug (ключ) для шаблона
    const slug = "cstm_" + Date.now().toString(36);
    
    // Сохраняем в глобальный объект
    userTemplates[slug] = newTemplate;

    // Сохраняем в IndexedDB
    try {
        await dbPut(STORES.TEMPLATES, { slug: slug, data: newTemplate });
        showToast("✅ Шаблон успешно сохранен!");
        closeTemplateBuilder();
        
        // Обновляем списки селекторов и список в настройках
        renderSelector();
        renderSettingsTab();
        
    } catch (e) {
        console.error(e);
        showToast("Ошибка сохранения шаблона!");
    }
}

// Функция для удаления пользовательских шаблонов
async function deleteUserTemplate(slug) {
    if (!confirm("Удалить этот чек-лист? Вы не сможете проводить по нему новые проверки.")) return;
    
    delete userTemplates[slug];
    try {
        await dbDelete(STORES.TEMPLATES, slug);
        showToast("🗑️ Чек-лист удален");
        renderSelector();
        renderSettingsTab();
        
        // Если удалили тот, что был выбран - сбрасываем на HOME
        if (currentTemplateKey === `user_${slug}`) {
            changeTemplate('HOME');
        }
    } catch (e) {
        console.error(e);
        showToast("Ошибка при удалении");
    }
}
// === АВТОМАТИЧЕСКАЯ ЗАГРУЗКА ШАБЛОНОВ ИЗ EXCEL ===

function triggerExcelImport() {
    document.getElementById('excel-template-input').click();
}

function showExcelHelp() {
    const modal = document.getElementById('modal-overlay');
    document.getElementById('modal-icon').innerHTML = `<div class="text-4xl mb-2">📊</div>`;
    document.getElementById('modal-title').innerText = "Как загрузить Excel";
    document.getElementById('modal-body').innerHTML = `
        <div class="text-sm leading-relaxed space-y-3">
            <p>Система автоматически превратит вашу таблицу в чек-лист. Файл должен быть формата <b>.xlsx</b>.</p>
            <p class="font-bold text-indigo-600 dark:text-indigo-400 mt-2">Структура таблицы (строго 4 столбца):</p>
            <table class="w-full text-left border-collapse border border-slate-300 mt-2 text-[10px] bg-white dark:bg-slate-800">
                <tr class="bg-slate-100 dark:bg-slate-700">
                    <th class="border border-slate-300 p-1">Столбец A</th>
                    <th class="border border-slate-300 p-1">Столбец B</th>
                    <th class="border border-slate-300 p-1">Столбец C</th>
                    <th class="border border-slate-300 p-1">Столбец D</th>
                </tr>
                <tr>
                    <td class="border border-slate-300 p-1"><b>Название этапа (Группы)</b></td>
                    <td class="border border-slate-300 p-1"><b>Название дефекта/пункта</b></td>
                    <td class="border border-slate-300 p-1"><b>Категория (1, 2 или 3)</b></td>
                    <td class="border border-slate-300 p-1"><b>Текст норматива / ГОСТ</b></td>
                </tr>
                <tr>
                    <td class="border border-slate-300 p-1 text-slate-500">Подготовка поверхности</td>
                    <td class="border border-slate-300 p-1 text-slate-500">Грязь, пыль на бетоне</td>
                    <td class="border border-slate-300 p-1 text-slate-500">2</td>
                    <td class="border border-slate-300 p-1 text-slate-500">СП 70.13330 очистить до основания</td>
                </tr>
            </table>
            <div class="bg-yellow-50 text-yellow-800 border border-yellow-200 p-3 rounded-lg text-[11px] mt-3">
                ⚠️ <b>Важно:</b> Первая строка таблицы (заголовки столбцов) игнорируется при загрузке. Данные должны начинаться со 2-й строки.
            </div>
        </div>
    `;
    document.body.classList.add('modal-open'); 
    modal.style.display = 'flex';
}

async function handleExcelImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Показываем уведомление о начале загрузки
    showToast("⚙️ Обработка Excel файла...");

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            // Читаем Excel файл
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            // Берем первый лист
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            // Переводим в формат массива массивов
            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            if (rows.length < 2) throw new Error("Файл пуст или не содержит данных со 2-й строки");

            // Имя файла становится названием чек-листа
            const templateTitle = file.name.replace(/\.[^/.]+$/, ""); 
            const newTemplate = {
                title: templateTitle,
                templateVersion: "1.0",
                groups: []
            };

            let currentGroupTitle = "";
            let currentGroupItems = [];

            // Пропускаем 1-ю строку (rows[0]), так как это заголовки
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row || row.length === 0) continue; // Пропуск пустых строк

                // Считываем ячейки (Колонка A, B, C, D)
                const groupCol = row[0] ? row[0].toString().trim() : null;
                const itemCol = row[1] ? row[1].toString().trim() : null;
                const weightCol = row[2];
                const normCol = row[3] ? row[3].toString().trim() : null;

                // Если есть название группы и оно отличается от предыдущего - создаем новый блок
                if (groupCol && groupCol !== currentGroupTitle) {
                    if (currentGroupTitle && currentGroupItems.length > 0) {
                        newTemplate.groups.push({ group: currentGroupTitle, items: currentGroupItems });
                    }
                    currentGroupTitle = groupCol;
                    currentGroupItems = [];
                }

                // Если есть название дефекта
                if (itemCol) {
                    // Проверка категории
                    let weight = parseInt(weightCol);
                    if (isNaN(weight) || weight < 1 || weight > 3) weight = 2; // По умолчанию B2

                    currentGroupItems.push({
                        id: Date.now() % 100000 + Math.floor(Math.random() * 10000) + i,
                        n: itemCol,
                        w: weight,
                        t: formatNorms(normCol ? normCol : "Без норматива")
                    });
                }
            }

            // Не забываем добавить последнюю группу после цикла
            if (currentGroupTitle && currentGroupItems.length > 0) {
                newTemplate.groups.push({ group: currentGroupTitle, items: currentGroupItems });
            }

            if (newTemplate.groups.length === 0) throw new Error("Не удалось найти данные в таблице. Проверьте формат по инструкции (Кнопка '?').");

            // Генерируем уникальный ключ
            const slug = "cstm_" + Date.now().toString(36);
            
            // Сохраняем в память
            userTemplates[slug] = newTemplate;
            await dbPut(STORES.TEMPLATES, { slug: slug, data: newTemplate });

            showToast(`✅ Чек-лист "${templateTitle}" успешно загружен!`);
            
            // Перерисовываем интерфейс, чтобы шаблон сразу появился в списках
            renderSelector();
            renderSettingsTab();

        } catch (err) {
            console.error(err);
            alert("Ошибка загрузки: " + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
    
    // Сбрасываем инпут, чтобы можно было выбрать тот же файл снова
    event.target.value = '';
}
// === ЭКСПОРТ ЧЕК-ЛИСТОВ В EXCEL И JSON ===

// Вспомогательная функция очистки HTML-тегов для выгрузки
// (Убирает красные и синие подсветки нормативов, чтобы в Excel был чистый текст)
function stripHtmlTags(str) {
    if (!str) return "";
    // Заменяем <br> на реальные переносы строк для Excel
    let text = str.replace(/<br\s*[\/]?>/gi, "\n");
    // Удаляем все остальные HTML-теги
    return text.replace(/<\/?[^>]+(>|$)/g, "");
}

function exportAllTemplatesExcel() {
    showToast("⚙️ Формирование Excel-книги...");
    
    try {
        // Создаем новую Excel-книгу
        const wb = XLSX.utils.book_new();
        
        // Объединяем системные и загруженные/созданные пользователем чек-листы
        const allTemplates = { ...SYSTEM_TEMPLATES, ...userTemplates };
        
        for (let key in allTemplates) {
            const tmpl = allTemplates[key];
            
            // Заголовки таблицы (строго как в инструкции для импорта)
            const ws_data = [
                ['Название этапа (Группы)', 'Название дефекта/пункта', 'Категория (1, 2 или 3)', 'Текст норматива / ГОСТ']
            ];

            // Перебираем группы и пункты
            if (tmpl.groups && Array.isArray(tmpl.groups)) {
                tmpl.groups.forEach(g => {
                    const groupTitle = g.group || g.title || "Без названия";
                    if (g.items && Array.isArray(g.items)) {
                        g.items.forEach(i => {
                            ws_data.push([
                                groupTitle,
                                i.n || "",
                                i.w || 2,
                                stripHtmlTags(i.t || "") // Очищаем от HTML
                            ]);
                        });
                    }
                });
            }

            // Создаем лист из массива данных
            const ws = XLSX.utils.aoa_to_sheet(ws_data);
            
            // Настраиваем ширину колонок для красоты в Excel
            ws['!cols'] = [
                { wch: 30 }, // Группа
                { wch: 50 }, // Дефект
                { wch: 20 }, // Категория
                { wch: 70 }  // Норматив
            ];

            // Имя листа в Excel (макс. 31 символ, убираем спецсимволы, чтобы Excel не ругался)
            let sheetName = (tmpl.title || key).replace(/[\\/?*\[\]:]/g, '').substring(0, 31);
            
            // Добавляем лист в книгу
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
        }

        // Скачиваем готовый файл
        XLSX.writeFile(wb, `RBI_Checklists_${new Date().toLocaleDateString('ru-RU')}.xlsx`);
        showToast("✅ Excel-файл со всеми чек-листами скачан!");
        
    } catch (error) {
        console.error(error);
        showToast("❌ Ошибка при формировании Excel");
    }
}

function exportAllTemplatesJson() {
    showToast("⚙️ Формирование JSON...");
    
    // Объединяем чек-листы
    const allTemplates = { ...SYSTEM_TEMPLATES, ...userTemplates };
    
    // Делаем глубокую копию, чтобы случайно не сломать текущий интерфейс при очистке тегов
    const cleanTemplates = JSON.parse(JSON.stringify(allTemplates));
    
    // Очищаем нормативы от HTML-разметки (позже в коде formatNorms() снова их добавит)
    for (let key in cleanTemplates) {
        if (cleanTemplates[key].groups) {
            cleanTemplates[key].groups.forEach(g => {
                if (g.items) {
                    g.items.forEach(i => {
                        i.t = stripHtmlTags(i.t);
                    });
                }
            });
        }
    }

    // Форматируем JSON с отступами (4 пробела) для красивого кода
    const dataStr = JSON.stringify(cleanTemplates, null, 4);
    
    // Скачиваем файл (функция downloadFile уже есть в storage.js)
    downloadFile(dataStr, `RBI_Templates_Code_${new Date().toLocaleDateString('ru-RU')}.json`, 'application/json');
    showToast("✅ JSON-код скачан!");
}
// ==========================================
// БЛОК: БАЗА НОРМАТИВНЫХ ДОКУМЕНТОВ (НД)
// ==========================================

// Системные предустановленные нормативы
const SYSTEM_DOCS = [
    { id: 'sys_doc_1', type: 'СП', code: 'СП 48.13330.2019', title: 'Организация строительства', link: '' },
    { id: 'sys_doc_2', type: 'СП', code: 'СП 70.13330.2012', title: 'Несущие и ограждающие конструкции', link: '' },
    { id: 'sys_doc_3', type: 'СП', code: 'СП 522.1325800.2023', title: 'Системы фасадные теплоизоляционные композиционные', link: '' },
    { id: 'sys_doc_4', type: 'ГОСТ', code: 'ГОСТ 13015-2012', title: 'Изделия бетонные и железобетонные для строительства. Общие технические требования', link: '' },
    { id: 'sys_doc_5', type: 'ГОСТ', code: 'ГОСТ 17079-2021', title: 'Блоки вентиляционные железобетонные. Технические условия', link: '' },
    { id: 'sys_doc_6', type: 'ГОСТ', code: 'ГОСТ 9818-2015', title: 'Марши и площадки лестниц железобетонные', link: '' }
];

let customDocs = []; // Пользовательские документы
let currentDocFilter = 'ALL';

// Загрузка пользовательских документов при старте приложения
document.addEventListener("DOMContentLoaded", async () => {
    try {
        const storedDocs = await dbGet(STORES.SETTINGS, 'custom_docs');
        if (storedDocs && storedDocs.data) {
            customDocs = storedDocs.data;
        }
    } catch (e) {
        console.error("Ошибка загрузки пользовательских НД", e);
    }
});

// Рендер списка документов
function renderDocsList() {
    const container = document.getElementById('docs-list-container');
    const searchInput = document.getElementById('doc-search-input')?.value.toLowerCase() || '';
    if (!container) return;

    // Объединяем системные и пользовательские
    const allDocs = [...SYSTEM_DOCS, ...customDocs];
    
    // Фильтрация
    let filtered = allDocs.filter(doc => {
        const matchSearch = doc.code.toLowerCase().includes(searchInput) || doc.title.toLowerCase().includes(searchInput);
        const matchFilter = currentDocFilter === 'ALL' || doc.type === currentDocFilter;
        return matchSearch && matchFilter;
    });

    if (filtered.length === 0) {
        container.innerHTML = `<div class="text-center py-8 text-slate-500 text-sm font-bold bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">По вашему запросу документы не найдены</div>`;
        return;
    }

    let html = '';
    filtered.forEach(doc => {
        const isSystem = String(doc.id).startsWith('sys_');
        const tagColor = doc.type === 'СП' ? 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300' : 
                        (doc.type === 'ГОСТ' ? 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300' : 
                        'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-700 dark:text-slate-300');

        html += `
        <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 shadow-sm relative overflow-hidden flex flex-col gap-2">
            ${isSystem ? '<div class="absolute top-0 right-0 bg-indigo-500 text-white text-[8px] font-black px-2 py-0.5 rounded-bl-lg uppercase tracking-wider">Системный</div>' : ''}
            
            <div class="flex items-start justify-between pr-16">
                <div>
                    <span class="text-[9px] font-black px-1.5 py-0.5 rounded border ${tagColor} uppercase tracking-wider">${doc.type}</span>
                    <div class="text-[13px] font-black text-slate-800 dark:text-white mt-1.5 leading-tight">${doc.code}</div>
                </div>
            </div>
            
            <div class="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">${doc.title}</div>
            
            <div class="flex gap-2 mt-1 pt-2 border-t border-slate-100 dark:border-slate-700">
                <button onclick="openDocLink('${doc.link}')" class="flex-1 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 px-3 py-2 rounded-lg text-[10px] font-bold uppercase flex items-center justify-center gap-1 active:scale-95 transition-colors">
                    📄 Читать текст
                </button>
                ${!isSystem ? `<button onclick="deleteCustomDoc('${doc.id}')" class="w-10 bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400 rounded-lg flex items-center justify-center font-bold text-sm active:scale-95 border border-red-100 dark:border-red-800">🗑️</button>` : ''}
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

// Заглушка для открытия ссылки
function openDocLink(link) {
    if (link && link.trim() !== '') {
        window.open(link, '_blank');
    } else {
        showToast('📄 Полный текст норматива сейчас недоступен (Демо-режим)');
    }
}

// Переключение кнопок-фильтров
function filterDocs(type, btnElement) {
    currentDocFilter = type;
    
    // Сбрасываем цвета всех кнопок
    const container = document.getElementById('doc-filters-container');
    container.querySelectorAll('.doc-filter-btn').forEach(btn => {
        btn.className = "doc-filter-btn px-3 py-1.5 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 active:scale-95 whitespace-nowrap border border-slate-200 dark:border-slate-700";
    });

    // Подкрашиваем активную
    btnElement.className = "doc-filter-btn px-3 py-1.5 rounded-lg text-[10px] font-bold bg-indigo-600 text-white shadow-sm active:scale-95 whitespace-nowrap border border-indigo-600";
    
    renderDocsList();
}

// Модалка: Открыть
function openAddDocModal() {
    document.getElementById('add-doc-modal-overlay').style.display = 'flex';
    document.body.classList.add('modal-open');
    // Сброс полей
    document.getElementById('new-doc-code').value = '';
    document.getElementById('new-doc-title').value = '';
    document.getElementById('new-doc-link').value = '';
}

// Модалка: Закрыть
function closeAddDocModal() {
    document.getElementById('add-doc-modal-overlay').style.display = 'none';
    document.body.classList.remove('modal-open');
}

// Модалка: Сохранить
async function saveCustomDoc() {
    const type = document.getElementById('new-doc-type').value;
    const code = document.getElementById('new-doc-code').value.trim();
    const title = document.getElementById('new-doc-title').value.trim();
    const link = document.getElementById('new-doc-link').value.trim();

    if (!code || !title) {
        return showToast('⚠️ Заполните шифр и название документа');
    }

    const newDoc = {
        id: 'usr_doc_' + Date.now().toString(36),
        type: type,
        code: code,
        title: title,
        link: link,
        isSystem: false
    };

    customDocs.push(newDoc);
    
    try {
        await dbPut(STORES.SETTINGS, { key: 'custom_docs', data: customDocs });
        showToast('✅ Норматив успешно добавлен!');
        closeAddDocModal();
        renderDocsList();
    } catch (e) {
        console.error(e);
        showToast('❌ Ошибка сохранения');
    }
}

// Удаление своего норматива
async function deleteCustomDoc(id) {
    if (!confirm('Удалить этот документ из базы?')) return;
    
    customDocs = customDocs.filter(d => d.id !== id);
    try {
        await dbPut(STORES.SETTINGS, { key: 'custom_docs', data: customDocs });
        showToast('🗑️ Документ удален');
        renderDocsList();
    } catch (e) {
        console.error(e);
        showToast('❌ Ошибка удаления');
    }
}

// ==========================================
// БЛОК: TWI КАРТЫ И КОНСТРУКТОР (ЭТАП 1: БД и UI)
// ==========================================

let customTwiCards = [];
let twiStepCount = 0;
let currentEditingTwiId = null;
let currentTwiStepUploadId = null; // Для пошагового TWI
let currentTwiType = 'INSPECTOR'; // Глобальный стейт (INSPECTOR, WORKER, PDF)

// Загрузка TWI карт при старте
document.addEventListener("DOMContentLoaded", async () => {
    try {
        const storedTwi = await dbGet(STORES.SETTINGS, 'custom_twi_cards');
        if (storedTwi && storedTwi.data) {
            // Адаптация старых карт (у которых нет type)
            customTwiCards = storedTwi.data.map(card => {
                if (!card.type) card.type = 'WORKER'; // Старые считаем пошаговыми
                return card;
            });
        }
    } catch (e) { console.error("Ошибка загрузки TWI", e); }
});

// 1. РЕНДЕР СПИСКА TWI КАРТ (С бейджиками типов)
function renderTwiList() {
    const container = document.getElementById('twi-cards-container');
    const searchInput = document.getElementById('twi-search-input')?.value.toLowerCase() || '';
    if (!container) return;

    const filtered = customTwiCards.filter(card => 
        card.title.toLowerCase().includes(searchInput) || 
        card.checklistName.toLowerCase().includes(searchInput)
    );

    if (filtered.length === 0) {
        container.innerHTML = `<div class="col-span-full text-center py-8 text-slate-500 text-sm font-bold bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">Инструкций пока нет. Создайте первую!</div>`;
        return;
    }

    container.innerHTML = filtered.map(card => {
        let typeBadge = '';
        if (card.type === 'INSPECTOR') typeBadge = '🕵️‍♂️ Карта Технадзора';
        else if (card.type === 'WORKER') typeBadge = '🛠 TWI Рабочего';
        else if (card.type === 'PDF') typeBadge = '📄 PDF Документ';

        let infoText = '';
        if (card.type === 'WORKER') infoText = `⏱️ ${(card.totalTime || 0)} мин | 📝 ${card.steps?.length || 0} шагов`;
        else if (card.type === 'INSPECTOR') infoText = `🔍 Привязан к пункту ID: ${card.itemId}`;
        else if (card.type === 'PDF') infoText = `📎 Внешний файл (Офлайн)`;

        return `
        <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 shadow-sm flex flex-col justify-between">
            <div>
                <div class="flex justify-between items-start mb-2">
                    <div class="text-[9px] font-black text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 dark:text-indigo-400 px-2 py-0.5 rounded uppercase truncate max-w-[60%]">
                        ${card.checklistName}
                    </div>
                    <div class="text-[8px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded whitespace-nowrap border border-slate-200 dark:border-slate-600">
                        ${typeBadge}
                    </div>
                </div>
                <div class="text-[13px] font-black leading-tight text-slate-800 dark:text-white mb-2">${card.title}</div>
                <div class="text-[10px] font-bold text-slate-500 mb-3">${infoText}</div>
            </div>
            <div class="flex gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                <button onclick="openTwiViewer('${card.id}')" class="flex-1 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 py-2 rounded-lg text-[10px] font-bold uppercase active:scale-95 transition-colors border border-indigo-100 dark:border-indigo-800">👁️ Смотреть</button>
                <button onclick="openTwiConstructor('${card.id}')" class="flex-1 bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300 py-2 rounded-lg text-[10px] font-bold uppercase active:scale-95 transition-colors border border-slate-200 dark:border-slate-600">✏️ Редак.</button>
                <button onclick="deleteTwiCard('${card.id}')" class="w-10 bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400 rounded-lg flex items-center justify-center font-bold text-sm active:scale-95 border border-red-100 dark:border-red-800 transition-colors">🗑️</button>
            </div>
        </div>`;
    }).join('');
}

// 2. ОТКРЫТИЕ КОНСТРУКТОРА И ПЕРЕКЛЮЧЕНИЕ ТИПОВ
function changeTwiType(type) {
    currentTwiType = type;
    
    // Сбрасываем стили кнопок
    const btns = ['inspector', 'worker', 'pdf'];
    btns.forEach(b => {
        const btnEl = document.getElementById(`twi-type-btn-${b}`);
        if(btnEl) {
            btnEl.className = "flex-1 py-2 text-[10px] font-bold uppercase rounded-lg text-slate-500 hover:text-slate-700 transition-all bg-transparent border border-transparent shadow-none";
        }
    });

    // Красим активную
    const activeBtn = document.getElementById(`twi-type-btn-${type.toLowerCase()}`);
    if (activeBtn) {
        activeBtn.className = "flex-1 py-2 text-[10px] font-bold uppercase rounded-lg bg-indigo-50 shadow-sm text-indigo-600 border border-indigo-200 transition-all";
    }

    // Показываем нужный блок
    document.getElementById('twi-block-inspector').classList.add('hidden');
    document.getElementById('twi-block-worker').classList.add('hidden');
    document.getElementById('twi-block-pdf').classList.add('hidden');

    document.getElementById(`twi-block-${type.toLowerCase()}`).classList.remove('hidden');
}

function populateTwiItemSelect(selectedItemId = null) {
    const checklistKey = document.getElementById('twi-checklist-select').value;
    const itemSelect = document.getElementById('twi-item-select');
    
    if (!checklistKey) {
        itemSelect.innerHTML = '<option value="" disabled selected>Сначала выберите чек-лист выше...</option>';
        return;
    }

    // Ищем массив пунктов (напрямую из глобальных объектов, чтобы работало всегда)
    let checklistGroups = [];
    const type = checklistKey.split('_')[0];
    const key = checklistKey.replace(type + '_', '');
    
    if (type === 'sys' && SYSTEM_TEMPLATES[key]) {
        checklistGroups = SYSTEM_TEMPLATES[key].groups;
    } else if (type === 'user' && userTemplates[key]) {
        checklistGroups = userTemplates[key].groups;
    }

    if (checklistGroups.length === 0) {
        itemSelect.innerHTML = '<option value="" disabled selected>Чек-лист пуст...</option>';
        return;
    }

    let optionsHtml = '<option value="ALL" class="font-bold text-indigo-600">📘 Привязать ко всему виду работ (Общая)</option>';
optionsHtml += '<option value="" disabled>--- Или выберите конкретный пункт ---</option>';
    
    checklistGroups.forEach(g => {
        optionsHtml += `<optgroup label="${g.group || g.title}">`;
        g.items.forEach(i => {
            optionsHtml += `<option value="${i.id}">[B${i.w}] ${i.n}</option>`;
        });
        optionsHtml += `</optgroup>`;
    });

    itemSelect.innerHTML = optionsHtml;
    
    if (selectedItemId) {
        // Убеждаемся, что значение приводится к строке, так как id в HTML option всегда строка
        itemSelect.value = String(selectedItemId);
    }
}

function openTwiConstructor(editId = null) {
    document.getElementById('twi-list-view').classList.add('hidden');
    document.getElementById('twi-constructor-view').classList.remove('hidden');
    window.scrollTo(0, 0);

    const selectEl = document.getElementById('twi-checklist-select');
    let options = '<option value="" disabled selected>Выберите вид работ...</option>';
    const allTemplates = { ...SYSTEM_TEMPLATES, ...userTemplates };
    for (let key in allTemplates) {
        options += `<option value="${key}">${allTemplates[key].title}</option>`;
    }
    selectEl.innerHTML = options;

    // Сброс всех полей
    document.getElementById('twi-title-input').value = '';
    document.getElementById('twi-steps-container').innerHTML = '';
    document.getElementById('twi-why-input').value = '';
    document.getElementById('twi-how-input').value = '';
    removeTwiGoodPhoto();
    removeTwiBadPhoto();
    removeTwiPdf();
    twiStepCount = 0;
    currentEditingTwiId = editId;

    if (editId) {
        const card = customTwiCards.find(c => c.id === editId);
        if (card) {
            document.getElementById('twi-title-input').value = card.title;
            selectEl.value = card.checklistKey;
            
            // Вызываем заполнение пунктов чек-листа и сразу подставляем сохраненный
            if(card.type === 'INSPECTOR') populateTwiItemSelect(card.itemId);
            else populateTwiItemSelect(); // Для остальных просто заполняем, чтобы было

            changeTwiType(card.type || 'WORKER');

            if (card.type === 'INSPECTOR') {
                document.getElementById('twi-why-input').value = card.whyImportant || '';
                document.getElementById('twi-how-input').value = card.howToCheck || '';
                if(card.photoGood) renderGoodPhoto(card.photoGood);
                if(card.photoBad) renderBadPhoto(card.photoBad);
            } else if (card.type === 'PDF') {
                if (card.pdfData) renderPdfFile(card.pdfName, card.pdfSize, card.pdfData);
            } else {
                // WORKER
                card.steps.forEach(step => addTwiStep(step));
            }
        }
    } else {
        // Создание новой
        changeTwiType('INSPECTOR');
        addTwiStep(); // Пустой шаг для Worker, на случай если он переключится
        populateTwiItemSelect();
    }
}

function closeTwiConstructor() {
    document.getElementById('twi-list-view').classList.remove('hidden');
    document.getElementById('twi-constructor-view').classList.add('hidden');
    currentEditingTwiId = null;
    renderTwiList();
}

// 3. ОБРАБОТКА ФОТО И PDF (ИНСПЕКТОР)
function compressImageToBase64(file, maxWidth, quality, callback) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            let width = img.width; let height = img.height;
            if (width > height && width > maxWidth) { height *= maxWidth / width; width = maxWidth; } 
            else if (height > maxWidth) { width *= maxWidth / height; height = maxWidth; }
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            callback(canvas.toDataURL('image/jpeg', quality));
        }
        img.src = e.target.result;
    }
    reader.readAsDataURL(file);
}

function handleTwiGoodPhotoUpload(event) {
    if (!event.target.files[0]) return;
    compressImageToBase64(event.target.files[0], 800, 0.8, (base64) => {
        renderGoodPhoto(base64);
        event.target.value = '';
    });
}
function renderGoodPhoto(base64) {
    const cont = document.getElementById('twi-photo-good-container');
    cont.dataset.photo = base64;
    cont.innerHTML = `<div class="relative w-full h-24 rounded-lg overflow-hidden border border-green-300 shadow-sm mt-1"><img src="${base64}" class="w-full h-full object-cover"><button onclick="removeTwiGoodPhoto()" class="absolute top-1 right-1 bg-red-500 text-white w-6 h-6 rounded-full flex items-center justify-center font-black text-xs shadow-md">✕</button></div>`;
}
function removeTwiGoodPhoto() {
    const cont = document.getElementById('twi-photo-good-container');
    cont.dataset.photo = '';
    cont.innerHTML = `<button onclick="document.getElementById('twi-photo-good-input').click()" class="w-full h-full min-h-[80px] bg-white dark:bg-slate-800 border border-dashed border-green-300 py-4 rounded-lg text-[10px] font-bold text-green-600 active:scale-95 transition-all">➕ Загрузить фото</button>`;
}

function handleTwiBadPhotoUpload(event) {
    if (!event.target.files[0]) return;
    compressImageToBase64(event.target.files[0], 800, 0.8, (base64) => {
        renderBadPhoto(base64);
        event.target.value = '';
    });
}
function renderBadPhoto(base64) {
    const cont = document.getElementById('twi-photo-bad-container');
    cont.dataset.photo = base64;
    cont.innerHTML = `<div class="relative w-full h-24 rounded-lg overflow-hidden border border-red-300 shadow-sm mt-1"><img src="${base64}" class="w-full h-full object-cover"><button onclick="removeTwiBadPhoto()" class="absolute top-1 right-1 bg-red-500 text-white w-6 h-6 rounded-full flex items-center justify-center font-black text-xs shadow-md">✕</button></div>`;
}
function removeTwiBadPhoto() {
    const cont = document.getElementById('twi-photo-bad-container');
    cont.dataset.photo = '';
    cont.innerHTML = `<button onclick="document.getElementById('twi-photo-bad-input').click()" class="w-full h-full min-h-[80px] bg-white dark:bg-slate-800 border border-dashed border-red-300 py-4 rounded-lg text-[10px] font-bold text-red-600 active:scale-95 transition-all">➕ Загрузить фото</button>`;
}

function handleTwiPdfUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (file.size > 5 * 1024 * 1024) {
        event.target.value = '';
        return alert("Файл слишком большой! Максимум 5 МБ для оффлайн БД.");
    }
    
    showToast("⚙️ Загружаем PDF в память...");
    const reader = new FileReader();
    reader.onload = function(e) {
        const base64 = e.target.result;
        renderPdfFile(file.name, (file.size / 1024 / 1024).toFixed(1) + ' MB', base64);
        event.target.value = '';
    }
    reader.readAsDataURL(file);
}
function renderPdfFile(name, size, base64) {
    const cont = document.getElementById('twi-pdf-container');
    cont.dataset.pdf = base64;
    document.getElementById('twi-pdf-name').innerText = name;
    document.getElementById('twi-pdf-size').innerText = size;
    cont.classList.remove('hidden');
    cont.nextElementSibling.classList.add('hidden'); // прячем кнопку выбора
}
function removeTwiPdf() {
    const cont = document.getElementById('twi-pdf-container');
    cont.dataset.pdf = '';
    cont.classList.add('hidden');
    cont.nextElementSibling.classList.remove('hidden'); // показываем кнопку выбора
}

// 4. ДОБАВЛЕНИЕ ШАГА (ДЛЯ РАБОЧЕГО TWI)
function addTwiStep(data = null) {
    twiStepCount++;
    const stepId = `twi-step-${twiStepCount}`;
    const text = data ? data.text : '';
    const time = data ? data.time : '';
    const photoSrc = data ? data.photo : null;
    
    const photoHtml = photoSrc ? 
        `<div class="relative w-full h-32 rounded-lg overflow-hidden border border-slate-200 shadow-sm mt-2"><img src="${photoSrc}" class="w-full h-full object-cover" id="img-${stepId}"><button onclick="removeTwiPhoto('${stepId}')" class="absolute top-1 right-1 bg-red-500 text-white w-6 h-6 rounded-full flex items-center justify-center font-black text-xs shadow-md">✕</button></div>` : 
        `<button onclick="triggerTwiPhotoUpload('${stepId}')" class="w-full mt-2 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 py-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 font-bold text-[10px] uppercase active:scale-95 transition-colors flex items-center justify-center gap-2" id="btn-photo-${stepId}">📸 Прикрепить фото/схему</button>`;

    const html = `
        <div id="${stepId}" class="twi-step-item bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 shadow-sm relative transition-all">
            <div class="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-2 mb-2">
                <div class="font-black text-[12px] text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5"><span class="w-5 h-5 bg-indigo-100 dark:bg-indigo-900/50 rounded flex items-center justify-center">${twiStepCount}</span> Шаг</div>
                <button onclick="document.getElementById('${stepId}').remove()" class="text-red-400 active:scale-90 font-black text-sm px-2">✕</button>
            </div>
            <textarea class="input-base text-[12px] h-16 resize-none mb-2 twi-step-text" placeholder="Опишите действие...">${text}</textarea>
            <div class="flex items-center gap-2 mb-1">
                <span class="text-[10px] font-bold text-slate-500 uppercase flex-1">Время на операцию:</span>
                <input type="number" class="input-base !w-24 text-center !py-1 text-[11px] twi-step-time" placeholder="Мин." value="${time}">
            </div>
            <div class="twi-photo-container" data-photo="${photoSrc || ''}">${photoHtml}</div>
        </div>`;
    document.getElementById('twi-steps-container').insertAdjacentHTML('beforeend', html);
}

function triggerTwiPhotoUpload(stepId) { currentTwiStepUploadId = stepId; document.getElementById('twi-photo-input').click(); }

function handleTwiPhotoUpload(event) {
    if (!event.target.files[0] || !currentTwiStepUploadId) return;
    compressImageToBase64(event.target.files[0], 800, 0.8, (base64) => {
        const container = document.getElementById(currentTwiStepUploadId).querySelector('.twi-photo-container');
        container.dataset.photo = base64;
        container.innerHTML = `<div class="relative w-full h-32 rounded-lg overflow-hidden border border-slate-200 shadow-sm mt-2"><img src="${base64}" class="w-full h-full object-cover"><button onclick="removeTwiPhoto('${currentTwiStepUploadId}')" class="absolute top-1 right-1 bg-red-500 text-white w-6 h-6 rounded-full flex items-center justify-center font-black text-xs shadow-md">✕</button></div>`;
        event.target.value = '';
    });
}

function removeTwiPhoto(stepId) {
    const container = document.getElementById(stepId).querySelector('.twi-photo-container');
    container.dataset.photo = '';
    container.innerHTML = `<button onclick="triggerTwiPhotoUpload('${stepId}')" class="w-full mt-2 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 py-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 font-bold text-[10px] uppercase active:scale-95 transition-colors flex items-center justify-center gap-2">📸 Прикрепить фото/схему</button>`;
}

// 5. СОХРАНЕНИЕ TWI КАРТЫ С УЧЕТОМ ТИПОВ
async function saveTwiCard() {
    const title = document.getElementById('twi-title-input').value.trim();
    const select = document.getElementById('twi-checklist-select');
    const checklistKey = select.value;
    const checklistName = select.options[select.selectedIndex]?.text || 'Без привязки';

    if (!title || !checklistKey) return showToast("⚠️ Укажите название и привязку к чек-листу!");

    let cardData = {
        id: currentEditingTwiId || 'twi_' + Date.now().toString(36),
        title: title,
        checklistKey: checklistKey,
        checklistName: checklistName,
        type: currentTwiType // 'INSPECTOR', 'WORKER', 'PDF'
    };

    if (currentTwiType === 'INSPECTOR') {
        const itemId = document.getElementById('twi-item-select').value;
        const why = document.getElementById('twi-why-input').value.trim();
        const how = document.getElementById('twi-how-input').value.trim();
        const pGood = document.getElementById('twi-photo-good-container').dataset.photo;
        const pBad = document.getElementById('twi-photo-bad-container').dataset.photo;

        if (!itemId) return showToast("⚠️ Выберите конкретный пункт контроля!");
        if (!why || !how) return showToast("⚠️ Заполните описания (Почему важно / Как проверять)!");

        cardData.itemId = parseInt(itemId);
        cardData.whyImportant = why;
        cardData.howToCheck = how;
        cardData.photoGood = pGood || null;
        cardData.photoBad = pBad || null;

    } else if (currentTwiType === 'WORKER') {
        const stepEls = document.getElementById('twi-steps-container').querySelectorAll('.twi-step-item');
        if (stepEls.length === 0) return showToast("⚠️ Добавьте хотя бы один шаг!");

        const steps = []; let totalTime = 0; let isValid = true;
        stepEls.forEach((el, index) => {
            const text = el.querySelector('.twi-step-text').value.trim();
            const time = parseInt(el.querySelector('.twi-step-time').value) || 0;
            const photo = el.querySelector('.twi-photo-container').dataset.photo || null;
            if (!text) isValid = false;
            totalTime += time;
            steps.push({ order: index + 1, text: text, time: time, photo: photo });
        });

        if (!isValid) return showToast("⚠️ Заполните текст во всех шагах!");
        cardData.totalTime = totalTime;
        cardData.steps = steps;

    } else if (currentTwiType === 'PDF') {
        const pdfData = document.getElementById('twi-pdf-container').dataset.pdf;
        if (!pdfData) return showToast("⚠️ Загрузите PDF-файл!");
        cardData.pdfData = pdfData;
        cardData.pdfName = document.getElementById('twi-pdf-name').innerText;
        cardData.pdfSize = document.getElementById('twi-pdf-size').innerText;
    }

    if (currentEditingTwiId) {
        const index = customTwiCards.findIndex(c => c.id === currentEditingTwiId);
        if (index !== -1) customTwiCards[index] = cardData;
    } else {
        customTwiCards.push(cardData);
    }

    try {
        await dbPut(STORES.SETTINGS, { key: 'custom_twi_cards', data: customTwiCards });
        showToast("✅ Инструкция успешно сохранена!");
        closeTwiConstructor();
    } catch (e) {
        console.error(e);
        showToast("❌ Ошибка при сохранении. Возможно файл слишком большой.");
    }
}

// 6. УДАЛЕНИЕ КАРТЫ
async function deleteTwiCard(id) {
    if (!confirm('Удалить эту инструкцию безвозвратно?')) return;
    customTwiCards = customTwiCards.filter(c => c.id !== id);
    try {
        await dbPut(STORES.SETTINGS, { key: 'custom_twi_cards', data: customTwiCards });
        showToast("🗑️ Инструкция удалена");
        renderTwiList();
    } catch (e) { showToast("❌ Ошибка удаления"); }
}

// === УПРАВЛЕНИЕ АККОРДЕОНАМИ (СПРАВОЧНИК) ===
function toggleManagePanel() {
    const body = document.getElementById('ref-manage-body');
    const icon = document.getElementById('ref-manage-toggle-icon');
    
    if (!body || !icon) return;

    if (body.style.maxHeight === '0px' || !body.style.maxHeight) {
        // Открываем панель управления
        body.style.maxHeight = '400px';
        body.style.opacity = '1';
        body.style.marginTop = '12px';
        icon.style.transform = 'rotate(0deg)';
        
        // Рендерим список шаблонов, если он пуст
        if (typeof renderSettingsTab === 'function') {
            renderSettingsTab();
        }
    } else {
        // Скрываем панель управления
        body.style.maxHeight = '0px';
        body.style.opacity = '0';
        body.style.marginTop = '0px';
        icon.style.transform = 'rotate(-90deg)';
    }
}
// ==========================================
// БЛОК: БИБЛИОТЕКА ТЕХНИЧЕСКИХ УЗЛОВ
// ==========================================

// Вшитые в систему узлы (Справочник)
const SYSTEM_NODES = [
    {
        id: 'node_1',
        category: 'ФАСАД',
        title: 'Узел примыкания НВФ к оконному блоку',
        desc: 'Типовое решение монтажа откоса из оцинкованной стали с полимерным покрытием с устройством противопожарной отсечки.',
        img: 'https://via.placeholder.com/800x600.png?text=Схема+Примыкания+Окна', // В реальности тут будет Base64 или путь к картинке
        materials: [
            { name: 'Кронштейн несущий КН-200', qty: '2 шт/м' },
            { name: 'Утеплитель минватный 100мм', qty: '1.05 м2/м2' },
            { name: 'Дюбель фасадный 10х120', qty: '5 шт/м2' },
            { name: 'Откос стальной (t=0.55мм)', qty: 'По проекту' }
        ],
        linkedDoc: 'СП 522.1325800.2023',
        linkedTwiChecklistKey: 'sys_nvf_facade' // Ищет TWI карту, привязанную к фасаду
    },
    {
        id: 'node_2',
        category: 'КЖ',
        title: 'Узел армирования пилона (П-1)',
        desc: 'Схема расположения продольной и поперечной арматуры пилона первого этажа. Шаг хомутов в зоне перехлеста.',
        img: 'https://via.placeholder.com/800x600.png?text=Схема+Армирования+Пилона',
        materials: [
            { name: 'Арматура A500C Ø16 (Продольная)', qty: '8 стержней' },
            { name: 'Арматура A240 Ø8 (Хомуты)', qty: 'Шаг 100/200' },
            { name: 'Фиксатор защитного слоя "Звездочка" 30мм', qty: '4 шт/м2' }
        ],
        linkedDoc: 'СП 70.13330.2012',
        linkedTwiChecklistKey: 'sys_armature'
    },
    {
        id: 'node_3',
        category: 'КЖ',
        title: 'Узел опирания лестничного марша',
        desc: 'Требования к минимальной глубине опирания сборного железобетонного марша на лестничную площадку.',
        img: 'https://via.placeholder.com/800x600.png?text=Опирание+Марша',
        materials: [
            { name: 'Раствор цементный М150', qty: 'Толщина 10-15мм' },
            { name: 'Закладная деталь ЗД-1', qty: '2 шт' }
        ],
        linkedDoc: 'ГОСТ 9818-2015',
        linkedTwiChecklistKey: 'sys_vent_stairs'
    }
];

let currentNodeFilter = 'ALL';

function renderNodesList() {
    const container = document.getElementById('nodes-list-container');
    const searchInput = document.getElementById('node-search-input')?.value.toLowerCase() || '';
    if (!container) return;

    let filtered = SYSTEM_NODES.filter(node => {
        const matchSearch = node.title.toLowerCase().includes(searchInput) || node.desc.toLowerCase().includes(searchInput);
        const matchFilter = currentNodeFilter === 'ALL' || node.category === currentNodeFilter;
        return matchSearch && matchFilter;
    });

    if (filtered.length === 0) {
        container.innerHTML = `<div class="col-span-full text-center py-8 text-slate-500 text-sm font-bold bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">Узлы не найдены</div>`;
        return;
    }

    container.innerHTML = filtered.map(node => `
        <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden shadow-sm flex flex-col cursor-pointer active:scale-[0.98] transition-transform" onclick="openNodeViewer('${node.id}')">
            <div class="h-28 bg-white dark:bg-slate-800 border-b border-[var(--card-border)] p-2">
                <img src="${node.img}" class="w-full h-full object-contain opacity-90">
            </div>
            <div class="p-3 flex-1 flex flex-col">
                <div class="text-[8px] font-black text-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 dark:text-indigo-400 px-2 py-0.5 rounded w-fit mb-1.5 uppercase">${node.category}</div>
                <div class="text-[11px] font-bold text-slate-800 dark:text-white leading-tight line-clamp-2">${node.title}</div>
            </div>
        </div>
    `).join('');
}

function filterNodes(category, btnElement) {
    currentNodeFilter = category;
    const container = document.getElementById('node-filters-container');
    container.querySelectorAll('.node-filter-btn').forEach(btn => {
        btn.className = "node-filter-btn px-3 py-1.5 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 active:scale-95 whitespace-nowrap border border-slate-200 dark:border-slate-700";
    });
    btnElement.className = "node-filter-btn px-3 py-1.5 rounded-lg text-[10px] font-bold bg-indigo-600 text-white shadow-sm active:scale-95 whitespace-nowrap border border-indigo-600";
    renderNodesList();
}

function openNodeViewer(nodeId) {
    const node = SYSTEM_NODES.find(n => n.id === nodeId);
    if (!node) return;

    document.getElementById('viewer-node-title').innerText = node.title;
    document.getElementById('viewer-node-desc').innerText = node.desc;
    document.getElementById('viewer-node-img').src = node.img;

    // Безопасный рендер бейджика категории
    const catEl = document.getElementById('viewer-twi-badge'); // Используем тот же ID, что и у TWI
    if(catEl) {
        catEl.innerText = node.category;
        catEl.className = 'bg-indigo-500 text-white px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest shadow-sm';
    }
    const checkEl = document.getElementById('viewer-twi-checklist');
    if(checkEl) checkEl.innerText = 'Технический Узел';

    const matTbody = document.getElementById('viewer-node-materials');
    matTbody.innerHTML = node.materials.map(m => `
        <tr class="border-b border-slate-100 dark:border-slate-700">
            <td class="p-2 font-medium text-slate-700 dark:text-slate-300 text-[11px]">${m.name}</td>
            <td class="p-2 text-right font-bold text-indigo-600 dark:text-indigo-400 whitespace-nowrap text-[11px]">${m.qty}</td>
        </tr>
    `).join('');

    // Ищем привязанную TWI карту ко ВСЕМУ чек-листу
    const linkedTwi = customTwiCards.find(c => c.checklistKey === node.linkedTwiChecklistKey && (c.itemId === 'ALL' || !c.itemId));
    const twiBtnHtml = linkedTwi 
        ? `<button onclick="closeNodeViewer(); setTimeout(()=>openTwiViewer('${linkedTwi.id}'), 300)" class="bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-900/30 dark:border-orange-800 dark:text-orange-400 py-3 rounded-xl text-[10px] font-bold uppercase shadow-sm active:scale-95 flex items-center justify-center gap-1.5"><span>🛠️</span> TWI Монтажа</button>`
        : `<div class="bg-slate-50 text-slate-400 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 py-3 rounded-xl text-[10px] font-bold uppercase flex items-center justify-center gap-1.5 opacity-70"><span>🚫</span> Нет TWI</div>`;

    document.getElementById('viewer-node-links').innerHTML = `
        <button onclick="closeNodeViewer(); setTimeout(()=>findAndOpenND('${node.linkedDoc}'), 300)" class="bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-400 py-3 rounded-xl text-[10px] font-bold uppercase shadow-sm active:scale-95 flex items-center justify-center gap-1.5">
            <span>📚</span> Норматив
        </button>
        ${twiBtnHtml}
    `;

    const overlay = document.getElementById('node-viewer-overlay');
    overlay.style.display = 'flex';
    document.body.classList.add('modal-open');
    setTimeout(() => overlay.classList.remove('opacity-0'), 10);
}

function closeNodeViewer() {
    const overlay = document.getElementById('node-viewer-overlay');
    overlay.classList.add('opacity-0');
    setTimeout(() => {
        overlay.style.display = 'none';
        document.body.classList.remove('modal-open');
    }, 300);
}

// === ПЕЧАТЬ TWI КАРТЫ ДЛЯ РАБОЧИХ ===
function printCurrentTwi() {
    const twiId = document.getElementById('twi-viewer-overlay').dataset.currentTwiId;
    if (!twiId) return;
    const card = customTwiCards.find(c => c.id === twiId);
    if (!card) return;

    let content = '';

    if (card.type === 'INSPECTOR') {
        content = `
            <div style="display:flex; gap:20px; margin-bottom:20px; page-break-inside: avoid;">
                <div style="flex:1; border:3px solid #22c55e; padding:10px; border-radius:10px; text-align:center; background:#f0fdf4;">
                    <h2 style="color:#166534; margin-top:0;">✅ ПРАВИЛЬНО (ЭТАЛОН)</h2>
                    ${card.photoGood ? `<img src="${card.photoGood}" style="max-height:300px; width:100%; object-fit:cover; border-radius:5px;">` : 'Нет фото'}
                </div>
                <div style="flex:1; border:3px solid #ef4444; padding:10px; border-radius:10px; text-align:center; background:#fef2f2;">
                    <h2 style="color:#991b1b; margin-top:0;">❌ БРАК (НЕ ДОПУСКАЕТСЯ)</h2>
                    ${card.photoBad ? `<img src="${card.photoBad}" style="max-height:300px; width:100%; object-fit:cover; border-radius:5px;">` : 'Нет фото'}
                </div>
            </div>
            <div style="background:#f8fafc; padding:15px; border-radius:10px; border:1px solid #cbd5e1; margin-bottom:15px; page-break-inside: avoid;">
                <h3 style="color:#0f172a; margin-top:0;">⚠️ Почему это важно (Риски):</h3>
                <p style="font-size:14px;">${card.whyImportant || 'Не указано'}</p>
            </div>
            <div style="background:#f8fafc; padding:15px; border-radius:10px; border:1px solid #cbd5e1; page-break-inside: avoid;">
                <h3 style="color:#0f172a; margin-top:0;">🔧 Как проверять (Методика):</h3>
                <p style="font-size:14px;">${card.howToCheck || 'Не указано'}</p>
            </div>
        `;
    } else if (card.type === 'WORKER') {
        content = `
            <div style="background:#f8fafc; padding:15px; border-radius:10px; border:1px solid #cbd5e1; margin-bottom:20px;">
                <h3 style="margin:0;">Параметры операции:</h3>
                <p>Время выполнения: ~<b>${card.totalTime} мин</b> | Количество шагов: <b>${card.steps.length}</b></p>
            </div>
            <div style="display:flex; flex-direction:column; gap:15px;">
        `;
        card.steps.forEach(step => {
            content += `
                <div style="border:2px solid #e2e8f0; border-left:5px solid #f59e0b; padding:15px; border-radius:8px; page-break-inside: avoid; display:flex; gap:15px; align-items:center;">
                    <div style="flex:1;">
                        <h3 style="color:#d97706; margin-top:0;">ШАГ ${step.order} ${step.time ? `(⏱ ${step.time} мин)` : ''}</h3>
                        <p style="font-size:16px; font-weight:bold;">${step.text}</p>
                    </div>
                    ${step.photo ? `<div style="flex:1; text-align:right;"><img src="${step.photo}" style="max-height:200px; max-width:100%; object-fit:contain; border-radius:5px; border:1px solid #cbd5e1;"></div>` : ''}
                </div>
            `;
        });
        content += `</div>`;
    } else {
        return showToast('Печать PDF-файлов осуществляется внешними средствами.');
    }

    printPdfShell(`ИНСТРУКЦИЯ: ${card.title} (${card.checklistName})`, content);
}