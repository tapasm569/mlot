const SUPABASE_URL = 'https://uwpexlmvpnffbmvlqski.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3cGV4bG12cG5mZmJtdmxxc2tpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyODQ1MTQsImV4cCI6MjEwNDg2MDUxNH0.n59Hyk18Ysb93Fw70pWNmFT0KMGZm_CECYvtdD_MsxA';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUserRole = 'mlot', currentMlotId = null, currentSellerCode = null;
let pendingBatchTickets = [], pendingUnsoldBatch = [], pendingPurchaseDraft = [];
let tempSellerData = {}, currentStockCategory = '1 PM', currentSellerStockCategory = '1 PM';
let currentlyViewingSellerCode = null, isEditingSeller = false;
let activeSaleSetPrice = 6.50, activeUnsoldSetPrice = 6.50, activeSellerUnsoldSetPrice = 6.50;
let deviceFCMToken = null, rememberedPurchasePrice = localStorage.getItem('lastPurchasePrice') || '';

// --- DOM & UTILITY HELPERS ---
const $ = id => document.getElementById(id);
const val = id => $(id)?.value?.trim() || '';
const toggleModal = (modalId, show = true) => $(modalId)?.classList.toggle('hidden', !show);
const fmtCurr = n => `₹${Number(n || 0).toFixed(2)}`;

// --- DATE UTILITIES (Strict DD/MM/YYYY Support) ---
const getISODateString = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function formatToDBDate(str) {
    if (!str) return '';
    str = String(str).trim();
    if (str.includes('/')) return str;
    const p = str.split('-');
    return p.length === 3 ? (p[0].length === 4 ? `${p[2]}/${p[1]}/${p[0]}` : `${p[0]}/${p[1]}/${p[2]}`) : str;
}

function convertDateToComparable(dateStr) {
    if (!dateStr) return '';
    const p = String(dateStr).trim().split(/[-/]/);
    if (p.length !== 3) return dateStr;
    return p[0].length === 4 ? `${p[0]}${p[1].padStart(2, '0')}${p[2].padStart(2, '0')}` : `${p[2]}${p[1].padStart(2, '0')}${p[0].padStart(2, '0')}`;
}

// --- ANDROID PDF & WHATSAPP BRIDGE ---
function openPDFDirectly(doc, fileName = `Report_${Date.now()}.pdf`) {
    if (!doc) return alert("Error: PDF document is empty.");
    try {
        const dataUri = doc.output('datauristring'), pdfBase64 = dataUri.split(',')[1];
        if (window.AndroidBridge?.openPDFDirectly) {
            window.AndroidBridge.openPDFDirectly(pdfBase64, fileName);
        } else {
            const a = Object.assign(document.createElement('a'), { href: dataUri, download: fileName });
            document.body.appendChild(a); a.click(); a.remove();
        }
    } catch (err) { alert("Could not open PDF: " + err.message); }
}

// --- KEYBOARD LISTENER ---
window.addEventListener('focusin', e => ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) && $('footer-nav')?.classList.add('hidden'));
window.addEventListener('focusout', e => ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) && setTimeout(() => {
    if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName) && currentUserRole === 'mlot') $('footer-nav')?.classList.remove('hidden');
}, 150));

// --- FCM PUSH NOTIFICATION BRIDGE ---
window.receiveFCMTokenFromAndroid = token => { if (token && token !== "null") { deviceFCMToken = token; if (currentMlotId) updateTokenInDatabase(); } };
function checkBridgeForFCMToken() {
    if (!deviceFCMToken && window.AndroidBridge?.getFCMToken) {
        const t = window.AndroidBridge.getFCMToken();
        if (t && t !== "null") deviceFCMToken = t;
    }
    return deviceFCMToken;
}
async function updateTokenInDatabase(retries = 0) {
    checkBridgeForFCMToken();
    if (!deviceFCMToken && retries < 5 && currentMlotId) return setTimeout(() => updateTokenInDatabase(retries + 1), 1500);
    if (!currentMlotId || !deviceFCMToken) return;
    const table = currentUserRole === 'mlot' ? 'mlot_users' : 'sellers';
    const match = currentUserRole === 'mlot' ? { mlot_id: currentMlotId } : { mlot_id: currentMlotId, code: currentSellerCode };
    await _supabase.from(table).update({ fcm_token: deviceFCMToken }).match(match);
}

const seriesOptionsMap = {
    "1 PM": ["M5", "M10", "M20", "M30", "M50", "M100", "M200"],
    "6 PM": ["D5", "D10", "D20", "D30", "D50", "D100", "D200"],
    "8 PM": ["E5", "E10", "E20", "E30", "E50", "E100", "E200"]
};

// --- AUTH & INITIALIZATION ---
window.onload = function() {
    checkBridgeForFCMToken();
    const savedRole = localStorage.getItem('currentUserRole');
    if (savedRole) {
        currentUserRole = savedRole;
        currentMlotId = localStorage.getItem('currentMlotId');
        currentSellerCode = localStorage.getItem('currentSellerCode');
        $('login-screen').classList.add('hidden');
        if (savedRole === 'mlot') {
            $('app-header-title').innerText = `${localStorage.getItem('businessName') || "MLOT User"} (ID: ${currentMlotId})`;
            $('footer-nav').classList.remove('hidden');
            updatePendingUnsoldBadge(); switchTab('sale', false);
        } else if (savedRole === 'seller') {
            $('app-header-title').innerText = `Seller Portal (${currentSellerCode})`;
            $('footer-nav').classList.add('hidden'); openSellerAccountHome();
        } else {
            $('app-header-title').innerText = "Super Admin Control Center";
            $('footer-nav').classList.add('hidden');
            document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
            $('page-admin-dashboard').classList.remove('hidden'); openAdminSection('view-mlot');
        }
        updateTokenInDatabase();
    }
};

function switchAuthTab(tab) {
    ['mlot-login', 'seller', 'admin'].forEach(k => $(`form-${k === 'seller' ? 'seller-login' : k === 'mlot-login' ? 'mlot-login' : 'admin-login'}`).classList.toggle('hidden', k !== tab));
    $('auth-tab-mlot-login').className = `flex-1 py-2 text-xs font-semibold rounded-lg ${tab === 'mlot-login' ? 'bg-indigo-600 text-white shadow' : 'text-slate-300'}`;
    $('auth-tab-seller').className = `flex-1 py-2 text-xs font-semibold rounded-lg ${tab === 'seller' ? 'bg-emerald-600 text-white shadow' : 'text-slate-300'}`;
}

async function handleMlotLogin(e) {
    e.preventDefault();
    const id = val('mlot-id-input'), pass = val('mlot-pass-input');
    const { data } = await _supabase.from('mlot_users').select('*').eq('mlot_id', id).maybeSingle();
    if (!data || data.mobile !== pass) return alert("Invalid Credentials!");
    if (new Date() > new Date(data.subscription_expiry)) return alert("Subscription expired!");
    currentUserRole = 'mlot'; currentMlotId = data.mlot_id;
    localStorage.setItem('currentUserRole', 'mlot'); localStorage.setItem('currentMlotId', currentMlotId); localStorage.setItem('businessName', data.business_name);
    $('app-header-title').innerText = `${data.business_name} (ID: ${data.mlot_id})`;
    $('login-screen').classList.add('hidden'); $('footer-nav').classList.remove('hidden');
    updatePendingUnsoldBadge(); switchTab('sale'); updateTokenInDatabase();
}

async function handleSellerLogin(e) {
    e.preventDefault();
    const id = val('seller-mlot-id'), mob = val('seller-mobile-input');
    const { data } = await _supabase.from('sellers').select('*').eq('mlot_id', id).eq('phone', mob).maybeSingle();
    if (!data) return alert("Invalid Credentials!");
    currentUserRole = 'seller'; currentMlotId = id; currentSellerCode = data.code; activeSellerUnsoldSetPrice = data.set_price || 6.50;
    localStorage.setItem('currentUserRole', 'seller'); localStorage.setItem('currentMlotId', currentMlotId); localStorage.setItem('currentSellerCode', currentSellerCode);
    $('app-header-title').innerText = `Seller Portal (${currentSellerCode})`;
    $('login-screen').classList.add('hidden'); $('footer-nav').classList.add('hidden');
    openSellerAccountHome(); updateTokenInDatabase();
}

async function handleAdminLogin(e) {
    e.preventDefault();
    const { data } = await _supabase.from('admins').select('*').eq('mobile', val('admin-mob-input')).eq('password', val('admin-pass-input')).maybeSingle();
    if (!data) return alert("Invalid Admin Credentials!");
    currentUserRole = 'admin'; localStorage.setItem('currentUserRole', 'admin');
    $('app-header-title').innerText = "Super Admin Control Center";
    $('login-screen').classList.add('hidden'); $('footer-nav').classList.add('hidden');
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    $('page-admin-dashboard').classList.remove('hidden'); openAdminSection('view-mlot');
}

function logout() {
    localStorage.clear(); currentUserRole = 'mlot'; currentMlotId = null; currentSellerCode = null;
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    $('footer-nav').classList.add('hidden'); $('login-screen').classList.remove('hidden'); switchAuthTab('mlot-login');
}

// --- NAVIGATION & TABS ---
function switchTab(tab, push = true) {
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    const target = $(currentUserRole === 'seller' && tab === 'account' ? 'page-seller-account' : `page-${tab}`);
    if (target) target.classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.className = "nav-btn flex flex-col items-center justify-center w-16 py-1 text-slate-400 transition-all";
        btn.querySelector('span').className = "text-[10px] font-medium";
    });
    const act = $(`nav-${tab}`);
    if (act) {
        act.className = `nav-btn flex flex-col items-center justify-center ${tab === 'master' ? 'px-3 py-0.5' : 'w-16 py-1'} text-indigo-600 transition-all`;
        act.querySelector('span').className = "text-[10px] font-bold";
    }
    if (push) history.pushState({ type: 'tab', name: tab }, '', '');
    if (tab === 'purchase') { if (!val('stock-filter-date')) $('stock-filter-date').value = getISODateString(); renderPurchaseAvailableStock(); }
    else if (tab === 'sale') { if (!val('sale-page-filter-date')) $('sale-page-filter-date').value = getISODateString(); renderMasterAndSaleTables(); }
    else renderMasterAndSaleTables();
}

