const SUPABASE_URL = 'https://uwpexlmvpnffbmvlqski.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3cGV4bG12cG5mZmJtdmxxc2tpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyODQ1MTQsImV4cCI6MjEwNDg2MDUxNH0.n59Hyk18Ysb93Fw70pWNmFT0KMGZm_CECYvtdD_MsxA';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUserRole = 'mlot', currentMlotId = null, currentSellerCode = null;
let pendingBatchTickets = [], pendingUnsoldBatch = [], pendingPurchaseDraft = [];
let tempSellerData = {}, currentStockCategory = '1 PM', currentSellerStockCategory = '1 PM';
let currentlyViewingSellerCode = null, isEditingSeller = false;
let activeSaleSetPrice = 6.50, activeUnsoldSetPrice = 6.50, activeSellerUnsoldSetPrice = 6.50;
let deviceFCMToken = null;

// --- KEYBOARD & FOOTER FIX ---
window.addEventListener('focusin', (e) => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) {
        document.getElementById('footer-nav')?.classList.add('hidden');
    }
});
window.addEventListener('focusout', (e) => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) {
        setTimeout(() => {
            if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName) && currentUserRole === 'mlot') {
                document.getElementById('footer-nav')?.classList.remove('hidden');
            }
        }, 150);
    }
});

// --- UNIVERSAL MODAL TOGGLER (Saves significant lines) ---
function toggleModal(modalId, show = true) {
    const el = document.getElementById(modalId);
    if (el) el.classList.toggle('hidden', !show);
}

// --- PUSH NOTIFICATION BRIDGE ---
window.receiveFCMTokenFromAndroid = function(token) {
    if (token && token !== "null" && token !== "undefined") {
        deviceFCMToken = token;
        if (currentMlotId) updateTokenInDatabase();
    }
};

function checkBridgeForFCMToken() {
    if (!deviceFCMToken && window.AndroidBridge && typeof window.AndroidBridge.getFCMToken === 'function') {
        try {
            const token = window.AndroidBridge.getFCMToken();
            if (token && token !== "null" && token !== "undefined") deviceFCMToken = token;
        } catch (e) { console.warn(e); }
    }
    return deviceFCMToken;
}

async function updateTokenInDatabase(retryCount = 0) {
    checkBridgeForFCMToken();
    if (!deviceFCMToken) {
        if (retryCount < 5 && currentMlotId) setTimeout(() => updateTokenInDatabase(retryCount + 1), 1500);
        return;
    }
    if (!currentMlotId) return;
    try {
        if (currentUserRole === 'mlot') {
            await _supabase.from('mlot_users').update({ fcm_token: deviceFCMToken }).eq('mlot_id', currentMlotId);
        } else if (currentUserRole === 'seller' && currentSellerCode) {
            await _supabase.from('sellers').update({ fcm_token: deviceFCMToken }).eq('mlot_id', currentMlotId).eq('code', currentSellerCode);
        }
    } catch (err) { console.error(err); }
}

const seriesOptionsMap = {
    "1 PM": ["M5", "M10", "M20", "M30", "M50", "M100", "M200"],
    "6 PM": ["D5", "D10", "D20", "D30", "D50", "D100", "D200"],
    "8 PM": ["E5", "E10", "E20", "E30", "E50", "E100", "E200"]
};

function getLocalDateString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// --- AUTO LOGIN & INIT ---
window.onload = function() {
    checkBridgeForFCMToken();
    const savedRole = localStorage.getItem('currentUserRole');
    if (savedRole) {
        currentUserRole = savedRole;
        currentMlotId = localStorage.getItem('currentMlotId');
        currentSellerCode = localStorage.getItem('currentSellerCode');
        document.getElementById('login-screen').classList.add('hidden');

        if (savedRole === 'mlot') {
            const bizName = localStorage.getItem('businessName') || "MLOT User";
            document.getElementById('app-header-title').innerText = `${bizName} (ID: ${currentMlotId})`;
            document.getElementById('footer-nav').classList.remove('hidden');
            updatePendingUnsoldBadge();
            switchTab('sale');
        } else if (savedRole === 'seller') {
            document.getElementById('app-header-title').innerText = `Seller Portal (${currentSellerCode})`;
            document.getElementById('footer-nav').classList.add('hidden');
            openSellerAccountHome();
        } else if (savedRole === 'admin') {
            document.getElementById('app-header-title').innerText = "Super Admin Control Center";
            document.getElementById('footer-nav').classList.add('hidden');
            document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
            document.getElementById('page-admin-dashboard').classList.remove('hidden');
            openAdminSection('view-mlot');
        }
        updateTokenInDatabase();
    }
};

function switchAuthTab(tabKey) {
    ['mlot-login', 'seller', 'admin'].forEach(k => {
        document.getElementById(`form-${k === 'seller' ? 'seller-login' : k === 'mlot-login' ? 'mlot-login' : 'admin-login'}`).classList.toggle('hidden', k !== tabKey);
    });
    if (document.getElementById('auth-tab-mlot-login')) {
        document.getElementById('auth-tab-mlot-login').className = `flex-1 py-2 text-xs font-semibold rounded-lg ${tabKey === 'mlot-login' ? 'bg-indigo-600 text-white shadow' : 'text-slate-300'}`;
        document.getElementById('auth-tab-seller').className = `flex-1 py-2 text-xs font-semibold rounded-lg ${tabKey === 'seller' ? 'bg-emerald-600 text-white shadow' : 'text-slate-300'}`;
    }
}

async function handleMlotLogin(event) {
    event.preventDefault();
    const mlotId = document.getElementById('mlot-id-input').value.trim();
    const mlotPass = document.getElementById('mlot-pass-input').value.trim();
    const { data, error } = await _supabase.from('mlot_users').select('*').eq('mlot_id', mlotId).maybeSingle();
    if (error || !data || data.mobile !== mlotPass) { alert("Invalid Credentials!"); return; }
    if (new Date() > new Date(data.subscription_expiry)) { alert("Subscription expired!"); return; }

    currentUserRole = 'mlot'; currentMlotId = data.mlot_id;
    localStorage.setItem('currentUserRole', 'mlot');
    localStorage.setItem('currentMlotId', currentMlotId);
    localStorage.setItem('businessName', data.business_name);
    updateTokenInDatabase();

    document.getElementById('app-header-title').innerText = `${data.business_name} (ID: ${data.mlot_id})`;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('footer-nav').classList.remove('hidden');
    updatePendingUnsoldBadge();
    switchTab('sale');
}

async function handleSellerLogin(event) {
    event.preventDefault();
    const sellerMlotId = document.getElementById('seller-mlot-id').value.trim();
    const sellerMobile = document.getElementById('seller-mobile-input').value.trim();
    const { data, error } = await _supabase.from('sellers').select('*').eq('mlot_id', sellerMlotId).eq('phone', sellerMobile).maybeSingle();
    if (error || !data) { alert("Invalid Credentials!"); return; }

    currentUserRole = 'seller'; currentMlotId = sellerMlotId; currentSellerCode = data.code;
    localStorage.setItem('currentUserRole', 'seller');
    localStorage.setItem('currentMlotId', currentMlotId);
    localStorage.setItem('currentSellerCode', currentSellerCode);
    activeSellerUnsoldSetPrice = data.set_price || 6.50;
    updateTokenInDatabase();

    document.getElementById('app-header-title').innerText = `Seller Portal (${currentSellerCode})`;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('footer-nav').classList.add('hidden');
    openSellerAccountHome();
}

async function handleAdminLogin(event) {
    event.preventDefault();
    const mob = document.getElementById('admin-mob-input').value.trim();
    const pass = document.getElementById('admin-pass-input').value.trim();
    const { data } = await _supabase.from('admins').select('*').eq('mobile', mob).eq('password', pass).maybeSingle();
    if (!data) { alert("Invalid Admin Credentials!"); return; }

    currentUserRole = 'admin';
    localStorage.setItem('currentUserRole', 'admin');
    document.getElementById('app-header-title').innerText = "Super Admin Control Center";
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('footer-nav').classList.add('hidden');
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-admin-dashboard').classList.remove('hidden');
    openAdminSection('view-mlot');
}

