# Telegram 图床上传机器人 (基于 Cloudflare Workers)

这是一个部署在 Cloudflare Workers 上的 Telegram 机器人。它可以接收您发送到 Telegram 的图片、视频、音频、文档等多种文件，并将它们自动上传到您指定的图床或对象存储服务（需要有公开的上传接口），然后将生成的公开链接返回给您。

本项目利用 Cloudflare Workers 的 Serverless 特性，可以实现低成本甚至免费（在 Cloudflare 免费额度内）运行。

## ✨ 功能特性

*   **自动上传**: 直接向机器人发送文件即可触发上传。
*   **多种文件支持**: 支持400多种文件格式，包括常见的图片、视频、音频、文档、压缩包、可执行文件等。
*   **文件大小限制**: 支持最大20Mb的文件上传（受Telegram Bot自身限制）。
*   **分片上传功能**: 
    * 突破Telegram 20MB的文件大小限制
    * 通过分割大文件为多个分片上传后合并
    * 支持断点续传和取消上传
    * 使用 `/chunk_upload` 命令启动分片上传
*   **文件备注功能**: 在发送文件时添加描述文字作为备注，方便后续查找和整理。
*   **配置灵活**: 通过 Cloudflare 环境变量和 Secrets 配置图床地址、Bot Token 和可选的认证信息。
*   **部署简单**: 基于 Cloudflare Workers，部署流程相对简单。
*   **低成本**: 利用 Cloudflare 的免费套餐额度。
*   **安全**: 敏感信息（如 Bot Token、认证代码）通过 Secrets 管理，更加安全。
*   **一键设置Webhook**: 内置Webhook配置端点，简化机器人设置过程。
*   **上传历史管理**: 支持查看、搜索和删除历史上传记录，并提供文件类型筛选和分页浏览功能。
*   **统计分析功能**:
    * 用户上传文件数量和总大小统计
    * 每日/每周/每月使用报告
    * 图床存储使用情况监控
    * 上传成功率分析
*   **管理员模式**:
    * 用户权限控制（限制/解除限制用户）
    * 用户列表管理与监控
    * 机器人使用统计查看
    * 管理员广播消息功能
    * 自动清理旧内容功能（可设置天数）

## 📅 预期功能（开发中）

<details>
<summary>点击展开/折叠预期功能详情</summary>

*   **自定义上传参数**:
    * 允许用户设置图床的自定义参数（如水印、存储路径、保留时间）
    * 支持文件上传前预设参数模板
    * 通过命令更改默认上传参数
    
*   **文件处理增强**:
    * 图片压缩与调整大小选项
    * 视频转换为GIF或其他常用格式
    * 批量图片格式转换
    * 文件重命名与元数据编辑
    
*   **批量上传支持**:
    * 一次性处理多个文件的上传请求
    * 文件组管理与批量操作
    * 上传队列管理与优先级设置
</details>

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
5.  Worker 将下载的文件上传到在环境变量 `IMG_BED_URL` 中配置的图床地址，（如果配置了 `AUTH_CODE`)会携带相应的认证参数。
6.  Worker 解析图床返回的响应，提取公开的文件链接。
7.  Worker 使用 Telegram Bot API 将获取到的文件链接发送回给用户。
8.  Worker 将上传统计数据存储到 KV 存储中，用于生成统计报告。

## 🔧 环境要求

<details>
<summary>点击展开/折叠环境要求详情</summary>

