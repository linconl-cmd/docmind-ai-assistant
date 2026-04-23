-- Storage bucket for uploaded PDFs (private; access via service role or signed URLs)
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Users can read their own files; service role bypasses this.
create policy "Users read own documents"
on storage.objects for select
using (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[1]);