function logout() {
    localStorage.clear();
    currentUserRole = 'mlot'; currentMlotId = null; currentSellerCode = null;
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    document.getElementById('footer-nav').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    switchAuthTab('mlot-login');
}

// ================= ADMIN PANEL =================
async function openAdminSection(sectionKey) {
    const container = document.getElementById('admin-subview-container');
    container.innerHTML = '';
    if (sectionKey === 'create-mlot') {
        container.innerHTML = `<h3 class="text-xs font-bold text-slate-800 mb-3"><i class="fa-solid fa-user-plus text-indigo-600 mr-1"></i> Create Mlot Party</h3><form onsubmit="submitCreateMlotParty(event)" class="space-y-3"><div><label class="block text-[10px] font-bold text-slate-600 mb-1">Mlot id</label><input type="text" id="admin-new-id" required class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"></div><div><label class="block text-[10px] font-bold text-slate-600 mb-1">Name</label><input type="text" id="admin-new-name" required class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"></div><div class="grid grid-cols-2 gap-2"><div><label class="block text-[10px] font-bold text-slate-600 mb-1">Area</label><input type="text" id="admin-new-area" required class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"></div><div><label class="block text-[10px] font-bold text-slate-600 mb-1">Mobile</label><input type="tel" id="admin-new-mob" required class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"></div></div><div><label class="block text-[10px] font-bold text-slate-600 mb-1">Upi id</label><input type="text" id="admin-new-upi" required class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"></div><button type="submit" class="w-full py-2.5 bg-indigo-600 text-white rounded-xl font-bold text-xs">Create Party</button></form>`;
    } else if (sectionKey === 'view-mlot') {
        const { data } = await _supabase.from('mlot_users').select('*');
        let rows = (data || []).map(u => `<tr class="border-b border-slate-100"><td class="p-2 text-indigo-600 font-semibold">${u.mlot_id}</td><td class="p-2 font-bold">${u.business_name}</td><td class="p-2 text-[10px]">${new Date(u.created_at).toLocaleDateString()}</td><td class="p-2 text-[10px] text-emerald-600 font-bold">${new Date(u.subscription_expiry).toLocaleDateString()}</td></tr>`).join('');
        container.innerHTML = `<h3 class="text-xs font-bold text-slate-800 mb-2">All Mlot Parties</h3><div class="overflow-x-auto max-h-[300px]"><table class="w-full text-left text-xs"><thead><tr class="bg-slate-100 text-[10px] uppercase"><th class="p-2">ID</th><th class="p-2">Name</th><th class="p-2">Created</th><th class="p-2">Expiry</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="p-4 text-center text-slate-400">None found.</td></tr>'}</tbody></table></div>`;
    } else if (sectionKey === 'manage-subs') {
        const { data } = await _supabase.from('mlot_users').select('*');
        const { data: payments } = await _supabase.from('mlot_payments').select('*').eq('status', 'Pending');
        const now = new Date();
        let renewalRows = (data || []).filter(u => Math.ceil((new Date(u.subscription_expiry) - now) / 86400000) <= 10 && Math.ceil((new Date(u.subscription_expiry) - now) / 86400000) >= 0).map(u => `<tr class="border-b border-slate-100"><td class="p-2 font-bold">${u.business_name} (${u.mlot_id})</td><td class="p-2 text-amber-600 font-bold">Expiring soon</td><td><button onclick="renewMlot('${u.mlot_id}')" class="px-2 py-1 bg-indigo-600 text-white rounded text-[10px]">Renew</button></td></tr>`).join('');
        let paymentRows = (payments || []).map(p => `<tr class="border-b border-slate-100"><td class="p-2 font-bold">${p.mlot_id}</td><td class="p-2 text-emerald-600">₹${p.amount}</td><td><button onclick="approveMlotPayment('${p.id}', '${p.mlot_id}')" class="px-2 py-1 bg-emerald-600 text-white rounded text-[10px]">Approve</button></td></tr>`).join('');
        container.innerHTML = `<div class="space-y-4"><div><h3 class="text-xs font-bold mb-2">Renewals Due</h3><table class="w-full text-left text-xs"><tbody>${renewalRows || '<tr><td colspan="3" class="p-3 text-center text-slate-400">None.</td></tr>'}</tbody></table></div><div><h3 class="text-xs font-bold mb-2">Pending Payments</h3><table class="w-full text-left text-xs"><tbody>${paymentRows || '<tr><td colspan="3" class="p-3 text-center text-slate-400">None.</td></tr>'}</tbody></table></div></div>`;
    } else if (sectionKey === 'payment-history') {
        const { data } = await _supabase.from('mlot_users').select('*');
        let rows = (data || []).map(u => `<tr class="border-b border-slate-100"><td class="p-2 font-bold">${u.business_name} (${u.mlot_id})</td><td class="p-2 text-emerald-600 font-bold">₹200</td><td class="p-2 text-[10px] text-slate-500">${new Date(u.created_at).toLocaleDateString()}</td></tr>`).join('');
        container.innerHTML = `<h3 class="text-xs font-bold mb-2">Payment History</h3><div class="overflow-x-auto max-h-[300px]"><table class="w-full text-left text-xs"><thead><tr class="bg-slate-100 text-[10px] uppercase"><th class="p-2">Party</th><th class="p-2">Amt</th><th class="p-2">Date</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="p-4 text-center text-slate-400">None.</td></tr>'}</tbody></table></div>`;
    }
}

async function submitCreateMlotParty(event) {
    event.preventDefault();
    const mlotId = document.getElementById('admin-new-id').value.trim();
    const name = document.getElementById('admin-new-name').value.trim();
    const area = document.getElementById('admin-new-area').value.trim();
    const mob = document.getElementById('admin-new-mob').value.trim();
    const upi = document.getElementById('admin-new-upi').value.trim();
    const expiryDate = new Date(); expiryDate.setDate(expiryDate.getDate() + 30);

    const { error } = await _supabase.from('mlot_users').insert([{ mlot_id: mlotId, business_name: name, mobile: mob, area: area, upi_id: upi, subscription_expiry: expiryDate.toISOString(), status: 'Approved' }]);
    if (error) alert("Error: " + error.message);
    else { alert("Party created successfully!"); openAdminSection('view-mlot'); }
}

async function renewMlot(mlotId) {
    const { data } = await _supabase.from('mlot_users').select('subscription_expiry').eq('mlot_id', mlotId).single();
    let baseDate = new Date(data.subscription_expiry > new Date() ? data.subscription_expiry : new Date());
    baseDate.setDate(baseDate.getDate() + 30);
    await _supabase.from('mlot_users').update({ subscription_expiry: baseDate.toISOString() }).eq('mlot_id', mlotId);
    alert("Renewed for 30 days!");
    openAdminSection('manage-subs');
}

async function approveMlotPayment(payId, mlotId) {
    await _supabase.from('mlot_payments').update({ status: 'Approved' }).eq('id', payId);
    await renewMlot(mlotId);
}

