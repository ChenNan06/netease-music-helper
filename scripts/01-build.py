#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
01-build.py —— 把 src/parts/* 拼成单个 userscript，并做语法与结构检查。

用法：
    python scripts/01-build.py            # 开发版（含「导出登录态」等排错入口）
    python scripts/01-build.py --release  # 正式版（剥离 dev-only 段、DEV_TOOLS=false）
    python scripts/01-build.py --check    # 只校验已有构建产物

产物：
    build/ncm-toolkit.user.js                    （工作副本）
    output/网易云音乐-合一助手-v<版本>.user.js      （给用户的成品）
"""
import hashlib
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARTS_DIR = os.path.join(ROOT, "src", "parts")
BUILD_DIR = os.path.join(ROOT, "build")
OUTPUT_DIR = os.path.join(ROOT, "output")

DEV_REGION_RE = re.compile(r"[ \t]*// #region dev-only\b.*?// #endregion dev-only[^\n]*\n", re.S)


def strip_dev_regions(source):
    """删掉 `// #region dev-only` … `// #endregion dev-only` 之间的整段实现（正式版用）"""
    out, n = DEV_REGION_RE.subn("", source)
    return out, n

PARTS = [
    "00-header.txt",
    "10-core.js",
    "20-api.js",
    "30-engine.js",
    "40-ui.js",
    "45-actions.js",
    "50-settings-page.js",
    "60-boot.js",
]

BANNER = """/* ---------------------------------------------------------------------------
 * 本文件由 scripts/01-build.py 自动拼装，请勿直接编辑。
 * 源码分片：src/parts/*.js
 * 说明：构建不写入时间戳，同样的源码永远得到同样的字节（便于 diff 与校验哈希）。
 * ------------------------------------------------------------------------- */"""

BANNER_STAMPED = """/* ---------------------------------------------------------------------------
 * 本文件由 scripts/01-build.py 自动拼装，请勿直接编辑。
 * 源码分片：src/parts/*.js
 * 构建时间：{ts}
 * ------------------------------------------------------------------------- */"""


def read(path):
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def build(release=False):
    missing = [p for p in PARTS if not os.path.exists(os.path.join(PARTS_DIR, p))]
    if missing:
        raise SystemExit("缺少源码分片: " + ", ".join(missing))

    header = read(os.path.join(PARTS_DIR, "00-header.txt"))
    version = "0.0.0"
    m = re.search(r"@version\s+(\S+)", header)
    if m:
        version = m.group(1)

    import datetime

    # 默认不写时间戳 → 可复现构建；需要留痕时加 --stamp
    banner = BANNER_STAMPED.format(ts=datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")) if "--stamp" in sys.argv else BANNER
    body = [banner]
    for name in PARTS[1:]:
        body.append("\n/* ===== part: %s ===== */\n" % name)
        body.append(read(os.path.join(PARTS_DIR, name)))

    source = header.rstrip() + "\n\n" + "".join(body) + "\n"

    if release:
        source, removed = strip_dev_regions(source)
        before = source.count("const DEV_TOOLS = true;")
        source = source.replace("const DEV_TOOLS = true;", "const DEV_TOOLS = false;")
        source = source.replace("// @grant        GM_cookie\n", "")
        if not before:
            raise SystemExit("正式版构建失败：找不到 `const DEV_TOOLS = true;` 标记")
        if removed < 1:
            raise SystemExit("正式版构建失败：没找到 dev-only 段（标记丢了？）")
        print("== 正式版：已剥离 dev-only 段 %d 处，DEV_TOOLS=false，GM_cookie 授权已移除 ==" % removed)
        for probe in ("exportSession", "GM_cookie"):
            if probe in source:
                raise SystemExit("正式版构建失败：仍残留 %s" % probe)

    os.makedirs(BUILD_DIR, exist_ok=True)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    work = os.path.join(BUILD_DIR, "ncm-toolkit.user.js")
    with open(work, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(source)

    out_name = "网易云音乐-合一助手-v%s%s.user.js" % (version, "-release" if release else "")
    out_path = os.path.join(OUTPUT_DIR, out_name)
    with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(source)

    return work, out_path, version, source


def check(work):
    print("== node --check ==")
    r = subprocess.run(["node", "--check", work], capture_output=True, text=True, encoding="utf-8", errors="replace")
    print((r.stdout or "").strip())
    if r.returncode != 0:
        print((r.stderr or "").strip())
        raise SystemExit("语法检查失败")
    print("OK")


def report(work, out_path, version, source):
    size = os.path.getsize(out_path)
    sha = hashlib.sha256(open(out_path, "rb").read()).hexdigest()
    lines = source.count("\n") + 1
    print("== 构建结果 ==")
    print("版本      : %s" % version)
    print("行数      : %d" % lines)
    print("大小      : %.1f KB" % (size / 1024))
    print("sha256    : %s" % sha)
    print("成品      : %s" % out_path)
    print("工作副本  : %s" % work)
    with open(os.path.join(ROOT, "build", "build-info.json"), "w", encoding="utf-8") as fh:
        json.dump({"version": version, "lines": lines, "bytes": size, "sha256": sha, "output": out_path}, fh, ensure_ascii=False, indent=2)


def build_preview(source, version):
    """生成自包含的面板预览页（脚本以 base64 内嵌，双击即可在浏览器里看效果）"""
    tpl_path = os.path.join(ROOT, "src", "preview-template.html")
    if not os.path.exists(tpl_path):
        return None
    tpl = read(tpl_path)
    import base64

    b64 = base64.b64encode(source.encode("utf-8")).decode("ascii")
    # ⚠️ atob 出来的是"二进制字符串"，必须用 TextDecoder 按 UTF-8 解码，否则中文全变乱码
    inject = (
        "<script>/* 内嵌脚本本体（base64，避免内联时的标签冲突） */\n"
        "(function(){var b=atob('" + b64 + "');"
        "var a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);"
        "var s=new TextDecoder('utf-8').decode(a);"
        "var d=document.createElement('script');d.textContent=s;document.head.appendChild(d);})();\n"
        "</script>"
    )
    html = tpl.replace("<!--NCMH_SCRIPT-->", inject)
    html = html.replace("面板预览（模拟页面，非真实站点）", "面板预览 v" + version + "（模拟页面，非真实站点）")
    out_dir = os.path.join(ROOT, "output")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "面板预览-双击打开.html")
    with open(out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(html)
    dev = os.path.join(BUILD_DIR, "preview.html")
    with open(dev, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(tpl.replace("<!--NCMH_SCRIPT-->", '<script src="ncm-toolkit.user.js"></script>'))
    return out


def main():
    if "--check" in sys.argv:
        work = os.path.join(BUILD_DIR, "ncm-toolkit.user.js")
        if not os.path.exists(work):
            raise SystemExit("没有构建产物，先运行不带 --check 的构建")
        check(work)
        return
    work, out_path, version, source = build(release="--release" in sys.argv)
    check(work)
    preview = build_preview(source, version)
    report(work, out_path, version, source)
    if preview:
        print("预览页    : %s (%.1f KB)" % (preview, os.path.getsize(preview) / 1024))


if __name__ == "__main__":
    main()
