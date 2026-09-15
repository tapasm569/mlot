const SUPABASE_URL = 'https://uwpexlmvpnffbmvlqski.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3cGV4bG12cG5mZmJtdmxxc2tpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyODQ1MTQsImV4cCI6MjEwNDg2MDUxNH0.n59Hyk18Ysb93Fw70pWNmFT0KMGZm_CECYvtdD_MsxA';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUserRole = 'mlot';
let currentMlotId = null;
let currentSellerCode = null;
let pendingBatchTickets = [];
let pendingPurchaseDraft = [];
let tempSellerData = {};
let selectedPayModeType = 'total';
let currentStockCategory = '1 PM';
let currentSellerStockCategory = '1 PM';
let currentlyViewingSellerCode = null;
let isEditingSeller = false;

// Pricing variables decoupled from keystrokes to prevent database spamming
let activeSaleSetPrice = 6.50;
let activeUnsoldSetPrice = 6.50;
let activeSellerUnsoldSetPrice = 6.50;

// --- PUSH NOTIFICATION (ANDROID WEBVIEW BRIDGE & RETRY LOGIC) ---
let deviceFCMToken = null;

// Called automatically by Android WebView onPageFinished or on token refresh
window.receiveFCMTokenFromAndroid = function(token) {
    if (token && token !== "null" && token !== "undefined") {
        deviceFCMToken = token;
        console.log("FCM Token received via Android push callback:", token);
        if (currentMlotId) {
            updateTokenInDatabase();
        }
    }
};

// Fallback polling to actively grab token directly from AndroidBridge interface
function checkBridgeForFCMToken() {
    if (!deviceFCMToken && window.AndroidBridge && typeof window.AndroidBridge.getFCMToken === 'function') {
        try {
            const token = window.AndroidBridge.getFCMToken();
            if (token && token !== "null" && token !== "undefined") {
                deviceFCMToken = token;
                console.log("FCM Token retrieved via AndroidBridge interface:", token);
            }
        } catch (e) {
            console.warn("Could not query AndroidBridge.getFCMToken:", e);
        }
    }
    return deviceFCMToken;
}

async function updateTokenInDatabase(retryCount = 0) {
    checkBridgeForFCMToken();

    if (!deviceFCMToken) {
        // Retry polling up to 5 times over 7 seconds if the bridge token is delayed
        if (retryCount < 5 && currentMlotId) {
            setTimeout(() => updateTokenInDatabase(retryCount + 1), 1500);
        }
        return;
    }

    if (!currentMlotId) return;

    try {
        if (currentUserRole === 'mlot') {
            const { error } = await _supabase
                .from('mlot_users')
                .update({ fcm_token: deviceFCMToken })
                .eq('mlot_id', currentMlotId);
            if (error) console.error("Error updating MLOT FCM token:", error.message);
            else console.log("MLOT FCM token updated successfully.");
        } else if (currentUserRole === 'seller' && currentSellerCode) {
            const { error } = await _supabase
                .from('sellers')
                .update({ fcm_token: deviceFCMToken })
                .eq('mlot_id', currentMlotId)
                .eq('code', currentSellerCode);
            if (error) console.error("Error updating Seller FCM token:", error.message);
            else console.log("Seller FCM token updated successfully.");
        }
    } catch (err) {
        console.error("Exception syncing FCM token:", err);
    }
}
// ---------------------------------------------------------------

const seriesOptionsMap = {
    "1 PM": ["M5", "M10", "M20", "M30", "M50", "M100", "M200"],
    "6 PM": ["D5", "D10", "D20", "D30", "D50", "D100", "D200"],
    "8 PM": ["E5", "E10", "E20", "E30", "E50", "E100", "E200"]
};

function getLocalDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getTomorrowDateString() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
            document.getElementById('header-logo-badge').innerHTML = `<img src="https://lh3.googleusercontent.com/d/1DGvGKfD6OBy0o1e9oJTcFbTwqOeggmy4" alt="MLOT Logo" class="w-full h-full object-cover">`;
            document.getElementById('footer-nav').classList.remove('hidden');
            updatePendingUnsoldBadge();
            switchTab('sale');
        } else if (savedRole === 'seller') {
            document.getElementById('app-header-title').innerText = `Seller Portal (${currentSellerCode})`;
            document.getElementById('header-logo-badge').innerHTML = `<img src="https://lh3.googleusercontent.com/d/1DGvGKfD6OBy0o1e9oJTcFbTwqOeggmy4" alt="MLOT Logo" class="w-full h-full object-cover">`;
            document.getElementById('footer-nav').classList.add('hidden');
            openSellerAccountHome();
        } else if (savedRole === 'admin') {
            document.getElementById('app-header-title').innerText = "Super Admin Control Center";
            document.getElementById('header-logo-badge').innerHTML = `<img src="https://lh3.googleusercontent.com/d/1DGvGKfD6OBy0o1e9oJTcFbTwqOeggmy4" alt="MLOT Logo" class="w-full h-full object-cover">`;
            document.getElementById('footer-nav').classList.add('hidden');
            document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
            document.getElementById('page-admin-dashboard').classList.remove('hidden');
            openAdminSection('view-mlot');
        }
        
        updateTokenInDatabase();
    }
};

function switchAuthTab(tabKey) {
    const btnLogin = document.getElementById('auth-tab-mlot-login');
    const btnSeller = document.getElementById('auth-tab-seller');
    const formLogin = document.getElementById('form-mlot-login');
    const formSeller = document.getElementById('form-seller-login');
    const formAdmin = document.getElementById('form-admin-login');

    btnLogin.className = "flex-1 py-2 text-xs font-semibold rounded-lg text-slate-300 transition-all";
    btnSeller.className = "flex-1 py-2 text-xs font-semibold rounded-lg text-slate-300 transition-all";
    formLogin.classList.add('hidden');
    formSeller.classList.add('hidden');
    formAdmin.classList.add('hidden');

    if (tabKey === 'mlot-login') {
        btnLogin.className = "flex-1 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white transition-all shadow";
        formLogin.classList.remove('hidden');
    } else if (tabKey === 'seller') {
        btnSeller.className = "flex-1 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white transition-all shadow";
        formSeller.classList.remove('hidden');
    } else if (tabKey === 'admin') {
        formAdmin.classList.remove('hidden');
    }
}

async function handleMlotLogin(event) {
    event.preventDefault();
    const mlotId = document.getElementById('mlot-id-input').value.trim();
    const mlotPass = document.getElementById('mlot-pass-input').value.trim();

    try {
        const { data, error } = await _supabase.from('mlot_users').select('*').eq('mlot_id', mlotId).maybeSingle();
        if (error) { alert("Database Error: " + error.message); return; }
        if (!data) { alert("MLOT ID not found in database!"); return; }
        if (data.mobile !== mlotPass) { alert("Incorrect Password!"); return; }
        if (new Date() > new Date(data.subscription_expiry)) { alert("Your 30 days trial or subscription has expired! Please renew."); return; }

        currentUserRole = 'mlot';
        currentMlotId = data.mlot_id;
        currentSellerCode = null;

        localStorage.setItem('currentUserRole', 'mlot');
        localStorage.setItem('currentMlotId', currentMlotId);
        localStorage.setItem('businessName', data.business_name);
        
        updateTokenInDatabase();

        document.getElementById('app-header-title').innerText = `${data.business_name} (ID: ${data.mlot_id})`;
        document.getElementById('header-logo-badge').innerHTML = `<img src="https://lh3.googleusercontent.com/d/1DGvGKfD6OBy0o1e9oJTcFbTwqOeggmy4" alt="MLOT Logo" class="w-full h-full object-cover">`;
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('footer-nav').classList.remove('hidden');
        updatePendingUnsoldBadge();
        switchTab('sale');
    } catch (err) { alert("Connection Exception: " + err.message); }
}

async function handleSellerLogin(event) {
    event.preventDefault();
    const sellerMlotId = document.getElementById('seller-mlot-id').value.trim();
    const sellerMobile = document.getElementById('seller-mobile-input').value.trim();

    try {
        const { data, error } = await _supabase.from('sellers').select('*').eq('mlot_id', sellerMlotId).eq('phone', sellerMobile).maybeSingle();
        if (error) { alert("Database Error: " + error.message); return; }
        if (!data) { alert("Invalid MLOT ID or Seller Mobile Number!"); return; }

        currentUserRole = 'seller';
        currentMlotId = sellerMlotId;
        currentSellerCode = data.code;

        localStorage.setItem('currentUserRole', 'seller');
        localStorage.setItem('currentMlotId', currentMlotId);
        localStorage.setItem('currentSellerCode', currentSellerCode);
        
        activeSellerUnsoldSetPrice = data.set_price || 6.50;

        updateTokenInDatabase();

        document.getElementById('app-header-title').innerText = `Seller Portal (${currentSellerCode})`;
        document.getElementById('header-logo-badge').innerHTML = `<img src="https://lh3.googleusercontent.com/d/1DGvGKfD6OBy0o1e9oJTcFbTwqOeggmy4" alt="MLOT Logo" class="w-full h-full object-cover">`;
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('footer-nav').classList.add('hidden');
        openSellerAccountHome();
    } catch (err) { alert("Connection Exception: " + err.message); }
}

async function handleAdminLogin(event) {
    event.preventDefault();
    const mob = document.getElementById('admin-mob-input').value.trim();
    const pass = document.getElementById('admin-pass-input').value.trim();

    try {
        const { data, error } = await _supabase.from('admins').select('*').eq('mobile', mob).eq('password', pass).maybeSingle();
        if (error) { alert("Database Error: " + error.message); return; }
        if (!data) { alert("Invalid Admin Credentials!"); return; }

        currentUserRole = 'admin';

        localStorage.setItem('currentUserRole', 'admin');

        document.getElementById('app-header-title').innerText = "Super Admin Control Center";
        document.getElementById('header-logo-badge').innerHTML = `<img src="https://lh3.googleusercontent.com/d/1DGvGKfD6OBy0o1e9oJTcFbTwqOeggmy4" alt="MLOT Logo" class="w-full h-full object-cover">`;
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('footer-nav').classList.add('hidden');
        
        document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
        document.getElementById('page-admin-dashboard').classList.remove('hidden');
        openAdminSection('view-mlot');
    } catch (err) { alert("Connection Exception: " + err.message); }
}

