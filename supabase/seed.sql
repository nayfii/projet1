-- DEMO DATA for local development only. Never loaded in production.
-- A default plan so that self-serve sign-ups get credits. Values are placeholders the platform admin can change.
insert into public.plans (name, description, price_label, seat_limit, monthly_credits, video_credits, is_default)
values ('Démo / Demo', 'DEMO plan for local development', 'DEMO', 25, 100000, 2000, true);
