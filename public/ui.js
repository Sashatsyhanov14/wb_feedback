let state = {
    sellerId: null,
    shops: [],
    activeShopId: null,
    settings: {
        // Seller-level (auth + subscription)
        subscription_status: 'free',
        subscription_expires_at: null,
        auth_provider: null,
        display_name: '',
        email: '',
        avatar_url: ''
    },
    reviews: [],
    matrix: [],
    currentView: 'settings',
    stats: { approved: 0, pending: 0, total: 0, approvedToday: 0 },
    tickets: [],
    globalStats: { todayProcessed: 0, totalProcessed: 0, hoursSaved: 0, greenZoneCount: 0, redZone: [] },
    shopSearch: '',
    selectedShops: [],
    registryView: 'grid',
    reviewsFilterShopId: null // null means All Shops
};

// Helper for API calls with token
async function apiFetch(url, options = {}) {
    const cookieToken = document.cookie.split('; ').find(row => row.startsWith('auth_token='))?.split('=')[1];
    const localToken = localStorage.getItem('auth_token');
    const token = localToken || cookieToken;
    
    const headers = { ...options.headers };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    return fetch(url, { ...options, headers });
}

document.addEventListener('DOMContentLoaded', async () => {

    // Handle Supabase implicit flow hash (for Magic Link)
    // URL looks like: /app#access_token=...&token_type=bearer&type=magiclink
    const hash = window.location.hash;
    let magicLinkProcessed = false;
    
    if (hash && hash.includes('access_token=')) {
        console.log('Supabase implicit token detected in URL hash');
        const hashParams = new URLSearchParams(hash.substring(1));
        const supabaseToken = hashParams.get('access_token');
        
        if (supabaseToken) {
            try {
                const verifyRes = await apiFetch('/api/auth/magic-verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ access_token: supabaseToken })
                });
                
                if (verifyRes.ok) {
                    const data = await verifyRes.json();
                    document.cookie = `auth_token=${data.token}; path=/; max-age=${30 * 24 * 60 * 60}; SameSite=Lax`;
                    localStorage.setItem('auth_token', data.token);
                    state.sellerId = data.sellerId;
                    magicLinkProcessed = true;
                    console.log('Magic link auth success, sellerId:', data.sellerId);
                    
                    if (data.isNew && typeof gtag === 'function') {
                        gtag('event', 'sign_up', { method: 'magic_link' });
                    }
                } else {
                    console.error('Magic link verify failed:', await verifyRes.text());
                }
            } catch (e) {
                console.error('Magic link verify error:', e);
            }
        }
        // Clean hash
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Check for token in multiple places
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    
    // IF we have a token in URL, save it immediately before anything else
    if (urlToken) {
        console.log('Token found in URL, saving to cookies and localStorage');
        document.cookie = `auth_token=${urlToken}; path=/; max-age=${30 * 24 * 60 * 60}; SameSite=Lax`;
        localStorage.setItem('auth_token', urlToken);
        // We don't clean the URL yet to allow other logic (like isNew) to see it
    }

    const cookieToken = document.cookie.split('; ').find(row => row.startsWith('auth_token='))?.split('=')[1];
    const localToken = localStorage.getItem('auth_token');
    const activeToken = urlToken || cookieToken || localToken;
    

    const isTelegram = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData;
    const isLoginPage = window.location.pathname === '/login';
    
    if (!activeToken && !magicLinkProcessed && !isTelegram) {
        if (isLoginPage || urlParams.get('error')) {
            // We're on /login already (or have an error param) — show login, don't loop
            showView('login');
        } else {
            // Only auto-redirect to guest creation from /app (first visit)
            window.location.href = '/api/auth/guest';
        }
        return; 
    }

    // 1. Check Auth (Web or Mini App)
    if (!magicLinkProcessed) {
        await checkAuth(activeToken);
    }

    // 2. Initial View — render immediately, then load data
    if (!state.sellerId) {
        // If we already had a token (from URL or storage) but /me rejected it,
        // do NOT redirect to /api/auth/guest again — that creates an infinite loop.
        // Show the login page so the user can try another method.
        if (activeToken) {
            console.warn('[Init] Had a token but checkAuth failed — showing login (not redirecting to guest again)');
            showView('login');
        } else if (urlParams.get('error')) {
            showView('login');
        } else {
            window.location.href = '/api/auth/guest';
        }
    } else {
        // First visit ever → AI test tab
        const hasVisited = localStorage.getItem('wb_has_visited');
        if (!hasVisited) {
            localStorage.setItem('wb_has_visited', '1');
            showView('ai');
        } else {
            showView('ai'); // show test while loading
        }
        await refreshData();
        
        // Smart routing only if we don't have a view preference
        const currentPath = window.location.hash.replace('#', '');
        const validViews = ['settings', 'reviews', 'subscription', 'interface', 'admin', 'ai'];
        
        let targetView = state.currentView;
        if (!targetView && validViews.includes(currentPath)) {
            targetView = currentPath;
        }
        
        if (!targetView) {
            targetView = getSmartView();
        }
        
        showView(targetView);
    }

    // 3. Handle Payment Redirect Hash
    if (window.location.hash === '#success') {
        showToast('Оплата прошла успешно');
        window.location.hash = '';
    } else if (window.location.hash === '#fail') {
        showToast('Ошибка оплаты. Попробуйте снова.', true);
        window.location.hash = '';
    }
});

async function checkAuth(providedToken) {
    try {
        const cookieToken = document.cookie.split('; ').find(row => row.startsWith('auth_token='))?.split('=')[1];
        const localToken = localStorage.getItem('auth_token');
        const token = providedToken || localToken || cookieToken;
        
        console.log('[checkAuth] token present:', !!token, '| source:', providedToken ? 'provided' : (localToken ? 'localStorage' : (cookieToken ? 'cookie' : 'none')));

        if (!token) {
            console.warn('[checkAuth] No token available, skipping /me call');
            return;
        }

        // Explicitly pass the token to the fetch call — do NOT rely on apiFetch's
        // cookie/localStorage lookup, because in Incognito the cookie we just set
        // may not be readable in the same tick.
        const res = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.ok) {
            const data = await res.json();
            state.sellerId = data.sellerId;
            console.log('[checkAuth] Auth success, sellerId:', state.sellerId);
        } else {
            console.warn('[checkAuth] /me returned', res.status);
            if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) {
                // Automatic login for Mini App
                const tg = window.Telegram.WebApp;
                tg.expand();
                tg.ready();
                
                const rawData = tg.initDataUnsafe;
                const resAuth = await fetch('/api/auth/tg-callback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(rawData.user)
                });
                if (resAuth.ok) {
                    const data = await resAuth.json();
                    state.sellerId = data.sellerId;
                }
            }
        }
    } catch (e) {
        console.error('[checkAuth] Error:', e);
    }
}

async function refreshData() {
    if (!state.sellerId) return;
    try {
        const adminId = '68cfdf5a-25fb-43f5-8672-c03d1bddc29b';
        
        // 1. Fetch seller settings (auth + subscription) and shops in parallel
        const [sellerRes, shopsRes] = await Promise.all([
            apiFetch('/api/settings'),
            apiFetch('/api/shops')
        ]);

        if (sellerRes.ok) {
            const sellerData = await sellerRes.json();
            state.settings = { ...state.settings, ...sellerData };
        }

        if (shopsRes.ok) {
            state.shops = await shopsRes.json();
            if (state.shops.length > 0 && !state.activeShopId) {
                state.activeShopId = state.shops[0].id;
            }
        }

        // 2. Fetch remaining data
        const reqs = {
            reviews: apiFetch(state.reviewsFilterShopId ? `/api/reviews?shopId=${state.reviewsFilterShopId}` : '/api/reviews').then(r => r.ok ? r.json() : []),
            support: apiFetch(`/api/support`).then(r => r.ok ? r.json() : []),
            globalStats: apiFetch(`/api/stats/global`).then(r => r.ok ? r.json() : null)
        };

        if (state.activeShopId) {
            reqs.matrix = apiFetch(`/api/matrix?shopId=${state.activeShopId}`).then(r => r.ok ? r.json() : []);
            reqs.stats = apiFetch(`/api/stats?shopId=${state.activeShopId}`).then(r => r.ok ? r.json() : null);
        }

        const keys = Object.keys(reqs);
        const results = await Promise.all(Object.values(reqs));
        
        const data = {};
        keys.forEach((key, i) => data[key] = results[i]);

        // Apply results to state
        if (data.reviews) state.reviews = data.reviews;
        if (data.support) state.tickets = data.support;
        if (data.globalStats) state.globalStats = data.globalStats;
        if (data.matrix) state.matrix = data.matrix;
        if (data.stats) state.stats = data.stats;

        // Update UI components that depend on data
        showView(state.currentView);

        // --- ONBOARDING & EXPIRED TRIAL PROMPTS ---
        // Subscription is now on seller level (state.settings)
        const isTrial = state.settings.subscription_status === 'trial';
        const expiresAt = state.settings.subscription_expires_at ? new Date(state.settings.subscription_expires_at) : null;
        const now = new Date();
        const isExpired = isTrial && expiresAt && now > expiresAt;

        if (isExpired && !window._expiredPromptShown) {
            window._expiredPromptShown = true;
            state.currentView = 'subscription';
            showToast('Тестовый период завершен', true);
        }

    } catch (e) {
        console.error('Refresh data error:', e);
    }
}


async function handleLogout() {
    try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch(e) {}
    // Clear all auth data from client
    localStorage.removeItem('auth_token');
    document.cookie = 'auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
    state.sellerId = null;
    window.location.href = '/';
}

// Smart routing: determines which tab to show based on user state
function getSmartView() {
    // Default view for agencies
    return 'settings';
}

function showView(view) {
    state.currentView = view;
    if (view !== 'login') window.location.hash = view;
    const content = document.getElementById('content-view');
    const nav = document.getElementById('main-nav');
    const sidebar = document.getElementById('desktop-sidebar');
    const mobileHeader = document.getElementById('mobile-header');
    if (!content) return;

    // Hide chrome on login, show on everything else
    if (view === 'login') {
        if (nav) nav.style.display = 'none';
        if (sidebar) sidebar.style.display = 'none';
        if (mobileHeader) mobileHeader.style.display = 'none';
    } else {
        if (nav) nav.style.display = '';
        if (sidebar) sidebar.style.display = '';
        if (mobileHeader) mobileHeader.style.display = '';
    }

    // Google Analytics Virtual Page View
    if (typeof gtag === 'function') {
        gtag('event', 'page_view', { page_path: '/' + view });
        if (view === 'login') {
            gtag('event', 'view_login_page');
        }
    }

    // Update Nav active classes (Mobile & Desktop)
    const navItems = document.querySelectorAll('.tab-item');
    navItems.forEach(item => {
        item.classList.remove('active');
        const icon = item.querySelector('.material-symbols-outlined');
        if (icon) icon.style.fontVariationSettings = "'FILL' 0";
    });
    
    // Highlight matching elements in both navs
    const activeElements = document.querySelectorAll(`[onclick="showView('${view}')"]`);
    activeElements.forEach(el => {
        el.classList.add('active');
        const icon = el.querySelector('.material-symbols-outlined');
        if (icon) icon.style.fontVariationSettings = "'FILL' 1";
    });

    if (view === 'settings') {
        content.innerHTML = renderSettings();
    } else if (view === 'reviews') {
        content.innerHTML = renderReviews();
    } else if (view === 'subscription') {
        content.innerHTML = renderSubscription();
    } else if (view === 'interface') {
        content.innerHTML = renderInterface();
    } else if (view === 'ai') {
        content.innerHTML = renderAIPage();
    } else if (view === 'login') {
        content.innerHTML = renderLogin();
    }

    if (typeof gtag === 'function') {
        gtag('event', 'view_' + view);
    }
}

function handleTelegramLogin() {
    window.open('https://t.me/WBReplyAIbot?start=login', '_blank');
}

