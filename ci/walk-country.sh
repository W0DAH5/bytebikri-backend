#!/usr/bin/env bash
# Walk the country round against a RUNNING server, end to end.
#
# Written against the routes as they exist, which is the point: an earlier version
# of this walk posted to route names that had been renamed, so every step answered
# "Channel not found" and proved nothing while looking like it had. Every step
# prints what it got — a status, or PRESENT/ABSENT for a sentence — rather than
# printing silence, which reads as a pass and is not one.
#
#   cd app && node ../ci/demo-state.mjs     # the starting state
#   bash ci/walk-country.sh                 # server up on :3000
#
# Two writes set the same thing from two directions (a file's country rule, or the
# same rule applied to the whole store) and the creator has their own route, so the
# walk exercises the split rather than only the happy path.
set -u
B=http://127.0.0.1:3000
APP=/home/user/bytebikri-backend/app
PG=postgres://postgres:postgres@127.0.0.1:55432/bytebikri
# The two demo files are looked up by slot, not by id.
#
# They used to be hardcoded UUIDs, which worked exactly until the workspace was
# rebuilt: the database is recreated and reseeded, the ids change, and every step
# that used one answered "?error=file" or a 404 — looking, step by step, like the
# feature had broken rather than like the script had gone stale. A walk that only
# runs against one database is not a walk.
sql() { (cd "$APP" && node -e "
import('pg').then(async ({default: pg})=>{
  const c = new pg.Client({connectionString:'$PG'});
  await c.connect();
  const r = await c.query(process.argv[1], process.argv.slice(2));
  console.log(r.rows[0] ? Object.values(r.rows[0])[0] : '');
  await c.end();
})" "$@"); }
ADV=$(sql 'select a.id from assets a join channels c on c.id = a.channel_id where c.slug = $1 and a.slug = $2' alice poster-kit-walkthrough)
ART=$(sql 'select a.id from assets a join channels c on c.id = a.channel_id where c.slug = $1 and a.slug = $2' alice free-sample-pack)
if [ -z "$ADV" ] || [ -z "$ART" ]; then
  echo "The two demo files are missing. Seed the demo state first:"
  echo "  cd app && node ../ci/demo-state.mjs   (and run the app once so it seeds)"
  exit 1
fi
hdr() { printf '\n\033[1m%s\033[0m\n' "$1"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
# A grep printed as PRESENT/absent, so "no output" is never mistaken for a problem
# that did not happen.
has() { local f=$1 p=$2; if grep -q "$p" "$f"; then echo "PRESENT"; else echo "ABSENT"; fi; }


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

hdr "0. sign in"
signin /tmp/op.txt operator@bytebikri.local operator
signin /tmp/alice.txt alice@bytebikri.local alice
signin /tmp/bob.txt bob@bytebikri.local bob
echo "  operator $(code -b /tmp/op.txt "$B/admin") / alice $(code -b /tmp/alice.txt "$B/dashboard/alice") / bob $(code -b /tmp/bob.txt "$B/")"
# bob is the visitor who is not the owner: the person a country rule applies to.

hdr "1. the operator withholds a whole store in India, from a file's own page"
echo "  operator -> $(curl -s -b /tmp/op.txt -o /dev/null -w '%{redirect_url}' -X POST "$B/admin/moderation/files/$ART/country" --data 'countryCode=IN&state=blocked&ruleCode=gambling-in&note=Promotes%20a%20betting%20service.&wholeStore=1')"
curl -s -H 'CF-IPCountry: IN' -D /tmp/a.h -o /tmp/a.html "$B/s/alice"
echo "  storefront (IN): $(tr -d '\r' < /tmp/a.h | grep -iE '^HTTP|^cache-control|^vary' | paste -sd' ' -)"
echo "  the sentence: $(has /tmp/a.html 'Not available in India') / no-store: $(has /tmp/a.h 'no-store')"
echo "  storefront (NP): $(code -H 'CF-IPCountry: NP' "$B/s/alice") / owner sees it (IN): $(code -b /tmp/alice.txt -H 'CF-IPCountry: IN' "$B/s/alice")"
echo "  unknown country fails open: $(code -H 'CF-IPCountry: XX' "$B/s/alice")"
echo "  app JSON (IN): $(code -H 'CF-IPCountry: IN' "$B/api/stores/alice") $(curl -s -H 'CF-IPCountry: IN' "$B/api/stores/alice" | head -c 110)"

hdr "2. Explore and the home page, per country"
echo "  home: IN=$(curl -s -H 'CF-IPCountry: IN' "$B/" | grep -c 'href="/s/alice"') NP=$(curl -s -H 'CF-IPCountry: NP' "$B/" | grep -c 'href="/s/alice"')"
echo "  marketplace: IN=$(curl -s -H 'CF-IPCountry: IN' "$B/marketplace" | grep -c 'href="/s/alice"') NP=$(curl -s -H 'CF-IPCountry: NP' "$B/marketplace" | grep -c 'href="/s/alice"')"

hdr "3. a file of her own, withheld from Nepal, by the creator"
echo "  alice sets NP=restricted -> $(curl -s -b /tmp/alice.txt -o /dev/null -w '%{redirect_url}' -X POST "$B/dashboard/alice/assets/$ADV/country" --data 'countryCode=NP&state=restricted&note=Licensed%20for%20Nepal%20only.')"
echo "  file page (NP): $(code -H 'CF-IPCountry: NP' "$B/s/alice/a/poster-kit-walkthrough") (listed, refused at the unlock)"
curl -s -H 'CF-IPCountry: NP' -o /tmp/np.html "$B/s/alice/a/poster-kit-walkthrough"
echo "  the copy: $(has /tmp/np.html 'Listed, but not unlockable') / her private note stays off the public page: $(grep -c 'Licensed for Nepal only' /tmp/np.html) mentions"
echo "  unlock (NP): $(curl -s -H 'CF-IPCountry: NP' -b /tmp/bob.txt -X POST "$B/api/unlock/start" -H 'content-type: application/json' -d "{\"assetId\":\"$ADV\"}" | head -c 110)"
echo "  bytes (NP): $(curl -s -H 'CF-IPCountry: NP' -b /tmp/bob.txt "$B/api/content/$ADV" | head -c 110)"

hdr "4. the creator cannot say 'allowed', and cannot clear the operator's rule"
echo "  alice tries allowed -> $(curl -s -b /tmp/alice.txt -o /dev/null -w '%{redirect_url}' -X POST "$B/dashboard/alice/assets/$ADV/country" --data 'countryCode=NP&state=allowed')"
echo "  operator sets IN=blocked on that file -> $(curl -s -b /tmp/op.txt -o /dev/null -w '%{redirect_url}' -X POST "$B/admin/moderation/files/$ADV/country" --data 'countryCode=IN&state=blocked&ruleCode=adult-in&note=Platform%20decision.')"
echo "  alice tries to clear it -> $(curl -s -b /tmp/alice.txt -o /dev/null -w '%{redirect_url}' -X POST "$B/dashboard/alice/assets/$ADV/country" --data 'countryCode=IN&clear=1')"
echo "  alice clears her own NP -> $(curl -s -b /tmp/alice.txt -o /dev/null -w '%{redirect_url}' -X POST "$B/dashboard/alice/assets/$ADV/country" --data 'countryCode=NP&clear=1')"
echo "  the operator's IN rule survived: $(curl -s -b /tmp/op.txt "$B/admin/moderation" | grep -o 'IN blocked' | sort -u | paste -sd' ' -)"

hdr "5. the carve-out: one file allowed back into a blocked country"
echo "  operator -> $(curl -s -b /tmp/op.txt -o /dev/null -w '%{redirect_url}' -X POST "$B/admin/moderation/files/$ART/country" --data 'countryCode=IN&state=allowed')"
echo "  that file (IN): $(code -H 'CF-IPCountry: IN' "$B/s/alice/a/free-sample-pack") / store still blocked: $(code -H 'CF-IPCountry: IN' "$B/s/alice")"
curl -s -H 'CF-IPCountry: IN' -o /tmp/carve.html "$B/s/alice/a/free-sample-pack"
echo "  the page says so: $(has /tmp/carve.html 'This store is withheld where you are')"
echo "  a sibling inherits the store rule (IN): $(code -H 'CF-IPCountry: IN' "$B/s/alice/a/devanagari-poster-kit")"

hdr "6. the operator's console, and the operator's file page"
curl -s -b /tmp/op.txt "$B/admin/moderation" -o /tmp/mod.html
echo "  moderation: $(code -b /tmp/op.txt "$B/admin/moderation") / row chips: $(grep -o 'IN blocked\|IN allowed\|IN restricted\|NP blocked\|NP restricted' /tmp/mod.html | sort -u | paste -sd' | ' -)"
curl -s -b /tmp/op.txt "$B/admin/moderation/files/$ART" -o /tmp/of.html
echo "  file page: $(code -b /tmp/op.txt "$B/admin/moderation/files/$ART") / the carve-out is visible: $(has /tmp/of.html 'Allowed')"

hdr "7. lift the store block, confirm the world is back"
echo "  the store block lifted -> $(curl -s -b /tmp/op.txt -o /dev/null -w '%{redirect_url}' -X POST "$B/admin/moderation/alice/country" --data 'countryCode=IN&clear=1')"
echo "  store (IN): $(code -H 'CF-IPCountry: IN' "$B/s/alice") / home mentions: $(curl -s -H 'CF-IPCountry: IN' "$B/" | grep -c 'href="/s/alice"')"
echo "  chips left: $(curl -s -b /tmp/op.txt "$B/admin/moderation" | grep -o 'IN blocked\|IN allowed\|IN restricted\|NP blocked\|NP restricted' | sort -u | paste -sd' | ' -)"
echo
# The store-wide block is lifted, but the walk's own file-level rules are still
# there — which is why this says what to run rather than claiming a clean slate.
echo "  this walk leaves two file-level rules behind (IN blocked, IN allowed)."
echo "  to reset to the demo state:  cd app && node ../ci/demo-state.mjs"
