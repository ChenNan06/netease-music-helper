#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""追加 2026-11-25 第二批变更记录（NCMH v1.0.1）。"""
import io

P = r"D:\AI-Project\AI-KNOWLEDGE-BASE-更新记录.md"

ROWS = [
    "| 2026-11-25（第二批） | **§3 风格偏好 ⑧（新增）/ §9.115（新增）** | "
    "**用户明确要求立规矩：浏览器测试需要登录态时，直接告诉用户「要什么、怎么给」，然后自己把登录态落地保存、只读复用，"
    "不要每次测试都叫用户重新登录。** §9.115 记了三条路线的可靠性排序 —— "
    "**A 页面导出 cookie（采用）> B 专用 profile 登录一次整个目录留存 > C 离线解密 Chrome Cookies（基本不可行："
    "Chrome 127+ App-Bound v20 只有 Chrome 自己能解，且运行中 Cookies 被独占锁）**；附 Node/Python 用 `tools/session.json` "
    "当 Cookie 头的模板、只读接口白名单、缺文件时必须打印三步指引。同节还记了三个实测坑：① "
    "**悬浮面板/弹层必须量真实 rect 定位、不能估算高度**（估 `min(78vh,720)` 而实际 400 多高 → 底边离球几百像素），"
    "且内容会变就要 `ResizeObserver` 重定位；② **flex 列容器里中间区滚动时子项必须 `min-height:0`**，否则 `max-height` 失效"
    "（就是「越滚越长最后盖住入口」）；③ **`GM_xmlhttpRequest` 失败必须带出 `res.error/errorText`**（只报 status 会得到 "
    "`unknown`），服务器正常而客户端失败时走 GM → 页面内 fetch（网易云 CDN 带 `ACAO:*`）→ 匿名 GM → 直链下载，并把 "
    "`http://` 媒体地址升 https；另记 **PowerShell 函数参数不能叫 `$args`**（自动变量，`Start-Process` 会报 ArgumentList 为 Null） "
    "| Lead(DSH 会话 · 逆向统一/netease-music-helper) | 全局约定（登录态测试）/ 悬浮 UI 几何 / 网络请求降级 / PowerShell |",
    "| 2026-11-25（第二批） | **§9.114 复核** | 再次确认本机 **Chrome 157 / Edge 的 `--headless` 彻底不可用**："
    "加 `--no-sandbox`、`--single-process`、`--enable-logging=stderr --v=1` 全部 **exit 0 + stdout/stderr 0 字节 + 无残留进程**，"
    "`--version` 正常 ⇒ 不是参数问题而是进程起不来；因此前端 UI 的自动化验证**统一走 jsdom**，视觉观感交给用户自己看预览页 "
    "| Lead(DSH 会话 · 逆向统一/netease-music-helper) | 全局技术备忘 / 前端自动化验证 |",
]

with io.open(P, "r", encoding="utf-8") as fh:
    text = fh.read()

added = 0
for row in ROWS:
    key = row.split("|")[1].strip()
    marker = row[:60]
    if marker in text:
        print("已存在，跳过:", key)
        continue
    text = text.rstrip() + "\r\n" + row + "\r\n"
    added += 1

with io.open(P, "w", encoding="utf-8", newline="") as fh:
    fh.write(text)

lines = text.splitlines()
print("追加 %d 行；总行数 %d" % (added, len(lines)))
print("末行:", lines[-1][:100])
