let myArmy = [];
let weaponBuffer = [];
let currentGameSize = 2000;

// --- v4.7 評分標準門檻 (基於 10th Ed Meta) ---
// 根據社群統計：
// Offense: 具備殺傷力的 2000分表，回合輸出期望值約在 400-600 分。
// Defense: 考量 T10+ 載具與 2+ 護甲，有效血量池約在 500-800 分。
// Tactical: 佔領型軍隊總 OC 約 100+，加上士氣穩定度，門檻約 300-500。
const BASE_THRESHOLDS = {
    offense: { low: 300, high: 600 },
    defense: { low: 400, high: 800 },
    tactical: { low: 250, high: 500 }
};

// --- 權重計算公式 ---

function calcDefenseScore(u) {
    // 10版 T值通膨修正：T4 為基準 (1.0)，T12 為 3.0
    // 公式： (T / 4)^1.2 以獎勵高 T 單位
    const buffs = u.buffs || {};
    let tFactor = Math.pow(u.t / 4.0, 1.2);

    // 1處理盔保修正 (Save Modifier)
    // 假設 buffSv = 1，代表 3+ 變 2+ (即數值減 1)
    let svImprove = buffs.sv || 0;
    let effectiveSv = u.sv - svImprove;
    if (effectiveSv < 2) effectiveSv = 2; // 護甲上限通常是 2+

    // 10版 護甲修正：AP 減少，2+ 護甲價值極高
    // Sv 6+ = 0.5
    // Sv 3+ = 1.0 (基準)
    // Sv 2+ = 1.8 (終結者/坦克等級)
    let svFactor = 1.0;
    if (u.sv <= 2) svFactor = 1.8;
    else if (u.sv === 3) svFactor = 1.3;
    else if (u.sv === 4) svFactor = 1.0;
    else if (u.sv === 5) svFactor = 0.7;
    else svFactor = 0.5;

    // 特保修正 (4++ 非常強大)
    // 檢查原生特保，或 Buff 給予的 5++
    let effectiveInv = u.inv || 7;
    if (buffs.inv5 && effectiveInv > 5) effectiveInv = 5; // 如果 Buff 給 5++ 且比原本好

    if (effectiveInv <= 4) svFactor *= 1.4;
    else if (effectiveInv <= 5) svFactor *= 1.2;
    else if (effectiveInv <= 6) svFactor *= 1.1;

    // FNP (不覺疼痛) 計算
    // 數學期望值：有效血量 = 原血量 / (1 - P)
    // 6+++ (16% 減傷), 5+++ (33% 減傷), 4+++ (50% 減傷)
    // 這在數學上相當於對方 S 降低，或者自身 T 提升。粗略估計約提升 15-20% 生存力
    let baseFnp = u.fnp || 7;
    let buffFnp = buffs.fnp || 7;
    let effectiveFnp = Math.min(baseFnp, buffFnp);

    // 難以受傷 (-1 to Wound)
    if (buffs.minusWound) svFactor *= 1.2;

    let fnpFactor = 1.0;
    if (effectiveFnp <= 6) {
        // 為了避免分數過度膨脹，採用保守估計而非純數學期望
        if (effectiveFnp === 4) fnpFactor = 1.8; // 接近兩倍血量
        else if (effectiveFnp === 5) fnpFactor = 1.4;
        else if (effectiveFnp === 6) fnpFactor = 1.15;
    }

    // 總分 = 血量 * 強韌係數 * 護甲係數 * FNP係數
    return (u.w * tFactor * svFactor * fnpFactor).toFixed(1);
}

function calcTacticalScore(u) {
    // 10版 OC 為王，LD 影響 Battle-shock
    // OC 權重：每點 OC 價值約 3 分 (OC 2 的步兵價值 6)
    let ocScore = u.oc * 3.0;

    // LD 權重：Ld 6+ 為基準，每好一點增加穩定性
    // Ld 5+ (10-5=5) * 5 = 25分
    // Ld 6+ (10-6=4) * 5 = 20分
    let ldScore = (11 - u.ld) * 4;

    return (ocScore + ldScore).toFixed(1);
}

