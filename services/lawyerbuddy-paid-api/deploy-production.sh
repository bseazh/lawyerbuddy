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
trap 'rm -rf "$tmp_dir"' EXIT

cp "$repo_dir/server.cjs" "$repo_dir/package.json" "$repo_dir/package-lock.json" "$repo_dir/preflight.cjs" "$tmp_dir/"
cp "$LB_PAID_ZIP" "$tmp_dir/lawyerbuddy-paid-v${LB_RELEASE_VERSION}.zip"
ssh "$LB_DEPLOY_HOST" "mkdir -p '$remote_tmp'"
scp -q "$tmp_dir"/* "$LB_DEPLOY_HOST:$remote_tmp/"
ssh "$LB_DEPLOY_HOST" "set -eu
  cd '$remote_tmp'
  test -s lawyerbuddy-paid-v${LB_RELEASE_VERSION}.zip
  mkdir -p '$LB_SERVER_DIR/releases/v${LB_RELEASE_VERSION}'
  cp server.cjs package.json package-lock.json preflight.cjs lawyerbuddy-paid-v${LB_RELEASE_VERSION}.zip '$LB_SERVER_DIR/releases/v${LB_RELEASE_VERSION}/'
  cd '$LB_SERVER_DIR'
  cp '$LB_SERVER_DIR/releases/v${LB_RELEASE_VERSION}/server.cjs' server.cjs
  cp '$LB_SERVER_DIR/releases/v${LB_RELEASE_VERSION}/package.json' package.json
  cp '$LB_SERVER_DIR/releases/v${LB_RELEASE_VERSION}/package-lock.json' package-lock.json
  cp '$LB_SERVER_DIR/releases/v${LB_RELEASE_VERSION}/preflight.cjs' preflight.cjs
  cp '$LB_SERVER_DIR/releases/v${LB_RELEASE_VERSION}/lawyerbuddy-paid-v${LB_RELEASE_VERSION}.zip' lawyerbuddy-paid-v${LB_RELEASE_VERSION}.zip
  npm ci --omit=dev
  systemctl restart lawyerbuddy-api
  rm -rf '$remote_tmp'
  curl --fail --silent --show-error https://snorlaxden.fun/health
"
echo "服务器同步完成：v${LB_RELEASE_VERSION}"