// ================= NAVIGATION =================
function switchTab(tabName) {
    document.querySelectorAll('.app-page').forEach(page => page.classList.add('hidden'));
    document.getElementById(`page-${tabName}`).classList.remove('hidden');

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.className = "nav-btn flex flex-col items-center justify-center w-16 py-1 text-slate-400 transition-all";
        const span = btn.querySelector('span'); if (span) span.className = "text-[10px] font-medium";
    });

    const activeBtn = document.getElementById(`nav-${tabName}`);
    if (activeBtn) {
        activeBtn.className = tabName === 'master' ? "nav-btn flex flex-col items-center justify-center px-3 py-0.5 text-indigo-600 transition-all" : "nav-btn flex flex-col items-center justify-center w-16 py-1 text-indigo-600 transition-all";
        activeBtn.querySelector('span').className = "text-[10px] font-bold";
    }

    if (tabName === 'purchase') {
        const stockDateInput = document.getElementById('stock-filter-date');
        if (!stockDateInput.value) stockDateInput.value = getLocalDateString();
        renderPurchaseAvailableStock();
    } else if (tabName === 'sale') {
        const salePageDate = document.getElementById('sale-page-filter-date');
        if (!salePageDate.value) salePageDate.value = getLocalDateString();
        renderMasterAndSaleTables();
    } else {
        renderMasterAndSaleTables();
    }
}

// ================= UTILITIES & RANGE PARSING =================
function parseRangeQuantity(series, fromStr, toStr) {
    const match = series ? series.match(/\d+/) : null;
    const mult = match ? parseInt(match[0]) : 1;
    const fromVal = parseInt(fromStr);
    let toVal = parseInt(toStr);
    let rangeCount = 1;

    if (!isNaN(fromVal)) {
        let actualToVal = fromVal;
        if (!isNaN(toVal)) {
            actualToVal = (toVal < fromVal && toStr.length < fromStr.length) ? parseInt(fromStr.substring(0, fromStr.length - toStr.length) + toStr) : toVal;
        }
        if (actualToVal >= fromVal) rangeCount = (actualToVal - fromVal) + 1;
        else return { qty: 0, mult, actualToVal: fromVal, error: true };
        return { qty: mult * rangeCount, mult, actualToVal, error: false };
    }
    return { qty: 0, mult, actualToVal: 0, error: true };
}

function formatTicketRangeString(group, fromVal, actualToVal) {
    return (isNaN(actualToVal) || fromVal === actualToVal) ? `${group} ${fromVal}` : `${group} ${fromVal}-${actualToVal}`;
}

function expandRangeToIndividualTickets(rangeStr) {
    let parts = rangeStr.trim().split(/\s+/);
    if (parts.length < 2) return [];
    let group = parts[0];
    let nums = parts[1].split('-');
    let start = parseInt(nums[0]);
    let end = nums.length > 1 ? parseInt(nums[1]) : start;
    if (nums.length > 1 && nums[1].length < nums[0].length) {
        end = parseInt(nums[0].substring(0, nums[0].length - nums[1].length) + nums[1]);
    }
    let list = [];
    for (let i = start; i <= end; i++) list.push(`${group} ${i}`);
    return list;
}

// ================= SELLER PORTAL =================
function openSellerAccountHome() {
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-seller-account').classList.remove('hidden');
    loadSellerProfileName();
}

async function loadSellerProfileName() {
    const { data } = await _supabase.from('sellers').select('name').eq('mlot_id', currentMlotId).eq('code', currentSellerCode).single();
    document.getElementById('seller-portal-banner-name').innerText = `Welcome, ${data ? data.name : "Seller"} (${currentSellerCode})`;
}

function openSellerPage(pageKey) {
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    if (pageKey === 'purchase') {
        document.getElementById('page-seller-purchase').classList.remove('hidden');
        document.getElementById('seller-stock-filter-date').value = getLocalDateString();
        renderSellerAvailableStockIndividual();
    } else if (pageKey === 'unsold') {
        document.getElementById('page-seller-unsold').classList.remove('hidden');
        document.getElementById('s-unsold-date').value = getLocalDateString();
        document.getElementById('s-unsold-q-date').value = getLocalDateString();
        switchSellerUnsoldMode('detailed');
    } else if (pageKey === 'sold') {
        document.getElementById('page-seller-sold').classList.remove('hidden');
        renderSellerSoldTable();
    } else if (pageKey === 'history') {
        document.getElementById('page-seller-history').classList.remove('hidden');
        renderSellerPaymentHistory();
    } else if (pageKey === 'ledger') {
        document.getElementById('page-seller-ledger').classList.remove('hidden');
        document.getElementById('seller-ledger-filter-date').value = getLocalDateString();
        renderSellerLedger();
    } else if (pageKey === 'payment') {
        document.getElementById('page-seller-payment').classList.remove('hidden');
        selectPayType('total');
    }
}

// ================= STOCK & INVENTORY VIEWS =================
function selectStockCategory(cat) {
    currentStockCategory = cat;
    ['1pm', '6pm', '8pm'].forEach(c => {
        const btn = document.getElementById(`cat-${c}`);
        if (btn) btn.className = `stock-cat-btn py-3 px-2 ${cat.toLowerCase().includes(c) ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-700 border border-slate-200'}`;
    });
    document.getElementById('active-category-title').innerText = `${cat} Stock Pool`;
    renderPurchaseAvailableStock();
}

function selectSellerStockCategory(cat) {
    currentSellerStockCategory = cat;
    ['1pm', '6pm', '8pm'].forEach(c => {
        const btn = document.getElementById(`s-cat-${c}`);
        if (btn) btn.className = `s-stock-cat-btn py-2.5 px-2 ${cat.toLowerCase().includes(c) ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-700 border border-slate-200'}`;
    });
    document.getElementById('seller-stock-category-title').innerText = `${cat} Stock Pool`;
    renderSellerAvailableStockIndividual();
}

function changeStockDate(days) {
    const input = document.getElementById('stock-filter-date');
    let d = input.value ? new Date(input.value) : new Date();
    d.setDate(d.getDate() + days);
    input.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    renderPurchaseAvailableStock();
}

function changeSellerStockDate(days) {
    const input = document.getElementById('seller-stock-filter-date');
    let d = input.value ? new Date(input.value) : new Date();
    d.setDate(d.getDate() + days);
    input.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    renderSellerAvailableStockIndividual();
}

async function renderPurchaseAvailableStock() {
    if (!currentMlotId) return;
    const stockDate = document.getElementById('stock-filter-date').value || getLocalDateString();
    const { data: pData } = await _supabase.from('purchase_store').select('*').eq('item', currentStockCategory).eq('date', stockDate).eq('mlot_id', currentMlotId);
    const { data: sData } = await _supabase.from('sales_records').select('*').eq('item', currentStockCategory).eq('date', stockDate).eq('mlot_id', currentMlotId);
    const { data: uData } = await _supabase.from('unsold_records').select('*').eq('item', currentStockCategory).eq('date', stockDate).eq('mlot_id', currentMlotId);

    const container = document.getElementById('purchase-available-series-container');
    container.innerHTML = '';
    let soldSet = new Set();
    (sData || []).forEach(s => expandRangeToIndividualTickets(s.ticket_range).forEach(t => soldSet.add(t)));
    (uData || []).forEach(u => expandRangeToIndividualTickets(u.ticket_range).forEach(t => soldSet.delete(t)));

    let seriesMap = {};
    (pData || []).forEach(p => {
        let sKey = p.series || "General";
        if (!seriesMap[sKey]) seriesMap[sKey] = [];
        expandRangeToIndividualTickets(p.ticket_range).forEach(t => { if (!soldSet.has(t)) seriesMap[sKey].push(t); });
    });

    let totalAvail = 0, keys = Object.keys(seriesMap);
    if (keys.length === 0 || keys.every(k => seriesMap[k].length === 0)) {
        container.innerHTML = `<div class="p-4 bg-slate-50 text-center text-xs text-slate-400">No available stock.</div>`;
        document.getElementById('available-total-badge').innerText = `0 Available`;
        return;
    }

    keys.forEach(series => {
        let tickets = seriesMap[series];
        if (tickets.length === 0) return;
        totalAvail += tickets.length;
        let badges = tickets.map(t => `<span class="bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-mono px-2 py-0.5 rounded-md inline-block m-0.5">${t}</span>`).join('');
        container.innerHTML += `<div class="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2"><div class="flex justify-between items-center border-b border-slate-200 pb-1.5"><span class="text-xs font-bold text-slate-800">Series: ${series}</span><span class="text-[10px] bg-purple-100 text-purple-700 font-bold px-2 py-0.5 rounded-full">${tickets.length} Left</span></div><div class="flex flex-wrap max-h-[140px] overflow-y-auto">${badges}</div></div>`;
    });
    document.getElementById('available-total-badge').innerText = `${totalAvail} Available`;
}

