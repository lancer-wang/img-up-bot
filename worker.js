export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  }
};

// 主要处理逻辑函数，现在接收 env 对象作为参数
async function handleRequest(request, env) {
  const IMG_BED_URL = env.IMG_BED_URL;
  const BOT_TOKEN = env.BOT_TOKEN;
  const AUTH_CODE = env.AUTH_CODE; // 可选的认证代码
  const ADMIN_CHAT_ID = env.ADMIN_CHAT_ID; // 可选，用于接收错误通知

  // 检查必要的环境变量是否存在
  if (!IMG_BED_URL || !BOT_TOKEN) {
    console.error('错误：必要的环境变量 (IMG_BED_URL, BOT_TOKEN) 未配置');
    return new Response('必要的环境变量 (IMG_BED_URL, BOT_TOKEN) 未配置', { status: 500 });
  }

  // API_URL 现在在需要时基于 BOT_TOKEN 构建
  const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

  if (request.method !== 'POST') {
    return new Response('只接受POST请求', { status: 405 });
  }

  try {
    const update = await request.json();
    if (!update.message) return new Response('OK - No message', { status: 200 });

    const message = update.message;
    const chatId = message.chat.id;
    const text = message.text?.trim();

    // 处理命令
    if (text && text.startsWith('/')) {
      const command = text.split(' ')[0];
      if (command === '/start') {
        await sendMessage(chatId, '🤖 机器人已启用！\n\n直接发送文件即可自动上传，支持图片、视频、音频、文档等多种格式。\n最大支持5GB文件 (受Cloudflare和图床限制)。', env);
      } else if (command === '/help') {
        await sendMessage(chatId, '📖 使用说明：\n\n1. 发送 /start 启动机器人。\n2. 直接发送图片、视频、音频、文档或其他文件进行上传。\n3. 上传成功后会返回国内优化链接 (fixedUrl) 和原始链接 (url)。\n4. 此机器人由 @uki0x 修改，支持多种文件类型。', env);
      }
      return new Response('OK - Command handled', { status: 200 });
    }

    // 自动处理文件类型
    if (message.photo && message.photo.length > 0) {
      await handlePhoto(message, chatId, env);
    }
    else if (message.video || (message.document &&
            (message.document.mime_type?.startsWith('video/') ||
             message.document.file_name?.match(/\.(mp4|avi|mov|wmv|flv|mkv|webm|m4v|3gp|mpeg|mpg|ts)$/i)))) {
      await handleVideo(message, chatId, !!message.document, env);
    }
    else if (message.audio || (message.document &&
            (message.document.mime_type?.startsWith('audio/') ||
             message.document.file_name?.match(/\.(mp3|wav|ogg|flac|aac|m4a|wma|opus|mid|midi)$/i)))) {
      await handleAudio(message, chatId, !!message.document, env);
    }
    else if (message.animation || (message.document &&
            (message.document.mime_type?.includes('animation') || message.document.mime_type?.startsWith('image/gif') || // 明确包含gif
             message.document.file_name?.match(/\.gif$/i)))) {
      await handleAnimation(message, chatId, !!message.document, env);
    }
    else if (message.document) {
      await handleDocument(message, chatId, env);
    } else {
       await sendMessage(chatId, '🤔 请发送图片、视频、音频、动图或文档文件。', env);
       return new Response('OK - No supported file', { status: 200 });
    }

    return new Response('OK - File processing initiated', { status: 200 });
  } catch (error) {
    console.error('处理请求时出错:', error); // 在Worker日志中打印错误
    // 尝试通知管理员或用户
    const errorMsg = `处理请求时内部错误: ${error.message}`;
    if (env.ADMIN_CHAT_ID) {
        await sendMessage(env.ADMIN_CHAT_ID, errorMsg, env).catch(e => console.error("发送错误到管理员失败:", e));
    } else if (typeof chatId !== 'undefined') { // 确保 chatId 存在
        await sendMessage(chatId, '❌ 处理您的请求时发生内部错误，请稍后再试或联系管理员。', env).catch(e => console.error("发送错误到用户失败:", e));
    }
    return new Response('处理请求时出错', { status: 500 });
  }
}

// --- 处理函数 ---

// 处理图片上传
async function handlePhoto(message, chatId, env) {
  const photo = message.photo[message.photo.length - 1]; // 获取最高分辨率图片
  const fileId = photo.file_id;
  const fileName = `photo_${message.message_id}.jpg`; // 给图片一个默认文件名
  const mimeType = 'image/jpeg'; // 假设是jpeg，TG可能会转换

  await handleGenericFile(chatId, fileId, fileName, mimeType, '图片', '🖼️', env);
}

