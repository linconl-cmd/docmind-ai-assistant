-- Roles enum + tabela separada (segurança)
create type public.app_role as enum ('user', 'admin');
create type public.user_plan as enum ('free', 'ppu', 'pro', 'biz');
create type public.doc_status as enum ('uploading', 'extracting', 'ready', 'error');

-- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  plan public.user_plan not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- user_roles (separado por segurança)
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

-- has_role security definer
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

-- documents
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  storage_path text not null default '',
  pages integer not null default 1,
  extracted_text text,
  fields_detected jsonb,
  claude_context text,
  edit_count integer not null default 0,
  status public.doc_status not null default 'ready',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.documents enable row level security;

-- usage_logs
create table public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  prompt text not null default '',
  model text not null default '',
  tokens_input integer not null default 0,
  tokens_output integer not null default 0,
  cost_usd numeric(10,6) not null default 0,
  created_at timestamptz not null default now()
);
alter table public.usage_logs enable row level security;

-- RLS profiles
create policy "users read own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "admins read all profiles" on public.profiles
  for select using (public.has_role(auth.uid(), 'admin'));
create policy "users update own profile" on public.profiles
  for update using (auth.uid() = id);
create policy "users insert own profile" on public.profiles
  for insert with check (auth.uid() = id);

-- RLS user_roles
create policy "users read own roles" on public.user_roles
  for select using (auth.uid() = user_id);
create policy "admins read all roles" on public.user_roles
  for select using (public.has_role(auth.uid(), 'admin'));

-- RLS documents
create policy "users crud own documents select" on public.documents
  for select using (auth.uid() = user_id);
create policy "users crud own documents insert" on public.documents
  for insert with check (auth.uid() = user_id);
create policy "users crud own documents update" on public.documents
  for update using (auth.uid() = user_id);
create policy "users crud own documents delete" on public.documents
  for delete using (auth.uid() = user_id);
create policy "admins read all documents" on public.documents
  for select using (public.has_role(auth.uid(), 'admin'));

-- RLS usage_logs
create policy "users read own usage" on public.usage_logs
  for select using (auth.uid() = user_id);
create policy "users insert own usage" on public.usage_logs
  for insert with check (auth.uid() = user_id);
create policy "admins read all usage" on public.usage_logs
  for select using (public.has_role(auth.uid(), 'admin'));

-- Trigger: cria profile + role 'user' ao signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  );
  insert into public.user_roles (user_id, role)
  values (new.id, 'user');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Trigger updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger touch_profiles before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger touch_documents before update on public.documents
  for each row execute function public.touch_updated_at();