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
    theme: 'light',
    fontSize: 'medium',
    navPosition: 'auto',
    swipeEnabled: true,
    autoCollapseOk: false,
    fastMode: false,
    sortFailTop: false,
    soundEnabled: true,
    autoSave: true,
    aiEnabled: false,   // НОВОЕ
    aiAuto: false,      // НОВОЕ
    apiKey: ''          // НОВОЕ
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
            state, details, photos
        });
    } catch (e) {
        console.error('Ошибка сохранения в IndexedDB:', e);
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
            const key = currentTemplateKey.replace(type + '_', '');
            if (type === 'sys' && SYSTEM_TEMPLATES[key]) currentChecklist = SYSTEM_TEMPLATES[key].groups;
            else if (type === 'user' && userTemplates[key]) currentChecklist = userTemplates[key].groups;
        }

        state = data.state || {};
        details = data.details || {};
        photos = data.photos || {};

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
    
    // Если шапка видима, берем её реальную высоту
    if (headerEl && headerEl.style.display !== 'none') totalTop += headerEl.offsetHeight;
    
    // Если навигация сверху (на ПК или по настройке), добавляем её высоту
    if (navEl && getComputedStyle(navEl).top === '0px') totalTop += navEl.offsetHeight;
    
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

    // СКРЫТИЕ ШАПКИ НА ВСЕХ ВКЛАДКАХ, КРОМЕ ОСМОТРА
    const header = document.getElementById('main-header');
    if (header) {
        header.style.display = (tabId === 'tab-audit') ? 'block' : 'none';
    }

    if (tabId === 'tab-audit' && typeof render === 'function') { render(); updateUI(); } 
    else if (tabId === 'tab-history') { renderHistoryTab(); } 
    else if (tabId === 'tab-analytics' && typeof updateAnalyticsFilters === 'function') { updateAnalyticsFilters(); renderAnalyticsTab(); }
    else if (tabId === 'tab-reference') { renderReferenceTab(); }
    else if (tabId === 'tab-settings') { renderSettingsTab(); }
    
    setTimeout(updateBodyPadding, 50); // Пересчет отступов
    window.scrollTo(0, 0);
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
    if (appSettings.theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    
    if (appSettings.fastMode) document.body.classList.add('fast-mode');
    else document.body.classList.remove('fast-mode');

    // Настройка шрифта
    document.body.classList.remove('font-small', 'font-medium', 'font-large', 'font-xlarge');
    if(appSettings.fontSize !== 'medium') document.body.classList.add(`font-${appSettings.fontSize}`);
    
    // Настройка 3х позиций меню
    document.body.classList.remove('nav-pos-auto', 'nav-pos-top', 'nav-pos-bottom');
    document.body.classList.add(`nav-pos-${appSettings.navPosition || 'auto'}`);

    // Пересчет высоты после применения стилей
    setTimeout(() => {
        const headerEl = document.getElementById('main-header');
        if (headerEl) document.body.style.paddingTop = `${headerEl.offsetHeight + 10}px`;
    }, 100);

    if (document.getElementById('tab-audit')?.classList.contains('active') && typeof render === 'function') render();
}