function openSubPage(id, push = true) {
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    $(id)?.classList.remove('hidden');
    if (push) history.pushState({ type: 'subpage', name: id }, '', '');
}

window.addEventListener('popstate', e => {
    const modal = document.querySelector('.absolute.inset-0.z-50:not(.hidden), div[id$="-modal"]:not(.hidden)');
    if (modal && modal.id !== 'login-screen') return modal.classList.add('hidden');
    if (e.state?.type === 'tab') switchTab(e.state.name, false);
    else if (e.state?.type === 'subpage') openSubPage(e.state.name, false);
    else currentUserRole === 'mlot' ? switchTab('sale', false) : openSellerAccountHome();
});

// --- RANGE PARSING & EXPANSION ---
function parseRangeQuantity(series, fromStr, toStr) {
    const mult = parseInt(series?.match(/\d+/)?.[0] || 1), fromVal = parseInt(fromStr);
    let toVal = parseInt(toStr);
    if (!isNaN(fromVal)) {
        let actTo = isNaN(toVal) ? fromVal : (toVal < fromVal && toStr.length < fromStr.length ? parseInt(fromStr.slice(0, -toStr.length) + toStr) : toVal);
        return actTo >= fromVal ? { qty: mult * (actTo - fromVal + 1), mult, actualToVal: actTo, error: false } : { qty: 0, mult, actualToVal: fromVal, error: true };
    }
    return { qty: 0, mult, actualToVal: 0, error: true };
}

const formatTicketRangeString = (grp, fromVal, actTo) => isNaN(actTo) || fromVal === actTo ? `${grp} ${fromVal}` : `${grp} ${fromVal}-${actTo}`;

function expandRangeToIndividualTickets(rangeStr) {
    const parts = (rangeStr || '').trim().split(/\s+/);
    if (parts.length < 2) return [];
    const nums = parts[1].split('-'), start = parseInt(nums[0]);
    let end = nums.length > 1 ? parseInt(nums[1]) : start;
    if (nums.length > 1 && nums[1].length < nums[0].length) end = parseInt(nums[0].slice(0, -nums[1].length) + nums[1]);
    return Array.from({ length: end - start + 1 }, (_, i) => `${parts[0]} ${start + i}`);
}

// --- SHARED DROPDOWN & SERIES HELPERS ---
async function fillSellerDropdowns(...ids) {
    const { data } = await _supabase.from('sellers').select('code').eq('mlot_id', currentMlotId);
    ids.forEach(id => {
        const el = $(id);
        if (el) el.innerHTML = '<option value="">Select Code</option>' + (data || []).map(s => `<option value="${s.code}">${s.code}</option>`).join('');
    });
}
const updateSellerCodeDropdown = () => fillSellerDropdowns('sale-seller-code');
const updateUnsoldCodeDropdown = () => fillSellerDropdowns('unsold-seller-code');
const updateQuickUnsoldCodeDropdown = () => fillSellerDropdowns('unsold-q-seller-code');

function setSeriesOptions(itemSelId, seriesSelId, calcFn) {
    const el = $(seriesSelId);
    el.innerHTML = (seriesOptionsMap[val(itemSelId)] || []).map(s => `<option value="${s}">${s}</option>`).join('');
    if (calcFn) calcFn();
}
const onPurchaseItemChange = () => setSeriesOptions('pur-item', 'pur-series', calculatePurchaseCost);
const onItemChange = () => setSeriesOptions('sale-item', 'sale-series', calculateSalePrice);
const onUnsoldItemChange = () => setSeriesOptions('unsold-item', 'unsold-series', calculateUnsoldPrice);
const onSellerUnsoldItemChange = () => setSeriesOptions('s-unsold-item', 's-unsold-series', calculateSellerUnsoldPrice);

async function setSellerNameField(code, nameInputId, priceCallback) {
    if (!code) { $(nameInputId).value = ""; return priceCallback?.(6.50); }
    const { data } = await _supabase.from('sellers').select('name, set_price').eq('mlot_id', currentMlotId).eq('code', code).single();
    $(nameInputId).value = data?.name || "";
    priceCallback?.(data?.set_price || 6.50);
}
const onSellerCodeChange = () => setSellerNameField(val('sale-seller-code'), 'sale-seller-name', p => { activeSaleSetPrice = p; calculateSalePrice(); });
const onUnsoldCodeChange = () => setSellerNameField(val('unsold-seller-code'), 'unsold-seller-name', p => { activeUnsoldSetPrice = p; calculateUnsoldPrice(); });
const onQuickSellerCodeChange = () => setSellerNameField(val('unsold-q-seller-code'), 'unsold-q-seller-name');

// --- STOCK & INVENTORY VIEWS ---
function updateCategoryUI(prefix, cat, titleId, renderFn) {
    ['1pm', '6pm', '8pm'].forEach(c => {
        const btn = $(`${prefix}-${c}`);
        if (btn) btn.className = `${prefix === 's-cat' ? 's-stock-cat-btn py-2.5' : 'stock-cat-btn py-3'} px-2 ${cat.toLowerCase().includes(c) ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-700 border border-slate-200'} rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center gap-1 active:scale-95`;
    });
    $(titleId).innerText = `${cat} Stock Pool`;
    renderFn();
}
const selectStockCategory = cat => { currentStockCategory = cat; updateCategoryUI('cat', cat, 'active-category-title', renderPurchaseAvailableStock); };
const selectSellerStockCategory = cat => { currentSellerStockCategory = cat; updateCategoryUI('s-cat', cat, 'seller-stock-category-title', renderSellerAvailableStockIndividual); };

function changeDateByOffset(inputId, days, callback) {
    const input = $(inputId), d = input.value ? new Date(input.value) : new Date();
    d.setDate(d.getDate() + days); input.value = getISODateString(d); callback();
}
const changeStockDate = d => changeDateByOffset('stock-filter-date', d, renderPurchaseAvailableStock);
const changeSellerStockDate = d => changeDateByOffset('seller-stock-filter-date', d, renderSellerAvailableStockIndividual);

async function fetchAndRenderStockPool(cat, dateInputId, containerId, badgeId) {
    if (!currentMlotId) return;
    const date = formatToDBDate(val(dateInputId) || getISODateString());
    const [p, s, u] = await Promise.all(['purchase_store', 'sales_records', 'unsold_records'].map(tbl => _supabase.from(tbl).select('*').eq('item', cat).eq('date', date).eq('mlot_id', currentMlotId)));
    const soldSet = new Set();
    (s.data || []).forEach(row => expandRangeToIndividualTickets(row.ticket_range).forEach(t => soldSet.add(t)));
    (u.data || []).forEach(row => expandRangeToIndividualTickets(row.ticket_range).forEach(t => soldSet.delete(t)));

    const seriesMap = {};
    (p.data || []).forEach(row => {
        const sKey = row.series || "General";
        seriesMap[sKey] = seriesMap[sKey] || [];
        expandRangeToIndividualTickets(row.ticket_range).forEach(t => !soldSet.has(t) && seriesMap[sKey].push(t));
    });

    const container = $(containerId), keys = Object.keys(seriesMap).filter(k => seriesMap[k].length);
    let total = 0; container.innerHTML = '';
    if (!keys.length) {
        container.innerHTML = `<div class="p-4 bg-slate-50 text-center text-xs text-slate-400">No stock available.</div>`;
    } else {
        keys.forEach(k => {
            total += seriesMap[k].length;
            const badges = seriesMap[k].map(t => `<span class="bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-mono px-2 py-0.5 rounded-md inline-block m-0.5">${t}</span>`).join('');
            container.innerHTML += `<div class="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2"><div class="flex justify-between items-center border-b border-slate-200 pb-1.5"><span class="text-xs font-bold text-slate-800">Series: ${k}</span><span class="text-[10px] bg-purple-100 text-purple-700 font-bold px-2 py-0.5 rounded-full">${seriesMap[k].length} Left</span></div><div class="flex flex-wrap max-h-[140px] overflow-y-auto">${badges}</div></div>`;
        });
    }
    $(badgeId).innerText = `${total} Available`;
}
const renderPurchaseAvailableStock = () => fetchAndRenderStockPool(currentStockCategory, 'stock-filter-date', 'purchase-available-series-container', 'available-total-badge');
const renderSellerAvailableStockIndividual = () => fetchAndRenderStockPool(currentSellerStockCategory, 'seller-stock-filter-date', 'seller-purchase-indv-container', 'seller-available-count');

// ================= PURCHASE ENTRY (MANDATORY STICKY PRICE) =================
function openPurchaseEntryPage() {
    openSubPage('page-purchase-entry');
    $('pur-date').value = getISODateString();
    if (rememberedPurchasePrice) $('pur-buying-price').value = rememberedPurchasePrice;
    onPurchaseItemChange();
}

function calculatePurchaseCost() {
    const price = parseFloat(val('pur-buying-price')) || 0;
    if (val('pur-buying-price') && price > 0) {
        rememberedPurchasePrice = val('pur-buying-price');
        localStorage.setItem('lastPurchasePrice', rememberedPurchasePrice);
    }
    const calc = parseRangeQuantity(val('pur-series'), val('pur-from'), val('pur-to'));
    $('pur-qty').value = calc.qty || 0;
    $('pur-total-amount').innerText = fmtCurr((calc.qty || 0) * price);
}