// 处理视频上传
async function handleVideo(message, chatId, isDocument = false, env) {
  const fileId = isDocument ? message.document.file_id : message.video.file_id;
  const fileName = isDocument ? message.document.file_name : (message.video.file_name || `video_${message.message_id}.mp4`);
  const mimeType = isDocument ? message.document.mime_type : (message.video.mime_type || 'video/mp4');

  await handleGenericFile(chatId, fileId, fileName, mimeType, '视频', '🎬', env);
}

// 处理音频上传
async function handleAudio(message, chatId, isDocument = false, env) {
  const fileId = isDocument ? message.document.file_id : message.audio.file_id;
  const fileName = isDocument
    ? message.document.file_name
    : (message.audio.file_name || message.audio.title || `audio_${message.message_id}.mp3`);
  const mimeType = isDocument
    ? message.document.mime_type
    : (message.audio.mime_type || 'audio/mpeg');

  await handleGenericFile(chatId, fileId, fileName, mimeType, '音频', '🎵', env);
}

// 处理动画/GIF上传
async function handleAnimation(message, chatId, isDocument = false, env) {
  const fileId = isDocument ? message.document.file_id : message.animation.file_id;
  const fileName = isDocument
    ? message.document.file_name
    : (message.animation.file_name || `animation_${message.message_id}.mp4`); // TG动画通常是mp4
  // 动画的mime type可能比较复杂，TG可能是 video/mp4 或 image/gif (如果作为文档发送)
  let mimeType = 'video/mp4'; // 默认TG动画为mp4
   if (isDocument) {
       mimeType = message.document.mime_type || (fileName.endsWith('.gif') ? 'image/gif' : 'video/mp4');
   } else if (message.animation.mime_type) {
       mimeType = message.animation.mime_type;
   }

  await handleGenericFile(chatId, fileId, fileName, mimeType, '动画/GIF', '🎞️', env);
}

// 处理文档上传（通用文件处理）
async function handleDocument(message, chatId, env) {
  const fileId = message.document.file_id;
  const fileName = message.document.file_name || `file_${message.message_id}`;
  const mimeType = message.document.mime_type || 'application/octet-stream';

  // 使用 getFileIcon 获取合适的图标
  const fileIcon = getFileIcon(fileName, mimeType);
  await handleGenericFile(chatId, fileId, fileName, mimeType, '文件', fileIcon, env);
}