function logout() {
    localStorage.clear();

    currentUserRole = 'mlot';
    currentMlotId = null;
    currentSellerCode = null;
    
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    document.getElementById('footer-nav').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    
    document.getElementById('form-mlot-login').reset();
    document.getElementById('form-seller-login').reset();
    document.getElementById('form-admin-login').reset();
    
    switchAuthTab('mlot-login');
}

// ================= ADMIN PANEL =================
async function openAdminSection(sectionKey) {
    const container = document.getElementById('admin-subview-container');
    container.innerHTML = '';

    if (sectionKey === 'create-mlot') {
        container.innerHTML = `
            <h3 class="text-xs font-bold text-slate-800 mb-3"><i class="fa-solid fa-user-plus text-indigo-600 mr-1"></i> Create Mlot Party</h3>
            <form onsubmit="submitCreateMlotParty(event)" class="space-y-3">
                <div><label class="block text-[10px] font-bold text-slate-600 mb-1">Mlot id</label><input type="text" id="admin-new-id" required class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800"></div>
                <div><label class="block text-[10px] font-bold text-slate-600 mb-1">Name</label><input type="text" id="admin-new-name" required class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800"></div>
                <div class="grid grid-cols-2 gap-2">
                    <div><label class="block text-[10px] font-bold text-slate-600 mb-1">Area</label><input type="text" id="admin-new-area" required class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800"></div>
                    <div><label class="block text-[10px] font-bold text-slate-600 mb-1">Mobile / Pass</label><input type="tel" id="admin-new-mob" required class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800"></div>
                </div>
                <div><label class="block text-[10px] font-bold text-slate-600 mb-1">Upi id</label><input type="text" id="admin-new-upi" required class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800"></div>
                <button type="submit" class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs">Create Mlot Party</button>
            </form>
        `;
    } else if (sectionKey === 'view-mlot') {
        const { data } = await _supabase.from('mlot_users').select('*');
        let rows = '';
        (data || []).forEach(u => {
            rows += `<tr class="border-b border-slate-100"><td class="p-2 font-semibold text-indigo-600">${u.mlot_id}</td><td class="p-2 font-bold">${u.business_name}</td><td class="p-2 text-[10px]">${new Date(u.created_at).toLocaleDateString()}</td><td class="p-2 text-[10px] font-bold text-emerald-600">${new Date(u.subscription_expiry).toLocaleDateString()}</td></tr>`;
        });
        container.innerHTML = `<h3 class="text-xs font-bold text-slate-800 mb-2"><i class="fa-solid fa-users text-blue-600 mr-1"></i> View all Mlot Party</h3><div class="overflow-x-auto max-h-[300px]"><table class="w-full text-left text-xs"><thead><tr class="bg-slate-100 text-[10px] uppercase"><th class="p-2">Mlot id</th><th class="p-2">Name</th><th class="p-2">Date of subscription</th><th class="p-2">Renewal date</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="p-4 text-center text-slate-400">No parties registered.</td></tr>'}</tbody></table></div>`;
    } else if (sectionKey === 'manage-subs') {
        const { data } = await _supabase.from('mlot_users').select('*');
        const { data: payments } = await _supabase.from('mlot_payments').select('*').eq('status', 'Pending');
        const now = new Date();
        let renewalRows = '';
        let paymentRows = '';

        (data || []).forEach(u => {
            const exp = new Date(u.subscription_expiry);
            const diffDays = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
            if (diffDays <= 10 && diffDays >= 0) {
                renewalRows += `<tr class="border-b border-slate-100"><td class="p-2 font-bold">${u.business_name} (${u.mlot_id})</td><td class="p-2 text-amber-600 font-bold">${diffDays} Days left</td><td><button onclick="renewMlot('${u.mlot_id}')" class="px-2 py-1 bg-indigo-600 text-white rounded text-[10px]">Renew (+30 Days)</button></td></tr>`;
            }
        });

        (payments || []).forEach(p => {
            paymentRows += `<tr class="border-b border-slate-100"><td class="p-2 font-bold">${p.mlot_id}</td><td class="p-2 text-emerald-600">₹${p.amount}</td><td><button onclick="approveMlotPayment('${p.id}', '${p.mlot_id}')" class="px-2 py-1 bg-emerald-600 text-white rounded text-[10px]">Approve</button></td></tr>`;
        });

        container.innerHTML = `<div class="space-y-4"><div><h3 class="text-xs font-bold text-slate-800 mb-2"><i class="fa-solid fa-calendar-days text-amber-600 mr-1"></i> Manage Subscriptions (Renewal Due)</h3><table class="w-full text-left text-xs"><tbody>${renewalRows || '<tr><td colspan="3" class="p-3 text-center text-slate-400">No parties within 10 days of renewal.</td></tr>'}</tbody></table></div><div class="pt-2 border-t border-slate-100"><h3 class="text-xs font-bold text-slate-800 mb-2"><i class="fa-solid fa-indian-rupee-sign text-emerald-600 mr-1"></i> Pending Payment Approvals</h3><table class="w-full text-left text-xs"><tbody>${paymentRows || '<tr><td colspan="3" class="p-3 text-center text-slate-400">No pending payments to approve.</td></tr>'}</tbody></table></div></div>`;
    } else if (sectionKey === 'payment-history') {
        const { data } = await _supabase.from('mlot_users').select('*');
        let rows = '';
        (data || []).forEach(u => {
            rows += `<tr class="border-b border-slate-100"><td class="p-2 font-bold">${u.business_name} (${u.mlot_id})</td><td class="p-2 text-emerald-600 font-bold">₹200 (Active)</td><td class="p-2 text-[10px] text-slate-500">${new Date(u.created_at).toLocaleDateString()}</td></tr>`;
        });
        container.innerHTML = `<h3 class="text-xs font-bold text-slate-800 mb-2"><i class="fa-solid fa-file-invoice-dollar text-teal-600 mr-1"></i> Payment History</h3><div class="overflow-x-auto max-h-[300px]"><table class="w-full text-left text-xs"><thead><tr class="bg-slate-100 text-[10px] uppercase"><th class="p-2">Party</th><th class="p-2">Amount</th><th class="p-2">Date</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="p-4 text-center text-slate-400">No history found.</td></tr>'}</tbody></table></div>`;
    }
}

async function submitCreateMlotParty(event) {
    event.preventDefault();
    const mlotId = document.getElementById('admin-new-id').value.trim();
    const name = document.getElementById('admin-new-name').value.trim();
    const area = document.getElementById('admin-new-area').value.trim();
    const mob = document.getElementById('admin-new-mob').value.trim();
    const upi = document.getElementById('admin-new-upi').value.trim();

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);

    const { error } = await _supabase.from('mlot_users').insert([{
        mlot_id: mlotId, business_name: name, mobile: mob, area: area, upi_id: upi, subscription_expiry: expiryDate.toISOString(), status: 'Approved'
    }]);

    if (error) alert("Error: " + error.message);
    else { alert("MLOT Party created successfully with 30-day free trial!"); openAdminSection('view-mlot'); }
}

async function renewMlot(mlotId) {
    const { data } = await _supabase.from('mlot_users').select('subscription_expiry').eq('mlot_id', mlotId).single();
    let baseDate = new Date(data.subscription_expiry > new Date() ? data.subscription_expiry : new Date());
    baseDate.setDate(baseDate.getDate() + 30);
    await _supabase.from('mlot_users').update({ subscription_expiry: baseDate.toISOString() }).eq('mlot_id', mlotId);
    alert("Subscription renewed for 30 days!");
    openAdminSection('manage-subs');
}

async function approveMlotPayment(payId, mlotId) {
    await _supabase.from('mlot_payments').update({ status: 'Approved' }).eq('id', payId);
    await renewMlot(mlotId);
}

// ================= GENERAL NAVIGATION =================
function switchTab(tabName) {
    document.querySelectorAll('.app-page').forEach(page => page.classList.add('hidden'));
    document.getElementById(`page-${tabName}`).classList.remove('hidden');

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.className = "nav-btn flex flex-col items-center justify-center w-16 py-1 text-slate-400 hover:text-slate-600 transition-all";
        const span = btn.querySelector('span');
        if(span) span.className = "text-[10px] font-medium";
    });

    const activeBtn = document.getElementById(`nav-${tabName}`);
    if (activeBtn) {
        if (tabName === 'master') {
            activeBtn.className = "nav-btn flex flex-col items-center justify-center px-3 py-0.5 text-indigo-600 transition-all";
            activeBtn.querySelector('span').className = "text-[10px] font-bold";
        } else {
            activeBtn.className = "nav-btn flex flex-col items-center justify-center w-16 py-1 text-indigo-600 transition-all";
            activeBtn.querySelector('span').className = "text-[10px] font-bold";
        }
    }
    if (tabName === 'purchase') {
        const stockDateInput = document.getElementById('stock-filter-date');
        if (!stockDateInput.value) {
            stockDateInput.value = getTomorrowDateString();
        }
        renderPurchaseAvailableStock();
    } else if (tabName === 'sale') {
        const salePageDate = document.getElementById('sale-page-filter-date');
        if (!salePageDate.value) {
            salePageDate.value = getLocalDateString();
        }
        renderMasterAndSaleTables();
    } else if (tabName === 'master') {
        renderMasterAndSaleTables();
    } else {
        renderMasterAndSaleTables();
    }
}

// ================= REUSABLE RANGE & CALCULATION LOGIC =================
function parseRangeQuantity(series, fromStr, toStr) {
    const match = series ? series.match(/\d+/) : null;
    const mult = match ? parseInt(match[0]) : 1;

    const fromVal = parseInt(fromStr);
    let toVal = parseInt(toStr);
    let rangeCount = 1;

    if (!isNaN(fromVal)) {
        let actualToVal = fromVal;
        if (!isNaN(toVal)) {
            if (toVal < fromVal && toStr.length < fromStr.length) {
                let diffLen = fromStr.length - toStr.length;
                actualToVal = parseInt(fromStr.substring(0, diffLen) + toStr);
            } else {
                actualToVal = toVal;
            }
        }
        if (actualToVal >= fromVal) {
            rangeCount = (actualToVal - fromVal) + 1;
        } else {
            return { qty: 0, mult: mult, actualToVal: fromVal, error: true };
        }
        return { qty: mult * rangeCount, mult: mult, actualToVal: actualToVal, error: false };
    }
    return { qty: 0, mult: mult, actualToVal: 0, error: true };
}

