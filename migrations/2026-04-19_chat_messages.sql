-- Agent 12 — dialog-agenten
-- Persistent chatt-historik per användare. Server skriver via service role;
-- användaren läser egna meddelanden via RLS.

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  tokens_input int,
  tokens_output int,
  tokens_cache_read int,
  tokens_cache_write int,
  created_at timestamptz default now()
);

create index if not exists chat_messages_user_created_idx
  on chat_messages(user_id, created_at desc);

alter table chat_messages enable row level security;

drop policy if exists chat_messages_select_own on chat_messages;
create policy chat_messages_select_own on chat_messages
  for select using (auth.uid() = user_id);
