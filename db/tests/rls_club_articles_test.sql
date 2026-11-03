-- pgTAP: editable club articles (#236, migrations 0111 and 0113).
-- Checks staff rights, author/editor attribution, audience isolation, drafts, unsafe URLs and history on unpublish.
begin;
create extension if not exists pgtap;
select plan(33);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c109', 'Club');
insert into users (id, telegram_id, display_name, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 9701, 'Admin', true),
  ('00000000-0000-0000-0000-0000000000b1', 9702, 'Coach One', false),
  ('00000000-0000-0000-0000-0000000000b2', 9703, 'Coach Two', false),
  ('00000000-0000-0000-0000-0000000000d1', 9704, 'Parent', false),
  ('00000000-0000-0000-0000-0000000000e1', 9705, 'Guest', false);
insert into groups (id, club_id, name) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000c109', 'U9');
insert into coach_groups (user_id, group_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000f1');
insert into players (id, club_id, group_id, full_name) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000c109', '00000000-0000-0000-0000-0000000000f1', 'Kid');
insert into player_guardians (player_id, user_id, consent_version, consent_given_at) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d1', 'test', now());

create or replace function as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select ok((select relrowsecurity from pg_class where oid = 'club_articles'::regclass), 'club_articles has RLS');

-- Administrator: create, publish, unpublish without losing the row.
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_article_save(null::uuid, 'Admin draft', 'Body', 'both', 'draft', 10, null, null, null)$$, 'admin creates a draft');
select is((select author_id from club_articles where title = 'Admin draft'), '00000000-0000-0000-0000-0000000000a1'::uuid, 'author is the admin account');
select is((select author_name from club_articles where title = 'Admin draft'), 'Admin', 'author name comes from the account');
select is((select editor_id from club_articles where title = 'Admin draft'), '00000000-0000-0000-0000-0000000000a1'::uuid, 'editor is the creator');
select lives_ok($$select club_article_save((select id from club_articles where title = 'Admin draft'), 'Admin draft', 'Body', 'both', 'published', 10, null, null, null)$$, 'admin publishes');
select isnt((select published_at from club_articles where title = 'Admin draft'), null::timestamptz, 'published_at is set');
select lives_ok($$select club_article_save((select id from club_articles where title = 'Admin draft'), 'Admin draft', 'Body', 'both', 'draft', 10, null, null, null)$$, 'admin unpublishes');
select is((select status from club_articles where title = 'Admin draft'), 'draft', 'unpublish changes status only');
select is((select body from club_articles where title = 'Admin draft'), 'Body', 'unpublish keeps the text');
select isnt((select published_at from club_articles where title = 'Admin draft'), null::timestamptz, 'unpublish keeps the publication date');

-- Coach: статьи не пишет и не публикует (0113).
select as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select club_article_save(null::uuid, 'Coach one', 'Text', 'parent', 'draft', 20, null, null, null)$$, '42501', 'forbidden', 'coach cannot create articles');
select throws_ok($$select club_article_save((select id from club_articles where title = 'Admin draft'), 'Hacked', 'Text', 'both', 'published', 1, null, null, null)$$, '42501', 'forbidden', 'coach cannot edit articles');
select is((select count(*)::int from club_articles where title = 'Admin draft'), 0, 'coach cannot read drafts');

-- Admin edits an article and is recorded as editor.
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_article_save((select id from club_articles where title = 'Admin draft'), 'Admin draft edited', 'Text', 'both', 'draft', 10, null, null, null)$$, 'admin edits an article');

-- Audience isolation.
select as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select club_article_save(null::uuid, 'Guest only', 'G', 'guest', 'published', 1, null, null, null)$$, 'admin creates guest-only article');
select lives_ok($$select club_article_save(null::uuid, 'Parent only', 'P', 'parent', 'published', 2, null, null, null)$$, 'admin creates parent-only article');
select lives_ok($$select club_article_save(null::uuid, 'Both', 'B', 'both', 'published', 3, null, null, null)$$, 'admin creates common article');
select lives_ok($$select club_article_save(null::uuid, 'Draft', 'D', 'both', 'draft', 4, null, null, null)$$, 'admin creates a draft');

select as_user('00000000-0000-0000-0000-0000000000e1');
select is((select count(*)::int from club_articles where title in ('Guest only', 'Both', 'Parent only')), 2, 'guest sees guest and common articles only');
select is((select count(*)::int from club_articles where title = 'Parent only'), 0, 'guest cannot read parent-only article');
select is((select count(*)::int from club_articles where title in ('Admin draft edited', 'Draft', 'Slug one')), 0, 'guest cannot read drafts');

select as_user('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from club_articles where title in ('Guest only', 'Both', 'Parent only')), 2, 'parent sees parent and common articles only');
select is((select count(*)::int from club_articles where title = 'Guest only'), 0, 'parent cannot read guest-only article');
select is((select count(*)::int from club_articles where title in ('Admin draft edited', 'Draft', 'Slug one')), 0, 'parent cannot read drafts');

-- Direct writes are closed even for authenticated users.
select as_user('00000000-0000-0000-0000-0000000000e1');
select throws_ok($$select club_article_save(null::uuid, 'Guest', 'x', 'both', 'draft', 1, null, null, null)$$, '42501', 'forbidden', 'guest cannot save articles');
select throws_ok($$insert into club_articles (club_id, title, body, audience, status, sort_order, author_name) values ('00000000-0000-0000-0000-00000000c109', 'Direct', 'x', 'both', 'draft', 1, 'Hacker')$$, '42501', null, 'direct insert is denied');
select throws_ok($$update club_articles set title = 'Hacked' where title = 'Both'$$, '42501', null, 'direct update is denied');

-- Validation and slug uniqueness.
select as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select club_article_save(null::uuid, 'Bad url', 'x', 'both', 'draft', 1, 'javascript:alert(1)', null, null)$$, '22023', 'bad url', 'non-http link is rejected');
select throws_ok($$select club_article_save(null::uuid, 'No body', '   ', 'both', 'published', 1, null, null, null)$$, '22023', 'bad article', 'published article needs text');
select lives_ok($$select club_article_save(null::uuid, 'Slug one', 'x', 'both', 'draft', 1, null, null, 'rules')$$, 'slug is saved for shared screens');
select throws_ok($$select club_article_save(null::uuid, 'Slug two', 'x', 'both', 'draft', 2, null, null, 'rules')$$, '23505', 'slug busy', 'duplicate slug is rejected');
select is((select count(*)::int from club_articles where title in ('Admin draft edited', 'Draft', 'Slug one')), 3, 'staff sees drafts');

select * from finish();
rollback;