function formatTicketRangeString(group, fromVal, actualToVal) {
    if (isNaN(actualToVal) || fromVal === actualToVal) return `${group} ${fromVal}`;
    return `${group} ${fromVal}-${actualToVal}`;
}

// ================= SELLER PORTAL LOGIC =================
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
        document.getElementById('seller-stock-filter-date').value = getTomorrowDateString();
        renderSellerAvailableStockIndividual();
    } else if (pageKey === 'unsold') {
        document.getElementById('page-seller-unsold').classList.remove('hidden');
        document.getElementById('s-unsold-date').value = getLocalDateString();
        onSellerUnsoldItemChange();
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

// ================= AVAILABLE STOCK LOGIC =================
function selectStockCategory(categoryName) {
    currentStockCategory = categoryName;
    document.querySelectorAll('.stock-cat-btn').forEach(b => {
        b.className = "stock-cat-btn py-3 px-2 bg-white text-slate-700 border border-slate-200 rounded-xl text-xs font-bold shadow-xs transition-all flex flex-col items-center justify-center gap-1 active:scale-95";
    });
    let btnId = categoryName === '1 PM' ? 'cat-1pm' : (categoryName === '6 PM' ? 'cat-6pm' : 'cat-8pm');
    document.getElementById(btnId).className = "stock-cat-btn py-3 px-2 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow-md transition-all flex flex-col items-center justify-center gap-1 active:scale-95";
    document.getElementById('active-category-title').innerText = `${categoryName} Stock Pool`;
    renderPurchaseAvailableStock();
}

function selectSellerStockCategory(categoryName) {
    currentSellerStockCategory = categoryName;
    document.querySelectorAll('.s-stock-cat-btn').forEach(b => {
        b.className = "s-stock-cat-btn py-2.5 px-2 bg-white text-slate-700 border border-slate-200 rounded-xl text-xs font-bold shadow-xs transition-all flex flex-col items-center justify-center gap-1 active:scale-95";
    });
    let btnId = categoryName === '1 PM' ? 's-cat-1pm' : (categoryName === '6 PM' ? 's-cat-6pm' : 's-cat-8pm');
    document.getElementById(btnId).className = "s-stock-cat-btn py-2.5 px-2 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow-md transition-all flex flex-col items-center justify-center gap-1 active:scale-95";
    document.getElementById('seller-stock-category-title').innerText = `${categoryName} Stock Pool`;
    renderSellerAvailableStockIndividual();
}

function changeStockDate(days) {
    const dateInput = document.getElementById('stock-filter-date');
    let currentDate = dateInput.value ? new Date(dateInput.value) : new Date();
    currentDate.setDate(currentDate.getDate() + days);
    
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');
    
    dateInput.value = `${year}-${month}-${day}`;
    renderPurchaseAvailableStock();
}
        
function changeSellerStockDate(days) {
    const dateInput = document.getElementById('seller-stock-filter-date');
    let currentDate = dateInput.value ? new Date(dateInput.value) : new Date();
    currentDate.setDate(currentDate.getDate() + days);
    
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');
    
    dateInput.value = `${year}-${month}-${day}`;
    renderSellerAvailableStockIndividual();
}

function expandRangeToIndividualTickets(rangeStr) {
    let parts = rangeStr.trim().split(/\s+/);
    if (parts.length < 2) return [];
    let group = parts[0];
    let nums = parts[1].split('-');
    let start = parseInt(nums[0]);
    let end = nums.length > 1 ? parseInt(nums[1]) : start;
    if (nums.length > 1 && nums[1].length < nums[0].length) {
        let diff = nums[0].length - nums[1].length;
        end = parseInt(nums[0].substring(0, diff) + nums[1]);
    }
    let list = [];
    for (let i = start; i <= end; i++) list.push(`${group} ${i}`);
    return list;
}

async function renderPurchaseAvailableStock() {
    if (!currentMlotId) return;
    const stockDate = document.getElementById('stock-filter-date').value || getTomorrowDateString();

    const { data: catPurchases } = await _supabase.from('purchase_store').select('*').eq('item', currentStockCategory).eq('date', stockDate).eq('mlot_id', currentMlotId);
    const { data: catSales } = await _supabase.from('sales_records').select('*').eq('item', currentStockCategory).eq('date', stockDate).eq('mlot_id', currentMlotId);
    const { data: catUnsold } = await _supabase.from('unsold_records').select('*').eq('item', currentStockCategory).eq('date', stockDate).eq('mlot_id', currentMlotId);

    const container = document.getElementById('purchase-available-series-container');
    container.innerHTML = '';
    let soldTicketsSet = new Set();
    (catSales || []).forEach(s => {
        expandRangeToIndividualTickets(s.ticket_range).forEach(t => soldTicketsSet.add(t));
    });

    (catUnsold || []).forEach(u => {
        expandRangeToIndividualTickets(u.ticket_range).forEach(t => soldTicketsSet.delete(t));
    });

    let seriesMap = {};
    (catPurchases || []).forEach(p => {
        let seriesKey = p.series || "General";
        if (!seriesMap[seriesKey]) seriesMap[seriesKey] = [];
        expandRangeToIndividualTickets(p.ticket_range).forEach(t => {
            if (!soldTicketsSet.has(t)) seriesMap[seriesKey].push(t);
        });
    });

    let totalAvail = 0;
    const keys = Object.keys(seriesMap);
    if (keys.length === 0 || keys.every(k => seriesMap[k].length === 0)) {
        container.innerHTML = `<div class="p-4 bg-slate-50 text-center text-xs text-slate-400">No available stock for ${stockDate.split('-').reverse().join('.')}.</div>`;
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
    const stockDate = document.getElementById('seller-stock-filter-date').value || getTomorrowDateString();
    const { data: catPurchases } = await _supabase.from('purchase_store').select('*').eq('item', currentSellerStockCategory).eq('date', stockDate).eq('mlot_id', currentMlotId);
    const { data: catSales } = await _supabase.from('sales_records').select('*').eq('item', currentSellerStockCategory).eq('date', stockDate).eq('mlot_id', currentMlotId);
    const { data: catUnsold } = await _supabase.from('unsold_records').select('*').eq('item', currentSellerStockCategory).eq('date', stockDate).eq('mlot_id', currentMlotId);

    const container = document.getElementById('seller-purchase-indv-container');
    container.innerHTML = '';
    let soldTicketsSet = new Set();
    (catSales || []).forEach(s => expandRangeToIndividualTickets(s.ticket_range).forEach(t => soldTicketsSet.add(t)));

    (catUnsold || []).forEach(u => expandRangeToIndividualTickets(u.ticket_range).forEach(t => soldTicketsSet.delete(t)));

    let seriesMap = {};
    (catPurchases || []).forEach(p => {
        let seriesKey = p.series || "General";
        if (!seriesMap[seriesKey]) seriesMap[seriesKey] = [];
        expandRangeToIndividualTickets(p.ticket_range).forEach(t => {
            if (!soldTicketsSet.has(t)) seriesMap[seriesKey].push(t);
        });
    });

    let totalAvail = 0;
    const keys = Object.keys(seriesMap);
    if (keys.length === 0 || keys.every(k => seriesMap[k].length === 0)) {
        container.innerHTML = `<div class="p-4 bg-slate-50 text-center text-xs text-slate-400">No available stock.</div>`;
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

// ================= PURCHASE ENTRY FORM LOGIC =================
function openPurchaseEntryPage() {
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-purchase-entry').classList.remove('hidden');
    
    const dateInput = document.getElementById('pur-date');
    if (!dateInput.value) {
        dateInput.value = '';
    }
    
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

function addPurchaseDraft(event) {
    event.preventDefault();
    const date = document.getElementById('pur-date').value;
    if (!date) { alert("Please select a date for purchase entry."); return; }

    const item = document.getElementById('pur-item').value;
    const series = document.getElementById('pur-series').value;
    const group = document.getElementById('pur-group').value.trim().toUpperCase();
    const fromStr = document.getElementById('pur-from').value.trim();
    const toStr = document.getElementById('pur-to').value.trim();
    const price = parseFloat(document.getElementById('pur-buying-price').value);

    if (isNaN(price)) { alert("Please set a valid purchase buying price."); return; }
    if (!group || !fromStr) { alert("Group and From number are required."); return; }

    const calc = parseRangeQuantity(series, fromStr, toStr);
    if (calc.error) { alert("Invalid range: 'To' ticket number must be greater than or equal to 'From'."); return; }

    let ticketRangeStr = formatTicketRangeString(group, parseInt(fromStr), calc.actualToVal);
    let costRaw = calc.qty * price;

    pendingPurchaseDraft.push({ date, item, series, ticket_range: ticketRangeStr, qty: calc.qty, cost_raw: costRaw, mlot_id: currentMlotId });
    document.getElementById('pur-draft-count').innerText = pendingPurchaseDraft.length;
    
    document.getElementById('pur-from').value = '';
    document.getElementById('pur-to').value = '';
    calculatePurchaseCost();
}

function openPurchaseDraftModal() { renderPurchaseDraftTable(); document.getElementById('purchase-draft-modal').classList.remove('hidden'); }
function closePurchaseDraftModal() { document.getElementById('purchase-draft-modal').classList.add('hidden'); }

function renderPurchaseDraftTable() {
    const tbody = document.getElementById('pur-draft-tbody');
    const tfoot = document.getElementById('pur-draft-tfoot');
    tbody.innerHTML = '';
    let q = 0, c = 0;
    pendingPurchaseDraft.forEach((item, idx) => {
        q += item.qty; c += item.cost_raw;
        tbody.innerHTML += `<tr class="border-b border-slate-100"><td class="p-2">${idx+1}</td><td class="p-2">${item.item}</td><td class="p-2 font-bold">${item.series}</td><td class="p-2 font-mono text-[10px]">${item.ticket_range}</td><td class="p-2 font-bold text-purple-600">${item.qty}</td><td class="p-2 font-bold">₹${item.cost_raw.toFixed(2)}</td><td class="p-2 text-center"><button onclick="pendingPurchaseDraft.splice(${idx},1);renderPurchaseDraftTable()" class="text-red-500"><i class="fa-solid fa-trash"></i></button></td></tr>`;
    });
    tfoot.innerHTML = `<tr><td colspan="4" class="p-2 text-right font-bold">Total:</td><td class="p-2 font-bold text-purple-600">${q}</td><td colspan="2" class="p-2 font-bold text-indigo-600">₹${c.toFixed(2)}</td></tr>`;
}

async function savePurchaseToStore() {
    if (pendingPurchaseDraft.length === 0) return;
    const { error } = await _supabase.from('purchase_store').insert(pendingPurchaseDraft);
    if (error) alert("Error: " + error.message);
    else {
        alert("Saved to store inventory!");
        pendingPurchaseDraft = [];
        document.getElementById('pur-draft-count').innerText = '0';
        closePurchaseDraftModal();
        switchTab('purchase');
    }
}

// ================= SALE ENTRY FORM LOGIC =================
function openSaleEntryPage() {
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-sale-entry').classList.remove('hidden');
    
    const dateInput = document.getElementById('sale-date');
    if (!dateInput.value) {
        dateInput.value = '';
    }
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

function onSeriesChange() { calculateSalePrice(); }

function calculateSalePrice() {
    const series = document.getElementById('sale-series').value;
    const fromStr = document.getElementById('sale-from').value.trim();
    const toStr = document.getElementById('sale-to').value.trim();

    const calc = parseRangeQuantity(series, fromStr, toStr);
    document.getElementById('sale-qty').value = calc.qty || 0;
    document.getElementById('sale-price').value = `₹${((calc.qty || 0) * activeSaleSetPrice).toFixed(2)}`;
}

async function addCurrentEntryToList() {
    const date = document.getElementById('sale-date').value;
    if (!date) { alert("Please select a date for sale entry."); return; }

    const code = document.getElementById('sale-seller-code').value;
    const name = document.getElementById('sale-seller-name').value;
    const item = document.getElementById('sale-item').value;
    const series = document.getElementById('sale-series').value;
    const group = document.getElementById('sale-group').value.trim().toUpperCase();
    const fromStr = document.getElementById('sale-from').value.trim();
    const toStr = document.getElementById('sale-to').value.trim();

    if (!code || !group || !fromStr) {
        alert("Please select Seller Code, enter Group, and From ticket number.");
        return;
    }

    const calc = parseRangeQuantity(series, fromStr, toStr);
    if (calc.error) { alert("Invalid range: 'To' ticket number must be greater than or equal to 'From'."); return; }

    let ticketRangeStr = formatTicketRangeString(group, parseInt(fromStr), calc.actualToVal);
    const entryIndividualTickets = expandRangeToIndividualTickets(ticketRangeStr);

    let draftedSet = new Set();
    pendingBatchTickets.forEach(b => expandRangeToIndividualTickets(b.ticket_range).forEach(t => draftedSet.add(t)));
    if (entryIndividualTickets.some(t => draftedSet.has(t))) {
        alert("Wait! Some or all of these tickets are already in your current unsaved batch draft.");
        return;
    }

    const { data: purData } = await _supabase.from('purchase_store').select('*').eq('mlot_id', currentMlotId).eq('item', item).eq('date', date);
    const { data: salesData } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId).eq('item', item).eq('date', date);
    const { data: unsoldData } = await _supabase.from('unsold_records').select('*').eq('mlot_id', currentMlotId).eq('item', item).eq('date', date);

    let availableSet = new Set();
    (purData || []).forEach(p => expandRangeToIndividualTickets(p.ticket_range).forEach(t => availableSet.add(t)));
    
    let soldSet = new Set();
    (salesData || []).forEach(s => expandRangeToIndividualTickets(s.ticket_range).forEach(t => soldSet.add(t)));

    (unsoldData || []).forEach(u => expandRangeToIndividualTickets(u.ticket_range).forEach(t => soldSet.delete(t)));

    let isStockValid = entryIndividualTickets.every(t => availableSet.has(t) && !soldSet.has(t));

    if (!isStockValid) {
        alert("Wrong ticket details! The entered tickets are outside available stock or already sold for this date.");
        return;
    }

    const qty = parseInt(document.getElementById('sale-qty').value);
    const price = parseFloat(document.getElementById('sale-price').value.replace('₹', ''));

    pendingBatchTickets.push({ 
        date, code, name, item, series, 
        ticket_range: ticketRangeStr, qty, price_raw: price, mlot_id: currentMlotId 
    });

    document.getElementById('batch-count').innerText = pendingBatchTickets.length;
    document.getElementById('sale-from').value = '';
    document.getElementById('sale-to').value = '';
    calculateSalePrice();
}

function openShowTicketModal() { renderTicketPreviewTable(); document.getElementById('show-ticket-modal').classList.remove('hidden'); }
function closeShowTicketModal() { document.getElementById('show-ticket-modal').classList.add('hidden'); }

function renderTicketPreviewTable() {
    const tbody = document.getElementById('ticket-preview-tbody');
    const tfoot = document.getElementById('ticket-preview-tfoot');
    tbody.innerHTML = '';
    let q = 0, p = 0;
    pendingBatchTickets.forEach((t, i) => {
        q += t.qty; p += t.price_raw;
        tbody.innerHTML += `<tr class="border-b border-slate-100"><td class="p-2">${i+1}</td><td class="p-2 font-semibold text-indigo-600">${t.code}</td><td class="p-2">${t.name}</td><td class="p-2">${t.item}</td><td class="p-2 font-bold">${t.series}</td><td class="p-2 font-mono text-[10px]">${t.ticket_range}</td><td class="p-2 text-emerald-600 font-bold">${t.qty}</td><td class="p-2 font-bold">₹${t.price_raw.toFixed(2)}</td><td class="p-2 text-center"><button onclick="pendingBatchTickets.splice(${i},1);renderTicketPreviewTable()" class="text-red-500"><i class="fa-solid fa-trash"></i></button></td></tr>`;
    });
    tfoot.innerHTML = `<tr><td colspan="6" class="p-2 text-right font-bold">Total:</td><td class="p-2 font-bold text-emerald-600">${q}</td><td colspan="2" class="p-2 font-bold text-indigo-600">₹${p.toFixed(2)}</td></tr>`;
}

async function submitTicketEntries() {
    if (pendingBatchTickets.length === 0) return;
    const { error } = await _supabase.from('sales_records').insert(pendingBatchTickets);
    if (error) alert("Error: " + error.message);
    else {
        alert("Saved successfully!");
        pendingBatchTickets = [];
        document.getElementById('batch-count').innerText = '0';
        closeShowTicketModal();
        switchTab('sale');
    }
}

// ================= UNSOLD ENTRY FORM LOGIC (MLOT USER) =================
function openUnsoldTicketPage() {
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-unsold-ticket').classList.remove('hidden');
    document.getElementById('unsold-date').value = getLocalDateString();
    updateUnsoldCodeDropdown();
    onUnsoldItemChange();
}

async function updateUnsoldCodeDropdown() {
    const select = document.getElementById('unsold-seller-code');
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

async function submitUnsoldDetailed(event) {
    event.preventDefault();
    const date = document.getElementById('unsold-date').value;
    if (!date) { alert("Please select a date."); return; }
    
    const code = document.getElementById('unsold-seller-code').value;
    const name = document.getElementById('unsold-seller-name').value;
    const item = document.getElementById('unsold-item').value;
    const series = document.getElementById('unsold-series').value;
    const group = document.getElementById('unsold-group').value.trim().toUpperCase();
    const fromStr = document.getElementById('unsold-from').value.trim();
    const toStr = document.getElementById('unsold-to').value.trim();

    if (!code || !group || !fromStr) { alert("Code, Group, and From number required."); return; }

    const calc = parseRangeQuantity(series, fromStr, toStr);
    if (calc.error) { alert("Invalid range: 'To' ticket number must be greater than or equal to 'From'."); return; }

    let ticketRangeStr = formatTicketRangeString(group, parseInt(fromStr), calc.actualToVal);
    const qty = parseInt(document.getElementById('unsold-qty').value);
    const priceRaw = parseFloat(document.getElementById('unsold-price').value.replace('₹', ''));

    const { error } = await _supabase.from('unsold_records').insert([{
        date, code, name, item, series, ticket_range: ticketRangeStr, qty, price_raw: priceRaw, mlot_id: currentMlotId
    }]);

    if (error) alert("Error: " + error.message);
    else {
        alert("Unsold return manually recorded successfully!");
        document.getElementById('form-unsold-detailed').reset();
        document.getElementById('unsold-date').value = getLocalDateString();
    }
}

// ================= SELLER UNSOLD ENTRY (SELLER PORTAL) =================
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
    const date = document.getElementById('s-unsold-date').value;
    if (!date) { alert("Please select a date."); return; }
    
    const item = document.getElementById('s-unsold-item').value;
    const series = document.getElementById('s-unsold-series').value;
    const group = document.getElementById('s-unsold-group').value.trim().toUpperCase();
    const fromStr = document.getElementById('s-unsold-from').value.trim();
    const toStr = document.getElementById('s-unsold-to').value.trim();

    const calc = parseRangeQuantity(series, fromStr, toStr);
    if (calc.error) { alert("Invalid range: 'To' ticket number must be greater than or equal to 'From'."); return; }

    const { data: sData } = await _supabase.from('sellers').select('name').eq('mlot_id', currentMlotId).eq('code', currentSellerCode).single();
    const name = sData ? sData.name : currentSellerCode;

    let ticketRangeStr = formatTicketRangeString(group, parseInt(fromStr), calc.actualToVal);
    const qty = parseInt(document.getElementById('s-unsold-qty').value);
    const priceRaw = parseFloat(document.getElementById('s-unsold-price').value.replace('₹', ''));

    const pendingEntry = {
        date, code: currentSellerCode, name, item, series,
        ticket_range: ticketRangeStr, qty, price_raw: priceRaw, mlot_id: currentMlotId
    };

    const { error } = await _supabase.from('pending_unsold').insert([pendingEntry]);
    if(error) alert("Error: " + error.message);
    else {
        alert("Unsold tickets sent to Mlot User for verification successfully!");
        document.getElementById('form-seller-unsold').reset();
        document.getElementById('s-unsold-date').value = getLocalDateString();
        updatePendingUnsoldBadge();
        openSellerAccountHome();
    }
}

// ================= GENERAL CRUD AND TABLE RENDERS =================
function openAddSellerPage() {
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-add-seller').classList.remove('hidden');
    document.getElementById('seller-userid').value = currentMlotId || '';
    calculateAddSellerPrice();
}

function calculateAddSellerPrice() {
    const qty = parseFloat(document.getElementById('seller-qty').value) || 1;
    const setPrice = parseFloat(document.getElementById('seller-set-price').value) || 0;
    const totalPrice = qty * setPrice;
    document.getElementById('calculated-total-display').innerText = `₹${totalPrice.toFixed(2)}`;
    return totalPrice;
}

function previewSeller(event) {
    event.preventDefault();
    const setPriceVal = parseFloat(document.getElementById('seller-set-price').value) || 0;
    const prevDueVal = parseFloat(document.getElementById('seller-prev-due').value) || 0;
    tempSellerData = {
        name: document.getElementById('seller-name').value.trim(),
        code: document.getElementById('seller-code').value.trim(),
        mob: document.getElementById('seller-mob').value.trim(),
        area: document.getElementById('seller-area').value.trim(),
        userid: document.getElementById('seller-userid').value.trim(),
        previousDue: prevDueVal.toFixed(2),
        setPrice: setPriceVal.toFixed(2),
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

    document.getElementById('verify-modal').classList.remove('hidden');
}

function closeModal() { document.getElementById('verify-modal').classList.add('hidden'); }

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

    if (error) { alert("Error adding seller: " + error.message); } 
    else {
        alert("Seller account created successfully!");
        document.getElementById('form-add-seller').reset();
        switchTab('sale');
    }
}

// ================= MASTER DIRECTORY & SALE TABLES =================
async function renderMasterAndSaleTables() {
    const saleDateFilter = document.getElementById('sale-page-filter-date').value || getLocalDateString();
    const { data: sellers } = await _supabase.from('sellers').select('*').eq('mlot_id', currentMlotId);
    const { data: sales } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId);
    const { data: unsold } = await _supabase.from('unsold_records').select('*').eq('mlot_id', currentMlotId);
    const todayStr = getLocalDateString();

    const masterList = document.getElementById('master-seller-list');
    if (masterList) masterList.innerHTML = '';
    const saleBody = document.getElementById('sale-table-body');
    if (saleBody) saleBody.innerHTML = '';

    if (!sellers || sellers.length === 0) {
        if (masterList) masterList.innerHTML = `<div class="p-4 bg-white rounded-2xl text-center text-xs text-slate-400">No sellers registered yet.</div>`;
        if (saleBody) saleBody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-slate-400">No sale records available.</td></tr>`;
        return;
    }

    sellers.forEach((s, idx) => {
        const slNo = String(idx + 1).padStart(2, '0');
        const sellerSales = (sales || []).filter(t => t.code === s.code);
        const sellerUnsold = (unsold || []).filter(t => t.code === s.code);

        const prevDue = s.previous_due || 0;
        const todayPay = s.today_payment || 0;
        const todaySales = sellerSales.filter(t => (t.date || todayStr) === todayStr);
        const todayUnsold = sellerUnsold.filter(t => (t.date || todayStr) === todayStr);
        let todayDue = todaySales.reduce((a, c) => a + c.price_raw, 0) - todayUnsold.reduce((a, c) => a + c.price_raw, 0);
        
        let totalBalance = prevDue + todayDue - todayPay;

        if (masterList) {
            masterList.innerHTML += `
                <div class="bg-white p-3 rounded-2xl shadow-sm border border-slate-200 flex items-center justify-between">
                    <div class="flex items-center space-x-3 cursor-pointer" onclick="openSellerDetailModal('${s.code}')">
                        <div class="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs">${slNo}</div>
                        <div>
                            <h4 class="text-xs font-bold text-slate-800 hover:text-indigo-600">${s.name} <span class="text-[10px] text-indigo-600 font-normal">#${s.code}</span></h4>
                            <p class="text-[10px] text-slate-500">Total Balance: <span class="font-bold text-red-600">₹${totalBalance.toFixed(2)}</span></p>
                        </div>
                    </div>
                    <div class="flex items-center space-x-2">
                        <a href="tel:${s.phone || ''}" class="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xs shadow-xs"><i class="fa-solid fa-phone"></i></a>
                        <a href="https://wa.me/${s.phone || ''}" target="_blank" class="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center text-xs shadow-xs"><i class="fa-brands fa-whatsapp"></i></a>
                    </div>
                </div>
            `;
        }

        if (saleBody) {
            const dateSales = sellerSales.filter(t => (t.date || getLocalDateString()) === saleDateFilter);
            const dateUnsold = sellerUnsold.filter(t => (t.date || getLocalDateString()) === saleDateFilter);

            let purchaseQty = dateSales.reduce((a, c) => a + c.qty, 0);
            let unsoldQty = dateUnsold.reduce((a, c) => a + c.qty, 0);
            let soldQty = purchaseQty - unsoldQty;
            let dateDue = dateSales.reduce((a, c) => a + c.price_raw, 0) - dateUnsold.reduce((a, c) => a + c.price_raw, 0);

            saleBody.innerHTML += `
                <tr class="hover:bg-slate-50 border-b border-slate-100">
                    <td class="p-3 text-slate-400">${slNo}</td>
                    <td class="p-3 font-semibold text-indigo-600">${s.code}</td>
                    <td class="p-3 font-bold text-slate-800">${s.name}</td>
                    <td class="p-3 text-purple-600 font-bold">${purchaseQty}</td>
                    <td class="p-3 text-emerald-600 font-bold">${soldQty}</td>
                    <td class="p-3 text-amber-600 font-bold">${unsoldQty}</td>
                    <td class="p-3 font-bold text-slate-800">₹${dateDue.toFixed(2)}</td>
                    <td class="p-3 font-extrabold text-red-600">₹${totalBalance.toFixed(2)}</td>
                </tr>
            `;
        }
    });
}

async function openSellerDetailModal(code) {
    currentlyViewingSellerCode = code;
    isEditingSeller = false;
    renderSellerDetailModalContent();
    document.getElementById('seller-detail-modal').classList.remove('hidden');
}

function closeSellerDetailModal() { isEditingSeller = false; document.getElementById('seller-detail-modal').classList.add('hidden'); }

async function renderSellerDetailModalContent() {
    const { data: s } = await _supabase.from('sellers').select('*').eq('mlot_id', currentMlotId).eq('code', currentlyViewingSellerCode).single();
    if (!s) return;
    const { data: sales } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId).eq('code', currentlyViewingSellerCode);
    const { data: unsold } = await _supabase.from('unsold_records').select('*').eq('mlot_id', currentMlotId).eq('code', currentlyViewingSellerCode);
    const todayStr = getLocalDateString();

    let sellerSales = sales || [];
    let sellerUnsold = unsold || [];
    const prevDue = s.previous_due || 0;
    const todayPay = s.today_payment || 0;
    const todaySales = sellerSales.filter(t => (t.date || todayStr) === todayStr);
    const todayUnsold = sellerUnsold.filter(t => (t.date || todayStr) === todayStr);
    let todayDue = todaySales.reduce((a, c) => a + c.price_raw, 0) - todayUnsold.reduce((a, c) => a + c.price_raw, 0);
    
    let totalBalance = prevDue + todayDue - todayPay;

    const contentDiv = document.getElementById('seller-detail-content');
    const editBtn = document.getElementById('seller-detail-edit-btn');

    if (!isEditingSeller) {
        editBtn.innerText = "Edit Details";
        contentDiv.innerHTML = `
            <div class="flex justify-between"><span class="text-slate-500">Seller Code:</span> <span class="font-bold text-indigo-600">${currentlyViewingSellerCode}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">Name:</span> <span class="font-bold text-slate-800">${s.name}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">Total Balance:</span> <span class="font-extrabold text-red-600">₹${totalBalance.toFixed(2)}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">Mobile Number:</span> <span class="font-bold text-slate-800">${s.phone || 'N/A'}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">Shop Area:</span> <span class="font-bold text-slate-800">${s.area || 'N/A'}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">Set Price:</span> <span class="font-bold text-indigo-600">₹${(s.set_price || 6.50).toFixed(2)}</span></div>
        `;
    } else {
        editBtn.innerText = "Save Changes";
        contentDiv.innerHTML = `
            <div class="space-y-2">
                <div><label class="block text-[10px] font-bold text-slate-600">Name</label><input type="text" id="edit-s-name" value="${s.name}" class="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800"></div>
                <div><label class="block text-[10px] font-bold text-slate-600">Mobile Number</label><input type="tel" id="edit-s-mob" value="${s.phone || ''}" class="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800"></div>
                <div><label class="block text-[10px] font-bold text-slate-600">Shop Area</label><input type="text" id="edit-s-area" value="${s.area || ''}" class="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800"></div>
                <div><label class="block text-[10px] font-bold text-slate-600">Set Price (₹)</label><input type="number" step="0.01" id="edit-s-price" value="${s.set_price || 6.50}" class="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800"></div>
            </div>
        `;
    }
}

async function toggleEditSellerMode() {
    if (!isEditingSeller) {
        isEditingSeller = true;
        renderSellerDetailModalContent();
    } else {
        let newName = document.getElementById('edit-s-name').value.trim();
        let newMob = document.getElementById('edit-s-mob').value.trim();
        let newArea = document.getElementById('edit-s-area').value.trim();
        let newPrice = parseFloat(document.getElementById('edit-s-price').value) || 6.50;

        await _supabase.from('sellers').update({ name: newName, phone: newMob, area: newArea, set_price: newPrice }).eq('mlot_id', currentMlotId).eq('code', currentlyViewingSellerCode);
        isEditingSeller = false;
        alert("Seller details updated successfully!");
        renderSellerDetailModalContent();
        renderMasterAndSaleTables();
    }
}

async function openSaleReportModal() {
    const tomorrowStr = getTomorrowDateString();
    document.getElementById('report-from-date').value = tomorrowStr;
    document.getElementById('report-to-date').value = tomorrowStr;
    
    const select = document.getElementById('report-filter-seller');
    const { data: sellers } = await _supabase.from('sellers').select('code, name').eq('mlot_id', currentMlotId);
    select.innerHTML = '<option value="">All Sellers (General Report)</option>';
    (sellers || []).forEach(s => {
        select.appendChild(new Option(`${s.code} - ${s.name}`, s.code));
    });

    filterSaleReport();
    document.getElementById('sale-report-modal').classList.remove('hidden');
}

function closeSaleReportModal() { document.getElementById('sale-report-modal').classList.add('hidden'); }

async function filterSaleReport() {
    const f = document.getElementById('report-from-date').value;
    const to = document.getElementById('report-to-date').value;
    const selectedCode = document.getElementById('report-filter-seller').value;

    const { data: sales } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId);
    const tbody = document.getElementById('report-table-tbody');
    const tfoot = document.getElementById('report-table-tfoot');
    tbody.innerHTML = '';

    let filtered = (sales || []).filter(t => {
        let matchDate = (t.date || getLocalDateString()) >= f && (t.date || getLocalDateString()) <= to;
        let matchCode = selectedCode ? t.code === selectedCode : true;
        return matchDate && matchCode;
    });

    let q = 0, p = 0;
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-slate-400">No records found.</td></tr>`;
    } else {
        filtered.forEach(t => {
            q += t.qty; p += t.price_raw;
            tbody.innerHTML += `<tr class="border-b border-slate-100"><td class="p-2 text-[10px]">${t.date}</td><td class="p-2 font-semibold text-indigo-600">${t.code}</td><td class="p-2">${t.name}</td><td class="p-2">${t.item}</td><td class="p-2 font-bold">${t.series}</td><td class="p-2 font-mono text-[10px]">${t.ticket_range}</td><td class="p-2 text-emerald-600 font-bold">${t.qty}</td><td class="p-2 font-bold">₹${t.price_raw.toFixed(2)}</td></tr>`;
        });
    }
    tfoot.innerHTML = `<tr><td colspan="6" class="p-2 text-right font-bold">Total:</td><td class="p-2 font-bold text-emerald-600">${q}</td><td colspan="2" class="p-2 font-bold text-indigo-600">₹${p.toFixed(2)}</td></tr>`;
}

async function downloadSaleReportPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    const f = document.getElementById('report-from-date').value || getTomorrowDateString();
    const to = document.getElementById('report-to-date').value || getTomorrowDateString();
    const selectedCode = document.getElementById('report-filter-seller').value;

    const { data: mlotData } = await _supabase.from('mlot_users').select('*').eq('mlot_id', currentMlotId).maybeSingle();
    const businessName = mlotData ? mlotData.business_name : "MLOT Business";

    let sellerNameStr = "";
    let sellerPhoneStr = mlotData ? mlotData.mobile : "";

    if (selectedCode) {
        const { data: sData } = await _supabase.from('sellers').select('*').eq('mlot_id', currentMlotId).eq('code', selectedCode).maybeSingle();
        if (sData) {
            sellerNameStr = sData.name;
            sellerPhoneStr = sData.phone || sellerPhoneStr;
        }
    }

    doc.setFontSize(9);
    doc.text(`Generated Date: ${getLocalDateString().split('-').reverse().join('.')}`, 14, 15);
    
    doc.setFontSize(13);
    if (selectedCode) {
        doc.text(`Seller Name: ${sellerNameStr} (${selectedCode})`, 105, 15, { align: 'center' });
    } else {
        doc.text(`${businessName} (${currentMlotId}) - General Sale Report`, 105, 15, { align: 'center' });
    }
    
    doc.setFontSize(9);
    if (sellerPhoneStr) {
        doc.text(`Contact: ${sellerPhoneStr}`, 105, 21, { align: 'center' });
    }

    doc.text(`Report Period: ${f.split('-').reverse().join('.')} to ${to.split('-').reverse().join('.')}`, 14, 27);

    const { data: sales } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId);
    let filtered = (sales || []).filter(t => {
        let matchDate = (t.date || getLocalDateString()) >= f && (t.date || getLocalDateString()) <= to;
        let matchCode = selectedCode ? t.code === selectedCode : true;
        return matchDate && matchCode;
    });

    let tableRows = [];
    let totalQ = 0, totalP = 0;

    filtered.forEach((t, index) => {
        totalQ += t.qty;
        totalP += t.price_raw;
        tableRows.push([
            index + 1,
            t.date.split('-').reverse().join('.'),
            t.code,
            t.name,
            t.item,
            t.series,
            t.ticket_range,
            t.qty,
            `₹${t.price_raw.toFixed(2)}`
        ]);
    });

    doc.autoTable({
        startY: 32,
        head: [['Sl', 'Date', 'Code', 'Name', 'Item', 'Series', 'Range', 'Qty', 'Price']],
        body: tableRows,
        foot: [['', '', '', '', '', '', 'Total:', totalQ, `₹${totalP.toFixed(2)}`]],
        theme: 'grid',
        headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold', lineWidth: 0.1, lineColor: [0, 0, 0] },
        bodyStyles: { lineWidth: 0.1, lineColor: [0, 0, 0], textColor: [0, 0, 0] },
        footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', lineWidth: 0.1, lineColor: [0, 0, 0] },
        styles: { fontSize: 8, cellPadding: 2 }
    });

    doc.save(`Sale_Report_${selectedCode || 'All'}_${f}_to_${to}.pdf`);
}

