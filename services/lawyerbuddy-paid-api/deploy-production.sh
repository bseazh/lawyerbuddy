#!/usr/bin/env bash
set -Eeuo pipefail

: "${LB_DEPLOY_HOST:?请设置 LB_DEPLOY_HOST，例如 ubuntu@snorlaxden.fun}"
: "${LB_SERVER_DIR:?请设置 LB_SERVER_DIR，例如 /home/ubuntu/Project/lawyerbuddy-api}"
: "${LB_RELEASE_VERSION:?请设置 LB_RELEASE_VERSION，例如 1.9.0}"

repo_dir="$(cd "$(dirname "$0")" && pwd)"
[[ "$LB_RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "版本号必须是 MAJOR.MINOR.PATCH" >&2
  exit 1
}

remote_tmp="${LB_SERVER_DIR}/.release-${LB_RELEASE_VERSION}-$$"
ssh_opts=()
if [[ -n "${LB_SSH_KEY:-}" ]]; then
  [[ -f "$LB_SSH_KEY" ]] || { echo "LB_SSH_KEY 不存在：$LB_SSH_KEY" >&2; exit 1; }
  ssh_opts=(-i "$LB_SSH_KEY" -o IdentitiesOnly=yes)
fi

ssh "${ssh_opts[@]}" "$LB_DEPLOY_HOST" "mkdir -p '$remote_tmp'"
scp -q "${ssh_opts[@]}" \
  "$repo_dir/server.cjs" \
  "$repo_dir/package.json" \
  "$repo_dir/package-lock.json" \
  "$repo_dir/preflight.cjs" \
  "$LB_DEPLOY_HOST:$remote_tmp/"

ssh "${ssh_opts[@]}" "$LB_DEPLOY_HOST" bash -s -- \
  "$LB_SERVER_DIR" "$LB_RELEASE_VERSION" "$remote_tmp" <<'REMOTE'
set -Eeuo pipefail
server_dir="$1"
release_version="$2"
remote_tmp="$3"
release_dir="$server_dir/releases/v$release_version"
env_file="/etc/lawyerbuddy/lawyerbuddy-api.env"

for file in server.cjs package.json package-lock.json preflight.cjs; do
  test -s "$remote_tmp/$file" || { echo "上传文件缺失：$file" >&2; exit 1; }
done

sudo -n test -r "$env_file" || {
  echo "无法读取 $env_file；请先配置服务环境文件" >&2
  exit 1
}
sudo -n grep -Eq '^[[:space:]]*(export[[:space:]]+)?LICENSE_SIGNING_SECRET_FILE=' "$env_file" || {
  echo "生产环境缺少 LICENSE_SIGNING_SECRET_FILE" >&2
  exit 1
}

license_secret_file="$(sudo -n awk '/^[[:space:]]*(export[[:space:]]+)?LICENSE_SIGNING_SECRET_FILE=/{sub(/^[^=]*=/, ""); gsub(/^[[:space:]\"]+|[[:space:]\"]+$/, ""); print; exit}' "$env_file")"
test -n "$license_secret_file" || { echo "LICENSE_SIGNING_SECRET_FILE 为空" >&2; exit 1; }
sudo -n test -s "$license_secret_file" || {
  echo "授权签名密钥不存在或为空：$license_secret_file" >&2
  exit 1
}

mkdir -p "$release_dir"
for file in server.cjs package.json package-lock.json preflight.cjs; do
  install -m 0644 "$remote_tmp/$file" "$release_dir/$file"
done

backup_dir="$remote_tmp/backup"
mkdir -p "$backup_dir"
for file in server.cjs package.json package-lock.json preflight.cjs; do
  if [[ -f "$server_dir/$file" ]]; then
    cp -p "$server_dir/$file" "$backup_dir/$file"
  else
    touch "$backup_dir/$file.missing"
  fi
  install -m 0644 "$release_dir/$file" "$server_dir/$file"
done

rollback() {
  for file in server.cjs package.json package-lock.json preflight.cjs; do
    if [[ -f "$backup_dir/$file" ]]; then
      install -m 0644 "$backup_dir/$file" "$server_dir/$file"
    else
      rm -f "$server_dir/$file"
    fi
  done
  (cd "$server_dir" && npm ci --omit=dev) || true
  sudo -n systemctl restart lawyerbuddy-api || true
}

if ! (cd "$server_dir" && npm ci --omit=dev); then
  rollback
  exit 1
fi
if ! sudo -n systemctl restart lawyerbuddy-api; then
  rollback
  exit 1
fi

if ! curl --fail --silent --show-error https://snorlaxden.fun/health >/dev/null; then
  rollback
  exit 1
fi
download_status="$(curl --silent --output /dev/null --write-out '%{http_code}' https://snorlaxden.fun/v1/skill/download)"
[[ "$download_status" == "410" ]] || {
  echo "旧下载接口状态异常：$download_status" >&2
  rollback
  exit 1
}
activation_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -X POST https://snorlaxden.fun/v1/license/activate \
  -H 'Content-Type: application/json' \
  --data "{\"client_id\":\"deployment-preflight\",\"skill_version\":\"$release_version\",\"features\":[\"sorting\"]}")"
[[ "$activation_status" == "402" ]] || {
  echo "授权激活预检状态异常：$activation_status" >&2
  rollback
  exit 1
}

rm -rf "$remote_tmp"
printf '授权服务已切换：v%s\n' "$release_version"
REMOTE

echo "服务器同步完成：v${LB_RELEASE_VERSION}（授权激活 API；旧 ZIP 下载已禁用）"
