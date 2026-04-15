/* Файл: js/math.js */

// Вспомогательная функция для плоского массива
function getFlatList(checklist) { 
    if (!checklist) return [];
    return checklist.flatMap(g => g.items); 
}

// === БЛОК 1: ТЕКУЩИЙ УРК ОСМОТРА ===
function getProductMetrics(productState, customChecklist) {
    let W_tot = 0; 
    let W_ok = 0;  
    let checkedCount = 0;
    
    let n_B1_fail = 0;
    let n_B2_chk = 0, n_B2_fail = 0;
    let n_B3_fail = 0, b3_found = false;
    let escalated_found = false;

    const flatList = getFlatList(customChecklist);

    flatList.forEach(i => {
        const s = productState[i.id];
        if (s) {
            checkedCount++;
            let currentWeight = i.w;
            let isB3 = (i.w === 3), isB2 = (i.w === 2), isB1 = (i.w === 1);
            
            // fail_escalated всегда считается как B3
            if (s === 'fail_escalated') { currentWeight = 3; isB3 = true; isB2 = false; escalated_found = true; }
            
            W_tot += currentWeight;
            if (isB2) n_B2_chk++;
            
            if (s === 'ok') { 
                W_ok += currentWeight; 
            } else if (s === 'fail' || s === 'fail_escalated') {
                if (isB1) n_B1_fail++;
                if (isB2) n_B2_fail++;
                if (isB3) { n_B3_fail++; b3_found = true; }
            }
        }
    });

    if (checkedCount === 0) return null;

    let baseUrk = (W_ok / W_tot) * 100;
    let Urk_base = Math.round(baseUrk);

    let Kc = 1.0;
    if (n_B2_chk > 0) {
        let R_B2 = n_B2_fail / n_B2_chk;
        if (R_B2 > 0 && R_B2 < 0.20) Kc = 0.95;
        else if (R_B2 >= 0.20 && R_B2 < 0.50) Kc = 0.85;
        else if (R_B2 >= 0.50) Kc = 0.70;
    }

    let Kcrit = b3_found ? 0.50 : 1.00;
    let Urk_inspect = Math.round(baseUrk * Kc * Kcrit);

    if (n_B2_fail > 0 || b3_found || Kc < 1.0 || Kcrit < 1.0) { 
        Urk_inspect = Math.min(Urk_inspect, 84); 
    }

    let statusTxt = "", statusCls = "", isDanger = false, reason = "Соответствует нормативам";
    let warnings = [];

    if (b3_found || Urk_inspect < 70) { 
        statusTxt = "БРАК / СТОП"; statusCls = "tag-red"; isDanger = true; 
        if (escalated_found) reason = "Обнаружено превышение >1.5 (Авто B3)";
        else if (b3_found) reason = "Обнаружен критический дефект (B3)";
        else reason = "Низкий УрК (<70%) из-за концентрации дефектов";
        warnings.push("❌ Обнаружен критический дефект. Требуется немедленное исправление.");
    } else if (Urk_inspect >= 85) { 
        statusTxt = "ПРИНЯТО"; statusCls = "tag-green"; 
    } else { 
        statusTxt = "ИСПРАВИТЬ"; statusCls = "tag-yellow"; 
        reason = `Условный допуск (Потолок 84%). Наличие значимых дефектов B2.`;
        warnings.push("⚠ Обнаружены значимые дефекты. Итог снижен.");
    }

    return { 
        final: Urk_inspect, baseUrkPerc: Urk_base, checkedCount, totalCount: flatList.length, 
        n_B1_fail, n_B2_fail, n_B3_fail, b3_found, kc: Kc, kcrit: Kcrit, 
        statusTxt, statusCls, isDanger, reason, warnings, escalated_found 
    };
}

// Волатильность
function calcVolatility(arr) {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a,b) => a+b, 0) / arr.length;
    const variance = arr.reduce((a,b) => a + Math.pow(b - mean, 2), 0) / (arr.length - 1);
    return Math.sqrt(variance);
}

