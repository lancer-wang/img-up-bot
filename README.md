# Telegram 图床上传机器人 (基于 Cloudflare Workers)

这是一个部署在 Cloudflare Workers 上的 Telegram 机器人。它可以接收您发送到 Telegram 的图片、视频、音频、文档等多种文件，并将它们自动上传到您指定的图床或对象存储服务（需要有公开的上传接口），然后将生成的公开链接返回给您。

本项目利用 Cloudflare Workers 的 Serverless 特性，可以实现低成本甚至免费（在 Cloudflare 免费额度内）运行。

## ✨ 功能特性

*   **自动上传**: 直接向机器人发送文件即可触发上传。
*   **多种文件支持**: 支持400多种文件格式，包括常见的图片、视频、音频、文档、压缩包、可执行文件等。
*   **文件大小限制**: 支持最大20Mb的文件上传（受Telegram Bot自身限制）。
*   **配置灵活**: 通过 Cloudflare 环境变量和 Secrets 配置图床地址、Bot Token 和可选的认证信息。
*   **部署简单**: 基于 Cloudflare Workers，部署流程相对简单。
*   **低成本**: 利用 Cloudflare 的免费套餐额度。
*   **安全**: 敏感信息（如 Bot Token、认证代码）通过 Secrets 管理，更加安全。
*   **一键设置Webhook**: 内置Webhook配置端点，简化机器人设置过程。

## 📋 支持的文件格式类别

*   **🖼️ 图像**: jpg, png, gif, webp, svg, bmp, tiff, heic, raw...
*   **🎬 视频**: mp4, avi, mov, mkv, webm, flv, rmvb, m4v...
*   **🎵 音频**: mp3, wav, ogg, flac, aac, m4a, wma, opus...
*   **📝 文档**: pdf, doc(x), xls(x), ppt(x), txt, md, epub...
*   **🗜️ 压缩**: zip, rar, 7z, tar, gz, xz, bz2...
*   **⚙️ 可执行**: exe, msi, apk, ipa, deb, rpm, dmg...
*   **🌐 网页/代码**: html, css, js, ts, py, java, php, go...
*   **🎨 3D/设计**: obj, fbx, blend, stl, psd, ai, sketch...
*   **📊 数据/科学**: mat, hdf5, parquet, csv, json, xml...

总计支持超过400种文件格式！

## 🚀 工作原理

1.  用户在 Telegram 中向此机器人发送文件(图片、视频、音频、文档等)。
2.  Telegram 将包含文件信息的更新（Update）通过 Webhook 发送到 Cloudflare Worker 的 URL。
3.  Cloudflare Worker 脚本被触发，解析收到的更新。
4.  Worker 使用 Telegram Bot API 下载用户发送的文件。
5.  Worker 将下载的文件上传到在环境变量 `IMG_BED_URL` 中配置的图床地址，（如果配置了 `AUTH_CODE`）会携带相应的认证参数。
6.  Worker 解析图床返回的响应，提取公开的文件链接。
7.  Worker 使用 Telegram Bot API 将获取到的文件链接发送回给用户。

## 🔧 环境要求