*   **一个 Telegram Bot**: 需要通过 [BotFather](https://t.me/BotFather) 创建，并获取其 **Bot Token**。
*   **一个图床/对象存储服务**:
    *   需要提供一个公开的 **文件上传接口 URL** (`IMG_BED_URL`)。
    *   如果该接口需要认证，需要获取相应的 **认证代码** (`AUTH_CODE`)。支持URL参数和Bearer Token认证方式。
*   **一个 Cloudflare 账户**: 免费账户即可开始。
*   **Cloudflare KV 存储**: 用于存储用户统计数据（如需使用统计功能）。
</details>

## 🛠️ 部署与配置步骤

<details>
<summary>点击展开/折叠部署与配置详情</summary>

1.  **创建 Telegram Bot**:
    *   在 Telegram 中与 [@BotFather](https://t.me/BotFather) 对话。
    *   发送 `/newbot` 命令，按照提示设置机器人的名称和用户名。
    *   **记下 BotFather 返回的 `HTTP API token`**，这就是您的 `BOT_TOKEN`。

2.  **准备图床信息**:
    *   确定您的图床或对象存储服务的**上传接口 URL**。注意：图床上传端点通常为 `/upload`，如 `https://your.domain/upload`。这将是 `IMG_BED_URL` 的值。
    *   如果上传需要认证码，**获取该认证码**。这将是 `AUTH_CODE` 的值。如果不需要认证，则此项为空。

3.  **创建 KV 命名空间（用于统计功能）**:
    *   登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
    *   点击 "Workers & Pages" -> "KV" -> "创建命名空间"
    *   输入名称，例如 "STATS_STORAGE"
    *   创建后，**记下命名空间 ID**，稍后需要将其添加到配置中

4.  **Fork本项目**:
    *   Fork本仓库。

5.  **部署 Cloudflare Worker 方法**:

    **方法一：通过 Cloudflare Dashboard 导入 GitHub 仓库 (推荐)**
    
    * 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
    * 点击 Workers & Pages -> 创建应用程序 -> 连接 Git
    * 选择 GitHub 并授权 Cloudflare 访问您的 GitHub 帐户
    * 选择您 fork 的仓库 -> 选择"Pages"部署类型
    * 在"构建设置"部分:
      - 构建命令：留空
      - 构建输出目录：留空
      - 根目录：留空
    * 在"环境变量"部分添加必要的变量（见下面的第6步）
    * 点击"保存并部署"
    * 部署完成后，记下您的 Worker URL（例如 `https://img-up-bot-xxxx.pages.dev`）
    
    **方法二：使用 Wrangler CLI**
    
    * 安装 [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)：`npm install -g wrangler`
    * 登录 Cloudflare：`wrangler login`
    * 克隆您 fork 的仓库：`git clone https://github.com/你的用户名/img-up-bot.git`
    * 进入项目目录：`cd img-up-bot`
    * 修改项目中的 `wrangler.toml` 文件：
      - 设置您自己的 Worker 名称
      - 更新 KV 命名空间配置，将之前创建的命名空间 ID 填入：
      ```toml
      [[kv_namespaces]]
      binding = "STATS_STORAGE"
      id = "您的KV命名空间ID"
      ```
    * 部署 Worker：`wrangler deploy`
    
    **方法三：通过 Cloudflare Dashboard 手动创建**
    
    * 登录 Cloudflare -> Workers & Pages -> 创建应用程序 -> 创建Worker
    * 将 `worker.js` 文件的内容复制到编辑器中
    * 点击"部署"
    * 记下部署成功后的 Worker URL（例如 `https://your-worker-name.your-subdomain.workers.dev`）

6.  **设置环境变量 (关键步骤)**:

    **通过 Cloudflare Dashboard**
    
    * 登录 Cloudflare -> Workers & Pages -> 您的 Worker -> 设置 -> 变量 -> 添加变量
    * 添加以下变量(选择Secret类型)：
        * `BOT_TOKEN`: 您的Telegram Bot Token
        * `IMG_BED_URL`: 您的图床上传URL
        * `AUTH_CODE`: 您的图床认证码（如果需要）
        * `ADMIN_USERS`: 管理员用户ID列表，多个ID用逗号分隔（例如：`123456789,987654321`）
    * 添加 KV 命名空间绑定:
        * 变量名：`STATS_STORAGE`
        * KV 命名空间：选择之前创建的命名空间
    * 点击"保存并部署"

7.  **设置 Telegram Webhook**:

    **方法一：使用内置的Webhook设置功能 (推荐)**
    
    *   在浏览器中访问：`https://your-worker-name.your-subdomain.workers.dev/setup-webhook`
    *   如果看到"Webhook设置成功"的消息，说明配置已完成
    
    **方法二：手动设置**
    
    *   在浏览器中访问以下链接（替换对应的值）：
        ```
        https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=<YOUR_WORKER_URL>
        ```
    *   如果显示 `{"ok":true,"result":true,"description":"Webhook was set"}` 或类似信息，则表示设置成功。
</details>

## 💬 使用说明

<details>
<summary>点击展开/折叠使用说明详情</summary>

1. 发送 `/start` 启动机器人（仅首次需要）。
2. 直接发送图片、视频、音频、文档或其他文件，机器人会自动处理上传。
3. 要添加文件备注，在发送文件时添加文字描述（在 Telegram 中发送文件时直接输入描述文字即可）。
4. 支持最大20Mb的文件上传（受Telegram Bot限制）。
5. 支持400多种文件格式，包括常见的图片、视频、音频、文档、压缩包、可执行文件等。
6. 使用 `/formats` 命令查看支持的文件格式类别。
7. 使用 `/analytics` 命令查看所有统计分析功能（支持多种参数）。
8. 使用 `/history` 命令管理您的上传历史记录：
   - `/history search:关键词` - 可按文件名或备注内容搜索
   - `/history desc:关键词` - 专门按备注内容搜索
9. 使用分片上传功能上传大文件（超过20MB）:
   - 首先将大文件分割成多个小于20MB的分片（可使用文件分割工具如7-Zip、WinRAR等）
   - 发送命令：`/chunk_upload 5 large_video.mp4 这是我的大视频`
     * 5是分片数量
     * large_video.mp4是最终文件名
     * "这是我的大视频"是文件描述（可选）
   - 按照机器人的提示，逐个发送所有分片
   - 等待机器人合并和上传文件
   - 获取最终的URL
   - 随时可以使用 `/chunk_cancel` 取消正在进行的分片上传
</details>

## 📊 统计分析功能

<details>
<summary>点击展开/折叠统计分析功能详情</summary>

本机器人内置了完整的统计分析功能，可帮助用户了解他们的文件上传历史和存储使用情况：

### 统一的分析命令

使用统一的 `/analytics` 命令可以查看所有类型的统计信息：

* `/analytics` - 显示综合统计信息和命令帮助
* `/analytics storage` - 显示存储使用情况
* `/analytics report` - 显示月度使用报告  
* `/analytics daily` - 显示日报告
* `/analytics weekly` - 显示周报告
* `/analytics monthly` - 显示月报告
* `/analytics success` - 显示上传成功率分析

### 统计功能详情

1. **综合统计信息**
   * 总上传文件数量
   * 总存储空间使用量
   * 成功/失败上传数量
   * 上传成功率
   * 按文件类型的分布统计

2. **存储使用情况**
   * 总存储空间
   * 平均文件大小
   * 存储使用趋势

3. **使用报告（日/周/月）**
   * 显示指定时间段内的上传数量和大小
   * 日报告：当天数据
   * 周报告：过去7天数据
   * 月报告：过去30天数据

4. **上传成功率分析**
   * 总体成功率
   * 按文件类型分类的上传数量
   * 使用频率趋势

### 技术实现

* 统计数据存储在 Cloudflare KV 中，按用户ID分开保存
* 每次文件上传完成后自动更新统计数据
* 跟踪文件类型、大小、上传成功/失败状态
* 按日期记录使用数据，保留最近60天的记录
</details>

## 📋 上传历史管理

<details>
<summary>点击展开/折叠上传历史管理详情</summary>

本机器人内置上传历史管理功能，能够帮助用户快速查找、管理之前上传的所有文件：

### 基本功能

* `/history` - 查看所有上传历史记录
* `/history page2` - 查看第2页历史记录（每页显示5条记录）
* `/history image` - 只查看图片类型的历史记录
* `/history video` - 只查看视频类型的历史记录
* `/history search:关键词` - 按文件名或备注搜索历史记录
* `/history desc:关键词` - 专门按备注内容搜索历史记录
* `/history delete_记录ID` - 删除指定ID的历史记录

### 历史记录信息

每条历史记录会显示以下信息：
* 文件名
* 文件类型（带图标标识）
* 备注信息（如果有）
* 上传时间（精确到分钟）
* 文件大小
* 文件URL链接
* 记录ID（用于删除操作）

### 技术实现

* 历史记录存储在 Cloudflare KV 中，按用户ID分开保存
* 每次成功上传文件后自动添加到历史记录
* 最多保存最近100条记录，超过后自动清理最早的记录
* 支持按文件类型和文件名关键词筛选
* 支持专门按备注内容搜索
* 分页显示，避免消息过长
</details>

## 👮‍♂️ 管理员功能

<details>
<summary>点击展开/折叠管理员功能详情</summary>

本机器人提供完整的管理员模式，让管理员可以控制机器人的使用权限，监控使用情况并与用户互动。管理员功能受到严格的权限控制，只有在环境变量中配置的管理员用户ID才能访问。

### 管理员设置

在环境变量中设置 `ADMIN_USERS` 变量，填入管理员的 Telegram 用户ID，多个ID用逗号分隔，例如：
```
ADMIN_USERS=123456789,987654321
```

### 管理员命令

* `/admin` - 显示管理员命令面板

### 用户权限管理

* `/admin ban [用户ID]` - 限制指定用户使用机器人
* `/admin unban [用户ID]` - 解除对指定用户的限制
* `/admin list` - 查看所有被限制的用户

### 用户监控

* `/admin users [页码]` - 查看所有使用过机器人的用户（带分页功能）
  - 显示用户ID、用户名、首次使用时间、最后使用时间
  - 每个用户的上传统计和存储使用情况
  - 显示用户状态（正常/已限制）

### 系统统计

* `/admin stats` - 查看机器人使用统计
  - 总用户数
  - 总上传文件数
  - 总上传大小
  - 被限制用户数

### 消息广播

* `/admin broadcast [消息]` - 向所有用户广播消息
  - 可用于发布通知、更新信息或维护预告

### 自动清理功能

* `/admin autoclean [天数]` - 设置自动删除多少天前的内容
  - 设置为0可禁用自动清理功能
  - 系统会每隔6小时自动检查并执行清理操作
  - 设置后会立即执行一次清理并显示结果
* `/admin autoclean status` - 查看当前自动清理设置
  - 显示是否启用、设置的天数、上次更新时间等信息

### 安全措施

* 管理员命令权限验证 - 只有配置的管理员用户ID才能使用管理员命令
* 被限制的用户无法使用机器人功能，但管理员不受此限制
* 用户操作日志记录，便于审计和排查问题

</details>

## 设置机器人命令菜单 (可选)

<details>
<summary>点击展开/折叠命令菜单设置详情</summary>

为了让用户在 Telegram 中更方便地使用命令，您可以通过 BotFather 设置命令列表：

1.  在 Telegram 中再次与 [@BotFather](https://t.me/BotFather) 对话。
2.  发送 `/setcommands` 命令。
3.  按照提示，选择您刚刚部署配置好的机器人。
4.  **直接发送以下文本**：
    ```
    start - 启用机器人
    help - 查看帮助信息
    formats - 查看支持的文件格式类别
    analytics - 查看统计分析 [storage/report/daily/weekly/monthly/success]
    history - 查看和管理上传历史记录
    chunk_upload - 启动分片上传模式（上传大文件）
    chunk_cancel - 取消当前分片上传
    ```
5.  设置成功后，用户在与您的机器人对话时，点击 `/` 按钮就能看到这些预设的命令选项了。
</details>

## 常见问题排查

<details>
<summary>点击展开/折叠常见问题详情</summary>

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
</details>

## 版权说明

本项目为原创项目，开源协议遵循 MIT License。

如需对本项目进行二次修改或分发，请遵循以下要求：
1. 保留原项目的版权信息
2. 在文档中标明原项目地址：https://github.com/uki0xc/img-up-bot
3. 标明修改内容与原作者信息

作者：[@uki0x](https://github.com/uki0xc)  
邮箱：a@vki.im  
Telegram：[@uki0x](https://t.me/uki0x)