// === БЛОК 2 и 3: ИНТЕГРАЛЬНЫЙ УРК ПОДРЯДЧИКА И ДОСТОВЕРНОСТЬ ===
function getContractorMetrics(customArray, userTemplatesData = {}) {
    const N = customArray.length;
    if (N === 0) return null;

    let urkValues = [];
    let N_B3 = 0; 
    let itemStats = {}; 

    customArray.forEach(inspection => {
        if (inspection.metrics) {
            urkValues.push(inspection.metrics.final);
            if (inspection.metrics.b3_found) N_B3++;
        }
        if (inspection.state) {
            Object.keys(inspection.state).forEach(itemId => {
                const s = inspection.state[itemId];
                if (!itemStats[itemId]) itemStats[itemId] = { chk: 0, fail: 0 };
                itemStats[itemId].chk++;
                if (s === 'fail' || s === 'fail_escalated') itemStats[itemId].fail++;
            });
        }
    });

    let sumUrk = urkValues.reduce((a, b) => a + b, 0);
    let Urk_contr_base = Math.round(sumUrk / N);

    const tKey = customArray[0].templateKey;
    const type = tKey.split('_')[0];
    const key = tKey.replace(type + '_', '');
    const specificChecklist = type === 'sys' && SYSTEM_TEMPLATES[key] ? SYSTEM_TEMPLATES[key].groups : (userTemplatesData[key] ? userTemplatesData[key].groups : []);
    const flatList = getFlatList(specificChecklist);

    let max_R_i = 0;
    flatList.forEach(i => {
        if (i.w >= 2 && itemStats[i.id] && itemStats[i.id].chk > 0) { 
            let R_i = (itemStats[i.id].fail / itemStats[i.id].chk) * 100;
            if (R_i > max_R_i) max_R_i = R_i;
        }
    });

    let R_sys = max_R_i;
    let Ks = 1.0;
    if (R_sys >= 60.0) Ks = 0.50;
    else if (R_sys >= 40.0) Ks = 0.70;
    else if (R_sys >= 20.0) Ks = 0.85;
    else if (R_sys >= 10.0) Ks = 0.95;

    let R_B3 = (N_B3 / N) * 100;
    let KB3 = 1.0;
    if (R_B3 >= 30.0) KB3 = 0.50;
    else if (R_B3 >= 20.0) KB3 = 0.70;
    else if (R_B3 >= 10.0) KB3 = 0.85;
    else if (R_B3 >= 5.0) KB3 = 0.90;
    else if (R_B3 > 0) KB3 = 0.95;

    let Urk_contr = Math.round(Urk_contr_base * Ks * KB3);
    let capApplied = false;
    
    if (Ks < 1.00 || KB3 < 1.00) {
        if (Urk_contr > 84) { Urk_contr = 84; capApplied = true; }
    }

    let s = 0; let E = 0; 
    if (N >= 2) {
        let mean = sumUrk / N;
        let variance = urkValues.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / (N - 1);
        s = Math.sqrt(variance);
        E = 1.96 * (s / Math.sqrt(N));
    }

    let confidenceLevel = 'Низкая достоверность';
    let confCls = 'conf-low';
    if (N >= 15 && E <= 5) { confidenceLevel = 'Высокая достоверность'; confCls = 'conf-high'; } 
    else if ((N >= 7 && N < 15) || (E > 5 && E <= 10)) { confidenceLevel = 'Средняя достоверность'; confCls = 'conf-med'; }

    let stabilityIndex = Math.max(0, Math.min(100, 100 - 1.5 * s));
    stabilityIndex = Math.round(stabilityIndex);

    let statusTxt = "В РАБОТЕ", statusCls = "tag-blue", isRedZone = false;
    let riskStatus = "Низкий риск", riskCls = "risk-low";

    if (Urk_contr < 70 || R_B3 >= 20.0 || R_sys >= 40.0) { 
        statusTxt = "КРАСНАЯ ЗОНА"; statusCls = "tag-red"; isRedZone = true; riskStatus = "Высокий риск"; riskCls = "risk-high";
    } else if (Urk_contr >= 85 && R_B3 === 0 && R_sys < 10.0) { 
        statusTxt = "ОБРАЗЦОВОЕ КАЧЕСТВО"; statusCls = "tag-green"; 
    } else { 
        statusTxt = "ЖЕЛТАЯ ЗОНА"; statusCls = "tag-yellow"; 
        if (Urk_contr <= 84 || R_B3 >= 10.0 || stabilityIndex <= 84) { riskStatus = "Средний риск"; riskCls = "risk-med"; }
    }

    let reason = "Стабильное качество, без существенных штрафов";
    if (capApplied) reason = "Применен потолок 84% (Наличие критических или системных дефектов)";
    else if (R_sys >= 20.0) reason = `Снижение из-за системного брака (повторяемость ${R_sys.toFixed(1)}%)`;
    else if (R_B3 >= 10.0) reason = `Снижение из-за доли осмотров с B3 (${R_B3.toFixed(1)}%)`;

    return { 
        finalC: Urk_contr, baseUrkContrPerc: Urk_contr_base, count: N, maxFailRate: R_sys, 
        ks: Ks, kcritC: KB3, rateB3: R_B3, n_изделий_с_B3: N_B3, statusTxt, statusCls, isRedZone, 
        confStatus: confidenceLevel, confCls, stdDev: s, ci95_margin: E, volatility: s, stabilityIndex, riskStatus, riskCls, reason 
    };
}

