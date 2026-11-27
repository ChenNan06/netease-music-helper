#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""推送前脱敏：把个人账号信息替换成占位符。"""
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

REPL = [
    ("已登录（你的昵称）", "已登录（你的昵称）"),
    ("你的昵称", "你的昵称"),
    ("你的uid", "你的uid"),
]

TARGETS = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in ("node_modules", "logs", "build", "downloads", ".git")]
    for f in filenames:
        if f.lower().endswith((".md", ".js", ".mjs", ".py", ".txt", ".json")) and f != "session.json":
            TARGETS.append(os.path.join(dirpath, f))

changed = 0
for p in TARGETS:
    try:
        with io.open(p, "r", encoding="utf-8") as fh:
            s = fh.read()
    except Exception:
        continue
    o = s
    for a, b in REPL:
        s = s.replace(a, b)
    if s != o:
        with io.open(p, "w", encoding="utf-8", newline="") as fh:
            fh.write(s)
        print("脱敏: " + os.path.relpath(p, ROOT))
        changed += 1

print("共处理 %d 个文件" % changed)