// ================= TRACKER FUNCTIONS (SOLD & UNSOLD) =================
function openSoldTicketPage() {
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-sold-ticket').classList.remove('hidden');
    document.getElementById('sold-filter-date').value = getLocalDateString();
    renderSoldTicketSellers();
}

async function renderSoldTicketSellers() {
    const dateFilter = document.getElementById('sold-filter-date').value;
    const grid = document.getElementById('sold-sellers-grid');
    grid.innerHTML = '';

    const { data: sales } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId).eq('date', dateFilter);
    
    if (!sales || sales.length === 0) {
        grid.innerHTML = `<div class="col-span-3 text-center p-4 text-xs text-slate-400">No sold tickets found for this date.</div>`;
        return;
    }

    let summary = {};
    sales.forEach(s => {
        if (!summary[s.code]) summary[s.code] = { name: s.name, qty: 0, amt: 0 };
        summary[s.code].qty += s.qty;
        summary[s.code].amt += s.price_raw;
    });

    Object.keys(summary).forEach(code => {
        grid.innerHTML += `
            <div class="bg-emerald-50 p-2.5 rounded-xl border border-emerald-100 flex flex-col items-center justify-center text-center shadow-sm cursor-pointer hover:bg-emerald-100 transition-all" onclick="openSellerSoldDetail('${code}', '${dateFilter}')">
                <span class="text-[10px] font-bold text-emerald-700 block">${code}</span>
                <span class="text-[9px] text-slate-500 block truncate w-full">${summary[code].name}</span>
                <span class="text-xs font-extrabold text-slate-800 mt-1">${summary[code].qty}</span>
                <span class="text-[9px] font-bold text-emerald-600 mt-0.5">₹${summary[code].amt.toFixed(2)}</span>
            </div>
        `;
    });
}