// ГЕНЕРАТОР ЭКСПЕРТНОГО ЗАКЛЮЧЕНИЯ ИИ (Математика 4.0)
function getExpertConclusion(c, contractorName, templateTitle, count, safeId, customExpertConclusions = {}) {
    const expertKey = contractorName + "_||_" + templateTitle;
    const isRed = c.finalC < 70 || c.rateB3 >= 30 || c.isRedZone;
    const isYellow = c.finalC >= 70 && c.finalC < 85 && !isRed;
    
    const mainColor = isRed ? '#dc2626' : (isYellow ? '#d97706' : '#16a34a');
    const bgColor = isRed ? '#fef2f2' : (isYellow ? '#fffbeb' : '#f0fdf4');
    const borderColor = isRed ? '#fecaca' : (isYellow ? '#fde68a' : '#bbf7d0');
    
    const qualText = isRed ? 'НИЗКОЕ' : (isYellow ? 'ПРИЕМЛЕМОЕ' : 'ВЫСОКОЕ');
    const emoji = isRed ? '🔴' : (isYellow ? '🟡' : '🟢');

    let b3Text = c.n_изделий_с_B3 > 0 ? `🚨 КРИТИЧЕСКИЙ УРОВЕНЬ: в ${c.n_изделий_с_B3} из ${count} независимых проверок (${c.rateB3.toFixed(1)}%) обнаружены дефекты категории B3. Это недопустимо для приемки объекта.` : '';

    let probsText = [];
    if (c.maxFailRate >= 20) probsText.push(`• 🔄 СИСТЕМНЫЙ БРАК: дефект повторяется в ${c.maxFailRate.toFixed(1)}% проверок. Коэффициент системности Ks = ${c.ks.toFixed(2)}`);
    if (c.volatility >= 10) probsText.push(`• 📉 НЕСТАБИЛЬНОСТЬ: высокая волатильность результатов (${c.volatility.toFixed(1)} пункта). Качество скачет от проверки к проверке.`);
    if (probsText.length === 0) probsText.push(`• ✅ Значимых системных отклонений и скачков качества не выявлено.`);

    let recomsText = [];
    if (isRed || c.n_изделий_с_B3 > 0) {
        recomsText.push("• НЕМЕДЛЕННО: Остановить работы. Провести комиссионное обследование участков с B3.");
        recomsText.push("• Заблокировать подписание КС-2 до устранения коренных причин.");
    } else if (isYellow) {
        recomsText.push("• Усилить операционный контроль на местах.");
        recomsText.push("• Обязать подрядчика провести 100% внутреннюю ревизию перед финишной сдачей.");
    } else {
        recomsText.push("• Продолжить работы в текущем режиме.");
        recomsText.push("• Применять текущую практику подрядчика как эталонную.");
    }

    let verdictText = isRed ? "🔴 РЕКОМЕНДАЦИЯ: Работы ОСТАНОВЛЕНЫ. Процесс вне контроля.\n\nСТОП-РАБОТЫ до устранения критических нарушений!" :
                      (isYellow ? "🟡 РЕКОМЕНДАЦИЯ: Условный допуск. Приемка только после устранения системных B2." :
                                  "🟢 РЕКОМЕНДАЦИЯ: Работы выполняются в зеленой зоне. Принимаются без ограничений.");

    let plainText = `🧠 ЭКСПЕРТНОЕ ЗАКЛЮЧЕНИЕ\n\n${emoji} Качество работ подрядчика "${contractorName}" по виду "${templateTitle}" оценивается как ${qualText} (${c.finalC}% ±${c.ci95_margin.toFixed(1)}%).\n\n` +
    (b3Text ? `[КРИТИЧЕСКИЙ УРОВЕНЬ]\n${b3Text}\n\n` : '') +
    `[Выявленные проблемы]\n${probsText.join('\n')}\n\n[Рекомендации]\n${recomsText.join('\n')}\n\n[Вердикт]\n${verdictText}\n\nСгенерировано на основе ${count} независимых проверок`;

    let isCustom = false;
    if (customExpertConclusions[expertKey]) {
        plainText = customExpertConclusions[expertKey];
        isCustom = true;
    }

    let contentUiHtml = '';
    let pdfHtml = '';

    if (isCustom) {
        let safeText = plainText.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        let uiText = safeText.replace(/^\[(.*?)\]/gm, '<div class="text-[11px] font-black text-primary uppercase mt-4 mb-1">$1</div>');
        let pdfFormattedText = safeText.replace(/^\[(.*?)\]/gm, '<div style="font-size: 11px; font-weight: bold; color: #854d0e; text-transform: uppercase; margin-top: 10px; margin-bottom: 4px;">$1</div>');
        
        contentUiHtml = `
            <div class="p-3 min-[400px]:p-4 bg-yellow-50 dark:bg-yellow-900/30">
                <div class="text-[9px] font-bold text-yellow-700 dark:text-yellow-400 uppercase mb-2 flex items-center gap-1 bg-yellow-100 dark:bg-yellow-800/50 w-fit px-2 py-1 rounded"><span>⚠️</span> Текст скорректирован инженером</div>
                <div class="text-[11px] whitespace-pre-wrap leading-relaxed">${uiText}</div>
            </div>`;
        
        pdfHtml = `
            <div style="margin-top: 20px; margin-bottom: 25px; border: 1px solid #fde047; border-radius: 8px; background: #fefce8; padding: 15px; page-break-inside: avoid;">
                <h3 style="margin-top: 0; font-size: 14px; border-bottom: 2px solid #fef08a; padding-bottom: 8px; margin-bottom: 15px; color: #854d0e;">⚠️ ЭКСПЕРТНОЕ ЗАКЛЮЧЕНИЕ (С КОРРЕКТИРОВКАМИ ИНЖЕНЕРА)</h3>
                <div style="font-size: 12px; line-height: 1.5; color: #1e293b; white-space: pre-wrap;">${pdfFormattedText}</div>
            </div>`;
    } else {
        contentUiHtml = `
            <div class="p-3 min-[400px]:p-4">
                <div class="text-[12px] font-bold mb-4 leading-relaxed" style="color: ${mainColor};">${emoji} Качество работ подрядчика "${contractorName}" по виду "${templateTitle}" оценивается как ${qualText} (${c.finalC}%). Погрешность: ±${c.ci95_margin.toFixed(1)}%.</div>
                ${b3Text ? `<div class="border border-red-200 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg mb-3 text-red-800 dark:text-red-400 text-[11px] font-bold leading-snug shadow-sm">${b3Text}</div>` : ''}
                <div class="border border-[var(--card-border)] bg-[var(--hover-bg)] p-3 rounded-lg mb-3 shadow-sm">
                    <div class="text-[10px] font-black text-slate-500 uppercase mb-2">🔍 Выявленные проблемы</div>
                    <div class="text-[11px] leading-snug space-y-1">${probsText.map(p => `<div>${p}</div>`).join('')}</div>
                </div>
                <div class="border border-sky-200 bg-sky-50 dark:bg-sky-900/20 dark:border-sky-800 p-3 rounded-lg mb-3 shadow-sm">
                    <div class="text-[10px] font-black text-sky-600 dark:text-sky-400 uppercase mb-2">🔧 Рекомендации</div>
                    <div class="text-[11px] text-sky-800 dark:text-sky-300 leading-snug space-y-1">${recomsText.map(r => `<div>${r}</div>`).join('')}</div>
                </div>
                <div class="p-3 rounded-lg mb-2 shadow-sm" style="background: ${bgColor}; border: 1px solid ${borderColor};">
                    <div class="text-[10px] font-black uppercase mb-2" style="color: ${mainColor};">🎯 Вердикт</div>
                    <div class="text-[11px] font-bold leading-snug">${verdictText.replace(/\n/g, '<br>')}</div>
                </div>
                <div class="text-right text-[9px] text-slate-400 font-bold uppercase mt-3">База расчета: ${count} независимых проверок</div>
            </div>`;
        
        pdfHtml = `
            <div style="margin-top: 20px; margin-bottom: 25px; border: 1px solid #cbd5e1; border-radius: 8px; background: #f8fafc; padding: 15px; page-break-inside: avoid;">
                <h3 style="margin-top: 0; font-size: 14px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 15px;">🧠 ЭКСПЕРТНОЕ ЗАКЛЮЧЕНИЕ ИИ</h3>
                <div style="font-size: 13px; font-weight: bold; margin-bottom: 15px; line-height: 1.4; color: ${mainColor};">${emoji} Качество работ подрядчика "${contractorName}" оценивается как ${qualText} (${c.finalC}%). Доверительный интервал: ±${c.ci95_margin.toFixed(1)}%.</div>
                ${b3Text ? `<div style="border: 1px solid #fecaca; background: #fef2f2; color: #991b1b; padding: 10px; border-radius: 6px; font-size: 12px; font-weight: bold; margin-bottom: 10px;">${b3Text}</div>` : ''}
                <div style="border: 1px solid #e2e8f0; background: white; padding: 10px; border-radius: 6px; margin-bottom: 10px;">
                    <div style="font-size: 11px; font-weight: bold; color: #64748b; text-transform: uppercase; margin-bottom: 5px;">🔍 Выявленные проблемы</div>
                    <div style="font-size: 12px; line-height: 1.4; color: #334155;">${probsText.map(p => `<div>${p}</div>`).join('')}</div>
                </div>
                <div style="border: 1px solid #bae6fd; background: #f0f9ff; padding: 10px; border-radius: 6px; margin-bottom: 10px;">
                    <div style="font-size: 11px; font-weight: bold; color: #0284c7; text-transform: uppercase; margin-bottom: 5px;">🔧 Рекомендации</div>
                    <div style="font-size: 12px; line-height: 1.4; color: #075985;">${recomsText.map(r => `<div>${r}</div>`).join('')}</div>
                </div>
                <div style="border: 1px solid ${borderColor}; background: ${bgColor}; padding: 10px; border-radius: 6px;">
                    <div style="font-size: 11px; font-weight: bold; color: ${mainColor}; text-transform: uppercase; margin-bottom: 5px;">🎯 Вердикт</div>
                    <div style="font-size: 12px; font-weight: bold; line-height: 1.4; color: #1e293b;">${verdictText.replace(/\n/g, '<br>')}</div>
                </div>
            </div>`;
    }

    const uiHtml = `
        <div class="mt-6 border border-[var(--card-border)] bg-[var(--card-bg)] rounded-xl shadow-sm overflow-hidden mb-6">
            <div class="bg-[var(--hover-bg)] border-b border-[var(--card-border)] p-2 flex justify-between items-center gap-2">
                <div class="font-black text-[10px] min-[400px]:text-[11px] uppercase tracking-widest flex items-center gap-1 min-w-0 truncate ml-1">🧠 Смарт-Анализ</div>
                <div class="flex gap-1 shrink-0">
                    <button onclick="editExpertText('${expertKey}', 'text_expert_${safeId}')" class="text-[10px] font-bold bg-[var(--card-bg)] border border-[var(--card-border)] px-2 py-1.5 rounded shadow-sm active:scale-95 transition-all flex items-center justify-center gap-1">
                        ✏️<span class="hidden min-[400px]:inline"> Редак.</span>
                    </button>
                    <button id="btn_copy_${safeId}" onclick="copyExpertText('btn_copy_${safeId}', 'text_expert_${safeId}')" class="text-[10px] font-bold bg-indigo-50 border border-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-400 px-2 py-1.5 rounded shadow-sm active:scale-95 transition-all flex items-center justify-center gap-1">
                        📋<span class="hidden min-[400px]:inline"> Копия</span>
                    </button>
                </div>
                <textarea id="text_expert_${safeId}" class="hidden">${plainText}</textarea>
            </div>
            ${contentUiHtml}
        </div>
    `;

    return { uiHtml, pdfHtml };
}