function handlePurchaseBlurAutoDraft() {
    const price = parseFloat(val('pur-buying-price')), grp = val('pur-group').toUpperCase(), from = val('pur-from');
    if (!price || price <= 0 || !grp || !from) return;
    const calc = parseRangeQuantity(val('pur-series'), from, val('pur-to'));
    if (calc.error) return;
    const range = formatTicketRangeString(grp, parseInt(from), calc.actualToVal);
    const date = formatToDBDate(val('pur-date') || getISODateString());
    if (!pendingPurchaseDraft.some(d => d.date === date && d.item === val('pur-item') && d.series === val('pur-series') && d.ticket_range === range)) {
        pendingPurchaseDraft.push({ date, item: val('pur-item'), series: val('pur-series'), ticket_range: range, qty: calc.qty, cost_raw: calc.qty * price, mlot_id: currentMlotId });
        $('pur-draft-count').innerText = pendingPurchaseDraft.length;
    }
}

function addPurchaseDraft(e) {
    if (e) e.preventDefault();
    const price = parseFloat(val('pur-buying-price')), grp = val('pur-group').toUpperCase(), from = val('pur-from');
    if (!price || price <= 0) { alert("Set Price is required! Please enter Buying Price."); $('pur-buying-price').focus(); return false; }
    if (!grp || !from) { alert("Please enter both Group and Ticket Number."); return false; }
    const calc = parseRangeQuantity(val('pur-series'), from, val('pur-to'));
    if (calc.error) { alert("Invalid ticket range."); return false; }
    const range = formatTicketRangeString(grp, parseInt(from), calc.actualToVal);
    const date = formatToDBDate(val('pur-date') || getISODateString());
    if (pendingPurchaseDraft.some(d => d.date === date && d.item === val('pur-item') && d.series === val('pur-series') && d.ticket_range === range)) {
        alert("DUPLICATE ENTRY!\nThis purchase ticket range is already added in draft."); return false;
    }
    pendingPurchaseDraft.push({ date, item: val('pur-item'), series: val('pur-series'), ticket_range: range, qty: calc.qty, cost_raw: calc.qty * price, mlot_id: currentMlotId });
    $('pur-draft-count').innerText = pendingPurchaseDraft.length;
    $('pur-from').value = ''; $('pur-to').value = ''; calculatePurchaseCost();
    return true;
}

function openPurchaseDraftModal() {
    const tbody = $('pur-draft-tbody'), tfoot = $('pur-draft-tfoot');
    let q = 0, c = 0;
    if (!pendingPurchaseDraft.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">Draft is empty.</td></tr>`;
    } else {
        tbody.innerHTML = pendingPurchaseDraft.map((item, idx) => {
            q += item.qty; c += item.cost_raw;
            return `<tr class="border-b border-slate-100"><td class="p-2">${idx+1}</td><td class="p-2">${item.item}</td><td class="p-2 font-bold">${item.series}</td><td class="p-2 font-mono text-[10px]">${item.ticket_range}</td><td class="p-2 font-bold text-purple-600">${item.qty}</td><td class="p-2 font-bold">${fmtCurr(item.cost_raw)}</td><td class="p-2 text-center"><button onclick="pendingPurchaseDraft.splice(${idx},1);$('pur-draft-count').innerText=pendingPurchaseDraft.length;openPurchaseDraftModal()" class="text-red-500"><i class="fa-solid fa-trash"></i></button></td></tr>`;
        }).join('');
    }
    tfoot.innerHTML = `<tr><td colspan="4" class="p-2 text-right font-bold">Total:</td><td class="p-2 font-bold text-purple-600">${q}</td><td colspan="2" class="p-2 font-bold text-indigo-600">${fmtCurr(c)}</td></tr>`;
    toggleModal('purchase-draft-modal', true);
}
const closePurchaseDraftModal = () => toggleModal('purchase-draft-modal', false);
const closeShowTicketModal = () => toggleModal('show-ticket-modal', false);

async function savePurchaseToStore() {
    if (!currentMlotId) currentMlotId = localStorage.getItem('currentMlotId');
    if (!pendingPurchaseDraft.length && val('pur-group') && val('pur-from') && val('pur-buying-price')) {
        if (!addPurchaseDraft(null)) return;
    }
    if (!pendingPurchaseDraft.length) return alert("Draft is empty! Add tickets first.");
    const payload = pendingPurchaseDraft.map(item => ({ ...item, date: formatToDBDate(item.date), qty: parseInt(item.qty), cost_raw: parseFloat(item.cost_raw), mlot_id: String(currentMlotId) }));
    const { error } = await _supabase.from('purchase_store').insert(payload);
    if (error) return alert("Database Error: " + error.message);
    alert("Saved to store inventory successfully!");
    pendingPurchaseDraft = []; $('pur-draft-count').innerText = '0';
    $('form-purchase-manual').reset(); $('pur-date').value = getISODateString();
    if (rememberedPurchasePrice) $('pur-buying-price').value = rememberedPurchasePrice;
    closePurchaseDraftModal(); switchTab('purchase');
}

// ================= SALE ENTRY & DUPLICATE RESTRICTION =================
function openSaleEntryPage() {
    openSubPage('page-sale-entry');
    $('sale-date').value = getISODateString();
    updateSellerCodeDropdown(); onItemChange();
}

function calculateSalePrice() {
    const calc = parseRangeQuantity(val('sale-series'), val('sale-from'), val('sale-to'));
    $('sale-qty').value = calc.qty || 0;
    $('sale-price').value = fmtCurr((calc.qty || 0) * activeSaleSetPrice);
}

function handleSaleBlurAutoDraft() {
    const code = val('sale-seller-code'), grp = val('sale-group'), from = val('sale-from'), to = val('sale-to');
    if (!code || !grp || !from || !to) return;
    const calc = parseRangeQuantity(val('sale-series'), from, to);
    if (calc.error) return;
    const range = formatTicketRangeString(grp.toUpperCase(), parseInt(from), calc.actualToVal);
    const tickets = expandRangeToIndividualTickets(range), draftedSet = new Set();
    pendingBatchTickets.forEach(b => expandRangeToIndividualTickets(b.ticket_range).forEach(t => draftedSet.add(t)));
    if (!tickets.some(t => draftedSet.has(t))) {
        pendingBatchTickets.push({ date: formatToDBDate(val('sale-date') || getISODateString()), code, name: val('sale-seller-name'), item: val('sale-item'), series: val('sale-series'), ticket_range: range, qty: calc.qty, price_raw: calc.qty * activeSaleSetPrice, mlot_id: currentMlotId });
        $('batch-count').innerText = pendingBatchTickets.length;
    }
}

async function addCurrentEntryToList() {
    const date = formatToDBDate(val('sale-date') || getISODateString()), code = val('sale-seller-code'), item = val('sale-item'), grp = val('sale-group').toUpperCase(), from = val('sale-from');
    if (!code) { alert("Please select Seller Code."); return false; }
    if (!grp || !from) { alert("Provide Group and Ticket number."); return false; }
    const calc = parseRangeQuantity(val('sale-series'), from, val('sale-to'));
    if (calc.error) { alert("Invalid ticket range."); return false; }
    const range = formatTicketRangeString(grp, parseInt(from), calc.actualToVal);
    const entryTickets = expandRangeToIndividualTickets(range);

    // 1. Batch duplicate check
    const batchSet = new Set();
    pendingBatchTickets.filter(b => b.item === item && b.date === date).forEach(b => expandRangeToIndividualTickets(b.ticket_range).forEach(t => batchSet.add(t)));
    if (entryTickets.some(t => batchSet.has(t))) { alert("DUPLICATE ENTRY!\nTicket already in batch list."); return false; }

    // 2. Fetch stock & sold records
    const [pur, sales, unsold] = await Promise.all(['purchase_store', 'sales_records', 'unsold_records'].map(tbl => _supabase.from(tbl).select('*').eq('mlot_id', currentMlotId).eq('item', item).eq('date', date)));
    const availSet = new Set(), soldSet = new Set();
    (pur.data || []).forEach(p => expandRangeToIndividualTickets(p.ticket_range).forEach(t => availSet.add(t)));
    (sales.data || []).forEach(s => expandRangeToIndividualTickets(s.ticket_range).forEach(t => soldSet.add(t)));
    (unsold.data || []).forEach(u => expandRangeToIndividualTickets(u.ticket_range).forEach(t => soldSet.delete(t)));

    // 3. Database sold duplicate check
    const dup = entryTickets.find(t => soldSet.has(t));
    if (dup) { alert(`DUPLICATE ENTRY!\nTicket '${dup}' already sold on ${date}.`); return false; }

    // 4. Stock validation
    const missing = entryTickets.find(t => !availSet.has(t));
    if (missing) { alert(`Stock Error: Ticket '${missing}' is not available in stock.`); return false; }

    pendingBatchTickets.push({ date, code, name: val('sale-seller-name'), item, series: val('sale-series'), ticket_range: range, qty: parseInt(val('sale-qty')), price_raw: parseFloat(val('sale-price').replace('₹', '')), mlot_id: currentMlotId });
    $('batch-count').innerText = pendingBatchTickets.length;
    $('sale-from').value = ''; $('sale-to').value = ''; calculateSalePrice();
    return true;
}

