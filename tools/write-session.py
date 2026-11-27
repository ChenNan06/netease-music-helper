#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
写入 tools/session.json（登录态只读验证用）。

⚠️ 不要把 MUSIC_U 直接写进代码里 —— 那等于把凭据复制一份到脚本文件。
   两种用法：
     1) 从剪贴板/文本文件导入：
        python tools/write-session.py --from-file D:\\cookie.txt
        （文件内容：一行 MUSIC_U，一行 __csrf，或用 `MUSIC_U=...; __csrf=...` 的 cookie 串）
     2) 交互式粘贴：直接运行，然后粘贴，回车结束（不落历史）
"""
import getpass
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tools", "session.json")


def parse_cookie_string(text):
    """从 `k=v; k2=v2` 或两行裸值里解析出 MUSIC_U / __csrf"""
    text = (text or "").strip()
    out = {}
    if "=" in text:
        for part in text.replace("\n", ";").split(";"):
            if "=" not in part:
                continue
            k, v = part.split("=", 1)
            k, v = k.strip(), v.strip()
            if k:
                out[k] = v
    else:
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        if len(lines) >= 1:
            out["MUSIC_U"] = lines[0]
        if len(lines) >= 2:
            out["__csrf"] = lines[1]
    return out


def main():
    if "--from-file" in sys.argv:
        path = sys.argv[sys.argv.index("--from-file") + 1]
        with io.open(path, "r", encoding="utf-8") as fh:
            cookies = parse_cookie_string(fh.read())
    else:
        print("粘贴 cookie（形如 `MUSIC_U=xxx; __csrf=yyy`），回车结束：")
        cookies = parse_cookie_string(sys.stdin.readline())

    if not cookies.get("MUSIC_U"):
        raise SystemExit("没读到 MUSIC_U，检查输入")

    payload = {
        "version": 1,
        "origin": "https://music.163.com",
        "exportedAt": None,
        "source": "manual",
        "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36",
        "cookies": cookies,
    }
    import datetime
    payload["exportedAt"] = datetime.datetime.now().isoformat(timespec="seconds")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, "w", encoding="utf-8", newline="") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    print("已写入:", OUT)
    print("字段:", ", ".join(cookies.keys()))
    print("⚠️ 这个文件等同凭据：只留本机，别提交、别外传（tools/.gitignore 已忽略它）")


if __name__ == "__main__":
    main()
