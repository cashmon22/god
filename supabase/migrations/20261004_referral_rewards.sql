create or replace function public.qualify_contributor_referral(
  target_referred_user_id uuid,
  target_referrer_user_id uuid,
  qualification_status text,
  acting_admin_id uuid
)
returns public.balance_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  referral public.contributor_referrals%rowtype;
  current_balance numeric(10, 2);
  transaction_record public.balance_transactions%rowtype;
begin
  if qualification_status not in ('Pending', 'Successful', 'Rejected') then
    raise exception 'Invalid referral status: %', qualification_status;
  end if;
  if acting_admin_id is null then
    raise exception 'An administrator is required to qualify a referral';
  end if;
  if target_referrer_user_id is not null and target_referrer_user_id = target_referred_user_id then
    raise exception 'Self-referrals are not allowed';
  end if;

  if target_referrer_user_id is not null then
    insert into public.contributor_referrals (referrer_user_id, referred_user_id, status)
    values (target_referrer_user_id, target_referred_user_id, 'Pending')
    on conflict (referred_user_id) do nothing;
  end if;

  select * into referral
  from public.contributor_referrals
  where referred_user_id = target_referred_user_id
  for update;

  if not found then
    return null;
  end if;
  if target_referrer_user_id is not null and referral.referrer_user_id <> target_referrer_user_id then
    raise exception 'The referred user is already attributed to a different contributor';
  end if;

  update public.contributor_referrals
  set status = qualification_status
  where id = referral.id;

  if qualification_status <> 'Successful' then
    return null;
  end if;

  if referral.reward_transaction_id is not null then
    select * into transaction_record
    from public.balance_transactions
    where id = referral.reward_transaction_id;
    return transaction_record;
  end if;

  insert into public.contributor_earnings (user_id)
  values (referral.referrer_user_id)
  on conflict (user_id) do nothing;

  select available_balance into current_balance
  from public.contributor_earnings
  where user_id = referral.referrer_user_id
  for update;

  update public.contributor_earnings
  set available_balance = current_balance + 20.00,
      updated_at = now()
  where user_id = referral.referrer_user_id;

  insert into public.balance_transactions (
    user_id,
    amount,
    type,
    previous_balance,
    new_balance,
    admin_id,
    admin_note
  )
  values (
    referral.referrer_user_id,
    20.00,
    'Added',
    current_balance,
    current_balance + 20.00,
    acting_admin_id,
    format('Referral reward for referred user %s', target_referred_user_id)
  )
  returning * into transaction_record;

  update public.contributor_referrals
  set reward_transaction_id = transaction_record.id
  where id = referral.id;

  return transaction_record;
end;
$$;

revoke all on function public.qualify_contributor_referral(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.qualify_contributor_referral(uuid, uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