function openShowTicketModal() {
    const tbody = $('ticket-preview-tbody'), tfoot = $('ticket-preview-tfoot');
    let q = 0, p = 0;
    if (!pendingBatchTickets.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="p-4 text-center text-slate-400">No tickets in batch.</td></tr>`;
    } else {
        tbody.innerHTML = pendingBatchTickets.map((t, i) => {
            q += t.qty; p += t.price_raw;
            return `<tr class="border-b border-slate-100"><td class="p-2">${i+1}</td><td class="p-2 font-semibold text-indigo-600">${t.code}</td><td class="p-2">${t.name}</td><td class="p-2">${t.item}</td><td class="p-2 font-bold">${t.series}</td><td class="p-2 font-mono text-[10px]">${t.ticket_range}</td><td class="p-2 text-emerald-600 font-bold">${t.qty}</td><td class="p-2 font-bold">${fmtCurr(t.price_raw)}</td><td class="p-2 text-center"><button onclick="pendingBatchTickets.splice(${i},1);$('batch-count').innerText=pendingBatchTickets.length;openShowTicketModal()" class="text-red-500"><i class="fa-solid fa-trash"></i></button></td></tr>`;
        }).join('');
    }
    tfoot.innerHTML = `<tr><td colspan="6" class="p-2 text-right font-bold">Total:</td><td class="p-2 font-bold text-emerald-600">${q}</td><td colspan="2" class="p-2 font-bold text-indigo-600">${fmtCurr(p)}</td></tr>`;
    toggleModal('show-ticket-modal', true);
}

async function submitTicketEntries() {
    if (!currentMlotId) currentMlotId = localStorage.getItem('currentMlotId');
    if (!pendingBatchTickets.length && val('sale-seller-code') && val('sale-group') && val('sale-from')) {
        if (!await addCurrentEntryToList()) return;
    }
    if (!pendingBatchTickets.length) return alert("No tickets to submit! Add tickets to batch first.");
    const payload = pendingBatchTickets.map(t => ({ ...t, date: formatToDBDate(t.date), qty: parseInt(t.qty), price_raw: parseFloat(t.price_raw), mlot_id: String(currentMlotId) }));
    const { error } = await _supabase.from('sales_records').insert(payload);
    if (error) return alert("Database Error: " + error.message);
    alert("Tickets submitted and saved successfully!");
    pendingBatchTickets = []; $('batch-count').innerText = '0';
    closeShowTicketModal(); switchTab('sale');
}

// ================= UNSOLD TICKETS (WITH RESTRICTIONS) =================
function toggleUnsoldModeUI(tabDet, tabQ, contDet, contQ, mode) {
    $(tabDet).className = `flex-1 py-2 text-xs font-bold rounded-lg ${mode === 'detailed' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600'}`;
    $(tabQ).className = `flex-1 py-2 text-xs font-bold rounded-lg ${mode === 'quick' ? 'bg-orange-600 text-white shadow' : 'text-slate-600'}`;
    $(contDet).classList.toggle('hidden', mode !== 'detailed');
    $(contQ).classList.toggle('hidden', mode !== 'quick');
}
const switchUnsoldMode = m => toggleUnsoldModeUI('unsold-tab-detailed', 'unsold-tab-quick', 'container-unsold-detailed', 'container-unsold-quick', m);
const switchSellerUnsoldMode = m => toggleUnsoldModeUI('s-unsold-tab-detailed', 's-unsold-tab-quick', 's-container-unsold-detailed', 's-container-unsold-quick', m);

function calculateUnsoldPrice() {
    const calc = parseRangeQuantity(val('unsold-series'), val('unsold-from'), val('unsold-to'));
    $('unsold-qty').value = calc.qty || 0;
    $('unsold-price').value = fmtCurr((calc.qty || 0) * activeUnsoldSetPrice);
}

function calculateSellerUnsoldPrice() {
    const calc = parseRangeQuantity(val('s-unsold-series'), val('s-unsold-from'), val('s-unsold-to'));
    $('s-unsold-qty').value = calc.qty || 0;
    $('s-unsold-price').value = fmtCurr((calc.qty || 0) * activeSellerUnsoldSetPrice);
}

async function validateSellerPurchasedTickets(mlotId, code, item, date, rangeStr) {
    const { data } = await _supabase.from('sales_records').select('*').eq('mlot_id', mlotId).eq('code', code).eq('item', item).eq('date', date);
    const boughtSet = new Set();
    (data || []).forEach(s => expandRangeToIndividualTickets(s.ticket_range).forEach(t => boughtSet.add(t)));
    return expandRangeToIndividualTickets(rangeStr).every(t => boughtSet.has(t));
}

function handleUnsoldBlurAutoDraft() {
    const code = val('unsold-seller-code'), grp = val('unsold-group'), from = val('unsold-from'), to = val('unsold-to');
    if (!code || !grp || !from || !to) return;
    const calc = parseRangeQuantity(val('unsold-series'), from, to);
    if (calc.error) return;
    const range = formatTicketRangeString(grp.toUpperCase(), parseInt(from), calc.actualToVal);
    const date = formatToDBDate(val('unsold-date') || getISODateString());
    if (!pendingUnsoldBatch.some(u => u.code === code && u.item === val('unsold-item') && u.series === val('unsold-series') && u.ticket_range === range)) {
        pendingUnsoldBatch.push({ date, code, name: val('unsold-seller-name'), item: val('unsold-item'), series: val('unsold-series'), ticket_range: range, qty: calc.qty, price_raw: calc.qty * activeUnsoldSetPrice, mlot_id: currentMlotId });
        $('unsold-batch-count').innerText = pendingUnsoldBatch.length;
    }
}

function addUnsoldEntryToBatch() {
    const date = formatToDBDate(val('unsold-date') || getISODateString()), code = val('unsold-seller-code'), grp = val('unsold-group').toUpperCase(), from = val('unsold-from');
    if (!code || !grp || !from) return alert("Provide Code, Group, and From number.");
    const calc = parseRangeQuantity(val('unsold-series'), from, val('unsold-to'));
    if (calc.error) return alert("Invalid range.");
    const range = formatTicketRangeString(grp, parseInt(from), calc.actualToVal);
    if (pendingUnsoldBatch.some(u => u.code === code && u.item === val('unsold-item') && u.date === date && u.ticket_range === range)) {
        return alert("DUPLICATE ENTRY!\nUnsold ticket already in batch.");
    }
    pendingUnsoldBatch.push({ date, code, name: val('unsold-seller-name'), item: val('unsold-item'), series: val('unsold-series'), ticket_range: range, qty: calc.qty, price_raw: calc.qty * activeUnsoldSetPrice, mlot_id: currentMlotId });
    $('unsold-batch-count').innerText = pendingUnsoldBatch.length;
    $('unsold-from').value = ''; $('unsold-to').value = ''; calculateUnsoldPrice();
}

async function submitUnsoldDetailed(e) {
    e.preventDefault();
    if (!pendingUnsoldBatch.length) { handleUnsoldBlurAutoDraft(); if (!pendingUnsoldBatch.length) return alert("No unsold entries added."); }
    for (const entry of pendingUnsoldBatch) {
        if (!await validateSellerPurchasedTickets(currentMlotId, entry.code, entry.item, entry.date, entry.ticket_range)) {
            return alert(`Prohibited! Range ${entry.ticket_range} for seller ${entry.code} was not purchased from MLOT user.`);
        }
    }
    const payload = pendingUnsoldBatch.map(u => ({ ...u, date: formatToDBDate(u.date), qty: parseInt(u.qty), price_raw: parseFloat(u.price_raw), mlot_id: String(currentMlotId) }));
    const { error } = await _supabase.from('unsold_records').insert(payload);
    if (error) return alert("Error: " + error.message);
    alert("Unsold entries saved successfully!");
    pendingUnsoldBatch = []; $('unsold-batch-count').innerText = '0';
    $('form-unsold-detailed').reset(); $('unsold-date').value = getISODateString();
}

async function submitUnsoldQuickEntry(e) {
    e.preventDefault();
    const code = val('unsold-q-seller-code'), qty = parseInt(val('unsold-q-qty')) || 0;
    if (!code || qty <= 0) return alert("Select seller code and valid quantity.");
    const { error } = await _supabase.from('pending_unsold').insert([{
        date: formatToDBDate(val('unsold-q-date') || getISODateString()), code, name: val('unsold-q-seller-name'), item: val('unsold-q-item'),
        series: 'QUICK', ticket_range: `Quick Qty: ${qty}`, qty, price_raw: qty * activeUnsoldSetPrice, is_quick: true, mlot_id: String(currentMlotId)
    }]);
    if (error) return alert("Error: " + error.message);
    alert("Quick unsold request submitted!");
    $('form-unsold-quick').reset(); $('unsold-q-date').value = getISODateString(); updatePendingUnsoldBadge();
}

async function submitSellerUnsold(e) {
    e.preventDefault();
    const grp = val('s-unsold-group').toUpperCase(), from = val('s-unsold-from'), date = formatToDBDate(val('s-unsold-date') || getISODateString());
    const calc = parseRangeQuantity(val('s-unsold-series'), from, val('s-unsold-to'));
    if (calc.error) return alert("Invalid range.");
    const range = formatTicketRangeString(grp, parseInt(from), calc.actualToVal);
    if (!await validateSellerPurchasedTickets(currentMlotId, currentSellerCode, val('s-unsold-item'), date, range)) {
        return alert("Prohibited! You can only return tickets purchased from your MLOT user.");
    }
    const { data } = await _supabase.from('sellers').select('name').eq('mlot_id', currentMlotId).eq('code', currentSellerCode).single();
    await _supabase.from('pending_unsold').insert([{
        date, code: currentSellerCode, name: data?.name || currentSellerCode, item: val('s-unsold-item'),
        series: val('s-unsold-series'), ticket_range: range, qty: calc.qty, price_raw: calc.qty * activeSellerUnsoldSetPrice, mlot_id: currentMlotId
    }]);
    alert("Unsold tickets sent for verification!");
    $('form-seller-unsold').reset(); $('s-unsold-date').value = getISODateString();
    updatePendingUnsoldBadge(); openSellerAccountHome();
}

async function submitSellerUnsoldQuickEntry(e) {
    e.preventDefault();
    const qty = parseInt(val('s-unsold-q-qty')) || 0;
    if (qty <= 0) return alert("Enter valid quantity.");
    const { data } = await _supabase.from('sellers').select('name').eq('mlot_id', currentMlotId).eq('code', currentSellerCode).single();
    await _supabase.from('pending_unsold').insert([{
        date: formatToDBDate(val('s-unsold-q-date') || getISODateString()), code: currentSellerCode, name: data?.name || currentSellerCode,
        item: val('s-unsold-q-item'), series: 'QUICK', ticket_range: `Quick Qty: ${qty}`, qty, price_raw: qty * activeSellerUnsoldSetPrice, is_quick: true, mlot_id: currentMlotId
    }]);
    alert("Quick unsold request sent to MLOT user!");
    $('form-seller-unsold-quick').reset(); $('s-unsold-q-date').value = getISODateString(); openSellerAccountHome();
}

// --- MASTER DIRECTORY, CARDS & REPORTS ---
function openAddSellerPage() { openSubPage('page-add-seller'); $('seller-userid').value = currentMlotId || ''; calculateAddSellerPrice(); }
function calculateAddSellerPrice() {
    const total = (parseFloat(val('seller-qty')) || 1) * (parseFloat(val('seller-set-price')) || 0);
    $('calculated-total-display').innerText = fmtCurr(total);
    return total;
}
function previewSeller(e) {
    e.preventDefault();
    tempSellerData = { name: val('seller-name'), code: val('seller-code'), mob: val('seller-mob'), area: val('seller-area'), userid: val('seller-userid'), previousDue: (parseFloat(val('seller-prev-due')) || 0).toFixed(2), setPrice: (parseFloat(val('seller-set-price')) || 0).toFixed(2), totalPrice: calculateAddSellerPrice() };
    Object.keys(tempSellerData).forEach(k => { if ($(`v-${k.toLowerCase()}`)) $(`v-${k.toLowerCase()}`).innerText = tempSellerData[k]; });
    $('v-prevdue').innerText = fmtCurr(tempSellerData.previousDue); $('v-setprice').innerText = `₹${tempSellerData.setPrice} per item`; $('v-price').innerText = fmtCurr(tempSellerData.totalPrice);
    toggleModal('verify-modal', true);
}
const closeModal = () => toggleModal('verify-modal', false);
async function finalSubmitSeller() {
    closeModal();
    const { error } = await _supabase.from('sellers').insert([{ code: tempSellerData.code, name: tempSellerData.name, phone: tempSellerData.mob, area: tempSellerData.area, set_price: parseFloat(tempSellerData.setPrice), previous_due: parseFloat(tempSellerData.previousDue), today_payment: 0.00, date_payments: {}, mlot_id: currentMlotId }]);
    if (error) alert("Error: " + error.message);
    else { alert("Seller created successfully!"); $('form-add-seller').reset(); switchTab('sale'); }
}

async function renderMasterAndSaleTables() {
    const filter = formatToDBDate(val('sale-page-filter-date') || getISODateString()), today = formatToDBDate(getISODateString());
    const [sel, sales, unsold] = await Promise.all(['sellers', 'sales_records', 'unsold_records'].map(t => _supabase.from(t).select('*').eq('mlot_id', currentMlotId)));
    const mList = $('master-seller-list'), sBody = $('sale-table-body');
    if (mList) mList.innerHTML = ''; if (sBody) sBody.innerHTML = '';
    if (!sel.data?.length) {
        if (mList) mList.innerHTML = `<div class="p-4 bg-white rounded-2xl text-center text-xs text-slate-400">No sellers registered.</div>`;
        if (sBody) sBody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-slate-400">No records.</td></tr>`;
        return;
    }
    sel.data.forEach((s, idx) => {
        const sl = String(idx + 1).padStart(2, '0');
        const sS = (sales.data || []).filter(t => t.code === s.code), sU = (unsold.data || []).filter(t => t.code === s.code);
        const tDue = sS.filter(t => t.date === today).reduce((a, c) => a + c.price_raw, 0) - sU.filter(t => t.date === today).reduce((a, c) => a + c.price_raw, 0);
        const bal = (s.previous_due || 0) + tDue - (s.today_payment || 0);
        if (mList) {
            mList.innerHTML += `<div class="bg-white p-3 rounded-2xl shadow-sm border border-slate-200 flex items-center justify-between"><div class="flex items-center space-x-3 cursor-pointer" onclick="openSellerDetailModal('${s.code}')"><div class="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs">${sl}</div><div><h4 class="text-xs font-bold text-slate-800">${s.name} <span class="text-[10px] text-indigo-600 font-normal">#${s.code}</span></h4><p class="text-[10px] text-slate-500">Total Balance: <span class="font-bold text-red-600">${fmtCurr(bal)}</span></p></div></div><div class="flex items-center space-x-2"><a href="tel:${s.phone || ''}" class="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xs"><i class="fa-solid fa-phone"></i></a><a href="https://wa.me/${s.phone || ''}" target="_blank" class="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center text-xs"><i class="fa-brands fa-whatsapp"></i></a></div></div>`;
        }
        if (sBody) {
            const dS = sS.filter(t => t.date === filter), dU = sU.filter(t => t.date === filter);
            const pQ = dS.reduce((a, c) => a + c.qty, 0), uQ = dU.reduce((a, c) => a + c.qty, 0);
            sBody.innerHTML += `<tr class="hover:bg-slate-50 border-b border-slate-100"><td class="p-3 text-slate-400">${sl}</td><td class="p-3 font-semibold text-indigo-600">${s.code}</td><td class="p-3 font-bold text-slate-800">${s.name}</td><td class="p-3 text-purple-600 font-bold">${pQ}</td><td class="p-3 text-emerald-600 font-bold">${pQ - uQ}</td><td class="p-3 text-amber-600 font-bold">${uQ}</td><td class="p-3 font-bold text-slate-800">${fmtCurr(dS.reduce((a, c) => a + c.price_raw, 0) - dU.reduce((a, c) => a + c.price_raw, 0))}</td><td class="p-3 font-extrabold text-red-600">${fmtCurr(bal)}</td></tr>`;
        }
    });
}

async function openSellerDetailModal(code) { currentlyViewingSellerCode = code; isEditingSeller = false; renderSellerDetailModalContent(); toggleModal('seller-detail-modal', true); }
const closeSellerDetailModal = () => { isEditingSeller = false; toggleModal('seller-detail-modal', false); };

async function renderSellerDetailModalContent() {
    const { data: s } = await _supabase.from('sellers').select('*').eq('mlot_id', currentMlotId).eq('code', currentlyViewingSellerCode).single();
    if (!s) return;
    const [sales, unsold] = await Promise.all(['sales_records', 'unsold_records'].map(t => _supabase.from(t).select('*').eq('mlot_id', currentMlotId).eq('code', currentlyViewingSellerCode)));
    const today = formatToDBDate(getISODateString());
    const bal = (s.previous_due || 0) + ((sales.data || []).filter(t => t.date === today).reduce((a, c) => a + c.price_raw, 0) - (unsold.data || []).filter(t => t.date === today).reduce((a, c) => a + c.price_raw, 0)) - (s.today_payment || 0);
    const div = $('seller-detail-content'), btn = $('seller-detail-edit-btn');
    btn.innerText = isEditingSeller ? "Save Changes" : "Edit Details";
    div.innerHTML = isEditingSeller
        ? `<div class="space-y-2"><div><label class="text-[10px] font-bold">Name</label><input type="text" id="edit-s-name" value="${s.name}" class="w-full px-2 py-1.5 border rounded text-xs"></div><div><label class="text-[10px] font-bold">Mobile</label><input type="tel" id="edit-s-mob" value="${s.phone || ''}" class="w-full px-2 py-1.5 border rounded text-xs"></div><div><label class="text-[10px] font-bold">Area</label><input type="text" id="edit-s-area" value="${s.area || ''}" class="w-full px-2 py-1.5 border rounded text-xs"></div></div>`
        : `<div class="flex justify-between"><span class="text-slate-500">Code:</span> <span class="font-bold text-indigo-600">${currentlyViewingSellerCode}</span></div><div class="flex justify-between"><span class="text-slate-500">Name:</span> <span class="font-bold text-slate-800">${s.name}</span></div><div class="flex justify-between"><span class="text-slate-500">Balance:</span> <span class="font-extrabold text-red-600">${fmtCurr(bal)}</span></div><div class="flex justify-between"><span class="text-slate-500">Mobile:</span> <span class="font-bold text-slate-800">${s.phone || 'N/A'}</span></div><div class="flex justify-between"><span class="text-slate-500">Area:</span> <span class="font-bold text-slate-800">${s.area || 'N/A'}</span></div>`;
}

async function toggleEditSellerMode() {
    if (!isEditingSeller) { isEditingSeller = true; renderSellerDetailModalContent(); }
    else {
        await _supabase.from('sellers').update({ name: val('edit-s-name'), phone: val('edit-s-mob'), area: val('edit-s-area') }).eq('mlot_id', currentMlotId).eq('code', currentlyViewingSellerCode);
        isEditingSeller = false; alert("Updated!"); renderSellerDetailModalContent(); renderMasterAndSaleTables();
    }
}

// --- SALE REPORT MODAL & PDF / WHATSAPP EXPORT ---
async function openSaleReportModal() {
    const today = getISODateString();
    $('report-from-date').value = today; $('report-to-date').value = today;
    const { data } = await _supabase.from('sellers').select('code, name').eq('mlot_id', currentMlotId);
    $('report-filter-seller').innerHTML = '<option value="">All Sellers (General Report)</option>' + (data || []).map(s => `<option value="${s.code}">${s.code} - ${s.name}</option>`).join('');
    filterSaleReport(); toggleModal('sale-report-modal', true);
}
const closeSaleReportModal = () => toggleModal('sale-report-modal', false);

async function filterSaleReport() {
    const fComp = convertDateToComparable(val('report-from-date')), toComp = convertDateToComparable(val('report-to-date')), selCode = val('report-filter-seller');
    const { data } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId);
    const tbody = $('report-table-tbody'), tfoot = $('report-table-tfoot');
    const filtered = (data || []).filter(t => {
        const c = convertDateToComparable(t.date);
        return c >= fComp && c <= toComp && (!selCode || t.code === selCode);
    });
    let q = 0, p = 0;
    tbody.innerHTML = filtered.length ? filtered.map(t => {
        q += t.qty; p += t.price_raw;
        return `<tr class="border-b border-slate-100"><td class="p-2 text-[10px]">${t.date}</td><td class="p-2 font-semibold text-indigo-600">${t.code}</td><td class="p-2">${t.name}</td><td class="p-2">${t.item}</td><td class="p-2 font-bold">${t.series}</td><td class="p-2 font-mono text-[10px]">${t.ticket_range}</td><td class="p-2 text-emerald-600 font-bold">${t.qty}</td><td class="p-2 font-bold">${fmtCurr(t.price_raw)}</td></tr>`;
    }).join('') : `<tr><td colspan="8" class="p-4 text-center text-slate-400">No records.</td></tr>`;
    tfoot.innerHTML = `<tr><td colspan="6" class="p-2 text-right font-bold">Total:</td><td class="p-2 font-bold text-emerald-600">${q}</td><td colspan="2" class="p-2 font-bold text-indigo-600">${fmtCurr(p)}</td></tr>`;
}

async function generateSaleReportPDFDoc() {
    const { jsPDF } = window.jspdf, doc = new jsPDF();
    const f = val('report-from-date') || getISODateString(), to = val('report-to-date') || getISODateString(), code = val('report-filter-seller');
    const [mlot, sData] = await Promise.all([
        _supabase.from('mlot_users').select('*').eq('mlot_id', currentMlotId).maybeSingle(),
        code ? _supabase.from('sellers').select('*').eq('mlot_id', currentMlotId).eq('code', code).maybeSingle() : Promise.resolve({ data: null })
    ]);
    const sName = sData.data?.name || "", sPhone = sData.data?.phone || mlot.data?.mobile || "";
    doc.setFontSize(9); doc.text(`Generated Date: ${formatToDBDate(getISODateString())}`, 14, 15);
    doc.setFontSize(13); doc.text(code ? `Seller Name: ${sName} (${code})` : `${mlot.data?.business_name || 'MLOT'} - Sale Report`, 105, 15, { align: 'center' });
    doc.setFontSize(9); if (sPhone) doc.text(`Contact: ${sPhone}`, 105, 21, { align: 'center' });
    doc.text(`Report Period: ${formatToDBDate(f)} to ${formatToDBDate(to)}`, 14, 27);

    const { data } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId);
    const fComp = convertDateToComparable(f), toComp = convertDateToComparable(to);
    const filtered = (data || []).filter(t => { const c = convertDateToComparable(t.date); return c >= fComp && c <= toComp && (!code || t.code === code); });

    let totalQ = 0, totalP = 0;
    const rows = filtered.map((t, idx) => {
        totalQ += t.qty; totalP += t.price_raw;
        return [idx + 1, t.date, t.code, t.name, t.item, t.series, t.ticket_range, t.qty, fmtCurr(t.price_raw)];
    });
    doc.autoTable({
        startY: 32, head: [['Sl', 'Date', 'Code', 'Name', 'Item', 'Series', 'Range', 'Qty', 'Price']],
        body: rows, foot: [['', '', '', '', '', '', 'Total:', totalQ, fmtCurr(totalP)]],
        theme: 'grid', headStyles: { fillColor: [79, 70, 229], fontStyle: 'bold' }, styles: { fontSize: 8, cellPadding: 2 }
    });
    return { doc, code, sName, sPhone };
}