function renderLogin() {
    return `
        <div class="flex flex-col items-center justify-center min-h-[85vh] animate-in px-4">
            <div class="w-full max-w-[380px] space-y-10">
                <div class="space-y-3 text-center">
                    <h2 class="flex items-center justify-center font-headline text-3xl sm:text-4xl font-black tracking-tight leading-tight mb-2">
                        <span class="text-text-main">WBREPLY</span>
                        <svg class="w-6 h-6 sm:w-8 sm:h-8 text-[#E1AF66] mx-1 sm:mx-1.5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 0C12 6.627 6.627 12 0 12C6.627 12 12 17.373 12 24C12 17.373 17.373 12 24 12C17.373 12 12 6.627 12 0Z"/>
                        </svg>
                        <span class="text-[#E1AF66]">AI</span>
                    </h2>
                    <p class="text-on-surface-variant text-sm font-medium tracking-wide">
                        В один клик или без регистрации
                    </p>
                </div>

                ${(() => {
                    const params = new URLSearchParams(window.location.search);
                    const error = params.get('error');
                    if (!error) return '';
                    
                    let message = 'Произошла ошибка при входе';
                    if (error === 'too_many_attempts') message = 'Слишком много попыток. Пожалуйста, войдите через Google или VK.';
                    if (error === 'guest_failed') message = 'Не удалось создать гостевой аккаунт';
                    
                    return `
                        <div class="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3 animate-in">
                            <span class="material-symbols-outlined text-red-500 text-lg">error</span>
                            <p class="text-xs font-bold text-red-500 leading-tight">${message}</p>
                        </div>
                    `;
                })()}

                <div class="flex flex-col gap-4">
                    <!-- Guest Button -->
                    <button onclick="window.location.href='/api/auth/guest'" class="w-full h-14 flex items-center justify-center gap-4 bg-primary/10 hover:bg-primary/20 active:scale-[0.97] transition-all rounded-[12px] shadow-sm border border-primary/20 group">
                        <span class="material-symbols-outlined text-primary group-hover:rotate-12 transition-transform">rocket_launch</span>
                        <span class="text-sm font-bold text-primary">Попробовать без регистрации</span>
                    </button>
                    <!-- Google Button -->
                    <button onclick="handleGoogleLogin()" class="w-full h-14 flex items-center justify-center gap-4 bg-white hover:bg-gray-100 active:scale-[0.97] transition-all rounded-[12px] shadow-sm border border-gray-200">
                        <svg style="width: 20px; height: 20px;" viewBox="0 0 48 48">
                            <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path>
                            <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"></path>
                            <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"></path>
                            <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"></path>
                        </svg>
                        <span class="text-sm font-bold text-gray-900">Войти через Google</span>
                    </button>

                    <!-- VK Button -->
                    <button onclick="handleVkLogin()" class="w-full h-14 flex items-center justify-center gap-4 bg-[#0077FF] hover:bg-[#0066DD] active:scale-[0.97] transition-all rounded-[12px] shadow-sm">
                        <svg style="width: 24px; height: 24px;" viewBox="0 0 28 28" fill="none"><path d="M4.54 4.54C3 6.08 3 8.52 3 13.4v1.2c0 4.88 0 7.32 1.54 8.86C6.08 25 8.52 25 13.4 25h1.2c4.88 0 7.32 0 8.86-1.54C25 21.92 25 19.48 25 14.6v-1.2c0-4.88 0-7.32-1.54-8.86C21.92 3 19.48 3 14.6 3h-1.2C8.52 3 6.08 3 4.54 4.54z" fill="#0077FF"/><path d="M7.56 9.85h1.58c.25 0 .41.16.49.48.73 2.7 2.01 5.06 2.52 5.06.18 0 .26-.08.26-.54v-2.78c-.05-1-.58-1.08-.58-1.44 0-.18.15-.35.39-.35h2.49c.21 0 .29.11.29.46v3.74c0 .21.09.29.15.29.18 0 .33-.08.67-.43a14.22 14.22 0 001.94-3.31c.09-.21.24-.4.51-.4h1.58c.33 0 .41.17.33.46-.14.54-1.54 3.03-2.44 4.31-.14.21-.19.32 0 .57.14.18.59.57.89.91.56.63 1 1.16 1.11 1.53.12.37-.07.56-.44.56h-1.58c-.34 0-.5-.14-.75-.44-.61-.67-1.13-1.31-1.35-1.31-.13 0-.19.05-.19.31v1.01c0 .34-.11.43-.39.43-1.18 0-3.76-.07-5.63-2.72a19.7 19.7 0 01-2.47-5.17c-.09-.25 0-.42.33-.42z" fill="white"/></svg>
                        <span class="text-sm font-bold text-white">Войти через VK ID</span>
                    </button>

    <div class="relative py-2">
                        <div class="absolute inset-0 flex items-center"><div class="w-full border-t border-outline-variant/20"></div></div>
                        <div class="relative flex justify-center text-[9px] uppercase tracking-[0.2em] font-black"><span class="bg-bg-main px-4 text-on-surface-variant/30">Или по почте</span></div>
                    </div>

                    <!-- Magic Link Section -->
                    <div class="space-y-4">
                        <input id="magic-email" type="email" placeholder="email@example.com" class="w-full h-14 bg-bg-main border border-outline-variant/30 focus:border-primary outline-none px-5 rounded-[12px] text-sm transition-all text-center">
                        <button id="magic-btn" onclick="handleMagicLogin()" class="w-full h-14 flex items-center justify-center gap-3 bg-surface-container-high hover:bg-surface-container-highest active:scale-[0.98] transition-all rounded-[12px] border border-outline-variant/20">
                            <span class="material-symbols-outlined text-primary text-lg">magic_button</span>
                            <span class="text-xs font-bold text-on-surface uppercase tracking-widest">Войти по ссылке</span>
                        </button>
                    </div>
                </div>

                <div class="flex flex-col items-center gap-6 pt-8 opacity-30">
                    <div class="flex items-center gap-2">
                        <span class="material-symbols-outlined text-sm">verified_user</span>
                        <p class="text-[9px] font-bold uppercase tracking-[0.3em]">Secure Auth System</p>
                    </div>
                    <p class="text-[10px] font-medium tracking-[0.1em]">© 2026 WBREPLY AI</p>
                </div>
            </div>
        </div>
    `;
}

async function handleTestLogin(provider) {
    showToast(`Вход через ${provider} (Тестовый режим)...`);
    try {
        const res = await apiFetch('/api/auth/demo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (res.ok) {
            const data = await res.json();
            state.sellerId = data.sellerId;
            showToast('Успешный вход!', false);
            setTimeout(() => {
                showView('reviews');
                refreshData();
            }, 800);
        } else {
            // Fallback for UI-only testing if backend is not ready
            state.sellerId = '795056847';
            showToast('Вход (UI-Demo режим)', false);
            setTimeout(() => {
                showView('reviews');
                refreshData();
            }, 800);
        }
    } catch (err) {
        // Even on network error, allow entering for UI demonstration
        state.sellerId = '795056847';
        showToast('Вход (Offline-Demo)', false);
        setTimeout(() => {
            showView('reviews');
            refreshData();
        }, 800);
    }
}

async function handleGoogleLogin() {
    if (typeof gtag === 'function') gtag('event', 'login_google');
    window.location.href = '/api/auth/google';
}

async function handleVkLogin() {
    if (typeof gtag === 'function') gtag('event', 'login_vk');
    window.location.href = '/api/auth/vk';
}

