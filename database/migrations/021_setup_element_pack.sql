alter table public.projects
  add column if not exists element_pack_url text,
  add column if not exists element_pack_signature text,
  add column if not exists element_pack_count integer,
  add column if not exists element_pack_generated_at timestamptz;

create index if not exists projects_element_pack_signature_idx
  on public.projects (element_pack_signature)
  where element_pack_signature is not null;