async function openSellerSoldDetail(code, date) {
    const { data } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId).eq('code', code).eq('date', date);
    const tbody = document.getElementById('seller-detail-tbody');
    const tfoot = document.getElementById('seller-detail-tfoot');
    document.getElementById('detail-modal-title').innerText = `Sold Detail: ${code}`;
    document.getElementById('detail-modal-subtitle').innerText = `Date: ${date}`;
    
    tbody.innerHTML = '';
    let q = 0, p = 0;
    (data || []).forEach((t, i) => {
        q += t.qty; p += t.price_raw;
        tbody.innerHTML += `<tr class="border-b border-slate-100"><td class="p-2">${i+1}</td><td class="p-2">${t.item}</td><td class="p-2 font-bold">${t.series}</td><td class="p-2 font-mono text-[10px]">${t.ticket_range}</td><td class="p-2 text-emerald-600 font-bold">${t.qty}</td><td class="p-2 font-bold">₹${t.price_raw.toFixed(2)}</td></tr>`;
    });
    tfoot.innerHTML = `<tr><td colspan="4" class="p-2 text-right font-bold">Total:</td><td class="p-2 font-bold text-emerald-600">${q}</td><td class="p-2 font-bold text-indigo-600">₹${p.toFixed(2)}</td></tr>`;
    document.getElementById('seller-sold-detail-modal').classList.remove('hidden');
}

