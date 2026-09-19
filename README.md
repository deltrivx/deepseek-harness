<div align="center">

<img src="assets/icon.png" alt="DeepSeek Harness Logo" width="120" height="120" />

# DeepSeek Harness (DSH) Docker 增强版

[![GitHub stars](https://img.shields.io/github/stars/deltrivx/deepseek-harness?style=flat-square)](https://github.com/deltrivx/deepseek-harness/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/deltrivx/deepseek-harness?style=flat-square)](https://github.com/deltrivx/deepseek-harness/network)
[![GitHub issues](https://img.shields.io/github/issues/deltrivx/deepseek-harness?style=flat-square)](https://github.com/deltrivx/deepseek-harness/issues)
[![Release](https://img.shields.io/github/v/release/deltrivx/deepseek-harness?include_prereleases&style=flat-square&color=blue)](https://github.com/deltrivx/deepseek-harness/releases)
[![Upstream Sync](https://img.shields.io/badge/Upstream%20Sync-v0.1.6--alpha.1-blueviolet?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![Docker Image](https://img.shields.io/badge/Docker-GHCR-blue?logo=docker&style=flat-square)](https://github.com/deltrivx/deepseek-harness/pkgs/container/deepseek-harness)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)

**面向 NAS、私有云与局域网环境的开箱即用 DeepSeek Harness (DSH) 容器化部署增强方案**

[English](README.en.md) | [简体中文](README.md) | [更新日志](CHANGELOG.md) | [参与贡献](CONTRIBUTING.md)

</div>

---

## 📖 项目简介

[DeepSeek Harness (`dsh`)](https://github.com/deepseek-ai/deepseek-harness) 是由 DeepSeek 官方开源的新一代智能体运行时（采用 Everything-is-a-Plugin 架构，基于 Cordis 核心驱动）。

由于官方目前出于本地单机开发的安全考虑，Web 服务强制绑定 `127.0.0.1` 回环地址，导致直接在 NAS、私有云或远程服务器部署时外部网络无法访问。

**本项目旨在提供全套开箱即用的工程化容器方案**：
- 完美解决局域网/公网访问痛点；
- 保持与官方上游版本严格同步（当前已对齐 **`v0.1.6-alpha.1`**）；
- 提供自动化云端多架构构建、安全沙箱隔离以及针对 Unraid、飞牛 fnOS、群晖等平台的专属模板。

---

## 🌟 核心特性

- 🚀 **突破回环访问限制**：内置轻量原生 Node.js 流式反向代理，无缝桥接并完整支持 HTTP 与 WebSocket 协议，无需手动折腾外部 Nginx 即可从局域网或内网穿透直接访问。
- 📦 **全自动多架构支持**：由 GitHub Actions 驱动自动化构建，提供 `linux/amd64` 与 `linux/arm64` 原生镜像，免除在低功耗 NAS 上本地编译的高昂耗时。
- 🏷️ **版本严格对齐上游**：镜像版本标签与上游官方源码发布严格对应，杜绝环境碎片化。
- 🛡️ **沙箱与权限隔离**：预设容器安全规范，将智能体运行时操作目录 (`/workspace`) 与核心配置密钥目录 (`/root/.dsh`) 清晰解耦，保障宿主机数据资产安全。
- 🖥️ **全系 NAS 深度适配**：自带开箱即用的 Unraid CA XML 模板与 Docker Compose 部署模版。

---

## 🚀 快速上手

### 方式一：Docker Compose（推荐）

在服务器或 NAS 上创建 `docker-compose.yml`：

```yaml
services:
  deepseek-harness:
    image: ghcr.io/deltrivx/deepseek-harness:v0.1.6-alpha.1 # 或 latest
    container_name: deepseek-harness
    restart: unless-stopped
    ports:
      - "3080:3080" # Web UI 外部访问端口
    environment:
      - TZ=Asia/Shanghai
      - PORT=3080
      - DSH_PORT=3018
    volumes:
      - ./data:/root/.dsh        # DSH 核心配置、密钥与插件持久化
      - ./workspace:/workspace   # 供智能体读写代码与文件的根工作区
    working_dir: /workspace
```

启动服务：
```bash
docker compose up -d
```

---

### 方式二：Docker CLI 单行运行

```bash
docker run -d \
  --name deepseek-harness \
  --restart unless-stopped \
  -p 3080:3080 \
  -e TZ=Asia/Shanghai \
  -v /mnt/user/appdata/deepseek-harness/data:/root/.dsh \
  -v /mnt/user/appdata/deepseek-harness/workspace:/workspace \
  ghcr.io/deltrivx/deepseek-harness:v0.1.6-alpha.1
```

启动完成后，打开浏览器访问：`http://<宿主机IP>:3080` 即可畅享 DeepSeek Harness。

> 本镜像的 WebUI 代理会自动监听 `0.0.0.0:3080`，因此不需要额外配置 Nginx、域名或反向代理；在局域网内直接访问 `http://<宿主机IP>:3080` 即可。代理还会把页面标题统一显示为 **DeepSeek Harness**，并处理浏览器断开连接时的上游 `ECONNRESET`，避免配置页或设置页被连接重置打断。

> 配置文件与凭据保存在 `/root/.dsh` 挂载目录中。Unraid 没有桌面文本编辑器时，“打开配置文件”无法调用宿主机原生编辑器；本镜像提供浏览器编辑回退地址：先登录 WebUI，再访问 `http://<宿主机IP>:3080/__dsh-config`。保存前会自动创建 `settings.yaml.bak-*` 备份。不要在 Unraid 模板中覆盖 `/entrypoint.sh` 或 `/app/proxy.cjs`，否则旧的启动脚本可能覆盖镜像内已修复的代理。

---

## ⚙️ 持久化目录与存储设计

| 宿主机推荐路径 | 容器内挂载点 | 读写权限 | 作用与说明 |
| :--- | :--- | :--- | :--- |
| `appdata/deepseek-harness/data` | `/root/.dsh` | `rw` | 存放模型提供商配置、API 密钥、插件配置与持久化状态 |
| `appdata/deepseek-harness/workspace` | `/workspace` | `rw` | 智能体工作目录，可挂载你的本地项目仓库供其分析与编写代码 |

---

## 🧩 Unraid 平台快速安装

1. 将仓库 `templates/unraid-template.xml` 导入 Unraid 的 Docker 模板目录，或通过 Community Applications 模板安装。
2. 镜像地址填写：`ghcr.io/deltrivx/deepseek-harness:latest`。
3. 容器图标已自动关联 256x256 高清 PNG 图标（避免 Unraid 无法解析 SVG 导致图标变问号），保持原生美观统一。

---

## 🎨 自定义 WebUI 背景（可选）

上游 DSH 目前只提供明暗主题与字号设置，**不支持背景图**。本镜像在局域网代理层提供了可选的背景能力：

1. 把任意一张图片放到持久化目录，命名为 `background.jpg`（Unraid 示例：`/mnt/user/appdata/deepseek-harness/data/background.jpg`）。
2. 重启容器，浏览器硬刷新（`Cmd/Ctrl + Shift + R`）即可生效。

可用环境变量：

| 变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `DSH_BACKGROUND_FILE` | `/root/.dsh/background.jpg` | 背景图路径，支持 jpg/png/webp/gif/svg（≤ 32 MB） |
| `DSH_BACKGROUND_URL` | 空 | 外部图片 URL，非空时优先于本地文件 |
| `DSH_BACKGROUND_SIZE` | `cover` | `cover` / `contain` / `auto` |
| `DSH_BACKGROUND_POSITION` | `center` | 同 CSS `background-position` |
| `DSH_BACKGROUND_LAYER_ALPHA` | `0.72` | 零配置场景下的默认不透明度 0–1，越小背景越明显。**在面板里保存过配置后一律以面板为准** |
| `DSH_BACKGROUND_DIM` | `0` | 压暗背景 0–0.9，用于提升文字可读性 |
| `DSH_BACKGROUND_BLUR` | `0` | 壁纸柔化（对壁纸本身做模糊）0–40，0 为关闭 |
| `DSH_BACKGROUND_ENABLED` | `auto` | `auto` / `true` / `false`，`false` 强制关闭 |
| `DSH_BACKGROUND_CSS` | 空 | 高级：自定义 CSS 文件路径，存在时完全替换默认注入 |

> 实现方式是覆盖上游的颜色类主题变量并配合 `!important`，明暗主题切换不受影响。
> 外观样式**只改颜色** —— 尺寸、间距、`display`、`flex` 等几何属性只允许出现在壁纸自己的 `html::before` 图层里，页面元素上不会出现任何一条，也完全不用 `backdrop-filter`。因此开启背景不会改动原生布局：在桌面 1440（空会话与有正文）与移动 390 下逐元素比对开关前后的位置与尺寸，结果均为 0 处改动。
> 若图片文件不存在且未配置 URL，代理**不会注入任何内容**，行为与官方镜像完全一致。

### 🪄 页面内外观面板（推荐）

主页面右下角有一个「外观」悬浮按钮，点开即可直接调节背景与透明度：

- **背景开关**、**圆角面板**、**整体不透明度**（大面积底层）、**侧栏 / 面板不透明度**（侧栏、菜单、气泡、卡片）、**壁纸柔化**、**壁纸压暗**、**填充方式**、**位置**
- 高级项还包含配置页底色、输入框底色等
- 两项不透明度相互独立：把「整体」调低让壁纸透出来，同时把「侧栏 / 面板」保持在较高值，侧栏文字依然清晰
- **拖动即时预览**（不写盘、不刷新），点「保存」后写入持久化目录，重建容器也不丢
- 「换图」可直接上传本地图片替换 `background.jpg`（≤ 32 MB，校验 JPEG/PNG/GIF/WebP）
- 「还原」回到上次保存的值，「重置」回到内置默认

保存与上传需要已登录（复用 WebUI 的登录态），未登录只能本地预览。配置保存在 `appearance.json`（与 `background.jpg` 同级）。

> 从旧版本升级时，`appearance.json` 会在首次加载时自动迁移：已废弃的模糊字段会被丢弃，两项不透明度会恢复为默认值 —— 旧版「侧栏不透明度」的语义与现在相反，沿用旧值（例如 0.14）会让侧栏几乎看不见。背景开关、柔化、压暗、填充方式与位置都会保留。

新增路由：

| 路由 | 说明 |
| :--- | :--- |
| `GET /__dsh-appearance.css` | 输出当前外观样式；带 query 参数时可实时预览 |
| `GET /__dsh-appearance` | 读取已保存配置（需登录） |
| `POST /__dsh-appearance` | 保存配置（需登录） |
| `POST /__dsh-appearance/background` | 上传背景图（需登录） |

> 配色计算始终只在服务端做一份，前端面板只是重新拼一次样式表地址，不会出现前后端算得不一样的情况。

### 快速微调（免重建、免重启）

在配置目录放一个 `background.css`（与 `background.jpg` 同级），内容会**追加**在默认样式之后，可以覆盖任意规则。改完直接硬刷新浏览器即可，不用重启容器、更不用重新构建镜像：

```css
/* 例：让侧栏再暗一层，并把正文区域完全透明 */
body > * { --dsw-specific-sidebar-fill: rgba(0, 0, 0, 0.55) !important; }
[class*="markdown"] { background-color: transparent !important; }
```

若希望**完全接管**而不是追加，用 `DSH_BACKGROUND_CSS` 指定另一个文件路径，此时默认样式不再生成。该文件缺失时会自动回落到内置样式，不会让外观整体失效。

> 手写 CSS 是自己写的，所以要自己守住「只改颜色」这条线。CI 里那道校验只覆盖内置样式，不校验手写文件。

---

## 🛠️ 项目结构

```text
deepseek-harness/
├── .github/
│   └── workflows/
│       └── docker-build-ghcr.yml   # 自动化多架构构建与多版本发布工作流
├── assets/
│   └── icon.png                    # 256x256 高清点阵图标（完美兼容 NAS 与各平台）
├── docker/
│   ├── Dockerfile                  # Node 22 环境与多阶段纯净构建定义
│   ├── entrypoint.sh               # 容器初始化守护进程
│   └── proxy.js                    # 轻量 HTTP/WebSocket 网络桥接代理
├── templates/
│   ├── docker-compose.yml          # 开箱即用 Compose 模板
│   └── unraid-template.xml         # Unraid 官方规范容器应用模板
├── CHANGELOG.md                    # 版本演进记录
├── CONTRIBUTING.md                 # 开发者贡献规范
├── README.md                       # 中文完整指南
├── README.en.md                    # 英文文档
└── LICENSE                         # MIT 许可证
```

---

## 🤝 参与贡献与开发

欢迎提交 Issue 和 Pull Request！
在提交 PR 之前，请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 📄 鸣谢与许可

- 本项目采用 [MIT License](LICENSE) 开源。
- DeepSeek Harness 核心属于 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 团队所有。
