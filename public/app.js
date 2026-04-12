/**
 * WB AI Responder - Main Frontend Logic
 */

const state = {
    currentView: 'dashboard',
    theme: 'light',
    reviews: [],
    stats: { total: 0, pending: 0, approved: 0 },
    settings: { is_auto_reply_enabled: false, auto_reply_min_rating: 4 },
    matrix: [],
    analytics: { ratings: {}, categories: {}, sentiments: {} },
    maxUserId: 'mock_user_123' 
};

// --- API Calls ---

async function fetchAnalytics() {
    try {
        const res = await fetch('/api/analytics');
        state.analytics = await res.json();
    } catch (e) { console.error('Analytics fetch error:', e); }
}

async function fetchMatrix() {
    try {
        const res = await fetch('/api/matrix');
        state.matrix = await res.json();
    } catch (e) { console.error('Matrix fetch error:', e); }
}

async function saveMatrixEntry(entry) {
    try {
        const res = await fetch('/api/matrix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry)
        });
        if (res.ok) {
            showToast('✅ Товар добавлен в матрицу');
            await fetchMatrix();
            showView('products');
        }
    } catch (e) { showToast('❌ Ошибка сохранения', true); }
}

async function fetchSettings() {
    try {
        const res = await fetch(`/api/settings/${state.maxUserId}`);
        state.settings = await res.json();
    } catch (e) { console.error('Settings fetch error:', e); }
}