async function handleMagicLogin() {
    if (typeof gtag === 'function') gtag('event', 'login_magic');
    const email = document.getElementById('magic-email').value;
    if (!email || !email.includes('@')) {
        return showToast('Введите корректный email', true);
    }

    const btn = document.getElementById('magic-btn');
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="animate-spin material-symbols-outlined">sync</span><span>Отправка...</span>';

    try {
        const res = await apiFetch('/api/auth/magic', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        
        const data = await res.json();
        if (res.ok) {
            showToast('Ссылка отправлена на почту!');
            btn.innerHTML = '<span>Проверьте почту ✉️</span>';
        } else {
            showToast(data.error || 'Ошибка отправки', true);
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
    } catch (e) {
        showToast('Ошибка сети', true);
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
}

async function handleLinkMagic() {
    const email = document.getElementById('link-email').value;
    if (!email || !email.includes('@')) {
        return showToast('Введите корректный email', true);
    }

    const btn = document.getElementById('link-email-btn');
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Отправка...';

    try {
        const res = await apiFetch('/api/auth/magic', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        
        const data = await res.json();
        if (res.ok) {
            showToast('Ссылка отправлена на почту! Перейдите по ней для привязки.');
            btn.innerHTML = 'Проверьте почту ✉️';
        } else {
            showToast(data.error || 'Ошибка отправки', true);
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
    } catch (e) {
        showToast('Ошибка сети', true);
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
}

function initTelegramWidget() {
    const container = document.getElementById('tg-login-container');
    if (!container) return;

    // Optional: inject official widget if preferred over redirect button
    /*
    const script = document.createElement('script');
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute('data-telegram-login', 'WBReplyAIbot');
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '12');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    script.setAttribute('data-request-access', 'write');
    container.innerHTML = '';
    container.appendChild(script);
    */
}

function initVkOneTap() {
    if (!window.VKIDSDK) return;
    
    const VKID = window.VKIDSDK;
    const container = document.getElementById('vk-onetap-container');
    if (!container) return;
    
    // Clean up previous instance if any
    container.innerHTML = '';

    const redirectUri = window.location.origin + '/api/auth/vk/callback';

    VKID.Config.init({
        app: 54569358,
        redirectUrl: redirectUri,
        responseMode: VKID.ConfigResponseMode.Callback,
        source: VKID.ConfigSource.LOWCODE,
    });

    const oneTap = new VKID.OneTap();
    
    oneTap.render({
        container: container,
        showAlternativeLogin: true
    })
    .on(VKID.WidgetEvents.ERROR, (err) => {
        console.error('VK OneTap Error:', err);
    })
    .on(VKID.OneTapInternalEvents.LOGIN_SUCCESS, function (payload) {
        console.log('VK OneTap payload:', JSON.stringify(payload));
        const code = payload.code;
        const deviceId = payload.device_id || '';
        const state = payload.state || '';
        const codeVerifier = payload.code_verifier || '';
        if (code) {
            const params = new URLSearchParams({
                code, device_id: deviceId, state, code_verifier: codeVerifier, source: 'sdk'
            });
            window.location.href = `/api/auth/vk/callback?${params.toString()}`;
        }
    });
}

function initVkFloatingOneTap() {
    // Disabled to avoid UI clutter as requested
    return;
}

function initVkOAuthList() {
    if (!window.VKIDSDK) return;
    
    const VKID = window.VKIDSDK;
    const container = document.getElementById('vk-oauth-list-container');
    if (!container) return;
    
    container.innerHTML = '';

    const oAuth = new VKID.OAuthList();
    oAuth.render({
        container: container,
        oauthList: ['vkid']
    })
    .on(VKID.WidgetEvents.ERROR, (err) => console.error('VK OAuthList Error:', err))
    .on(VKID.OAuthListInternalEvents.LOGIN_SUCCESS, function (payload) {
        console.log('VK OAuthList payload:', JSON.stringify(payload));
        const code = payload.code;
        const deviceId = payload.device_id || '';
        const state = payload.state || '';
        const codeVerifier = payload.code_verifier || '';
        if (code) {
            const params = new URLSearchParams({
                code, device_id: deviceId, state, code_verifier: codeVerifier, source: 'sdk'
            });
            window.location.href = `/api/auth/vk/callback?${params.toString()}`;
        }
    });
}


window.onTelegramAuth = async function(user) {
    try {
        const res = await apiFetch('/api/auth/tg-callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(user)
        });
        
        if (res.ok) {
            const data = await res.json();
            state.sellerId = data.sellerId;
            showToast('Успешный вход');
            showView('ai');
            await refreshData();
            showView(getSmartView());
        } else {
            const data = await res.json();
            showToast(data.error || 'Ошибка входа', true);
        }
    } catch (e) {
        console.error('Auth callback error:', e);
        showToast('Ошибка сети', true);
    }
}

function renderSettings() {
    if (state.shops.length === 0) {
        return `
            <div class="max-w-2xl mx-auto py-20 text-center animate-in">
                <div class="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                    <span class="material-symbols-outlined text-primary text-4xl">storefront</span>
                </div>
                <h2 class="text-2xl font-bold mb-4">У вас пока нет магазинов</h2>
                <p class="text-on-surface-variant mb-8">Добавьте свой первый магазин Wildberries, чтобы начать автоматизацию ответов.</p>
                <button onclick="showAddShopModal()" class="primary-btn px-10 py-4 text-xs uppercase tracking-widest">Добавить магазин</button>
            </div>
        `;
    }

    if (state.editingShopId) {
        return renderShopEdit(state.editingShopId);
    }

    const filteredShops = state.shops.filter(s => 
        s.name.toLowerCase().includes(state.shopSearch.toLowerCase())
    );

    return `
        <div class="w-full space-y-10 animate-in pb-20">
            <header class="relative flex flex-col items-center justify-center text-center">
                <p class="text-primary text-[10px] font-black uppercase tracking-[0.3em] mb-2">Управление</p>
                <h2 class="font-headline text-3xl sm:text-4xl font-bold text-text-main tracking-tight">Магазины</h2>
                
                <button onclick="showAddShopModal()" class="absolute right-0 top-1/2 -translate-y-1/2 text-[10px] font-black uppercase tracking-widest text-primary hover:text-white transition-all flex items-center gap-2">
                    <span class="material-symbols-outlined text-sm">add</span>
                    Добавить
                </button>
            </header>

            <!-- Search & Actions -->
            <div class="flex flex-col sm:flex-row items-center gap-6 max-w-2xl mx-auto w-full">
                <div class="relative flex-1 w-full group">
                    <span class="material-symbols-outlined absolute left-0 top-1/2 -translate-y-1/2 text-on-surface-variant/40 group-focus-within:text-primary transition-colors">search</span>
                    <input type="text" placeholder="Поиск магазина..." value="${state.shopSearch}" oninput="handleShopSearch(this.value)" 
                        class="w-full bg-transparent border-b border-outline-variant/30 outline-none pl-8 pr-4 py-3 text-text-main text-sm focus:border-primary transition-all">
                </div>
                
                ${state.selectedShops.length > 0 ? `
                    <div class="flex items-center gap-4 animate-in fade-in">
                        <button onclick="bulkPause(true)" class="text-[10px] font-black uppercase tracking-widest text-on-surface-variant hover:text-primary transition-all">Вкл</button>
                        <button onclick="bulkPause(false)" class="text-[10px] font-black uppercase tracking-widest text-on-surface-variant hover:text-primary transition-all">Пауза</button>
                        <button onclick="bulkPrompt()" class="text-[10px] font-black uppercase tracking-widest text-on-surface-variant hover:text-primary transition-all">Промпт</button>
                    </div>
                ` : ''}
            </div>

            <!-- Registry Content (Unified Grid/List) -->
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
                ${filteredShops.map(shop => {
                    const hasPending = state.reviews.some(r => r.shop_id === shop.id && r.status === 'pending');
                    const isBotActive = shop.is_auto_reply_enabled;
                    const answersCount = state.reviews.filter(r => 
                        r.shop_id === shop.id && 
                        (r.status === 'auto_posted' || r.status === 'approved') && 
                        (new Date() - new Date(r.created_at)) < 24 * 60 * 60 * 1000
                    ).length;

                    return `
                        <div class="group bg-[#161616] border border-white/5 rounded-xl p-5 cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:border-[#E2B67B]/50 hover:shadow-[0_4px_20px_rgba(226,182,123,0.05)] relative overflow-hidden" onclick="editShop('${shop.id}')">
                            
                            <!-- Header: Name & Status -->
                            <div class="flex justify-between items-start">
                                <h3 class="text-white font-medium text-[15px] tracking-wide truncate pr-4">${shop.name}</h3>
                                
                                <!-- Pulsing Status -->
                                <div class="relative flex items-center justify-center w-4 h-4 shrink-0">
                                    ${isBotActive ? `
                                        <span class="absolute inline-flex w-full h-full rounded-full opacity-20 bg-green-500 animate-ping"></span>
                                        <span class="relative inline-flex w-2 h-2 rounded-full bg-green-500"></span>
                                    ` : `
                                        <span class="relative inline-flex w-2 h-2 rounded-full bg-neutral-600"></span>
                                    `}
                                </div>
                            </div>

                            <!-- Spacer -->
                            <div class="h-8"></div>

                            <!-- Footer: Stats & Settings -->
                            <div class="flex justify-between items-end">
                                <p class="text-[11px] text-neutral-500 uppercase tracking-wider font-semibold">
                                    24h: ${answersCount} отв.
                                </p>
                                
                                <!-- Settings Icon (Visible on hover) -->
                                <div class="opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                    <span class="material-symbols-outlined text-[18px] text-neutral-400 hover:text-[#E2B67B] transition-colors">settings</span>
                                </div>
                            </div>

                            ${hasPending ? `
                                <div class="absolute top-0 left-0 w-1 h-full bg-primary/40"></div>
                            ` : ''}
                        </div>
                    `;
                }).join('')}

                ${filteredShops.length === 0 && state.shopSearch ? `
                    <div class="col-span-full py-12 text-center">
                        <p class="text-sm text-on-surface-variant">Ничего не найдено</p>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

function renderShopEdit(shopId) {
    const activeShop = state.shops.find(s => s.id === shopId);
    if (!activeShop) return '';
    const isTokenMissing = !activeShop.wb_token;

    return `
        <div class="max-w-2xl mx-auto space-y-10 animate-in pb-20">
            <header class="relative flex flex-col items-center justify-center pt-2 pb-6">
                <button onclick="closeShopEdit()" class="absolute left-0 top-0 p-2 text-on-surface-variant hover:text-text-main transition-all">
                    <span class="material-symbols-outlined">arrow_back</span>
                </button>
                
                <div class="text-center space-y-1">
                    <p class="text-primary text-[10px] font-black uppercase tracking-[0.3em]">Настройки магазина</p>
                    <input id="shop-name-input" class="bg-transparent border-none outline-none focus:ring-0 focus:border-none font-headline text-3xl font-bold text-text-main tracking-tight w-full max-w-md focus:text-primary transition-colors p-0 text-center" 
                        type="text" value="${activeShop.name}" placeholder="Название магазина">
                </div>

                <button onclick="handleDeleteShop('${activeShop.id}')" class="absolute right-0 top-0 p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-all" title="Удалить магазин">
                    <span class="material-symbols-outlined">delete</span>
                </button>
            </header>

            <div class="space-y-12">
                <div class="space-y-4">
                    <div class="flex flex-col gap-1.5">
                        <div class="flex items-center gap-2">
                            <label class="text-xs font-bold uppercase tracking-widest text-on-surface-variant">API Токен Wildberries</label>
                            <button onclick="document.getElementById('api-instructions').classList.toggle('hidden')" class="w-4 h-4 rounded-full border border-primary text-primary flex items-center justify-center font-bold text-[10px] hover:bg-primary/20 transition-all cursor-pointer">i</button>
                        </div>
                        
                        <div id="api-instructions" class="hidden premium-card p-4 my-2 bg-primary/5 border border-primary/20 text-xs text-on-surface-variant leading-relaxed space-y-3">
                            <p class="font-bold text-text-main uppercase tracking-widest text-[10px]">Как получить токен:</p>
                            <ol class="list-decimal pl-5 space-y-2 text-on-surface-variant">
                                <li>Откройте портал селлера: <a href="https://seller.wildberries.ru/supplier-settings/access-to-api" target="_blank" class="text-primary hover:underline font-bold transition-all">Настройки → Доступ к API</a></li>
                                <li>Нажмите <b>«Создать новый токен»</b>.</li>
                                <li>Введите любое имя (например, WBReply) и обязательно отметьте галочками два пункта: <span class="text-white font-medium">«Отзывы и вопросы»</span> и <span class="text-white font-medium">«Контент»</span>.</li>
                                <li>Скопируйте созданный ключ и вставьте его в поле ниже.</li>
                            </ol>
                        </div>
                        
                        <p class="text-[11px] text-on-surface-variant font-medium">Нужны права «Вопросы и отзывы» + «Контент».</p>
                    </div>

                    <div class="relative">
                        <input id="wb-token-input" class="w-full bg-bg-main border border-outline-variant outline-none py-4 px-5 pr-12 text-text-main text-sm font-mono focus:border-primary transition-colors rounded-lg" 
                            type="password" value="${activeShop.wb_token || ''}" placeholder="Вставьте ваш API ключ">
                        <button class="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-primary transition-colors" onclick="toggleTokenVisibility()">
                            <span id="token-visibility-icon" class="material-symbols-outlined text-lg">visibility</span>
                        </button>
                    </div>
                </div>

                <div class="space-y-4">
                    <label class="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Инструкции для ИИ (Tone of Voice)</label>
                    <textarea id="ai-instructions-input" class="w-full bg-bg-main border border-outline-variant outline-none p-5 text-text-main text-sm leading-relaxed h-48 focus:border-primary transition-colors resize-none rounded-lg" 
                        placeholder="Пример: Будь профессионален, обращайся на Вы, упоминай наш бренд...">${activeShop.custom_instructions || ''}</textarea>

            </div>

            <button id="save-settings-btn" onclick="handleSaveSettings()" class="primary-btn w-full py-4 sm:py-5 text-xs uppercase tracking-[0.2em] shadow-lg active:scale-[0.99] transition-all">
                Сохранить изменения
            </button>
        </div>
    `;
}

function renderReviews() {
    return `
        <div class="w-full space-y-8 animate-in pb-20">
            <header class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <p class="text-primary text-[10px] font-black uppercase tracking-[0.3em] mb-2">Активность</p>
                    <h2 class="font-headline text-2xl sm:text-3xl font-bold text-text-main tracking-tight">Лента ответов</h2>
                </div>
                
                <!-- Shop Search & Filter -->
                <div class="flex items-center gap-4 bg-surface-container-low/50 backdrop-blur-sm rounded-xl border border-outline-variant/30 p-1 group focus-within:border-primary/50 transition-all shadow-sm">
                    <!-- Search -->
                    <div class="flex items-center gap-2 px-3 border-r border-outline-variant/10">
                        <span class="material-symbols-outlined text-[18px] opacity-30 group-focus-within:opacity-100 group-focus-within:text-primary transition-all">search</span>
                        <input type="text" 
                            id="review-search-input"
                            placeholder="Поиск..." 
                            oninput="state.reviewsSearch = this.value; renderReviewsList()"
                            value="${state.reviewsSearch || ''}"
                            class="bg-transparent border-none outline-none text-[10px] font-black uppercase tracking-widest text-on-surface-variant w-28 placeholder:text-[9px] placeholder:opacity-20">
                    </div>
                    
                    <!-- Rating Filters -->
                    <div class="flex items-center gap-1 px-2 border-r border-outline-variant/10">
                        ${[5, 4, 3, 2, 1].map(r => `
                            <button onclick="toggleRatingFilter(${r})" 
                                class="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black transition-all ${state.reviewsRatingFilter === r ? 'bg-primary text-bg' : 'text-on-surface-variant/40 hover:bg-primary/10 hover:text-primary'}">
                                ${r}
                            </button>
                        `).join('')}
                    </div>

                    <!-- Shop Dropdown -->
                    <div class="flex items-center px-1 gap-1">
                        <button onclick="setReviewsFilter(null)" 
                            class="px-4 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${state.reviewsFilterShopId === null ? 'bg-primary text-bg shadow-lg shadow-primary/20' : 'text-on-surface-variant/60 hover:text-primary hover:bg-primary/5'}">
                            Все сети
                        </button>
                        <div class="relative flex items-center h-8 bg-black/10 rounded-lg px-2 group/select">
                            <select onchange="setReviewsFilter(this.value)" 
                                class="appearance-none bg-transparent border-none outline-none text-[9px] font-black uppercase tracking-widest text-on-surface-variant pr-6 cursor-pointer hover:text-primary transition-colors z-10">
                                <option value="" ${state.reviewsFilterShopId === null ? 'selected' : ''} disabled>Сеть...</option>
                                ${state.shops
                                    .filter(s => !state.reviewsSearch || s.name.toLowerCase().includes(state.reviewsSearch.toLowerCase()))
                                    .map(s => `<option value="${s.id}" ${state.reviewsFilterShopId === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
                            </select>
                            <span class="material-symbols-outlined absolute right-2 text-sm opacity-30 pointer-events-none group-hover/select:text-primary group-hover/select:opacity-100 transition-all">expand_more</span>
                        </div>
                    </div>
                </div>
            </header>

            <div id="reviews-list-container">
                ${renderReviewsList()}
            </div>
        </div>
    `;
}

function renderReviewsList() {
    const search = (state.reviewsSearch || '').toLowerCase();
    const filtered = state.reviews.filter(r => {
        if (state.reviewsFilterShopId && r.shop_id !== state.reviewsFilterShopId) return false;
        if (state.reviewsRatingFilter && r.rating !== state.reviewsRatingFilter) return false;
        if (!search) return true;
        const shop = state.shops.find(s => s.id === r.shop_id);
        return r.review_text.toLowerCase().includes(search) || 
               r.product_name.toLowerCase().includes(search) ||
               (shop && shop.name.toLowerCase().includes(search));
    });

    const html = `
            ${(!filtered || filtered.length === 0) ? `
                <div class="flex flex-col items-center justify-center py-24 text-center animate-in opacity-40">
                    <span class="material-symbols-outlined text-5xl mb-4 font-light">inventory_2</span>
                    <p class="text-xs font-bold uppercase tracking-widest">Ничего не найдено</p>
                </div>
            ` : `
                <!-- Mobile card layout -->
            <div class="sm:hidden flex flex-col rounded-xl border border-outline-variant/30 bg-bg-main shadow-sm mb-6 custom-h-70vh">
                <div class="custom-flex-scroll p-2 space-y-3">
                ${filtered.map(review => {
                    const isAuto = review.status === 'auto_posted';
                    return `
                        <div onclick="showReviewDetail('${review.id}')" class="premium-card p-4 space-y-3 relative overflow-hidden shrink-0 cursor-pointer">
                            ${isAuto ? '<div class="absolute left-0 top-0 bottom-0 w-1 bg-wb-purple"></div>' : ''}
                            <div class="flex items-center justify-between">
                                <div class="flex items-center gap-2 min-w-0">
                                    <span class="flex items-center gap-0.5 text-primary font-bold text-xs">
                                        ${review.rating}
                                        <svg class="w-2.5 h-2.5 fill-current" viewBox="0 0 24 24">
                                            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                                        </svg>
                                    </span>
                                    <span class="text-text-main font-bold text-[11px] truncate uppercase tracking-tight">${review.product_name || 'WB Product'}</span>
                                </div>
                                <span class="w-2 h-2 rounded-full ${isAuto ? 'bg-wb-purple shadow-[0_0_8px_rgba(124,58,237,0.5)]' : 'bg-outline-variant'}"></span>
                            </div>
                            <p class="text-[11px] text-on-surface-variant italic font-light leading-relaxed line-clamp-2">"${review.review_text}"</p>
                            <p class="text-[11px] text-text-main leading-relaxed line-clamp-2">${review.ai_response_draft}</p>
                        </div>
                    `;
                }).join('')}
                </div>
            </div>

            <!-- Desktop table layout -->
            <div class="hidden sm:flex flex-col border border-outline-variant/20 rounded-lg bg-bg-main shadow-sm overflow-hidden">
                <div class="grid grid-cols-12 gap-3 px-4 py-2 border-b border-outline-variant/10 text-[9px] font-black uppercase tracking-widest text-on-surface-variant shrink-0 bg-surface/50">
                    <div class="col-span-1">Оценка</div>
                    <div class="col-span-2">Магазин/Товар</div>
                    <div class="col-span-5">Текст отзыва</div>
                    <div class="col-span-4">Ответ ИИ</div>
                </div>
                <div class="divide-y divide-outline-variant/10 custom-flex-scroll">
                    ${filtered.map(review => {
                        const shop = state.shops.find(s => s.id === review.shop_id);
                        
                        // Semantic colors for ratings
                        let ratingClass = 'text-primary';
                        if (review.rating >= 5) ratingClass = 'text-emerald-400';
                        if (review.rating <= 2) ratingClass = 'text-rose-400/80';

                        return `
                            <div onclick="showReviewDetail('${review.id}')" class="grid grid-cols-12 gap-3 px-4 py-1.5 items-center hover:bg-surface/30 transition-colors group relative cursor-pointer">
                                <div class="col-span-1 flex items-center gap-1">
                                    <span class="text-[10px] font-bold ${ratingClass}">${review.rating}</span>
                                    <span class="material-symbols-outlined text-[10px] ${ratingClass}">star</span>
                                </div>
                                <div class="col-span-2 min-w-0">
                                    <div class="text-[9px] font-black text-primary truncate uppercase tracking-tighter mb-0.5">${shop?.name || 'Shop'}</div>
                                    <div class="text-[8px] text-on-surface-variant truncate uppercase font-medium opacity-60">${review.product_name}</div>
                                </div>
                                <div class="col-span-5 text-[10px] text-on-surface-variant truncate font-light italic pr-4">
                                    "${review.review_text}"
                                </div>
                                <div class="col-span-4 text-[10px] text-text-main truncate font-medium">
                                    ${review.ai_response_draft}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
            `}
    `;
    
    const container = document.getElementById('reviews-list-container');
    if (container) {
        container.innerHTML = html;
        return '';
    }
    return html;
}

function showReviewDetail(id) {
    const review = state.reviews.find(r => r.id === id);
    if (!review) return;
    const shop = state.shops.find(s => s.id === review.shop_id);

    const modal = document.createElement('div');
    modal.id = 'review-detail-modal';
    modal.className = 'fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in';
    modal.innerHTML = `
        <div class="absolute inset-0 bg-bg/80 backdrop-blur-md" onclick="this.parentElement.remove()"></div>
        <div class="relative w-full max-w-xl bg-surface border border-outline-variant/30 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div class="p-6 border-b border-outline-variant/20 flex items-center justify-between bg-surface-container-low">
                <div>
                    <p class="text-primary text-[10px] font-black uppercase tracking-[0.2em] mb-1">${shop?.name || 'Магазин'}</p>
                    <h3 class="text-lg font-bold text-text-main">${review.product_name}</h3>
                </div>
                <button onclick="this.closest('#review-detail-modal').remove()" class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-container transition-colors">
                    <span class="material-symbols-outlined text-xl">close</span>
                </button>
            </div>
            <div class="p-8 space-y-8 max-h-[70vh] overflow-y-auto">
                <section class="space-y-4">
                    <div class="flex items-center justify-between">
                        <h4 class="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Отзыв покупателя</h4>
                        <div class="flex items-center gap-1">
                            <span class="text-xs font-bold text-primary">${review.rating}</span>
                            <span class="material-symbols-outlined text-xs text-primary">star</span>
                        </div>
                    </div>
                    <div class="premium-card p-5 bg-surface-container-low border-outline-variant/10 italic text-sm leading-relaxed text-on-surface-variant">
                        "${review.review_text}"
                    </div>
                </section>

                <section class="space-y-4">
                    <h4 class="text-[10px] font-black uppercase tracking-widest text-primary">Ответ системы</h4>
                    <div class="premium-card p-6 bg-primary/5 border-primary/20 text-sm leading-relaxed text-text-main font-medium">
                        ${review.ai_response_draft}
                    </div>
                    <div class="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest ${review.status === 'auto_posted' ? 'text-wb-purple' : 'text-on-surface-variant'}">
                        <span class="w-1.5 h-1.5 rounded-full ${review.status === 'auto_posted' ? 'bg-wb-purple shadow-[0_0_5px_rgba(124,58,237,0.4)]' : 'bg-outline-variant'}"></span>
                        Статус: ${review.status === 'auto_posted' ? 'Опубликовано авто-ботом' : review.status === 'approved' ? 'Одобрено менеджером' : 'В очереди'}
                    </div>
                </section>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function renderSubscription() {
    // Subscription lives on seller level (state.settings), not per-shop
    const expiresAt = state.settings.subscription_expires_at;
    const diff = expiresAt ? new Date(expiresAt) - new Date() : 0;
    const daysLeft = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    const expiredDateStr = expiresAt ? new Date(expiresAt).toLocaleDateString() : '—';
    const hasPremium = state.settings.subscription_status === 'active' && daysLeft > 0;
    
    const pricingTiersHtml = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <!-- Tier 1 -->
            <div class="premium-card p-6 flex flex-col justify-between border-primary/20 bg-gradient-to-br from-primary/5 to-transparent relative overflow-hidden group">
                <div class="relative z-10">
                    <p class="text-primary text-[10px] font-black uppercase tracking-widest mb-2">Начинающий</p>
                    <h3 class="text-xl font-bold text-white mb-4">До 5 магазинов</h3>
                    <ul class="space-y-3 mb-8">
                        <li class="flex items-center gap-2 text-xs text-on-surface-variant">
                            <span class="material-symbols-outlined text-primary text-sm">check_circle</span>
                            Все функции ИИ
                        </li>
                        <li class="flex items-center gap-2 text-xs text-on-surface-variant">
                            <span class="material-symbols-outlined text-primary text-sm">check_circle</span>
                            Безлимитные ответы
                        </li>
                    </ul>
                </div>
                <div class="relative z-10">
                    <div class="flex items-baseline gap-1 mb-4">
                        <span class="text-3xl font-bold text-white">3 000</span>
                        <span class="text-xs text-on-surface-variant font-bold uppercase">₽ / мес</span>
                    </div>
                    <button onclick="handlePayment(3000)" class="primary-btn w-full py-3 text-[10px] uppercase tracking-widest">Выбрать</button>
                </div>
            </div>

            <!-- Tier 2 -->
            <div class="premium-card p-6 flex flex-col justify-between border-primary/20 bg-gradient-to-br from-primary/5 to-transparent relative overflow-hidden group">
                <div class="absolute top-0 right-0 bg-primary text-bg text-[8px] font-black uppercase px-3 py-1 rounded-bl-lg z-20">Популярный</div>
                <div class="relative z-10">
                    <p class="text-primary text-[10px] font-black uppercase tracking-widest mb-2">Агентство</p>
                    <h3 class="text-xl font-bold text-white mb-4">До 20 магазинов</h3>
                    <ul class="space-y-3 mb-8">
                        <li class="flex items-center gap-2 text-xs text-on-surface-variant">
                            <span class="material-symbols-outlined text-primary text-sm">check_circle</span>
                            Управление ToV брендов
                        </li>
                        <li class="flex items-center gap-2 text-xs text-on-surface-variant">
                            <span class="material-symbols-outlined text-primary text-sm">check_circle</span>
                            Все функции ИИ
                        </li>
                    </ul>
                </div>
                <div class="relative z-10">
                    <div class="flex items-baseline gap-1 mb-4">
                        <span class="text-3xl font-bold text-white">5 000</span>
                        <span class="text-xs text-on-surface-variant font-bold uppercase">₽ / мес</span>
                    </div>
                    <button onclick="handlePayment(5000)" class="primary-btn w-full py-3 text-[10px] uppercase tracking-widest">Выбрать</button>
                </div>
            </div>

            <!-- Tier 3 -->
            <div class="premium-card p-6 flex flex-col justify-between border-primary/20 bg-gradient-to-br from-primary/5 to-transparent relative overflow-hidden group">
                <div class="relative z-10">
                    <p class="text-primary text-[10px] font-black uppercase tracking-widest mb-2">Корпорация</p>
                    <h3 class="text-xl font-bold text-white mb-4">От 20 магазинов</h3>
                    <ul class="space-y-3 mb-8">
                        <li class="flex items-center gap-2 text-xs text-on-surface-variant">
                            <span class="material-symbols-outlined text-primary text-sm">check_circle</span>
                            Персональный менеджер
                        </li>
                        <li class="flex items-center gap-2 text-xs text-on-surface-variant">
                            <span class="material-symbols-outlined text-primary text-sm">check_circle</span>
                            Любое кол-во магазинов
                        </li>
                    </ul>
                </div>
                <div class="relative z-10">
                    <div class="flex items-baseline gap-1 mb-4">
                        <span class="text-3xl font-bold text-white">10 000</span>
                        <span class="text-xs text-on-surface-variant font-bold uppercase">₽ / мес</span>
                    </div>
                    <button onclick="handlePayment(10000)" class="primary-btn w-full py-3 text-[10px] uppercase tracking-widest">Выбрать</button>
                </div>
            </div>
        </div>
    `;

    return `
        <div class="max-w-5xl mx-auto space-y-8 animate-in pb-20 px-4 sm:px-0">
            <header class="text-center sm:text-left flex justify-between items-center">
                <div>
                    <p class="text-primary text-[10px] font-black uppercase tracking-[0.3em] mb-2">Финансы и показатели</p>
                    <h2 class="font-headline text-2xl sm:text-3xl font-bold text-text-main tracking-tight">Обзор аккаунта</h2>
                </div>
                <button onclick="handlePayment(1)" class="bg-primary/20 text-primary border border-primary/30 px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest hover:bg-primary/30 transition-all">
                    Тест 1₽
                </button>
            </header>

            ${!hasPremium ? pricingTiersHtml : ''}

            <!-- User Profile Card -->
            <section class="premium-card p-5 sm:p-8 flex items-center justify-between gap-5">
                <div class="flex items-center gap-5 min-w-0">
                    <img src="${state.settings.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + state.sellerId}" alt="Avatar" class="w-16 h-16 rounded-full border border-outline-variant object-cover bg-surface/50">
                    <div class="space-y-1 min-w-0">
                        <h3 class="text-text-main font-bold text-lg truncate">${state.settings.display_name || 'Пользователь'}</h3>
                        <p class="text-xs text-on-surface-variant truncate">${state.settings.email || (state.settings.auth_provider === 'guest' ? 'Временный аккаунт' : 'Нет Email')}</p>
                    </div>
                </div>
                ${state.settings.auth_provider === 'guest' ? `
                    <div class="flex flex-col gap-2 shrink-0">
                        <span class="text-[9px] font-black uppercase tracking-[0.2em] text-primary text-right animate-pulse">Аккаунт не защищен</span>
                    </div>
                ` : `
                    <div class="px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full shrink-0">
                        <span class="text-[9px] font-black uppercase tracking-widest text-green-500">Защищен</span>
                    </div>
                `}
            </section>

            ${state.settings.auth_provider === 'guest' ? `
                <section class="premium-card p-6 border-primary/30 bg-primary/5 space-y-4">
                    <div class="flex items-center gap-3">
                        <span class="material-symbols-outlined text-primary">security</span>
                        <h3 class="text-text-main font-bold text-sm uppercase tracking-widest">Привяжите аккаунт</h3>
                    </div>
                    <p class="text-xs text-on-surface-variant leading-relaxed">
                        Чтобы не потерять настройки и историю ответов при смене браузера, привяжите постоянный аккаунт.
                    </p>
                    <div class="grid grid-cols-2 gap-3 mt-2">
                        <button onclick="handleGoogleLogin()" class="flex items-center justify-center gap-2 bg-white text-gray-900 py-3 rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-gray-100 transition-all shadow-sm">
                            <svg style="width: 16px; height: 16px;" viewBox="0 0 48 48">
                                <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path>
                                <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"></path>
                                <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"></path>
                                <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"></path>
                            </svg>
                            Google
                        </button>
                        <button onclick="handleVkLogin()" class="flex items-center justify-center gap-2 bg-[#0077FF] text-white py-3 rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-[#0066DD] transition-all shadow-sm">
                            <svg style="width: 18px; height: 18px;" viewBox="0 0 28 28" fill="none"><path d="M4.54 4.54C3 6.08 3 8.52 3 13.4v1.2c0 4.88 0 7.32 1.54 8.86C6.08 25 8.52 25 13.4 25h1.2c4.88 0 7.32 0 8.86-1.54C25 21.92 25 19.48 25 14.6v-1.2c0-4.88 0-7.32-1.54-8.86C21.92 3 19.48 3 14.6 3h-1.2C8.52 3 6.08 3 4.54 4.54z" fill="#0077FF"/><path d="M7.56 9.85h1.58c.25 0 .41.16.49.48.73 2.7 2.01 5.06 2.52 5.06.18 0 .26-.08.26-.54v-2.78c-.05-1-.58-1.08-.58-1.44 0-.18.15-.35.39-.35h2.49c.21 0 .29.11.29.46v3.74c0 .21.09.29.15.29.18 0 .33-.08.67-.43a14.22 14.22 0 001.94-3.31c.09-.21.24-.4.51-.4h1.58c.33 0 .41.17.33.46-.14.54-1.54 3.03-2.44 4.31-.14.21-.19.32 0 .57.14.18.59.57.89.91.56.63 1 1.16 1.11 1.53.12.37-.07.56-.44.56h-1.58c-.34 0-.5-.14-.75-.44-.61-.67-1.13-1.31-1.35-1.31-.13 0-.19.05-.19.31v1.01c0 .34-.11.43-.39.43-1.18 0-3.76-.07-5.63-2.72a19.7 19.7 0 01-2.47-5.17c-.09-.25 0-.42.33-.42z" fill="white"/></svg>
                            VK ID
                        </button>
                    </div>
                    
                    <div class="relative py-3">
                        <div class="absolute inset-0 flex items-center"><div class="w-full border-t border-outline-variant/20"></div></div>
                        <div class="relative flex justify-center text-[9px] uppercase tracking-[0.2em] font-black"><span class="bg-[#1A1C20] px-3 text-on-surface-variant/40">или по email</span></div>
                    </div>
                    
                    <div class="flex gap-2">
                        <input id="link-email" type="email" placeholder="email@example.com" class="flex-1 bg-[#1A1C20] border border-outline-variant/30 focus:border-primary outline-none px-4 py-3 rounded-xl text-sm transition-all text-white placeholder-gray-500">
                        <button id="link-email-btn" onclick="handleLinkMagic()" class="shrink-0 bg-[#2A2D32] text-white hover:bg-[#3A3D42] border border-outline-variant/20 px-6 py-3 rounded-xl text-[11px] font-bold uppercase tracking-widest transition-all shadow-sm">
                            Привязать
                        </button>
                    </div>
                </section>
            ` : ''}

            <div class="grid grid-cols-2 gap-3 sm:gap-4">
                <div class="premium-card p-5 sm:p-8">
                    <p class="text-[9px] font-black uppercase tracking-[0.3em] text-on-surface-variant mb-3">Сегодня</p>
                    <p class="text-3xl sm:text-4xl font-bold text-text-main tracking-tighter">${state.stats?.approvedToday || 0}</p>
                </div>
                <div class="premium-card p-5 sm:p-8">
                    <p class="text-[9px] font-black uppercase tracking-[0.3em] text-on-surface-variant mb-3">Всего ответов</p>
                    <p class="text-3xl sm:text-4xl font-bold text-text-main tracking-tighter">${state.stats?.approved || 0}</p>
                </div>
            </div>

            <section class="premium-card p-5 sm:p-8 flex items-center justify-between gap-4">
                <div class="space-y-1 min-w-0">
                    <h3 class="text-text-main font-bold text-xs sm:text-sm uppercase tracking-widest">Тарифный план</h3>
                    <p class="text-xs text-on-surface-variant">Истекает: <span class="text-text-main font-mono">${expiredDateStr}</span></p>
                </div>
                <div class="text-right flex-shrink-0">
                    <p class="text-[9px] uppercase font-black text-on-surface-variant mb-1">Осталось</p>
                    <p class="text-2xl sm:text-3xl font-bold ${daysLeft > 3 ? 'text-primary' : 'text-red-400'}">${daysLeft} дн.</p>
                </div>
            </section>

            ${hasPremium ? `
                <section class="premium-card p-5 sm:p-8 flex items-center justify-between gap-4 border-primary/50 bg-primary/5">
                    <div class="space-y-1 min-w-0">
                        <h3 class="text-text-main font-bold text-xs sm:text-sm uppercase tracking-widest">Активный тариф: ${{ starter: 'Начинающий', agency: 'Агентство', corporation: 'Корпорация' }[state.settings.subscription_plan] || 'Стандарт'}</h3>
                        <p class="text-xs text-on-surface-variant">Доступно магазинов: <span class="text-primary font-bold">${state.settings.max_shops || 1}</span> | Используется: <span class="text-text-main font-bold">${state.shops.length}</span></p>
                    </div>
                </section>
            ` : ''}
        </div>
    `;
}

// Actions
async function handleSaveSettings() {
    if (!state.activeShopId) return;
    
    const btn = document.getElementById('save-settings-btn');
    const originalContent = btn ? btn.innerHTML : 'Сохранить';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="flex items-center justify-center gap-2"><span class="animate-spin material-symbols-outlined text-sm">sync</span> Сохранение...</span>';
    }

    try {
        const activeShop = state.shops.find(s => s.id === state.activeShopId);
        const payload = {
            name: document.getElementById('shop-name-input').value,
            wb_token: document.getElementById('wb-token-input').value,
            custom_instructions: document.getElementById('ai-instructions-input').value,
            // Preserve hidden fields from current state
            brand_name: activeShop?.brand_name || '',
            stop_words: activeShop?.stop_words || '',
            is_auto_reply_enabled: true
        };

        const res = await apiFetch(`/api/shops/${state.activeShopId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            showToast('Настройки сохранены');
            state.editingShopId = null;
            await refreshData();
        } else {
            const data = await res.json();
            showToast(data.error || 'Ошибка сохранения', true);
        }
    } catch (e) {
        showToast('Ошибка сети', true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
    }
}

function showAddShopModal() {
    const modal = document.createElement('div');
    modal.id = 'add-shop-modal';
    modal.className = 'fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in';
    modal.innerHTML = `
        <div class="bg-[#1E1E1E] border border-border w-full max-w-md rounded-2xl p-8 shadow-2xl">
            <h3 class="text-xl font-bold mb-6">Добавить новый магазин</h3>
            <div class="space-y-4 mb-8">
                <div>
                    <label class="text-[10px] font-bold uppercase tracking-widest text-dim mb-2 block">Название магазина</label>
                    <input id="new-shop-name" type="text" class="w-full bg-[#111111] border border-border p-4 rounded-xl outline-none focus:border-primary transition-all" placeholder="Например: Модный стиль">
                </div>
            </div>
            <div class="flex gap-3">
                <button onclick="document.getElementById('add-shop-modal').remove()" class="flex-1 py-4 text-xs font-bold uppercase tracking-widest hover:bg-white/5 rounded-xl transition-all">Отмена</button>
                <button onclick="handleCreateShop(this)" class="flex-1 primary-btn py-4 text-xs font-bold uppercase tracking-widest">Создать</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

async function handleCreateShop(btn) {
    const name = document.getElementById('new-shop-name').value;
    if (!name) return showToast('Введите название магазина', true);

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="flex items-center justify-center gap-2"><span class="animate-spin material-symbols-outlined text-sm">sync</span> Создание...</span>';
    }

    try {
        const res = await apiFetch('/api/shops', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });

        if (res.ok) {
            const newShop = await res.json();
            document.getElementById('add-shop-modal').remove();
            showToast('Магазин успешно создан');
            await refreshData();
            editShop(newShop.id);
        } else {
            const errorData = await res.json();
            showToast(errorData.error || 'Ошибка при создании магазина', true);
        }
    } catch (e) {
        showToast('Ошибка сети', true);
    } finally {
        if (btn && !document.getElementById('add-shop-modal')) {
            // Modal already removed, do nothing
        } else if (btn) {
            btn.disabled = false;
            btn.innerHTML = 'Создать';
        }
    }
}

async function handleDeleteShop(id) {
    if (!confirm('Вы уверены, что хотите удалить этот магазин? Все настройки и логи будут удалены безвозвратно.')) return;

    const btn = event?.currentTarget;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="animate-spin material-symbols-outlined text-sm">sync</span>';
    }

    try {
        const res = await apiFetch(`/api/shops/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Магазин удален');
            state.activeShopId = null;
            state.editingShopId = null;
            await refreshData();
            showView('settings');
        } else {
            const err = await res.json();
            showToast(err.error || 'Ошибка при удалении', true);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<span class="material-symbols-outlined">delete</span>';
            }
        }
    } catch (e) {
        showToast('Ошибка сети', true);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span class="material-symbols-outlined">delete</span>';
        }
    }
}

function setTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.classList.add('dark');
        localStorage.setItem('theme', 'dark');
    } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('theme', 'light');
    }
    showView('interface'); 
    showToast(`Тема: ${theme === 'dark' ? 'Темная' : 'Светлая'}`);
}

function renderInterface() {
    const isDark = document.documentElement.classList.contains('dark');
    
    return `
        <div class="max-w-2xl mx-auto space-y-8 animate-in pb-20">
            <header>
                <p class="text-primary text-[10px] font-black uppercase tracking-[0.3em] mb-2">Система</p>
                <h2 class="font-headline text-2xl sm:text-3xl font-bold text-text-main tracking-tight">Параметры интерфейса</h2>
            </header>

            <div class="space-y-5">
                <section class="premium-card p-5 sm:p-8 space-y-6">
                    <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div>
                            <h4 class="text-text-main font-bold text-xs sm:text-sm uppercase tracking-widest">Цветовая тема</h4>
                            <p class="text-xs text-on-surface-variant">Выберите оформление приложения</p>
                        </div>
                        <div class="flex border border-outline-variant p-1 rounded-lg bg-bg-main">
                            <button onclick="setTheme('dark')" class="px-4 py-2 ${isDark ? 'bg-primary text-bg-main shadow-lg' : 'text-on-surface-variant'} rounded-md text-[10px] font-black uppercase tracking-widest transition-all">Темная</button>
                            <button onclick="setTheme('light')" class="px-4 py-2 ${!isDark ? 'bg-primary text-white shadow-lg' : 'text-on-surface-variant'} rounded-md text-[10px] font-black uppercase tracking-widest transition-all">Светлая</button>
                        </div>
                    </div>

                </section>

                <section class="premium-card overflow-hidden divide-y divide-outline-variant/30">
                    <div class="p-5 sm:p-6 flex items-center justify-between gap-4">
                        <div class="flex items-center gap-4">
                            <div class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
                                <span class="material-symbols-outlined text-primary text-xl">support_agent</span>
                            </div>
                            <div>
                                <h4 class="text-text-main font-bold text-xs sm:text-sm uppercase tracking-widest">Поддержка</h4>
                                <p class="text-[10px] sm:text-[11px] text-on-surface-variant mt-0.5 leading-tight">alexandertsyhanov@gmail.com</p>
                            </div>
                        </div>
                        <button onclick="handleContact(event, 'support')" class="shrink-0 bg-bg-main border border-outline-variant hover:border-primary text-text-main px-5 h-10 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 whitespace-nowrap shadow-sm flex items-center justify-center">
                            Написать
                        </button>
                    </div>

                    <div class="p-5 sm:p-6 flex items-center justify-between gap-4">
                        <div class="flex items-center gap-4">
                            <div class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
                                <span class="material-symbols-outlined text-primary text-xl">rate_review</span>
                            </div>
                            <div>
                                <h4 class="text-text-main font-bold text-xs sm:text-sm uppercase tracking-widest">Отзыв</h4>
                                <p class="text-[10px] sm:text-[11px] text-on-surface-variant mt-0.5 leading-tight">alexandertsyhanov@gmail.com</p>
                            </div>
                        </div>
                        <button onclick="handleContact(event, 'feedback')" class="shrink-0 bg-primary text-white dark:text-black px-6 h-10 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all hover:brightness-110 active:scale-95 shadow-lg shadow-primary/20 whitespace-nowrap flex items-center justify-center">
                            Оценить
                        </button>
                    </div>
                </section>



                <section class="premium-card p-5 sm:p-8 border-primary/20 bg-primary/5">
                    <div class="flex items-start gap-4">
                        <span class="material-symbols-outlined text-primary">info</span>
                        <div class="space-y-1">
                            <h4 class="text-text-main font-bold text-xs sm:text-sm uppercase tracking-widest">Версия ПО</h4>
                            <p class="text-xs text-on-surface-variant">WBREPLY AI v2.4.0 (Стабильная сборка). Система готова к работе.</p>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    `;
}

async function handleSync(btnEl) {
    if (!state.settings.wb_token) return showToast('Сначала добавьте API токен', true);
    
    const btn = btnEl || event?.currentTarget;
    const originalContent = btn ? btn.innerHTML : null;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = 'Синхронизация...';
    }

    showToast('Синхронизация...');
    try {
        const res = await apiFetch('/api/sync', { method: 'POST' });
        if (res.ok) {
            showToast('Готово');
            await refreshData();
            showView('reviews');
        } else { showToast('Ошибка синхронизации', true); }
    } catch (e) { showToast('Ошибка сети', true); }
    finally {
        if (btn && originalContent) {
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
    }
}



async function handlePayment(amount) {
    if (typeof gtag === 'function') gtag('event', 'click_payment', { value: amount });
    
    // Block guests on frontend too
    if (state.settings.auth_provider === 'guest') {
        showToast('Пожалуйста, сначала привяжите аккаунт (Google, VK или Email) для оплаты', true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }

    // Find the clicked button and disable it
    const allBtns = document.querySelectorAll('[onclick*="handlePayment"]');
    allBtns.forEach(b => { b.disabled = true; b.dataset.orig = b.innerHTML; b.innerHTML = 'Обработка...'; });

    showToast('Перенаправление на оплату...');
    try {
        const res = await apiFetch('/api/payments/create', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount })
        });
        const data = await res.json();
        
        if (res.status === 403) {
            showToast(data.error || 'Привяжите аккаунт перед оплатой', true);
            allBtns.forEach(b => { b.disabled = false; b.innerHTML = b.dataset.orig; });
            setTimeout(() => showView('subscription'), 1500);
            return;
        }
        
        if (data.url) {
            window.location.href = data.url;
        } else { 
            showToast(data.error || 'Ошибка платежа', true); 
            allBtns.forEach(b => { b.disabled = false; b.innerHTML = b.dataset.orig; });
        }
    } catch (e) { 
        showToast('Ошибка сети', true); 
        allBtns.forEach(b => { b.disabled = false; b.innerHTML = b.dataset.orig; });
    }
}

function handleContact(e, type = 'support') {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    const email = 'alexandertsyhanov@gmail.com';
    
    const existing = document.getElementById('contact-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'contact-modal';
    modal.className = 'fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in';
    modal.onclick = () => modal.remove();

    const title = type === 'support' ? 'Связаться с нами' : 'Оставить отзыв';
    const description = type === 'support' 
        ? 'Пожалуйста, напишите ваш вопрос на электронную почту:' 
        : 'Мы будем рады вашим предложениям и отзывам. Пишите на почту:';

    modal.innerHTML = `
        <div class="premium-card w-full max-w-sm p-8 space-y-6 text-center relative" onclick="event.stopPropagation()">
            <div class="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto border border-primary/20 mb-2">
                <span class="material-symbols-outlined text-primary text-3xl">${type === 'support' ? 'mail' : 'rate_review'}</span>
            </div>
            <div class="space-y-2">
                <h3 class="text-white font-bold text-lg uppercase tracking-widest">${title}</h3>
                <p class="text-xs text-on-surface-variant leading-relaxed">${description}</p>
            </div>
            
            <div class="bg-bg-main border border-outline-variant rounded-xl p-4 flex flex-col gap-3 group">
                <p class="text-sm font-black text-primary break-all select-all">${email}</p>
                <button onclick="navigator.clipboard.writeText('${email}'); showToast('Почта скопирована'); this.innerHTML='Скопировано!'" class="w-full py-2 bg-primary/10 text-primary rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-primary/20 transition-all">
                    Скопировать адрес
                </button>
            </div>

            <button onclick="document.getElementById('contact-modal').remove()" class="text-[10px] font-black uppercase tracking-widest text-on-surface-variant hover:text-white transition-all pt-2">
                Закрыть
            </button>
        </div>
    `;

    document.body.appendChild(modal);
}

// Support Modal Logic
function openSupportModal(type) {
    if (typeof gtag === 'function') gtag('event', 'click_' + type);
    const existing = document.getElementById('support-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'support-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center sm:p-4 bg-black/80 backdrop-blur-sm animate-in';
    modal.onclick = () => modal.remove();

    if (type === 'support') {
        const supportTickets = (state.tickets || [])
            .filter(t => t.type === 'support')
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

        let messagesHtml = '';
        if (supportTickets.length === 0) {
            messagesHtml = `
                <div class="flex flex-col items-center justify-center h-full text-center opacity-50 space-y-2 pb-10">
                    <span class="material-symbols-outlined text-5xl mb-2">support_agent</span>
                    <p class="text-xs font-bold uppercase tracking-widest">alexandertsyhanov@gmail.com</p>
                    <p class="text-[10px]">Напишите нам в чат или на почту</p>
                </div>
            `;
        } else {
            const events = [];
            supportTickets.forEach(t => {
                events.push({
                    isClient: true,
                    text: t.message,
                    time: new Date(t.created_at)
                });
                if (t.admin_reply) {
                    events.push({
                        isClient: false,
                        text: t.admin_reply,
                        time: t.updated_at ? new Date(t.updated_at) : new Date(t.created_at)
                    });
                }
            });
            events.sort((a, b) => a.time - b.time);

            events.forEach(e => {
                const timeStr = e.time.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                if (e.isClient) {
                    messagesHtml += `
                        <div class="flex justify-end mb-4 animate-in">
                            <div class="bg-primary text-white px-4 py-3 rounded-2xl rounded-tr-none max-w-[80%] min-w-[70px] text-sm shadow-lg shadow-primary/10 relative" style="overflow-wrap: anywhere; word-break: break-word;">
                                <div class="leading-relaxed">${e.text}</div>
                                <div class="text-[9px] text-white/80 text-right mt-1.5 font-bold tabular-nums">${timeStr}</div>
                            </div>
                        </div>
                    `;
                } else {
                    messagesHtml += `
                        <div class="flex justify-start mb-4 animate-in">
                            <div class="bg-surface border border-outline-variant/50 text-text-main px-4 py-3 rounded-2xl rounded-tl-none max-w-[85%] min-w-[70px] text-sm shadow-md relative leading-relaxed" style="overflow-wrap: anywhere; word-break: break-word;">
                                <div class="text-[13px] sm:text-sm text-text-main">${e.text}</div>
                                <div class="text-[9px] text-on-surface-variant/70 text-right mt-1.5 font-bold tabular-nums">${timeStr}</div>
                            </div>
                        </div>
                    `;
                }
            });
        }

        modal.innerHTML = `
            <div class="bg-bg-main w-full sm:rounded-2xl flex flex-col relative overflow-hidden shadow-2xl custom-h-90vh" style="max-width: 480px;" onclick="event.stopPropagation()">
                <!-- Header -->
                <div class="flex justify-between items-center border-b border-outline-variant/30 p-4 shrink-0 bg-surface">
                    <div class="flex items-center gap-3">
                        <span class="material-symbols-outlined text-primary text-3xl">support_agent</span>
                        <div>
                            <h3 class="font-headline text-sm font-bold tracking-tight text-text-main uppercase tracking-widest">Чат с поддержкой</h3>
                            <p class="text-[9px] text-on-surface-variant font-bold uppercase tracking-widest flex items-center gap-1 mt-0.5">
                                alexandertsyhanov@gmail.com
                            </p>
                        </div>
                    </div>
                    <button onclick="document.getElementById('support-modal').remove()" class="text-on-surface-variant hover:text-text-main transition-colors p-2 rounded-lg bg-bg-main border border-outline-variant/30 flex items-center justify-center">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
                
                <!-- Chat Area -->
                <div id="chat-messages-area" class="custom-flex-scroll p-4 bg-bg-main/50 relative">
                    ${messagesHtml}
                </div>
                
                <!-- Input Area -->
                <div class="p-3 sm:p-4 border-t border-outline-variant/30 shrink-0 bg-surface">
                    <div class="flex gap-2">
                        <input id="support-message" type="text" class="flex-1 bg-bg-main border border-outline-variant outline-none px-4 py-3 text-text-main text-sm rounded-xl focus:border-primary transition-colors" placeholder="Сообщение..." onkeypress="if(event.key === 'Enter') submitSupport('support')">
                        <button id="support-send-btn" onclick="submitSupport('support')" class="bg-primary text-white w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-lg shadow-primary/20">
                            <span class="material-symbols-outlined">send</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    } else {
        const title = 'Оставить отзыв';
        const placeholder = 'Что вам нравится в сервисе? Чего не хватает?';
        modal.innerHTML = `
            <div class="premium-card w-full p-6 sm:p-8 space-y-5 relative mx-4 sm:mx-auto" style="max-width: 480px;" onclick="event.stopPropagation()">
                <div class="flex justify-between items-center border-b border-outline-variant/30 pb-4 mb-2">
                    <h3 class="font-headline text-lg font-bold tracking-tight text-text-main uppercase tracking-widest">${title}</h3>
                    <button onclick="document.getElementById('support-modal').remove()" class="text-on-surface-variant hover:text-text-main transition-colors -mr-2 p-2">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
                <textarea id="support-message" class="w-full h-36 bg-bg-main border border-outline-variant outline-none p-4 text-text-main text-sm rounded-xl focus:border-primary resize-none transition-colors" placeholder="${placeholder}"></textarea>
                <div class="pt-2">
                    <button id="support-send-btn" onclick="submitSupport('${type}')" class="primary-btn w-full py-4 text-[11px] font-black uppercase tracking-[0.2em] rounded-xl shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all">Отправить</button>
                </div>
            </div>
        `;
    }

    document.body.appendChild(modal);
    
    if (type === 'support') {
        const chatArea = document.getElementById('chat-messages-area');
        if (chatArea) {
            chatArea.scrollTop = chatArea.scrollHeight;
        }
        setTimeout(() => {
            const input = document.getElementById('support-message');
            if (input) input.focus();
            if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
        }, 100);
    }
}

function setRegistryView(view) {
    state.registryView = view;
    showView('settings');
}

async function toggleShopAutoReply(id, enabled) {
    try {
        const res = await apiFetch(`/api/shops/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_auto_reply_enabled: enabled })
        });
        
        if (res.ok) {
            const shop = state.shops.find(s => s.id === id);
            if (shop) shop.is_auto_reply_enabled = enabled;
            showToast(`${enabled ? 'Бот включен' : 'Бот на паузе'}`);
            showView('settings');
        }
    } catch (e) {
        showToast('Ошибка при переключении', true);
    }
}

function toggleRatingFilter(rating) {
    if (state.reviewsRatingFilter === rating) {
        state.reviewsRatingFilter = null;
    } else {
        state.reviewsRatingFilter = rating;
    }
    renderReviewsList();
}

async function setReviewsFilter(id) {
    state.reviewsFilterShopId = id || null;
    await refreshData();
    showView('reviews');
}

// Registry Helpers
function handleShopSearch(val) {
    state.shopSearch = val;
    showView('settings');
}

function toggleShopSelection(id) {
    if (state.selectedShops.includes(id)) {
        state.selectedShops = state.selectedShops.filter(sid => sid !== id);
    } else {
        state.selectedShops.push(id);
    }
    showView('settings');
}

function toggleAllShops(checked) {
    if (checked) {
        state.selectedShops = state.shops.map(s => s.id);
    } else {
        state.selectedShops = [];
    }
    showView('settings');
}

function editShop(id) {
    state.editingShopId = id;
    state.activeShopId = id;
    showView('settings');
}

function closeShopEdit() {
    state.editingShopId = null;
    showView('settings');
}

async function bulkPause(enabled) {
    if (state.selectedShops.length === 0) return;
    
    const count = state.selectedShops.length;
    if (!confirm(`Вы уверены, что хотите ${enabled ? 'включить' : 'поставить на паузу'} ${count} магазинов?`)) return;

    showToast(`Обновление ${count} магазинов...`);
    
    try {
        await Promise.all(state.selectedShops.map(id => 
            apiFetch(`/api/shops/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_auto_reply_enabled: enabled })
            })
        ));
        
        await refreshData();
        state.selectedShops = [];
        showToast('Готово!');
    } catch (e) {
        showToast('Ошибка при массовом обновлении', true);
    }
}

async function bulkPrompt() {
    const prompt = prompt('Введите новый промпт (инструкции ИИ) для всех выбранных магазинов:');
    if (!prompt) return;

    const count = state.selectedShops.length;
    showToast(`Обновление промптов для ${count} магазинов...`);
    
    try {
        await Promise.all(state.selectedShops.map(id => 
            apiFetch(`/api/shops/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ custom_instructions: prompt })
            })
        ));
        
        await refreshData();
        state.selectedShops = [];
        showToast('Промпты обновлены!');
    } catch (e) {
        showToast('Ошибка при обновлении промптов', true);
    }
}

async function submitSupport(type) {
    const inputEl = document.getElementById('support-message');
    const btn = document.getElementById('support-send-btn');
    const msg = inputEl.value.trim();
    if (!msg) return showToast('Введите сообщение', true);

    inputEl.disabled = true;
    const originalContent = btn ? btn.innerHTML : null;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="animate-spin material-symbols-outlined text-sm">sync</span>';
        if (type !== 'support') btn.innerHTML = 'Отправка...';
    }

    try {
        const res = await apiFetch('/api/support', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, message: msg })
        });
        if (res.ok) {
            await refreshData();
            if (type === 'support') {
                openSupportModal('support');
            } else {
                showToast('Сообщение отправлено!');
                document.getElementById('support-modal').remove();
            }
            if (state.currentView === 'admin') showView('admin');
        } else {
            showToast('Ошибка отправки', true);
            inputEl.disabled = false;
            if (btn && originalContent) {
                btn.disabled = false;
                btn.innerHTML = originalContent;
            }
        }
    } catch (e) { 
        showToast('Ошибка сети', true); 
        inputEl.disabled = false;
        if (btn && originalContent) {
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
    }
}

async function adminReply(ticketId) {
    const replyText = prompt('Ответ пользователю:');
    if (!replyText) return;

    try {
        const res = await apiFetch(`/api/admin/support/${ticketId}/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reply: replyText })
        });
        if (res.ok) {
            showToast('Ответ сохранен');
            await refreshData();
            showView('admin');
        }
    } catch (e) { showToast('Ошибка сети', true); }
}

function renderAdmin() {
    const s = state.adminStats || {};
    let tkts = state.adminTickets || [];
    let users = state.adminUsers || [];
    
    // Sort users: those with open tickets first, then by last_active_at
    const usersWithOpenTickets = new Set(tkts.filter(t => t.status === 'open' && t.type === 'support').map(t => t.seller_id));
    users.sort((a, b) => {
        const aOpen = usersWithOpenTickets.has(a.id);
        const bOpen = usersWithOpenTickets.has(b.id);
        if (aOpen && !bOpen) return -1;
        if (!aOpen && bOpen) return 1;
        return new Date(b.last_active_at) - new Date(a.last_active_at);
    });

    const tokenCount = (s.totalSellers || 0) - (s.withoutToken || 0);

    return `
        <div class="max-w-5xl mx-auto space-y-8 sm:space-y-10 animate-in pb-20">
            <header>
                <p class="text-primary text-[10px] sm:text-xs font-black uppercase tracking-[0.3em] mb-2">Админ-панель</p>
                <h2 class="font-headline text-2xl sm:text-3xl font-bold text-text-main tracking-tight">Управление платформой</h2>
            </header>

            <!-- Global Stats -->
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
                <div class="premium-card p-5">
                    <p class="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-2">Всего юзеров</p>
                    <p class="text-2xl sm:text-3xl font-bold text-text-main">${s.totalSellers || 0}</p>
                </div>
                <div class="premium-card p-5">
                    <p class="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-2">Сделали тест</p>
                    <p class="text-2xl sm:text-3xl font-bold text-primary">${s.totalTests || 0}</p>
                </div>
                <div class="premium-card p-5">
                    <p class="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-2">С подпиской</p>
                    <p class="text-2xl sm:text-3xl font-bold text-green-500">${s.totalSubscribed || 0}</p>
                </div>
                <div class="premium-card p-5">
                    <p class="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-2">Ответов ИИ</p>
                    <p class="text-2xl sm:text-3xl font-bold text-text-main">${s.totalApproved || 0}</p>
                </div>
            </div>

            <!-- Users List -->
            <section class="premium-card overflow-hidden">
                <div class="p-5 sm:p-6 border-b border-outline-variant bg-surface">
                    <h3 class="font-bold text-sm uppercase tracking-widest">Список пользователей</h3>
                </div>
                <div class="divide-y divide-outline-variant/50">
                    ${users.length === 0 ? '<div class="p-8 text-center text-on-surface-variant text-sm">Нет пользователей</div>' : 
                    users.map(u => {
                        const hasOpenTicket = usersWithOpenTickets.has(u.id);
                        const hasSub = u.subscription_status !== 'free' && u.subscription_status !== 'trial';
                        
                        return `
                        <div class="p-4 sm:p-6 hover:bg-surface/30 transition-colors ${hasOpenTicket ? 'bg-primary/5 border-l-4 border-l-primary' : ''}">
                            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                <div>
                                    <div class="flex items-center gap-3 mb-1">
                                        <h4 class="font-bold text-sm text-text-main">${u.display_name || 'Аноним'}</h4>
                                        ${hasOpenTicket ? '<span class="bg-primary text-white text-[8px] px-2 py-0.5 rounded uppercase tracking-widest font-bold animate-pulse">Ждет ответа</span>' : ''}
                                    </div>
                                    <p class="text-[11px] text-on-surface-variant">${u.email || u.id}</p>
                                    
                                    <div class="flex flex-wrap items-center gap-2 mt-3">
                                        <span class="text-[9px] px-2 py-1 rounded-md border ${hasSub ? 'border-green-500/30 text-green-500 bg-green-500/5' : 'border-outline-variant text-on-surface-variant'} font-black uppercase tracking-widest">
                                            ${hasSub ? 'Подписка' : 'Free/Trial'}
                                        </span>
                                        <span class="text-[9px] px-2 py-1 rounded-md border border-outline-variant text-on-surface-variant font-black uppercase tracking-widest">
                                            ${u.auth_provider || 'unknown'}
                                        </span>
                                    </div>
                                </div>
                                
                                <div class="flex items-center gap-2 w-full sm:w-auto">
                                    <button onclick="openAdminChat('${u.id}')" class="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-bg-main border border-primary text-primary px-4 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors hover:bg-primary/10">
                                        <span class="material-symbols-outlined text-sm">chat</span> Чат
                                    </button>
                                    <button onclick="openAdminReviews('${u.id}')" class="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-surface border border-outline-variant text-text-main px-4 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors hover:border-text-main">
                                        <span class="material-symbols-outlined text-sm">visibility</span> Отзывы
                                    </button>
                                </div>
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>
            </section>
        </div>
    `;
}

function openAdminChat(userId) {
    const userTickets = (state.adminTickets || [])
        .filter(t => t.seller_id === userId && t.type === 'support')
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        
    const user = state.adminUsers.find(u => u.id === userId);

    const modal = document.createElement('div');
    modal.id = 'admin-chat-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center sm:p-4 bg-black/80 backdrop-blur-sm animate-in';
    modal.onclick = () => modal.remove();

    let messagesHtml = '';
    let lastOpenTicketId = null;

    if (userTickets.length === 0) {
        messagesHtml = '<div class="text-center opacity-50 mt-10 text-xs uppercase tracking-widest">Нет сообщений</div>';
    } else {
        const events = [];
        userTickets.forEach(t => {
            events.push({
                isAdmin: false,
                text: t.message || '<i>Пустое сообщение</i>',
                time: new Date(t.created_at)
            });
            if (t.admin_reply) {
                events.push({
                    isAdmin: true,
                    text: t.admin_reply,
                    time: t.updated_at ? new Date(t.updated_at) : new Date(t.created_at)
                });
            }
        });
        
        events.sort((a, b) => a.time - b.time);

        events.forEach(e => {
            const timeStr = e.time.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            if (!e.isAdmin) {
                messagesHtml += `
                    <div class="flex justify-start mb-4">
                        <div class="bg-surface border border-outline-variant/50 text-text-main px-4 py-3 rounded-2xl rounded-tl-none max-w-[85%] min-w-[70px] text-sm shadow-md relative leading-relaxed" style="overflow-wrap: anywhere; word-break: break-word;">
                            <div class="text-[13px] sm:text-sm text-text-main">${e.text}</div>
                            <div class="text-[9px] text-on-surface-variant/70 text-right mt-1.5 font-bold tabular-nums">${timeStr}</div>
                        </div>
                    </div>
                `;
            } else {
                messagesHtml += `
                    <div class="flex justify-end mb-4">
                        <div class="bg-primary text-white px-4 py-3 rounded-2xl rounded-tr-none max-w-[80%] min-w-[70px] text-sm shadow-lg shadow-primary/10 relative" style="overflow-wrap: anywhere; word-break: break-word;">
                            <div class="leading-relaxed">${e.text}</div>
                            <div class="text-[9px] text-white/80 text-right mt-1.5 font-bold tabular-nums">${timeStr}</div>
                        </div>
                    </div>
                `;
            }
        });
    }

    let lastTicketId = userTickets.length > 0 ? userTickets[userTickets.length - 1].id : null;
    let inputHtml = '';
    if (lastTicketId) {
        inputHtml = `
            <div class="border-t border-outline-variant/30 p-4 bg-surface shrink-0">
                <div class="flex gap-2">
                    <input id="reply-${lastTicketId}" type="text" class="flex-1 bg-bg-main border border-outline-variant/50 rounded-xl px-4 py-3 text-sm text-text-main outline-none focus:border-primary shadow-inner" placeholder="Сообщение..." onkeypress="if(event.key === 'Enter') submitAdminReply('${lastTicketId}')" />
                    <button id="reply-btn-${lastTicketId}" onclick="submitAdminReply('${lastTicketId}')" class="bg-primary text-white px-6 py-3 rounded-xl font-bold uppercase tracking-widest shadow-md hover:bg-primary/90 active:scale-95 transition-all flex items-center justify-center">
                        <span class="material-symbols-outlined text-xl">send</span>
                    </button>
                </div>
            </div>
        `;
    } else {
        inputHtml = `
            <div class="border-t border-outline-variant/30 p-4 bg-surface shrink-0">
                <div class="flex gap-2">
                    <input disabled type="text" class="flex-1 bg-bg-main border border-outline-variant/50 rounded-xl px-4 py-3 text-sm text-text-main opacity-50 cursor-not-allowed" placeholder="Нет обращений в поддержку..." />
                    <button disabled class="bg-outline-variant text-white px-6 py-3 rounded-xl shadow-md opacity-50 cursor-not-allowed flex items-center justify-center">
                        <span class="material-symbols-outlined text-xl">send</span>
                    </button>
                </div>
            </div>
        `;
    }

    modal.innerHTML = `
        <div class="bg-bg-main w-full sm:rounded-2xl flex flex-col relative overflow-hidden shadow-2xl custom-h-90vh" style="max-width: 600px;" onclick="event.stopPropagation()">
            <div class="flex justify-between items-center border-b border-outline-variant/30 p-4 shrink-0 bg-surface">
                <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-primary text-3xl">admin_panel_settings</span>
                    <div>
                        <h3 class="font-headline text-sm font-bold tracking-tight text-text-main uppercase tracking-widest">Чат с юзером</h3>
                        <p class="text-[9px] text-on-surface-variant mt-0.5">${user?.display_name || user?.email || userId}</p>
                    </div>
                </div>
                <button onclick="document.getElementById('admin-chat-modal').remove()" class="text-on-surface-variant hover:text-text-main transition-colors p-2 rounded-lg bg-bg-main border border-outline-variant/30 flex items-center justify-center">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            <div id="admin-chat-messages" class="custom-flex-scroll p-4 sm:p-6 bg-bg-main/50 relative">
                ${messagesHtml}
            </div>
            ${inputHtml}
        </div>
    `;
    document.body.appendChild(modal);
    
    // Auto-scroll to bottom with small delay to ensure content is rendered
    setTimeout(() => {
        const messagesArea = document.getElementById('admin-chat-messages');
        if (messagesArea) {
            messagesArea.scrollTo({
                top: messagesArea.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, 100);
}

async function submitAdminReply(ticketId) {
    const input = document.getElementById('reply-' + ticketId);
    const btn = document.getElementById('reply-btn-' + ticketId);
    if (!input || !input.value.trim()) return;
    
    const reply = input.value.trim();
    input.disabled = true;
    const originalContent = btn ? btn.innerHTML : null;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="animate-spin material-symbols-outlined text-sm text-white">sync</span>';
    }
    
    try {
        const res = await apiFetch(`/api/admin/support/${ticketId}/reply`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ reply })
        });
        
        if (res.ok) {
            showToast('Ответ отправлен');
            await refreshData();
            document.getElementById('admin-chat-modal').remove();
            
            // Re-open chat for the same user if we can figure out who they are
            const ticket = state.adminTickets.find(t => t.id === ticketId);
            if (ticket) openAdminChat(ticket.seller_id);
        } else {
            showToast('Ошибка при отправке', true);
            input.disabled = false;
            if (btn && originalContent) {
                btn.disabled = false;
                btn.innerHTML = originalContent;
            }
        }
    } catch (e) {
        showToast('Ошибка сети', true);
        input.disabled = false;
        if (btn && originalContent) {
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
    }
}

async function openAdminReviews(userId) {
    const user = state.adminUsers.find(u => u.id === userId);
    try {
        const res = await apiFetch(`/api/admin/users/${userId}/reviews`);
        if (!res.ok) throw new Error('Network response was not ok');
        const reviews = await res.json();

        const modal = document.createElement('div');
        modal.id = 'admin-reviews-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center sm:p-4 bg-black/80 backdrop-blur-sm animate-in';
        modal.onclick = () => modal.remove();

        let reviewsHtml = '';
        if (reviews.length === 0) {
            reviewsHtml = '<div class="text-center opacity-50 mt-10 text-xs uppercase tracking-widest">Нет отзывов</div>';
        } else {
            reviewsHtml = reviews.map(r => {
                const isGood = r.rating >= 4;
                const statusColor = r.status === 'approved' || r.status === 'auto_posted' ? 'text-green-500' : (r.status === 'pending' ? 'text-yellow-500' : 'text-on-surface-variant');
                return `
                    <div class="bg-surface border border-outline-variant/30 rounded-2xl p-4 sm:p-5 mb-4 shadow-sm hover:border-primary/30 transition-colors">
                        <div class="flex justify-between items-start mb-3">
                            <div class="flex items-center gap-2">
                                <span class="material-symbols-outlined text-sm ${isGood ? 'text-green-500' : 'text-red-500'}" style="font-variation-settings: 'FILL' 1">
                                    ${isGood ? 'sentiment_satisfied' : 'sentiment_dissatisfied'}
                                </span>
                                <span class="font-bold text-text-main text-sm">${r.rating} Звезд</span>
                            </div>
                            <span class="text-[9px] font-black uppercase tracking-widest ${statusColor} bg-bg-main px-2 py-0.5 rounded border border-outline-variant/30">${r.status}</span>
                        </div>
                        <p class="text-sm text-text-main mb-3 leading-relaxed">${r.review_text || '<i>Без текста</i>'}</p>
                        ${r.ai_reply ? `
                            <div class="mt-3 pl-3 border-l-2 border-primary space-y-1 bg-primary/5 p-3 rounded-r-xl">
                                <p class="text-[9px] font-black uppercase tracking-widest text-primary flex items-center gap-1">
                                    <span class="material-symbols-outlined text-[10px]">robot_2</span> Ответ ИИ
                                </p>
                                <p class="text-[13px] text-text-main leading-relaxed">${r.ai_reply}</p>
                            </div>
                        ` : ''}
                        <div class="mt-4 flex justify-between items-center border-t border-outline-variant/30 pt-3">
                            <span class="text-[9px] text-on-surface-variant uppercase tracking-widest tabular-nums">${new Date(r.created_at).toLocaleString()}</span>
                            ${r.category ? `<span class="text-[9px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded uppercase">${r.category}</span>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }

        const userFeedbacks = (state.adminTickets || [])
            .filter(t => t.seller_id === userId && t.type === 'feedback')
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        let feedbackHtml = '';
        if (userFeedbacks.length > 0) {
            feedbackHtml = '<div class="mb-6"><h4 class="text-xs font-bold uppercase tracking-widest text-primary mb-3">Отзывы о платформе</h4>';
            feedbackHtml += userFeedbacks.map(f => `
                <div class="bg-primary/5 border border-primary/20 rounded-2xl p-4 sm:p-5 mb-3 shadow-sm relative">
                    <div class="flex justify-between items-start mb-2">
                        <div class="flex items-center gap-2">
                            <span class="material-symbols-outlined text-primary text-sm">stars</span>
                            <span class="font-bold text-text-main text-sm">Отзыв платформе</span>
                        </div>
                    </div>
                    <p class="text-sm text-text-main leading-relaxed italic">"${f.message}"</p>
                    ${f.admin_reply ? `
                        <div class="mt-3 pl-3 border-l-2 border-primary space-y-1 bg-primary/5 p-3 rounded-r-xl">
                            <p class="text-[9px] font-black uppercase tracking-widest text-primary flex items-center gap-1">
                                <span class="material-symbols-outlined text-[10px]">support_agent</span> Ваш ответ
                            </p>
                            <p class="text-[13px] text-text-main leading-relaxed">${f.admin_reply}</p>
                        </div>
                    ` : ''}
                    <div class="mt-3 flex justify-between items-center">
                        <button id="feedback-reply-btn-${f.id}" onclick="promptFeedbackReply('${f.id}'); if(typeof gtag === 'function') gtag('event', 'click_admin_feedback_reply');" class="text-[10px] bg-primary text-white px-3 py-1.5 rounded-lg uppercase tracking-widest font-bold shadow-md hover:bg-primary/90 active:scale-95 transition-all">Ответить</button>
                        <span class="text-[9px] text-on-surface-variant uppercase tracking-widest tabular-nums">${new Date(f.created_at).toLocaleString()}</span>
                    </div>
                </div>
            `).join('');
            feedbackHtml += '</div><hr class="border-outline-variant/30 mb-6"/>';
        }

        modal.innerHTML = `
            <div class="bg-bg-main w-full sm:rounded-2xl flex flex-col relative overflow-hidden shadow-2xl custom-h-90vh" style="max-width: 600px;" onclick="event.stopPropagation()">
                <div class="flex justify-between items-center border-b border-outline-variant/30 p-4 shrink-0 bg-surface">
                    <div class="flex items-center gap-3">
                        <span class="material-symbols-outlined text-primary text-3xl">reviews</span>
                        <div>
                            <h3 class="font-headline text-sm font-bold tracking-tight text-text-main uppercase tracking-widest">Отзывы юзера</h3>
                            <p class="text-[9px] text-on-surface-variant mt-0.5">${user?.display_name || user?.email || userId}</p>
                        </div>
                    </div>
                    <button onclick="document.getElementById('admin-reviews-modal').remove()" class="text-on-surface-variant hover:text-text-main transition-colors p-2 rounded-lg bg-bg-main border border-outline-variant/30 flex items-center justify-center">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
                <div class="custom-flex-scroll p-4 sm:p-6 bg-bg-main/50 relative">
                    ${feedbackHtml}
                    ${reviews.length > 0 || userFeedbacks.length > 0 ? '<h4 class="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-3">Отзывы WB</h4>' : ''}
                    ${reviewsHtml}
                </div>
            </div>
        `;
        document.body.appendChild(modal);

    } catch (e) {
        showToast('Ошибка загрузки отзывов', true);
    }
}

async function promptFeedbackReply(ticketId) {
    const btn = document.getElementById('feedback-reply-btn-' + ticketId);
    const replyText = prompt('Ответ на отзыв (отправится пользователю в Telegram):');
    if (!replyText) return;

    const originalContent = btn ? btn.innerHTML : 'Ответить';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = 'Отправка...';
    }

    try {
        const res = await apiFetch(`/api/admin/support/${ticketId}/reply`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ reply: replyText })
        });
        
        if (res.ok) {
            showToast('Ответ отправлен');
            await refreshData();
            document.getElementById('admin-reviews-modal').remove();
        } else {
            showToast('Ошибка при отправке', true);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalContent;
            }
        }
    } catch (e) {
        showToast('Ошибка сети', true);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
    }
}

// Utils
function toggleTokenVisibility() {
    const input = document.getElementById('wb-token-input');
    const icon = document.getElementById('token-visibility-icon');
    input.type = input.type === 'password' ? 'text' : 'password';
    icon.innerText = input.type === 'password' ? 'visibility' : 'visibility_off';
}

function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = `fixed bottom-24 left-1/2 -translate-x-1/2 px-8 py-4 text-xs font-bold z-[100] uppercase tracking-widest animate-toast rounded-lg ${
        isError 
            ? 'bg-red-50 text-red-700 border border-red-200' 
            : ''
    }`;
    toast.style.background = isError ? '' : 'var(--c-toast-bg)';
    toast.style.color = isError ? '' : 'var(--c-primary)';
    toast.style.border = isError ? '' : '1px solid var(--c-toast-border)';
    toast.style.boxShadow = '0 10px 25px -5px rgb(0 0 0 / 0.15)';
    toast.innerText = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

function showTokenInfoModal() {
    const existing = document.getElementById('token-info-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'token-info-modal';
    modal.className = 'fixed inset-0 z-[99999] flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm animate-in';
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };

    modal.innerHTML = `
        <div class="bg-bg-main w-full sm:rounded-2xl flex flex-col relative overflow-hidden shadow-2xl" style="max-width: 480px;" onclick="event.stopPropagation()">
            <!-- Header -->
            <div class="flex justify-between items-center border-b border-outline-variant/30 p-4 shrink-0 bg-surface">
                <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-primary text-3xl">api</span>
                    <h3 class="font-headline text-sm font-bold tracking-tight text-text-main uppercase tracking-widest">Инструкция по токену</h3>
                </div>
                <button onclick="document.getElementById('token-info-modal').remove()" class="text-on-surface-variant hover:text-text-main transition-colors p-2 rounded-lg bg-bg-main border border-outline-variant/30 flex items-center justify-center">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            
            <!-- Content -->
            <div class="p-6 space-y-5 text-sm text-on-surface-variant leading-relaxed">
                <p>
                    Для автоматической работы нейросети с вашими отзывами, нам необходим доступ на чтение и ответ через официальный API Wildberries.
                </p>
                <ol class="list-decimal pl-5 space-y-2">
                    <li>Перейдите на портал разработчиков: <a href="https://dev.wildberries.ru/" target="_blank" class="text-primary font-bold hover:underline">dev.wildberries.ru</a></li>
                    <li>Авторизуйтесь под своим аккаунтом продавца.</li>
                    <li>Создайте новый токен (тип ключа: <b>Стандартный</b> / <b>Standard</b>).</li>
                    <li>Скопируйте ключ и вставьте его в поле "API Токен Wildberries" в настройках нашего приложения.</li>
                </ol>
                <p class="pt-2 border-t border-outline-variant/30">
                    <span class="font-bold text-text-main">Возникли трудности?</span><br>
                    Если что-то не получается, пишите нам в <span onclick="document.getElementById('token-info-modal').remove(); showModal('support'); if(typeof gtag === 'function') gtag('event', 'click_support_from_token');" class="text-primary font-bold cursor-pointer hover:underline">поддержку</span>.
                </p>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

function renderAIPage() {
    const defaultToV = state.settings.custom_instructions || 'Вежливый владелец бренда. Обращайся на Вы. Пиши кратко и по делу. Никогда не проси писать в личку/мессенджеры (запрещено WB).';
    const hasToken = state.settings.wb_token && state.settings.wb_token_valid;
    const hasSubscription = (state.settings.subscription_status === 'trial' || state.settings.subscription_status === 'active');
    const expiresAt = state.settings.subscription_expires_at ? new Date(state.settings.subscription_expires_at) : null;
    const isUnlimited = hasSubscription && expiresAt && new Date() <= expiresAt;
    
    return `
        <div class="max-w-7xl mx-auto space-y-8 animate-in pb-24 px-0 sm:px-4">
            <header class="px-4 sm:px-0">
                <p class="text-primary text-[10px] font-black uppercase tracking-[0.3em] mb-2">Лаборатория</p>
                <h2 class="font-headline text-2xl sm:text-3xl font-bold text-text-main tracking-tight">ИИ Тест</h2>
                <p class="text-on-surface-variant text-sm mt-2 leading-relaxed">Проверьте, как нейросеть отвечает на отзывы. ${isUnlimited ? '<span class="text-green-500 font-bold">Безлимит ∞</span>' : '<span class="text-primary font-bold">5 бесплатных тестов в день</span>'}</p>
            </header>

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-start px-4 sm:px-0">
                
                <!-- Левая колонка: Ввод -->
                <section class="premium-card p-6 sm:p-8 space-y-6 lg:sticky lg:top-4">
                    
                    <div class="space-y-2">
                        <label class="text-[10px] font-black uppercase tracking-widest text-primary">Отзыв покупателя</label>
                        <textarea id="test-review-input" class="w-full bg-bg-main border-2 border-primary/20 outline-none p-4 text-text-main text-sm leading-relaxed h-28 focus:border-primary transition-colors resize-none rounded-lg shadow-inner" 
                            placeholder="Текст отзыва...">Прислали другой цвет, коробка вся мятая, а продавец игнорит вторую неделю! Ужасное отношение к покупателям.</textarea>
                    </div>

                    <div class="space-y-2">
                        <label class="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Оценка покупателя</label>
                        <div class="flex items-center gap-1" id="test-ai-rating-stars">
                            ${[1,2,3,4,5].map(n => `
                                <button type="button" onclick="setTestRating(${n})" data-star="${n}" class="test-star-btn group transition-all duration-200 p-1 rounded-lg hover:bg-primary/10">
                                    <svg class="w-8 h-8 sm:w-9 sm:h-9 transition-all duration-200 ${n <= 1 ? 'text-primary drop-shadow-[0_0_6px_rgba(var(--primary-rgb),0.4)]' : 'text-outline-variant'}" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                                    </svg>
                                </button>
                            `).join('')}
                            <span id="test-ai-rating-label" class="ml-3 text-xs font-bold text-primary tabular-nums">1 из 5</span>
                        </div>
                        <input type="hidden" id="test-ai-rating" value="1">
                    </div>

                    <!-- Спойлер (Тонкие настройки) -->
                    <details class="group border border-outline-variant/30 rounded-xl bg-bg-main/50 overflow-hidden" onclick="if(typeof gtag === 'function') gtag('event', 'click_test_settings_spoiler')">
                        <summary class="cursor-pointer p-4 text-xs font-bold text-on-surface-variant flex items-center justify-between select-none list-none hover:bg-on-surface-variant/5 transition-colors">
                            <span class="flex items-center gap-2">
                                <span class="material-symbols-outlined text-[16px]">tune</span>
                                Тонкие настройки (Товар & Тон)
                            </span>
                            <span class="material-symbols-outlined transition-transform duration-300 group-open:rotate-180">expand_more</span>
                        </summary>
                        <div class="p-4 sm:p-6 border-t border-outline-variant/30 space-y-5 bg-bg-main/30">
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div class="space-y-2">
                                    <label class="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Название</label>
                                    <input id="test-ai-product-name" type="text" class="w-full bg-bg-main border border-outline-variant outline-none p-3 text-text-main text-xs rounded-lg focus:border-primary" 
                                        placeholder="Напр: Платье" value="Платье шелковое">
                                </div>
                                <div class="space-y-2">
                                    <label class="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Бренд</label>
                                    <input id="test-ai-brand" type="text" class="w-full bg-bg-main border border-outline-variant outline-none p-3 text-text-main text-xs rounded-lg focus:border-primary" 
                                        placeholder="Напр: Бренд" value="${state.settings.brand_name || 'Наш Магазин'}">
                                </div>
                            </div>
                            <div class="space-y-2">
                                <label class="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Описание (характеристика)</label>
                                <textarea id="test-ai-product-desc" class="w-full bg-bg-main border border-outline-variant outline-none p-3 text-text-main text-xs leading-relaxed h-16 focus:border-primary transition-colors resize-none rounded-lg" 
                                    placeholder="Опишите товар...">Натуральный шелк, деликатная ткань.</textarea>
                            </div>
                            <div class="space-y-2">
                                <label class="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Tone of Voice (Инструкции)</label>
                                <textarea id="test-ai-tov" class="w-full bg-bg-main border border-outline-variant outline-none p-3 text-text-main text-xs leading-relaxed h-20 focus:border-primary transition-colors resize-none rounded-lg" 
                                    placeholder="Как отвечать?">${defaultToV}</textarea>
                            </div>
                        </div>
                    </details>

                    <!-- Кнопка для мобилок и десктопа -->
                    <div class="pt-2">
                        <button id="test-ai-btn" onclick="handleTestAI(); if(typeof gtag === 'function') gtag('event', 'click_test_ai_generate');" class="primary-btn w-full py-4 text-xs uppercase tracking-[0.2em] shadow-lg active:scale-[0.99] transition-all flex items-center justify-center gap-3">
                            <span class="material-symbols-outlined text-lg">magic_button</span>
                            Сгенерировать ответ
                        </button>
                    </div>
                </section>

                <!-- Правая колонка: Результат -->
                <div class="flex flex-col space-y-6">
                    <div id="test-ai-result" class="hidden animate-in fade-in slide-in-from-bottom-4">
                        <section class="premium-card p-6 sm:p-8 space-y-4 border-primary/20 bg-primary/5">
                            <div class="flex items-center gap-3">
                                <span class="material-symbols-outlined text-primary">robot_2</span>
                                <h3 class="text-text-main font-bold text-sm uppercase tracking-widest">Результат генерации</h3>
                            </div>
                            <div id="test-ai-text" class="text-sm text-text-main leading-relaxed italic"></div>
                            
                            <div class="flex gap-4 pt-4 border-t border-outline-variant/20">
                                <div class="flex-1">
                                    <p class="text-[9px] font-black text-on-surface-variant uppercase mb-1">Тональность</p>
                                    <div id="test-ai-sentiment" class="text-[11px] font-bold text-primary uppercase"></div>
                                </div>
                                <div class="flex-1">
                                    <p class="text-[9px] font-black text-on-surface-variant uppercase mb-1">Категория</p>
                                    <div id="test-ai-category" class="text-[11px] font-bold text-text-main uppercase"></div>
                                </div>
                            </div>
                        </section>
                    </div>

                    <!-- CTA: Next Step -->
                    ${!hasToken ? `
                    <section class="premium-card p-6 sm:p-8 border-2 border-primary/30 bg-primary/5 space-y-4 shadow-[0_0_30px_rgba(var(--primary-rgb),0.1)]" id="test-cta-block" style="display: none;">
                        <div class="flex items-start gap-4">
                            <div class="w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center shrink-0">
                                <span class="material-symbols-outlined text-primary text-2xl">rocket_launch</span>
                            </div>
                            <div class="flex-1 space-y-2">
                                <h3 class="text-text-main font-bold text-base">Понравилось? Подключите к своим отзывам!</h3>
                                <p class="text-on-surface-variant text-xs leading-relaxed">Добавьте API-токен Wildberries, и нейросеть начнет автоматически отвечать на все ваши отзывы 24/7. Первые <strong class="text-text-main">3 дня — бесплатно!</strong></p>
                            </div>
                        </div>
                        <button onclick="showView('settings'); if(typeof gtag === 'function') gtag('event', 'click_cta_connect_token');" class="primary-btn w-full py-4 text-xs uppercase tracking-[0.2em] shadow-lg active:scale-[0.99] transition-all flex items-center justify-center gap-3 mt-2">
                            <span class="material-symbols-outlined text-lg">key</span>
                            Подключить токен WB
                        </button>
                    </section>
                    ` : ''}

                    <!-- Заглушка (пока нет результата) -->
                    <div id="test-ai-placeholder" class="premium-card p-8 text-center flex flex-col items-center justify-center min-h-[300px] border-dashed border-2 border-outline-variant/30 opacity-70 transition-all duration-300">
                        <div class="w-16 h-16 rounded-full bg-bg-main flex items-center justify-center mb-4">
                            <span class="material-symbols-outlined text-3xl text-on-surface-variant">edit_note</span>
                        </div>
                        <h4 class="text-text-main font-bold mb-2">Здесь появится ответ ИИ</h4>
                        <p class="text-on-surface-variant text-xs max-w-[250px] leading-relaxed">Напишите отзыв слева и нажмите сгенерировать, чтобы увидеть магию.</p>
                    </div>
                </div>

            </div>
        </div>
    `;
}

function setTestRating(n) {
    document.getElementById('test-ai-rating').value = n;
    document.getElementById('test-ai-rating-label').textContent = n + ' из 5';
    document.querySelectorAll('#test-ai-rating-stars .test-star-btn').forEach(btn => {
        const star = parseInt(btn.dataset.star);
        const svg = btn.querySelector('svg');
        if (star <= n) {
            svg.classList.remove('text-outline-variant');
            svg.classList.add('text-primary', 'drop-shadow-[0_0_6px_rgba(var(--primary-rgb),0.4)]');
        } else {
            svg.classList.add('text-outline-variant');
            svg.classList.remove('text-primary', 'drop-shadow-[0_0_6px_rgba(var(--primary-rgb),0.4)]');
        }
    });
}

async function handleTestAI() {
    const reviewText = document.getElementById('test-review-input').value;
    const characteristicsText = '';
    const productName = document.getElementById('test-ai-product-name').value;
    const productDescription = document.getElementById('test-ai-product-desc').value;
    const toneOfVoice = document.getElementById('test-ai-tov').value;
    const brandName = document.getElementById('test-ai-brand').value;
    const rating = parseInt(document.getElementById('test-ai-rating').value) || 5;

    if (!reviewText) return showToast('Введите текст отзыва', true);

    const btn = document.getElementById('test-ai-btn');
    const resultDiv = document.getElementById('test-ai-result');
    const originalContent = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '<span class="animate-spin material-symbols-outlined">sync</span><span>Магия в процессе...</span>';
    resultDiv.classList.add('hidden');

    try {
        const res = await apiFetch('/api/ai/test', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                reviewText,
                productName,
                productDescription,
                characteristicsText,
                toneOfVoice,
                brandName,
                rating
            })
        });

        if (res.ok) {
            const data = await res.json();
            if(typeof gtag === 'function') gtag('event', 'test_ai_success');
            localStorage.setItem('wb_has_tested', '1');
            document.getElementById('test-ai-text').innerText = `"${data.text || 'Ошибка генерации'}"`;
            document.getElementById('test-ai-sentiment').innerText = data.sentiment || '—';
            document.getElementById('test-ai-category').innerText = data.category || '—';
            
            // UI Switch: hide placeholder, show result & CTA
            const placeholder = document.getElementById('test-ai-placeholder');
            if (placeholder) placeholder.style.display = 'none';
            resultDiv.classList.remove('hidden');
            
            const cta = document.getElementById('test-cta-block');
            if (cta) cta.style.display = 'block';

            // Scroll on mobile, but keep layout stable on desktop
            if (window.innerWidth < 1024) {
                resultDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        } else if (res.status === 429) {
            const err = await res.json();
            showToast(err.error || 'Лимит тестов исчерпан', true);
            // Show CTA block if hidden
            const cta = document.getElementById('test-cta-block');
            if (cta) cta.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            const err = await res.json();
            showToast(err.error || 'Ошибка сети', true);
        }
    } catch (e) {
        showToast('Ошибка сервера', true);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
}
