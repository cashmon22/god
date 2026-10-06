alter table public.interview_submissions
  drop constraint if exists interview_submissions_user_id_key;

create index if not exists interview_submissions_user_submitted_at_idx
  on public.interview_submissions (user_id, submitted_at desc);

create unique index if not exists interview_submissions_one_active_attempt_idx
  on public.interview_submissions (user_id)
  where submitted_at is null and session_expired_at is null;

create or replace function public.start_interview_question(p_session_id uuid, p_user_id uuid, p_question_index integer)
returns setof public.interview_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt public.interview_submissions;
  started_at timestamptz;
begin
  select * into attempt
  from public.interview_submissions
  where id = p_session_id
    and user_id = p_user_id
    and submitted_at is null
    and session_expired_at is null
  for update;

  if not found or attempt.current_question_index is distinct from p_question_index then
    return;
  end if;

  if jsonb_array_length(attempt.question_start_times) > p_question_index then
    return next attempt;
    return;
  end if;

  started_at := clock_timestamp();
  update public.interview_submissions
  set question_start_times = jsonb_set(question_start_times, array[p_question_index::text], to_jsonb(started_at), true)
  where id = p_session_id
  returning * into attempt;

  return next attempt;
end;
$$;

revoke all on function public.start_interview_question(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.start_interview_question(uuid, uuid, integer) to service_role;