async function renderSellerAvailableStockIndividual() {
    if (!currentMlotId) return;
    const stockDate = document.getElementById('seller-stock-filter-date').value || getLocalDateString();
    const { data: pData } = await _supabase.from('purchase_store').select('*').eq('item', currentSellerStockCategory).eq('date', stockDate).eq('mlot_id', currentMlotId);
    const { data: sData } = await _supabase.from('sales_records').select('*').eq('item', currentSellerStockCategory).eq('date', stockDate).eq('mlot_id', currentMlotId);
    const { data: uData } = await _supabase.from('unsold_records').select('*').eq('item', currentSellerStockCategory).eq('date', stockDate).eq('mlot_id', currentMlotId);

    const container = document.getElementById('seller-purchase-indv-container');
    container.innerHTML = '';
    let soldSet = new Set();
    (sData || []).forEach(s => expandRangeToIndividualTickets(s.ticket_range).forEach(t => soldSet.add(t)));
    (uData || []).forEach(u => expandRangeToIndividualTickets(u.ticket_range).forEach(t => soldSet.delete(t)));

    let seriesMap = {};
    (pData || []).forEach(p => {
        let sKey = p.series || "General";
        if (!seriesMap[sKey]) seriesMap[sKey] = [];
        expandRangeToIndividualTickets(p.ticket_range).forEach(t => { if (!soldSet.has(t)) seriesMap[sKey].push(t); });
    });

    let totalAvail = 0, keys = Object.keys(seriesMap);
    if (keys.length === 0 || keys.every(k => seriesMap[k].length === 0)) {
        container.innerHTML = `<div class="p-4 bg-slate-50 text-center text-xs text-slate-400">No stock available.</div>`;
        document.getElementById('seller-available-count').innerText = `0 Available`;
        return;
    }

    keys.forEach(series => {
        let tickets = seriesMap[series];
        if (tickets.length === 0) return;
        totalAvail += tickets.length;
        let badges = tickets.map(t => `<span class="bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-mono px-2 py-0.5 rounded-md inline-block m-0.5">${t}</span>`).join('');
        container.innerHTML += `<div class="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2"><div class="flex justify-between items-center border-b border-slate-200 pb-1.5"><span class="text-xs font-bold text-slate-800">Series: ${series}</span><span class="text-[10px] bg-purple-100 text-purple-700 font-bold px-2 py-0.5 rounded-full">${tickets.length} Left</span></div><div class="flex flex-wrap max-h-[140px] overflow-y-auto">${badges}</div></div>`;
    });
    document.getElementById('seller-available-count').innerText = `${totalAvail} Available`;
}

// ================= PURCHASE ENTRY & AUTO-DRAFT =================
function openPurchaseEntryPage() {
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-purchase-entry').classList.remove('hidden');
    document.getElementById('pur-date').value = getLocalDateString();
    document.getElementById('pur-buying-price').value = '';
    onPurchaseItemChange();
}

function onPurchaseItemChange() {
    const item = document.getElementById('pur-item').value;
    const seriesSelect = document.getElementById('pur-series');
    seriesSelect.innerHTML = '';
    (seriesOptionsMap[item] || []).forEach(s => seriesSelect.appendChild(new Option(s, s)));
    calculatePurchaseCost();
}

function calculatePurchaseCost() {
    const series = document.getElementById('pur-series').value;
    const fromStr = document.getElementById('pur-from').value.trim();
    const toStr = document.getElementById('pur-to').value.trim();
    const price = parseFloat(document.getElementById('pur-buying-price').value) || 0;
    const calc = parseRangeQuantity(series, fromStr, toStr);
    document.getElementById('pur-qty').value = calc.qty || 0;
    document.getElementById('pur-total-amount').innerText = `₹${((calc.qty || 0) * price).toFixed(2)}`;
}

function handlePurchaseBlurAutoDraft() {
    const group = document.getElementById('pur-group').value.trim();
    const fromStr = document.getElementById('pur-from').value.trim();
    const toStr = document.getElementById('pur-to').value.trim();
    const price = parseFloat(document.getElementById('pur-buying-price').value);

    if (group && fromStr && toStr && !isNaN(price)) {
        const item = document.getElementById('pur-item').value;
        const series = document.getElementById('pur-series').value;
        const date = document.getElementById('pur-date').value || getLocalDateString();
        const calc = parseRangeQuantity(series, fromStr, toStr);
        if (!calc.error) {
            let ticketRangeStr = formatTicketRangeString(group.toUpperCase(), parseInt(fromStr), calc.actualToVal);
            let exists = pendingPurchaseDraft.some(d => d.date === date && d.item === item && d.series === series && d.ticket_range === ticketRangeStr);
            if (!exists) {
                pendingPurchaseDraft.push({ date, item, series, ticket_range: ticketRangeStr, qty: calc.qty, cost_raw: calc.qty * price, mlot_id: currentMlotId });
                document.getElementById('pur-draft-count').innerText = pendingPurchaseDraft.length;
            }
        }
    }
}

function addPurchaseDraft(event) {
    event.preventDefault();
    const date = document.getElementById('pur-date').value || getLocalDateString();
    const item = document.getElementById('pur-item').value;
    const series = document.getElementById('pur-series').value;
    const group = document.getElementById('pur-group').value.trim().toUpperCase();
    const fromStr = document.getElementById('pur-from').value.trim();
    const toStr = document.getElementById('pur-to').value.trim();
    const price = parseFloat(document.getElementById('pur-buying-price').value);

    if (isNaN(price) || !group || !fromStr) { alert("Please provide valid details."); return; }
    const calc = parseRangeQuantity(series, fromStr, toStr);
    if (calc.error) { alert("Invalid range."); return; }

    pendingPurchaseDraft.push({ date, item, series, ticket_range: formatTicketRangeString(group, parseInt(fromStr), calc.actualToVal), qty: calc.qty, cost_raw: calc.qty * price, mlot_id: currentMlotId });
    document.getElementById('pur-draft-count').innerText = pendingPurchaseDraft.length;
    document.getElementById('pur-from').value = ''; document.getElementById('pur-to').value = '';
    calculatePurchaseCost();
}

function openPurchaseDraftModal() {
    const tbody = document.getElementById('pur-draft-tbody');
    const tfoot = document.getElementById('pur-draft-tfoot');
    tbody.innerHTML = ''; let q = 0, c = 0;
    pendingPurchaseDraft.forEach((item, idx) => {
        q += item.qty; c += item.cost_raw;
        tbody.innerHTML += `<tr class="border-b border-slate-100"><td class="p-2">${idx+1}</td><td class="p-2">${item.item}</td><td class="p-2 font-bold">${item.series}</td><td class="p-2 font-mono text-[10px]">${item.ticket_range}</td><td class="p-2 font-bold text-purple-600">${item.qty}</td><td class="p-2 font-bold">₹${item.cost_raw.toFixed(2)}</td><td class="p-2 text-center"><button onclick="pendingPurchaseDraft.splice(${idx},1);openPurchaseDraftModal()" class="text-red-500"><i class="fa-solid fa-trash"></i></button></td></tr>`;
    });
    tfoot.innerHTML = `<tr><td colspan="4" class="p-2 text-right font-bold">Total:</td><td class="p-2 font-bold text-purple-600">${q}</td><td colspan="2" class="p-2 font-bold text-indigo-600">₹${c.toFixed(2)}</td></tr>`;
    toggleModal('purchase-draft-modal', true);
}

