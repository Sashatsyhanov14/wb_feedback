create table if not exists support_tickets (
    id uuid default uuid_generate_v4() primary key,
    seller_id uuid references sellers(id) on delete cascade,
    type text not null, -- 'support' or 'feedback'
    message text not null,
    admin_reply text,
    status text default 'open', -- 'open', 'replied', 'closed'
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);
alter table support_tickets disable row level security;
create index if not exists idx_support_tickets_seller_id on support_tickets(seller_id);
