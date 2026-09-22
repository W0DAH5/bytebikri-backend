-- 0024: country rules get an author, and the rule table gets its country rows.
--
-- `asset_country_rules`, `content_geo_blocks` and `policy_rules.scope='country'`
-- have existed since 0001 and were read by nobody: an asset was visible in every
-- country, always, and a file could not be absent anywhere. This migration adds
-- the three things the read path cannot infer, and nothing else.
--
--   source   who decided. A creator limiting their own file to the countries
--            they hold a licence for, and an operator citing a policy rule, are
--            the same row shape and a different sentence to the visitor. Reading
--            that difference out of `reason` would be a convention one commit
--            away from being wrong.
--   set_by   the person, so an unattributable block cannot exist.
--   updated_at  because a country rule can be revised, and "when did this
--            change" is the first question a seller asks.
--
-- The two seeded rules are the country-scoped branch of `policy_rules` — a
-- reason an operator can cite, not a crawler. Nothing here applies itself to
-- anything: a country rule reaches a file because a person decided it should.
-- Country codes are ISO-3166 alpha-2.

alter table asset_country_rules
  add column if not exists source     text not null default 'operator'
                                      check (source in ('operator','creator')),
  add column if not exists set_by     uuid references profiles(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

-- The read path asks "what did anyone decide about this asset", the queue asks
-- "which countries have rules at all", and the operator page asks both.
create index if not exists idx_country_rules_country on asset_country_rules(country_code, state);
create index if not exists idx_geo_blocks_country   on content_geo_blocks(country_code, subject_type);

-- Each description states the LAW and nothing about our response to it.
--
-- The response is the operator's decision and the page renders it separately
-- ("under the platform rule ..."). A description that also described the response
-- is wrong the moment the same rule is applied as a restriction instead of a
-- block — the visitor then reads "a file of that kind is listed but cannot be
-- unlocked" underneath a sentence saying the file is not shown at all. Seen on a
-- phone, not in a diff: the assertion is made about the law, so the law is all it
-- says.
insert into policy_rules (code, title, description, scope, country_code, default_state, severity)
values
  ('gambling-in', 'Gambling promotion in India',
   'India restricts the promotion of betting and gambling services.',
   'country', 'IN', 'blocked', 3),
  ('adult-in', 'Adult content in India',
   'India restricts the distribution of sexually explicit material.',
   'country', 'IN', 'blocked', 3),
  ('adult-np', 'Adult content in Nepal',
   'Nepal restricts the publication of sexually explicit material.',
   'country', 'NP', 'restricted', 2)
on conflict (code) do nothing;
