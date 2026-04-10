/* Файл: js/math.js */

// Вспомогательная функция для плоского массива
function getFlatList(checklist) { 
    if (!checklist) return [];
    return checklist.flatMap(g => g.items); 
}

// РАСЧЕТ УРК ИЗДЕЛИЯ (СТРОГО БЕЗ ИЗМЕНЕНИЙ ИЗ v15)
function getProductMetrics(productState, customChecklist) {
    let totalCheckedW = 0, earnedW = 0, checkedCount = 0;
    let n_B1_fail = 0, n_B2_checked = 0, n_B2_fail = 0, n_B3_fail = 0, b3_found = false;
    let escalated_found = false;

    const flatList = getFlatList(customChecklist);

    flatList.forEach(i => {
        const s = productState[i.id];
        if (s) {
            checkedCount++;
            let currentWeight = i.w;
            let isB3 = (i.w === 3), isB2 = (i.w === 2), isB1 = (i.w === 1);
            
            if (s === 'fail_escalated') { currentWeight = 3; isB3 = true; isB2 = false; escalated_found = true; }
            
            totalCheckedW += currentWeight;
            if (isB2) n_B2_checked++;
            
            if (s === 'ok') { earnedW += currentWeight; } 
            else if (s === 'fail' || s === 'fail_escalated') {
                if (isB1) n_B1_fail++;
                if (isB2) n_B2_fail++;
                if (isB3) { n_B3_fail++; b3_found = true; }
            }
        }
    });

    if (checkedCount === 0) return null;

    let baseUrk = totalCheckedW > 0 ? (earnedW / totalCheckedW) : 0;
    let kc = 1.0;
    if (n_B2_checked >= 3 && n_B2_checked <= 5) {
        if (n_B2_fail === 2) kc = 0.85;
        else if (n_B2_fail >= 3) kc = 0.70;
    } else if (n_B2_checked >= 6) {
        let rateB2 = (n_B2_fail / n_B2_checked) * 100;
        if (rateB2 >= 50.0) kc = 0.50;
        else if (rateB2 >= 20.0) kc = 0.70;
        else if (rateB2 >= 0.1) kc = 0.95;
    }

    let kcrit = b3_found ? 0.50 : 1.0;
    let rawPercent = Math.round((baseUrk * kc * kcrit) * 100);
    let final = totalCheckedW > 0 ? rawPercent : 0;

    if (n_B2_fail > 0 || kc < 1.0 || kcrit < 1.0) { if (final > 84) final = 84; }

    let statusTxt = "", statusCls = "", isDanger = false, reason = "Соответствует нормативам";
    let warnings = [];

    if (b3_found || final < 70) { 
        statusTxt = "БРАК / СТОП"; statusCls = "tag-red"; isDanger = true; 
        if (escalated_found) reason = "Обнаружено превышение >1.5 (Авто B3)";
        else if (b3_found) reason = "Обнаружен критический дефект (B3)";
        else reason = "Низкий УрК (менее 70%) из-за скопления дефектов";
        warnings.push("❌ Обнаружен критический дефект. Требуется немедленное исправление.");
    } else if (final >= 85) { 
        statusTxt = "ПРИНЯТО"; statusCls = "tag-green"; 
    } else { 
        statusTxt = "ИСПРАВИТЬ"; statusCls = "tag-yellow"; 
        if (kc < 1.0) reason = `Снижение (Kc=${kc}) из-за скопления дефектов B2`;
        else reason = `Снижение (Потолок 84%) из-за наличия ${n_B2_fail} дефектов B2`;
        warnings.push("⚠ Обнаружены значимые дефекты. Итог снижен.");
    }

    return { final, baseUrkPerc: Math.round(baseUrk * 100), checkedCount, totalCount: flatList.length, n_B1_fail, n_B2_fail, n_B3_fail, b3_found, kc, kcrit, statusTxt, statusCls, isDanger, reason, warnings, escalated_found };
}

// Волатильность
function calcVolatility(arr) {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a,b) => a+b, 0) / arr.length;
    const variance = arr.reduce((a,b) => a + Math.pow(b - mean, 2), 0) / (arr.length - 1);
    return Math.sqrt(variance);
}

