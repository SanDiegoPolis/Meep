#!/usr/bin/env bash
set -euo pipefail
umask 077

root=${1:?Pass the absolute Meep deployment directory}
port=${2:-4173}
if [[ ! "$port" =~ ^[0-9]{1,5}$ ]] || (( 10#$port < 1 || 10#$port > 65535 )); then
  echo "Pass a valid Meep service port." >&2
  exit 1
fi
if [[ "$root" != /* || ! -d "$root/releases" || ! -r "$root/shared/.env" ]]; then
  echo "Meep deployment directory is not initialized." >&2
  exit 1
fi
current="$root/current"
service=meep.service

exec 9>"$root/.deploy.lock"
flock -n 9

previous=$(readlink "$current" || true)
release=$(mktemp -d "$root/releases/release.XXXXXXXX")
next="$root/.current-${release##*/}"
activated=false

point_current_at() {
  ln -sfn -- "$1" "$next" && mv -Tf -- "$next" "$current"
}

cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ "$activated" == true ]]; then
    if [[ -n "$previous" ]]; then
      if point_current_at "$previous" && sudo -n /usr/bin/systemctl restart "$service"; then
        echo "Restored the previous release." >&2
      else
        echo "Could not restore the previous service. Check journalctl -u $service." >&2
      fi
    else
      sudo -n /usr/bin/systemctl stop "$service" || true
      if [[ $(readlink "$current" || true) == "$release" ]]; then
        rm -f -- "$current"
      fi
    fi
  fi
  rm -f -- "$next"
  if [[ $(readlink "$current" || true) != "$release" ]]; then
    rm -rf -- "$release"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

tar --extract --gzip --file=- --directory="$release" --no-same-owner --no-same-permissions
test -s "$release/server/main.js"
test -s "$release/server/data/cities.json.gz"
test -s "$release/public/index.html"

activated=true
point_current_at "$release"
sudo -n /usr/bin/systemctl restart "$service"
for attempt in {1..15}; do
  if /usr/bin/systemctl is-active --quiet "$service" &&
    curl --fail --silent --max-time 2 --output /dev/null "http://127.0.0.1:$port/api/session"; then
    trap - EXIT HUP INT TERM
    echo "Meep is ready."
    exit 0
  fi
  sleep 1
done
echo "Meep failed its health check." >&2
exit 1
