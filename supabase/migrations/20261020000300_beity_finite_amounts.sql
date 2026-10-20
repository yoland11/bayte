-- PostgreSQL numeric NaN compares greater than zero, so amount > 0 alone
-- does not guarantee a usable financial value. Validate without rewriting amounts.
begin;
alter table public.transactions add constraint beity_transactions_finite_amount
check(amount <> 'NaN'::numeric);
commit;