// РАСЧЕТ УРК ПОДРЯДЧИКА (СТРОГО БЕЗ ИЗМЕНЕНИЙ ИЗ v15)
function getContractorMetrics(customArray, userTemplatesData = {}) {
    const count = customArray.length;
    if (count < 7) return null;

    const tKey = customArray[0].templateKey;
    const type = tKey.split('_')[0];
    const key = tKey.replace(type + '_', '');
    const specificChecklist = type === 'sys' && SYSTEM_TEMPLATES[key] ? SYSTEM_TEMPLATES[key].groups : (userTemplatesData[key] ? userTemplatesData[key].groups : []);
    
    const flatList = getFlatList(specificChecklist);

    let sumOkWeights = 0, sumTotalWeights = 0, n_изделий_с_B3 = 0;
    let failCounts = {}; let urkList = []; 
    flatList.forEach(i => failCounts[i.id] = 0);

    customArray.forEach(unit => {
        urkList.push(unit.metrics.final);
        let hasB3_in_this_unit = false;
        flatList.forEach(i => {
            const s = unit.state[i.id];
            if (s) {
                let w = i.w;
                if (s === 'fail_escalated') w = 3;
                sumTotalWeights += w;
                if (s === 'ok') sumOkWeights += w;
                else if (s === 'fail' || s === 'fail_escalated') {
                    failCounts[i.id]++;
                    if (w === 3) hasB3_in_this_unit = true;
                }
            }
        });
        if (hasB3_in_this_unit) n_изделий_с_B3++;
    });

    let baseUrkContr = sumTotalWeights > 0 ? (sumOkWeights / sumTotalWeights) : 0;
    let maxFailRate = 0;
    flatList.forEach(i => { if (i.w >= 2) { let rate = (failCounts[i.id] / count) * 100; if (rate > maxFailRate) maxFailRate = rate; }});

    let rSys = maxFailRate, ks = 1.0;
    if (rSys >= 50.0) ks = 0.75;
    else if (rSys >= 35.0) ks = 0.85;
    else if (rSys >= 20.0) ks = 0.92;
    else if (rSys >= 10.0) ks = 0.97;

    let rateB3 = (n_изделий_с_B3 / count) * 100, kcritC = 1.0;
    if (rateB3 >= 30.0) kcritC = 0.65;
    else if (rateB3 >= 20.0) kcritC = 0.80;
    else if (rateB3 >= 10.0) kcritC = 0.90;
    else if (rateB3 >= 5.0) kcritC = 0.95;
    else if (rateB3 > 0) kcritC = 0.98;

    let finalC = Math.round((baseUrkContr * ks * kcritC) * 100);
    let capApplied = false;
    
    if (rateB3 >= 10.0 || rSys >= 35.0) { if (finalC > 84) { finalC = 84; capApplied = true; } }

    let confStatus = "Низкая достоверность", confCls = "conf-low";
    if (count >= 30) { confStatus = "Высокая достоверность"; confCls = "conf-high"; }
    else if (count >= 15) { confStatus = "Средняя достоверность"; confCls = "conf-med"; }

    let volatility = calcVolatility(urkList);
    let stabilityIndex = Math.round(Math.max(0, Math.min(100, 100 - volatility - (rateB3 * 0.5))));

    let reason = "Стабильное качество, без штрафов";
    if (capApplied) reason = "Применен потолок 84% (Высокая доля B3 или системный брак)";
    else if (rSys >= 35.0) reason = `Снижение из-за системного брака (повторяемость ${rSys.toFixed(1)}%)`;
    else if (rateB3 >= 20.0) reason = `Снижение из-за высокой доли изделий с B3 (${rateB3.toFixed(1)}%)`;
    else if (stabilityIndex < 70) reason = "Снижение из-за нестабильности качества (Высокая волатильность)";

    let riskStatus = "Низкий риск", riskCls = "risk-low";
    if (finalC < 70 || rateB3 >= 20.0 || stabilityIndex < 70) { riskStatus = "Высокий риск"; riskCls = "risk-high"; }
    else if (finalC <= 84 || rateB3 >= 10.0 || stabilityIndex <= 84) { riskStatus = "Средний риск"; riskCls = "risk-med"; }

    let statusTxt = "В РАБОТЕ", statusCls = "tag-blue", isRedZone = false;
    if (ks <= 0.85 || rateB3 >= 30.0 || finalC < 70) { statusTxt = "КРАСНАЯ ЗОНА"; statusCls = "tag-red"; isRedZone = true; } 
    else if (finalC >= 85) { statusTxt = "ОБРАЗЦОВОЕ КАЧЕСТВО"; statusCls = "tag-green"; } 
    else { statusTxt = "ЖЕЛТАЯ ЗОНА"; statusCls = "tag-yellow"; }

    return { finalC, baseUrkContrPerc: Math.round(baseUrkContr * 100), count, maxFailRate: rSys, ks, kcritC, rateB3, n_изделий_с_B3, statusTxt, statusCls, isRedZone, confStatus, confCls, volatility, stabilityIndex, riskStatus, riskCls, reason };
}

