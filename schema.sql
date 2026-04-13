-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Sellers table
create table if not exists sellers (
    id uuid default uuid_generate_v4() primary key,
    telegram_chat_id bigint not null unique,
    wb_token text not null,
    is_auto_reply_enabled boolean default true,
    auto_reply_min_rating integer default 4,
    brand_name text,
    seller_description text,
    custom_instructions text,
    subscription_status text default 'free',
    subscription_expires_at timestamp with time zone,
    is_top_5 boolean default false,
    respond_to_bad_reviews boolean default false,
    created_at timestamp with time zone default now()
);

-- 2. Product matrix table
create table if not exists product_matrix (
    id uuid default uuid_generate_v4() primary key,
    seller_id uuid references sellers(id) on delete cascade,
    nm_id bigint not null, -- WB Article
    product_name text,
    cross_sell_article text, -- Can be multiple or specific format
    cross_sell_description text,
    created_at timestamp with time zone default now(),
    unique(seller_id, nm_id)
);

-- 3. Review logs table
create table if not exists review_logs (
    id uuid default uuid_generate_v4() primary key,
    seller_id uuid references sellers(id) on delete cascade,
    review_id text not null,
    text text,
    rating integer check (rating >= 1 and rating <= 5),
    nm_id bigint not null,
    ai_response_draft text,
    status text default 'pending', -- 'pending', 'approved', 'auto_posted', 'rejected'
    category text, -- 'Quality', 'Delivery', 'Price', 'Other'
    sentiment text, -- 'positive', 'neutral', 'negative'
    created_at timestamp with time zone default now(),
    unique(seller_id, review_id)
);

-- 4. Chat history table (for persistent AI Consultant memory)
create table if not exists chat_history (
    id uuid default uuid_generate_v4() primary key,
    seller_id uuid references sellers(id) on delete cascade,
    role text not null, -- 'user', 'assistant'
    content text not null,
    created_at timestamp with time zone default now()
);

-- 5. Indexes for performance
create index if not exists idx_review_logs_seller_id on review_logs(seller_id);
create index if not exists idx_product_matrix_seller_id on product_matrix(seller_id);
create index if not exists idx_sellers_telegram_id on sellers(telegram_chat_id);
create index if not exists idx_chat_history_seller_id on chat_history(seller_id);