// --- 通用文件处理逻辑 ---
async function handleGenericFile(chatId, fileId, fileName, mimeType, fileTypeName, fileIcon, env) {
  const { IMG_BED_URL, BOT_TOKEN, AUTH_CODE } = env;

  // 发送处理中消息
  await sendMessage(chatId, `${fileIcon} 正在处理您的${fileTypeName} "${fileName}"，请稍候...`, env);

  // 1. 获取文件路径
  const fileInfo = await getFile(fileId, env);
  if (!fileInfo || !fileInfo.ok) {
    await sendMessage(chatId, `❌ 无法获取${fileTypeName}信息，请稍后再试。`, env);
    return;
  }
  const filePath = fileInfo.result.file_path;
  const fileSizeTelegram = fileInfo.result.file_size; // 文件大小(来自TG)
  const tgFileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

  try {
    // 2. 下载文件
    console.log(`开始下载文件: ${fileName} (${formatFileSize(fileSizeTelegram)})`);
    const fileResponse = await fetch(tgFileUrl);
    if (!fileResponse.ok) {
      throw new Error(`从 Telegram 下载文件失败: ${fileResponse.status} ${fileResponse.statusText}`);
    }

    // 使用流式处理可能更好，但对于Workers环境，ArrayBuffer通常可行且简单
    const fileBuffer = await fileResponse.arrayBuffer();
    const fileSizeActual = fileBuffer.byteLength; // 实际下载的大小
    console.log(`文件下载完成: ${fileName}, 大小: ${formatFileSize(fileSizeActual)}`);

    // 检查文件大小（基于实际下载大小） - Cloudflare Worker Request上限为 100MB (免费) / 500MB (付费), Response 最高 5GB? 需确认
    // 这里假设图床限制或Workers环境限制为 5GB (5120 MB)
    if (fileSizeActual / (1024 * 1024) > 5120) {
       await sendMessage(chatId, `⚠️ 文件 "${fileName}" (${formatFileSize(fileSizeActual)}) 太大，超过 5GB 限制，无法上传。`, env);
       return;
    }
     if (fileSizeActual / (1024 * 1024) > 100) { // 超过100MB时提醒可能较慢
         await sendMessage(chatId, `⏳ 文件 "${fileName}" (${formatFileSize(fileSizeActual)}) 较大，上传可能需要一些时间...`, env);
     }

    // 3. 准备上传
    const formData = new FormData();
    // 确保文件名安全，移除可能导致问题的字符，但保留扩展名
    let safeFileName = fileName.replace(/[^\w\s.\-()]/g, '_'); // 替换大部分特殊字符为下划线
    formData.append('file', new File([fileBuffer], safeFileName, { type: mimeType }));

    const uploadUrl = new URL(IMG_BED_URL);
    uploadUrl.searchParams.append('returnFormat', 'full'); // 请求完整响应格式

    if (AUTH_CODE) {
      uploadUrl.searchParams.append('authCode', AUTH_CODE);
    }

    console.log(`准备上传到: ${uploadUrl.toString()}`);

    // 4. 上传文件
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
      // 可能需要增加超时时间，但Workers fetch不支持直接设置超时
    });

    const responseText = await uploadResponse.text();
    console.log(`${fileTypeName}上传原始响应 (${uploadResponse.status}):`, responseText);

    if (!uploadResponse.ok) {
        // 尝试解析错误信息
        let errorDetail = responseText;
        try {
            const errorJson = JSON.parse(responseText);
            errorDetail = errorJson.message || errorJson.error || JSON.stringify(errorJson);
        } catch (e) { /* 忽略解析错误，使用原始文本 */ }
        throw new Error(`图床上传失败 (${uploadResponse.status}): ${errorDetail.substring(0, 200)}`);
    }

    // 5. 解析响应并发送结果
    let uploadResult;
    try {
      uploadResult = JSON.parse(responseText);
    } catch (e) {
      console.error(`解析图床响应JSON失败: ${e.message}`, responseText);
      // 如果解析失败，但上传状态码是成功的，可能图床直接返回了URL字符串
      if (responseText.startsWith('http://') || responseText.startsWith('https://')) {
         uploadResult = responseText; // 将其视为直接的URL
         console.log("图床响应非JSON，但看起来像URL，尝试使用。");
      } else {
         await sendMessage(chatId, `⚠️ ${fileTypeName}上传成功，但无法解析图床响应。\n原始响应: ${responseText.substring(0, 200)}...`, env);
         return;
      }
    }

    const extractedUrls = extractUrlFromResult(uploadResult, IMG_BED_URL); // 提取URL对象

    if (extractedUrls && (extractedUrls.originalUrl || extractedUrls.fixedUrl)) {
      let msgText = `✅ ${fileTypeName}上传成功！\n\n`;
      msgText += `📄 文件名: ${fileName}\n`;
      msgText += `📦 文件大小: ${formatFileSize(fileSizeActual)}\n\n`; // 使用实际大小

      // 优先显示国内优化链接
      if (extractedUrls.fixedUrl) {
        msgText += `🔗 国内优化链接:\n${extractedUrls.fixedUrl}\n\n`;
      }
      // 如果原始链接存在且与优化链接不同，或者优化链接不存在，则显示原始链接
      if (extractedUrls.originalUrl && extractedUrls.originalUrl !== extractedUrls.fixedUrl) {
        msgText += `🔗 原始链接:\n${extractedUrls.originalUrl}\n\n`;
      } else if (!extractedUrls.fixedUrl && extractedUrls.originalUrl) {
         // 只有原始链接的情况
         msgText += `🔗 链接:\n${extractedUrls.originalUrl}\n\n`;
      }

      await sendMessage(chatId, msgText.trim(), env);
    } else {
      // 即使上传成功，也可能无法提取URL
      await sendMessage(chatId, `⚠️ ${fileTypeName}上传可能成功，但无法从图床响应中提取有效链接。\n原始响应: ${responseText.substring(0, 200)}...`, env);
    }

  } catch (error) {
    console.error(`处理${fileTypeName} "${fileName}" 时出错:`, error);
    await sendMessage(chatId, `❌ 处理${fileTypeName} "${fileName}" 时出错: ${error.message}`, env);
  }
}


// --- 辅助函数 ---