async function saveSettings() {
    try {
        const res = await fetch(`/api/settings/${state.maxUserId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.settings)
        });
        const result = await res.json();
        if (result.success) showToast('✅ Настройки сохранены');
    } catch (e) { showToast('❌ Ошибка сохранения', true); }
}

async function fetchStats() {
    try {
        const res = await fetch('/api/stats');
        state.stats = await res.json();
    } catch (e) { console.error('Stats fetch error:', e); }
}

async function fetchReviews(status) {
    try {
        let url = '/api/reviews';
        if (status) url += `?status=${status}`;
        const res = await fetch(url);
        state.reviews = await res.json();
    } catch (e) { console.error('Reviews fetch error:', e); }
}

async function approveReview(id, text) {
    try {
        const res = await fetch(`/api/reviews/${id}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        const result = await res.json();
        if (result.success) {
            showToast('✅ Ответ успешно отправлен!');
            await refreshData();
        } else {
            showToast('❌ Ошибка при отправке :(', true);
        }
    } catch (e) { 
        console.error('Approve error:', e);
        showToast('❌ Ошибка сети', true);
    }
}

async function refreshData() {
    await fetchStats();
    await fetchReviews();
    showView(state.currentView);
}

// --- View Rendering ---

function renderDashboard() {
    return `
        <div class="animate-in">
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;">
                <div class="card">
                    <div style="color: var(--text-muted); font-size: 14px; margin-bottom: 8px;">Всего отзывов</div>
                    <div style="font-size: 32px; font-weight: 700;">${state.stats.total || 0}</div>
                    <div style="color: #30d158; font-size: 12px; margin-top: 8px;">За все время</div>
                </div>
                <div class="card">
                    <div style="color: var(--text-muted); font-size: 14px; margin-bottom: 8px;">Ожидают проверки</div>
                    <div style="font-size: 32px; font-weight: 700;">${state.stats.pending || 0}</div>
                    <div style="color: #ff9f0a; font-size: 12px; margin-top: 8px;">Нужно ваше внимание</div>
                </div>
                <div class="card" style="background: var(--accent-gradient); color: white;">
                    <div style="opacity: 0.8; font-size: 14px; margin-bottom: 8px;">Автоответы</div>
                    <div style="font-size: 32px; font-weight: 700;">Работают</div>
                    <div style="opacity: 0.9; font-size: 12px; margin-top: 8px;">Фоновый режим активен</div>
                </div>
            </div>

            <div class="card" style="margin-top: 24px;">
                <h3>Последняя активность</h3>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border-radius: 12px; background: var(--glass-border);">
                        <span>Система мониторинга отзывов активна</span>
                        <span style="font-size: 12px; color: var(--text-muted);">В реальном времени</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderReviews() {
    if (state.reviews.length === 0) {
        return `<div class="card"><p>Все отзывы обработаны! 🎉</p></div>`;
    }
    return `
        <div class="review-list animate-in">
            ${state.reviews.map(review => `
                <div class="card review-item">
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <div>
                            <div class="rating">${'★'.repeat(review.rating)}${'☆'.repeat(5-review.rating)}</div>
                            <p style="margin: 8px 0; font-size: 15px;">${review.text || 'Нет текста'}</p>
                            <div style="font-size: 12px; color: var(--text-muted);">Артикул: ${review.nm_id}</div>
                        </div>
                        <span class="badge badge-pending">Ожидает</span>
                    </div>
                    
                    <div class="draft-area">
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px; display: flex; align-items: center; gap: 4px;">
                            <i data-lucide="sparkles" style="width: 12px;"></i> Черновик от AI
                        </div>
                        <textarea id="text-${review.id}">${review.ai_response_draft || ''}</textarea>
                    </div>

                    <div style="display: flex; gap: 12px; margin-top: 12px;">
                        <button class="btn btn-primary" onclick="handleApprove('${review.id}')">Отправить на WB</button>
                        <button class="btn" style="background: var(--glass-border);">Игнорировать</button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderSettings() {
    return `
        <div class="card animate-in">
            <h3 style="margin-top: 0">Настройки автоответчика</h3>
            <p style="color: var(--text-muted); font-size: 14px;">Управляйте автоматизацией ответов на ваши отзывы.</p>
            
            <div style="margin-top: 24px; display: flex; flex-direction: column; gap: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-weight: 600;">Включить автоответ</div>
                        <div style="font-size: 12px; color: var(--text-muted);">Система будет сама отвечать на хорошие отзывы</div>
                    </div>
                    <label class="switch">
                        <input type="checkbox" id="auto-reply-toggle" ${state.settings.is_auto_reply_enabled ? 'checked' : ''} onchange="toggleAutoReply(this.checked)">
                        <span class="slider round"></span>
                    </label>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-weight: 600;">Минимальный рейтинг</div>
                        <div style="font-size: 12px; color: var(--text-muted);">Автоответ только для отзывов от X звезд и выше</div>
                    </div>
                    <select id="min-rating" onchange="setMinRating(this.value)" style="padding: 8px; border-radius: 8px; background: var(--glass-border); color: var(--text); border: none;">
                        <option value="1" ${state.settings.auto_reply_min_rating == 1 ? 'selected' : ''}>1 звезда</option>
                        <option value="2" ${state.settings.auto_reply_min_rating == 2 ? 'selected' : ''}>2 звезды</option>
                        <option value="3" ${state.settings.auto_reply_min_rating == 3 ? 'selected' : ''}>3 звезды</option>
                        <option value="4" ${state.settings.auto_reply_min_rating == 4 ? 'selected' : ''}>4 звезды</option>
                        <option value="5" ${state.settings.auto_reply_min_rating == 5 ? 'selected' : ''}>5 звезд</option>
                    </select>
                </div>
            </div>

            <button class="btn btn-primary" style="margin-top: 32px; width: 100%" onclick="saveSettings()">Сохранить настройки</button>
        </div>
    `;
}

function renderProducts() {
    return `
        <div class="animate-in">
            <div class="card" style="margin-bottom: 24px;">
                <h3>Добавить товар в матрицу</h3>
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
                    <input type="text" id="m-nm-id" placeholder="Артикул WB (nmId)" style="padding: 10px; border-radius: 8px; border: 1px solid var(--glass-border); background: var(--glass-border); color: var(--text);">
                    <input type="text" id="m-name" placeholder="Понятное имя (н-р: Платье летнее)" style="padding: 10px; border-radius: 8px; border: 1px solid var(--glass-border); background: var(--glass-border); color: var(--text);">
                    <input type="text" id="m-cross-id" placeholder="Доп. артикул (для доп. продаж)" style="padding: 10px; border-radius: 8px; border: 1px solid var(--glass-border); background: var(--glass-border); color: var(--text);">
                    <input type="text" id="m-cross-desc" placeholder="Описание доп. товара" style="padding: 10px; border-radius: 8px; border: 1px solid var(--glass-border); background: var(--glass-border); color: var(--text);">
                </div>
                <button class="btn btn-primary" style="margin-top: 16px; width: 100%" onclick="handleAddMatrix()">Добавить в матрицу</button>
            </div>

            <div class="review-list">
                ${state.matrix.map(item => `
                    <div class="card" style="display: flex; justify-content: space-between; align-items: center; padding: 16px;">
                        <div>
                            <div style="font-weight: 600;">${item.product_name}</div>
                            <div style="font-size: 12px; color: var(--text-muted);">Артикул: ${item.nm_id}</div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-size: 12px; color: var(--primary);">Рекомендация: ${item.cross_sell_article || '—'}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

async function handleAddMatrix() {
    const entry = {
        nm_id: document.getElementById('m-nm-id').value,
        product_name: document.getElementById('m-name').value,
        cross_sell_article: document.getElementById('m-cross-id').value,
        cross_sell_description: document.getElementById('m-cross-desc').value
    };
    if (!entry.nm_id || !entry.product_name) return showToast('Заполните артикул и имя', true);
    await saveMatrixEntry(entry);
}

function renderAnalytics() {
    const total = Object.values(state.analytics.ratings).reduce((a, b) => a + b, 0);
    
    const renderBar = (label, value, color) => {
        const percent = total > 0 ? (value / total * 100) : 0;
        return `
            <div style="margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px;">
                    <span>${label}</span>
                    <span>${value} (${percent.toFixed(0)}%)</span>
                </div>
                <div style="height: 8px; background: var(--glass-border); border-radius: 4px; overflow: hidden;">
                    <div style="width: ${percent}%; height: 100%; background: ${color}; border-radius: 4px;"></div>
                </div>
            </div>
        `;
    };

    return `
        <div class="animate-in">
            <div class="card" style="margin-bottom: 24px;">
                <h3>Распределение оценок</h3>
                ${[5, 4, 3, 2, 1].map(star => renderBar(`${star} звезд`, state.analytics.ratings[star] || 0, '#ff9f0a')).join('')}
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div class="card">
                    <h3>Тональность</h3>
                    ${renderBar('Позитив', state.analytics.sentiments.positive || 0, '#30d158')}
                    ${renderBar('Нейтраль', state.analytics.sentiments.neutral || 0, '#8e8e93')}
                    ${renderBar('Негатив', state.analytics.sentiments.negative || 0, '#ff3b30')}
                </div>
                <div class="card">
                    <h3>Категории</h3>
                    ${Object.entries(state.analytics.categories).map(([cat, val]) => renderBar(cat, val, 'var(--primary)')).join('')}
                    ${Object.keys(state.analytics.categories).length === 0 ? '<p style="font-size: 12px; color: var(--text-muted);">Нет данных</p>' : ''}
                </div>
            </div>
        </div>
    `;
}

function showView(view) {
    state.currentView = view;
    const content = document.getElementById('content-view');
    const headerTitle = document.getElementById('header-text');

    // Update Nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        const text = item.innerText.toLowerCase();
        if ((view === 'dashboard' && text.includes('дашборд')) ||
            (view === 'reviews' && text.includes('отзывы')) ||
            (view === 'products' && text.includes('матрица')) ||
            (view === 'analytics' && text.includes('аналитика')) ||
            (view === 'settings' && text.includes('настройки'))) {
            item.classList.add('active');
        }
    });

    if (view === 'dashboard') {
        content.innerHTML = renderDashboard();
        headerTitle.innerText = 'Дашборд';
    } else if (view === 'reviews') {
        content.innerHTML = renderReviews();
        headerTitle.innerText = 'Управление отзывами';
    } else if (view === 'products') {
        content.innerHTML = renderProducts();
        headerTitle.innerText = 'Матрица товаров (Контекст)';
    } else if (view === 'analytics') {
        content.innerHTML = renderAnalytics();
        headerTitle.innerText = 'Аналитика и Инсайты';
    } else if (view === 'settings') {
        content.innerHTML = renderSettings();
        headerTitle.innerText = 'Настройки системы';
    } else {
        content.innerHTML = `<div class="card"><p>Раздел ${view} находится в разработке.</p></div>`;
        headerTitle.innerText = view.charAt(0).toUpperCase() + view.slice(1);
    }

    lucide.createIcons();
}

function toggleAutoReply(enabled) {
    state.settings.is_auto_reply_enabled = enabled;
}

function setMinRating(rating) {
    state.settings.auto_reply_min_rating = parseInt(rating);
}

// --- Toast ---
function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; bottom: 20px; right: 20px;
        padding: 12px 24px; border-radius: 12px;
        background: ${isError ? '#ff3b30' : '#30d158'};
        color: white; font-weight: 600; box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        z-index: 1000; animation: fadeIn 0.3s ease;
    `;
    toast.innerText = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// --- Interactions ---

async function handleApprove(id) {
    const text = document.getElementById(`text-${id}`).value;
    await approveReview(id, text);
}

// Theme Toggle
document.getElementById('theme-toggle').addEventListener('click', () => {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    document.body.setAttribute('data-theme', state.theme);
    const icon = document.querySelector('#theme-toggle i');
    icon.setAttribute('data-lucide', state.theme === 'light' ? 'moon' : 'sun');
    document.getElementById('theme-toggle').lastChild.textContent = state.theme === 'light' ? ' Темная тема' : ' Светлая тема';
    lucide.createIcons();
});

// Init
window.onload = async () => {
    await fetchSettings();
    await fetchStats();
    await fetchMatrix();
    await fetchAnalytics();
    await fetchReviews('pending');
    showView('dashboard');
};
