create table if not exists public.assignment_templates (
  id text not null,
  version integer not null,
  title text not null,
  category text not null,
  estimated_time text not null,
  reward_min numeric(10, 2) not null,
  reward_max numeric(10, 2) not null,
  definition jsonb not null,
  created_at timestamptz not null default now(),
  primary key (id, version),
  check (reward_min >= 0 and reward_max >= reward_min)
);

insert into public.assignment_templates (id, version, title, category, estimated_time, reward_min, reward_max, definition)
values (
  'product-research', 1, 'Product Research', 'Product Research', '30–90 min', 20, 100,
  '{"version":1,"sections":[{"id":"product-information","title":"Product Information","required":true,"fields":["productName","sourceUrl","category","price","rating","otherInformation"]},{"id":"product-features","title":"Product Features","required":true,"fields":["mainFeatures","benefits","strengths","weaknesses","observations"]},{"id":"competitor-research","title":"Competitor Research","required":true,"fields":["competitors"]},{"id":"customer-research","title":"Customer Research","required":true,"fields":["positiveThemes","negativeThemes","complaints","praises","observations","sources"]},{"id":"market-trends","title":"Market/Trend Research","required":true,"fields":["trends","patterns","opportunities","risks","sources"]},{"id":"final-analysis","title":"Final Analysis","required":true,"fields":["keyFindings","overallAssessment","recommendations","additionalNotes"]},{"id":"submit-assignment","title":"Submit Assignment","required":false,"fields":[]}],"evidence":{"required":false,"allowed":["sourceUrl","image","document"],"maxFileSizeBytes":8388608}}'::jsonb
)
on conflict (id, version) do nothing;

alter table public.contributor_tasks
  add column if not exists template_id text,
  add column if not exists template_version integer,
  add column if not exists assigned_by uuid references auth.users(id) on delete set null,
  add column if not exists product_name text,
  add column if not exists draft jsonb not null default '{}'::jsonb,
  add column if not exists progress integer not null default 0 check (progress between 0 and 100),
  add column if not exists current_step text not null default 'product-information',
  add column if not exists accepted_at timestamptz,
  add column if not exists last_activity_at timestamptz not null default now(),
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists change_request text,
  add column if not exists reward_min numeric(10, 2),
  add column if not exists reward_max numeric(10, 2);

alter table public.contributor_tasks drop constraint if exists contributor_tasks_status_check;
alter table public.contributor_tasks
  add constraint contributor_tasks_status_check check (
    status in ('Available', 'Accepted', 'In Progress', 'Submitted', 'Under Review', 'Approved', 'Changes Requested', 'Completed', 'Started')
  );

drop index if exists public.contributor_tasks_one_active_assignment_idx;
create unique index contributor_tasks_one_active_assignment_idx
  on public.contributor_tasks (user_id, assignment_id)
  where status in ('Available', 'Accepted', 'In Progress', 'Submitted', 'Under Review', 'Changes Requested', 'Started');

update public.contributor_tasks
set template_id = 'product-research',
    template_version = 1,
    status = 'In Progress',
    reward_min = 20,
    reward_max = 100,
    last_activity_at = coalesce(last_activity_at, created_at)
where assignment_id = 'asg-001'
  and status = 'Started';

alter table public.contributor_tasks
  drop constraint if exists contributor_tasks_template_version_fkey;
alter table public.contributor_tasks
  add constraint contributor_tasks_template_version_fkey
  foreign key (template_id, template_version) references public.assignment_templates(id, version);

create table if not exists public.contributor_task_submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.contributor_tasks(id) on delete cascade,
  revision integer not null,
  template_id text not null,
  template_version integer not null,
  snapshot jsonb not null,
  submitted_at timestamptz not null default now(),
  unique (task_id, revision),
  foreign key (template_id, template_version) references public.assignment_templates(id, version)
);

create table if not exists public.contributor_task_reviews (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.contributor_tasks(id) on delete cascade,
  submission_id uuid not null references public.contributor_task_submissions(id) on delete cascade,
  admin_user_id uuid not null references auth.users(id),
  decision text not null check (decision in ('Approved', 'Changes Requested')),
  message text,
  created_at timestamptz not null default now(),
  check ((decision = 'Approved' and message is null) or (decision = 'Changes Requested' and length(trim(message)) > 0))
);

create index if not exists contributor_tasks_user_created_idx
  on public.contributor_tasks (user_id, created_at desc);
create index if not exists contributor_tasks_status_activity_idx
  on public.contributor_tasks (status, last_activity_at desc);
create index if not exists contributor_task_submissions_task_revision_idx
  on public.contributor_task_submissions (task_id, revision desc);

create or replace function public.prevent_immutable_task_history_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Submitted task history is immutable';
end;
$$;
revoke all on function public.prevent_immutable_task_history_change() from public;
drop trigger if exists assignment_templates_immutable on public.assignment_templates;
create trigger assignment_templates_immutable
  before update or delete on public.assignment_templates
  for each row execute function public.prevent_immutable_task_history_change();
drop trigger if exists contributor_task_submissions_immutable on public.contributor_task_submissions;
create trigger contributor_task_submissions_immutable
  before update on public.contributor_task_submissions
  for each row execute function public.prevent_immutable_task_history_change();
drop trigger if exists contributor_task_reviews_immutable on public.contributor_task_reviews;
create trigger contributor_task_reviews_immutable
  before update on public.contributor_task_reviews
  for each row execute function public.prevent_immutable_task_history_change();