*   **一个 Telegram Bot**: 需要通过 [BotFather](https://t.me/BotFather) 创建，并获取其 **Bot Token**。
*   **一个图床/对象存储服务**:
    *   需要提供一个公开的 **文件上传接口 URL** (`IMG_BED_URL`)。
    *   如果该接口需要认证，需要获取相应的 **认证代码** (`AUTH_CODE`)。支持URL参数和Bearer Token认证方式。
*   **一个 Cloudflare 账户**: 免费账户即可开始。

## 🛠️ 部署与配置步骤

1.  **创建 Telegram Bot**:
    *   在 Telegram 中与 [@BotFather](https://t.me/BotFather) 对话。
    *   发送 `/newbot` 命令，按照提示设置机器人的名称和用户名。
    *   **记下 BotFather 返回的 `HTTP API token`**，这就是您的 `BOT_TOKEN`。

2.  **准备图床信息**:
    *   确定您的图床或对象存储服务的**上传接口 URL**。注意：图床上传端点通常为 `/upload`，如 `https://your.domain/upload`。这将是 `IMG_BED_URL` 的值。
    *   如果上传需要认证码，**获取该认证码**。这将是 `AUTH_CODE` 的值。如果不需要认证，则此项为空。

3.  **Fork本项目**:
    *   Fork本仓库。

4.  **部署 Cloudflare Worker 方法**:

    **方法一：通过 Cloudflare Dashboard 导入 GitHub 仓库 (推荐)**
    
    * 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
    * 点击 Workers & Pages -> 创建应用程序 -> 连接 Git
    * 选择 GitHub 并授权 Cloudflare 访问您的 GitHub 帐户
    * 选择您 fork 的仓库 -> 选择"Pages"部署类型
    * 在"构建设置"部分:
      - 构建命令：留空
      - 构建输出目录：留空
      - 根目录：留空
    * 在"环境变量"部分添加必要的变量（见下面的第5步）
    * 点击"保存并部署"
    * 部署完成后，记下您的 Worker URL（例如 `https://img-up-bot-xxxx.pages.dev`）
    
    **方法二：使用 Wrangler CLI**
    
    * 安装 [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)：`npm install -g wrangler`
    * 登录 Cloudflare：`wrangler login`
    * 克隆您 fork 的仓库：`git clone https://github.com/你的用户名/img-up-bot.git`
    * 进入项目目录：`cd img-up-bot`
    * 修改项目中的 `wrangler.toml` 文件，设置您自己的 Worker 名称
    * 部署 Worker：`wrangler deploy`
    
    **方法三：通过 Cloudflare Dashboard 手动创建**
    
    * 登录 Cloudflare -> Workers & Pages -> 创建应用程序 -> 创建Worker
    * 将 `worker.js` 文件的内容复制到编辑器中
    * 点击"部署"
    * 记下部署成功后的 Worker URL（例如 `https://your-worker-name.your-subdomain.workers.dev`）

5.  **设置环境变量 (关键步骤)**:

    **通过 Cloudflare Dashboard**
    
    * 登录 Cloudflare -> Workers & Pages -> 您的 Worker -> 设置 -> 变量 -> 添加变量
    * 添加以下变量(选择Secret类型)：
        * `BOT_TOKEN`: 您的Telegram Bot Token
        * `IMG_BED_URL`: 您的图床上传URL
        * `AUTH_CODE`: 您的图床认证码（如果需要）
    * 点击"保存并部署"

6.  **设置 Telegram Webhook**:

    **方法一：使用内置的Webhook设置功能 (推荐)**
    
    *   在浏览器中访问：`https://your-worker-name.your-subdomain.workers.dev/setup-webhook`
    *   如果看到"Webhook设置成功"的消息，说明配置已完成
    
    **方法二：手动设置**
    
    *   在浏览器中访问以下链接（替换对应的值）：
        ```
        https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=<YOUR_WORKER_URL>
        ```
    *   如果显示 `{"ok":true,"result":true,"description":"Webhook was set"}` 或类似信息，则表示设置成功。

## 💬 使用说明

1. 发送 `/start` 启动机器人（仅首次需要）。
2. 直接发送图片、视频、音频、文档或其他文件，机器人会自动处理上传。
3. 支持最大20Mb的文件上传（受Telegram Bot限制）。
4. 支持400多种文件格式，包括常见的图片、视频、音频、文档、压缩包、可执行文件等。
5. 使用 `/formats` 命令查看支持的文件格式类别。

## 设置机器人命令菜单 (可选)

为了让用户在 Telegram 中更方便地使用命令，您可以通过 BotFather 设置命令列表：

1.  在 Telegram 中再次与 [@BotFather](https://t.me/BotFather) 对话。
2.  发送 `/setcommands` 命令。
3.  按照提示，选择您刚刚部署配置好的机器人。
4.  **直接发送以下文本**：
    ```
    start - 启用机器人
    help - 查看帮助信息
    formats - 查看支持的文件格式类别
    ```
5.  设置成功后，用户在与您的机器人对话时，点击 `/` 按钮就能看到这些预设的命令选项了。

## 常见问题排查

1. **机器人不响应命令**
   * 确认环境变量是否正确设置
   * 访问 `/setup-webhook` 端点重新配置Webhook
   * 检查 Cloudflare Worker 的日志以查看详细错误信息

2. **上传失败**
   * 确认图床URL是否包含正确的上传路径（通常为 `/upload`）
   * 验证认证码是否有效
   * 检查图床服务是否有文件大小或类型限制

3. **需要更新机器人**
   * 修改代码后，重新部署Worker：`wrangler deploy`
   * 检查环境变量是否需要更新

## 版权说明

本项目为原创项目，开源协议遵循 MIT License。

如需对本项目进行二次修改或分发，请遵循以下要求：
1. 保留原项目的版权信息
2. 在文档中标明原项目地址：https://github.com/uki0xc/img-up-bot
3. 标明修改内容与原作者信息

作者：[@uki0x](https://github.com/uki0xc)  
邮箱：a@vki.im  
Telegram：[@uki0x](https://t.me/uki0x)