// 辅助函数：从图床返回结果中提取URL，现在返回一个对象 { originalUrl, fixedUrl }
function extractUrlFromResult(result, imgBedUrl) {
  let urls = { originalUrl: null, fixedUrl: null };

  // 1. 检查是否是期望的 JSON 对象结构 (包含 success, url, fixedUrl)
  if (result && typeof result === 'object' && 'success' in result) {
      if (result.success) {
          urls.originalUrl = result.url || null;
          urls.fixedUrl = result.fixedUrl || null;

          // 如果只有一个链接，另一个也设成一样（或者保持null，取决于需求）
          // if (!urls.originalUrl && urls.fixedUrl) urls.originalUrl = urls.fixedUrl;
          // if (!urls.fixedUrl && urls.originalUrl) urls.fixedUrl = urls.originalUrl;

          console.log("从标准JSON响应解析:", urls);
          // 如果解析到任何一个链接，就直接返回
          if (urls.originalUrl || urls.fixedUrl) return urls;

      } else {
          // success: false 的情况
          console.error("图床返回失败状态:", result.message || result.error || JSON.stringify(result));
          // 可以考虑从错误信息中提取，但不推荐
          return null; // 返回 null 表示失败
      }
  }

  // 2. 如果不是标准 JSON，尝试其他常见格式 (备用逻辑)
  console.log("响应非标准格式，尝试备用解析:", result);
  let fallbackUrl = null;
  let baseUrl = 'https://your.default.domain'; // 默认基础URL，以防万一
  try {
      if (imgBedUrl && (imgBedUrl.startsWith('https://') || imgBedUrl.startsWith('http://'))) {
         baseUrl = new URL(imgBedUrl).origin; // 获取基础URL用于拼接相对路径
      }
  } catch (e) {
      console.error("无法解析 IMG_BED_URL 的 origin:", imgBedUrl, e);
  }

  if (Array.isArray(result) && result.length > 0) {
    const item = result[0];
    if (typeof item === 'string') fallbackUrl = item;
    else if (item && item.url) fallbackUrl = item.url;
    else if (item && item.src) fallbackUrl = item.src;
  }
  else if (result && typeof result === 'object') {
    // 某些图床可能直接在顶层放url或src
    if (result.url) fallbackUrl = result.url;
    else if (result.src) fallbackUrl = result.src;
    else if (result.data && result.data.url) fallbackUrl = result.data.url; // 例如 Lsky Pro 格式
    else if (result.file) fallbackUrl = `/file/${result.file}`; // 相对路径
  }
  else if (typeof result === 'string') {
      // 直接返回字符串URL
      fallbackUrl = result;
  }

  // 处理相对路径
  if (fallbackUrl && !fallbackUrl.startsWith('http')) {
      // 确保 baseUrl 末尾有 /，fallbackUrl 开头没有 /
      const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
      const path = fallbackUrl.startsWith('/') ? fallbackUrl.substring(1) : fallbackUrl;
      fallbackUrl = base + path;
  }

  if (fallbackUrl) {
    console.log("备用解析得到 URL:", fallbackUrl);
    // 在备用情况下，两个链接设为相同
    urls.originalUrl = fallbackUrl;
    urls.fixedUrl = fallbackUrl;
    return urls;
  }

  // 如果所有尝试都失败了
  console.error("无法从图床响应中提取任何有效 URL:", result);
  return null; // 表示无法提取
}


// getFile 函数：获取文件信息
async function getFile(fileId, env) {
  const BOT_TOKEN = env.BOT_TOKEN;
  const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;
  try {
      const response = await fetch(`${API_URL}/getFile?file_id=${fileId}`);
      if (!response.ok) {
         const errorData = await response.json().catch(() => ({ description: response.statusText }));
         console.error(`获取文件信息失败 (${response.status}):`, errorData);
         return { ok: false, description: `Telegram API 错误 (${response.status}): ${errorData.description}` };
      }
      return await response.json();
  } catch (error) {
      console.error("调用 getFile API 时网络错误:", error);
      return { ok: false, description: `网络错误: ${error.message}` };
  }
}