function calcWeaponPower(w, u = null) {
    // 取得單位層級的 Buff (如果有的話)
    const buffs = u && u.buffs ? u.buffs : {};
    // 讀取領袖給予的命中加值 (例如 +1)
    let hitMod = buffs.hit || 0;
    let baseHit = w.hit - hitMod;
    if (baseHit < 2) baseHit = 2;
    // 1. 命中期望 (BS/WS)
    let hitProb = (7 - w.hit) / 6;
    if (w.torrent) hitProb = 1.0; // 洪流自動命中



    // Sustained Hits (持續打擊)
    // 暴擊率通常為 1/6
    let weaponSus = w.sus || 0;
    let buffSus = buffs.sus || 0;
    let effectiveSus = Math.max(weaponSus, buffSus);

    let critProb = (7 - (w.crit || 6)) / 6.0;
    let sustainedBonus = 0;
    if (effectiveSus > 0) {
        sustainedBonus = critProb * effectiveSus;
    }

    let effectiveHits = w.a * (hitProb + sustainedBonus);

    // 2. 力量 (S) 修正 - 10版關鍵門檻
    // T3 (輕步兵), T4 (海軍陸戰隊), T5 (終結者/獸人), T9-10 (輕載具), T12 (重型坦克)
    // S4 為基準 (1.0)
    // S12 能傷 T12，價值極高
    let sFactor = Math.pow(w.s / 4.0, 0.9);

    // 3. 穿甲 (AP) 修正 - 10版 AP 稀缺
    // AP0 = 0.8 (容易被擋)
    // AP-1 = 1.0 (基準)
    // AP-2 = 1.3
    // AP-3 = 1.7
    let apVal = Math.abs(w.ap);
    let apFactor = 0.8 + (apVal * 0.3);

    // 4. 關鍵詞加成
    let kwBonus = 1.0;

    // Lethal Hits (致死): 跳過高 T 值造傷檢定，對打坦克極為重要
    if (w.lethal) kwBonus *= 1.25;

    // Devastating Wounds (毀滅): 無視護甲與特保，10版最強關鍵詞之一
    if (w.dev) kwBonus *= 1.4;

    // Twin-Linked (雙連): 重骰造傷，大幅提升穩定性
    if (w.twin) kwBonus *= 1.25;

    // 總分 = 期望命中數 * 力量係數 * 穿甲係數 * 傷害 * 關鍵詞
    return (effectiveHits * sFactor * apFactor * w.d * kwBonus);
}

// --- 介面互動邏輯 ---
function addWeaponBuffer() {
    let w = {
        name: document.getElementById('wName').value || 'Weapon',
        qty: parseInt(document.getElementById('wQty').value) || 1,
        grp: document.getElementById('wGrp').value.trim(),
        a: parseFloat(document.getElementById('wA').value) || 1,
        hit: parseInt(document.getElementById('wHit').value) || 3,
        s: parseInt(document.getElementById('wS').value) || 4,
        ap: parseInt(document.getElementById('wAP').value) || 0,
        d: parseFloat(document.getElementById('wD').value) || 1,
        sus: parseInt(document.getElementById('kwSus').value),
        crit: parseInt(document.getElementById('kwCrit').value),
        lethal: document.getElementById('kwLethal').checked,
        dev: document.getElementById('kwDev').checked,
        twin: document.getElementById('kwTwin').checked,
        torrent: document.getElementById('kwTorrent').checked,
        tags: document.getElementById('wTags').value
    };

    weaponBuffer.push(w);
    renderWeaponBuffer();

    document.getElementById('wName').value = '';
    document.getElementById('wTags').value = '';
    document.getElementById('wQty').value = '1';
}

