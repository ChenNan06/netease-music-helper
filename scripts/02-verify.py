#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
02-verify.py —— 一键跑完整验证链，并把每份输出落盘到 logs/（证据留存）

步骤：
  1) 构建（node --check 语法门禁）
  2) 03-unit-test.mjs     纯函数单元测试（64 项）
  3) 03-unit-test.mjs --net  真实 weapi 握手
  4) 04-net-probe.mjs     接口探测（只读，不写云端数据）
  5) 05-chain-test.mjs    端到端取链降级 + 真实音频字节
  6) 06-ui-smoke.mjs      jsdom 真实挂载面板 + 逐项点击
  7) 07-settings-test.mjs 设置页隔离测试 + 配置覆盖率

用法：python scripts/02-verify.py [--offline]
      --offline 跳过需要联网的步骤（3/4/5）
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGS = os.path.join(ROOT, "logs")
NODE = "node"

STEPS = [
    ("unit", [NODE, "scripts/03-unit-test.mjs"], "纯函数单元测试", True),
    ("unit-net", [NODE, "scripts/03-unit-test.mjs", "--net"], "单元测试 + 真实握手", True),
    ("net-probe", [NODE, "scripts/04-net-probe.mjs"], "接口探测", True),
    ("chain", [NODE, "scripts/05-chain-test.mjs"], "端到端取链降级", True),
    ("ui", [NODE, "scripts/06-ui-smoke.mjs"], "面板 UI 冒烟", False),
    ("settings", [NODE, "scripts/07-settings-test.mjs"], "设置页测试", False),
    ("layout", [NODE, "scripts/08-layout-test.mjs"], "面板几何（贴球/自适应）", False),
    ("sync", [NODE, "scripts/09-settings-sync.mjs"], "设置↔面板同步", False),
    ("fallback", [NODE, "scripts/11-fetch-fallback-test.mjs"], "取字节降级链（GM 被拦场景）", False),
    ("css", [NODE, "scripts/16-css-check.mjs"], "面板 CSS 门禁（括号/悬空声明/可解析）", False),
    ("manual", [NODE, "scripts/17-manual-and-list-test.mjs"], "手动输入 + 列表翻页/搜索/勾选", False),
    ("fixes", [NODE, "scripts/20-fixes-test.mjs"], "pin/循环/播放/云盘删除/进度条", False),
    ("release", [NODE, "scripts/13-release-build-test.mjs"], "正式版构建门禁（剥离 dev-only）", False),
]

OPTIONAL_STEPS = [
    ("loggedin", [NODE, "scripts/10-loggedin-probe.mjs"], "登录后只读探测", True),
]


def run(cmd, name):
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, env=env)
    out = (p.stdout or b"").decode("utf-8", "replace") + (p.stderr or b"").decode("utf-8", "replace")
    os.makedirs(LOGS, exist_ok=True)
    with open(os.path.join(LOGS, name + ".txt"), "w", encoding="utf-8") as fh:
        fh.write("$ " + " ".join(cmd) + "\n\n" + out)
    return p.returncode, out


def parse(out):
    m = re.search(r"通过 (\d+) 项，失败 (\d+) 项", out)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None, None


def main():
    offline = "--offline" in sys.argv
    print("=== 1. 构建 ===")
    code, out = run([sys.executable, "scripts/01-build.py"], "00-build")
    print(out.strip().splitlines()[-6:] and "\n".join(out.strip().splitlines()[-8:]))
    if code != 0:
        print("构建失败，终止")
        return 1

    rows = []
    failed = 0
    steps = list(STEPS)
    session = os.path.join(ROOT, "tools", "session.json")
    if os.path.exists(session) and not offline:
        steps += OPTIONAL_STEPS
    elif not os.path.exists(session):
        rows.append(("登录后只读探测", "-", "-", "SKIP(无 tools/session.json)"))

    for name, cmd, title, needs_net in steps:
        if needs_net and offline:
            rows.append((title, "-", "-", "SKIP"))
            continue
        code, out = run(cmd, "0" + name if not name[0].isdigit() else name)
        ok_n, fail_n = parse(out)
        if code == 3:
            status = "SKIP(网络)"
        elif code == 0:
            status = "PASS"
        else:
            status = "FAIL"
            failed += 1
        rows.append((title, ok_n, fail_n, status))
        print("\n=== %s -> %s ===" % (title, status))
        tail = [l for l in out.strip().splitlines() if l.strip()][-4:]
        print("\n".join(tail))

    print("\n================ 汇总 ================")
    print("%-24s %6s %6s %6s" % ("环节", "通过", "失败", "结论"))
    for title, a, b, s in rows:
        print("%-24s %6s %6s %6s" % (title, a, b, s))
    print("日志目录：%s" % LOGS)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