// sendMessage 函数：发送消息到Telegram
async function sendMessage(chatId, text, env) {
  const BOT_TOKEN = env.BOT_TOKEN;
  const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;
  console.log(`发送消息到 ${chatId}: "${text.substring(0,50)}..."`);
  try {
      const response = await fetch(`${API_URL}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'HTML', // 或 Markdown，根据需要选择
          disable_web_page_preview: true // 避免链接预览干扰格式
        }),
      });
      const result = await response.json();
      if (!result.ok) {
          console.error(`发送消息失败 (${response.status}):`, result);
      }
      return result;
  } catch (error) {
      console.error("调用 sendMessage API 时网络错误:", error);
      return { ok: false, description: `网络错误: ${error.message}` };
  }
}

// 获取文件类型图标 (保持不变)
function getFileIcon(filename, mimeType) {
  if (mimeType) {
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📄'; // PDF
    if (mimeType.includes('msword') || mimeType.includes('vnd.openxmlformats-officedocument.wordprocessingml.document')) return '📝'; // Word
    if (mimeType.includes('ms-excel') || mimeType.includes('vnd.openxmlformats-officedocument.spreadsheetml.sheet')) return '📊'; // Excel
    if (mimeType.includes('ms-powerpoint') || mimeType.includes('vnd.openxmlformats-officedocument.presentationml.presentation')) return '📊'; // PowerPoint (Excel图标暂代)
    if (mimeType.includes('text/')) return '🗒️'; // Text
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('7z') || mimeType.includes('compressed')) return '🗜️'; // Archive
    if (mimeType.includes('html')) return '🌐';
    // 更具体的常见类型
    if (mimeType.includes('application/json')) return '📄'; // JSON
    if (mimeType.includes('application/xml') || mimeType.includes('text/xml')) return '📄'; // XML
    if (mimeType.includes('application/x-msdownload') || mimeType === 'application/octet-stream') {
        // 对于通用二进制或exe，检查扩展名
        if (filename && filename.toLowerCase().endsWith('.exe')) return '⚙️'; // EXE
        if (filename && filename.toLowerCase().endsWith('.apk')) return '🤖'; // APK
        if (filename && filename.toLowerCase().endsWith('.dmg')) return '⚙️'; // DMG
        return '📦'; // Generic binary/package
    }
  }

  // 如果MIME类型不明确，根据扩展名判断 (保持之前的逻辑)
  if (filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'tif', 'ico', 'heic', 'heif', 'avif'].includes(ext)) return '🖼️';
    if (['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm', 'm4v', '3gp', 'mpeg', 'mpg', 'ts'].includes(ext)) return '🎬';
    if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus', 'mid', 'midi'].includes(ext)) return '🎵';
    if (['pdf', 'doc', 'docx', 'odt'].includes(ext)) return '📄'; // Common Docs
    if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return '📊'; // Spreadsheets
    if (['ppt', 'pptx', 'odp'].includes(ext)) return '📊'; // Presentations (Excel图标暂代)
    if (['txt', 'rtf', 'md', 'log'].includes(ext)) return '🗒️'; // Text
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(ext)) return '🗜️';
    if (['exe', 'msi', 'bat', 'sh', 'app'].includes(ext)) return '⚙️'; // Executables/Scripts
    if (['apk'].includes(ext)) return '🤖';
    if (['dmg', 'iso'].includes(ext)) return '💿'; // Disk Images
    if (['html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx', 'php', 'py', 'java', 'c', 'cpp', 'go', 'rb', 'swift'].includes(ext)) return '💻'; // Code
    if (['json', 'xml', 'yaml', 'yml', 'toml'].includes(ext)) return '📄'; // Data files
    if (['ttf', 'otf', 'woff', 'woff2', 'eot'].includes(ext)) return '🔤'; // Fonts
    if (['psd', 'ai', 'eps', 'sketch', 'fig', 'xd'].includes(ext)) return '🎨'; // Design files
    if (['obj', 'fbx', 'blend', 'stl', 'glb', 'gltf'].includes(ext)) return '🧊'; // 3D Models
    if (['torrent'].includes(ext)) return '📥';
    if (['srt', 'vtt', 'ass', 'ssa'].includes(ext)) return '字幕'; // Subtitles
  }

  return '📄'; // 默认文件图标
}

// 格式化文件大小 (保持不变)
function formatFileSize(bytes, decimals = 2) {
  if (bytes === 0 || isNaN(bytes)) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  // 处理非常大的文件可能超出 Number.MAX_SAFE_INTEGER 的情况，但对于5GB应该没问题
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  // 确保索引在 sizes 数组范围内
  const index = Math.min(i, sizes.length - 1);

  return parseFloat((bytes / Math.pow(k, index)).toFixed(dm)) + ' ' + sizes[index];
}