const downloadSaleReportPDF = async () => { const rep = await generateSaleReportPDFDoc(); openPDFDirectly(rep.doc, rep.code ? `SaleReport_${rep.code}.pdf` : `SaleReport_General.pdf`); };

async function sendSaleReportToWhatsApp() {
    const rep = await generateSaleReportPDFDoc();
    if (!rep.code) return alert("Please select a specific Seller Code!");
    if (!rep.sPhone) return alert(`No phone found for seller ${rep.code}.`);
    try {
        const base64 = rep.doc.output('datauristring').split(',')[1];
        if (window.AndroidBridge?.sharePDFToWhatsApp) {
            window.AndroidBridge.sharePDFToWhatsApp(base64, `SaleReport_${rep.code}.pdf`, rep.sPhone);
        } else {
            const clean = rep.sPhone.replace(/[^0-9]/g, '');
            window.open(`https://wa.me/${clean.length === 10 ? '91' + clean : clean}?text=Hello%20${encodeURIComponent(rep.sName)},%20please%20find%20your%20Sale%20Report.`, '_blank');
        }
    } catch (e) { alert("WhatsApp share error: " + e.message); }
}

// --- SUMMARY GRIDS & VERIFICATIONS ---
async function renderSellerCards(table, dateInputId, gridId, onClickFn) {
    const date = formatToDBDate(val(dateInputId));
    let q = _supabase.from(table).select('*').eq('mlot_id', currentMlotId);
    if (date) q = q.eq('date', date);
    const { data } = await q, grid = $(gridId); grid.innerHTML = '';
    if (!data?.length) return grid.innerHTML = `<div class="col-span-3 text-center p-4 text-xs text-slate-400">No records found.</div>`;
    const sum = {};
    data.forEach(s => {
        sum[s.code] = sum[s.code] || { name: s.name, qty: 0, amt: 0 };
        sum[s.code].qty += s.qty; sum[s.code].amt += s.price_raw;
    });
    grid.innerHTML = Object.keys(sum).map(c => `<div class="bg-emerald-50 p-2.5 rounded-xl border border-emerald-100 flex flex-col items-center text-center shadow-sm cursor-pointer" onclick="${onClickFn}('${c}','${date}')"><span class="text-[10px] font-bold text-emerald-700">${c}</span><span class="text-[9px] text-slate-500 truncate w-full">${sum[c].name}</span><span class="text-xs font-extrabold text-slate-800 mt-1">${sum[c].qty}</span><span class="text-[9px] font-bold text-emerald-600 mt-0.5">${fmtCurr(sum[c].amt)}</span></div>`).join('');
}
const openSoldTicketPage = () => { openSubPage('page-sold-ticket'); $('sold-filter-date').value = getISODateString(); renderSoldTicketSellers(); };
const renderSoldTicketSellers = () => renderSellerCards('sales_records', 'sold-filter-date', 'sold-sellers-grid', 'openSellerSoldDetail');
const openShowAllUnsoldModal = () => { $('unsold-tracker-filter-date').value = getISODateString(); renderAllUnsoldGrid(); toggleModal('show-all-unsold-modal', true); };
const closeShowAllUnsoldModal = () => toggleModal('show-all-unsold-modal', false);
const renderAllUnsoldGrid = () => renderSellerCards('unsold_records', 'unsold-tracker-filter-date', 'unsold-sellers-grid', 'openSellerUnsoldDetail');

