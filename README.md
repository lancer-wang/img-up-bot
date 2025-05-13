# Telegram 图床上传机器人 (基于 Cloudflare Workers)

这是一个部署在 Cloudflare Workers 上的 Telegram 机器人。它可以接收您发送到 Telegram 的图片和视频文件，并将它们自动上传到您指定的图床或对象存储服务（需要有公开的上传接口），然后将生成的公开链接返回给您。

本项目利用 Cloudflare Workers 的 Serverless 特性，可以实现低成本甚至免费（在 Cloudflare 免费额度内）运行。

## ✨ 功能特性

*   **自动上传**: 直接向机器人发送图片或视频即可触发上传。
*   **支持多种文件格式**: 可处理图片、视频、音频、GIF动画及各类文档文件。
*   **配置灵活**: 通过 Cloudflare 环境变量和 Secrets 配置图床地址、Bot Token 和可选的认证信息，无需修改代码。
*   **部署简单**: 基于 Cloudflare Workers，部署流程相对简单。
*   **低成本**: 利用 Cloudflare 的免费套餐额度。
*   **安全**: 敏感信息（如 Bot Token、认证代码）通过 Secrets 管理，更加安全。
*   **一键设置Webhook**: 内置Webhook配置端点，简化机器人设置过程。

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

    **方法一：使用 Wrangler CLI (推荐)**
    
    * 安装 [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)：`npm install -g wrangler`
    * 登录 Cloudflare：`wrangler login`
    * 修改项目中的 `wrangler.toml` 文件，设置您自己的 Worker 名称
    * 部署 Worker：`wrangler deploy`
    
    **方法二：通过 Cloudflare Dashboard**
    
    *   登录 Cloudflare -> Workers & Pages -> 创建应用程序 -> 创建Worker
    *   将 `worker.js` 文件的内容复制到编辑器中
    *   点击"部署"
    *   记下部署成功后的 Worker URL（例如 `https://your-worker-name.your-subdomain.workers.dev`）

5.  **设置环境变量 (关键步骤)**:

    **通过 Cloudflare Dashboard**
    
    *   登录 Cloudflare -> Workers & Pages -> 您的 Worker -> Settings -> Variables -> Add variable
    *   添加以下变量(选择Secret类型)：
        * `BOT_TOKEN`: 您的Telegram Bot Token
        * `IMG_BED_URL`: 您的图床上传URL
        * `AUTH_CODE`: 您的图床认证码（如果需要）
    *   点击"保存并部署"

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

## 💬 如何使用

1.  在 Telegram 中搜索您创建的机器人的用户名，并开始对话。
2.  发送 `/start` 命令给机器人（通常只需要第一次）。
3.  发送 `/help` 命令可以查看简单的使用说明。
4.  直接发送图片、视频、音频或文档文件给机器人。
5.  机器人会显示"正在处理"的消息，完成后会更新为上传成功的链接。

## 设置机器人命令菜单 (可选)

为了让用户在 Telegram 中更方便地使用 `/start` 和 `/help` 命令（例如通过点击输入框旁边的 `/` 按钮），您可以通过 BotFather 设置命令列表。这能提供命令提示，改善用户体验。

1.  在 Telegram 中再次与 [@BotFather](https://t.me/BotFather) 对话。
2.  发送 `/setcommands` 命令。
3.  按照提示，选择您刚刚部署配置好的机器人。
4.  **直接发送以下文本**（确保命令和描述之间有空格和连字符，并且每个命令占一行，可以进行修改）：
    ```
    start - 启用机器人
    help - 查看帮助信息
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

修改需要注明原项目地址！