async function savePurchaseToStore() {
    if (pendingPurchaseDraft.length === 0) { alert("Draft is empty."); return; }
    const { error } = await _supabase.from('purchase_store').insert(pendingPurchaseDraft);
    if (error) alert("Error: " + error.message);
    else {
        alert("Saved to store inventory!");
        pendingPurchaseDraft = [];
        document.getElementById('pur-draft-count').innerText = '0';
        toggleModal('purchase-draft-modal', false);
        switchTab('purchase');
    }
}

// ================= SALE ENTRY & AUTO-DRAFT =================
function openSaleEntryPage() {
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-sale-entry').classList.remove('hidden');
    document.getElementById('sale-date').value = getLocalDateString();
    updateSellerCodeDropdown();
    onItemChange();
}

async function updateSellerCodeDropdown() {
    const select = document.getElementById('sale-seller-code');
    const { data } = await _supabase.from('sellers').select('code').eq('mlot_id', currentMlotId);
    select.innerHTML = '<option value="">Select Code</option>';
    (data || []).forEach(s => select.appendChild(new Option(s.code, s.code)));
}

async function onSellerCodeChange() {
    const code = document.getElementById('sale-seller-code').value;
    const nameInput = document.getElementById('sale-seller-name');
    if(!code) { nameInput.value = ""; activeSaleSetPrice = 6.50; calculateSalePrice(); return; }
    const { data } = await _supabase.from('sellers').select('name, set_price').eq('mlot_id', currentMlotId).eq('code', code).single();
    nameInput.value = data ? data.name : "";
    activeSaleSetPrice = (data && data.set_price) ? data.set_price : 6.50;
    calculateSalePrice();
}

function onItemChange() {
    const item = document.getElementById('sale-item').value;
    const seriesSelect = document.getElementById('sale-series');
    seriesSelect.innerHTML = '';
    (seriesOptionsMap[item] || []).forEach(s => seriesSelect.appendChild(new Option(s, s)));
    calculateSalePrice();
}

function calculateSalePrice() {
    const series = document.getElementById('sale-series').value;
    const fromStr = document.getElementById('sale-from').value.trim();
    const toStr = document.getElementById('sale-to').value.trim();
    const calc = parseRangeQuantity(series, fromStr, toStr);
    document.getElementById('sale-qty').value = calc.qty || 0;
    document.getElementById('sale-price').value = `₹${((calc.qty || 0) * activeSaleSetPrice).toFixed(2)}`;
}

function handleSaleBlurAutoDraft() {
    const code = document.getElementById('sale-seller-code').value;
    const group = document.getElementById('sale-group').value.trim();
    const fromStr = document.getElementById('sale-from').value.trim();
    const toStr = document.getElementById('sale-to').value.trim();

    if (code && group && fromStr && toStr) {
        const series = document.getElementById('sale-series').value;
        const calc = parseRangeQuantity(series, fromStr, toStr);
        if (!calc.error) {
            let ticketRangeStr = formatTicketRangeString(group.toUpperCase(), parseInt(fromStr), calc.actualToVal);
            const entryIndividualTickets = expandRangeToIndividualTickets(ticketRangeStr);
            let draftedSet = new Set();
            pendingBatchTickets.forEach(b => expandRangeToIndividualTickets(b.ticket_range).forEach(t => draftedSet.add(t)));
            if (!entryIndividualTickets.some(t => draftedSet.has(t))) {
                pendingBatchTickets.push({ date: document.getElementById('sale-date').value || getLocalDateString(), code, name: document.getElementById('sale-seller-name').value, item: document.getElementById('sale-item').value, series, ticket_range: ticketRangeStr, qty: calc.qty, price_raw: calc.qty * activeSaleSetPrice, mlot_id: currentMlotId });
                document.getElementById('batch-count').innerText = pendingBatchTickets.length;
            }
        }
    }
}

async function addCurrentEntryToList() {
    const date = document.getElementById('sale-date').value || getLocalDateString();
    const code = document.getElementById('sale-seller-code').value;
    const item = document.getElementById('sale-item').value;
    const series = document.getElementById('sale-series').value;
    const group = document.getElementById('sale-group').value.trim().toUpperCase();
    const fromStr = document.getElementById('sale-from').value.trim();
    const toStr = document.getElementById('sale-to').value.trim();

    if (!code || !group || !fromStr) { alert("Provide Code, Group, and From number."); return; }
    const calc = parseRangeQuantity(series, fromStr, toStr);
    if (calc.error) { alert("Invalid range."); return; }

    let ticketRangeStr = formatTicketRangeString(group, parseInt(fromStr), calc.actualToVal);
    const entryTickets = expandRangeToIndividualTickets(ticketRangeStr);

    const { data: purData } = await _supabase.from('purchase_store').select('*').eq('mlot_id', currentMlotId).eq('item', item).eq('date', date);
    const { data: salesData } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId).eq('item', item).eq('date', date);
    const { data: unsoldData } = await _supabase.from('unsold_records').select('*').eq('mlot_id', currentMlotId).eq('item', item).eq('date', date);

    let availableSet = new Set(); (purData || []).forEach(p => expandRangeToIndividualTickets(p.ticket_range).forEach(t => availableSet.add(t)));
    let soldSet = new Set(); (salesData || []).forEach(s => expandRangeToIndividualTickets(s.ticket_range).forEach(t => soldSet.add(t)));
    (unsoldData || []).forEach(u => expandRangeToIndividualTickets(u.ticket_range).forEach(t => soldSet.delete(t)));

    if (!entryTickets.every(t => availableSet.has(t) && !soldSet.has(t))) { alert("Tickets outside available stock or already sold!"); return; }

    pendingBatchTickets.push({ date, code, name: document.getElementById('sale-seller-name').value, item, series, ticket_range: ticketRangeStr, qty: parseInt(document.getElementById('sale-qty').value), price_raw: parseFloat(document.getElementById('sale-price').value.replace('₹', '')), mlot_id: currentMlotId });
    document.getElementById('batch-count').innerText = pendingBatchTickets.length;
    document.getElementById('sale-from').value = ''; document.getElementById('sale-to').value = '';
    calculateSalePrice();
}

function openShowTicketModal() {
    const tbody = document.getElementById('ticket-preview-tbody');
    const tfoot = document.getElementById('ticket-preview-tfoot');
    tbody.innerHTML = ''; let q = 0, p = 0;
    pendingBatchTickets.forEach((t, i) => {
        q += t.qty; p += t.price_raw;
        tbody.innerHTML += `<tr class="border-b border-slate-100"><td class="p-2">${i+1}</td><td class="p-2 font-semibold text-indigo-600">${t.code}</td><td class="p-2">${t.name}</td><td class="p-2">${t.item}</td><td class="p-2 font-bold">${t.series}</td><td class="p-2 font-mono text-[10px]">${t.ticket_range}</td><td class="p-2 text-emerald-600 font-bold">${t.qty}</td><td class="p-2 font-bold">₹${t.price_raw.toFixed(2)}</td><td class="p-2 text-center"><button onclick="pendingBatchTickets.splice(${i},1);openShowTicketModal()" class="text-red-500"><i class="fa-solid fa-trash"></i></button></td></tr>`;
    });
    tfoot.innerHTML = `<tr><td colspan="6" class="p-2 text-right font-bold">Total:</td><td class="p-2 font-bold text-emerald-600">${q}</td><td colspan="2" class="p-2 font-bold text-indigo-600">₹${p.toFixed(2)}</td></tr>`;
    toggleModal('show-ticket-modal', true);
}

async function submitTicketEntries() {
    if (pendingBatchTickets.length === 0) return;
    const { error } = await _supabase.from('sales_records').insert(pendingBatchTickets);
    if (error) alert("Error: " + error.message);
    else {
        alert("Tickets saved successfully!");
        pendingBatchTickets = [];
        document.getElementById('batch-count').innerText = '0';
        toggleModal('show-ticket-modal', false);
        switchTab('sale');
    }
}