async function openTicketDetailModal(table, code, date, modalId, titleId, tbodyId, tfootId, isSold) {
    let q = _supabase.from(table).select('*').eq('mlot_id', currentMlotId).eq('code', code);
    if (date) q = q.eq('date', date);
    const { data } = await q;
    $(titleId).innerText = `${isSold ? 'Sold' : 'Unsold'} Detail: ${code}`;
    let totQ = 0, totP = 0;
    $(tbodyId).innerHTML = (data || []).map((t, i) => {
        totQ += t.qty; totP += t.price_raw;
        return `<tr class="border-b border-slate-100"><td class="p-2">${i+1}</td><td class="p-2">${t.item}</td><td class="p-2 font-bold">${t.series}</td><td class="p-2 font-mono text-[10px]">${t.ticket_range}</td><td class="p-2 ${isSold ? 'text-emerald-600' : 'text-amber-600'} font-bold">${t.qty}</td><td class="p-2 font-bold">${fmtCurr(t.price_raw)}</td></tr>`;
    }).join('');
    $(tfootId).innerHTML = `<tr><td colspan="4" class="p-2 text-right font-bold">Total:</td><td class="p-2 font-bold ${isSold ? 'text-emerald-600' : 'text-amber-600'}">${totQ}</td><td class="p-2 font-bold text-indigo-600">${fmtCurr(totP)}</td></tr>`;
    toggleModal(modalId, true);
}
const openSellerSoldDetail = (c, d) => openTicketDetailModal('sales_records', c, d, 'seller-sold-detail-modal', 'detail-modal-title', 'seller-detail-tbody', 'seller-detail-tfoot', true);
const closeSellerSoldDetail = () => toggleModal('seller-sold-detail-modal', false);
const openSellerUnsoldDetail = (c, d) => openTicketDetailModal('unsold_records', c, d, 'seller-unsold-detail-modal', 'unsold-detail-modal-title', 'seller-unsold-detail-tbody', 'seller-unsold-detail-tfoot', false);
const closeSellerUnsoldDetail = () => toggleModal('seller-unsold-detail-modal', false);

