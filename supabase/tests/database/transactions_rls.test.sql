begin;
select plan(7);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'bayti-a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'bayti-b@example.test');

insert into public.transactions (id, user_id, project_id, type, amount, transaction_date, description)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', user_id, id, 'income', 1000000, '2026-10-01', 'اختبار المستخدم أ'
from public.projects where user_id = '11111111-1111-1111-1111-111111111111';

insert into public.transactions (id, user_id, project_id, type, amount, transaction_date, description)
select 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', user_id, id, 'expense', 250000, '2026-10-02', 'اختبار المستخدم ب'
from public.projects where user_id = '22222222-2222-2222-2222-222222222222';

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$select count(*) from public.transactions$$,
  array[1::bigint],
  'المستخدم أ يرى عملياته فقط'
);

select is_empty(
  $$select id from public.transactions where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  'المستخدم أ لا يقرأ عملية المستخدم ب'
);

select results_eq(
  $$insert into public.transactions (id, user_id, project_id, type, amount, transaction_date, description)
    select 'cccccccc-cccc-cccc-cccc-cccccccccccc', user_id, id, 'income', 42, '2026-10-03', 'قبض اختبار'
    from public.projects where user_id = '11111111-1111-1111-1111-111111111111'
    returning amount$$,
  array[42::numeric],
  'المستخدم أ ينشئ عملية في مشروعه'
);

select throws_ok(
  $$insert into public.transactions (id, user_id, project_id, type, amount, transaction_date, description)
    select 'dddddddd-dddd-dddd-dddd-dddddddddddd', user_id, id, 'income', 43, '2026-10-03', 'محاولة عابرة'
    from public.projects where user_id = '22222222-2222-2222-2222-222222222222'$$,
  '42501', null,
  'المستخدم أ لا ينشئ عملية باسم المستخدم ب'
);

select is_empty(
  $$update public.transactions set description = 'تعديل غير مسموح'
    where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' returning id$$,
  'المستخدم أ لا يعدل عملية المستخدم ب'
);

select is_empty(
  $$delete from public.transactions where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' returning id$$,
  'المستخدم أ لا يحذف عملية المستخدم ب'
);

set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select results_eq(
  $$select count(*) from public.transactions$$,
  array[1::bigint],
  'المستخدم ب يرى عملياته فقط'
);

select * from finish();
rollback;