function closeSellerSoldDetail() { document.getElementById('seller-sold-detail-modal').classList.add('hidden'); }

function openShowAllUnsoldModal() {
    document.getElementById('unsold-tracker-filter-date').value = getLocalDateString();
    renderAllUnsoldGrid();
    document.getElementById('show-all-unsold-modal').classList.remove('hidden');
}

function closeShowAllUnsoldModal() { document.getElementById('show-all-unsold-modal').classList.add('hidden'); }

async function renderAllUnsoldGrid() {
    const dateFilter = document.getElementById('unsold-tracker-filter-date').value;
    const grid = document.getElementById('unsold-sellers-grid');
    grid.innerHTML = '';

    let query = _supabase.from('unsold_records').select('*').eq('mlot_id', currentMlotId);
    if (dateFilter) query = query.eq('date', dateFilter);
    const { data: unsold } = await query;

    if (!unsold || unsold.length === 0) {
        grid.innerHTML = `<div class="col-span-3 text-center p-4 text-xs text-slate-400">No unsold returns found.</div>`;
        return;
    }

    let summary = {};
    unsold.forEach(s => {
        if (!summary[s.code]) summary[s.code] = { name: s.name, qty: 0, amt: 0 };
        summary[s.code].qty += s.qty;
        summary[s.code].amt += s.price_raw;
    });

    Object.keys(summary).forEach(code => {
        grid.innerHTML += `
            <div class="bg-amber-50 p-2.5 rounded-xl border border-amber-100 flex flex-col items-center justify-center text-center shadow-sm cursor-pointer hover:bg-amber-100 transition-all" onclick="openSellerUnsoldDetail('${code}', '${dateFilter}')">
                <span class="text-[10px] font-bold text-amber-700 block">${code}</span>
                <span class="text-[9px] text-slate-500 block truncate w-full">${summary[code].name}</span>
                <span class="text-xs font-extrabold text-slate-800 mt-1">${summary[code].qty}</span>
                <span class="text-[9px] font-bold text-amber-600 mt-0.5">₹${summary[code].amt.toFixed(2)}</span>
            </div>
        `;
    });
}

