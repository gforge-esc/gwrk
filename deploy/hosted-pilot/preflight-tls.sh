#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C
umask 077

fail() {
  printf 'TLS preflight: %s (%s)\n' "$1" "$2" >&2
  exit 1
}

trap 'fail validation-failed tls' ERR
[[ "$(uname -s 2>/dev/null)" == Linux ]] || fail linux-required tls
[[ "$(id -u 2>/dev/null)" == 0 ]] || fail root-required tls
for command in openssl timeout stat awk date; do
  command -v "$command" >/dev/null 2>&1 || fail dependency-unavailable tls
done

# Fixed paths prevent request or project configuration from selecting trust material.
base=/etc/gwrk/gateway-secrets
directory="$base/tls"
certificate="$directory/fullchain.pem"
key="$directory/privkey.pem"
for ancestor in /etc /etc/gwrk; do
  [[ ! -L "$ancestor" ]] || fail symlink-denied "${ancestor##*/}"
done
for path in "$base" "$directory"; do
  name=${path##*/}
  [[ ! -L "$path" ]] || fail symlink-denied "$name"
  [[ -d "$path" ]] || fail directory-required "$name"
  [[ "$(stat -c '%u %a' -- "$path" 2>/dev/null)" == '0 700' ]] || fail directory-permissions "$name"
done
for path in "$certificate" "$key"; do
  name=${path##*/}
  [[ ! -L "$path" ]] || fail symlink-denied "$name"
  [[ -f "$path" ]] || fail regular-file-required "$name"
  [[ "$(stat -c '%u %a' -- "$path" 2>/dev/null)" == '0 600' ]] || fail file-permissions "$name"
done

# Finite inputs and per-process deadlines bound local parsing without network access.
[[ "$(stat -c '%s' -- "$certificate" 2>/dev/null)" -le 1048576 ]] || fail certificate-chain-invalid fullchain.pem
[[ "$(stat -c '%s' -- "$key" 2>/dev/null)" -le 65536 ]] || fail private-key-invalid privkey.pem
if ! timeout --kill-after=1s 5s awk '
  { sub(/\r$/, "") }
  /^-----BEGIN CERTIFICATE-----$/ { if (inside) exit 1; inside=1; count++; next }
  /^-----END CERTIFICATE-----$/ { if (!inside) exit 1; inside=0; next }
  inside { if ($0 !~ /^[A-Za-z0-9+\/=]+$/) exit 1; next }
  /^[[:space:]]*$/ { next }
  { exit 1 }
  END { if (inside || count == 0 || count > 16) exit 1 }
' "$certificate" >/dev/null 2>&1; then
  fail certificate-chain-invalid fullchain.pem
fi
if ! timeout --kill-after=1s 5s openssl crl2pkcs7 -nocrl -certfile "$certificate" -out /dev/null </dev/null >/dev/null 2>&1; then
  fail certificate-chain-invalid fullchain.pem
fi
if ! timeout --kill-after=1s 5s openssl pkey -in "$key" -passin pass: -check -noout </dev/null >/dev/null 2>&1; then
  fail private-key-invalid privkey.pem
fi

if ! certificate_public=$(
  timeout --kill-after=1s 5s openssl x509 -in "$certificate" -pubkey -noout </dev/null 2>/dev/null |
    timeout --kill-after=1s 5s openssl pkey -pubin -outform DER 2>/dev/null |
    timeout --kill-after=1s 5s openssl dgst -sha256 2>/dev/null
); then
  fail certificate-chain-invalid fullchain.pem
fi
if ! key_public=$(
  timeout --kill-after=1s 5s openssl pkey -in "$key" -passin pass: -pubout -outform DER </dev/null 2>/dev/null |
    timeout --kill-after=1s 5s openssl dgst -sha256 2>/dev/null
); then
  fail private-key-invalid privkey.pem
fi
[[ "$certificate_public" == "$key_public" ]] || fail key-mismatch privkey.pem
if ! timeout --kill-after=1s 5s openssl x509 -in "$certificate" -noout -checkend 604800 </dev/null >/dev/null 2>&1; then
  fail validity-buffer fullchain.pem
fi

# Explicit runtime roots prevent SSL_CERT_FILE or SSL_CERT_DIR from replacing trust.
if ! timeout --kill-after=1s 5s openssl verify \
  -CAfile /etc/ssl/certs/ca-certificates.crt -CApath /etc/ssl/certs -no-CAstore \
  -purpose sslserver -verify_hostname gwrk.gforge.ai \
  -untrusted "$certificate" "$certificate" </dev/null >/dev/null 2>&1; then
  fail trusted-server-chain fullchain.pem
fi

# Every certificate in the trusted path must survive the acceptance buffer.
acceptance_time=$(( $(date +%s 2>/dev/null) + 604800 ))
if ! timeout --kill-after=1s 5s openssl verify \
  -CAfile /etc/ssl/certs/ca-certificates.crt -CApath /etc/ssl/certs -no-CAstore \
  -purpose sslserver -verify_hostname gwrk.gforge.ai -attime "$acceptance_time" \
  -untrusted "$certificate" "$certificate" </dev/null >/dev/null 2>&1; then
  fail validity-buffer fullchain.pem
fi