function renderSettingsTab() {
    const map = {
        'set-theme': appSettings.theme === 'dark',
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
    if(document.getElementById('set-fontsize')) document.getElementById('set-fontsize').value = appSettings.fontSize || 'medium';
    if(document.getElementById('set-navpos')) document.getElementById('set-navpos').value = appSettings.navPosition || 'auto';
    if(document.getElementById('set-apikey')) document.getElementById('set-apikey').value = appSettings.apiKey || '';
    
    // Вызов функции подсчета хранилища
    updateStorageInfo();
}

function toggleSetting(settingKey, element) {
    let val = element.type === 'checkbox' ? element.checked : element.value;
    if (settingKey === 'theme') val = val ? 'dark' : 'light';
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
    for (let cName in grouped) {
        html += `<div class="font-black text-slate-700 dark:text-slate-300 text-xs mt-4 mb-2 uppercase tracking-tight pl-1 border-l-4 border-indigo-500">🏗️ ${cName}</div>`;
        for (let tTitle in grouped[cName]) {
            html += `<div class="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-2 ml-2">${tTitle} (${grouped[cName][tTitle].length} изд.)</div>`;
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
    updateCardDOM(id); updateUI(); saveSessionData();
}

function toggleFail(id) {
    if (state[id] === 'fail' || state[id] === 'fail_escalated') { state[id] = null; delete photos[id]; delete details[id]; } 
    else { state[id] = 'fail'; delete photos[id]; delete details[id]; }
    updateCardDOM(id); updateUI(); saveSessionData();
}

function toggleEscalation(id) {
    if (state[id] === 'fail_escalated') state[id] = 'fail';
    else if (state[id] === 'fail') state[id] = 'fail_escalated';
    updateCardDOM(id); updateUI(); saveSessionData();
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
        // Жестко задаем отступ при скролле (шапка сжимается до ~100px)
        const headerOffset = 110; 
        const elementPosition = content.previousElementSibling.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
        window.scrollTo({ top: offsetPosition, behavior: "smooth" });
    }
}

function updateGroupCounters() {
    if(!currentTemplateKey) return;
    currentChecklist.forEach((g, gIndex) => {
        let answered = 0;
        let hasFails = false;
        g.items.forEach(i => {
            if (state[i.id]) answered++;
            if (state[i.id] === 'fail' || state[i.id] === 'fail_escalated') hasFails = true;
        });
        
        const counterEl = document.getElementById(`group-counter-${gIndex}`);
        const navBtnEl = document.getElementById(`nav-btn-${gIndex}`);
        
        if (counterEl) counterEl.innerText = `${answered}/${g.items.length}`;
        
        if (navBtnEl) {
            // Меняем цвет кнопки навигации в зависимости от статуса заполнения
            if (answered === g.items.length) {
                navBtnEl.className = `inline-block px-3 py-2 mr-2 text-[10px] font-black uppercase rounded-xl border transition-colors shadow-sm ${hasFails ? 'bg-red-50 text-red-600 border-red-200' : 'bg-green-50 text-green-700 border-green-200'}`;
            } else if (answered > 0) {
                navBtnEl.className = `inline-block px-3 py-2 mr-2 text-[10px] font-black uppercase rounded-xl border border-indigo-300 bg-indigo-50 text-indigo-700 transition-colors shadow-sm`;
            } else {
                navBtnEl.className = `inline-block px-3 py-2 mr-2 text-[10px] font-bold uppercase rounded-xl bg-[var(--hover-bg)] text-[var(--text-muted)] border border-[var(--card-border)] transition-colors active:scale-95`;
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
            `<div class="relative inline-block"><button onclick="toggleCommentField(${id})" class="btn-status text-indigo-600 bg-indigo-100 border-indigo-300 dark:bg-indigo-900 dark:text-indigo-300 !w-10 !h-10 !rounded-md">💬</button><div onclick="deleteComment(${id}, event)" class="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-[12px] font-bold cursor-pointer">✕</div></div>` : 
            `<button onclick="toggleCommentField(${id})" class="btn-status !w-10 !h-10 !rounded-md">💬</button>`;
        
        let photoBtn = photos[id] ? 
            `<div class="relative inline-block"><img src="${photos[id]}" class="photo-thumb !w-10 !h-10 !rounded-md" onclick="openPhotoViewer('${photos[id]}')"><div onclick="removePhoto(${id}, event)" class="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-[12px] font-bold cursor-pointer">✕</div></div>` : 
            `<button onclick="triggerPhotoInput(${id})" class="btn-status !w-10 !h-10 !rounded-md">📸</button>`;

        let escBtn = (i.w === 2) ? `<button onclick="toggleEscalation(${id})" class="btn-status ${isEscalated ? 'bg-red-600 text-white border-red-600' : 'text-orange-500'} !w-10 !h-10 !rounded-md"><span class="text-[11px] font-black">>1.5</span></button>` : '';

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
function updateUI() {
    const p = currentTemplateKey ? getProductMetrics(state, currentChecklist) : null;
    
    // Обновляем изделие
    if (!p) {
        if(document.getElementById('dash-p-text')) document.getElementById('dash-p-text').innerText = "0/0";
        if(document.getElementById('dash-p-bar')) document.getElementById('dash-p-bar').style.width = "0%";
        if(document.getElementById('dash-p-details')) document.getElementById('dash-p-details').innerText = "Начните заполнение чек-листа.";
        ['dash-b1', 'dash-b2', 'dash-b3'].forEach(id => { if(document.getElementById(id)) document.getElementById(id).innerText = "0"; });
    } else {
        if(document.getElementById('dash-p-text')) document.getElementById('dash-p-text').innerText = `${p.checkedCount}/${p.totalCount}`;
        if(document.getElementById('dash-p-bar')) {
            document.getElementById('dash-p-bar').style.width = `${p.final}%`;
            document.getElementById('dash-p-bar').className = `absolute top-0 left-0 h-full transition-all duration-500 ${p.isDanger ? 'bg-red-500' : (p.final < 85 ? 'bg-yellow-400' : 'bg-green-500')}`;
        }
        ['dash-b1', 'dash-b2', 'dash-b3'].forEach((id, idx) => { if(document.getElementById(id)) document.getElementById(id).innerText = [p.n_B1_fail, p.n_B2_fail, p.n_B3_fail][idx]; });

        if(document.getElementById('dash-p-details')) {
            document.getElementById('dash-p-details').innerHTML = `Балл: <b class="text-indigo-600 text-[11px]">${p.final}%</b><br>Штраф B2: <b>${p.kc}</b> | B3: <b>${p.kcrit}</b><br><span class="${p.statusCls} mt-1">${p.statusTxt}</span>`;
        }
    }

    // Обновляем подрядчика
    const currentContr = document.getElementById('inp-contractor')?.value.trim();
    const filteredArr = currentContr ? contractorArray.filter(i => i.contractorName === currentContr && i.templateKey === currentTemplateKey) : [];
    
    if (filteredArr.length < 7) {
        if(document.getElementById('dash-c-text')) document.getElementById('dash-c-text').innerText = `${filteredArr.length}/7`;
        if(document.getElementById('dash-c-bar')) document.getElementById('dash-c-bar').style.width = "0%";
        if(document.getElementById('dash-c-details')) document.getElementById('dash-c-details').innerText = `Собрано ${filteredArr.length} из 7 необходимых проверок.`;
    } else {
        const c = getContractorMetrics(filteredArr, userTemplates);
        if(c) {
            if(document.getElementById('dash-c-text')) document.getElementById('dash-c-text').innerText = `${c.count} шт.`;
            if(document.getElementById('dash-c-bar')) {
                document.getElementById('dash-c-bar').style.width = `${c.finalC}%`;
                document.getElementById('dash-c-bar').className = `absolute top-0 left-0 h-full transition-all duration-500 ${c.isRedZone ? 'bg-red-500' : (c.finalC < 85 ? 'bg-yellow-400' : 'bg-green-500')}`;
            }
            if(document.getElementById('dash-c-details')) {
                document.getElementById('dash-c-details').innerHTML = `УрК: <b class="text-indigo-600 text-[11px]">${c.finalC}%</b><br>Волатильность: <b>${c.volatility.toFixed(1)}</b><br><span class="${c.riskCls} mt-1 uppercase">${c.riskStatus}</span>`;
            }
        }
    }
    updateGroupCounters();
}

// === СОХРАНЕНИЕ / ОЧИСТКА ===
function saveProductToArray() {
    const p = getProductMetrics(state, currentChecklist);
    if (!p) return showToast('Чек-лист пуст. Заполните данные.');
    
    const locInput = document.getElementById('inp-location');
    if (!locInput.value.trim()) {
        locInput.classList.add('border-red-500', 'bg-red-50');
        setTimeout(() => locInput.classList.remove('border-red-500', 'bg-red-50'), 3000);
        return showToast('Укажите локацию!');
    }

    const newItem = { 
        id: Date.now(), date: new Date().toISOString(), 
        projectName: document.getElementById('inp-project').value.trim(), 
        inspectorName: document.getElementById('inp-inspector').value.trim(), 
        contractorName: document.getElementById('inp-contractor').value.trim(),
        templateKey: currentTemplateKey, 
        templateTitle: document.getElementById('checklist-selector').options[document.getElementById('checklist-selector').selectedIndex].text,
        location: locInput.value.trim(), 
        state: JSON.parse(JSON.stringify(state)), details: JSON.parse(JSON.stringify(details)), photos: JSON.parse(JSON.stringify(photos)), metrics: p
    };

    contractorArray.push(newItem);
    dbPut(STORES.HISTORY, newItem); // Пишем сразу в базу
    
    state = {}; details = {}; photos = {}; locInput.value = ''; 
    saveSessionData(); 
    
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast(`Сохранено успешно!`);
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
function toggleCommentField(id) {
    // В v15 использовалась модалка
    const val = prompt('Введите комментарий к дефекту:', details[id]?.comment || '');
    if (val !== null) {
        details[id] = details[id] || {};
        details[id].comment = val;
        updateCardDOM(id); saveSessionData();
    }
}
function deleteComment(id, e) {
    if(e) e.stopPropagation();
    if(details[id]) details[id].comment = "";
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
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const MAX_WIDTH = 800; const MAX_HEIGHT = 800;
            let width = img.width; let height = img.height;

            if (width > height) { if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } } 
            else { if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; } }

            canvas.width = width; canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            
            // В v16.0 храним как base64 jpeg с качеством 0.6 (как в v15) для совместимости
            photos[currentPhotoId] = canvas.toDataURL('image/jpeg', 0.6);
            updateCardDOM(currentPhotoId); saveSessionData();
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

// === ДЕМО-РЕЖИМ (Совместимость с v15) ===
function startDemoMode() {
    // Сохраняем реальные данные перед запуском демо
    realState = JSON.parse(JSON.stringify(state));
    realDetails = JSON.parse(JSON.stringify(details));
    realPhotos = JSON.parse(JSON.stringify(photos));
    realContractorArray = JSON.parse(JSON.stringify(contractorArray));
    realTemplateKey = currentTemplateKey;

    isDemoMode = true;
    document.body.classList.add('demo-mode');
    
    // Генерируем фейковую базу
    contractorArray = generateDemoHistory();

    // Заполняем поля шапки
    document.getElementById('inp-project').value = 'ЖК "Демонстрационный"';
    document.getElementById('inp-inspector').value = 'Иванов И.И. (Демо)';
    document.getElementById('inp-contractor').value = 'ООО "Монолит-Строй" (Каркас)';
    document.getElementById('inp-location').value = 'Секция 2, Эт 5, Стены';

    // Включаем системный шаблон монолита
    currentTemplateKey = 'sys_monolit';
    if(document.getElementById('checklist-selector')) document.getElementById('checklist-selector').value = currentTemplateKey;
    currentChecklist = SYSTEM_TEMPLATES['monolit'].groups;
    
    // Имитируем заполнение чек-листа
    state = {}; details = {}; photos = {};
    const flatList = getFlatList(currentChecklist);
    flatList.forEach((item, index) => {
        if (index === 1) { // Ошибка B2
            state[item.id] = 'fail';
            details[item.id] = { comment: "Отклонение превышает допуск на 5мм" };
        } else if (index === 2) { // Критическая ошибка B3
            state[item.id] = 'fail_escalated';
            details[item.id] = { comment: "Жесткое нарушение, арматура торчит" };
        } else { // Остальное OK
            state[item.id] = 'ok';
        }
    });

    // Обновляем интерфейс
    updateDataSummary();
    document.getElementById('empty-checklist-state').style.display = 'none';
    document.getElementById('audit-items').style.display = 'block';
    document.getElementById('audit-actions').style.display = 'grid';
    
    render(); updateUI();
    showToast('🎮 Демо-режим активирован!');
    toggleDataBlock(true); // Разворачиваем шапку
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
    let mockArray = []; const now = new Date();
    const demoPhoto = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><rect width='200' height='200' fill='%23cbd5e1'/><text x='100' y='100' font-family='Arial' font-size='20' font-weight='bold' fill='%23475569' text-anchor='middle' dominant-baseline='middle'>ФОТО ДЕФЕКТА</text></svg>";
    const createMockMetric = (final, b1, b2, b3, danger, txt, cls, reason) => ({ final, baseUrkPerc: final + Math.floor(Math.random()*10), checkedCount: 15, totalCount: 20, n_B1_fail: b1, n_B2_fail: b2, n_B3_fail: b3, b3_found: b3>0, kc: b2 > 2 ? 0.85 : 1.0, kcrit: b3>0 ? 0.5 : 1.0, statusTxt: txt, statusCls: cls, isDanger: danger, reason, warnings: [] });

    // Идеальный подрядчик
    for(let i=0; i<8; i++) {
        let d = new Date(now); d.setDate(now.getDate() - (i*2));
        mockArray.push({ id: 1000 + i, date: d.toISOString(), projectName: 'ЖК "Демонстрационный"', inspectorName: 'Иванов И.И.', contractorName: 'ООО "Альфа-Отделка"', templateKey: 'sys_otdelka_pokraska', templateTitle: 'Отделочные работы', location: `Секция 1, Эт ${i+2}`, state: {'2209':'ok', '2210':'ok'}, details: {}, photos: {}, metrics: createMockMetric(i===3?80:92, 0, i===3?1:0, 0, false, i===3?'ИСПРАВИТЬ':'ПРИНЯТО', i===3?'tag-yellow':'tag-green', 'Мелкие огрехи') });
    }
    // Средний подрядчик
    for(let i=0; i<7; i++) {
        let d = new Date(now); d.setDate(now.getDate() - (i*3));
        let hasDefect = (i % 2 === 0); let p_data = hasDefect ? {'1006': demoPhoto} : {};
        mockArray.push({ id: 2000 + i, date: d.toISOString(), projectName: 'ЖК "Демонстрационный"', inspectorName: 'Иванов И.И.', contractorName: 'ООО "Монолит-Строй" (Каркас)', templateKey: 'sys_monolit', templateTitle: 'Устройство монолитных работ', location: `Секция 2, Пилон П-${i+1}`, state: {'1006': hasDefect?'fail':'ok', '1007': 'ok'}, details: {}, photos: p_data, metrics: createMockMetric(hasDefect?76:85, 1, hasDefect?2:0, 0, false, hasDefect?'ИСПРАВИТЬ':'ПРИНЯТО', hasDefect?'tag-yellow':'tag-green', 'Отклонения геометрии') });
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
        body.innerHTML = `<div class="space-y-3 text-sm leading-6">
            <div class="rounded-2xl border border-sky-200 bg-sky-50 p-4">
                <p class="font-semibold text-sky-900 mb-2">Что считает система</p>
                <div class="space-y-2 text-sky-900"><p><b>УрК изделия</b> — качество конкретного узла.</p><p><b>УрК подрядчика</b> — качество по массиву проверок.</p><p class="text-sky-800"><b>Чем выше процент, тем лучше.</b></p></div>
            </div>
            <div class="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                <p class="font-semibold text-violet-900 mb-2">Категории дефектов</p>
                <div class="grid grid-cols-1 gap-2 text-violet-900">
                    <div class="bg-white/80 p-2 rounded"><b>B1</b> — незначительный</div>
                    <div class="bg-white/80 p-2 rounded"><b>B2</b> — значительный</div>
                    <div class="bg-white/80 p-2 rounded"><b>B3</b> — критический</div>
                </div>
            </div>
            <div class="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <p class="font-semibold text-emerald-900 mb-2">Расчет УрК</p>
                <code class="block rounded border border-emerald-200 bg-white p-2 text-xs mb-2">УрК = База × Kc × Kcrit</code>
                <p class="text-emerald-900 text-xs">Система применяет штрафы за концентрацию ошибок (Kc) и за наличие критических дефектов (Kcrit).</p>
            </div>
        </div>`;
    } else if (type === 'analytics' || type === 'rating') {
        title.innerText = "Справка по Аналитике";
        body.innerHTML = `<div class="space-y-3">
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
}

// === ПОЛНАЯ АНАЛИТИКА С ГРАФИКАМИ CHART.JS (СОВМЕСТИМОСТЬ v15) ===
function renderAnalyticsTab() {
    const container = document.getElementById('analytics-contractors-container');
    if(!container) return;
    
    // Уничтожаем старые графики перед перерисовкой
    for (const key in chartInstances) { if (chartInstances[key]) chartInstances[key].destroy(); }
    chartInstances = {};

    if (contractorArray.length === 0) {
        container.innerHTML = `<p class="text-sm text-[var(--text-muted)] text-center bg-[var(--card-bg)] border border-[var(--card-border)] p-6 rounded-xl">Нет данных для аналитики.</p>`; 
        return;
    }

    const selContr = document.getElementById('analytics-contractor-select')?.value || 'ALL';
    const selTmpl = document.getElementById('analytics-template-select')?.value || 'ALL';
    const selPeriod = document.getElementById('analytics-period-select')?.value || 'ALL';
    
    let baseArray = contractorArray;
    const now = new Date();
    
    if (selPeriod === 'DAY') baseArray = baseArray.filter(i => new Date(i.date).toDateString() === now.toDateString()); 
    else if (selPeriod === 'MONTH') { const m = new Date(); m.setDate(now.getDate()-30); baseArray = baseArray.filter(i => new Date(i.date) >= m); } 
    else if (selPeriod === 'WEEK') { const w = new Date(); w.setDate(now.getDate()-7); baseArray = baseArray.filter(i => new Date(i.date) >= w); }

    if(selContr !== "ALL") baseArray = baseArray.filter(i => i.contractorName === selContr);
    if(selTmpl !== "ALL") baseArray = baseArray.filter(i => i.templateKey === selTmpl);

    if (baseArray.length === 0) { 
        container.innerHTML = `<p class="text-sm text-[var(--text-muted)] text-center bg-[var(--card-bg)] border border-[var(--card-border)] p-6 rounded-xl">По заданным фильтрам данных нет.</p>`; 
        return; 
    }

    let html = ""; let chartConfigs = [];
    let sumUrk = 0; let sumB3 = 0;
    let contractorMap = {}; let templateMap = {};

    baseArray.forEach(item => {
        sumUrk += item.metrics.final;
        sumB3 += item.metrics.n_B3_fail;

        let cName = item.contractorName || 'Не указан';
        if (!contractorMap[cName]) contractorMap[cName] = { sum: 0, count: 0 };
        contractorMap[cName].sum += item.metrics.final;
        contractorMap[cName].count++;

        let tName = item.templateTitle || 'Не указано';
        if (!templateMap[tName]) templateMap[tName] = { sum: 0, count: 0 };
        templateMap[tName].sum += item.metrics.final;
        templateMap[tName].count++;
    });

    const avgUrk = Math.round(sumUrk / baseArray.length);
    const avgColor = avgUrk < 70 ? 'text-red-600' : (avgUrk < 85 ? 'text-orange-500' : 'text-green-600');
    const b3Color = sumB3 > 0 ? 'text-red-600' : 'text-slate-800 dark:text-slate-200';

    const cLabels = Object.keys(contractorMap).map(k => k.length > 15 ? k.substring(0, 15) + '...' : k);
    const cData = Object.keys(contractorMap).map(k => Math.round(contractorMap[k].sum / contractorMap[k].count));
    
    const tLabels = Object.keys(templateMap).map(k => k.length > 15 ? k.substring(0, 15) + '...' : k);
    const tData = Object.keys(templateMap).map(k => Math.round(templateMap[k].sum / templateMap[k].count));

    html += `
    <div class="mb-8 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden shadow-md">
        <div class="bg-slate-800 dark:bg-slate-900 text-white p-3 font-black text-sm uppercase tracking-wider flex justify-between items-center gap-2">
            <span>📊 Сводный Дашборд</span>
            <span class="text-[10px] bg-slate-700 px-2 py-1 rounded">Выборка: ${baseArray.length}</span>
        </div>
        <div class="p-3 bg-[var(--hover-bg)]">
            <div class="grid grid-cols-3 gap-2 mb-4 text-center">
                <div class="bg-[var(--card-bg)] p-3 rounded-xl border border-[var(--card-border)] shadow-sm">
                    <div class="text-[9px] text-[var(--text-muted)] uppercase font-bold mb-1">Средний УрК</div>
                    <div class="text-2xl font-black ${avgColor} leading-none">${avgUrk}%</div>
                </div>
                <div class="bg-[var(--card-bg)] p-3 rounded-xl border border-[var(--card-border)] shadow-sm">
                    <div class="text-[9px] text-[var(--text-muted)] uppercase font-bold mb-1">Проверок</div>
                    <div class="text-2xl font-black leading-none">${baseArray.length}</div>
                </div>
                <div class="bg-[var(--card-bg)] p-3 rounded-xl border border-[var(--card-border)] shadow-sm">
                    <div class="text-[9px] text-[var(--text-muted)] uppercase font-bold mb-1">Крит. ошибки</div>
                    <div class="text-2xl font-black ${b3Color} leading-none">${sumB3}</div>
                </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-3 shadow-sm">
                    <div class="text-[10px] font-bold text-[var(--text-muted)] uppercase mb-2 text-center">Качество Подрядчиков</div>
                    <div style="height: 160px; position: relative;"><canvas id="chart_summary_c"></canvas></div>
                </div>
                <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-3 shadow-sm">
                    <div class="text-[10px] font-bold text-[var(--text-muted)] uppercase mb-2 text-center">Качество по Видам работ</div>
                    <div style="height: 160px; position: relative;"><canvas id="chart_summary_t"></canvas></div>
                </div>
            </div>
        </div>
    </div>`;

    chartConfigs.push({ id: 'chart_summary_c', type: 'bar', labels: cLabels, data: cData });
    chartConfigs.push({ id: 'chart_summary_t', type: 'bar', labels: tLabels, data: tData });

    // Группировка по подрядчикам для детального разбора
    let blocksToProcess = [];
    const uniqueCs = [...new Set(baseArray.map(i => i.contractorName))];
    uniqueCs.forEach(cName => {
        const cDataGroup = baseArray.filter(i => i.contractorName === cName);
        const uniqueTs = [...new Set(cDataGroup.map(i => i.templateKey))];
        uniqueTs.forEach(tKey => {
            blocksToProcess.push({ 
                contractor: cName, 
                templateKey: tKey,
                templateTitle: cDataGroup.find(i => i.templateKey === tKey).templateTitle, 
                data: cDataGroup.filter(i => i.templateKey === tKey) 
            });
        });
    });

    blocksToProcess.forEach((block, index) => {
        const filteredArray = block.data;
        const safeNameId = block.contractor.replace(/\W/g, '_') + '_' + index;
        const labels = filteredArray.map((_, i) => `#${i+1}`);
        const dataUrk = filteredArray.map(item => item.metrics.final);

        let failCounts = {}, critList = [], allPhotos = [];
        const type = block.templateKey.split('_')[0]; 
        const key = block.templateKey.replace(type + '_', '');
        const refChecklist = type === 'sys' && SYSTEM_TEMPLATES[key] ? SYSTEM_TEMPLATES[key].groups : (userTemplates[key] ? userTemplates[key].groups : currentChecklist);
        
        const flatList = getFlatList(refChecklist);
        flatList.forEach(i => failCounts[i.id] = { count: 0, n: i.n, w: i.w, photo: null });

        filteredArray.forEach((unit) => {
            flatList.forEach(i => {
                const s = unit.state[i.id];
                if (s === 'fail' || s === 'fail_escalated') {
                    if(failCounts[i.id]) failCounts[i.id].count++;
                    let photoTag = '';
                    if (unit.photos && unit.photos[i.id]) {
                        if(failCounts[i.id]) failCounts[i.id].photo = unit.photos[i.id];
                        photoTag = `<img src="${unit.photos[i.id]}" class="w-7 h-7 rounded object-cover border border-[var(--card-border)] ml-2" onclick="openPhotoViewer('${unit.photos[i.id]}')" />`;
                        allPhotos.push({ src: unit.photos[i.id], loc: unit.location, date: new Date(unit.date).toLocaleDateString('ru-RU') });
                    }
                    if (i.w === 3 || s === 'fail_escalated') {
                        critList.push(`<div class="flex justify-between items-center border-b border-red-100 dark:border-red-900/50 pb-2 mb-2"><div class="text-[11px] text-red-700 dark:text-red-400 font-bold"><span class="text-red-400 dark:text-red-600 block text-[9px]">[${new Date(unit.date).toLocaleDateString()}] ${unit.location}</span>${i.n}</div>${photoTag}</div>`);
                    }
                }
            });
        });

        const sortedFails = Object.values(failCounts).filter(x => x.count > 0).sort((a, b) => b.count - a.count).slice(0, 5);
        let topDefectsHtml = sortedFails.length > 0 ? sortedFails.map(f => `
            <div class="flex justify-between items-center p-2 border-b border-[var(--hover-bg)]">
                <div class="flex-1 leading-snug"><span class="weight-tag wt-${f.w}">B${f.w}</span> <span class="text-[11px] font-bold">${f.n}</span></div>
                <div class="flex items-center gap-2"><div class="bg-[var(--hover-bg)] px-2 py-1 rounded text-[10px] font-black">${f.count} раз</div>${f.photo ? `<img src="${f.photo}" class="w-7 h-7 rounded object-cover border border-[var(--card-border)]" onclick="openPhotoViewer('${f.photo}')"/>` : ''}</div>
            </div>`).join('') : `<p class="text-xs text-[var(--text-muted)] p-2 text-center">Дефектов не найдено</p>`;
        
        let critDefectsHtml = critList.length > 0 ? critList.join('') : `<p class="text-[11px] text-red-400 p-2 font-bold text-center">Критических дефектов нет.</p>`;
        let galleryHtml = allPhotos.length > 0 ? `<div class="grid grid-cols-3 gap-2">${allPhotos.slice(-6).reverse().map(p => `<div class="border border-[var(--card-border)] rounded-lg overflow-hidden relative" onclick="openPhotoViewer('${p.src}')"><img src="${p.src}" class="w-full h-20 object-cover" /><div class="absolute bottom-0 w-full bg-black/70 text-white text-[8px] p-1 font-bold">${p.loc}</div></div>`).join('')}</div>` : `<p class="text-xs text-[var(--text-muted)] text-center py-6">Нет фотографий.</p>`;

        let expHtml = "";
        if (filteredArray.length >= 7) {
            const metrics = getContractorMetrics(filteredArray, userTemplates);
            if (metrics) {
                const expert = getExpertConclusion(metrics, block.contractor, block.templateTitle, filteredArray.length, safeNameId, customExpertConclusions);
                expHtml = expert.uiHtml;
            }
        } else {
            expHtml = `<div class="bg-yellow-50 text-yellow-800 p-3 rounded-lg text-[10px] mt-4 mb-4 font-bold border border-yellow-200 shadow-sm">Собрано ${filteredArray.length} изд. Для расчета УрК нужно минимум 7.</div>`;
        }

        html += `
            <div class="mb-8 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden shadow-sm">
                <div class="bg-slate-800 dark:bg-slate-900 text-white p-3 font-black text-sm uppercase tracking-wider flex justify-between items-center gap-2">
                    <span class="truncate">🏗️ ${block.contractor}</span>
                    <span class="text-[10px] bg-slate-700 px-2 py-1 rounded shrink-0">Выборка: ${filteredArray.length}</span>
                </div>
                <div class="bg-[var(--hover-bg)] border-b border-[var(--card-border)] px-4 py-2 text-[10px] font-bold text-[var(--text-muted)] uppercase">${block.templateTitle}</div>
                <div class="p-4">
                    ${expHtml}
                    <div class="text-[11px] font-bold text-[var(--text-muted)] uppercase mb-2">График качества</div>
                    <div class="bg-white dark:bg-slate-800 border border-[var(--card-border)] rounded-xl p-3 mb-6 h-[200px] shadow-sm"><canvas id="chart_ui_${safeNameId}"></canvas></div>
                    
                    <div class="text-[11px] font-bold text-[var(--text-muted)] uppercase mb-2">Топ-5 ошибок</div>
                    <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-2 mb-6 shadow-sm">${topDefectsHtml}</div>
                    
                    <div class="text-[11px] font-bold text-red-500 uppercase mb-2">Критические ошибки (B3)</div>
                    <div class="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900 rounded-xl p-3 mb-6 shadow-sm">${critDefectsHtml}</div>
                    
                    <div class="text-[11px] font-bold text-[var(--text-muted)] uppercase mb-2">Фотоотчет (Последние)</div>
                    <div class="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-3 shadow-sm min-h-[100px]">${galleryHtml}</div>
                </div>
            </div>`;
        
        chartConfigs.push({ id: `chart_ui_${safeNameId}`, type: 'line', labels: labels, data: dataUrk });
    });

    container.innerHTML = html;
    
    // Инициализация Chart.js
    const getColor = (val) => val < 70 ? '#ef4444' : (val < 85 ? '#f59e0b' : '#22c55e');

    chartConfigs.forEach(cfg => {
        const ctx = document.getElementById(cfg.id).getContext('2d');
        if (cfg.type === 'bar') {
            chartInstances[cfg.id] = new Chart(ctx, {
                type: 'bar',
                data: { labels: cfg.labels, datasets: [{ data: cfg.data, backgroundColor: cfg.data.map(getColor), borderRadius: 4 }] },
                options: { animation: false, responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100 } }, plugins: { legend: { display: false } } }
            });
        } else {
            chartInstances[cfg.id] = new Chart(ctx, {
                type: 'line', 
                data: { labels: cfg.labels, datasets: [{ data: cfg.data, borderColor: '#4f46e5', backgroundColor: '#4f46e5', tension: 0.3, borderWidth: 2, pointRadius: 3 }] },
                options: { animation: false, responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100 } }, plugins: { legend: { display: false } } },
                plugins: [{ 
                    id: 'targetZone', 
                    beforeDraw: (chart) => {
                        const { ctx, chartArea: { left, right }, scales: { y } } = chart; 
                        ctx.save();
                        ctx.fillStyle = 'rgba(34, 197, 94, 0.08)'; ctx.fillRect(left, y.getPixelForValue(100), right - left, y.getPixelForValue(85) - y.getPixelForValue(100));
                        ctx.fillStyle = 'rgba(234, 179, 8, 0.08)'; ctx.fillRect(left, y.getPixelForValue(85), right - left, y.getPixelForValue(70) - y.getPixelForValue(85));
                        ctx.restore();
                    }
                }]
            });
        }
    });
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

// === ВЫГРУЗКА PDF (Аналитика и Рейтинг) ===
function exportPdfReport() {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return alert('Разрешите всплывающие окна в браузере.');

    const selContr = document.getElementById('analytics-contractor-select')?.value || 'ALL';
    const selTmpl = document.getElementById('analytics-template-select')?.value || 'ALL';
    
    let baseArray = contractorArray;
    if(selContr !== "ALL") baseArray = baseArray.filter(i => i.contractorName === selContr);
    if(selTmpl !== "ALL") baseArray = baseArray.filter(i => i.templateKey === selTmpl);
    
    if (baseArray.length === 0) { printWindow.close(); return alert('Нет данных для экспорта.'); }

    let pName = baseArray[0].projectName || "Не указан";
    let iName = baseArray[0].inspectorName || "Не указан";
    let reportBlocksHTML = "";

    // Сводный дашборд PDF
    let sumUrk = 0; let sumB3 = 0;
    baseArray.forEach(item => { sumUrk += item.metrics.final; sumB3 += item.metrics.n_B3_fail; });
    const avgUrk = Math.round(sumUrk / baseArray.length);

    const canvasSumC = document.getElementById('chart_summary_c');
    const canvasSumT = document.getElementById('chart_summary_t');
    let imgSumC = canvasSumC ? `<img src="${canvasSumC.toDataURL('image/png')}" class="chart-img" style="max-height: 200px;" />` : '';
    let imgSumT = canvasSumT ? `<img src="${canvasSumT.toDataURL('image/png')}" class="chart-img" style="max-height: 200px;" />` : '';

    reportBlocksHTML += `
    <div class="avoid-break" style="margin-bottom: 40px; background: #f8fafc; padding: 20px; border-radius: 12px; border: 1px solid #cbd5e1;">
        <h2 style="text-align: center; margin-top: 0;">СВОДНЫЙ ДАШБОРД ОБЪЕКТА</h2>
        <table class="metrics-table" style="margin-top: 15px;"><tr>
            <td><div class="metric-title">Средний УрК</div><div class="metric-val text-xl" style="color: ${avgUrk < 70 ? '#dc2626' : (avgUrk < 85 ? '#d97706' : '#16a34a')}">${avgUrk}%</div></td>
            <td><div class="metric-title">Всего проверок</div><div class="metric-val text-xl">${baseArray.length}</div></td>
            <td><div class="metric-title">Критические ошибки (B3)</div><div class="metric-val text-xl" style="color: ${sumB3 > 0 ? '#dc2626' : '#1e293b'}">${sumB3}</div></td>
        </tr></table>
        <div class="split-view" style="margin-top: 20px;">
            <div class="split-col" style="text-align:center;"><h3>Качество Подрядчиков</h3>${imgSumC}</div>
            <div class="split-col" style="text-align:center;"><h3>Качество по Видам работ</h3>${imgSumT}</div>
        </div>
    </div>`;

    // Детализация по подрядчикам
    const uniqueContractors = [...new Set(baseArray.map(i => i.contractorName))];
    let globalBlockIndex = 0;

    uniqueContractors.forEach((cName, cIndex) => {
        const cDataAllTmpls = baseArray.filter(i => i.contractorName === cName);
        const uniqueTemplates = [...new Set(cDataAllTmpls.map(i => i.templateKey))];
        
        reportBlocksHTML += `<div class="${cIndex > 0 ? 'contractor-group' : ''} avoid-break" style="margin-bottom: 40px;"><h2>ПОДРЯДЧИК: ${cName}</h2>`;

        uniqueTemplates.forEach((tKey) => {
            const cData = cDataAllTmpls.filter(i => i.templateKey === tKey);
            const tmplTitle = cData[0].templateTitle;
            const cCount = cData.length;
            const safeNameId = cName.replace(/\W/g, '_') + '_' + globalBlockIndex++;
            const uiChartCanvas = document.getElementById(`chart_ui_${safeNameId}`);
            let chartImgHtml = uiChartCanvas ? `<img src="${uiChartCanvas.toDataURL('image/png')}" class="chart-img" />` : `<p style="color:#64748b; font-size:12px;">График недоступен</p>`;

            reportBlocksHTML += `<div style="margin-top:20px; border-top:2px dashed #cbd5e1; padding-top:15px;"><h3>Вид работ: ${tmplTitle}</h3></div>`;

            if (cCount >= 7) {
                const c = getContractorMetrics(cData, userTemplates);
                const expertData = getExpertConclusion(c, cName, tmplTitle, cCount, safeNameId, customExpertConclusions);
                reportBlocksHTML += `
                    ${expertData.pdfHtml}
                    <table class="metrics-table" style="margin-top: 15px;"><tr>
                        <td><div class="metric-title">УрК Подрядчика</div><div class="metric-val text-xl">${c.finalC}%</div></td>
                        <td><div class="metric-title">Статус риска</div><div class="metric-val" style="color: ${c.riskStatus === 'Высокий риск' ? '#dc2626' : (c.riskStatus === 'Средний риск' ? '#d97706' : '#16a34a')}">${c.riskStatus}</div></td>
                        <td><div class="metric-title">Достоверность</div><div class="metric-val text-sm">${c.confStatus} (${c.count} изд.)</div></td>
                    </tr></table>
                `;
            } else {
                reportBlocksHTML += `<div class="warning-box">Собрано ${cCount} изделий. Для расчета УрК требуется минимум 7.</div>`;
            }

            reportBlocksHTML += `<div class="avoid-break mt-20"><h3>Динамика качества</h3><div class="chart-wrapper">${chartImgHtml}</div></div>`;
        });
        reportBlocksHTML += `</div>`;
    });

    const reportTitle = selContr === "ALL" ? "СВОДНЫЙ ОТЧЕТ АУДИТА" : `ОТЧЕТ АУДИТА: ${selContr}`;
    const finalHtml = generatePdfHtmlShell(reportTitle, pName, iName, "По фильтрам", reportBlocksHTML);
    printWindow.document.open(); printWindow.document.write(finalHtml); printWindow.document.close();
}

function exportRatingPdf() {
    const listDiv = document.getElementById('rating-list'); 
    if(!listDiv || listDiv.innerHTML === '') return alert('Нет данных для экспорта рейтинга.');
    
    const printWindow = window.open('', '_blank'); 
    if (!printWindow) return alert('Разрешите всплывающие окна в браузере.');
    
    const selTmpl = document.getElementById('rating-template-select')?.options[document.getElementById('rating-template-select').selectedIndex].text || 'Все';
    let pName = contractorArray.length > 0 ? contractorArray[0].projectName || "Не указан" : "Не указан";
    let iName = contractorArray.length > 0 ? contractorArray[0].inspectorName || "Не указан" : "Не указан";
    
    const tableRowsHtml = Array.from(listDiv.children).map((card, index) => {
        const name = card.querySelector('.truncate').innerText; 
        const urk = card.querySelector('.text-3xl').innerText;
        const riskEl = card.querySelector('span[class*="risk-"]'); const risk = riskEl ? riskEl.innerText : '—';
        const riskColor = riskEl ? (riskEl.classList.contains('risk-high') ? '#dc2626' : (riskEl.classList.contains('risk-low') ? '#16a34a' : '#d97706')) : '#000';
        return `<tr class="avoid-break"><td class="text-center bold lg">${index+1}</td><td><b>${name}</b></td><td class="text-center black xl">${urk}</td><td class="text-center bold" style="color: ${riskColor};">${risk}</td></tr>`;
    }).join('');

    const reportBlocksHTML = `<table class="rating-table"><thead><tr class="avoid-break"><th style="width: 10%;">Место</th><th style="width: 50%; text-align: left;">Подрядчик</th><th style="width: 15%;">УрК</th><th style="width: 25%;">Статус Риска</th></tr></thead><tbody>${tableRowsHtml}</tbody></table>`;
    
    const finalHtml = generatePdfHtmlShell("РЕЙТИНГ ПОДРЯДЧИКОВ", pName, iName, selTmpl, reportBlocksHTML);
    printWindow.document.open(); printWindow.document.write(finalHtml); printWindow.document.close();
}

// Оболочка для PDF
function generatePdfHtmlShell(title, pName, iName, tName, content) {
    return `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>${title}</title>
    <style>
        @page { size: auto; margin: 12mm 10mm; }
        body { font-family: 'Inter', sans-serif; color: #0f172a; margin: 0; padding: 20px; background: white; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        .container { max-width: 1000px; margin: 0 auto; width: 100%; }
        .print-controls { position: fixed; bottom: 30px; right: 20px; display: flex; flex-direction: column; gap: 12px; z-index: 1000; }
        .btn { width: 50px; height: 50px; border-radius: 25px; display: flex; justify-content: center; align-items: center; cursor: pointer; border: none; box-shadow: 0 10px 15px rgba(0,0,0,0.2); }
        .btn-close { background: #475569; color: white; } .btn-print { background: #4f46e5; color: white; }
        @media print { .print-controls { display: none !important; } .container { max-width: 100% !important; } .avoid-break { page-break-inside: avoid !important; } .contractor-group { page-break-before: always; } }
        h1 { font-size: 22px; font-weight: 900; text-align: center; text-transform: uppercase; }
        h2 { font-size: 18px; background: #1e293b; color: white; padding: 10px 15px; border-radius: 6px; }
        h3 { font-size: 14px; border-bottom: 2px solid #e2e8f0; padding-bottom: 5px; }
        .header-info { width: 100%; background: #f8fafc; border: 1px solid #cbd5e1; border-collapse: collapse; font-size: 14px; margin-bottom: 20px; }
        .header-info td { padding: 15px; vertical-align: top; border: 1px solid #cbd5e1; }
        .metrics-table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-bottom: 15px; }
        .metrics-table td { background: #f1f5f9; padding: 12px; border: 1px solid #cbd5e1; text-align: center; }
        .metric-title { font-size: 10px; font-weight: bold; color: #64748b; text-transform: uppercase; }
        .metric-val { font-weight: 900; color: #1e293b; margin-top: 4px; }
        .text-xl { font-size: 20px; }
        .warning-box { background: #fef9c3; border: 1px solid #fef08a; padding: 10px; font-size: 11px; font-weight: bold; color: #854d0e; border-left: 5px solid #f59e0b; }
        .chart-wrapper { width: 100%; border: 1px solid #cbd5e1; padding: 10px; text-align: center; }
        .chart-img { max-width: 100%; max-height: 250px; object-fit: contain; }
        .split-view { display: table; width: 100%; table-layout: fixed; }
        .split-col { display: table-cell; width: 50%; vertical-align: top; border: 1px solid #cbd5e1; padding: 15px; }
        .rating-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .rating-table th { background: #1e293b; color: white; padding: 12px; border: 1px solid #cbd5e1; }
        .rating-table td { padding: 12px; border: 1px solid #cbd5e1; }
        .text-center { text-align: center; } .bold { font-weight: bold; } .black { font-weight: 900; } .lg { font-size: 14px; } .xl { font-size: 18px; }
    </style></head><body>
    <div class="print-controls">
        <button class="btn btn-print" onclick="window.print()"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg></button>
        <button class="btn btn-close" onclick="window.close()"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"></path></svg></button>
    </div>
    <div class="container">
        <div class="avoid-break" style="border-bottom: 3px solid #1e293b; padding-bottom: 20px; margin-bottom: 30px;">
            <h1>${title}</h1>
            <table class="header-info"><tr>
                <td><p><b>Объект:</b> ${pName}</p><p><b>Проверяющий:</b> ${iName}</p></td>
                <td style="text-align:right;"><p><b>Выборка:</b> ${tName}</p><p style="color:#64748b;">Дата: ${new Date().toLocaleString('ru-RU')}</p></td>
            </tr></table>
        </div>
        ${content}
    </div></body></html>`;
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