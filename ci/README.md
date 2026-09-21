# CI

`ci.yml` is the GitHub Actions workflow for this repository. It lives here
rather than at `.github/workflows/ci.yml` because the GitHub App that pushes
this branch does not have the `workflows` permission — GitHub refuses any push
that creates or edits a file under `.github/workflows/`.

## Install it

```bash
mkdir -p .github/workflows && cp ci/ci.yml .github/workflows/ci.yml
git add .github/workflows/ci.yml && git commit -m "Add CI" && git push
```

Run that from a machine authenticated as you rather than as an app, or grant
the App the `workflows` permission and move the file back.

## What it does

Runs on a real `postgres:18` service container, because the tests that matter
here — postback idempotency, the unlock race, generated columns, schema
constraints — are tests of database behaviour, and an in-memory stand-in cannot
have the bugs they exist to catch. A CI that ran them against a fake would be
green and worthless.

It also boots the app and curls `/healthz`, `/readyz`, `/` and `/s/alice`, then
sends SIGTERM and waits. That step catches the class of failure where every test
passes and the server does not start.
