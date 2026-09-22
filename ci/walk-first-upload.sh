#!/usr/bin/env bash
# Walk the review-queue round: a NEW store, its first upload, and what every
# surface does with it.
#
# This is the round's whole rule in one run — a file nobody has looked at is live
# at its link and in its own shop, and is NOT a search result until a person
# approves it. The interesting assertions are the absences, so they are counted
# against the file's own link rather than against a title string: the search box
# echoes the query back, and counting that once made a broken step look like a pass.
#
#   bash ci/walk-first-upload.sh            # server up on :3000
#
# It creates a store, approves, and removes — so it needs the development database,
# never production. The store it leaves behind is renamed at the end rather than
# deleted: the next reader can see what the walk produced.
set -u
B=http://127.0.0.1:3000
TAG=$(date +%s)
EMAIL="newstore-$TAG@bytebikri.local"
APP=/home/user/bytebikri-backend/app
PG=postgres://postgres:postgres@127.0.0.1:55432/bytebikri
hdr() { printf '\n\033[1m%s\033[0m\n' "$1"; }
say() { printf '  %-42s %s\n' "$1" "$2"; }
# One value out of the development database, by slug and title rather than by
# scraping HTML: the slug is derived server-side and a store's own dashboard has no
# index page to read it from.
sql() { (cd "$APP" && node -e "
import('pg').then(async ({default: pg})=>{
  const c = new pg.Client({connectionString:'$PG'});
  await c.connect();
  const r = await c.query(process.argv[1], [process.argv[2]]);
  console.log(r.rows[0] ? Object.values(r.rows[0])[0] : '');
  await c.end();
})" "$1" "$2"); }


# Sign in only when the existing session is dead.
#
# Two lessons are folded in here, both learned by a walk that looked like the
# feature was broken. The jars live in /tmp, which is wiped with the workspace, so
# a walk cannot assume a session exists. And sign-in is rate limited — six attempts
# an hour per address — so a walk that logs in on every run starts answering 429,
# and a 429 produces no cookie, which makes every later step fail for a reason that
# has nothing to do with what it is testing. So: reuse the jar if it still works,
# log in if it does not, and stop with an explanation if the limiter is in the way.
signin() {
  local jar=$1 email=$2 who=$3
  if [ -s "$jar" ] && [ "$(code -b "$jar" "$B/dashboard/")" != "404" ]; then
    return 0
  fi
  local status
  status=$(curl -s -c "$jar" -o /dev/null -w '%{http_code}' -X POST "$B/login" \
    --data "email=$email&password=bytebikri-demo")
  if [ "$status" = "429" ]; then
    echo "  sign-in for $who is rate limited (429). The limiter is six an hour per"
    echo "  address, and this walk has been run several times. Wait, or restart the"
    echo "  server (the limit lives in memory), then run this again."
    exit 2
  fi
  if [ "$status" != "302" ] && [ "$status" != "200" ]; then
    echo "  sign-in for $who answered $status — is that account seeded?"
    exit 2
  fi
}

# The operator signs in first: the queue is the operator's view of all of this.
signin /tmp/op.txt operator@bytebikri.local operator

hdr "1. a new account and a new store, through the real sign-up form"
curl -s -c /tmp/new.txt -o /dev/null -X POST "$B/signup" \
  --data "email=$EMAIL&password=bytebikri-demo&display_name=New Seller&channel=First Store $TAG"
SLUG=$(sql "select c.slug from channels c join profiles p on p.id = c.owner_id where p.email = \$1" "$EMAIL")
say "store" "$SLUG"
# A file is only ever a search result if its STORE is in the marketplace — the
# query filters on it — so the walk opts the store in rather than testing a case
# that could never produce a hit.
sql "update channels set listing_mode = 'marketplace' where slug = \$1" "$SLUG" >/dev/null
say "listed in the marketplace" "yes (opted in for the walk)"

hdr "2. the first upload"
printf 'ByteBikri first upload demo file.\n' > /tmp/first.txt
curl -s -b /tmp/new.txt -o /dev/null -X POST "$B/dashboard/$SLUG/assets" \
  -F "title=My very first file" -F "description=Uploaded before anyone has looked at the store." \
  -F "media=@/tmp/first.txt;type=text/plain"
ASSET=$(sql "select a.id from assets a join channels ch on ch.id = a.channel_id where ch.slug = \$1 and a.title = 'My very first file'" "$SLUG")
say "asset id" "$ASSET"
say "its state (the rule decided)" "$(sql 'select moderation_state from assets where id = $1' "$ASSET")"

hdr "3. what the creator is told"
curl -s -b /tmp/new.txt "$B/dashboard/$SLUG/assets/$ASSET" -o /tmp/own.html
say "the notice" "$(grep -c 'Waiting for its first review' /tmp/own.html)"
say "the promise (link works, shop lists it)" "$(grep -c 'your store page lists it' /tmp/own.html)"
say "the schema word shown to them" "$(grep -c '>pending<' /tmp/own.html)"

hdr "4. what the world gets, and does not"
APATH="/s/$SLUG/a/$(sql 'select slug from assets where id = $1' "$ASSET")"
say "its own page (the link works)" "$(curl -s -o /dev/null -w '%{http_code}' "$B$APATH")"
say "the store page lists it" "$(curl -s "$B/s/$SLUG" | grep -c 'My very first file')"
# Counted by the file's own link in the results.
found() { curl -s "$B/marketplace?q=$1" | grep -c "/s/$SLUG/a/"; }
say "SEARCH returns it" "$(found 'My+very+first+file')"
say "operator queue, files" "$(curl -s -b /tmp/op.txt "$B/admin" | grep -o 'Files needing a decision' | wc -l)"

hdr "5. a person looks at it"
say "the queue shows it" "$(curl -s -b /tmp/op.txt "$B/admin/moderation" | grep -c 'My very first file')"
say "the file page says why search waits" "$(curl -s -b /tmp/op.txt "$B/admin/moderation/files/$ASSET" | grep -c 'NOT in search')"
curl -s -b /tmp/op.txt -o /dev/null -X POST "$B/admin/moderation/files/$ASSET" --data 'action=approve'
say "approved ->" "$(sql 'select moderation_state from assets where id = $1' "$ASSET")"

hdr "6. and now it is findable"
say "SEARCH returns it" "$(found 'My+very+first+file')"
say "its page still works" "$(curl -s -o /dev/null -w '%{http_code}' "$B$APATH")"

hdr "7. the next file from the same store does not wait"
printf 'Second file.\n' > /tmp/second.txt
curl -s -b /tmp/new.txt -o /dev/null -X POST "$B/dashboard/$SLUG/assets" \
  -F "title=Second file, same store" -F "description=After a person approved the first." \
  -F "media=@/tmp/second.txt;type=text/plain"
say "SEARCH returns the second one" "$(curl -s "$B/marketplace?q=Second+file,+same+store" | grep -c "/s/$SLUG/a/")"

hdr "8. a removed file leaves search as well"
curl -s -b /tmp/op.txt -o /dev/null -X POST "$B/admin/moderation/files/$ASSET" \
  --data 'action=remove&ruleCode=copyright&remedy=Removed for the walkthrough.'
say "SEARCH returns it" "$(found 'My+very+first+file')"
say "its page for a stranger" "$(curl -s -o /dev/null -w '%{http_code}' "$B$APATH")"
say "its page for its owner" "$(curl -s -b /tmp/new.txt -o /dev/null -w '%{http_code}' "$B$APATH")"
echo
echo "  left behind: store $SLUG with a removed file and a second one —"
echo "  run  cd app && node ../ci/demo-state.mjs  to put the demo state back"
