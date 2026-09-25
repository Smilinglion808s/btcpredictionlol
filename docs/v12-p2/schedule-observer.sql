-- Operator-run after deploying observer.js as v12-p2-observer with JWT verification ON.
-- First use Supabase Vault's UI to store this receiver project's service_role JWT
-- under the name p2_observer_service_role. Never paste the value into repository files.
-- This job observes outcomes only; it does not place orders or enable P2.
do $$
begin
  if not exists(select 1 from vault.secrets where name='p2_observer_service_role') then
    raise exception 'P2_OBSERVER_VAULT_SECRET_REQUIRED';
  end if;
end; $$;
select cron.schedule('v12-p2-outcome-observer','* * * * *',$job$
  select net.http_post(
    url:='https://ruxndqfjfdbtdbkheuge.supabase.co/functions/v1/v12-p2-observer',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='p2_observer_service_role')),
    body:='{}'::jsonb,
    timeout_milliseconds:=120000
  );
$job$);