async function openSellerUnsoldDetail(code, date) {
    let query = _supabase.from('unsold_records').select('*').eq('mlot_id', currentMlotId).eq('code', code);
    if (date) query = query.eq('date', date);
    const { data } = await query;
    
    const tbody = document.getElementById('seller-unsold-detail-tbody');
    const tfoot = document.getElementById('seller-unsold-detail-tfoot');
    document.getElementById('unsold-detail-modal-title').innerText = `Unsold Detail: ${code}`;
    
    tbody.innerHTML = '';
    let q = 0, p = 0;
    (data || []).forEach(t => {
        q += t.qty; p += t.price_raw;
        tbody.innerHTML += `<tr class="border-b border-slate-100"><td class="p-2 text-[10px]">${t.date}</td><td class="p-2">${t.item}</td><td class="p-2 font-bold">${t.series}</td><td class="p-2 font-mono text-[10px]">${t.ticket_range}</td><td class="p-2 text-amber-600 font-bold">${t.qty}</td><td class="p-2 font-bold">₹${t.price_raw.toFixed(2)}</td></tr>`;
    });
    tfoot.innerHTML = `<tr><td colspan="4" class="p-2 text-right font-bold">Total:</td><td class="p-2 font-bold text-amber-600">${q}</td><td class="p-2 font-bold text-indigo-600">₹${p.toFixed(2)}</td></tr>`;
    document.getElementById('seller-unsold-detail-modal').classList.remove('hidden');
}

function closeSellerUnsoldDetail() { document.getElementById('seller-unsold-detail-modal').classList.add('hidden'); }

// ================= MLOT USER VERIFICATION & APPROVALS =================
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
        document.getElementById('verify-unsold-modal').classList.remove('hidden');
        return;
    }

    data.forEach((item) => {
        container.innerHTML += `
            <div class="bg-slate-50 p-3 rounded-xl border border-slate-200 flex justify-between items-center text-xs">
                <div>
                    <span class="font-bold text-indigo-600">${item.code} (${item.name})</span>
                    <p class="text-[10px] text-slate-500">${item.item} | ${item.series} | ${item.ticket_range}</p>
                    <p class="text-[10px] font-bold text-amber-600">Qty: ${item.qty} | Amt: ₹${item.price_raw.toFixed(2)}</p>
                </div>
                <button onclick="verifySingleUnsold('${item.id}')" class="px-3 py-1.5 bg-emerald-600 text-white rounded-lg font-bold text-[10px]">Verify</button>
            </div>
        `;
    });
    document.getElementById('verify-unsold-modal').classList.remove('hidden');
}

function closeVerifyUnsoldModal() { document.getElementById('verify-unsold-modal').classList.add('hidden'); }

async function verifySingleUnsold(id) {
    const { data: item } = await _supabase.from('pending_unsold').select('*').eq('id', id).single();
    if (!item) return;

    await _supabase.from('unsold_records').insert([{
        date: item.date, code: item.code, name: item.name, item: item.item,
        series: item.series, ticket_range: item.ticket_range, qty: item.qty, price_raw: item.price_raw, mlot_id: item.mlot_id
    }]);
    await _supabase.from('pending_unsold').delete().eq('id', id);

    alert("Unsold ticket verified and officially recorded!");
    updatePendingUnsoldBadge();
    openVerifyUnsoldModal();
    renderMasterAndSaleTables();
}

async function openPaymentHistoryPage() {
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-payment-history').classList.remove('hidden');
    renderMlotPaymentHistoryTable();
}

async function renderMlotPaymentHistoryTable() {
    const { data } = await _supabase.from('payments').select('*').eq('mlot_id', currentMlotId);
    const tbody = document.getElementById('mlot-payment-history-tbody');
    tbody.innerHTML = '';

    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">No payment submissions found.</td></tr>`;
        return;
    }

    data.forEach((p) => {
        let screenshotBtn = p.screenshot ? `<button onclick="viewScreenshot('${p.screenshot}')" class="text-indigo-600 font-bold underline">View</button>` : 'No Image';
        let actionHtml = p.status === 'Pending' ? `
            <button onclick="approvePayment('${p.id}', '${p.code}', ${p.paid_amount}, '${p.date}')" class="px-2 py-1 bg-emerald-600 text-white rounded text-[10px] mr-1">Approve</button>
            <button onclick="rejectPayment('${p.id}')" class="px-2 py-1 bg-red-600 text-white rounded text-[10px]">Reject</button>
        ` : `<span class="text-[10px] font-bold px-2 py-0.5 rounded ${p.status === 'Approved' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}">${p.status}</span>`;

        tbody.innerHTML += `
            <tr class="border-b border-slate-100">
                <td class="p-2.5 text-[10px] text-slate-500">${p.date}</td>
                <td class="p-2.5 font-semibold text-indigo-600">${p.code}</td>
                <td class="p-2.5 font-bold">₹${p.total_due.toFixed(2)}</td>
                <td class="p-2.5 font-bold text-emerald-600">₹${p.paid_amount.toFixed(2)}</td>
                <td class="p-2.5 text-center">${screenshotBtn}</td>
                <td class="p-2.5 text-center">${actionHtml}</td>
            </tr>
        `;
    });
}

function viewScreenshot(dataUrl) {
    document.getElementById('screenshot-img-preview').src = dataUrl;
    document.getElementById('view-screenshot-modal').classList.remove('hidden');
}
function closeScreenshotModal() { document.getElementById('view-screenshot-modal').classList.add('hidden'); }

async function approvePayment(id, code, paidAmt, payDate) {
    await _supabase.from('payments').update({ status: 'Approved' }).eq('id', id);
    const { data: s } = await _supabase.from('sellers').select('*').eq('mlot_id', currentMlotId).eq('code', code).single();
    if (s) {
        let datePayments = s.date_payments || {};
        datePayments[payDate] = (datePayments[payDate] || 0) + paidAmt;
        
        await _supabase.from('sellers').update({ 
            today_payment: payDate === getLocalDateString() ? ((s.today_payment || 0) + paidAmt) : s.today_payment,
            date_payments: datePayments 
        }).eq('mlot_id', currentMlotId).eq('code', code);
    }
    alert("Payment approved and mapped to the specific date ledger!");
    renderMlotPaymentHistoryTable();
    renderMasterAndSaleTables();
}

async function rejectPayment(id) {
    await _supabase.from('payments').update({ status: 'Rejected' }).eq('id', id);
    alert("Payment rejected.");
    renderMlotPaymentHistoryTable();
}

// ================= PURCHASE TICKET DISPLAY =================
async function openMlotPurchaseTicketPage() {
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-mlot-purchase-ticket').classList.remove('hidden');
    renderMlotPurchaseTicketTable();
}

async function renderMlotPurchaseTicketTable() {
    const { data } = await _supabase.from('purchase_store').select('*').eq('mlot_id', currentMlotId);
    const tbody = document.getElementById('mlot-purchase-ticket-tbody');
    tbody.innerHTML = '';

    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">No purchase records found.</td></tr>`;
        return;
    }

    data.forEach(p => {
        tbody.innerHTML += `
            <tr class="border-b border-slate-100">
                <td class="p-3 text-[10px] text-slate-500">${p.date}</td>
                <td class="p-3">${p.item}</td>
                <td class="p-3 font-bold">${p.series}</td>
                <td class="p-3 font-mono text-[10px]">${p.ticket_range}</td>
                <td class="p-3 text-purple-600 font-bold">${p.qty}</td>
                <td class="p-3 font-bold">₹${p.cost_raw.toFixed(2)}</td>
            </tr>
        `;
    });
}

async function renderSellerLedger() {
    const dateFilter = document.getElementById('seller-ledger-filter-date').value || getLocalDateString();
    const { data: s } = await _supabase.from('sellers').select('*').eq('mlot_id', currentMlotId).eq('code', currentSellerCode).single();
    const { data: sales } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId).eq('code', currentSellerCode);
    const { data: unsold } = await _supabase.from('unsold_records').select('*').eq('mlot_id', currentMlotId).eq('code', currentSellerCode);

    if (!s) return;
    const prevDue = s.previous_due || 0;
    const datePayments = s.date_payments || {};
    const dayPayment = datePayments[dateFilter] || 0;

    const selectedSales = (sales || []).filter(t => (t.date || getLocalDateString()) === dateFilter);
    const selectedUnsold = (unsold || []).filter(t => (t.date || getLocalDateString()) === dateFilter);

    let dayDue = selectedSales.reduce((acc, c) => acc + c.price_raw, 0) - selectedUnsold.reduce((acc, c) => acc + c.price_raw, 0);
    
    let dueBalance = prevDue + dayDue - dayPayment;

    document.getElementById('s-ledger-prev').innerText = `₹${prevDue.toFixed(2)}`;
    document.getElementById('s-ledger-today').innerText = `₹${dayDue.toFixed(2)}`;
    document.getElementById('s-ledger-pay').innerText = `₹${dayPayment.toFixed(2)}`;
    document.getElementById('s-ledger-balance').innerText = `₹${dueBalance.toFixed(2)}`;
}

async function selectPayType(type) {
    selectedPayModeType = type;
    const btnTotal = document.getElementById('pay-type-total');
    const btnToday = document.getElementById('pay-type-today');

    const { data: s } = await _supabase.from('sellers').select('*').eq('mlot_id', currentMlotId).eq('code', currentSellerCode).single();
    const { data: sales } = await _supabase.from('sales_records').select('*').eq('mlot_id', currentMlotId).eq('code', currentSellerCode);
    const { data: unsold } = await _supabase.from('unsold_records').select('*').eq('mlot_id', currentMlotId).eq('code', currentSellerCode);
    const todayStr = getLocalDateString();

    if (!s) return;
    const prevDue = s.previous_due || 0;
    const todayPayment = s.today_payment || 0;
    const todaySales = (sales || []).filter(t => (t.date || todayStr) === todayStr);
    const todayUnsold = (unsold || []).filter(t => (t.date || todayStr) === todayStr);
    let todayDue = todaySales.reduce((acc, c) => acc + c.price_raw, 0) - todayUnsold.reduce((acc, c) => acc + c.price_raw, 0);
    
    let totalDue = prevDue + todayDue - todayPayment;

    if (type === 'total') {
        btnTotal.className = "py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow-sm transition-all";
        btnToday.className = "py-2.5 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold transition-all";
        document.getElementById('pay-amount-display').innerText = `₹${totalDue.toFixed(2)}`;
    } else {
        btnToday.className = "py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold transition-all";
        btnTotal.className = "py-2.5 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold transition-all";
        document.getElementById('pay-amount-display').innerText = `₹${todayDue.toFixed(2)}`;
    }

    const { data: mlotUser } = await _supabase.from('mlot_users').select('upi_id').eq('mlot_id', currentMlotId).maybeSingle();
    if (mlotUser && mlotUser.upi_id) {
        document.getElementById('mlot-upi-display').innerText = mlotUser.upi_id;
    }
}

