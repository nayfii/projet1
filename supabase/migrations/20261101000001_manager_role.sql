-- Step 12: the Manager role (CLAUDE.md §11). On its own: a new enum value can only be used once committed.
alter type public.company_role add value if not exists 'manager';
