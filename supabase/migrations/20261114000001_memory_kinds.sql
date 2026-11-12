-- Two more kinds of memory (V1.1): a team's own memory and a project's memory. Added in a file of their
-- own: Postgres lets a new enum value be used only once the transaction that added it is committed.
alter type public.memory_kind add value if not exists 'team';
alter type public.memory_kind add value if not exists 'project';