function openDirectUPIApp() {
    const upiId = document.getElementById('mlot-upi-display').innerText.trim() || 'tapasm569@ptyes';
    const amtText = document.getElementById('pay-amount-display').innerText.replace('₹', '').trim();
    window.location.href = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=MLOT%20Master&am=${amtText}&cu=INR`;
}

async function submitSellerPayment(event) {
    event.preventDefault();
    const fileInput = document.getElementById('s-pay-screenshot');
    if (fileInput.files.length === 0) {
        alert("Payment screenshot is mandatory!");
        return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();
    
    reader.onload = function(e) {
        const img = new Image();
        img.onload = async function() {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800;
            const MAX_HEIGHT = 800;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
            } else {
                if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            const compressedBase64 = canvas.toDataURL('image/jpeg', 0.6);

            const amt = parseFloat(document.getElementById('pay-amount-display').innerText.replace('₹', '')) || 0;
            const { data: sData } = await _supabase.from('sellers').select('name').eq('mlot_id', currentMlotId).eq('code', currentSellerCode).single();
            
            await _supabase.from('payments').insert([{
                date: getLocalDateString(),
                code: currentSellerCode,
                name: sData ? sData.name : currentSellerCode,
                total_due: amt,
                paid_amount: amt,
                screenshot: compressedBase64,
                status: 'Pending',
                mlot_id: currentMlotId
            }]);

            alert("Payment & Screenshot submitted successfully! Pending approval.");
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
        date: getLocalDateString(),
        code: currentSellerCode,
        name: sData ? sData.name : currentSellerCode,
        total_due: amt,
        paid_amount: amt,
        screenshot: null,
        status: 'Pending',
        mlot_id: currentMlotId
    }]);

    alert("Pay Later request submitted successfully! Awaiting verification.");
    openSellerAccountHome();
}

// ================= LEDGER BOOK (DATE-SPECIFIC & AUTO-CLEAR ZERO INPUTS) =================
async function openLedgerBookPage() {
    document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-ledger-book').classList.remove('hidden');
    document.getElementById('ledger-filter-date').value = getLocalDateString();
    renderLedgerBookTable();
}

async function renderLedgerBookTable() {
    const dateFilter = document.getElementById('ledger-filter-date').value || getLocalDateString();
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
        
        const datePayments = s.date_payments || {};
        const dayPayment = datePayments[dateFilter] !== undefined ? datePayments[dateFilter] : 0.00;
        
        const filteredSales = (sales || []).filter(t => t.code === s.code && (t.date || getLocalDateString()) === dateFilter);
        const filteredUnsold = (unsold || []).filter(t => t.code === s.code && (t.date || getLocalDateString()) === dateFilter);

        let todayDue = filteredSales.reduce((a, c) => a + c.price_raw, 0) - filteredUnsold.reduce((a, c) => a + c.price_raw, 0);
        
        let balance = prevDue + todayDue - dayPayment;

        pSum += prevDue; tSum += todayDue; paySum += dayPayment; bSum += balance;

        tbody.innerHTML += `
            <tr class="border-b border-slate-100">
                <td class="p-2 border border-slate-200">${slNo}</td>
                <td class="p-2 border border-slate-200 text-[10px] text-slate-500">${dateFilter.split('-').reverse().join('.')}</td>
                <td class="p-2 border border-slate-200 font-semibold text-indigo-600">${s.code}</td>
                <td class="p-2 border border-slate-200 font-bold">${s.name}</td>
                <td class="p-2 border border-slate-200 font-bold text-red-600">₹${prevDue.toFixed(2)}</td>
                <td class="p-2 border border-slate-200 font-bold text-slate-800">₹${todayDue.toFixed(2)}</td>
                <td class="p-2 border border-slate-200"><input type="number" step="0.01" id="pay-input-${s.code}" value="${dayPayment.toFixed(2)}" disabled onclick="if(this.value==='0.00'||this.value==='0')this.value='';" class="w-16 px-1 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-bold text-emerald-600 text-center"></td>
                <td class="p-2 border border-slate-200 font-extrabold text-indigo-600">₹${balance.toFixed(2)}</td>
                <td class="p-2 border border-slate-200 text-center">
                    <button id="btn-edit-${s.code}" onclick="enableLedgerEdit('${s.code}')" class="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md font-bold text-[10px]">Update</button>
                </td>
            </tr>
        `;
    });
    tfoot.innerHTML = `<tr><td colspan="4" class="p-2 border border-slate-200 text-right font-bold">Total:</td><td class="p-2 border border-slate-200 font-bold text-red-600">₹${pSum.toFixed(2)}</td><td class="p-2 border border-slate-200 font-bold text-slate-800">₹${tSum.toFixed(2)}</td><td class="p-2 border border-slate-200 font-bold text-emerald-600">₹${paySum.toFixed(2)}</td><td colspan="2" class="p-2 border border-slate-200 font-bold text-indigo-600">₹${bSum.toFixed(2)}</td></tr>`;
}

async function enableLedgerEdit(code) {
    const inputField = document.getElementById(`pay-input-${code}`);
    const btn = document.getElementById(`btn-edit-${code}`);
    const dateFilter = document.getElementById('ledger-filter-date').value || getLocalDateString();

    if (btn.innerText === "Update") {
        inputField.disabled = false;
        inputField.className = "w-16 px-1 py-1 bg-white border border-indigo-400 rounded text-xs font-bold text-emerald-600 text-center ring-2 ring-indigo-100";
        inputField.focus();
        btn.innerText = "Save";
        btn.className = "px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md font-bold text-[10px]";
    } else {
        const val = parseFloat(inputField.value) || 0;
        
        const { data: sellerData, error: fetchErr } = await _supabase.from('sellers').select('date_payments, today_payment').eq('mlot_id', currentMlotId).eq('code', code).single();
        
        if (fetchErr) {
            alert("Error fetching seller record: " + fetchErr.message);
            return;
        }

        let datePayments = sellerData && sellerData.date_payments ? sellerData.date_payments : {};
        datePayments[dateFilter] = val;

        const { error } = await _supabase.from('sellers').update({ 
            date_payments: datePayments,
            today_payment: dateFilter === getLocalDateString() ? val : sellerData.today_payment
        }).eq('mlot_id', currentMlotId).eq('code', code);
        
        if (error) {
            alert("Error updating payment: " + error.message);
            return;
        }

        inputField.disabled = true;
        inputField.className = "w-16 px-1 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-bold text-emerald-600 text-center";
        btn.innerText = "Update";
        btn.className = "px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-[10px] shadow-sm";
        alert("Payment updated and saved for " + dateFilter + "!");
        renderLedgerBookTable();
    }
}

// ================= BORDERED LEDGER PDF GENERATION =================
async function generateLedgerPDFObj() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const dateFilter = document.getElementById('ledger-filter-date').value || getLocalDateString();
    
    const { data: mlotData } = await _supabase.from('mlot_users').select('*').eq('mlot_id', currentMlotId).maybeSingle();
    const businessName = mlotData ? mlotData.business_name : "MLOT Business";
    const contactMob = mlotData ? mlotData.mobile : "";

    doc.setFontSize(10);
    doc.text(`Generated Date: ${getLocalDateString().split('-').reverse().join('.')}`, 14, 15);
    
    doc.setFontSize(14);
    doc.text(`${businessName} (${currentMlotId})`, 105, 15, { align: 'center' });
    
    doc.setFontSize(10);
    if(contactMob) {
        doc.text(`Contact: ${contactMob}`, 105, 21, { align: 'center' });
    }

    doc.text(`Ledger Summary Date: ${dateFilter.split('-').reverse().join('.')}`, 14, 27);

    let tableRows = [];
    const tbody = document.getElementById('ledger-table-tbody');
    const rows = tbody.querySelectorAll('tr');

    let pSum = 0, tSum = 0, paySum = 0, bSum = 0;

    rows.forEach((row) => {
        const cols = row.querySelectorAll('td');
        if(cols.length >= 8) {
            let sl = cols[0].innerText;
            let dt = cols[1].innerText;
            let code = cols[2].innerText;
            let name = cols[3].innerText;
            let tDue = cols[4].innerText;
            let todayDue = cols[5].innerText;
            let pay = cols[6].querySelector('input').value;
            let bal = cols[7].innerText;

            pSum += parseFloat(tDue.replace('₹', '')) || 0;
            tSum += parseFloat(todayDue.replace('₹', '')) || 0;
            paySum += parseFloat(pay) || 0;
            bSum += parseFloat(bal.replace('₹', '')) || 0;

            tableRows.push([sl, dt, code, name, tDue, todayDue, `₹${parseFloat(pay).toFixed(2)}`, bal]);
        }
    });

    doc.autoTable({
        startY: 32,
        head: [['Sl', 'Date', 'Code', 'Name', 'Total Due', 'Today Due', 'Payment', 'Balance']],
        body: tableRows,
        foot: [['', '', '', 'Total:', `₹${pSum.toFixed(2)}`, `₹${tSum.toFixed(2)}`, `₹${paySum.toFixed(2)}`, `₹${bSum.toFixed(2)}`]],
        theme: 'grid',
        headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold', lineWidth: 0.1, lineColor: [0, 0, 0] },
        bodyStyles: { lineWidth: 0.1, lineColor: [0, 0, 0], textColor: [0, 0, 0] },
        footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', lineWidth: 0.1, lineColor: [0, 0, 0] },
        styles: { fontSize: 8, cellPadding: 2 }
    });

    return doc;
}

async function generateLedgerPDF() {
    const doc = await generateLedgerPDFObj();
    doc.save(`Ledger_Report_${getLocalDateString()}.pdf`);
}

async function showLedgerPDF() {
    const doc = await generateLedgerPDFObj();
    const pdfBlob = doc.output('bloburl');
    window.open(pdfBlob, '_blank');
}

async function downloadLedgerPDF() {
    await generateLedgerPDF();
}