function editWeapon(i) {
    let w = weaponBuffer[i];

    document.getElementById('wName').value = w.name;
    document.getElementById('wQty').value = w.qty;
    document.getElementById('wGrp').value = w.grp || '';
    document.getElementById('wA').value = w.a;
    document.getElementById('wHit').value = w.hit;
    document.getElementById('wS').value = w.s;
    document.getElementById('wAP').value = w.ap;
    document.getElementById('wD').value = w.d;
    document.getElementById('kwSus').value = w.sus;
    document.getElementById('kwCrit').value = w.crit;
    document.getElementById('kwLethal').checked = w.lethal;
    document.getElementById('kwDev').checked = w.dev;
    document.getElementById('kwTwin').checked = w.twin;
    document.getElementById('kwTorrent').checked = w.torrent;
    document.getElementById('wTags').value = w.tags;

    weaponBuffer.splice(i, 1);
    renderWeaponBuffer();
}

function renderWeaponBuffer() {
    const div = document.getElementById('weaponBufferList');
    if (weaponBuffer.length === 0) {
        div.innerHTML = '(暫無武器 No Weapons)';
        return;
    }

    div.innerHTML = weaponBuffer.map((w, i) => {
        let info = `A${w.a} ${w.hit}+ S${w.s} AP${w.ap} D${w.d}`;
        let effects = [];
        if (w.torrent) effects.push("洪流");
        if (w.sus > 0) effects.push(`持續 ${w.sus}`);
        if (w.lethal) effects.push("致死");
        if (w.dev) effects.push("毀滅");
        if (w.tags) effects.push(w.tags);

        let grpTag = w.grp ? `<span class="tag tag-grp">組:${w.grp}</span>` : '';

        return `<div class="weapon-row">
            <span>
                <b>${w.qty}x ${w.name}</b> ${grpTag} 
                <small>[${info}]</small> 
                <span style="color:#63b3ed; font-size:0.8em;">${effects.join(', ')}</span>
            </span>
            <span style="display:flex; gap:5px;">
                <span style="color:#d69e2e; cursor:pointer; font-weight:bold;" onclick="editWeapon(${i})">✎ 編輯</span>
                <span style="color:#e53e3e; cursor:pointer; font-weight:bold;" onclick="removeWeapon(${i})">✖ 刪除</span>
            </span>
        </div>`;
    }).join('');
}

function removeWeapon(i) { weaponBuffer.splice(i, 1); renderWeaponBuffer(); }

// --- 初始化與事件綁定 ---
window.onload = function () {
    if (localStorage.getItem('armyV4')) {
        myArmy = JSON.parse(localStorage.getItem('armyV4'));
    }

    const sizeSelect = document.getElementById('gameSizeSelect');
    sizeSelect.addEventListener('change', (e) => {
        currentGameSize = parseInt(e.target.value);
        saveAndRender();
    });
    currentGameSize = parseInt(sizeSelect.value);

    saveAndRender();

    document.getElementById('unitForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const u = {
            name: document.getElementById('uName').value,
            pts: parseInt(document.getElementById('uPts').value),
            models: parseInt(document.getElementById('uModels').value) || 1,
            t: parseInt(document.getElementById('uT').value),
            sv: parseInt(document.getElementById('uSv').value),
            inv: parseInt(document.getElementById('uInv').value) || 7,
            fnp: parseInt(document.getElementById('uFNP').value) || 7,
            w: parseInt(document.getElementById('uW').value),
            ld: parseInt(document.getElementById('uLd').value),
            oc: parseInt(document.getElementById('uOC').value),
            buffs: {
                lethal: document.getElementById('buffLethal').checked,
                dev: document.getElementById('buffDev').checked,
                minusWound: document.getElementById('buffMinusWound').checked,
                // 數值型欄位 (若為空則給預設值)
                hit: parseInt(document.getElementById('buffHit').value) || 0,
                sus: parseInt(document.getElementById('buffSus').value) || 0,
                sv: parseInt(document.getElementById('buffSv').value) || 0,
                inv: parseInt(document.getElementById('buffInv').value) || 7,
                fnp: parseInt(document.getElementById('buffFnp').value) || 7
            },
            weapons: [...weaponBuffer]
        };

        let idx = parseInt(document.getElementById('editIndex').value);
        if (idx >= 0) myArmy[idx] = u;
        else myArmy.push(u);

        saveAndRender();
        resetForm();
    });

    initTooltips();
};

