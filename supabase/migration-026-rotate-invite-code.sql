-- The original fixed invite code appeared in migration history and must be treated
-- as public. Rotate it once to a server-generated high-entropy value. Active members
-- continue to obtain the current value through get_invite_code(); it never enters the
-- frontend bundle or this repository.

do $$
begin
  if not exists (
    select 1
    from public.app_settings
    where key = 'migration_026_invite_code_rotated'
  ) then
    update public.app_settings
    set value = encode(extensions.gen_random_bytes(24), 'hex'),
        updated_at = now()
    where key = 'invite_code';

    if not found then
      raise exception 'invite_code setting is missing';
    end if;

    insert into public.app_settings (key, value)
    values ('migration_026_invite_code_rotated', 'applied');
  end if;
end;
$$;