// ================= UNSOLD & QUICK ENTRY (WITH RESTRICTIONS) =================
function openUnsoldTicketPage() {
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-unsold-ticket').classList.remove('hidden');
    document.getElementById('unsold-date').value = getLocalDateString();
    document.getElementById('unsold-q-date').value = getLocalDateString();
    updateUnsoldCodeDropdown();
    updateQuickUnsoldCodeDropdown();
    onUnsoldItemChange();
    switchUnsoldMode('detailed');
}

function switchUnsoldMode(mode) {
    document.getElementById('unsold-tab-detailed').className = `flex-1 py-2 text-xs font-bold rounded-lg ${mode === 'detailed' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600'}`;
    document.getElementById('unsold-tab-quick').className = `flex-1 py-2 text-xs font-bold rounded-lg ${mode === 'quick' ? 'bg-orange-600 text-white shadow' : 'text-slate-600'}`;
    document.getElementById('container-unsold-detailed').classList.toggle('hidden', mode !== 'detailed');
    document.getElementById('container-unsold-quick').classList.toggle('hidden', mode !== 'quick');
}

async function updateUnsoldCodeDropdown() {
    const select = document.getElementById('unsold-seller-code');
    const { data } = await _supabase.from('sellers').select('code').eq('mlot_id', currentMlotId);
    select.innerHTML = '<option value="">Select Code</option>';
    (data || []).forEach(s => select.appendChild(new Option(s.code, s.code)));
}

async function updateQuickUnsoldCodeDropdown() {
    const select = document.getElementById('unsold-q-seller-code');
    if (!select) return;
    const { data } = await _supabase.from('sellers').select('code').eq('mlot_id', currentMlotId);
    select.innerHTML = '<option value="">Select Code</option>';
    (data || []).forEach(s => select.appendChild(new Option(s.code, s.code)));
}

async function onUnsoldCodeChange() {
    const code = document.getElementById('unsold-seller-code').value;
    const nameInput = document.getElementById('unsold-seller-name');
    if(!code) { nameInput.value = ""; activeUnsoldSetPrice = 6.50; calculateUnsoldPrice(); return; }
    const { data } = await _supabase.from('sellers').select('name, set_price').eq('mlot_id', currentMlotId).eq('code', code).single();
    nameInput.value = data ? data.name : "";
    activeUnsoldSetPrice = (data && data.set_price) ? data.set_price : 6.50;
    calculateUnsoldPrice();
}

async function onQuickSellerCodeChange() {
    const code = document.getElementById('unsold-q-seller-code').value;
    const nameInput = document.getElementById('unsold-q-seller-name');
    if (!code) { nameInput.value = ""; return; }
    const { data } = await _supabase.from('sellers').select('name').eq('mlot_id', currentMlotId).eq('code', code).single();
    nameInput.value = data ? data.name : "";
}

function onUnsoldItemChange() {
    const item = document.getElementById('unsold-item').value;
    const seriesSelect = document.getElementById('unsold-series');
    seriesSelect.innerHTML = '';
    (seriesOptionsMap[item] || []).forEach(s => seriesSelect.appendChild(new Option(s, s)));
    calculateUnsoldPrice();
}

function calculateUnsoldPrice() {
    const series = document.getElementById('unsold-series').value;
    const fromStr = document.getElementById('unsold-from').value.trim();
    const toStr = document.getElementById('unsold-to').value.trim();
    const calc = parseRangeQuantity(series, fromStr, toStr);
    document.getElementById('unsold-qty').value = calc.qty || 0;
    document.getElementById('unsold-price').value = `₹${((calc.qty || 0) * activeUnsoldSetPrice).toFixed(2)}`;
}

// RESTRICTION CHECK: Seller can only return tickets purchased from MLOT user
async function validateSellerPurchasedTickets(mlotId, sellerCode, item, date, ticketRangeStr) {
    const { data: salesRecords } = await _supabase.from('sales_records').select('*').eq('mlot_id', mlotId).eq('code', sellerCode).eq('item', item).eq('date', date);
    let sellerPurchasedSet = new Set();
    (salesRecords || []).forEach(s => expandRangeToIndividualTickets(s.ticket_range).forEach(t => sellerPurchasedSet.add(t)));
    return expandRangeToIndividualTickets(ticketRangeStr).every(t => sellerPurchasedSet.has(t));
}

function handleUnsoldBlurAutoDraft() {
    const code = document.getElementById('unsold-seller-code').value;
    const group = document.getElementById('unsold-group').value.trim();
    const fromStr = document.getElementById('unsold-from').value.trim();
    const toStr = document.getElementById('unsold-to').value.trim();

    if (code && group && fromStr && toStr) {
        const series = document.getElementById('unsold-series').value;
        const calc = parseRangeQuantity(series, fromStr, toStr);
        if (!calc.error) {
            let ticketRangeStr = formatTicketRangeString(group.toUpperCase(), parseInt(fromStr), calc.actualToVal);
            let exists = pendingUnsoldBatch.some(u => u.code === code && u.item === document.getElementById('unsold-item').value && u.series === series && u.ticket_range === ticketRangeStr);
            if (!exists) {
                pendingUnsoldBatch.push({ date: document.getElementById('unsold-date').value || getLocalDateString(), code, name: document.getElementById('unsold-seller-name').value, item: document.getElementById('unsold-item').value, series, ticket_range: ticketRangeStr, qty: calc.qty, price_raw: calc.qty * activeUnsoldSetPrice, mlot_id: currentMlotId });
                document.getElementById('unsold-batch-count').innerText = pendingUnsoldBatch.length;
            }
        }
    }
}

function addUnsoldEntryToBatch() {
    const date = document.getElementById('unsold-date').value || getLocalDateString();
    const code = document.getElementById('unsold-seller-code').value;
    const item = document.getElementById('unsold-item').value;
    const series = document.getElementById('unsold-series').value;
    const group = document.getElementById('unsold-group').value.trim().toUpperCase();
    const fromStr = document.getElementById('unsold-from').value.trim();
    const toStr = document.getElementById('unsold-to').value.trim();

    if (!code || !group || !fromStr) { alert("Provide Code, Group, and From number."); return; }
    const calc = parseRangeQuantity(series, fromStr, toStr);
    if (calc.error) { alert("Invalid range."); return; }

    pendingUnsoldBatch.push({ date, code, name: document.getElementById('unsold-seller-name').value, item, series, ticket_range: formatTicketRangeString(group, parseInt(fromStr), calc.actualToVal), qty: calc.qty, price_raw: calc.qty * activeUnsoldSetPrice, mlot_id: currentMlotId });
    document.getElementById('unsold-batch-count').innerText = pendingUnsoldBatch.length;
    document.getElementById('unsold-from').value = ''; document.getElementById('unsold-to').value = '';
    calculateUnsoldPrice();
}

async function submitUnsoldDetailed(event) {
    event.preventDefault();
    if (pendingUnsoldBatch.length === 0) { handleUnsoldBlurAutoDraft(); if (pendingUnsoldBatch.length === 0) { alert("No unsold entries added."); return; } }

    for (let entry of pendingUnsoldBatch) {
        let isValid = await validateSellerPurchasedTickets(currentMlotId, entry.code, entry.item, entry.date, entry.ticket_range);
        if (!isValid) { alert(`Prohibited! Ticket range ${entry.ticket_range} for seller ${entry.code} was not purchased from MLOT user.`); return; }
    }

    const { error } = await _supabase.from('unsold_records').insert(pendingUnsoldBatch);
    if (error) alert("Error: " + error.message);
    else {
        alert("Unsold entries saved successfully!");
        pendingUnsoldBatch = [];
        document.getElementById('unsold-batch-count').innerText = '0';
        document.getElementById('form-unsold-detailed').reset();
        document.getElementById('unsold-date').value = getLocalDateString();
    }
}