async function updatePendingUnsoldBadge() {
    const { count } = await _supabase.from('pending_unsold').select('*', { count: 'exact', head: true }).eq('mlot_id', currentMlotId);
    if ($('pending-unsold-badge')) $('pending-unsold-badge').innerText = count || 0;
}
async function openVerifyUnsoldModal() {
    const { data } = await _supabase.from('pending_unsold').select('*').eq('mlot_id', currentMlotId);
    const box = $('verify-unsold-list'); box.innerHTML = '';
    if (!data?.length) box.innerHTML = `<div class="p-4 text-center text-xs text-slate-400">No pending unsold tickets.</div>`;
    else box.innerHTML = data.map(item => `<div class="bg-slate-50 p-3 rounded-xl border border-slate-200 flex justify-between items-center text-xs"><div><span class="font-bold text-indigo-600">${item.code} (${item.name})</span><p class="text-[10px] text-slate-500">${item.date} | ${item.item} | ${item.series} | ${item.ticket_range}</p><p class="text-[10px] font-bold text-amber-600">Qty: ${item.qty} | Amt: ${fmtCurr(item.price_raw)}</p></div><div class="flex gap-1"><button onclick="verifySingleUnsold('${item.id}')" class="px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg font-bold text-[10px]">Verify</button><button onclick="rejectSingleUnsold('${item.id}')" class="px-2.5 py-1.5 bg-red-600 text-white rounded-lg font-bold text-[10px]">Reject</button></div></div>`).join('');
    toggleModal('verify-unsold-modal', true);
}
const closeVerifyUnsoldModal = () => toggleModal('verify-unsold-modal', false);
async function verifySingleUnsold(id) {
    const { data: item } = await _supabase.from('pending_unsold').select('*').eq('id', id).single();
    if (!item) return;
    await _supabase.from('unsold_records').insert([{ date: item.date, code: item.code, name: item.name, item: item.item, series: item.series, ticket_range: item.ticket_range, qty: item.qty, price_raw: item.price_raw, mlot_id: item.mlot_id }]);
    if (item.is_quick) {
        const { data: s } = await _supabase.from('sellers').select('*').eq('mlot_id', currentMlotId).eq('code', item.code).single();
        if (s) await _supabase.from('sellers').update({ today_payment: (s.today_payment || 0) + (item.price_raw || 0) }).eq('mlot_id', currentMlotId).eq('code', item.code);
    }
    await _supabase.from('pending_unsold').delete().eq('id', id);
    alert("Unsold verified!"); updatePendingUnsoldBadge(); openVerifyUnsoldModal(); renderMasterAndSaleTables();
}
async function rejectSingleUnsold(id) {
    if (!confirm("Reject this unsold ticket?")) return;
    await _supabase.from('pending_unsold').delete().eq('id', id);
    alert("Rejected!"); updatePendingUnsoldBadge(); openVerifyUnsoldModal();
}

// --- PAYMENTS & LEDGER ---
const openPaymentHistoryPage = () => { openSubPage('page-payment-history'); renderMlotPaymentHistoryTable(); };
async function renderMlotPaymentHistoryTable() {
    const { data } = await _supabase.from('payments').select('*').eq('mlot_id', currentMlotId);
    const tbody = $('mlot-payment-history-tbody');
    tbody.innerHTML = (data || []).map(p => `<tr class="border-b border-slate-100"><td class="p-2.5 text-[10px] text-slate-500">${p.date}</td><td class="p-2.5 font-semibold text-indigo-600">${p.code}</td><td class="p-2.5 font-bold">${fmtCurr(p.total_due)}</td><td class="p-2.5 font-bold text-emerald-600">${fmtCurr(p.paid_amount)}</td><td class="p-2.5 text-center">${p.screenshot ? `<button onclick="viewScreenshot('${p.screenshot}')" class="text-indigo-600 underline font-bold">View</button>` : 'No Image'}</td><td class="p-2.5 text-center">${p.status === 'Pending' ? `<button onclick="approvePayment('${p.id}','${p.code}',${p.paid_amount},'${p.date}')" class="px-2 py-1 bg-emerald-600 text-white rounded text-[10px] mr-1">Approve</button><button onclick="rejectPayment('${p.id}')" class="px-2 py-1 bg-red-600 text-white rounded text-[10px]">Reject</button>` : `<span class="text-[10px] font-bold px-2 py-0.5 rounded ${p.status === 'Approved' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}">${p.status}</span>`}</td></tr>`).join('') || `<tr><td colspan="6" class="p-4 text-center text-slate-400">No records.</td></tr>`;
}
const viewScreenshot = url => { $('screenshot-img-preview').src = url; toggleModal('view-screenshot-modal', true); };
const closeScreenshotModal = () => toggleModal('view-screenshot-modal', false);
async function approvePayment(id, code, amt, date) {
    await _supabase.from('payments').update({ status: 'Approved' }).eq('id', id);
    const { data: s } = await _supabase.from('sellers').select('*').eq('mlot_id', currentMlotId).eq('code', code).single();
    if (s) {
        const dp = s.date_payments || {}; dp[date] = (dp[date] || 0) + amt;
        await _supabase.from('sellers').update({ today_payment: date === formatToDBDate(getISODateString()) ? (s.today_payment || 0) + amt : s.today_payment, date_payments: dp }).eq('mlot_id', currentMlotId).eq('code', code);
    }
    alert("Approved!"); renderMlotPaymentHistoryTable(); renderMasterAndSaleTables();
}
async function rejectPayment(id) { await _supabase.from('payments').update({ status: 'Rejected' }).eq('id', id); alert("Rejected."); renderMlotPaymentHistoryTable(); }

const openMlotPurchaseTicketPage = () => { openSubPage('page-mlot-purchase-ticket'); if (!val('mlot-purchase-filter-date')) $('mlot-purchase-filter-date').value = getISODateString(); renderMlotPurchaseTicketTable(); };
async function renderMlotPurchaseTicketTable() {
    const d = formatToDBDate(val('mlot-purchase-filter-date') || getISODateString());
    const { data } = await _supabase.from('purchase_store').select('*').eq('mlot_id', currentMlotId).eq('date', d);
    $('mlot-purchase-ticket-tbody').innerHTML = (data || []).map(p => `<tr class="border-b border-slate-100"><td class="p-3 text-[10px] text-slate-500">${p.date}</td><td class="p-3">${p.item}</td><td class="p-3 font-bold">${p.series}</td><td class="p-3 font-mono text-[10px]">${p.ticket_range}</td><td class="p-3 text-purple-600 font-bold">${p.qty}</td><td class="p-3 font-bold">${fmtCurr(p.cost_raw)}</td></tr>`).join('') || `<tr><td colspan="6" class="p-4 text-center text-slate-400">No records found.</td></tr>`;
}

// --- LEDGER BOOK ---
const openLedgerBookPage = () => { openSubPage('page-ledger-book'); $('ledger-filter-date').value = getISODateString(); renderLedgerBookTable(); };
async function renderLedgerBookTable() {
    const dFilter = formatToDBDate(val('ledger-filter-date') || getISODateString());
    const [sel, sales, unsold] = await Promise.all(['sellers', 'sales_records', 'unsold_records'].map(t => _supabase.from(t).select('*').eq('mlot_id', currentMlotId)));
    const tbody = $('ledger-table-tbody'), tfoot = $('ledger-table-tfoot');
    let pSum = 0, tSum = 0, paySum = 0, bSum = 0;
    if (!sel.data?.length) { tbody.innerHTML = `<tr><td colspan="9" class="p-4 text-center text-slate-400">No records.</td></tr>`; tfoot.innerHTML = ''; return; }
    tbody.innerHTML = sel.data.map((s, idx) => {
        const prev = s.previous_due || 0, pay = (s.date_payments || {})[dFilter] || 0;
        const dayDue = (sales.data || []).filter(t => t.code === s.code && t.date === dFilter).reduce((a, c) => a + c.price_raw, 0) - (unsold.data || []).filter(t => t.code === s.code && t.date === dFilter).reduce((a, c) => a + c.price_raw, 0);
        const bal = prev + dayDue - pay;
        pSum += prev; tSum += dayDue; paySum += pay; bSum += bal;
        return `<tr class="border-b border-slate-100"><td class="p-2 border">${String(idx+1).padStart(2,'0')}</td><td class="p-2 border text-[10px] text-slate-500">${dFilter}</td><td class="p-2 border font-semibold text-indigo-600">${s.code}</td><td class="p-2 border font-bold">${s.name}</td><td class="p-2 border font-bold text-red-600">${fmtCurr(prev)}</td><td class="p-2 border font-bold text-slate-800">${fmtCurr(dayDue)}</td><td class="p-2 border"><input type="number" step="0.01" id="pay-input-${s.code}" value="${pay.toFixed(2)}" disabled onclick="if(this.value==='0.00'||this.value==='0')this.value='';" class="w-16 px-1 py-1 bg-slate-100 border rounded text-xs font-bold text-emerald-600 text-center"></td><td class="p-2 border font-extrabold text-indigo-600">${fmtCurr(bal)}</td><td class="p-2 border text-center"><button id="btn-edit-${s.code}" onclick="enableLedgerEdit('${s.code}')" class="px-2 py-1 bg-indigo-600 text-white rounded font-bold text-[10px]">Update</button></td></tr>`;
    }).join('');
    tfoot.innerHTML = `<tr><td colspan="4" class="p-2 border text-right font-bold">Total:</td><td class="p-2 border font-bold text-red-600">${fmtCurr(pSum)}</td><td class="p-2 border font-bold text-slate-800">${fmtCurr(tSum)}</td><td class="p-2 border font-bold text-emerald-600">${fmtCurr(paySum)}</td><td colspan="2" class="p-2 border font-bold text-indigo-600">${fmtCurr(bSum)}</td></tr>`;
}

async function enableLedgerEdit(code) {
    const input = $(`pay-input-${code}`), btn = $(`btn-edit-${code}`), dFilter = formatToDBDate(val('ledger-filter-date') || getISODateString());
    if (btn.innerText === "Update") {
        input.disabled = false; input.className = "w-16 px-1 py-1 bg-white border border-indigo-400 rounded text-xs font-bold text-emerald-600 text-center ring-2 ring-indigo-100"; input.focus();
        btn.innerText = "Save"; btn.className = "px-2 py-1 bg-emerald-600 text-white rounded font-bold text-[10px]";
    } else {
        const valAmt = parseFloat(input.value) || 0;
        const { data } = await _supabase.from('sellers').select('date_payments, today_payment').eq('mlot_id', currentMlotId).eq('code', code).single();
        const dp = data?.date_payments || {}; dp[dFilter] = valAmt;
        await _supabase.from('sellers').update({ date_payments: dp, today_payment: dFilter === formatToDBDate(getISODateString()) ? valAmt : data.today_payment }).eq('mlot_id', currentMlotId).eq('code', code);
        input.disabled = true; input.className = "w-16 px-1 py-1 bg-slate-100 border rounded text-xs font-bold text-emerald-600 text-center";
        btn.innerText = "Update"; btn.className = "px-2.5 py-1 bg-indigo-600 text-white rounded-lg font-bold text-[10px]";
        alert("Payment updated!"); renderLedgerBookTable();
    }
}