function resetForm() {
    document.getElementById('unitForm').reset();
    document.getElementById('editIndex').value = "-1";
    document.getElementById('wQty').value = "1";
    document.getElementById('uFNP').value = "7";
    weaponBuffer = [];
    renderWeaponBuffer();
}

function updateUnitCount(index, value) {
    let count = parseInt(value);
    if (isNaN(count) || count < 0) count = 0;
    myArmy[index].count = count;
    saveAndRender();
}

// --- 修改: saveAndRender 函數 (包含數量計算邏輯) ---
function saveAndRender() {
    localStorage.setItem('armyV4', JSON.stringify(myArmy));

    const ratio = currentGameSize / 2000;

    let totalPts = 0, totalOff = 0, totalDef = 0, totalTac = 0;
    const tbody = document.getElementById('rosterBody');

    tbody.innerHTML = myArmy.map((u, i) => {
        // 確保每個單位都有 count 屬性，預設為 1
        if (typeof u.count === 'undefined') u.count = 1;
        let unitQty = u.count;

        // 計算單兵分數
        let defScore = parseFloat(calcDefenseScore(u));
        let tacScore = parseFloat(calcTacticalScore(u));

        let offScore = 0;
        let groupScores = {};

        let modelCount = u.models || 1;

        // 產生武器 HTML 並計算火力
        let weaponHtml = u.weapons.map(w => {
            let singlePower = calcWeaponPower(w, u);
            let totalPower = singlePower * w.qty;

            if (w.grp) {
                if (!groupScores[w.grp] || totalPower > groupScores[w.grp]) {
                    groupScores[w.grp] = totalPower;
                }
            } else {
                offScore += totalPower;
            }

            let badges = [];
            if (w.grp) badges.push(`組別:${w.grp}`);
            if (w.sus) badges.push(`持續 ${w.sus}`);
            if (w.lethal) badges.push(`致死`);
            if (w.dev) badges.push(`毀滅`);
            if (w.tags) badges.push(w.tags);

            // 武器名稱顯示
            return `<div class="weapon-row">
                <span>
                    ${w.qty}x ${w.name} 
                    <span style="color:#718096">(${w.a}A / S${w.s} / AP${w.ap})</span> 
                    ${badges.map(b => {
                let cls = b.startsWith('組別') ? 'tag tag-grp' : 'tag tag-kw';
                return `<span class="${cls}">${b}</span>`;
            }).join('')}
                </span>
                <strong style="color:var(--accent)">${totalPower.toFixed(1)}</strong>
            </div>`;
        }).join('');

        let activeBuffs = [];
        if (u.buffs) {
            if (u.buffs.lethal) activeBuffs.push("致死");
            if (u.buffs.dev) activeBuffs.push("毀滅");
            if (u.buffs.minusWound) activeBuffs.push("-1受傷");

            if (u.buffs.hit > 0) activeBuffs.push(`+${u.buffs.hit}命中`);
            if (u.buffs.sus > 0) activeBuffs.push(`持續${u.buffs.sus}`);
            if (u.buffs.sv > 0) activeBuffs.push(`Sv+${u.buffs.sv}`); // 盔保修正
            if (u.buffs.inv < 7) activeBuffs.push(`${u.buffs.inv}++`);
            if (u.buffs.fnp < 7) activeBuffs.push(`${u.buffs.fnp}+++`);
        }
        let buffHtml = activeBuffs.length > 0
            ? `<div style="font-size:0.75rem; color:#f6e05e; margin-top:2px;">👑 ${activeBuffs.join(', ')}</div>`
            : '';

        // 加上擇一組別的分數
        for (let grp in groupScores) {
            offScore += groupScores[grp];
        }

        // --- 核心修改邏輯: 將數量納入總分計算 ---
        // 如果數量為 0，則不加入總分
        if (unitQty > 0) {
            totalPts += u.pts * unitQty;
            totalOff += offScore * unitQty;
            totalDef += defScore * modelCount * unitQty;
            totalTac += tacScore * modelCount * unitQty;
        }

        // 視覺上的單兵戰力佔比 (依然顯示單兵能力，不乘以數量，方便評估單位體質)
        const unitNormOff = (BASE_THRESHOLDS.offense.high * ratio) / 8;
        const unitNormDef = (BASE_THRESHOLDS.defense.high * ratio) / 8;
        const offPercent = Math.min((offScore / unitNormOff) * 100, 100);
        const defPercent = Math.min((defScore / unitNormDef) * 100, 100);

        let fnpText = (u.fnp && u.fnp <= 6) ? ` / <b>FNP</b>:${u.fnp}+` : "";

        // 若數量為 0，將整行半透明化，表示未啟用
        let rowStyle = unitQty === 0 ? "opacity: 0.5; filter: grayscale(0.8);" : "";

        return `<tr style="${rowStyle}">
            <td style="vertical-align: middle; text-align: center;">
                <input type="number" 
                       value="${unitQty}" 
                       min="0" 
                       onchange="updateUnitCount(${i}, this.value)"
                       style="width: 60px; text-align: center; font-size: 1.2rem; font-weight: bold; background: #2d3748; border: 2px solid var(--accent); color: white;">
            </td>
            <td>
                <div style="font-weight:bold; font-size:1.1rem; color:white;">${u.name}</div>
                <div style="font-size:0.8rem; color:#a0aec0;">${u.pts} 分 (Pts) / ${u.models} 模型</div>
                <div style="font-size:0.8rem; color:var(--accent); margin-top:4px;">
                    小計: ${u.pts * unitQty} 分
                </div>
            </td>
            <td>
                <div style="font-size:0.9rem; line-height:1.6;">
                    <div>🛡️ <b>T</b>:${u.t} / <b>Sv</b>:${u.sv}+ / <b>Inv</b>:${u.inv}+ ${fnpText} / <b>W</b>:${u.w}</div>
                    <div>🏳️ <b>OC</b>:${u.oc} / <b>Ld</b>:${u.ld}+</div>
                </div>
            </td>
            <td>
                ${weaponHtml}
                <div style="margin-top:10px; display:flex; gap:10px;">
                    <div style="flex:1;">
                        <div style="font-size:0.75rem; color:#63b3ed">防禦評級 (單兵): ${defScore}</div>
                        <div class="bar-container"><div class="bar-fill bar-def" style="width:${defPercent}%"></div></div>
                    </div>
                    <div style="flex:1;">
                        <div style="font-size:0.75rem; color:var(--accent)">火力評級 (單兵): ${offScore.toFixed(1)}</div>
                        <div class="bar-container"><div class="bar-fill" style="width:${offPercent}%"></div></div>
                    </div>
                </div>
            </td>
            <td>
                <button class="btn btn-sec" style="padding:5px; margin-bottom:5px;" onclick="editUnit(${i})">編輯 Edit</button>
                <button class="btn btn-danger" style="padding:5px;" onclick="removeUnit(${i})">刪除 Del</button>
            </td>
        </tr>`;
    }).join('');

    document.getElementById('totalPoints').innerText = totalPts;
    document.getElementById('totalOffense').innerText = totalOff.toFixed(0);
    document.getElementById('totalDefense').innerText = totalDef.toFixed(0);
    document.getElementById('totalTactical').innerText = totalTac.toFixed(0);
}

