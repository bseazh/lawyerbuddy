#!/usr/bin/env bash
set -Eeuo pipefail

: "${LB_DEPLOY_HOST:?请设置 LB_DEPLOY_HOST，例如 ubuntu@snorlaxden.fun}"
: "${LB_SERVER_DIR:?请设置 LB_SERVER_DIR，例如 /home/ubuntu/Project/lawyerbuddy-api}"
: "${LB_RELEASE_VERSION:?请设置 LB_RELEASE_VERSION，例如 1.8.4}"
: "${LB_PAID_ZIP:?请设置 LB_PAID_ZIP 为付费 ZIP 的绝对路径}"

repo_dir="$(cd "$(dirname "$0")" && pwd)"
[[ -f "$LB_PAID_ZIP" ]] || { echo "找不到付费 ZIP: $LB_PAID_ZIP" >&2; exit 1; }
[[ "$LB_RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "版本号必须是 MAJOR.MINOR.PATCH" >&2; exit 1; }
tmp_dir="$(mktemp -d)"
remote_tmp="${LB_SERVER_DIR}/.release-${LB_RELEASE_VERSION}-$$"
resource_name="lawyerbuddy-paid-v${LB_RELEASE_VERSION}.zip"
resource_path="${LB_SERVER_DIR}/artifacts/${resource_name}"
trap 'rm -rf "$tmp_dir"' EXIT

cp "$repo_dir/server.cjs" "$repo_dir/package.json" "$repo_dir/package-lock.json" "$repo_dir/preflight.cjs" "$repo_dir/set-resource-file.py" "$tmp_dir/"
cp "$LB_PAID_ZIP" "$tmp_dir/$resource_name"
ssh "$LB_DEPLOY_HOST" "mkdir -p '$remote_tmp'"
scp -q "$tmp_dir"/* "$LB_DEPLOY_HOST:$remote_tmp/"
ssh "$LB_DEPLOY_HOST" bash -s -- "$LB_SERVER_DIR" "$LB_RELEASE_VERSION" "$remote_tmp" "$resource_name" "$resource_path" <<'REMOTE'
set -Eeuo pipefail
server_dir="$1"
release_version="$2"
remote_tmp="$3"
resource_name="$4"
resource_path="$5"
release_dir="$server_dir/releases/v$release_version"
env_file="/etc/lawyerbuddy/lawyerbuddy-api.env"

test -s "$remote_tmp/$resource_name"
mkdir -p "$release_dir" "$server_dir/artifacts"
install -m 0644 "$remote_tmp/server.cjs" "$release_dir/server.cjs"
install -m 0644 "$remote_tmp/package.json" "$release_dir/package.json"
install -m 0644 "$remote_tmp/package-lock.json" "$release_dir/package-lock.json"
install -m 0644 "$remote_tmp/preflight.cjs" "$release_dir/preflight.cjs"
install -m 0644 "$remote_tmp/set-resource-file.py" "$release_dir/set-resource-file.py"
install -m 0644 "$remote_tmp/$resource_name" "$release_dir/$resource_name"

backup_dir="$remote_tmp/backup"
mkdir -p "$backup_dir"
api_changed=0
for file in server.cjs package.json package-lock.json preflight.cjs; do
  if [[ -f "$server_dir/$file" ]]; then
    cp -p "$server_dir/$file" "$backup_dir/$file"
  else
    touch "$backup_dir/$file.missing"
  fi
  if ! cmp -s "$release_dir/$file" "$server_dir/$file"; then
    install -m 0644 "$release_dir/$file" "$server_dir/$file"
    api_changed=1
  fi
done
if [[ "$api_changed" == 1 ]]; then
  (cd "$server_dir" && npm ci --omit=dev)
fi

# 先放置版本化资源，再仅更新 env 文件中的 RESOURCE_FILE 一项；其他生产配置和密钥原样保留。
install -m 0644 "$release_dir/$resource_name" "$resource_path.tmp"
mv -f "$resource_path.tmp" "$resource_path"
previous_resource="$(sudo -n python3 "$release_dir/set-resource-file.py" get "$env_file")"
sudo -n python3 "$release_dir/set-resource-file.py" set "$env_file" "$resource_path"

rollback_resource() {
  if [[ -n "$previous_resource" ]]; then
    sudo -n python3 "$release_dir/set-resource-file.py" set "$env_file" "$previous_resource"
  else
    sudo -n python3 "$release_dir/set-resource-file.py" unset "$env_file"
  fi
  if [[ "$api_changed" == 1 ]]; then
    for file in server.cjs package.json package-lock.json preflight.cjs; do
      if [[ -f "$backup_dir/$file" ]]; then
        install -m 0644 "$backup_dir/$file" "$server_dir/$file"
      elif [[ -f "$backup_dir/$file.missing" ]]; then
        rm -f "$server_dir/$file"
      fi
    done
    (cd "$server_dir" && npm ci --omit=dev) || true
  fi
  sudo -n systemctl restart lawyerbuddy-api || true
}

if ! sudo -n systemctl restart lawyerbuddy-api; then
  rollback_resource
  exit 1
fi
if ! curl --fail --silent --show-error https://snorlaxden.fun/health; then
  rollback_resource
  exit 1
fi
rm -rf "$remote_tmp"
printf '\n资源已切换：%s\n' "$resource_path"
REMOTE
echo "服务器同步完成：v${LB_RELEASE_VERSION}"