alter table public.assignment_templates enable row level security;
alter table public.contributor_tasks enable row level security;
alter table public.contributor_task_submissions enable row level security;
alter table public.contributor_task_reviews enable row level security;
revoke all on public.assignment_templates from anon, authenticated;
revoke insert, update, delete on public.contributor_tasks from anon, authenticated;
revoke all on public.contributor_task_submissions from anon, authenticated;
revoke all on public.contributor_task_reviews from anon, authenticated;
drop policy if exists "Contributors can view their own tasks" on public.contributor_tasks;
create policy "Contributors can view their own tasks"
  on public.contributor_tasks for select to authenticated
  using (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assignment-evidence', 'assignment-evidence', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "Contributors can view own task evidence" on storage.objects;
create policy "Contributors can view own task evidence"
  on storage.objects for select to authenticated
  using (bucket_id = 'assignment-evidence' and exists (
    select 1 from public.contributor_tasks task
    where task.id::text = (storage.foldername(name))[1] and task.user_id = auth.uid()
  ));
drop policy if exists "Contributors can upload task evidence while editing" on storage.objects;
create policy "Contributors can upload task evidence while editing"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'assignment-evidence' and exists (
    select 1 from public.contributor_tasks task
    where task.id::text = (storage.foldername(name))[1] and task.user_id = auth.uid()
      and task.status in ('Accepted', 'In Progress', 'Changes Requested', 'Started')
  ));
create or replace function public.task_evidence_is_submitted(p_path text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.contributor_task_submissions submission
    join public.contributor_tasks task on task.id = submission.task_id
    where task.user_id = auth.uid()
      and task.id::text = (storage.foldername(p_path))[1]
      and jsonb_path_exists(
        submission.snapshot,
        '$.draft.*.evidence[*].filePath ? (@ == $path)'::jsonpath,
        jsonb_build_object('path', p_path)
      )
  );
$$;
revoke all on function public.task_evidence_is_submitted(text) from public;
grant execute on function public.task_evidence_is_submitted(text) to authenticated;

drop policy if exists "Contributors can remove own task evidence while editing" on storage.objects;
create policy "Contributors can remove own task evidence while editing"
  on storage.objects for delete to authenticated
  using (bucket_id = 'assignment-evidence' and exists (
    select 1 from public.contributor_tasks task
    where task.id::text = (storage.foldername(name))[1] and task.user_id = auth.uid()
      and task.status in ('Accepted', 'In Progress', 'Changes Requested', 'Started')
      and not public.task_evidence_is_submitted(name)
  ));

create or replace function public.submit_contributor_task(p_task_id uuid, p_user_id uuid, p_snapshot jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.contributor_tasks%rowtype;
  next_revision integer;
  submission_id uuid;
begin
  select * into task_row from public.contributor_tasks
  where id = p_task_id and user_id = p_user_id for update;
  if not found then raise exception 'Task not found'; end if;
  if task_row.status not in ('Accepted', 'In Progress', 'Changes Requested', 'Started') then
    raise exception 'Task is not editable';
  end if;
  if task_row.template_id is null or task_row.template_version is null then
    raise exception 'Task template is missing';
  end if;
  select coalesce(max(revision), 0) + 1 into next_revision
  from public.contributor_task_submissions where task_id = p_task_id;
  insert into public.contributor_task_submissions (task_id, revision, template_id, template_version, snapshot)
  values (p_task_id, next_revision, task_row.template_id, task_row.template_version, p_snapshot)
  returning id into submission_id;
  update public.contributor_tasks
  set status = 'Submitted', submitted_at = now(), last_activity_at = now(), change_request = null, progress = 100
  where id = p_task_id;
  return submission_id;
end;
$$;

create or replace function public.review_contributor_task(p_task_id uuid, p_admin_id uuid, p_decision text, p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.contributor_tasks%rowtype;
  latest_submission_id uuid;
begin
  if p_decision not in ('Approved', 'Changes Requested') then raise exception 'Invalid review decision'; end if;
  if p_decision = 'Changes Requested' and length(trim(coalesce(p_message, ''))) = 0 then
    raise exception 'A reason is required';
  end if;
  select * into task_row from public.contributor_tasks where id = p_task_id for update;
  if not found or task_row.status not in ('Submitted', 'Under Review') then
    raise exception 'Task is not awaiting review';
  end if;
  select id into latest_submission_id from public.contributor_task_submissions
  where task_id = p_task_id order by revision desc limit 1;
  if latest_submission_id is null then raise exception 'Submission not found'; end if;
  insert into public.contributor_task_reviews (task_id, submission_id, admin_user_id, decision, message)
  values (p_task_id, latest_submission_id, p_admin_id, p_decision, case when p_decision = 'Approved' then null else trim(p_message) end);
  update public.contributor_tasks
  set status = case when p_decision = 'Approved' then 'Completed' else 'Changes Requested' end,
      reviewed_at = now(), last_activity_at = now(),
      change_request = case when p_decision = 'Approved' then null else trim(p_message) end,
      progress = case when p_decision = 'Approved' then 100 else progress end
  where id = p_task_id;
end;
$$;
revoke all on function public.prevent_immutable_task_history_change() from public, anon, authenticated;
revoke all on function public.submit_contributor_task(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.review_contributor_task(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.submit_contributor_task(uuid, uuid, jsonb) to service_role;
grant execute on function public.review_contributor_task(uuid, uuid, text, text) to service_role;

comment on table public.assignment_templates is 'Immutable versioned assignment template definitions; accessed through authenticated server APIs.';
comment on table public.contributor_task_submissions is 'Immutable submitted snapshots, one row per task revision.';
comment on table public.contributor_task_reviews is 'Administrator review decisions for immutable task submissions.';