function editUnit(i) {
    let u = myArmy[i];
    document.getElementById('uName').value = u.name;
    document.getElementById('uPts').value = u.pts;
    document.getElementById('uModels').value = u.models;
    document.getElementById('uT').value = u.t;
    document.getElementById('uSv').value = u.sv;
    document.getElementById('uInv').value = u.inv;
    document.getElementById('uFNP').value = u.fnp || 7;
    document.getElementById('uW').value = u.w;
    document.getElementById('uLd').value = u.ld;
    document.getElementById('uOC').value = u.oc;

    // 讀取 Buffs 狀態 (加上防呆，避免舊資料報錯)
    const buffs = u.buffs || {};
    // Checkboxes
    document.getElementById('buffLethal').checked = !!buffs.lethal;
    document.getElementById('buffDev').checked = !!buffs.dev;
    document.getElementById('buffMinusWound').checked = !!buffs.minusWound;

    // Number Inputs
    document.getElementById('buffHit').value = buffs.hit || 0;
    document.getElementById('buffSus').value = buffs.sus || 0;
    document.getElementById('buffSv').value = buffs.sv || 0;
    document.getElementById('buffInv').value = buffs.inv || 7;
    document.getElementById('buffFnp').value = buffs.fnp || 7;

    weaponBuffer = [...u.weapons];
    renderWeaponBuffer();
    document.getElementById('editIndex').value = i;
}

