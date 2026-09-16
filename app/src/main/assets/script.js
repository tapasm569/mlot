const SUPABASE_URL = 'https://uwpexlmvpnffbmvlqski.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3cGV4bG12cG5mZmJtdmxxc2tpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyODQ1MTQsImV4cCI6MjEwNDg2MDUxNH0.n59Hyk18Ysb93Fw70pWNmFT0KMGZm_CECYvtdD_MsxA';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUserRole = 'mlot', currentMlotId = null, currentSellerCode = null;
let pendingBatchTickets = [], pendingUnsoldBatch = [], pendingPurchaseDraft = [];
let importedTicketDraft = []; // Temporary holder for OCR imported tickets
let tempSellerData = {}, currentStockCategory = '1 PM', currentSellerStockCategory = '1 PM';
let currentlyViewingSellerCode = null, isEditingSeller = false;
let activeSaleSetPrice = 6.50, activeUnsoldSetPrice = 6.50, activeSellerUnsoldSetPrice = 6.50, activeQuickUnsoldSetPrice = 6.50;
let deviceFCMToken = null;

// Sticky Buying Price memory for Purchase Entry
let rememberedPurchasePrice = localStorage.getItem('lastPurchasePrice') || '';

// --- DATE ADAPTERS FOR DD/MM/YYYY (16/09/2026) FORMAT ---
function getISODateString(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatToDBDate(str) {
    if (!str) return '';
    str = String(str).trim();
    if (str.includes('/')) {
        const parts = str.split('/');
        if (parts.length === 2) {
            // Missing year e.g. "21/05" -> append current year 2026
            return `${parts[0]}/${parts[1]}/2026`;
        }
        return str; // Already DD/MM/YYYY
    }
    if (str.includes('-')) {
        const p = str.split('-');
        if (p.length === 3) {
            if (p[0].length === 4) return `${p[2]}/${p[1]}/${p[0]}`; // YYYY-MM-DD -> DD/MM/YYYY
            if (p[2].length === 4) return `${p[0]}/${p[1]}/${p[2]}`; // DD-MM-YYYY -> DD/MM/YYYY
        }
    }
    return str;
}

function convertDateToComparable(dateStr) {
    if (!dateStr) return '';
    dateStr = String(dateStr).trim();
    if (dateStr.includes('/')) {
        const p = dateStr.split('/');
        if (p.length === 2) return `2026${p[1].padStart(2, '0')}${p[0].padStart(2, '0')}`;
        if (p.length === 3) return `${p[2]}${p[1].padStart(2, '0')}${p[0].padStart(2, '0')}`;
    }
    if (dateStr.includes('-')) {
        const p = dateStr.split('-');
        if (p.length === 3) {
            if (p[0].length === 4) return `${p[0]}${p[1].padStart(2, '0')}${p[2].padStart(2, '0')}`;
            if (p[2].length === 4) return `${p[2]}${p[1].padStart(2, '0')}${p[0].padStart(2, '0')}`;
        }
    }
    return dateStr;
}

// --- DIRECT PDF VIEWER & NATIVE ANDROID BRIDGE ---
function openPDFDirectly(doc, fileName = `Report_${Date.now()}.pdf`) {
    if (!doc) {
        alert("Error: PDF document object is empty.");
        return;
    }
    try {
        const dataUri = doc.output('datauristring');
        const pdfBase64 = dataUri.split(',')[1];

        if (window.AndroidBridge && typeof window.AndroidBridge.openPDFDirectly === 'function') {
            window.AndroidBridge.openPDFDirectly(pdfBase64, fileName);
        } else {
            const a = document.createElement('a');
            a.href = dataUri;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    } catch (err) {
        alert("Could not open PDF: " + err.message);
    }
}

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

// --- SWIPE GESTURE NAVIGATION FOR MLOT USERS ---
let touchStartX = 0;
let touchStartY = 0;

window.addEventListener('touchstart', e => {
    if (currentUserRole !== 'mlot') return;
    if (e.target.closest('input, select, textarea, button, table, div[id$="-modal"], .absolute')) return;
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
}, { passive: true });

window.addEventListener('touchend', e => {
    if (currentUserRole !== 'mlot') return;
    if (e.target.closest('input, select, textarea, button, table, div[id$="-modal"], .absolute')) return;
    let touchEndX = e.changedTouches[0].screenX;
    let touchEndY = e.changedTouches[0].screenY;
    handleSwipeGesture(touchStartX, touchStartY, touchEndX, touchEndY);
}, { passive: true });

function handleSwipeGesture(startX, startY, endX, endY) {
    const diffX = endX - startX;
    const diffY = endY - startY;
    
    if (Math.abs(diffX) > 60 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
        const tabs = ['sale', 'purchase', 'master', 'account'];
        let currentTabName = 'sale';
        tabs.forEach(t => {
            const pageEl = document.getElementById(`page-${t}`);
            if (pageEl && !pageEl.classList.contains('hidden')) {
                currentTabName = t;
            }
        });

        const currentIndex = tabs.indexOf(currentTabName);
        if (currentIndex === -1) return;

        if (diffX < 0) {
            if (currentIndex < tabs.length - 1) switchTab(tabs[currentIndex + 1]);
        } else {
            if (currentIndex > 0) switchTab(tabs[currentIndex - 1]);
        }
    }
}

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
            switchTab('sale', false);
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

// ================= HISTORY-AWARE NAVIGATION & BACK GESTURE SUPPORT =================
function switchTab(tabName, push = true) {
    document.querySelectorAll('.app-page').forEach(page => page.classList.add('hidden'));
    
    let targetPageId = `page-${tabName}`;
    if (currentUserRole === 'seller' && tabName === 'account') {
        targetPageId = 'page-seller-account';
    }
    
    const targetElement = document.getElementById(targetPageId);
    if (targetElement) targetElement.classList.remove('hidden');

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.className = "nav-btn flex flex-col items-center justify-center w-16 py-1 text-slate-400 transition-all";
        const span = btn.querySelector('span'); if (span) span.className = "text-[10px] font-medium";
    });

    const activeBtn = document.getElementById(`nav-${tabName}`);
    if (activeBtn) {
        activeBtn.className = tabName === 'master' ? "nav-btn flex flex-col items-center justify-center px-3 py-0.5 text-indigo-600 transition-all" : "nav-btn flex flex-col items-center justify-center w-16 py-1 text-indigo-600 transition-all";
        activeBtn.querySelector('span').className = "text-[10px] font-bold";
    }

    if (push) {
        history.pushState({ type: 'tab', name: tabName }, '', '');
    }

    if (tabName === 'purchase') {
        const stockDateInput = document.getElementById('stock-filter-date');
        if (!stockDateInput.value) stockDateInput.value = getISODateString();
        renderPurchaseAvailableStock();
    } else if (tabName === 'sale') {
        const salePageDate = document.getElementById('sale-page-filter-date');
        if (!salePageDate.value) salePageDate.value = getISODateString();
        renderMasterAndSaleTables();
    } else {
        renderMasterAndSaleTables();
    }
}

function openSubPage(sectionId, push = true) {
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    const el = document.getElementById(sectionId);
    if (el) el.classList.remove('hidden');
    if (push) {
        history.pushState({ type: 'subpage', name: sectionId }, '', '');
    }
}

window.addEventListener('popstate', (event) => {
    const openModals = document.querySelectorAll('.absolute.inset-0.z-50:not(.hidden), div[id$="-modal"]:not(.hidden)');
    for (let modal of openModals) {
        if (modal.id === 'login-screen') continue;
        modal.classList.add('hidden');
        event.preventDefault();
        return;
    }

    if (event.state && event.state.type === 'tab') {
        switchTab(event.state.name, false);
    } else if (event.state && event.state.type === 'subpage') {
        openSubPage(event.state.name, false);
    } else {
        if (currentUserRole === 'mlot') {
            switchTab('sale', false);
        } else if (currentUserRole === 'seller') {
            openSellerAccountHome();
        }
    }
});

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
    if (!rangeStr) return [];
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
        openSubPage('page-seller-purchase');
        document.getElementById('seller-stock-filter-date').value = getISODateString();
        renderSellerAvailableStockIndividual();
    } else if (pageKey === 'unsold') {
        openSubPage('page-seller-unsold');
        document.getElementById('s-unsold-date').value = getISODateString();
        document.getElementById('s-unsold-q-date').value = getISODateString();
        switchSellerUnsoldMode('detailed');
    } else if (pageKey === 'sold') {
        openSubPage('page-seller-sold');
        renderSellerSoldTable();
    } else if (pageKey === 'history') {
        openSubPage('page-seller-history');
        renderSellerPaymentHistory();
    } else if (pageKey === 'ledger') {
        openSubPage('page-seller-ledger');
        document.getElementById('seller-ledger-filter-date').value = getISODateString();
        renderSellerLedger();
    } else if (pageKey === 'payment') {
        openSubPage('page-seller-payment');
        selectPayType('total');
    }
}

// ================= STOCK & INVENTORY VIEWS =================
function selectStockCategory(cat) {
    currentStockCategory = cat;
    ['1pm', '6pm', '8pm'].forEach(c => {
        const btn = document.getElementById(`cat-${c}`);
        if (btn) {
            const isActive = cat.toLowerCase().replace(/\s+/g, '') === c;
            btn.className = `stock-cat-btn py-3 px-2 rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center gap-1 active:scale-95 ${
                isActive 
                    ? 'bg-indigo-600 text-white shadow-md' 
                    : 'bg-white text-slate-700 border border-slate-200 shadow-xs hover:bg-slate-50'
            }`;
        }
    });
    document.getElementById('active-category-title').innerText = `${cat} Stock Pool`;
    renderPurchaseAvailableStock();
}

function selectSellerStockCategory(cat) {
    currentSellerStockCategory = cat;
    ['1pm', '6pm', '8pm'].forEach(c => {
        const btn = document.getElementById(`s-cat-${c}`);
        if (btn) {
            const isActive = cat.toLowerCase().replace(/\s+/g, '') === c;
            btn.className = `s-stock-cat-btn py-2.5 px-2 rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center gap-1 active:scale-95 ${
                isActive 
                    ? 'bg-indigo-600 text-white shadow-md' 
                    : 'bg-white text-slate-700 border border-slate-200 shadow-xs hover:bg-slate-50'
            }`;
        }
    });
    document.getElementById('seller-stock-category-title').innerText = `${cat} Stock Pool`;
    renderSellerAvailableStockIndividual();
}

