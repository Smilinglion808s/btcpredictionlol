-- OPERATOR ACTION: enables P2 sizing for NEW receipts in the existing live bot.
-- Normal 4/5/10 becomes 8/10/20 only when the exact P2 condition qualifies.
-- Fewer than five known outcomes continues at normal sizing.
update public.v12_p2_config set mode='on' where id=1;
select id,mode,enabled_at from public.v12_p2_config where id=1;
