#!/usr/bin/env bash
# Checks the live Rootnote site: the files match the published SHA-256 and every response
# carries the approved security headers.
#   .github/check-live.sh [base-url] [published-sha256.txt]
# Exit 1 on any difference; each check prints OK or DIFF.
set -uo pipefail
BASE="${1:-https://rootnote.unravelnetworks.com}"
LIST="${2:-$(dirname "$0")/published-sha256.txt}"
fail=0
ok() { echo "OK   $*"; }
bad() { echo "DIFF $*"; fail=1; }

# Headers of one response (no redirects followed), lower-cased names, no CR.
headers() { curl -sS -o /dev/null -D - --max-redirs 0 "$BASE$1" | tr -d '\r' | sed -E 's/^([^:]+):/\L\1:/'; }
value() { printf '%s\n' "$1" | grep -i "^$2:" | sed -E "s/^[^:]+: ?//" | paste -sd ',' -; }
status() { printf '%s\n' "$1" | head -1 | awk '{print $2}'; }

# 1. Files match the published fingerprints.
while read -r hash path; do
  [ -z "${hash:-}" ] && continue
  case "$hash" in \#*) continue;; esac
  live=$(curl -fsSL --retry 3 "$BASE$path" | sha256sum | cut -d' ' -f1)
  [ "$live" = "$hash" ] && ok "sha256 $path" || bad "sha256 $path live=$live published=$hash"
done < "$LIST"

# 2. Headers every response must carry, including aliases, redirects and missing pages.
common_check() {
  local p="$1" h="$2"
  [ "$(value "$h" x-content-type-options)" = "nosniff" ] || bad "$p x-content-type-options"
  [ "$(value "$h" referrer-policy)" = "no-referrer" ] || bad "$p referrer-policy"
  [ "$(value "$h" x-frame-options)" = "DENY" ] || bad "$p x-frame-options"
  value "$h" permissions-policy | grep -q 'camera=()' && value "$h" permissions-policy | grep -q 'microphone=()' && value "$h" permissions-policy | grep -q 'geolocation=()' || bad "$p permissions-policy"
  value "$h" strict-transport-security | grep -q 'max-age=[1-9]' || bad "$p strict-transport-security"
  value "$h" content-security-policy | grep -q "frame-ancestors 'none'" || bad "$p content-security-policy frame-ancestors"
}
for p in / /guide/ /guide/start-here/ /guide/readme/ /assets/guide/start.png /help-us-check/ /privacy/ /licence/ /security/ /app/ /app /help /index.html /no-such-page /app/no-such-page /download/SHA256SUMS.txt; do
  h=$(headers "$p")
  if [ -z "$h" ]; then bad "$p no response"; continue; fi
  before=$fail
  common_check "$p" "$h"
  [ $fail -eq $before ] && ok "headers $p ($(status "$h"))"
done

# 3b. Old /help/ links forward to /guide/.
loc=$(curl -sSI "$BASE/help/start-here/" | tr -d '\r' | awk 'NR==1 {c=$2} tolower($1)=="location:" {l=$2} END {print c, l}')
case "$loc" in 301\ */guide/start-here/) ok "old help link forwards ($loc)";; *) bad "old help link: $loc";; esac

# 3a. The Guide image is served as an image.
img=$(curl -sS -o /dev/null -w '%{http_code} %{content_type}' "$BASE/assets/guide/start.png")
[ "$img" = "200 image/png" ] && ok "guide image ($img)" || bad "guide image: $img"

# 3. Site pages: strict policy and 200.
for p in / /guide/ /guide/start-here/ /guide/readme/ /help-us-check/ /privacy/ /licence/ /security/; do
  h=$(headers "$p")
  [ "$(status "$h")" = "200" ] || bad "$p status $(status "$h")"
  value "$h" content-security-policy | grep -q "default-src 'none'" || bad "$p site policy missing"
done

# 4. The app: 200, and the header policy mirrors the page's own CSP plus frame-ancestors.
h=$(headers /app/)
[ "$(status "$h")" = "200" ] || bad "/app/ status $(status "$h")"
meta=$(curl -fsS "$BASE/app/" | grep -o '<meta http-equiv="Content-Security-Policy" content="[^"]*"' | sed -E 's/.*content="([^"]*)"/\1/' | sed "s/&#39;/'/g")
csp=$(value "$h" content-security-policy)
if [ -n "$meta" ] && printf '%s' "$csp" | grep -qF "$meta; frame-ancestors 'none'"; then ok "/app/ policy mirrors the page CSP"; else bad "/app/ policy does not mirror the page CSP"; fi

# 5. Aliases and missing pages.
h=$(headers /app)
case "$(status "$h")" in 30[1278]) value "$h" location | grep -qE '(^|//[^/]+)/app/$' && ok "/app redirects to /app/" || bad "/app redirect target $(value "$h" location)";; *) bad "/app status $(status "$h")";; esac
h=$(headers /no-such-page)
[ "$(status "$h")" = "404" ] && ok "/no-such-page is 404" || bad "/no-such-page status $(status "$h")"

# 6. Plain HTTP goes to HTTPS (only for the real https site).
case "$BASE" in https://*)
  h=$(curl -sS -o /dev/null -D - --max-redirs 0 "http://${BASE#https://}/" | tr -d '\r')
  printf '%s\n' "$h" | grep -iE '^location: https://' >/dev/null && ok "http redirects to https" || bad "http does not redirect to https";;
esac

exit $fail