async function generateLedgerPDFObj() {
    const { jsPDF } = window.jspdf, doc = new jsPDF(), dFilter = formatToDBDate(val('ledger-filter-date') || getISODateString());
    const { data: mlot } = await _supabase.from('mlot_users').select('*').eq('mlot_id', currentMlotId).maybeSingle();
    doc.setFontSize(10); doc.text(`Generated Date: ${formatToDBDate(getISODateString())}`, 14, 15);
    doc.setFontSize(14); doc.text(`${mlot?.business_name || 'MLOT'} (${currentMlotId})`, 105, 15, { align: 'center' });
    doc.setFontSize(10); if (mlot?.mobile) doc.text(`Contact: ${mlot.mobile}`, 105, 21, { align: 'center' });
    doc.text(`Ledger Summary Date: ${dFilter}`, 14, 27);
    let pSum = 0, tSum = 0, paySum = 0, bSum = 0, rows = [];
    document.querySelectorAll('#ledger-table-tbody tr').forEach(r => {
        const c = r.querySelectorAll('td');
        if (c.length >= 8) {
            pSum += parseFloat(c[4].innerText.replace('₹', '')) || 0; tSum += parseFloat(c[5].innerText.replace('₹', '')) || 0;
            paySum += parseFloat(c[6].querySelector('input').value) || 0; bSum += parseFloat(c[7].innerText.replace('₹', '')) || 0;
            rows.push([c[0].innerText, c[1].innerText, c[2].innerText, c[3].innerText, c[4].innerText, c[5].innerText, fmtCurr(c[6].querySelector('input').value), c[7].innerText]);
        }
    });
    doc.autoTable({ startY: 32, head: [['Sl', 'Date', 'Code', 'Name', 'Total Due', 'Today Due', 'Payment', 'Balance']], body: rows, foot: [['', '', '', 'Total:', fmtCurr(pSum), fmtCurr(tSum), fmtCurr(paySum), fmtCurr(bSum)]], theme: 'grid', headStyles: { fillColor: [79, 70, 229] }, styles: { fontSize: 8, cellPadding: 2 } });
    return doc;
}
const downloadOrOpenLedgerReport = async () => { const doc = await generateLedgerPDFObj(); openPDFDirectly(doc, `Ledger_Report_${formatToDBDate(val('ledger-filter-date')).replace(/\//g, '-')}.pdf`); };

// --- SELLER PORTAL PAGES ---
function openSellerAccountHome() {
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    $('page-seller-account').classList.remove('hidden');
    _supabase.from('sellers').select('name').eq('mlot_id', currentMlotId).eq('code', currentSellerCode).single().then(({ data }) => {
        $('seller-portal-banner-name').innerText = `Welcome, ${data?.name || "Seller"} (${currentSellerCode})`;
    });
}

function openSellerPage(page) {
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    if (page === 'purchase') { openSubPage('page-seller-purchase'); $('seller-stock-filter-date').value = getISODateString(); renderSellerAvailableStockIndividual(); }
    else if (page === 'unsold') { openSubPage('page-seller-unsold'); $('s-unsold-date').value = getISODateString(); $('s-unsold-q-date').value = getISODateString(); switchSellerUnsoldMode('detailed'); }
    else if (page === 'sold') { openSubPage('page-seller-sold'); renderSellerSoldTable(); }
    else if (page === 'history') { openSubPage('page-seller-history'); renderSellerPaymentHistory(); }
    else if (page === 'ledger') { openSubPage('page-seller-ledger'); $('seller-ledger-filter-date').value = getISODateString(); renderSellerLedger(); }
    else if (page === 'payment') { openSubPage('page-seller-payment'); selectPayType('total'); }
}

async function renderSellerSoldTable() {
    const { data } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId).eq('code', currentSellerCode);
    $('seller-sold-tbody').innerHTML = (data || []).map(t => `<tr class="border-b border-slate-100"><td class="p-3 text-[10px] text-slate-500">${t.date}</td><td class="p-3">${t.item}</td><td class="p-3 font-bold">${t.series}</td><td class="p-3 font-mono text-[10px]">${t.ticket_range}</td><td class="p-3 text-emerald-600 font-bold">${t.qty}</td><td class="p-3 font-bold">${fmtCurr(t.price_raw)}</td></tr>`).join('') || `<tr><td colspan="6" class="p-4 text-center text-slate-400">No sold tickets.</td></tr>`;
}

async function renderSellerPaymentHistory() {
    const { data } = await _supabase.from('payments').select('*').eq('mlot_id', currentMlotId).eq('code', currentSellerCode);
    $('seller-payment-history-tbody').innerHTML = (data || []).map(p => `<tr class="border-b border-slate-100"><td class="p-3 text-[10px] text-slate-500">${p.date}</td><td class="p-3 font-bold">${fmtCurr(p.total_due)}</td><td class="p-3 font-bold text-emerald-600">${fmtCurr(p.paid_amount)}</td><td class="p-3 text-center"><span class="text-[10px] font-bold px-2 py-0.5 rounded ${p.status === 'Approved' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}">${p.status}</span></td></tr>`).join('') || `<tr><td colspan="4" class="p-4 text-center text-slate-400">No history found.</td></tr>`;
}

async function renderSellerLedger() {
    const dFilter = formatToDBDate(val('seller-ledger-filter-date') || getISODateString());
    const [s, sales, unsold] = await Promise.all([
        _supabase.from('sellers').select('*').eq('mlot_id', currentMlotId).eq('code', currentSellerCode).single(),
        _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId).eq('code', currentSellerCode),
        _supabase.from('unsold_records').select('*').eq('mlot_id', currentMlotId).eq('code', currentSellerCode)
    ]);
    if (!s.data) return;
    const dayDue = (sales.data || []).filter(t => t.date === dFilter).reduce((a, c) => a + c.price_raw, 0) - (unsold.data || []).filter(t => t.date === dFilter).reduce((a, c) => a + c.price_raw, 0);
    const pay = (s.data.date_payments || {})[dFilter] || 0;
    $('s-ledger-prev').innerText = fmtCurr(s.data.previous_due); $('s-ledger-today').innerText = fmtCurr(dayDue);
    $('s-ledger-pay').innerText = fmtCurr(pay); $('s-ledger-balance').innerText = fmtCurr((s.data.previous_due || 0) + dayDue - pay);
}

async function selectPayType(type) {
    const [s, sales, unsold] = await Promise.all([
        _supabase.from('sellers').select('*').eq('mlot_id', currentMlotId).eq('code', currentSellerCode).single(),
        _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId).eq('code', currentSellerCode),
        _supabase.from('unsold_records').select('*').eq('mlot_id', currentMlotId).eq('code', currentSellerCode)
    ]);
    if (!s.data) return;
    const today = formatToDBDate(getISODateString());
    const todayDue = (sales.data || []).filter(t => t.date === today).reduce((a, c) => a + c.price_raw, 0) - (unsold.data || []).filter(t => t.date === today).reduce((a, c) => a + c.price_raw, 0);
    const totalDue = (s.data.previous_due || 0) + todayDue - (s.data.today_payment || 0);
    $('pay-type-total').className = `py-2.5 ${type === 'total' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700'} rounded-xl text-xs font-bold`;
    $('pay-type-today').className = `py-2.5 ${type === 'today' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700'} rounded-xl text-xs font-bold`;
    $('pay-amount-display').innerText = fmtCurr(type === 'total' ? totalDue : todayDue);
    const { data: mlot } = await _supabase.from('mlot_users').select('upi_id').eq('mlot_id', currentMlotId).maybeSingle();
    if (mlot?.upi_id) $('mlot-upi-display').innerText = mlot.upi_id;
}

const openDirectUPIApp = () => window.location.href = `upi://pay?pa=${encodeURIComponent(val('mlot-upi-display') || 'tapasm569@ptyes')}&pn=MLOT%20Master&am=${val('pay-amount-display').replace('₹', '')}&cu=INR`;

async function submitSellerPayment(e) {
    e.preventDefault();
    const file = $('s-pay-screenshot').files[0];
    if (!file) return alert("Screenshot required!");
    const reader = new FileReader();
    reader.onload = () => {
        const img = new Image();
        img.onload = async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 800; canvas.height = (800 / img.width) * img.height;
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            const amt = parseFloat(val('pay-amount-display').replace('₹', '')) || 0;
            const { data: s } = await _supabase.from('sellers').select('name').eq('mlot_id', currentMlotId).eq('code', currentSellerCode).single();
            await _supabase.from('payments').insert([{ date: formatToDBDate(getISODateString()), code: currentSellerCode, name: s?.name || currentSellerCode, total_due: amt, paid_amount: amt, screenshot: canvas.toDataURL('image/jpeg', 0.6), status: 'Pending', mlot_id: currentMlotId }]);
            alert("Submitted!"); $('s-pay-screenshot').value = ''; openSellerAccountHome();
        };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
}

async function submitPayLater() {
    const amt = parseFloat(val('pay-amount-display').replace('₹', '')) || 0;
    const { data: s } = await _supabase.from('sellers').select('name').eq('mlot_id', currentMlotId).eq('code', currentSellerCode).single();
    await _supabase.from('payments').insert([{ date: formatToDBDate(getISODateString()), code: currentSellerCode, name: s?.name || currentSellerCode, total_due: amt, paid_amount: amt, screenshot: null, status: 'Pending', mlot_id: currentMlotId }]);
    alert("Pay Later submitted!"); openSellerAccountHome();
}