async function submitUnsoldQuickEntry(event) {
    event.preventDefault();
    const code = document.getElementById('unsold-q-seller-code').value;
    const qty = parseInt(document.getElementById('unsold-q-qty').value) || 0;
    if (!code || qty <= 0) { alert("Select seller code and valid quantity."); return; }

    const quickEntry = { date: document.getElementById('unsold-q-date').value || getLocalDateString(), code, name: document.getElementById('unsold-q-seller-name').value, item: document.getElementById('unsold-q-item').value, series: 'QUICK', ticket_range: `Quick Qty: ${qty}`, qty, price_raw: qty * activeUnsoldSetPrice, is_quick: true, mlot_id: currentMlotId };
    const { error } = await _supabase.from('pending_unsold').insert([quickEntry]);
    if (error) alert("Error: " + error.message);
    else {
        alert("Quick unsold request submitted for verification!");
        document.getElementById('form-unsold-quick').reset();
        document.getElementById('unsold-q-date').value = getLocalDateString();
        updatePendingUnsoldBadge();
    }
}

// ================= SELLER UNSOLD ENTRY =================
function switchSellerUnsoldMode(mode) {
    document.getElementById('s-unsold-tab-detailed').className = `flex-1 py-2 text-xs font-bold rounded-lg ${mode === 'detailed' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600'}`;
    document.getElementById('s-unsold-tab-quick').className = `flex-1 py-2 text-xs font-bold rounded-lg ${mode === 'quick' ? 'bg-orange-600 text-white shadow' : 'text-slate-600'}`;
    document.getElementById('s-container-unsold-detailed').classList.toggle('hidden', mode !== 'detailed');
    document.getElementById('s-container-unsold-quick').classList.toggle('hidden', mode !== 'quick');
}

function onSellerUnsoldItemChange() {
    const item = document.getElementById('s-unsold-item').value;
    const seriesSelect = document.getElementById('s-unsold-series');
    seriesSelect.innerHTML = '';
    (seriesOptionsMap[item] || []).forEach(s => seriesSelect.appendChild(new Option(s, s)));
    calculateSellerUnsoldPrice();
}

function calculateSellerUnsoldPrice() {
    const series = document.getElementById('s-unsold-series').value;
    const fromStr = document.getElementById('s-unsold-from').value.trim();
    const toStr = document.getElementById('s-unsold-to').value.trim();
    const calc = parseRangeQuantity(series, fromStr, toStr);
    document.getElementById('s-unsold-qty').value = calc.qty || 0;
    document.getElementById('s-unsold-price').value = `₹${((calc.qty || 0) * activeSellerUnsoldSetPrice).toFixed(2)}`;
}

async function submitSellerUnsold(event) {
    event.preventDefault();
    const date = document.getElementById('s-unsold-date').value || getLocalDateString();
    const item = document.getElementById('s-unsold-item').value;
    const series = document.getElementById('s-unsold-series').value;
    const group = document.getElementById('s-unsold-group').value.trim().toUpperCase();
    const fromStr = document.getElementById('s-unsold-from').value.trim();
    const toStr = document.getElementById('s-unsold-to').value.trim();

    const calc = parseRangeQuantity(series, fromStr, toStr);
    if (calc.error) { alert("Invalid range."); return; }

    let ticketRangeStr = formatTicketRangeString(group, parseInt(fromStr), calc.actualToVal);
    let isValid = await validateSellerPurchasedTickets(currentMlotId, currentSellerCode, item, date, ticketRangeStr);
    if (!isValid) { alert("Prohibited! You can only return tickets purchased from your MLOT user."); return; }

    const { data: sData } = await _supabase.from('sellers').select('name').eq('mlot_id', currentMlotId).eq('code', currentSellerCode).single();
    const pendingEntry = { date, code: currentSellerCode, name: sData ? sData.name : currentSellerCode, item, series, ticket_range: ticketRangeStr, qty: calc.qty, price_raw: calc.qty * activeSellerUnsoldSetPrice, mlot_id: currentMlotId };

    const { error } = await _supabase.from('pending_unsold').insert([pendingEntry]);
    if(error) alert("Error: " + error.message);
    else {
        alert("Unsold tickets sent to Mlot User for verification!");
        document.getElementById('form-seller-unsold').reset();
        document.getElementById('s-unsold-date').value = getLocalDateString();
        updatePendingUnsoldBadge();
        openSellerAccountHome();
    }
}

async function submitSellerUnsoldQuickEntry(event) {
    event.preventDefault();
    const qty = parseInt(document.getElementById('s-unsold-q-qty').value) || 0;
    if (qty <= 0) { alert("Enter valid quantity."); return; }

    const { data: sData } = await _supabase.from('sellers').select('name').eq('mlot_id', currentMlotId).eq('code', currentSellerCode).single();
    const pendingEntry = { date: document.getElementById('s-unsold-q-date').value || getLocalDateString(), code: currentSellerCode, name: sData ? sData.name : currentSellerCode, item: document.getElementById('s-unsold-q-item').value, series: 'QUICK', ticket_range: `Quick Qty: ${qty}`, qty, price_raw: qty * activeSellerUnsoldSetPrice, is_quick: true, mlot_id: currentMlotId };

    const { error } = await _supabase.from('pending_unsold').insert([pendingEntry]);
    if (error) alert("Error: " + error.message);
    else {
        alert("Quick unsold request sent to MLOT user!");
        document.getElementById('form-seller-unsold-quick').reset();
        document.getElementById('s-unsold-q-date').value = getLocalDateString();
        openSellerAccountHome();
    }
}

// ================= GENERAL CRUD & MISC =================
function openAddSellerPage() {
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-add-seller').classList.remove('hidden');
    document.getElementById('seller-userid').value = currentMlotId || '';
    calculateAddSellerPrice();
}

function calculateAddSellerPrice() {
    const totalPrice = (parseFloat(document.getElementById('seller-qty').value) || 1) * (parseFloat(document.getElementById('seller-set-price').value) || 0);
    document.getElementById('calculated-total-display').innerText = `₹${totalPrice.toFixed(2)}`;
    return totalPrice;
}

function previewSeller(event) {
    event.preventDefault();
    tempSellerData = {
        name: document.getElementById('seller-name').value.trim(),
        code: document.getElementById('seller-code').value.trim(),
        mob: document.getElementById('seller-mob').value.trim(),
        area: document.getElementById('seller-area').value.trim(),
        userid: document.getElementById('seller-userid').value.trim(),
        previousDue: (parseFloat(document.getElementById('seller-prev-due').value) || 0).toFixed(2),
        setPrice: (parseFloat(document.getElementById('seller-set-price').value) || 0).toFixed(2),
        totalPrice: calculateAddSellerPrice()
    };
    document.getElementById('v-name').innerText = tempSellerData.name;
    document.getElementById('v-code').innerText = tempSellerData.code;
    document.getElementById('v-mob').innerText = tempSellerData.mob;
    document.getElementById('v-area').innerText = tempSellerData.area;
    document.getElementById('v-userid').innerText = tempSellerData.userid;
    document.getElementById('v-prevdue').innerText = `₹${tempSellerData.previousDue}`;
    document.getElementById('v-setprice').innerText = `₹${tempSellerData.setPrice} per item`;
    document.getElementById('v-qty').innerText = "1";
    document.getElementById('v-price').innerText = `₹${tempSellerData.totalPrice.toFixed(2)}`;
    toggleModal('verify-modal', true);
}

function closeModal() { toggleModal('verify-modal', false); }

async function finalSubmitSeller() {
    closeModal();
    const { error } = await _supabase.from('sellers').insert([{ code: tempSellerData.code, name: tempSellerData.name, phone: tempSellerData.mob, area: tempSellerData.area, set_price: parseFloat(tempSellerData.setPrice), previous_due: parseFloat(tempSellerData.previousDue), today_payment: 0.00, date_payments: {}, mlot_id: currentMlotId }]);
    if (error) alert("Error: " + error.message);
    else { alert("Seller created successfully!"); document.getElementById('form-add-seller').reset(); switchTab('sale'); }
}

