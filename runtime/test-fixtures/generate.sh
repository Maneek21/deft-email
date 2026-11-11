#!/bin/sh
# Regenerates the SYNTHETIC test-only TLS fixtures in this directory:
# ca.pem (self-signed CA), server.pem (leaf for mail/smtp.example.test) and
# server-key.pem. Only the loopback *-tls-fixture.mjs test servers load them.
# The CA private key is temporary and discarded. An existing server-key.pem is
# reused; pass --new-key to replace it. Requires OpenSSL 3.
# Usage: sh runtime/test-fixtures/generate.sh [--new-key]
set -eu
dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
days=3650
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

cat >"$tmp/ca.cnf" <<'EOF'
[req]
prompt = no
distinguished_name = dn
x509_extensions = ext
[dn]
CN = Synthetic IMAP fixture only CA
[ext]
basicConstraints = critical,CA:TRUE,pathlen:0
subjectKeyIdentifier = none
authorityKeyIdentifier = none
EOF

cat >"$tmp/server.cnf" <<'EOF'
[req]
prompt = no
distinguished_name = dn
[dn]
CN = mail.example.test
[ext]
subjectAltName = DNS:mail.example.test,DNS:smtp.example.test
basicConstraints = critical,CA:FALSE
subjectKeyIdentifier = none
authorityKeyIdentifier = none
EOF

if [ "${1:-}" = "--new-key" ] || [ ! -f "$dir/server-key.pem" ]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$tmp/server-key.pem"
  tr -d '\r' <"$tmp/server-key.pem" >"$dir/server-key.pem"
fi
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$tmp/ca-key.pem"
openssl req -new -x509 -sha256 -days "$days" -config "$tmp/ca.cnf" -key "$tmp/ca-key.pem" -out "$tmp/ca.pem"
openssl req -new -config "$tmp/server.cnf" -key "$dir/server-key.pem" -out "$tmp/server.csr"
openssl x509 -req -sha256 -days "$days" -in "$tmp/server.csr" -CA "$tmp/ca.pem" -CAkey "$tmp/ca-key.pem" \
  -set_serial "0x$(openssl rand -hex 19)" -extfile "$tmp/server.cnf" -extensions ext -out "$tmp/server.pem"
openssl verify -CAfile "$tmp/ca.pem" "$tmp/server.pem" >/dev/null
# Committed fixtures use LF; Windows OpenSSL builds may emit CRLF.
tr -d '\r' <"$tmp/ca.pem" >"$dir/ca.pem"
tr -d '\r' <"$tmp/server.pem" >"$dir/server.pem"