function removeUnit(i) {
    if (confirm("確定要刪除這個單位嗎？\nAre you sure you want to delete this unit?")) { myArmy.splice(i, 1); saveAndRender(); }
}

function clearAll() {
    if (confirm("確定要清空所有列表嗎？\nClear all roster data?")) { myArmy = []; saveAndRender(); }
}

function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(myArmy, null, 4));
    const a = document.createElement('a');
    a.href = dataStr; a.download = "army_list_v4_pretty.json"; a.click();
}

function importData(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) { myArmy = JSON.parse(e.target.result); saveAndRender(); };
    reader.readAsText(file);
}

function initTooltips() {
    const tooltip = document.createElement('div');
    tooltip.className = 'custom-tooltip';
    document.body.appendChild(tooltip);

    const cards = document.querySelectorAll('.score-card');

    cards.forEach(card => {
        card.addEventListener('mouseenter', (e) => {
            const id = card.id;
            const ratio = currentGameSize / 2000;
            let text = "";

            if (id === 'cardPoints') {
                text = `軍隊的總花費分數。\n目前設定規模：${currentGameSize} 分`;
            } else if (id === 'cardOffense') {
                const low = (BASE_THRESHOLDS.offense.low * ratio).toFixed(0);
                const high = (BASE_THRESHOLDS.offense.high * ratio).toFixed(0);
                text = `基於 10th Ed 殺傷期望值。\nAP稀缺化與 T值膨脹已納入考量。\n[${currentGameSize}分建議]\n低：< ${low}\n中：${low} - ${high}\n高：> ${high}`;
            } else if (id === 'cardDefense') {
                const low = (BASE_THRESHOLDS.defense.low * ratio).toFixed(0);
                const high = (BASE_THRESHOLDS.defense.high * ratio).toFixed(0);
                text = `基於有效血量(EHP)與載具抗性。\n2+護甲與高 T 值有額外加權。\n[${currentGameSize}分建議]\n低：< ${low}\n中：${low} - ${high}\n高：> ${high}`;
            } else if (id === 'cardTactical') {
                const low = (BASE_THRESHOLDS.tactical.low * ratio).toFixed(0);
                const high = (BASE_THRESHOLDS.tactical.high * ratio).toFixed(0);
                text = `基於佔領值 (OC) 與士氣穩定度。\nOC 在 10版 為核心指標。\n[${currentGameSize}分建議]\n低：< ${low}\n中：${low} - ${high}\n高：> ${high}`;
            }

            tooltip.textContent = text;
            tooltip.classList.add('show');
            updateTooltipPosition(card, tooltip);
        });

        card.addEventListener('mouseleave', () => {
            tooltip.classList.remove('show');
        });
    });
}

function updateTooltipPosition(target, tooltip) {
    const rect = target.getBoundingClientRect();
    const gap = 10;

    let top = rect.top + window.scrollY - tooltip.offsetHeight - gap;
    let left = rect.left + window.scrollX + (rect.width / 2) - (tooltip.offsetWidth / 2);

    if (rect.top - tooltip.offsetHeight - gap < 0) {
        top = rect.bottom + window.scrollY + gap;
    }

    if (left < 0) {
        left = 10;
    }

    if (left + tooltip.offsetWidth > window.innerWidth) {
        left = window.innerWidth - tooltip.offsetWidth - 10;
    }

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
}