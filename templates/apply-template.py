#!/usr/bin/env python3
"""按 Unraid 容器模板重建容器，配置唯一来源是 XML 模板。

用法:
  apply-template.py [--template PATH] [--no-pull] [--dry-run]

行为:
  1. 解析 Unraid <Container> 模板 XML
  2. 由模板生成 docker 参数（网络 / 挂载 / 环境变量 / 端口 / 额外参数）
  3. docker pull 镜像（--no-pull 可跳过）
  4. docker stop/rm 同名旧容器
  5. docker run -d 启动新容器

不要再手写 docker run：改配置就改模板，然后重跑本脚本。
"""

import argparse
import shlex
import socket
import subprocess
import sys
import xml.etree.ElementTree as ET

DEFAULT_TEMPLATE = "/boot/config/plugins/dockerMan/templates-user/my-DeepSeek-Harness.xml"


def text(node, tag, default=""):
    el = node.find(tag)
    if el is None or el.text is None:
        return default
    return el.text.strip()


def build_args(root):
    args = ["docker", "run", "-d", "--name", text(root, "Name")]

    network = text(root, "Network", "bridge").lower()
    args += ["--network", network]

    extra = text(root, "ExtraParams")
    if extra:
        args += shlex.split(extra)

    if text(root, "Privileged", "false").lower() == "true":
        args.append("--privileged")

    # 复刻 Unraid dockerMan 的宿主变量，使此处创建的容器与面板创建的结果一致
    args += ["-e", "HOST_OS=Unraid",
             "-e", "HOST_HOSTNAME=%s" % socket.gethostname(),
             "-e", "HOST_CONTAINERNAME=%s" % text(root, "Name")]

    # Unraid 面板据此识别并管理容器（图标 / Web UI 跳转 / 自动更新）
    args += ["--label", "net.unraid.docker.managed=dockerman"]
    webui = text(root, "WebUI")
    if webui:
        args += ["--label", "net.unraid.docker.webui=%s" % webui]
    icon = text(root, "Icon")
    if icon:
        args += ["--label", "net.unraid.docker.icon=%s" % icon]

    for cfg in root.findall("Config"):
        ctype = (cfg.get("Type") or "").strip()
        target = (cfg.get("Target") or "").strip()
        value = (cfg.text or "").strip()
        mode = (cfg.get("Mode") or "").strip()

        if not target or not value:
            # 留空的 Config 一律跳过，避免注入空值环境变量覆盖镜像内默认值
            continue

        if ctype == "Path":
            mount_mode = mode or "rw"
            args += ["-v", "%s:%s:%s" % (value, target, mount_mode)]
        elif ctype == "Port":
            proto = mode or "tcp"
            args += ["-p", "%s:%s/%s" % (value, target, proto)]
        elif ctype == "Variable":
            args += ["-e", "%s=%s" % (target, value)]
        else:
            print("[warn] 忽略未知 Config 类型: Type=%s Target=%s" % (ctype, target),
                  file=sys.stderr)

    args.append(text(root, "Repository"))
    return args


def run(cmd, dry=False):
    printable = " ".join(shlex.quote(c) for c in cmd)
    print("+ " + printable)
    if dry:
        return None
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--template", default=DEFAULT_TEMPLATE)
    ap.add_argument("--no-pull", action="store_true", help="跳过 docker pull")
    ap.add_argument("--dry-run", action="store_true", help="只打印将执行的命令")
    opts = ap.parse_args()

    try:
        root = ET.parse(opts.template).getroot()
    except Exception as exc:
        print("[error] 解析模板失败 %s: %s" % (opts.template, exc), file=sys.stderr)
        return 1

    if root.tag != "Container":
        print("[error] 根节点不是 <Container>，实际为 <%s>" % root.tag, file=sys.stderr)
        return 1

    name = text(root, "Name")
    repo = text(root, "Repository")
    if not name or not repo:
        print("[error] 模板缺少 Name 或 Repository", file=sys.stderr)
        return 1

    args = build_args(root)
    print("模板: %s" % opts.template)
    print("容器: %s  镜像: %s  网络: %s" % (name, repo, text(root, "Network", "bridge")))
    print()

    if not opts.no_pull:
        try:
            run(["docker", "pull", repo], opts.dry_run)
        except subprocess.CalledProcessError as exc:
            print("[error] 拉取镜像失败:\n%s" % (exc.stderr or "").strip(), file=sys.stderr)
            return 1
        print()

    if opts.dry_run:
        print("+ docker stop %s (dry-run 跳过)" % name)
        print("+ docker rm %s (dry-run 跳过)" % name)
        print()
    else:
        subprocess.run(["docker", "stop", name], capture_output=True, text=True)
        subprocess.run(["docker", "rm", name], capture_output=True, text=True)

    try:
        result = run(args, opts.dry_run)
    except subprocess.CalledProcessError as exc:
        print("[error] 启动容器失败:\n%s" % (exc.stderr or "").strip(), file=sys.stderr)
        return 1

    if opts.dry_run:
        return 0

    cid = (result.stdout or "").strip()
    print()
    print("新容器: %s" % cid)
    print()
    subprocess.run(["docker", "ps", "--filter", "name=%s" % name,
                    "--format", "table {{.Names}}\t{{.Status}}\t{{.Image}}"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