function changeStockDate(days) {
    const input = document.getElementById('stock-filter-date');
    let d = input.value ? new Date(input.value) : new Date();
    d.setDate(d.getDate() + days);
    input.value = getISODateString(d);
    renderPurchaseAvailableStock();
}

function changeSellerStockDate(days) {
    const input = document.getElementById('seller-stock-filter-date');
    let d = input.value ? new Date(input.value) : new Date();
    d.setDate(d.getDate() + days);
    input.value = getISODateString(d);
    renderSellerAvailableStockIndividual();
}

async function renderPurchaseAvailableStock() {
    if (!currentMlotId) return;
    const rawDate = document.getElementById('stock-filter-date').value || getISODateString();
    const stockDate = formatToDBDate(rawDate);

    const { data: pData } = await _supabase.from('purchase_store').select('*').eq('item', currentStockCategory).eq('mlot_id', currentMlotId);
    const { data: sData } = await _supabase.from('sales_records').select('*').eq('item', currentStockCategory).eq('mlot_id', currentMlotId);
    const { data: uData } = await _supabase.from('unsold_records').select('*').eq('item', currentStockCategory).eq('mlot_id', currentMlotId);

    const container = document.getElementById('purchase-available-series-container');
    container.innerHTML = '';
    let soldSet = new Set();
    
    (sData || []).filter(s => formatToDBDate(s.date) === stockDate).forEach(s => expandRangeToIndividualTickets(s.ticket_range).forEach(t => soldSet.add(t)));
    (uData || []).filter(u => formatToDBDate(u.date) === stockDate).forEach(u => expandRangeToIndividualTickets(u.ticket_range).forEach(t => soldSet.delete(t)));

    let seriesMap = {};
    (pData || []).filter(p => formatToDBDate(p.date) === stockDate).forEach(p => {
        let sKey = p.series || "General";
        if (!seriesMap[sKey]) seriesMap[sKey] = [];
        expandRangeToIndividualTickets(p.ticket_range).forEach(t => { if (!soldSet.has(t)) seriesMap[sKey].push(t); });
    });

    let totalAvail = 0, keys = Object.keys(seriesMap);
    if (keys.length === 0 || keys.every(k => seriesMap[k].length === 0)) {
        container.innerHTML = `<div class="p-4 bg-slate-50 text-center text-xs text-slate-400">No available stock on ${stockDate}.</div>`;
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
    const rawDate = document.getElementById('seller-stock-filter-date').value || getISODateString();
    const stockDate = formatToDBDate(rawDate);

    const { data: pData } = await _supabase.from('purchase_store').select('*').eq('item', currentSellerStockCategory).eq('mlot_id', currentMlotId);
    const { data: sData } = await _supabase.from('sales_records').select('*').eq('item', currentSellerStockCategory).eq('mlot_id', currentMlotId);
    const { data: uData } = await _supabase.from('unsold_records').select('*').eq('item', currentSellerStockCategory).eq('mlot_id', currentMlotId);

    const container = document.getElementById('seller-purchase-indv-container');
    container.innerHTML = '';
    let soldSet = new Set();
    
    (sData || []).filter(s => formatToDBDate(s.date) === stockDate).forEach(s => expandRangeToIndividualTickets(s.ticket_range).forEach(t => soldSet.add(t)));
    (uData || []).filter(u => formatToDBDate(u.date) === stockDate).forEach(u => expandRangeToIndividualTickets(u.ticket_range).forEach(t => soldSet.delete(t)));

    let seriesMap = {};
    (pData || []).filter(p => formatToDBDate(p.date) === stockDate).forEach(p => {
        let sKey = p.series || "General";
        if (!seriesMap[sKey]) seriesMap[sKey] = [];
        expandRangeToIndividualTickets(p.ticket_range).forEach(t => { if (!soldSet.has(t)) seriesMap[sKey].push(t); });
    });

    let totalAvail = 0, keys = Object.keys(seriesMap);
    if (keys.length === 0 || keys.every(k => seriesMap[k].length === 0)) {
        container.innerHTML = `<div class="p-4 bg-slate-50 text-center text-xs text-slate-400">No stock available on ${stockDate}.</div>`;
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

// ================= PURCHASE ENTRY & ENHANCED OCR SCANNER =================
function openPurchaseEntryPage() {
    openSubPage('page-purchase-entry');
    document.getElementById('pur-date').value = getISODateString();
    const priceInput = document.getElementById('pur-buying-price');
    if (priceInput && rememberedPurchasePrice) {
        priceInput.value = rememberedPurchasePrice;
    }
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
    const priceInput = document.getElementById('pur-buying-price');
    const price = parseFloat(priceInput.value) || 0;

    if (priceInput.value && !isNaN(price) && price > 0) {
        rememberedPurchasePrice = priceInput.value;
        localStorage.setItem('lastPurchasePrice', rememberedPurchasePrice);
    }

    const calc = parseRangeQuantity(series, fromStr, toStr);
    document.getElementById('pur-qty').value = calc.qty || 0;
    document.getElementById('pur-total-amount').innerText = `₹${((calc.qty || 0) * price).toFixed(2)}`;
}

// Preprocess image on canvas to boost text contrast for OCR
function preprocessImageForOCR(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(event) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                const scale = 2;
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const data = imgData.data;
                const contrast = 1.4;
                
                for (let i = 0; i < data.length; i += 4) {
                    let r = data[i];
                    let g = data[i + 1];
                    let b = data[i + 2];
                    
                    let v = 0.299 * r + 0.587 * g + 0.114 * b;
                    v = ((v - 128) * contrast) + 128;
                    v = Math.max(0, Math.min(255, v));
                    
                    data[i] = v;
                    data[i + 1] = v;
                    data[i + 2] = v;
                }
                
                ctx.putImageData(imgData, 0, 0);
                resolve(canvas.toDataURL('image/jpeg', 0.95));
            };
            img.onerror = reject;
            img.src = event.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function processImportedTicketFile() {
    const fileInput = document.getElementById('import-file-input');
    if (!fileInput.files || fileInput.files.length === 0) {
        alert("Please select an image file to import.");
        return;
    }

    const file = fileInput.files[0];
    if (file.type === 'application/pdf') {
        alert("Direct PDF OCR scanning requires image snapshots. Please take a photo or screenshot of the receipt and upload it as an image (JPG/PNG).");
        return;
    }

    const priceInput = document.getElementById('pur-buying-price');
    const unitPrice = parseFloat(priceInput.value) || parseFloat(rememberedPurchasePrice) || 6.50;

    alert("Enhancing image and scanning receipt with OCR... Please wait.");

    try {
        const processedDataUrl = await preprocessImageForOCR(file);
        const { data: { text } } = await Tesseract.recognize(processedDataUrl, 'eng', {
            logger: m => console.log(m)
        });

        console.log("OCR Extracted Text:\n", text);
        parseReceiptText(text, unitPrice);

    } catch (err) {
        alert("OCR processing failed: " + err.message);
    }
}

function parseReceiptText(text, unitPrice) {
    const lines = text.split('\n');
    importedTicketDraft = [];

    const rowRegex = /^\s*([0-9]+)\s+([A-Za-z0-9]+)\s+([0-9]{2}\/[0-9]{2})\s+([A-Z0-9]+)\s+([0-9]+-[0-9]+)/i;

    lines.forEach(line => {
        let match = line.trim().match(rowRegex);
        if (match) {
            let rawSeries = match[2].toUpperCase();
            let rawDate = match[3];
            let group = match[4].toUpperCase();
            let rawRange = match[5];

            // Normalization rule: E501 -> E50, D501 -> D50, E501 -> E50
            if ((rawSeries.startsWith('E') || rawSeries.startsWith('D') || rawSeries.startsWith('M')) && rawSeries.endsWith('01') && rawSeries.length > 3) {
                rawSeries = rawSeries.substring(0, rawSeries.length - 1);
            }

            let item = "1 PM";
            if (rawSeries.startsWith('D')) item = "6 PM";
            else if (rawSeries.startsWith('E')) item = "8 PM";
            else if (rawSeries.startsWith('M')) item = "1 PM";

            let date = formatToDBDate(rawDate);

            let rangeParts = rawRange.split('-');
            let fromStr = rangeParts[0];
            let toStr = rangeParts[1];
            let calc = parseRangeQuantity(rawSeries, fromStr, toStr);

            if (!calc.error) {
                let ticketRangeStr = formatTicketRangeString(group, parseInt(fromStr), calc.actualToVal);
                
                importedTicketDraft.push({
                    date,
                    item,
                    series: rawSeries,
                    ticket_range: ticketRangeStr,
                    qty: calc.qty,
                    cost_raw: calc.qty * unitPrice,
                    mlot_id: currentMlotId || localStorage.getItem('currentMlotId')
                });
            }
        }
    });

    if (importedTicketDraft.length > 0) {
        alert(`Successfully imported ${importedTicketDraft.length} ticket batches! Click "Verify ticket and save" to review.`);
        openVerifyImportedModal();
    } else {
        alert("Could not automatically detect ticket rows from this image. Please ensure the receipt photo is clear or use manual entry.");
    }
}

function openVerifyImportedModal() {
    const tbody = document.getElementById('imported-preview-tbody');
    const tfoot = document.getElementById('imported-preview-tfoot');
    tbody.innerHTML = '';
    let q = 0, c = 0;

    if (importedTicketDraft.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">No imported tickets. Please import a file first.</td></tr>`;
        tfoot.innerHTML = `<tr><td colspan="4" class="p-2 text-right font-bold">Total:</td><td class="p-2 font-bold text-purple-600">0</td><td colspan="2" class="p-2 font-bold text-indigo-600">₹0.00</td></tr>`;
    } else {
        importedTicketDraft.forEach((item, idx) => {
            q += item.qty;
            c += item.cost_raw;
            tbody.innerHTML += `
                <tr class="border-b border-slate-100">
                    <td class="p-2 text-[10px]">${item.date}</td>
                    <td class="p-2">${item.item}</td>
                    <td class="p-2 font-bold">${item.series}</td>
                    <td class="p-2 font-mono text-[10px]">${item.ticket_range}</td>
                    <td class="p-2 font-bold text-purple-600">${item.qty}</td>
                    <td class="p-2 font-bold">₹${Number(item.cost_raw).toFixed(2)}</td>
                    <td class="p-2 text-center">
                        <button type="button" onclick="importedTicketDraft.splice(${idx}, 1); openVerifyImportedModal();" class="text-red-500 hover:text-red-700">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
        tfoot.innerHTML = `<tr><td colspan="4" class="p-2 text-right font-bold">Total:</td><td class="p-2 font-bold text-purple-600">${q}</td><td colspan="2" class="p-2 font-bold text-indigo-600">₹${c.toFixed(2)}</td></tr>`;
    }
    toggleModal('verify-imported-modal', true);
}

function closeVerifyImportedModal() {
    toggleModal('verify-imported-modal', false);
}

async function saveImportedTicketsToStore() {
    try {
        if (!currentMlotId) currentMlotId = localStorage.getItem('currentMlotId');
        if (!currentMlotId) {
            alert("Error: Session missing. Please log in again.");
            return;
        }

        if (importedTicketDraft.length === 0) {
            alert("No imported tickets to save.");
            return;
        }

        const payload = importedTicketDraft.map(item => ({
            date: formatToDBDate(item.date),
            item: String(item.item),
            series: String(item.series),
            ticket_range: String(item.ticket_range),
            qty: parseInt(item.qty) || 0,
            cost_raw: parseFloat(item.cost_raw) || 0.00,
            mlot_id: String(currentMlotId)
        }));

        const { error } = await _supabase.from('purchase_store').insert(payload);
        if (error) {
            alert("Database Error (" + error.code + "): " + error.message);
            return;
        }

        alert("Imported tickets saved to store inventory successfully!");
        importedTicketDraft = [];
        closeVerifyImportedModal();
        switchTab('purchase');

    } catch (err) {
        alert("Unexpected error: " + err.message);
    }
}

function handlePurchaseBlurAutoDraft() {
    const priceVal = document.getElementById('pur-buying-price').value.trim();
    const price = parseFloat(priceVal);
    if (!priceVal || isNaN(price) || price <= 0) return;

    const group = document.getElementById('pur-group').value.trim().toUpperCase();
    const fromStr = document.getElementById('pur-from').value.trim();
    const toStr = document.getElementById('pur-to').value.trim();

    if (group && fromStr) {
        const item = document.getElementById('pur-item').value;
        const series = document.getElementById('pur-series').value;
        const date = formatToDBDate(document.getElementById('pur-date').value || getISODateString());
        const calc = parseRangeQuantity(series, fromStr, toStr);

        if (!calc.error) {
            let ticketRangeStr = formatTicketRangeString(group, parseInt(fromStr), calc.actualToVal);
            let exists = pendingPurchaseDraft.some(d => 
                d.date === date && d.item === item && d.series === series && d.ticket_range === ticketRangeStr
            );
            if (!exists) {
                pendingPurchaseDraft.push({ 
                    date, item, series, ticket_range: ticketRangeStr, 
                    qty: calc.qty, cost_raw: calc.qty * price, 
                    mlot_id: currentMlotId || localStorage.getItem('currentMlotId')
                });
                document.getElementById('pur-draft-count').innerText = pendingPurchaseDraft.length;
            }
        }
    }
}

function addPurchaseDraft(event) {
    if (event) event.preventDefault();

    const priceInput = document.getElementById('pur-buying-price');
    const priceVal = priceInput.value.trim();
    const price = parseFloat(priceVal);

    if (!priceVal || isNaN(price) || price <= 0) {
        alert("Set Price is required! Please enter a valid Buying Price before adding tickets.");
        priceInput.focus();
        return false;
    }

    rememberedPurchasePrice = priceVal;
    localStorage.setItem('lastPurchasePrice', rememberedPurchasePrice);

    const date = formatToDBDate(document.getElementById('pur-date').value || getISODateString());
    const item = document.getElementById('pur-item').value;
    const series = document.getElementById('pur-series').value;
    const group = document.getElementById('pur-group').value.trim().toUpperCase();
    const fromStr = document.getElementById('pur-from').value.trim();
    const toStr = document.getElementById('pur-to').value.trim();

    if (!group || !fromStr) { 
        alert("Please enter both Group and Ticket Number."); 
        return false; 
    }

    const calc = parseRangeQuantity(series, fromStr, toStr);
    if (calc.error) { 
        alert("Invalid ticket range."); 
        return false; 
    }

    let ticketRangeStr = formatTicketRangeString(group, parseInt(fromStr), calc.actualToVal);

    let exists = pendingPurchaseDraft.some(d => 
        d.date === date && d.item === item && d.series === series && d.ticket_range === ticketRangeStr
    );

    if (exists) {
        alert("DUPLICATE ENTRY!\nThis purchase ticket range is already added in draft.");
        return false;
    }

    pendingPurchaseDraft.push({ 
        date, item, series, ticket_range: ticketRangeStr, 
        qty: calc.qty, cost_raw: calc.qty * price, 
        mlot_id: currentMlotId || localStorage.getItem('currentMlotId')
    });

    document.getElementById('pur-draft-count').innerText = pendingPurchaseDraft.length;
    document.getElementById('pur-from').value = ''; 
    document.getElementById('pur-to').value = '';
    calculatePurchaseCost();
    return true;
}

function openPurchaseDraftModal() {
    const tbody = document.getElementById('pur-draft-tbody');
    const tfoot = document.getElementById('pur-draft-tfoot');
    tbody.innerHTML = ''; 
    let q = 0, c = 0;

    if (pendingPurchaseDraft.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">Draft is empty. Add ticket entries first.</td></tr>`;
        tfoot.innerHTML = `<tr><td colspan="4" class="p-2 text-right font-bold">Total:</td><td class="p-2 font-bold text-purple-600">0</td><td colspan="2" class="p-2 font-bold text-indigo-600">₹0.00</td></tr>`;
    } else {
        pendingPurchaseDraft.forEach((item, idx) => {
            q += item.qty; 
            c += item.cost_raw;
            tbody.innerHTML += `
                <tr class="border-b border-slate-100">
                    <td class="p-2">${idx + 1}</td>
                    <td class="p-2">${item.item}</td>
                    <td class="p-2 font-bold">${item.series}</td>
                    <td class="p-2 font-mono text-[10px]">${item.ticket_range}</td>
                    <td class="p-2 font-bold text-purple-600">${item.qty}</td>
                    <td class="p-2 font-bold">₹${Number(item.cost_raw).toFixed(2)}</td>
                    <td class="p-2 text-center">
                        <button type="button" onclick="pendingPurchaseDraft.splice(${idx}, 1); document.getElementById('pur-draft-count').innerText = pendingPurchaseDraft.length; openPurchaseDraftModal();" class="text-red-500 hover:text-red-700">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
        tfoot.innerHTML = `<tr><td colspan="4" class="p-2 text-right font-bold">Total:</td><td class="p-2 font-bold text-purple-600">${q}</td><td colspan="2" class="p-2 font-bold text-indigo-600">₹${c.toFixed(2)}</td></tr>`;
    }
    toggleModal('purchase-draft-modal', true);
}

function closePurchaseDraftModal() { toggleModal('purchase-draft-modal', false); }
function closeShowTicketModal() { toggleModal('show-ticket-modal', false); }

async function savePurchaseToStore() {
    try {
        if (!currentMlotId) currentMlotId = localStorage.getItem('currentMlotId');
        if (!currentMlotId) {
            alert("Error: Session missing. Please log in again.");
            return;
        }

        if (pendingPurchaseDraft.length === 0) {
            const group = document.getElementById('pur-group')?.value.trim();
            const fromStr = document.getElementById('pur-from')?.value.trim();
            const priceVal = document.getElementById('pur-buying-price')?.value.trim();
            if (group && fromStr && priceVal) {
                const added = addPurchaseDraft(null);
                if (!added) return;
            }
        }

        if (pendingPurchaseDraft.length === 0) { 
            alert("Draft is empty! Please enter Group, Ticket Range, and Price first."); 
            return; 
        }

        const payload = pendingPurchaseDraft.map(item => ({
            date: formatToDBDate(item.date),
            item: String(item.item),
            series: String(item.series),
            ticket_range: String(item.ticket_range),
            qty: parseInt(item.qty) || 0,
            cost_raw: parseFloat(item.cost_raw) || 0.00,
            mlot_id: String(currentMlotId)
        }));

        const { error } = await _supabase.from('purchase_store').insert(payload);
        if (error) {
            alert("Database Error (" + error.code + "): " + error.message);
            return;
        }

        alert("Saved to store inventory successfully!");
        pendingPurchaseDraft = [];
        document.getElementById('pur-draft-count').innerText = '0';
        
        document.getElementById('form-purchase-manual').reset();
        document.getElementById('pur-date').value = getISODateString();
        if (rememberedPurchasePrice) {
            document.getElementById('pur-buying-price').value = rememberedPurchasePrice;
        }

        closePurchaseDraftModal();
        switchTab('purchase');

    } catch (err) {
        alert("Unexpected error: " + err.message);
    }
}

// ================= SALE ENTRY & DUPLICATE RESTRICTION =================
function openSaleEntryPage() {
    openSubPage('page-sale-entry');
    document.getElementById('sale-date').value = getISODateString();
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
                pendingBatchTickets.push({ 
                    date: formatToDBDate(document.getElementById('sale-date').value || getISODateString()), 
                    code, 
                    name: document.getElementById('sale-seller-name').value, 
                    item: document.getElementById('sale-item').value, 
                    series, 
                    ticket_range: ticketRangeStr, 
                    qty: calc.qty, 
                    price_raw: calc.qty * activeSaleSetPrice, 
                    mlot_id: currentMlotId || localStorage.getItem('currentMlotId')
                });
                document.getElementById('batch-count').innerText = pendingBatchTickets.length;
            }
        }
    }
}

async function addCurrentEntryToList() {
    const date = formatToDBDate(document.getElementById('sale-date').value || getISODateString());
    const code = document.getElementById('sale-seller-code').value;
    const item = document.getElementById('sale-item').value;
    const series = document.getElementById('sale-series').value;
    const group = document.getElementById('sale-group').value.trim().toUpperCase();
    const fromStr = document.getElementById('sale-from').value.trim();
    const toStr = document.getElementById('sale-to').value.trim();

    if (!code) { alert("Please select Seller Code."); return false; }
    if (!group || !fromStr) { alert("Provide Group and Ticket number."); return false; }
    
    const calc = parseRangeQuantity(series, fromStr, toStr);
    if (calc.error) { alert("Invalid ticket range."); return false; }

    let ticketRangeStr = formatTicketRangeString(group, parseInt(fromStr), calc.actualToVal);
    const entryTickets = expandRangeToIndividualTickets(ticketRangeStr);

    let batchSet = new Set();
    pendingBatchTickets.forEach(b => {
        if (b.item === item && formatToDBDate(b.date) === date) {
            expandRangeToIndividualTickets(b.ticket_range).forEach(t => batchSet.add(t));
        }
    });

    for (let t of entryTickets) {
        if (batchSet.has(t)) {
            alert(`DUPLICATE ENTRY!\nTicket '${t}' is already added to the batch list.`);
            return false;
        }
    }

    const { data: salesData } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId).eq('item', item);
    let soldSet = new Set();
    (salesData || []).filter(s => formatToDBDate(s.date) === date).forEach(s => expandRangeToIndividualTickets(s.ticket_range).forEach(t => soldSet.add(t)));

    for (let t of entryTickets) {
        if (soldSet.has(t)) {
            alert(`DUPLICATE ENTRY!\nTicket '${t}' has already been sold on ${date} for ${item}.`);
            return false;
        }
    }

    pendingBatchTickets.push({ 
        date, 
        code, 
        name: document.getElementById('sale-seller-name').value, 
        item, 
        series, 
        ticket_range: ticketRangeStr, 
        qty: parseInt(document.getElementById('sale-qty').value) || calc.qty, 
        price_raw: parseFloat(document.getElementById('sale-price').value.replace('₹', '')) || (calc.qty * activeSaleSetPrice), 
        mlot_id: currentMlotId || localStorage.getItem('currentMlotId')
    });

    document.getElementById('batch-count').innerText = pendingBatchTickets.length;
    document.getElementById('sale-from').value = ''; 
    document.getElementById('sale-to').value = '';
    calculateSalePrice();
    return true;
}

function openShowTicketModal() {
    const tbody = document.getElementById('ticket-preview-tbody');
    const tfoot = document.getElementById('ticket-preview-tfoot');
    tbody.innerHTML = ''; let q = 0, p = 0;

    if (pendingBatchTickets.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="p-4 text-center text-slate-400">No tickets in batch. Add entries first.</td></tr>`;
        tfoot.innerHTML = `<tr><td colspan="6" class="p-2 text-right font-bold">Total:</td><td class="p-2 font-bold text-emerald-600">0</td><td colspan="2" class="p-2 font-bold text-indigo-600">₹0.00</td></tr>`;
    } else {
        pendingBatchTickets.forEach((t, i) => {
            q += t.qty; p += t.price_raw;
            tbody.innerHTML += `
                <tr class="border-b border-slate-100">
                    <td class="p-2">${i+1}</td>
                    <td class="p-2 font-semibold text-indigo-600">${t.code}</td>
                    <td class="p-2">${t.name}</td>
                    <td class="p-2">${t.item}</td>
                    <td class="p-2 font-bold">${t.series}</td>
                    <td class="p-2 font-mono text-[10px]">${t.ticket_range}</td>
                    <td class="p-2 text-emerald-600 font-bold">${t.qty}</td>
                    <td class="p-2 font-bold">₹${Number(t.price_raw).toFixed(2)}</td>
                    <td class="p-2 text-center">
                        <button type="button" onclick="pendingBatchTickets.splice(${i},1); document.getElementById('batch-count').innerText = pendingBatchTickets.length; openShowTicketModal();" class="text-red-500 hover:text-red-700">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
        tfoot.innerHTML = `<tr><td colspan="6" class="p-2 text-right font-bold">Total:</td><td class="p-2 font-bold text-emerald-600">${q}</td><td colspan="2" class="p-2 font-bold text-indigo-600">₹${p.toFixed(2)}</td></tr>`;
    }
    toggleModal('show-ticket-modal', true);
}

async function submitTicketEntries() {
    try {
        if (!currentMlotId) currentMlotId = localStorage.getItem('currentMlotId');
        if (!currentMlotId) {
            alert("Error: MLOT session missing. Please log in again.");
            return;
        }

        if (pendingBatchTickets.length === 0) {
            const code = document.getElementById('sale-seller-code')?.value;
            const group = document.getElementById('sale-group')?.value.trim();
            const fromStr = document.getElementById('sale-from')?.value.trim();

            if (code && group && fromStr) {
                const added = await addCurrentEntryToList();
                if (!added) return;
            }
        }

        if (pendingBatchTickets.length === 0) {
            alert("No tickets to submit! Please enter tickets and add to batch first.");
            return;
        }

        const cleanPayload = pendingBatchTickets.map(t => ({
            date: formatToDBDate(t.date),
            code: String(t.code),
            name: String(t.name),
            item: String(t.item),
            series: String(t.series),
            ticket_range: String(t.ticket_range),
            qty: parseInt(t.qty) || 0,
            price_raw: parseFloat(t.price_raw) || 0.00,
            mlot_id: String(currentMlotId)
        }));

        const { error } = await _supabase.from('sales_records').insert(cleanPayload);
        if (error) {
            alert("Database Error (" + error.code + "): " + error.message);
            return;
        }

        alert("Tickets allocated and saved successfully!");
        pendingBatchTickets = [];
        document.getElementById('batch-count').innerText = '0';
        closeShowTicketModal();
        switchTab('sale');

    } catch (err) {
        alert("Unexpected error: " + err.message);
    }
}

// ================= UNSOLD TICKETS =================
function openUnsoldTicketPage() {
    openSubPage('page-unsold-ticket');
    document.getElementById('unsold-date').value = getISODateString();
    document.getElementById('unsold-q-date').value = getISODateString();
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
    if (!code) { nameInput.value = ""; activeQuickUnsoldSetPrice = 6.50; return; }
    const { data } = await _supabase.from('sellers').select('name, set_price').eq('mlot_id', currentMlotId).eq('code', code).single();
    nameInput.value = data ? data.name : "";
    activeQuickUnsoldSetPrice = (data && data.set_price) ? data.set_price : 6.50;
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
                pendingUnsoldBatch.push({ 
                    date: formatToDBDate(document.getElementById('unsold-date').value || getISODateString()), 
                    code, 
                    name: document.getElementById('unsold-seller-name').value, 
                    item: document.getElementById('unsold-item').value, 
                    series, 
                    ticket_range: ticketRangeStr, 
                    qty: calc.qty, 
                    price_raw: calc.qty * activeUnsoldSetPrice, 
                    mlot_id: currentMlotId || localStorage.getItem('currentMlotId')
                });
                document.getElementById('unsold-batch-count').innerText = pendingUnsoldBatch.length;
            }
        }
    }
}

function addUnsoldEntryToBatch() {
    const date = formatToDBDate(document.getElementById('unsold-date').value || getISODateString());
    const code = document.getElementById('unsold-seller-code').value;
    const item = document.getElementById('unsold-item').value;
    const series = document.getElementById('unsold-series').value;
    const group = document.getElementById('unsold-group').value.trim().toUpperCase();
    const fromStr = document.getElementById('unsold-from').value.trim();
    const toStr = document.getElementById('unsold-to').value.trim();

    if (!code || !group || !fromStr) { alert("Provide Code, Group, and From number."); return; }
    const calc = parseRangeQuantity(series, fromStr, toStr);
    if (calc.error) { alert("Invalid range."); return; }

    let ticketRangeStr = formatTicketRangeString(group, parseInt(fromStr), calc.actualToVal);

    let exists = pendingUnsoldBatch.some(u => u.code === code && u.item === item && u.date === date && u.ticket_range === ticketRangeStr);
    if (exists) {
        alert("DUPLICATE ENTRY!\nThis unsold range is already added to the batch.");
        return;
    }

    pendingUnsoldBatch.push({ 
        date, 
        code, 
        name: document.getElementById('unsold-seller-name').value, 
        item, 
        series, 
        ticket_range: ticketRangeStr, 
        qty: calc.qty, 
        price_raw: calc.qty * activeUnsoldSetPrice, 
        mlot_id: currentMlotId || localStorage.getItem('currentMlotId')
    });

    document.getElementById('unsold-batch-count').innerText = pendingUnsoldBatch.length;
    document.getElementById('unsold-from').value = ''; 
    document.getElementById('unsold-to').value = '';
    calculateUnsoldPrice();
}

async function submitUnsoldDetailed(event) {
    event.preventDefault();
    if (pendingUnsoldBatch.length === 0) { 
        handleUnsoldBlurAutoDraft(); 
        if (pendingUnsoldBatch.length === 0) { 
            alert("No unsold entries added."); 
            return; 
        } 
    }

    const payload = pendingUnsoldBatch.map(item => ({
        date: formatToDBDate(item.date),
        code: String(item.code),
        name: String(item.name),
        item: String(item.item),
        series: String(item.series),
        ticket_range: String(item.ticket_range),
        qty: parseInt(item.qty) || 0,
        price_raw: parseFloat(item.price_raw) || 0.00,
        mlot_id: String(currentMlotId)
    }));

    const { error } = await _supabase.from('unsold_records').insert(payload);
    if (error) {
        alert("Error saving unsold tickets: " + error.message);
    } else {
        alert("Unsold entries saved successfully!");
        pendingUnsoldBatch = [];
        document.getElementById('unsold-batch-count').innerText = '0';
        document.getElementById('form-unsold-detailed').reset();
        document.getElementById('unsold-date').value = getISODateString();
    }
}

async function submitUnsoldQuickEntry(event) {
    event.preventDefault();
    const code = document.getElementById('unsold-q-seller-code').value;
    const qty = parseInt(document.getElementById('unsold-q-qty').value) || 0;
    if (!code || qty <= 0) { alert("Select seller code and valid quantity."); return; }

    const quickEntry = { 
        date: formatToDBDate(document.getElementById('unsold-q-date').value || getISODateString()), 
        code: String(code), 
        name: String(document.getElementById('unsold-q-seller-name').value), 
        item: String(document.getElementById('unsold-q-item').value), 
        series: 'QUICK', 
        ticket_range: `Quick Qty: ${qty}`, 
        qty: parseInt(qty), 
        price_raw: parseFloat(qty * activeQuickUnsoldSetPrice), 
        is_quick: true, 
        mlot_id: String(currentMlotId) 
    };

    const { error } = await _supabase.from('pending_unsold').insert([quickEntry]);
    if (error) alert("Error: " + error.message);
    else {
        alert("Quick unsold request submitted for verification!");
        document.getElementById('form-unsold-quick').reset();
        document.getElementById('unsold-q-date').value = getISODateString();
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
    const date = formatToDBDate(document.getElementById('s-unsold-date').value || getISODateString());
    const item = document.getElementById('s-unsold-item').value;
    const series = document.getElementById('s-unsold-series').value;
    const group = document.getElementById('s-unsold-group').value.trim().toUpperCase();
    const fromStr = document.getElementById('s-unsold-from').value.trim();
    const toStr = document.getElementById('s-unsold-to').value.trim();

    const calc = parseRangeQuantity(series, fromStr, toStr);
    if (calc.error) { alert("Invalid range."); return; }

    let ticketRangeStr = formatTicketRangeString(group, parseInt(fromStr), calc.actualToVal);
    const { data: sData } = await _supabase.from('sellers').select('name').eq('mlot_id', currentMlotId).eq('code', currentSellerCode).single();
    
    const pendingEntry = { 
        date, 
        code: currentSellerCode, 
        name: sData ? sData.name : currentSellerCode, 
        item, 
        series, 
        ticket_range: ticketRangeStr, 
        qty: calc.qty, 
        price_raw: calc.qty * activeSellerUnsoldSetPrice, 
        mlot_id: currentMlotId 
    };

    const { error } = await _supabase.from('pending_unsold').insert([pendingEntry]);
    if(error) alert("Error: " + error.message);
    else {
        alert("Unsold tickets sent to Mlot User for verification!");
        document.getElementById('form-seller-unsold').reset();
        document.getElementById('s-unsold-date').value = getISODateString();
        updatePendingUnsoldBadge();
        openSellerAccountHome();
    }
}

async function submitSellerUnsoldQuickEntry(event) {
    event.preventDefault();
    const qty = parseInt(document.getElementById('s-unsold-q-qty').value) || 0;
    if (qty <= 0) { alert("Enter valid quantity."); return; }

    const { data: sData } = await _supabase.from('sellers').select('name').eq('mlot_id', currentMlotId).eq('code', currentSellerCode).single();
    const pendingEntry = { 
        date: formatToDBDate(document.getElementById('s-unsold-q-date').value || getISODateString()), 
        code: currentSellerCode, 
        name: sData ? sData.name : currentSellerCode, 
        item: document.getElementById('s-unsold-q-item').value, 
        series: 'QUICK', 
        ticket_range: `Quick Qty: ${qty}`, 
        qty, 
        price_raw: qty * activeSellerUnsoldSetPrice, 
        is_quick: true, 
        mlot_id: currentMlotId 
    };

    const { error } = await _supabase.from('pending_unsold').insert([pendingEntry]);
    if (error) alert("Error: " + error.message);
    else {
        alert("Quick unsold request sent to MLOT user successfully!");
        document.getElementById('form-seller-unsold-quick').reset();
        document.getElementById('s-unsold-q-date').value = getISODateString();
        openSellerAccountHome();
    }
}

// ================= GENERAL CRUD & MISC =================
function openAddSellerPage() {
    openSubPage('page-add-seller');
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
    const { error } = await _supabase.from('sellers').insert([{ 
        code: tempSellerData.code, 
        name: tempSellerData.name, 
        phone: tempSellerData.mob, 
        area: tempSellerData.area, 
        set_price: parseFloat(tempSellerData.setPrice), 
        previous_due: parseFloat(tempSellerData.previousDue), 
        today_payment: 0.00, 
        date_payments: {}, 
        mlot_id: currentMlotId 
    }]);
    if (error) alert("Error: " + error.message);
    else { 
        alert("Seller created successfully!"); 
        document.getElementById('form-add-seller').reset(); 
        switchTab('sale'); 
    }
}

async function renderMasterAndSaleTables() {
    const saleDateFilter = formatToDBDate(document.getElementById('sale-page-filter-date').value || getISODateString());
    const { data: sellers } = await _supabase.from('sellers').select('*').eq('mlot_id', currentMlotId);
    const { data: sales } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId);
    const { data: unsold } = await _supabase.from('unsold_records').select('*').eq('mlot_id', currentMlotId);
    const todayStr = formatToDBDate(getISODateString());

    const masterList = document.getElementById('master-seller-list');
    const saleBody = document.getElementById('sale-table-body');
    if (masterList) masterList.innerHTML = ''; 
    if (saleBody) saleBody.innerHTML = '';

    if (!sellers || sellers.length === 0) {
        if (masterList) masterList.innerHTML = `<div class="p-4 bg-white rounded-2xl text-center text-xs text-slate-400">No sellers registered.</div>`;
        if (saleBody) saleBody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-slate-400">No records available.</td></tr>`;
        return;
    }

    sellers.forEach((s, idx) => {
        const slNo = String(idx + 1).padStart(2, '0');
        const sSales = (sales || []).filter(t => t.code === s.code);
        const sUnsold = (unsold || []).filter(t => t.code === s.code);
        const todayDue = sSales.filter(t => formatToDBDate(t.date || todayStr) === todayStr).reduce((a, c) => a + c.price_raw, 0) - sUnsold.filter(t => formatToDBDate(t.date || todayStr) === todayStr).reduce((a, c) => a + c.price_raw, 0);
        const totalBalance = (s.previous_due || 0) + todayDue - (s.today_payment || 0);

        if (masterList) {
            masterList.innerHTML += `<div class="bg-white p-3 rounded-2xl shadow-sm border border-slate-200 flex items-center justify-between"><div class="flex items-center space-x-3 cursor-pointer" onclick="openSellerDetailModal('${s.code}')"><div class="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs">${slNo}</div><div><h4 class="text-xs font-bold text-slate-800">${s.name} <span class="text-[10px] text-indigo-600 font-normal">#${s.code}</span></h4><p class="text-[10px] text-slate-500">Total Balance: <span class="font-bold text-red-600">₹${totalBalance.toFixed(2)}</span></p></div></div><div class="flex items-center space-x-2"><a href="tel:${s.phone || ''}" class="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xs"><i class="fa-solid fa-phone"></i></a><a href="https://wa.me/${s.phone || ''}" target="_blank" class="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center text-xs"><i class="fa-brands fa-whatsapp"></i></a></div></div>`;
        }
        if (saleBody) {
            const dSales = sSales.filter(t => formatToDBDate(t.date || todayStr) === saleDateFilter);
            const dUnsold = sUnsold.filter(t => formatToDBDate(t.date || todayStr) === saleDateFilter);
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
    const todayStr = formatToDBDate(getISODateString());
    let totalBalance = (s.previous_due || 0) + ((sales || []).filter(t => formatToDBDate(t.date || todayStr) === todayStr).reduce((a, c) => a + c.price_raw, 0) - (unsold || []).filter(t => formatToDBDate(t.date || todayStr) === todayStr).reduce((a, c) => a + c.price_raw, 0)) - (s.today_payment || 0);

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
        await _supabase.from('sellers').update({ 
            name: document.getElementById('edit-s-name').value.trim(), 
            phone: document.getElementById('edit-s-mob').value.trim(), 
            area: document.getElementById('edit-s-area').value.trim() 
        }).eq('mlot_id', currentMlotId).eq('code', currentlyViewingSellerCode);
        
        isEditingSeller = false; 
        alert("Updated successfully!"); 
        renderSellerDetailModalContent(); 
        renderMasterAndSaleTables();
    }
}

async function openSaleReportModal() {
    const todayStr = getISODateString();
    document.getElementById('report-from-date').value = todayStr;
    document.getElementById('report-to-date').value = todayStr;
    const select = document.getElementById('report-filter-seller');
    const { data: sellers } = await _supabase.from('sellers').select('code, name').eq('mlot_id', currentMlotId);
    select.innerHTML = '<option value="">All Sellers (General Report)</option>';
    (sellers || []).forEach(s => select.appendChild(new Option(`${s.code} - ${s.name}`, s.code)));
    filterSaleReport();
    toggleModal('sale-report-modal', true);
}

function closeSaleReportModal() { toggleModal('sale-report-modal', false); }

async function filterSaleReport() {
    const f = document.getElementById('report-from-date').value;
    const to = document.getElementById('report-to-date').value;
    const selectedCode = document.getElementById('report-filter-seller').value;
    const { data: sales } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId);
    const tbody = document.getElementById('report-table-tbody');
    const tfoot = document.getElementById('report-table-tfoot');
    tbody.innerHTML = '';

    let fromComp = convertDateToComparable(f), toComp = convertDateToComparable(to);
    let filtered = (sales || []).filter(t => {
        let itemComp = convertDateToComparable(t.date || formatToDBDate(getISODateString()));
        let matchDate = itemComp >= fromComp && itemComp <= toComp;
        let matchCode = selectedCode ? t.code === selectedCode : true;
        return matchDate && matchCode;
    });

    let q = 0, p = 0;
    if (filtered.length === 0) { tbody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-slate-400">No records found.</td></tr>`; } 
    else {
        filtered.forEach(t => {
            q += t.qty; p += t.price_raw;
            tbody.innerHTML += `<tr class="border-b border-slate-100"><td class="p-2 text-[10px]">${t.date}</td><td class="p-2 font-semibold text-indigo-600">${t.code}</td><td class="p-2">${t.name}</td><td class="p-2">${t.item}</td><td class="p-2 font-bold">${t.series}</td><td class="p-2 font-mono text-[10px]">${t.ticket_range}</td><td class="p-2 text-emerald-600 font-bold">${t.qty}</td><td class="p-2 font-bold">₹${Number(t.price_raw).toFixed(2)}</td></tr>`;
        });
    }
    tfoot.innerHTML = `<tr><td colspan="6" class="p-2 text-right font-bold">Total:</td><td class="p-2 font-bold text-emerald-600">${q}</td><td colspan="2" class="p-2 font-bold text-indigo-600">₹${p.toFixed(2)}</td></tr>`;
}

async function generateSaleReportPDFDoc() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const f = document.getElementById('report-from-date').value || getISODateString();
    const to = document.getElementById('report-to-date').value || getISODateString();
    const selectedCode = document.getElementById('report-filter-seller').value;
    const { data: mlotData } = await _supabase.from('mlot_users').select('*').eq('mlot_id', currentMlotId).maybeSingle();

    let sellerNameStr = "";
    let sellerPhoneStr = "";

    if (selectedCode) {
        const { data: sData } = await _supabase.from('sellers').select('*').eq('mlot_id', currentMlotId).eq('code', selectedCode).maybeSingle();
        if (sData) {
            sellerNameStr = sData.name;
            sellerPhoneStr = sData.phone || "";
        }
    }

    doc.setFontSize(9);
    doc.text(`Generated Date: ${formatToDBDate(getISODateString())}`, 14, 15);
    doc.setFontSize(13);
    doc.text(selectedCode ? `Seller Name: ${sellerNameStr} (${selectedCode})` : `${mlotData?.business_name || 'MLOT'} - Sale Report`, 105, 15, { align: 'center' });
    doc.setFontSize(9);
    if (sellerPhoneStr) doc.text(`Contact: ${sellerPhoneStr}`, 105, 21, { align: 'center' });
    doc.text(`Report Period: ${formatToDBDate(f)} to ${formatToDBDate(to)}`, 14, 27);

    const { data: sales } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId);
    let fromComp = convertDateToComparable(f), toComp = convertDateToComparable(to);
    let filtered = (sales || []).filter(t => {
        let itemComp = convertDateToComparable(t.date);
        return itemComp >= fromComp && itemComp <= toComp && (selectedCode ? t.code === selectedCode : true);
    });

    let tableRows = []; let totalQ = 0, totalP = 0;
    filtered.forEach((t, index) => {
        totalQ += t.qty; totalP += t.price_raw;
        tableRows.push([index + 1, t.date, t.code, t.name, t.item, t.series, t.ticket_range, t.qty, `₹${Number(t.price_raw).toFixed(2)}`]);
    });

    doc.autoTable({
        startY: 32,
        head: [['Sl', 'Date', 'Code', 'Name', 'Item', 'Series', 'Range', 'Qty', 'Price']],
        body: tableRows,
        foot: [['', '', '', '', '', '', 'Total:', totalQ, `₹${totalP.toFixed(2)}`]],
        theme: 'grid',
        headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 2 }
    });

    return { doc, selectedCode, sellerName: sellerNameStr, sellerPhone: sellerPhoneStr };
}

async function downloadSaleReportPDF() {
    const reportData = await generateSaleReportPDFDoc();
    const fileName = reportData.selectedCode ? `SaleReport_${reportData.selectedCode}.pdf` : `SaleReport_General.pdf`;
    openPDFDirectly(reportData.doc, fileName);
}

async function sendSaleReportToWhatsApp() {
    const reportData = await generateSaleReportPDFDoc();
    if (!reportData.selectedCode) {
        alert("Please select a specific Seller Code from the dropdown to send via WhatsApp!");
        return;
    }
    if (!reportData.sellerPhone) {
        alert(`No mobile number registered for seller ${reportData.selectedCode}.`);
        return;
    }

    try {
        const dataUri = reportData.doc.output('datauristring');
        const pdfBase64 = dataUri.split(',')[1];
        const fileName = `SaleReport_${reportData.selectedCode}.pdf`;

        if (window.AndroidBridge && typeof window.AndroidBridge.sharePDFToWhatsApp === 'function') {
            window.AndroidBridge.sharePDFToWhatsApp(pdfBase64, fileName, reportData.sellerPhone);
        } else {
            const cleanPhone = reportData.sellerPhone.replace(/[^0-9]/g, '');
            const phoneWithCode = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
            window.open(`https://wa.me/${phoneWithCode}?text=Hello%20${encodeURIComponent(reportData.sellerName)},%20please%20find%20your%20latest%20Sale%20Report.`, '_blank');
        }
    } catch (e) {
        alert("WhatsApp share error: " + e.message);
    }
}

// ================= TRACKERS & VERIFICATIONS =================
function openSoldTicketPage() {
    openSubPage('page-sold-ticket');
    document.getElementById('sold-filter-date').value = getISODateString();
    renderSoldTicketSellers();
}

async function renderSoldTicketSellers() {
    const dateFilter = formatToDBDate(document.getElementById('sold-filter-date').value);
    const grid = document.getElementById('sold-sellers-grid');
    grid.innerHTML = '';
    const { data: sales } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId);
    
    let filteredSales = (sales || []).filter(s => formatToDBDate(s.date) === dateFilter);
    if (filteredSales.length === 0) { 
        grid.innerHTML = `<div class="col-span-3 text-center p-4 text-xs text-slate-400">No sold tickets found on ${dateFilter}.</div>`; 
        return; 
    }

    let summary = {};
    filteredSales.forEach(s => {
        if (!summary[s.code]) summary[s.code] = { name: s.name, qty: 0, amt: 0 };
        summary[s.code].qty += s.qty; summary[s.code].amt += s.price_raw;
    });

    Object.keys(summary).forEach(code => {
        grid.innerHTML += `<div class="bg-emerald-50 p-2.5 rounded-xl border border-emerald-100 flex flex-col items-center justify-center text-center shadow-sm cursor-pointer" onclick="openSellerSoldDetail('${code}', '${dateFilter}')"><span class="text-[10px] font-bold text-emerald-700">${code}</span><span class="text-[9px] text-slate-500 truncate w-full">${summary[code].name}</span><span class="text-xs font-extrabold text-slate-800 mt-1">${summary[code].qty}</span><span class="text-[9px] font-bold text-emerald-600 mt-0.5">₹${summary[code].amt.toFixed(2)}</span></div>`;
    });
}

async function openSellerSoldDetail(code, date) {
    const { data } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId).eq('code', code);
    const tbody = document.getElementById('seller-detail-tbody');
    const tfoot = document.getElementById('seller-detail-tfoot');
    document.getElementById('detail-modal-title').innerText = `Sold Detail: ${code}`;
    document.getElementById('detail-modal-subtitle').innerText = `Date: ${date}`;
    tbody.innerHTML = ''; 
    let q = 0, p = 0;

    (data || []).filter(t => formatToDBDate(t.date) === date).forEach((t, i) => {
        q += t.qty; p += t.price_raw;
        tbody.innerHTML += `<tr class="border-b border-slate-100"><td class="p-2">${i+1}</td><td class="p-2">${t.item}</td><td class="p-2 font-bold">${t.series}</td><td class="p-2 font-mono text-[10px]">${t.ticket_range}</td><td class="p-2 text-emerald-600 font-bold">${t.qty}</td><td class="p-2 font-bold">₹${Number(t.price_raw).toFixed(2)}</td></tr>`;
    });
    tfoot.innerHTML = `<tr><td colspan="4" class="p-2 text-right font-bold">Total:</td><td class="p-2 font-bold text-emerald-600">${q}</td><td colspan="2" class="p-2 font-bold text-indigo-600">₹${p.toFixed(2)}</td></tr>`;
    toggleModal('seller-sold-detail-modal', true);
}

function closeSellerSoldDetail() { toggleModal('seller-sold-detail-modal', false); }

function openShowAllUnsoldModal() {
    document.getElementById('unsold-tracker-filter-date').value = getISODateString();
    renderAllUnsoldGrid();
    toggleModal('show-all-unsold-modal', true);
}

function closeShowAllUnsoldModal() { toggleModal('show-all-unsold-modal', false); }

async function renderAllUnsoldGrid() {
    const dateFilter = formatToDBDate(document.getElementById('unsold-tracker-filter-date').value);
    const grid = document.getElementById('unsold-sellers-grid');
    grid.innerHTML = '';
    const { data: unsold } = await _supabase.from('unsold_records').select('*').eq('mlot_id', currentMlotId);

    let filtered = (unsold || []).filter(u => dateFilter ? formatToDBDate(u.date) === dateFilter : true);
    if (filtered.length === 0) { 
        grid.innerHTML = `<div class="col-span-3 text-center p-4 text-xs text-slate-400">No unsold returns found.</div>`; 
        return; 
    }

    let summary = {};
    filtered.forEach(s => {
        if (!summary[s.code]) summary[s.code] = { name: s.name, qty: 0, amt: 0 };
        summary[s.code].qty += s.qty; summary[s.code].amt += s.price_raw;
    });

    Object.keys(summary).forEach(code => {
        grid.innerHTML += `<div class="bg-amber-50 p-2.5 rounded-xl border border-amber-100 flex flex-col items-center justify-center text-center shadow-sm cursor-pointer" onclick="openSellerUnsoldDetail('${code}', '${dateFilter}')"><span class="text-[10px] font-bold text-amber-700">${code}</span><span class="text-[9px] text-slate-500 truncate w-full">${summary[code].name}</span><span class="text-xs font-extrabold text-slate-800 mt-1">${summary[code].qty}</span><span class="text-[9px] font-bold text-amber-600 mt-0.5">₹${summary[code].amt.toFixed(2)}</span></div>`;
    });
}

async function openSellerUnsoldDetail(code, date) {
    const { data } = await _supabase.from('unsold_records').select('*').eq('mlot_id', currentMlotId).eq('code', code);
    const tbody = document.getElementById('seller-unsold-detail-tbody');
    const tfoot = document.getElementById('seller-unsold-detail-tfoot');
    document.getElementById('unsold-detail-modal-title').innerText = `Unsold Detail: ${code}`;
    tbody.innerHTML = ''; 
    let q = 0, p = 0;

    (data || []).filter(t => date ? formatToDBDate(t.date) === date : true).forEach(t => {
        q += t.qty; p += t.price_raw;
        tbody.innerHTML += `<tr class="border-b border-slate-100"><td class="p-2 text-[10px]">${t.date}</td><td class="p-2">${t.item}</td><td class="p-2 font-bold">${t.series}</td><td class="p-2 font-mono text-[10px]">${t.ticket_range}</td><td class="p-2 text-amber-600 font-bold">${t.qty}</td><td class="p-2 font-bold">₹${Number(t.price_raw).toFixed(2)}</td></tr>`;
    });
    tfoot.innerHTML = `<tr><td colspan="4" class="p-2 text-right font-bold">Total:</td><td class="p-2 font-bold text-amber-600">${q}</td><td colspan="2" class="p-2 font-bold text-indigo-600">₹${p.toFixed(2)}</td></tr>`;
    toggleModal('seller-unsold-detail-modal', true);
}

function closeSellerUnsoldDetail() { toggleModal('seller-unsold-detail-modal', false); }

async function updatePendingUnsoldBadge() {
    const { count } = await _supabase.from('pending_unsold').select('*', { count: 'exact', head: true }).eq('mlot_id', currentMlotId);
    const badge = document.getElementById('pending-unsold-badge');
    if (badge) badge.innerText = count || 0;
}

async function openVerifyUnsoldModal() {
    const { data } = await _supabase.from('pending_unsold').select('*').eq('mlot_id', currentMlotId);
    const container = document.getElementById('verify-unsold-list');
    container.innerHTML = '';

    if (!data || data.length === 0) {
        container.innerHTML = `<div class="p-4 text-center text-xs text-slate-400">No pending unsold tickets.</div>`;
        toggleModal('verify-unsold-modal', true);
        return;
    }

    data.forEach((item) => {
        container.innerHTML += `
            <div class="bg-slate-50 p-3 rounded-xl border border-slate-200 flex justify-between items-center text-xs">
                <div>
                    <span class="font-bold text-indigo-600">${item.code} (${item.name})</span>
                    <p class="text-[10px] text-slate-500">${item.date} | ${item.item} | ${item.series} | ${item.ticket_range}</p>
                    <p class="text-[10px] font-bold text-amber-600">Qty: ${item.qty} | Amt: ₹${Number(item.price_raw).toFixed(2)}</p>
                </div>
                <div class="flex gap-1">
                    <button onclick="verifySingleUnsold('${item.id}')" class="px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg font-bold text-[10px]">Verify</button>
                    <button onclick="rejectSingleUnsold('${item.id}')" class="px-2.5 py-1.5 bg-red-600 text-white rounded-lg font-bold text-[10px]">Reject</button>
                </div>
            </div>
        `;
    });
    toggleModal('verify-unsold-modal', true);
}

function closeVerifyUnsoldModal() { toggleModal('verify-unsold-modal', false); }

async function verifySingleUnsold(id) {
    const { data: item } = await _supabase.from('pending_unsold').select('*').eq('id', id).single();
    if (!item) return;

    await _supabase.from('unsold_records').insert([{
        date: formatToDBDate(item.date), 
        code: item.code, 
        name: item.name, 
        item: item.item,
        series: item.series, 
        ticket_range: item.ticket_range, 
        qty: item.qty, 
        price_raw: item.price_raw, 
        mlot_id: item.mlot_id
    }]);

    if (item.is_quick) {
        const { data: seller } = await _supabase.from('sellers').select('*').eq('mlot_id', currentMlotId).eq('code', item.code).single();
        if (seller) {
            await _supabase.from('sellers').update({ today_payment: (seller.today_payment || 0) + (item.price_raw || 0) }).eq('mlot_id', currentMlotId).eq('code', item.code);
        }
    }

    await _supabase.from('pending_unsold').delete().eq('id', id);
    alert("Unsold ticket verified and officially recorded!");
    updatePendingUnsoldBadge();
    openVerifyUnsoldModal();
    renderMasterAndSaleTables();
}

async function rejectSingleUnsold(id) {
    if (!confirm("Are you sure you want to reject this unsold ticket request?")) return;
    const { error } = await _supabase.from('pending_unsold').delete().eq('id', id);
    if (error) { alert("Error: " + error.message); } 
    else { alert("Unsold request rejected!"); updatePendingUnsoldBadge(); openVerifyUnsoldModal(); }
}

async function openPaymentHistoryPage() {
    openSubPage('page-payment-history');
    renderMlotPaymentHistoryTable();
}

async function renderMlotPaymentHistoryTable() {
    const { data } = await _supabase.from('payments').select('*').eq('mlot_id', currentMlotId);
    const tbody = document.getElementById('mlot-payment-history-tbody');
    tbody.innerHTML = '';
    if (!data || data.length === 0) { tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">No payment submissions found.</td></tr>`; return; }

    data.forEach((p) => {
        let screenshotBtn = p.screenshot ? `<button onclick="viewScreenshot('${p.screenshot}')" class="text-indigo-600 font-bold underline">View</button>` : 'No Image';
        let actionHtml = p.status === 'Pending' ? `<button onclick="approvePayment('${p.id}', '${p.code}', ${p.paid_amount}, '${p.date}')" class="px-2 py-1 bg-emerald-600 text-white rounded text-[10px] mr-1">Approve</button><button onclick="rejectPayment('${p.id}')" class="px-2 py-1 bg-red-600 text-white rounded text-[10px]">Reject</button>` : `<span class="text-[10px] font-bold px-2 py-0.5 rounded ${p.status === 'Approved' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}">${p.status}</span>`;
        tbody.innerHTML += `<tr class="border-b border-slate-100"><td class="p-2.5 text-[10px] text-slate-500">${p.date}</td><td class="p-2.5 font-semibold text-indigo-600">${p.code}</td><td class="p-2.5 font-bold">₹${Number(p.total_due).toFixed(2)}</td><td class="p-2.5 font-bold text-emerald-600">₹${Number(p.paid_amount).toFixed(2)}</td><td class="p-2.5 text-center">${screenshotBtn}</td><td class="p-2.5 text-center">${actionHtml}</td></tr>`;
    });
}

function viewScreenshot(url) { document.getElementById('screenshot-img-preview').src = url; toggleModal('view-screenshot-modal', true); }
function closeScreenshotModal() { toggleModal('view-screenshot-modal', false); }

async function approvePayment(id, code, paidAmt, payDate) {
    await _supabase.from('payments').update({ status: 'Approved' }).eq('id', id);
    const { data: s } = await _supabase.from('sellers').select('*').eq('mlot_id', currentMlotId).eq('code', code).single();
    if (s) {
        let datePayments = s.date_payments || {};
        datePayments[payDate] = (datePayments[payDate] || 0) + paidAmt;
        const todayStr = formatToDBDate(getISODateString());
        await _supabase.from('sellers').update({ today_payment: payDate === todayStr ? ((s.today_payment || 0) + paidAmt) : s.today_payment, date_payments: datePayments }).eq('mlot_id', currentMlotId).eq('code', code);
    }
    alert("Payment approved!");
    renderMlotPaymentHistoryTable();
    renderMasterAndSaleTables();
}

async function rejectPayment(id) {
    await _supabase.from('payments').update({ status: 'Rejected' }).eq('id', id);
    alert("Payment rejected.");
    renderMlotPaymentHistoryTable();
}

// ================= PURCHASE TICKETS & LEDGER =================
async function openMlotPurchaseTicketPage() {
    openSubPage('page-mlot-purchase-ticket');
    const filterDateInput = document.getElementById('mlot-purchase-filter-date');
    if (!filterDateInput.value) { filterDateInput.value = getISODateString(); }
    renderMlotPurchaseTicketTable();
}

async function renderMlotPurchaseTicketTable() {
    const filterDate = formatToDBDate(document.getElementById('mlot-purchase-filter-date').value || getISODateString());
    const { data } = await _supabase.from('purchase_store').select('*').eq('mlot_id', currentMlotId);
    const tbody = document.getElementById('mlot-purchase-ticket-tbody');
    tbody.innerHTML = '';
    
    let filtered = (data || []).filter(p => formatToDBDate(p.date) === filterDate);
    if (filtered.length === 0) { 
        tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">No purchase records found for ${filterDate}.</td></tr>`; 
        return; 
    }

    filtered.forEach(p => {
        tbody.innerHTML += `<tr class="border-b border-slate-100"><td class="p-3 text-[10px] text-slate-500">${p.date}</td><td class="p-3">${p.item}</td><td class="p-3 font-bold">${p.series}</td><td class="p-3 font-mono text-[10px]">${p.ticket_range}</td><td class="p-3 text-purple-600 font-bold">${p.qty}</td><td class="p-3 font-bold">₹${Number(p.cost_raw).toFixed(2)}</td></tr>`;
    });
}

async function renderSellerLedger() {
    const dateFilter = formatToDBDate(document.getElementById('seller-ledger-filter-date').value || getISODateString());
    const { data: s } = await _supabase.from('sellers').select('*').eq('mlot_id', currentMlotId).eq('code', currentSellerCode).single();
    const { data: sales } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId).eq('code', currentSellerCode);
    const { data: unsold } = await _supabase.from('unsold_records').select('*').eq('mlot_id', currentMlotId).eq('code', currentSellerCode);
    if (!s) return;

    let dayDue = (sales || []).filter(t => formatToDBDate(t.date) === dateFilter).reduce((acc, c) => acc + c.price_raw, 0) - (unsold || []).filter(t => formatToDBDate(t.date) === dateFilter).reduce((acc, c) => acc + c.price_raw, 0);
    let dueBalance = (s.previous_due || 0) + dayDue - ((s.date_payments || {})[dateFilter] || 0);

    document.getElementById('s-ledger-prev').innerText = `₹${(s.previous_due || 0).toFixed(2)}`;
    document.getElementById('s-ledger-today').innerText = `₹${dayDue.toFixed(2)}`;
    document.getElementById('s-ledger-pay').innerText = `₹${((s.date_payments || {})[dateFilter] || 0).toFixed(2)}`;
    document.getElementById('s-ledger-balance').innerText = `₹${dueBalance.toFixed(2)}`;
}

async function selectPayType(type) {
    selectedPayModeType = type;
    const btnTotal = document.getElementById('pay-type-total');
    const btnToday = document.getElementById('pay-type-today');
    const { data: s } = await _supabase.from('sellers').select('*').eq('mlot_id', currentMlotId).eq('code', currentSellerCode).single();
    const { data: sales } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId).eq('code', currentSellerCode);
    const { data: unsold } = await _supabase.from('unsold_records').select('*').eq('mlot_id', currentMlotId).eq('code', currentSellerCode);
    const todayStr = formatToDBDate(getISODateString());
    if (!s) return;

    let todayDue = (sales || []).filter(t => formatToDBDate(t.date) === todayStr).reduce((acc, c) => acc + c.price_raw, 0) - (unsold || []).filter(t => formatToDBDate(t.date) === todayStr).reduce((acc, c) => acc + c.price_raw, 0);
    let totalDue = (s.previous_due || 0) + todayDue - (s.today_payment || 0);

    if (type === 'total') {
        btnTotal.className = "py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow-sm";
        btnToday.className = "py-2.5 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold";
        document.getElementById('pay-amount-display').innerText = `₹${totalDue.toFixed(2)}`;
    } else {
        btnToday.className = "py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold";
        btnTotal.className = "py-2.5 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold";
        document.getElementById('pay-amount-display').innerText = `₹${todayDue.toFixed(2)}`;
    }

    const { data: mlotUser } = await _supabase.from('mlot_users').select('upi_id').eq('mlot_id', currentMlotId).maybeSingle();
    if (mlotUser && mlotUser.upi_id) { document.getElementById('mlot-upi-display').innerText = mlotUser.upi_id; }
}

function openDirectUPIApp() {
    const upiId = document.getElementById('mlot-upi-display').innerText.trim() || 'tapasm569@ptyes';
    const amtText = document.getElementById('pay-amount-display').innerText.replace('₹', '').trim();
    window.location.href = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=MLOT%20Master&am=${amtText}&cu=INR`;
}

async function submitSellerPayment(event) {
    event.preventDefault();
    const fileInput = document.getElementById('s-pay-screenshot');
    if (fileInput.files.length === 0) { alert("Payment screenshot is mandatory!"); return; }
    const file = fileInput.files[0];
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = async function() {
            const canvas = document.createElement('canvas');
            canvas.width = 800; canvas.height = (800 / img.width) * img.height;
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            const compressedBase64 = canvas.toDataURL('image/jpeg', 0.6);
            const amt = parseFloat(document.getElementById('pay-amount-display').innerText.replace('₹', '')) || 0;
            const { data: sData } = await _supabase.from('sellers').select('name').eq('mlot_id', currentMlotId).eq('code', currentSellerCode).single();
            await _supabase.from('payments').insert([{ 
                date: formatToDBDate(getISODateString()), 
                code: currentSellerCode, 
                name: sData ? sData.name : currentSellerCode, 
                total_due: amt, 
                paid_amount: amt, 
                screenshot: compressedBase64, 
                status: 'Pending', 
                mlot_id: currentMlotId 
            }]);
            alert("Payment & Screenshot submitted successfully!");
            fileInput.value = '';
            openSellerAccountHome();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function submitPayLater() {
    const amt = parseFloat(document.getElementById('pay-amount-display').innerText.replace('₹', '')) || 0;
    const { data: sData } = await _supabase.from('sellers').select('name').eq('mlot_id', currentMlotId).eq('code', currentSellerCode).single();
    await _supabase.from('payments').insert([{ 
        date: formatToDBDate(getISODateString()), 
        code: currentSellerCode, 
        name: sData ? sData.name : currentSellerCode, 
        total_due: amt, 
        paid_amount: amt, 
        screenshot: null, 
        status: 'Pending', 
        mlot_id: currentMlotId 
    }]);
    alert("Pay Later request submitted successfully!");
    openSellerAccountHome();
}

async function openLedgerBookPage() {
    openSubPage('page-ledger-book');
    document.getElementById('ledger-filter-date').value = getISODateString();
    renderLedgerBookTable();
}

async function renderLedgerBookTable() {
    const dateFilter = formatToDBDate(document.getElementById('ledger-filter-date').value || getISODateString());
    const { data: sellers } = await _supabase.from('sellers').select('*').eq('mlot_id', currentMlotId);
    const { data: sales } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId);
    const { data: unsold } = await _supabase.from('unsold_records').select('*').eq('mlot_id', currentMlotId);
    const tbody = document.getElementById('ledger-table-tbody');
    const tfoot = document.getElementById('ledger-table-tfoot');
    tbody.innerHTML = '';

    let pSum = 0, tSum = 0, paySum = 0, bSum = 0;
    if (!sellers || sellers.length === 0) { 
        tbody.innerHTML = `<tr><td colspan="9" class="p-4 text-center text-slate-400">No sellers registered.</td></tr>`; 
        tfoot.innerHTML = `<tr><td colspan="9" class="p-2 text-center font-bold">Total: ₹0.00</td></tr>`; 
        return; 
    }

    sellers.forEach((s, idx) => {
        const slNo = String(idx + 1).padStart(2, '0');
        const prevDue = s.previous_due || 0;
        const dayPayment = (s.date_payments || {})[dateFilter] !== undefined ? (s.date_payments || {})[dateFilter] : 0.00;
        let todayDue = (sales || []).filter(t => t.code === s.code && formatToDBDate(t.date) === dateFilter).reduce((a, c) => a + c.price_raw, 0) - (unsold || []).filter(t => t.code === s.code && formatToDBDate(t.date) === dateFilter).reduce((a, c) => a + c.price_raw, 0);
        let balance = prevDue + todayDue - dayPayment;

        pSum += prevDue; tSum += todayDue; paySum += dayPayment; bSum += balance;
        tbody.innerHTML += `
            <tr class="border-b border-slate-100">
                <td class="p-2 border border-slate-200">${slNo}</td>
                <td class="p-2 border border-slate-200 text-[10px] text-slate-500">${dateFilter}</td>
                <td class="p-2 border border-slate-200 font-semibold text-indigo-600">${s.code}</td>
                <td class="p-2 border border-slate-200 font-bold">${s.name}</td>
                <td class="p-2 border border-slate-200 font-bold text-red-600">₹${prevDue.toFixed(2)}</td>
                <td class="p-2 border border-slate-200 font-bold text-slate-800">₹${todayDue.toFixed(2)}</td>
                <td class="p-2 border border-slate-200"><input type="number" step="0.01" id="pay-input-${s.code}" value="${dayPayment.toFixed(2)}" disabled onclick="if(this.value==='0.00'||this.value==='0')this.value='';" class="w-16 px-1 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-bold text-emerald-600 text-center"></td>
                <td class="p-2 border border-slate-200 font-extrabold text-indigo-600">₹${balance.toFixed(2)}</td>
                <td class="p-2 border border-slate-200 text-center"><button id="btn-edit-${s.code}" onclick="enableLedgerEdit('${s.code}')" class="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md font-bold text-[10px]">Update</button></td>
            </tr>
        `;
    });
    tfoot.innerHTML = `<tr><td colspan="4" class="p-2 border border-slate-200 text-right font-bold">Total:</td><td class="p-2 border border-slate-200 font-bold text-red-600">₹${pSum.toFixed(2)}</td><td class="p-2 border border-slate-200 font-bold text-slate-800">₹${tSum.toFixed(2)}</td><td class="p-2 border border-slate-200 font-bold text-emerald-600">₹${paySum.toFixed(2)}</td><td colspan="2" class="p-2 border border-slate-200 font-bold text-indigo-600">₹${bSum.toFixed(2)}</td></tr>`;
}

async function enableLedgerEdit(code) {
    const inputField = document.getElementById(`pay-input-${code}`);
    const btn = document.getElementById(`btn-edit-${code}`);
    const dateFilter = formatToDBDate(document.getElementById('ledger-filter-date').value || getISODateString());

    if (btn.innerText === "Update") {
        inputField.disabled = false;
        inputField.className = "w-16 px-1 py-1 bg-white border border-indigo-400 rounded text-xs font-bold text-emerald-600 text-center ring-2 ring-indigo-100";
        inputField.focus();
        btn.innerText = "Save";
        btn.className = "px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md font-bold text-[10px]";
    } else {
        const val = parseFloat(inputField.value) || 0;
        const { data: sellerData } = await _supabase.from('sellers').select('date_payments, today_payment').eq('mlot_id', currentMlotId).eq('code', code).single();
        let datePayments = sellerData && sellerData.date_payments ? sellerData.date_payments : {};
        datePayments[dateFilter] = val;

        const todayStr = formatToDBDate(getISODateString());
        await _supabase.from('sellers').update({ date_payments: datePayments, today_payment: dateFilter === todayStr ? val : sellerData.today_payment }).eq('mlot_id', currentMlotId).eq('code', code);
        inputField.disabled = true;
        inputField.className = "w-16 px-1 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-bold text-emerald-600 text-center";
        btn.innerText = "Update";
        btn.className = "px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-[10px]";
        alert("Payment updated for " + dateFilter + "!");
        renderLedgerBookTable();
    }
}

async function generateLedgerPDFObj() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const dateFilter = formatToDBDate(document.getElementById('ledger-filter-date').value || getISODateString());
    const { data: mlotData } = await _supabase.from('mlot_users').select('*').eq('mlot_id', currentMlotId).maybeSingle();

    doc.setFontSize(10);
    doc.text(`Generated Date: ${formatToDBDate(getISODateString())}`, 14, 15);
    doc.setFontSize(14);
    doc.text(`${mlotData?.business_name || 'MLOT'} (${currentMlotId})`, 105, 15, { align: 'center' });
    doc.setFontSize(10);
    if(mlotData?.mobile) doc.text(`Contact: ${mlotData.mobile}`, 105, 21, { align: 'center' });
    doc.text(`Ledger Summary Date: ${dateFilter}`, 14, 27);

    let tableRows = []; let pSum = 0, tSum = 0, paySum = 0, bSum = 0;
    document.querySelectorAll('#ledger-table-tbody tr').forEach(row => {
        const cols = row.querySelectorAll('td');
        if(cols.length >= 8) {
            let sl = cols[0].innerText, dt = cols[1].innerText, code = cols[2].innerText, name = cols[3].innerText, tDue = cols[4].innerText, todayDue = cols[5].innerText, pay = cols[6].querySelector('input').value, bal = cols[7].innerText;
            pSum += parseFloat(tDue.replace('₹', '')) || 0; tSum += parseFloat(todayDue.replace('₹', '')) || 0; paySum += parseFloat(pay) || 0; bSum += parseFloat(bal.replace('₹', '')) || 0;
            tableRows.push([sl, dt, code, name, tDue, todayDue, `₹${parseFloat(pay).toFixed(2)}`, bal]);
        }
    });

    doc.autoTable({
        startY: 32,
        head: [['Sl', 'Date', 'Code', 'Name', 'Total Due', 'Today Due', 'Payment', 'Balance']],
        body: tableRows,
        foot: [['', '', '', 'Total:', `₹${pSum.toFixed(2)}`, `₹${tSum.toFixed(2)}`, `₹${paySum.toFixed(2)}`, `₹${bSum.toFixed(2)}`]],
        theme: 'grid',
        headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 2 }
    });
    return doc;
}

async function downloadOrOpenLedgerReport() {
    const doc = await generateLedgerPDFObj();
    const dateFilter = formatToDBDate(document.getElementById('ledger-filter-date').value || getISODateString());
    openPDFDirectly(doc, `Ledger_Report_${dateFilter.replace(/\//g, '-')}.pdf`);
}