async function renderMasterAndSaleTables() {
    const saleDateFilter = document.getElementById('sale-page-filter-date').value || getLocalDateString();
    const { data: sellers } = await _supabase.from('sellers').select('*').eq('mlot_id', currentMlotId);
    const { data: sales } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId);
    const { data: unsold } = await _supabase.from('unsold_records').select('*').eq('mlot_id', currentMlotId);
    const todayStr = getLocalDateString();

    const masterList = document.getElementById('master-seller-list');
    const saleBody = document.getElementById('sale-table-body');
    if (masterList) masterList.innerHTML = ''; if (saleBody) saleBody.innerHTML = '';

    if (!sellers || sellers.length === 0) {
        if (masterList) masterList.innerHTML = `<div class="p-4 bg-white rounded-2xl text-center text-xs text-slate-400">No sellers registered.</div>`;
        if (saleBody) saleBody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-slate-400">No records available.</td></tr>`;
        return;
    }

    sellers.forEach((s, idx) => {
        const slNo = String(idx + 1).padStart(2, '0');
        const sSales = (sales || []).filter(t => t.code === s.code);
        const sUnsold = (unsold || []).filter(t => t.code === s.code);
        const todayDue = sSales.filter(t => (t.date || todayStr) === todayStr).reduce((a, c) => a + c.price_raw, 0) - sUnsold.filter(t => (t.date || todayStr) === todayStr).reduce((a, c) => a + c.price_raw, 0);
        const totalBalance = (s.previous_due || 0) + todayDue - (s.today_payment || 0);

        if (masterList) {
            masterList.innerHTML += `<div class="bg-white p-3 rounded-2xl shadow-sm border border-slate-200 flex items-center justify-between"><div class="flex items-center space-x-3 cursor-pointer" onclick="openSellerDetailModal('${s.code}')"><div class="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs">${slNo}</div><div><h4 class="text-xs font-bold text-slate-800">${s.name} <span class="text-[10px] text-indigo-600 font-normal">#${s.code}</span></h4><p class="text-[10px] text-slate-500">Total Balance: <span class="font-bold text-red-600">₹${totalBalance.toFixed(2)}</span></p></div></div><div class="flex items-center space-x-2"><a href="tel:${s.phone || ''}" class="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xs"><i class="fa-solid fa-phone"></i></a><a href="https://wa.me/${s.phone || ''}" target="_blank" class="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center text-xs"><i class="fa-brands fa-whatsapp"></i></a></div></div>`;
        }
        if (saleBody) {
            const dSales = sSales.filter(t => (t.date || getLocalDateString()) === saleDateFilter);
            const dUnsold = sUnsold.filter(t => (t.date || getLocalDateString()) === saleDateFilter);
            let pQty = dSales.reduce((a, c) => a + c.qty, 0), uQty = dUnsold.reduce((a, c) => a + c.qty, 0);
            saleBody.innerHTML += `<tr class="hover:bg-slate-50 border-b border-slate-100"><td class="p-3 text-slate-400">${slNo}</td><td class="p-3 font-semibold text-indigo-600">${s.code}</td><td class="p-3 font-bold text-slate-800">${s.name}</td><td class="p-3 text-purple-600 font-bold">${pQty}</td><td class="p-3 text-emerald-600 font-bold">${pQty - uQty}</td><td class="p-3 text-amber-600 font-bold">${uQty}</td><td class="p-3 font-bold text-slate-800">₹${(dSales.reduce((a, c) => a + c.price_raw, 0) - dUnsold.reduce((a, c) => a + c.price_raw, 0)).toFixed(2)}</td><td class="p-3 font-extrabold text-red-600">₹${totalBalance.toFixed(2)}</td></tr>`;
        }
    });
}

async function openSellerDetailModal(code) {
    currentlyViewingSellerCode = code; isEditingSeller = false;
    renderSellerDetailModalContent();
    toggleModal('seller-detail-modal', true);
}

function closeSellerDetailModal() { isEditingSeller = false; toggleModal('seller-detail-modal', false); }

async function renderSellerDetailModalContent() {
    const { data: s } = await _supabase.from('sellers').select('*').eq('mlot_id', currentMlotId).eq('code', currentlyViewingSellerCode).single();
    if (!s) return;
    const { data: sales } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId).eq('code', currentlyViewingSellerCode);
    const { data: unsold } = await _supabase.from('unsold_records').select('*').eq('mlot_id', currentMlotId).eq('code', currentlyViewingSellerCode);
    const todayStr = getLocalDateString();
    let totalBalance = (s.previous_due || 0) + ((sales || []).filter(t => (t.date || todayStr) === todayStr).reduce((a, c) => a + c.price_raw, 0) - (unsold || []).filter(t => (t.date || todayStr) === todayStr).reduce((a, c) => a + c.price_raw, 0)) - (s.today_payment || 0);

    const contentDiv = document.getElementById('seller-detail-content');
    const editBtn = document.getElementById('seller-detail-edit-btn');

    if (!isEditingSeller) {
        editBtn.innerText = "Edit Details";
        contentDiv.innerHTML = `<div class="flex justify-between"><span class="text-slate-500">Code:</span> <span class="font-bold text-indigo-600">${currentlyViewingSellerCode}</span></div><div class="flex justify-between"><span class="text-slate-500">Name:</span> <span class="font-bold text-slate-800">${s.name}</span></div><div class="flex justify-between"><span class="text-slate-500">Balance:</span> <span class="font-extrabold text-red-600">₹${totalBalance.toFixed(2)}</span></div><div class="flex justify-between"><span class="text-slate-500">Mobile:</span> <span class="font-bold text-slate-800">${s.phone || 'N/A'}</span></div><div class="flex justify-between"><span class="text-slate-500">Area:</span> <span class="font-bold text-slate-800">${s.area || 'N/A'}</span></div>`;
    } else {
        editBtn.innerText = "Save Changes";
        contentDiv.innerHTML = `<div class="space-y-2"><div><label class="text-[10px] font-bold">Name</label><input type="text" id="edit-s-name" value="${s.name}" class="w-full px-2 py-1.5 border rounded text-xs"></div><div><label class="text-[10px] font-bold">Mobile</label><input type="tel" id="edit-s-mob" value="${s.phone || ''}" class="w-full px-2 py-1.5 border rounded text-xs"></div><div><label class="text-[10px] font-bold">Area</label><input type="text" id="edit-s-area" value="${s.area || ''}" class="w-full px-2 py-1.5 border rounded text-xs"></div></div>`;
    }
}

async function toggleEditSellerMode() {
    if (!isEditingSeller) { isEditingSeller = true; renderSellerDetailModalContent(); }
    else {
        await _supabase.from('sellers').update({ name: document.getElementById('edit-s-name').value.trim(), phone: document.getElementById('edit-s-mob').value.trim(), area: document.getElementById('edit-s-area').value.trim() }).eq('mlot_id', currentMlotId).eq('code', currentlyViewingSellerCode);
        isEditingSeller = false; alert("Updated successfully!"); renderSellerDetailModalContent(); renderMasterAndSaleTables();
    }
}

// ================= MISC MODALS & VIEWS =================
function closeVerifyUnsoldModal() { toggleModal('verify-unsold-modal', false); }
function closeShowAllUnsoldModal() { toggleModal('show-all-unsold-modal', false); }
function closePurchaseDraftModal() { toggleModal('purchase-draft-modal', false); }
function viewScreenshot(url) { document.getElementById('screenshot-img-preview').src = url; toggleModal('view-screenshot-modal', true); }
function closeScreenshotModal() { toggleModal('view-screenshot-modal', false); }