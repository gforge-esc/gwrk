#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

fail() {
  printf 'Hosted sign-in preflight: %s\n' "$1" >&2
  exit 1
}

[[ -s .env ]] || fail 'create .env from .env.example'
[[ $(grep -c '^GWRK_PROOF_ACME_EMAIL=' .env) -eq 1 &&
   $(grep -c '^GWRK_PROOF_GOOGLE_CLIENT_ID=' .env) -eq 1 ]] ||
  fail 'set each required .env value once'
grep -Eq '^GWRK_PROOF_ACME_EMAIL=[^[:space:]@]+@[^[:space:]@]+\.[A-Za-z]{2,}$' .env ||
  fail 'set a certificate contact email'
grep -Eq '^GWRK_PROOF_GOOGLE_CLIENT_ID=[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$' .env ||
  fail 'set the Google web client ID'
if grep -Eiq 'example\.invalid|=(replace|placeholder|changeme)' .env; then
  fail 'replace example values in .env'
fi

[[ -s local/google-client-secret ]] || fail 'provide local/google-client-secret'
[[ -s local/cookie-secret ]] || fail 'provide local/cookie-secret'
[[ -s local/allowed-emails ]] || fail 'provide a non-empty local/allowed-emails'
[[ $(wc -l <local/google-client-secret) -eq 0 ]] &&
  grep -Eq '^[A-Za-z0-9_-]{20,}$' local/google-client-secret ||
  fail 'provide a valid Google web client secret'
if grep -Eiq 'replace|placeholder|changeme' local/google-client-secret; then
  fail 'replace the example Google web client secret'
fi
[[ $(wc -c <local/cookie-secret) -eq 43 ]] &&
  grep -Eq '^[A-Za-z0-9_-]{43}$' local/cookie-secret ||
  fail 'generate a 32-byte base64url cookie secret without a newline'
if grep -Evq '^[A-Za-z0-9.!#$%&+_=-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$' local/allowed-emails; then
  fail 'use one explicit email address per line'
fi
if grep -Eiq '@example\.(invalid|com|org|net)$' local/allowed-emails; then
  fail 'replace example allowlist entries'
fi

unset GWRK_PROOF_ACME_EMAIL GWRK_PROOF_GOOGLE_CLIENT_ID
docker compose --env-file .env -f compose.yaml config --quiet
printf 'Hosted sign-in preflight passed\n'
