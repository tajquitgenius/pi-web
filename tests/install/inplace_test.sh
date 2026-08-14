#!/usr/bin/env bash
# Verifies install.sh's in-place self-update path: when PI_WEB_INPLACE_UPDATE is
# set, it must NOT stop/restart the service (doing so kills the npm process that
# spawned it — see internal/app/update.go), and must still swap the binary.
# Without the flag, the normal path must still stop the running instance.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALL_SH="$REPO_ROOT/install.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }

# Run install.sh in a sandboxed HOME with all external commands shimmed.
# $1: "inplace" or "normal".
# $2: optional npm package version. When set, install.sh should download the
#     matching release tag instead of querying the latest release.
# $3: optional explicitly supplied PI_WEB_TOKEN.
# $4: optional PI_WEB_TOKEN already present in ~/.config/pi-web/env.
run_case() {
  local mode="$1"
  local package_version="${2:-}"
  local explicit_token="${3:-}"
  local existing_token="${4:-}"
  local expected_tag="v10.0.0-beta.1"
  [[ -n "$package_version" ]] && expected_tag="v${package_version#v}"
  local workdir bindir shimdir calllog
  workdir="$(mktemp -d)"
  bindir="$workdir/.local/bin"
  shimdir="$workdir/shim"
  calllog="$workdir/calls.log"
  mkdir -p "$bindir" "$shimdir"
  if [[ -n "$existing_token" ]]; then
    mkdir -p "$workdir/.config/pi-web"
    printf 'PI_WEB_TOKEN=%s\n' "$existing_token" > "$workdir/.config/pi-web/env"
  fi

  # curl shim: serve the GitHub "latest release" JSON and a fake binary download.
  # The fake binary echoes the release tag from its download URL so tests can
  # assert whether install.sh chose latest or the npm package's pinned version.
  cat > "$shimdir/curl" <<'SHIM'
#!/usr/bin/env bash
out="" url=""
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  case "${args[i]}" in
    -o) out="${args[i+1]}" ;;
    http*) url="${args[i]}" ;;
  esac
done
if [[ "$url" == "https://api.github.com/repos/tajquitgenius/pi-web/releases?per_page=100" ]]; then
  echo '[{"tag_name":"v9.9.8"},{"tag_name":"v9.9.9-beta.1"},{"tag_name":"v9.9.9"},{"tag_name":"v10.0.0-beta.1"}]'
elif [[ "$url" == https://github.com/tajquitgenius/pi-web/releases/download/* ]]; then
  tag="${url#*/releases/download/}"
  tag="${tag%%/*}"
  printf '#!/bin/sh\necho %s\n' "$tag" > "$out"
else
  echo "unexpected URL: $url" >&2
  exit 1
fi
SHIM

  # Exercise the unprivileged Ubuntu systemd-user path on every development OS.
  cat > "$shimdir/uname" <<'SHIM'
#!/usr/bin/env bash
if [[ "${1:-}" == "-m" ]]; then
  echo x86_64
else
  echo Linux
fi
SHIM

  # Service managers / pkill / sudo: log the call so we can assert on it.
  local tool
  for tool in systemctl launchctl pkill sudo; do
    cat > "$shimdir/$tool" <<SHIM
#!/usr/bin/env bash
echo "$tool \$*" >> "$calllog"
[[ "$tool" == "sudo" ]] && exec "\$@"
exit 0
SHIM
  done
  chmod +x "$shimdir"/*
  : > "$calllog"

  # A stale binary so the "stop running instance" path is reachable in normal mode.
  printf '#!/bin/sh\necho v0.0.0\n' > "$bindir/pi-web"
  chmod +x "$bindir/pi-web"

  local env_vars=(
    "HOME=$workdir"
    "PI_WEB_INSTALL_DIR=$bindir"
    "PATH=$shimdir:/usr/bin:/bin"
  )
  [[ "$mode" == "inplace" ]] && env_vars+=("PI_WEB_INPLACE_UPDATE=1")
  [[ -n "$explicit_token" ]] && env_vars+=("PI_WEB_TOKEN=$explicit_token")
  if [[ -n "$package_version" ]]; then
    env_vars+=("npm_package_name=@tajquitgenius/pi-web" "npm_package_version=$package_version")
  fi

  env -i "${env_vars[@]}" bash "$INSTALL_SH" </dev/null > "$workdir/out.log" 2>&1 \
    || fail "[$mode] install.sh exited non-zero:"$'\n'"$(cat "$workdir/out.log")"

  [[ -x "$bindir/pi-web" ]] || fail "[$mode] binary missing after install"
  grep -q "$expected_tag" "$bindir/pi-web" \
    || fail "[$mode] binary not replaced with expected version $expected_tag"

  if [[ "$mode" == "inplace" ]]; then
    [[ ! -s "$calllog" ]] \
      || fail "[inplace] expected no service/pkill calls, got:"$'\n'"$(cat "$calllog")"
  else
    grep -Eq 'systemctl|launchctl|pkill' "$calllog" \
      || fail "[normal] expected the running instance to be stopped, but nothing was called"
    local env_file="$workdir/.config/pi-web/env"
    local service_file="$workdir/.config/systemd/user/pi-web.service"
    grep -Fq "ExecStart=$bindir/pi-web" "$service_file" \
      || fail "[normal] systemd user service did not preserve ~/.local/bin install path"
    if [[ -n "$explicit_token" ]]; then
      grep -Fxq "PI_WEB_TOKEN=$explicit_token" "$env_file" \
        || fail "[normal] explicitly supplied token was not persisted"
      ! grep -Fq "$explicit_token" "$workdir/out.log" \
        || fail "[normal] explicitly supplied token leaked to installer output"
    elif [[ -n "$existing_token" ]]; then
      grep -Fxq "PI_WEB_TOKEN=$existing_token" "$env_file" \
        || fail "[normal] existing token was not preserved"
      ! grep -Fq "$existing_token" "$workdir/out.log" \
        || fail "[normal] existing token leaked to installer output"
    else
      ! grep -q '^PI_WEB_TOKEN=' "$env_file" \
        || fail "[normal] installer generated an unexpected token"
    fi
    ! grep -Eq 'Generated PI_WEB_TOKEN|Use this token' "$workdir/out.log" \
      || fail "[normal] installer printed legacy token guidance"
  fi

  echo "ok: $mode"
  rm -rf "$workdir"
}

test_refuses_upstream_coinstall() {
  local workdir
  workdir="$(mktemp -d)"
  mkdir -p "$workdir/.pi/agent"
  printf '{"packages":["npm:@ygncode/pi-web@beta"]}\n' > "$workdir/.pi/agent/settings.json"
  if env -i \
    "HOME=$workdir" \
    "PATH=/usr/bin:/bin" \
    "npm_package_name=@tajquitgenius/pi-web" \
    "npm_package_version=1.2.3" \
    bash "$INSTALL_SH" > "$workdir/out.log" 2>&1; then
    fail "[upstream conflict] install.sh should refuse a co-install"
  fi
  grep -q "cannot safely coexist" "$workdir/out.log" \
    || fail "[upstream conflict] expected migration guidance"
  rm -rf "$workdir"
  echo "ok: upstream conflict refused"
}

run_case inplace
run_case normal
run_case normal 1.2.3-beta.4
run_case normal "" "operator-secret"
run_case normal "" "" "existing-secret"
test_refuses_upstream_coinstall
echo "PASS: install.sh in-place self-update"