// ГЕНЕРАТОР ЭКСПЕРТНОГО ЗАКЛЮЧЕНИЯ ИИ (Без изменений из v15)
function getExpertConclusion(c, contractorName, templateTitle, count, safeId, customExpertConclusions = {}) {
    const expertKey = contractorName + "_||_" + templateTitle;
    const isRed = c.finalC < 70 || c.rateB3 >= 30 || c.isRedZone;
    const isYellow = c.finalC >= 70 && c.finalC < 85 && !isRed;
    
    const mainColor = isRed ? '#dc2626' : (isYellow ? '#d97706' : '#16a34a');
    const bgColor = isRed ? '#fef2f2' : (isYellow ? '#fffbeb' : '#f0fdf4');
    const borderColor = isRed ? '#fecaca' : (isYellow ? '#fde68a' : '#bbf7d0');
    
    const qualText = isRed ? 'НИЗКОЕ' : (isYellow ? 'ПРИЕМЛЕМОЕ' : 'ВЫСОКОЕ');
    const emoji = isRed ? '🔴' : (isYellow ? '🟡' : '🟢');

    let b3Text = c.n_изделий_с_B3 > 0 ? `🚨 КРИТИЧЕСКИЙ УРОВЕНЬ: ${c.n_изделий_с_B3} из ${count} изделий (${c.rateB3.toFixed(1)}%) содержат дефекты категории B3. Это недопустимо для приемки объекта.` : '';

    let probsText = [];
    if (c.maxFailRate >= 20) probsText.push(`• 🔄 ВЫЯВЛЕН СИСТЕМНЫЙ БРАК: дефект повторяется в ${c.maxFailRate.toFixed(1)}% случаев. Коэффициент системности Ks = ${c.ks.toFixed(2)}`);
    if (c.volatility >= 10) probsText.push(`• 📉 НЕСТАБИЛЬНОСТЬ КАЧЕСТВА: волатильность ${c.volatility.toFixed(1)} пункта`);
    if (probsText.length === 0) probsText.push(`• ✅ Значимых системных отклонений и скачков качества не выявлено.`);

    let recomsText = [];
    if (isRed || c.n_изделий_с_B3 > 0) {
        recomsText.push("• НЕМЕДЛЕННО: Провести комиссионное обследование всех изделий с B3. Составить акт с фотофиксацией.");
        recomsText.push("• Провести внеплановый инструктаж по устранению системной ошибки.");
        recomsText.push("• Усилить входной контроль материалов.");
    } else if (isYellow) {
        recomsText.push("• Усилить операционный контроль.");
        recomsText.push("• Обратить внимание на повторяющиеся дефекты B2.");
    } else {
        recomsText.push("• Продолжить работы в текущем режиме.");
        recomsText.push("• Применять текущую практику подрядчика как эталонную.");
    }

    let verdictText = isRed ? "🔴 РЕКОМЕНДАЦИЯ: Работы ОСТАНОВЛЕНЫ. Требуется замена бригады/подрядчика.\n\nСТОП-РАБОТЫ до устранения критических нарушений!" :
                      (isYellow ? "🟡 РЕКОМЕНДАЦИЯ: Взять на особый контроль. Приемка только после устранения B2." :
                                  "🟢 РЕКОМЕНДАЦИЯ: Работы принимаются без ограничений.");

    let plainText = `🧠 ЭКСПЕРТНОЕ ЗАКЛЮЧЕНИЕ\n\n${emoji} Качество работ подрядчика "${contractorName}" по виду "${templateTitle}" оценивается как ${qualText} (${c.finalC}%).\n\n` +
    (b3Text ? `[КРИТИЧЕСКИЙ УРОВЕНЬ]\n${b3Text}\n\n` : '') +
    `[Выявленные проблемы]\n${probsText.join('\n')}\n\n[Рекомендации]\n${recomsText.join('\n')}\n\n[Вердикт]\n${verdictText}\n\nСгенерировано на основе ${count} проверок`;

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
                <div class="text-[12px] font-bold mb-4 leading-relaxed" style="color: ${mainColor};">${emoji} Качество работ подрядчика "${contractorName}" по виду "${templateTitle}" оценивается как ${qualText} (${c.finalC}%).</div>
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
                <div class="text-right text-[9px] text-slate-400 font-bold uppercase mt-3">Сгенерировано на основе ${count} проверок</div>
            </div>`;
        
        pdfHtml = `
            <div style="margin-top: 20px; margin-bottom: 25px; border: 1px solid #cbd5e1; border-radius: 8px; background: #f8fafc; padding: 15px; page-break-inside: avoid;">
                <h3 style="margin-top: 0; font-size: 14px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 15px;">🧠 ЭКСПЕРТНОЕ ЗАКЛЮЧЕНИЕ ИИ</h3>
                <div style="font-size: 13px; font-weight: bold; margin-bottom: 15px; line-height: 1.4; color: ${mainColor};">${emoji} Качество работ подрядчика "${contractorName}" оценивается как ${qualText} (${c.finalC}%).</div>
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
                <div class="font-black text-[10px] min-[400px]:text-[11px] uppercase tracking-widest flex items-center gap-1 min-w-0 truncate ml-1">🧠 Заключение</div>
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