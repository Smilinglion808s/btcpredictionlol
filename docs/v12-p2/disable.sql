-- OPERATOR ACTION: return NEW receipts to baseline sizing.
-- Already admitted/in-flight orders retain their original frozen budgets.
update public.v12_p2_config set mode='off' where id=1;
select id,mode,enabled_at from public.v12_p2_config where id=1;
