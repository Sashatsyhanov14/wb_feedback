-- Полная структура БД для WBReply AI (без Telegram бота)
create extension if not exists "uuid-ossp";

-- 1. Sellers (Продавцы / Пользователи)
create table if not exists sellers (
    id uuid default uuid_generate_v4() primary key,
    auth_provider text not null,      -- 'google', 'vk', 'telegram' (как метод входа)
    auth_provider_id text not null,   -- ID от провайдера
    email text,
    display_name text,
    avatar_url text,
    wb_token text default '',
    is_auto_reply_enabled boolean default true,
    brand_name text,
    custom_instructions text,
    subscription_status text default 'free',
    subscription_expires_at timestamp with time zone,
    respond_to_bad_reviews boolean default false,
    joined_at timestamp with time zone default now(),
    last_active_at timestamp with time zone default now(),
    created_at timestamp with time zone default now(),
    unique(auth_provider, auth_provider_id)
);

-- 2. Review Logs (Отзывы и ответы ИИ)
create table if not exists review_logs (
    id uuid default uuid_generate_v4() primary key,
    seller_id uuid references sellers(id) on delete cascade,
    review_id text not null,
    review_text text,
    product_name text default '',
    rating integer check (rating >= 1 and rating <= 5),
    nm_id bigint not null,
    ai_response_draft text,
    status text default 'pending', -- 'pending', 'approved', 'auto_posted', 'rejected'
    category text, -- 'Quality', 'Delivery', 'Price', 'Other'
    sentiment text, -- 'positive', 'neutral', 'negative'
    created_at timestamp with time zone default now(),
    unique(seller_id, review_id)
);

-- 3. Chat History (ИИ-консультант в вебе)
create table if not exists chat_history (
    id uuid default uuid_generate_v4() primary key,
    seller_id uuid references sellers(id) on delete cascade,
    role text check (role in ('user', 'assistant')),
    content text not null,
    created_at timestamp with time zone default now()
);

-- Отключение RLS (Row Level Security), так как мы ходим в базу через Service Role Key с бэкенда
alter table sellers disable row level security;
alter table review_logs disable row level security;
alter table chat_history disable row level security;

-- Индексы для ускорения запросов
create index if not exists idx_review_logs_seller_id on review_logs(seller_id);
create index if not exists idx_chat_history_seller_id on chat_history(seller_id);
create index if not exists idx_sellers_auth on sellers(auth_provider, auth_provider_id);
