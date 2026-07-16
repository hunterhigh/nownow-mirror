#!/usr/bin/env bash
# NowNow 整库备份 —— pg_dump 定时快照（免费兜底，对应「数据库级没备份」这个最大的洞）。
#
# 用法：
#   1) 复制 scripts/.backup-env.example → scripts/.backup-env，把里面的连接串换成你自己的
#      （Supabase 后台 → Project Settings → Database → Connection string → URI，含密码）。
#      ⚠️ .backup-env 已被 .gitignore 忽略、绝不会进 git，也绝不要贴进任何聊天。
#   2) 跑一次： bash scripts/backup-db.sh
#   3) 想每天自动跑：见文件末尾「定时」说明（launchd / cron）。
#
# 产物：backups/nownow-YYYYMMDD-HHMMSS.dump（自定义压缩格式），默认保留最近 14 份。
# 恢复：pg_restore --clean --if-exists -d "$NOWNOW_DB_URL" backups/那个.dump
set -euo pipefail
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$HERE/.backup-env"
OUT_DIR="$HERE/../backups"
KEEP=14

if [[ ! -f "$ENV_FILE" ]]; then
  echo "✗ 缺少 $ENV_FILE —— 先 cp scripts/.backup-env.example scripts/.backup-env 并填入你的连接串。" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
if [[ -z "${NOWNOW_DB_URL:-}" ]]; then
  echo "✗ .backup-env 里没设 NOWNOW_DB_URL。" >&2
  exit 1
fi

# 找 pg_dump：优先 PATH，其次 Homebrew keg-only libpq（装了但没 link 的常见情况）
PG_DUMP="$(command -v pg_dump || true)"
if [[ -z "$PG_DUMP" && -x /opt/homebrew/opt/libpq/bin/pg_dump ]]; then PG_DUMP=/opt/homebrew/opt/libpq/bin/pg_dump; fi
if [[ -z "$PG_DUMP" && -x /usr/local/opt/libpq/bin/pg_dump ]]; then PG_DUMP=/usr/local/opt/libpq/bin/pg_dump; fi
if [[ -z "$PG_DUMP" ]]; then
  echo "✗ 找不到 pg_dump。Mac 上： brew install libpq （已装则在 /opt/homebrew/opt/libpq/bin/）" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$OUT_DIR/nownow-$STAMP.dump"

echo "→ 备份中… ($OUT)"
# -Fc 自定义压缩格式；--no-owner/--no-privileges 让恢复到任意库更顺
if "$PG_DUMP" "$NOWNOW_DB_URL" -Fc --no-owner --no-privileges -f "$OUT"; then
  SIZE="$(du -h "$OUT" | cut -f1)"
  echo "✓ 备份完成： $OUT ($SIZE)"
else
  echo "✗ 备份失败——检查连接串、pg_dump 版本(需 ≥ 服务器版本)、网络。" >&2
  rm -f "$OUT"
  exit 1
fi

# 轮转：只留最近 $KEEP 份
COUNT="$(ls -1 "$OUT_DIR"/nownow-*.dump 2>/dev/null | wc -l | tr -d ' ')"
if (( COUNT > KEEP )); then
  ls -1t "$OUT_DIR"/nownow-*.dump | tail -n +$((KEEP+1)) | while read -r old; do
    echo "  · 清理旧备份 $(basename "$old")"
    rm -f "$old"
  done
fi
echo "✓ 当前共 $(ls -1 "$OUT_DIR"/nownow-*.dump | wc -l | tr -d ' ') 份备份，保留最近 $KEEP 份。"

# ── 定时（每天自动跑）─────────────────────────────────────────────
# macOS（推荐 launchd，Mac 开机就在）：写一个 ~/Library/LaunchAgents/com.nownow.backup.plist
#   每天 03:00 跑，ProgramArguments 指向本脚本，再 launchctl load 它。需要我给现成 plist 就说一声。
# 简单 cron（Mac 需常开）： crontab -e 加一行：
#   0 3 * * * /bin/bash /Users/<你>/NowNow-tiptap/scripts/backup-db.sh >> /tmp/nownow-backup.log 2>&1
