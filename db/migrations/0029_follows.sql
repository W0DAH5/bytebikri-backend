-- 0029 — the buyer's shelf: what they unlocked, and the stores they watch.
--
-- Two gaps, one page. The audit has listed "Following a store: absent" since it
-- was written, and the other gap is older and more embarrassing: the product has
-- unlocks and no library.
--
-- An unlock here is a WINDOW, not a purchase — the default is 24 hours
-- (`asset_unlock_policy.unlock_hours`, 0 meaning permanent) and it is paid for by
-- an ad the buyer watched, not by the buyer. Which means the thing a buyer most
-- needs is the page that says what is open right now and how long is left on it.
-- Without it, the file somebody unlocked this morning is gone by tonight unless
-- they kept the tab open. Hoopla and Kanopy solved exactly this problem with a
-- "borrowed" shelf that counts a lending period down and lets the reader borrow
-- again; that is the shape of this page.
--
-- `follows` is deliberately small. Notifications are delegated in this product's
-- model (nobody here sends mail), so a follow cannot promise to tell anybody
-- anything. What it can do is keep a store on the shelf and answer one honest
-- question: what is new since I last looked? That question needs a `seen_at`, and
-- `seen_at` is the ONLY mutable field in this table — it moves when the buyer opens
-- the store's page, and the count of new files is derived from it at read time.
--
-- The Substack documentation is the warning on this point: their own help centre
-- has to keep explaining that a follower "won't get posts in their inbox", because
-- the word follow implies a promise the product does not make. So this schema
-- stores no notification preference at all — there is nothing to send, and the
-- page says so rather than growing a switch that would be a lie.
--
-- What is deliberately absent: no follower counts on the store page (a seller
-- count that only a seller can see is a vanity metric, and a public one changes
-- who publishes what), no "follower" badge, no per-follow email digest table
-- waiting to be wired, and no soft-delete — unfollowing is a delete, and
-- re-following starts the clock again, which is what a person means by it.

create table if not exists follows (
  profile_id uuid not null references profiles(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,

  created_at timestamptz not null default now(),

  -- When this buyer last opened the store's page. Seeded to the follow time, so a
  -- store followed today has nothing "new" in it yet — the alternative (seeding to
  -- the epoch) would announce every file a store ever published as unread news.
  seen_at    timestamptz not null default now(),

  primary key (profile_id, channel_id)
);

-- The library asks "which stores does this person follow" on every render, newest
-- first; the store page asks "does this person follow me" once, which the primary
-- key already answers.
create index if not exists idx_follows_profile
  on follows(profile_id, created_at desc);

-- The seller's own page may one day ask "how many people watch this store", which
-- is a count, not a list of names. The index makes that cheap; nothing in the
-- current UI reads it, and no follower identity is exposed anywhere.
create index if not exists idx_follows_channel
  on follows(channel_id);

comment on table follows is
  'One row per (buyer, store) pair: the shelf of stores a person watches. Holds no '
  'notification state, because this product sends none — the library page is where '
  'new files surface, and it says so.';
comment on column follows.seen_at is
  'When the buyer last opened the store page. "New since you last looked" is derived '
  'from this at read time rather than stored as a counter that could drift.';