// === АГРЕГАЦИЯ И ЭТАПЫ (Из старого кода) ===
function getProductAggregated(location, contractorName, templateKey, historyArray, fullChecklist) {
    const productStages = historyArray.filter(i => 
        i.location === location && 
        i.contractorName === contractorName && 
        i.templateKey === templateKey
    );
    if (productStages.length === 0) return null;
    let mergedState = {};
    productStages.forEach(stage => { mergedState = { ...mergedState, ...stage.state }; });
    return getProductMetrics(mergedState, fullChecklist);
}

function getStageMetrics(stageId, historyArray) {
    const stageRecords = historyArray.filter(i => i.stageId === stageId);
    if (stageRecords.length === 0) return null;

    let totalUrk = 0; let sumB3 = 0; let totalChecks = stageRecords.length;
    stageRecords.forEach(record => {
        if (record.metrics) { totalUrk += record.metrics.final; sumB3 += record.metrics.n_B3_fail; }
    });

    const urkValues = stageRecords.map(r => r.metrics ? r.metrics.final : 0);
    const volatility = calcVolatility(urkValues);

    let stageConfidence = 'Низкая достоверность';
    if (totalChecks >= 10) stageConfidence = 'Высокая достоверность';
    else if (totalChecks >= 3) stageConfidence = 'Средняя достоверность';

    if (volatility > 15 && stageConfidence === 'Высокая достоверность') stageConfidence = 'Средняя достоверность';
    else if (volatility > 15 && stageConfidence === 'Средняя достоверность') stageConfidence = 'Низкая достоверность';
    else if (volatility < 5 && stageConfidence === 'Средняя достоверность') stageConfidence = 'Высокая достоверность';

    return { avgFinal: Math.round(totalUrk / totalChecks), count: totalChecks, totalB3: sumB3, volatility: volatility, confidence: stageConfidence };
}