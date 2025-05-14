export default {
  async fetch(request, env, ctx) {
    console.log("收到请求：", request.method, request.url);
    
    // 特殊路径处理：设置Webhook
    const url = new URL(request.url);
    if (url.pathname === '/setup-webhook') {
      return handleSetupWebhook(request, env);
    }
    
    try {
      return handleRequest(request, env);
    } catch (error) {
      console.error("主函数出错：", error);
      return new Response('处理请求时出错', { status: 500 });
    }
  }
};

// Webhook设置处理函数
async function handleSetupWebhook(request, env) {
  if (request.method !== 'GET') {
    return new Response('只接受GET请求', { status: 405 });
  }
  
  const BOT_TOKEN = env.BOT_TOKEN;
  
  if (!BOT_TOKEN) {
    return new Response('BOT_TOKEN 未配置', { status: 500 });
  }
  
  const url = new URL(request.url);
  const workerUrl = `${url.protocol}//${url.hostname}`;
  
  console.log(`设置Webhook，Worker URL: ${workerUrl}`);
  
  try {
    const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;
    const response = await fetch(`${API_URL}/setWebhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: workerUrl,
        allowed_updates: ["message"]
      }),
    });
    
    const result = await response.json();
    console.log('Webhook设置结果:', result);
    
    if (result.ok) {
      return new Response(`Webhook设置成功: ${workerUrl}`, { status: 200 });
    } else {
      return new Response(`Webhook设置失败: ${JSON.stringify(result)}`, { status: 500 });
    }
  } catch (error) {
    console.error('设置Webhook时出错:', error);
    return new Response(`设置Webhook时出错: ${error.message}`, { status: 500 });
  }
}

// 主要处理逻辑函数，现在接收 env 对象作为参数
async function handleRequest(request, env) {
  const IMG_BED_URL = env.IMG_BED_URL;
  const BOT_TOKEN = env.BOT_TOKEN;
  const AUTH_CODE = env.AUTH_CODE; // 可选的认证代码

  // 检查必要的环境变量是否存在
  if (!IMG_BED_URL || !BOT_TOKEN) {
    console.error("环境变量缺失: IMG_BED_URL=", !!IMG_BED_URL, "BOT_TOKEN=", !!BOT_TOKEN);
    return new Response('必要的环境变量 (IMG_BED_URL, BOT_TOKEN) 未配置', { status: 500 });
  }

  console.log("环境变量检查通过: IMG_BED_URL=", IMG_BED_URL.substring(0, 8) + '...', "AUTH_CODE=", AUTH_CODE ? '[已设置]' : '[未设置]');

  // API_URL 现在在需要时基于 BOT_TOKEN 构建
  const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

  if (request.method !== 'POST') {
    console.log("非POST请求被拒绝");
    return new Response('只接受POST请求', { status: 405 });
  }

  try {
    const update = await request.json();
    console.log("收到Telegram更新，消息类型:", update.message ? Object.keys(update.message).filter(k => ['text', 'photo', 'video', 'document', 'audio', 'animation'].includes(k)).join(',') : 'no message');
    
    if (!update.message) return new Response('OK', { status: 200 });

    const message = update.message;
    const chatId = message.chat.id;
    const text = message.text?.trim();

    // 处理命令
    if (text && text.startsWith('/')) {
      console.log("收到命令:", text);
      const command = text.split(' ')[0];
      if (command === '/start') {
        try {
          console.log("开始处理/start命令");
          const result = await sendMessage(chatId, '🤖 机器人已启用！\n\n直接发送文件即可自动上传，支持图片、视频、音频、文档等400多种格式。支持最大20Mb的文件上传(Telegram Bot自身限制)。', env);
          console.log("/start命令响应:", JSON.stringify(result).substring(0, 200));
        } catch (error) {
          console.error("发送/start消息失败:", error);
        }
      } else if (command === '/help') {
        try {
          console.log("开始处理/help命令");
          const result = await sendMessage(chatId, '📖 使用说明：\n\n1. 发送 /start 启动机器人（仅首次需要）。\n2. 直接发送图片、视频、音频、文档或其他文件，机器人会自动处理上传。\n3. 支持最大20Mb的文件上传（受Telegram Bot限制）。\n4. 支持400多种文件格式，包括常见的图片、视频、音频、文档、压缩包、可执行文件等。\n5. 使用 /formats 命令查看支持的文件格式类别。\n6. 无需输入其他命令，无需切换模式。\n7. 此机器人由 @uki0x 开发', env);
          console.log("/help命令响应:", JSON.stringify(result).substring(0, 200));
        } catch (error) {
          console.error("发送/help消息失败:", error);
        }
      } else if (command === '/formats') {
        try {
          console.log("开始处理/formats命令");
          const formatsMessage = `📋 支持的文件格式类别：\n\n` +
            `🖼️ 图像：jpg, png, gif, webp, svg, bmp, tiff, heic, raw...\n` +
            `🎬 视频：mp4, avi, mov, mkv, webm, flv, rmvb, m4v...\n` +
            `🎵 音频：mp3, wav, ogg, flac, aac, m4a, wma, opus...\n` +
            `📝 文档：pdf, doc(x), xls(x), ppt(x), txt, md, epub...\n` +
            `🗜️ 压缩：zip, rar, 7z, tar, gz, xz, bz2...\n` +
            `⚙️ 可执行：exe, msi, apk, ipa, deb, rpm, dmg...\n` +
            `🌐 网页/代码：html, css, js, ts, py, java, php, go...\n` +
            `🎨 3D/设计：obj, fbx, blend, stl, psd, ai, sketch...\n` +
            `📊 数据/科学：mat, hdf5, parquet, csv, json, xml...\n\n` +
            `总计支持超过400种文件格式！`;
          const result = await sendMessage(chatId, formatsMessage, env);
          console.log("/formats命令响应:", JSON.stringify(result).substring(0, 200));
        } catch (error) {
          console.error("发送/formats消息失败:", error);
        }
      } else {
        console.log("未知命令:", command);
        try {
          await sendMessage(chatId, `未知命令：${command}。请使用 /start 或 /help 获取帮助。`, env);
        } catch (error) {
          console.error("发送未知命令消息失败:", error);
        }
      }
      return new Response('OK', { status: 200 });
    }

    // 自动处理图片
    if (message.photo && message.photo.length > 0) {
      try {
        console.log(`开始处理图片，长度: ${message.photo.length}`);
        await handlePhoto(message, chatId, env);
      } catch (error) {
        console.error("处理图片时出错:", error);
        await sendMessage(chatId, `❌ 处理图片时出错: ${error.message}`, env).catch(e => console.error("发送图片错误消息失败:", e));
      }
    }
    // 自动处理视频
    else if (message.video || (message.document &&
            (message.document.mime_type?.startsWith('video/') ||
             message.document.file_name?.match(/\.(mp4|avi|mov|wmv|flv|mkv|webm|m4v|3gp|mpeg|mpg|ts|rmvb|rm|asf|amv|mts|m2ts|vob|divx|ogm|ogv)$/i)))) {
      try {
        console.log(`开始处理视频，类型: ${message.video ? 'video' : 'document'}`);
        await handleVideo(message, chatId, !!message.document, env);
      } catch (error) {
        console.error('处理视频时出错:', error);
        let errorDetails = '';
        if (error.message) {
          errorDetails = `\n错误详情: ${error.message}`;
        }
        
        const errorMsg = `❌ 处理视频时出错。${errorDetails}\n\n建议尝试:\n1. 重新发送视频\n2. 如果视频较大，可以尝试压缩后再发送\n3. 尝试将视频转换为MP4格式`;
        if (messageId) {
          await editMessage(chatId, messageId, errorMsg, env);
        } else {
          await sendMessage(chatId, errorMsg, env);
        }
      }
    }
    // 自动处理音频
    else if (message.audio || (message.document &&
            (message.document.mime_type?.startsWith('audio/') ||
             message.document.file_name?.match(/\.(mp3|wav|ogg|flac|aac|m4a|wma|opus|mid|midi|ape|ra|amr|au|voc|ac3|dsf|dsd|dts|ast|aiff|aifc|spx|gsm|wv|tta|mpc|tak)$/i)))) {
      try {
        console.log(`开始处理音频，类型: ${message.audio ? 'audio' : 'document'}`);
        await handleAudio(message, chatId, !!message.document, env);
      } catch (error) {
        console.error('处理音频时出错:', error);
        let errorDetails = '';
        if (error.message) {
          errorDetails = `\n错误详情: ${error.message}`;
        }
        
        const errorMsg = `❌ 处理音频时出错。${errorDetails}\n\n建议尝试:\n1. 重新发送音频\n2. 尝试将音频转换为MP3格式`;
        if (messageId) {
          await editMessage(chatId, messageId, errorMsg, env);
        } else {
          await sendMessage(chatId, errorMsg, env);
        }
      }
    }
    // 自动处理动画/GIF
    else if (message.animation || (message.document &&
            (message.document.mime_type?.includes('animation') ||
             message.document.file_name?.match(/\.(gif|webp|apng|flif|avif)$/i)))) {
      try {
        console.log(`开始处理动画，类型: ${message.animation ? 'animation' : 'document'}`);
        await handleAnimation(message, chatId, !!message.document, env);
      } catch (error) {
        console.error('处理动画时出错:', error);
        let errorDetails = '';
        if (error.message) {
          errorDetails = `\n错误详情: ${error.message}`;
        }
        
        const errorMsg = `❌ 处理动画时出错。${errorDetails}\n\n建议尝试:\n1. 重新发送GIF\n2. 尝试将动画转换为标准GIF格式`;
        if (messageId) {
          await editMessage(chatId, messageId, errorMsg, env);
        } else {
          await sendMessage(chatId, errorMsg, env);
        }
      }
    }
    // 处理其他所有文档类型
    else if (message.document) {
      try {
        console.log(`开始处理文档，mime类型: ${message.document.mime_type || '未知'}`);
        await handleDocument(message, chatId, env);
      } catch (error) {
        console.error('处理文件时出错:', error);
        let errorDetails = '';
        if (error.message) {
          errorDetails = `\n错误详情: ${error.message}`;
        }
        
        const errorMsg = `❌ 处理文件时出错。${errorDetails}\n\n建议尝试:\n1. 重新发送文件\n2. 如果文件较大，可以尝试压缩后再发送`;
        if (messageId) {
          await editMessage(chatId, messageId, errorMsg, env);
        } else {
          await sendMessage(chatId, errorMsg, env);
        }
      }
    } else {
      console.log("收到无法处理的消息类型");
      await sendMessage(chatId, "⚠️ 未能识别的消息类型。请发送图片、视频、音频或文档文件。", env);
    }

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('处理请求时出错:', error); // 在Worker日志中打印错误
    // 避免将详细错误信息返回给客户端，但可以在需要时发送通用错误消息
    await sendMessage(env.ADMIN_CHAT_ID || chatId, `处理请求时内部错误: ${error.message}`, env).catch(e => console.error("Failed to send error message:", e)); // 尝试通知管理员或用户
    return new Response('处理请求时出错', { status: 500 });
  }
}

// 处理图片上传，接收 env 对象
async function handlePhoto(message, chatId, env) {
  const photo = message.photo[message.photo.length - 1];
  const fileId = photo.file_id;

  const IMG_BED_URL = env.IMG_BED_URL;
  const BOT_TOKEN = env.BOT_TOKEN;
  const AUTH_CODE = env.AUTH_CODE;
  const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`; // 构建API URL

  // 发送处理中消息并获取消息ID以便后续更新
  const sendResult = await sendMessage(chatId, '🔄 正在处理您的图片，请稍候...', env);
  const messageId = sendResult && sendResult.ok ? sendResult.result.message_id : null;

  const fileInfo = await getFile(fileId, env); // 传递env

  if (fileInfo && fileInfo.ok) {
    const filePath = fileInfo.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    const imgResponse = await fetch(fileUrl);
    const imgBuffer = await imgResponse.arrayBuffer();
    const fileSize = imgBuffer.byteLength;
    const fileName = `image_${Date.now()}.jpg`;

    // 添加大小检查
    if (fileSize / (1024 * 1024) > 20) { // 20MB
      const warningMsg = `⚠️ 图片太大 (${formatFileSize(fileSize)})，超出20MB限制，无法上传。`;
      if (messageId) {
        await editMessage(chatId, messageId, warningMsg, env);
      } else {
        await sendMessage(chatId, warningMsg, env);
      }
      return;
    }

    const formData = new FormData();
    formData.append('file', new File([imgBuffer], fileName, { type: 'image/jpeg' }));

    const uploadUrl = new URL(IMG_BED_URL + "/upload");
    uploadUrl.searchParams.append('returnFormat', 'full');

    // 准备请求头，把认证码放在头部而不是URL参数里
    const headers = {};
    if (AUTH_CODE) {
      headers['Authorization'] = `Bearer ${AUTH_CODE}`;
      // 同时保留URL参数认证方式，以防API要求
      uploadUrl.searchParams.append('authCode', AUTH_CODE);
    }

    console.log(`图片上传请求 URL: ${uploadUrl.toString()}`);

    try {
      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: headers,
        body: formData
      });

      console.log('图片上传状态码:', uploadResponse.status);
      
      const responseText = await uploadResponse.text();
      console.log('图片上传原始响应:', responseText);

      let uploadResult;
      try {
        uploadResult = JSON.parse(responseText);
      } catch (e) {
        console.error('解析响应JSON失败:', e);
        uploadResult = responseText;
      }

      const extractedResult = extractUrlFromResult(uploadResult, IMG_BED_URL); // 传递 IMG_BED_URL 作为基础
      const imgUrl = extractedResult.url;
      // 使用提取的文件名或默认值
      const actualFileName = extractedResult.fileName || fileName;
      // 使用上传的文件大小，而不是响应中的（如果响应中有，会在extractUrlFromResult中提取）
      const actualFileSize = extractedResult.fileSize || fileSize;

      if (imgUrl) {
        const msgText = `✅ 图片上传成功！\n\n` +
                       `📄 文件名: ${actualFileName}\n` +
                       `📦 文件大小: ${formatFileSize(actualFileSize)}\n\n` +
                       `🔗 URL：${imgUrl}`;
        
        // 更新之前的消息而不是发送新消息
        if (messageId) {
          await editMessage(chatId, messageId, msgText, env);
        } else {
          await sendMessage(chatId, msgText, env);
        }
      } else {
        const errorMsg = `❌ 无法解析上传结果，原始响应:\n${responseText.substring(0, 200)}...`;
        if (messageId) {
          await editMessage(chatId, messageId, errorMsg, env);
        } else {
          await sendMessage(chatId, errorMsg, env);
        }
      }
    } catch (error) {
      console.error('处理图片上传时出错:', error);
      const errorMsg = `❌ 处理图片上传时出错: ${error.message}\n\n可能是图片太大或格式不支持。`;
      if (messageId) {
        await editMessage(chatId, messageId, errorMsg, env);
      } else {
        await sendMessage(chatId, errorMsg, env);
      }
    }
  } else {
    const errorMsg = '❌ 无法获取图片信息，请稍后再试。';
    if (messageId) {
      await editMessage(chatId, messageId, errorMsg, env);
    } else {
      await sendMessage(chatId, errorMsg, env);
    }
  }
}

// 处理视频上传，接收 env 对象
async function handleVideo(message, chatId, isDocument = false, env) {
  const fileId = isDocument ? message.document.file_id : message.video.file_id;
  const fileName = isDocument ? message.document.file_name : `video_${Date.now()}.mp4`;

  // 从 env 获取配置
  const IMG_BED_URL = env.IMG_BED_URL;
  const BOT_TOKEN = env.BOT_TOKEN;
  const AUTH_CODE = env.AUTH_CODE;
  const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`; // 构建API URL

  // 发送处理中消息并获取消息ID以便后续更新
  const sendResult = await sendMessage(chatId, `🔄 正在处理您的视频 "${fileName}"，请稍候...`, env);
  const messageId = sendResult && sendResult.ok ? sendResult.result.message_id : null;

  const fileInfo = await getFile(fileId, env); // 传递env

  if (fileInfo && fileInfo.ok) {
    const filePath = fileInfo.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    try {
      const videoResponse = await fetch(fileUrl);
      if (!videoResponse.ok) throw new Error(`获取视频失败: ${videoResponse.status}`);

      const videoBuffer = await videoResponse.arrayBuffer();
      const videoSize = videoBuffer.byteLength;
      const fileSizeFormatted = formatFileSize(videoSize);
      
      if (videoSize / (1024 * 1024) > 20) { // 20MB
        const warningMsg = `⚠️ 视频太大 (${fileSizeFormatted})，超出20MB限制，无法上传。`;
        if (messageId) {
          await editMessage(chatId, messageId, warningMsg, env);
        } else {
          await sendMessage(chatId, warningMsg, env);
        }
        return;
      }

      const formData = new FormData();
      const mimeType = isDocument ? message.document.mime_type || 'video/mp4' : 'video/mp4';
      formData.append('file', new File([videoBuffer], fileName, { type: mimeType }));

      const uploadUrl = new URL(IMG_BED_URL + "/upload");
      uploadUrl.searchParams.append('returnFormat', 'full');

      if (AUTH_CODE) { // 检查从env获取的AUTH_CODE
        uploadUrl.searchParams.append('authCode', AUTH_CODE);
      }

      console.log(`视频上传请求 URL: ${uploadUrl.toString()}`);

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: AUTH_CODE ? { 'Authorization': `Bearer ${AUTH_CODE}` } : {},
        body: formData
      });

      const responseText = await uploadResponse.text();
      console.log('视频上传原始响应:', responseText);

      let uploadResult;
      try {
        uploadResult = JSON.parse(responseText);
      } catch (e) {
        uploadResult = responseText;
      }

      const extractedResult = extractUrlFromResult(uploadResult, IMG_BED_URL); // 传递 IMG_BED_URL 作为基础
      const videoUrl = extractedResult.url;
      // 使用提取的文件名或默认值
      const actualFileName = extractedResult.fileName || fileName;
      // 使用上传的文件大小，而不是响应中的（如果响应中有，会在extractUrlFromResult中提取）
      const actualFileSize = extractedResult.fileSize || videoSize;

      if (videoUrl) {
        const msgText = `✅ 视频上传成功！\n\n` +
                       `📄 文件名: ${actualFileName}\n` +
                       `📦 文件大小: ${formatFileSize(actualFileSize)}\n\n` +
                       `🔗 URL：${videoUrl}`;
        
        // 更新之前的消息而不是发送新消息
        if (messageId) {
          await editMessage(chatId, messageId, msgText, env);
        } else {
          await sendMessage(chatId, msgText, env);
        }
      } else {
        const errorMsg = `⚠️ 无法从图床获取视频链接。原始响应 (前200字符):\n${responseText.substring(0, 200)}... \n\n或者尝试Telegram临时链接 (有效期有限):\n${fileUrl}`;
        if (messageId) {
          await editMessage(chatId, messageId, errorMsg, env);
        } else {
          await sendMessage(chatId, errorMsg, env);
        }
      }
    } catch (error) {
      console.error('处理视频时出错:', error);
      let errorDetails = '';
      if (error.message) {
        errorDetails = `\n错误详情: ${error.message}`;
      }
      
      const errorMsg = `❌ 处理视频时出错。${errorDetails}\n\n建议尝试:\n1. 重新发送视频\n2. 如果视频较大，可以尝试压缩后再发送\n3. 尝试将视频转换为MP4格式`;
      if (messageId) {
        await editMessage(chatId, messageId, errorMsg, env);
      } else {
        await sendMessage(chatId, errorMsg, env);
      }
    }
  } else {
    let errorDetails = '';
    if (fileInfo.error) {
      errorDetails = `\n错误详情: ${fileInfo.error}`;
      console.error(`获取视频文件信息失败: ${fileInfo.error}`);
    }
    
    const errorMsg = `❌ 无法获取视频信息，请稍后再试。${errorDetails}\n\n建议尝试:\n1. 重新发送视频\n2. 如果视频较大，可以尝试压缩后再发送\n3. 尝试将视频转换为MP4格式`;
    if (messageId) {
      await editMessage(chatId, messageId, errorMsg, env);
    } else {
      await sendMessage(chatId, errorMsg, env);
    }
  }
}

// 处理音频上传
async function handleAudio(message, chatId, isDocument = false, env) {
  const fileId = isDocument ? message.document.file_id : message.audio.file_id;
  const fileName = isDocument 
    ? message.document.file_name 
    : (message.audio.title || message.audio.file_name || `audio_${Date.now()}.mp3`);

  // 从 env 获取配置
  const IMG_BED_URL = env.IMG_BED_URL;
  const BOT_TOKEN = env.BOT_TOKEN;
  const AUTH_CODE = env.AUTH_CODE;

  // 发送处理中消息并获取消息ID以便后续更新
  const sendResult = await sendMessage(chatId, `🔄 正在处理您的音频 "${fileName}"，请稍候...`, env);
  const messageId = sendResult && sendResult.ok ? sendResult.result.message_id : null;

  const fileInfo = await getFile(fileId, env);

  if (fileInfo && fileInfo.ok) {
    const filePath = fileInfo.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    try {
      const audioResponse = await fetch(fileUrl);
      if (!audioResponse.ok) throw new Error(`获取音频失败: ${audioResponse.status}`);

      const audioBuffer = await audioResponse.arrayBuffer();
      const audioSize = audioBuffer.byteLength;
      const fileSizeFormatted = formatFileSize(audioSize);
      
      if (audioSize / (1024 * 1024) > 20) { // 20MB
        const warningMsg = `⚠️ 音频太大 (${fileSizeFormatted})，超出20MB限制，无法上传。`;
        if (messageId) {
          await editMessage(chatId, messageId, warningMsg, env);
        } else {
          await sendMessage(chatId, warningMsg, env);
        }
        return;
      }

      const formData = new FormData();
      const mimeType = isDocument 
        ? message.document.mime_type || 'audio/mpeg' 
        : (message.audio.mime_type || 'audio/mpeg');
      formData.append('file', new File([audioBuffer], fileName, { type: mimeType }));

      const uploadUrl = new URL(IMG_BED_URL + "/upload");
      uploadUrl.searchParams.append('returnFormat', 'full');

      if (AUTH_CODE) {
        uploadUrl.searchParams.append('authCode', AUTH_CODE);
      }

      console.log(`音频上传请求 URL: ${uploadUrl.toString()}`);

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: AUTH_CODE ? { 'Authorization': `Bearer ${AUTH_CODE}` } : {},
        body: formData
      });

      const responseText = await uploadResponse.text();
      console.log('音频上传原始响应:', responseText);

      let uploadResult;
      try {
        uploadResult = JSON.parse(responseText);
      } catch (e) {
        uploadResult = responseText;
      }

      const extractedResult = extractUrlFromResult(uploadResult, IMG_BED_URL);
      const audioUrl = extractedResult.url;
      // 使用提取的文件名或默认值
      const actualFileName = extractedResult.fileName || fileName;
      // 使用上传的文件大小，而不是响应中的（如果响应中有，会在extractUrlFromResult中提取）
      const actualFileSize = extractedResult.fileSize || audioSize;

      if (audioUrl) {
        const msgText = `✅ 音频上传成功！\n\n` +
                       `📄 文件名: ${actualFileName}\n` +
                       `📦 文件大小: ${formatFileSize(actualFileSize)}\n\n` +
                       `🔗 URL：${audioUrl}`;
        
        // 更新之前的消息而不是发送新消息
        if (messageId) {
          await editMessage(chatId, messageId, msgText, env);
        } else {
          await sendMessage(chatId, msgText, env);
        }
      } else {
        const errorMsg = `⚠️ 无法从图床获取音频链接。原始响应 (前200字符):\n${responseText.substring(0, 200)}... \n\n或者尝试Telegram临时链接 (有效期有限):\n${fileUrl}`;
        if (messageId) {
          await editMessage(chatId, messageId, errorMsg, env);
        } else {
          await sendMessage(chatId, errorMsg, env);
        }
      }
    } catch (error) {
      console.error('处理音频时出错:', error);
      let errorDetails = '';
      if (error.message) {
        errorDetails = `\n错误详情: ${error.message}`;
      }
      
      const errorMsg = `❌ 处理音频时出错。${errorDetails}\n\n建议尝试:\n1. 重新发送音频\n2. 尝试将音频转换为MP3格式`;
      if (messageId) {
        await editMessage(chatId, messageId, errorMsg, env);
      } else {
        await sendMessage(chatId, errorMsg, env);
      }
    }
  } else {
    let errorDetails = '';
    if (fileInfo.error) {
      errorDetails = `\n错误详情: ${fileInfo.error}`;
      console.error(`获取音频文件信息失败: ${fileInfo.error}`);
    }
    
    const errorMsg = `❌ 无法获取音频信息，请稍后再试。${errorDetails}\n\n建议尝试:\n1. 重新发送音频\n2. 尝试将音频转换为MP3格式`;
    if (messageId) {
      await editMessage(chatId, messageId, errorMsg, env);
    } else {
      await sendMessage(chatId, errorMsg, env);
    }
  }
}

// 处理动画/GIF上传
async function handleAnimation(message, chatId, isDocument = false, env) {
  const fileId = isDocument ? message.document.file_id : message.animation.file_id;
  const fileName = isDocument 
    ? message.document.file_name 
    : (message.animation.file_name || `animation_${Date.now()}.gif`);

  // 从 env 获取配置
  const IMG_BED_URL = env.IMG_BED_URL;
  const BOT_TOKEN = env.BOT_TOKEN;
  const AUTH_CODE = env.AUTH_CODE;

  // 发送处理中消息并获取消息ID以便后续更新
  const sendResult = await sendMessage(chatId, `🔄 正在处理您的动画/GIF "${fileName}"，请稍候...`, env);
  const messageId = sendResult && sendResult.ok ? sendResult.result.message_id : null;

  const fileInfo = await getFile(fileId, env);

  if (fileInfo && fileInfo.ok) {
    const filePath = fileInfo.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    try {
      const animResponse = await fetch(fileUrl);
      if (!animResponse.ok) throw new Error(`获取动画失败: ${animResponse.status}`);

      const animBuffer = await animResponse.arrayBuffer();
      const animSize = animBuffer.byteLength;
      const fileSizeFormatted = formatFileSize(animSize);
      
      if (animSize / (1024 * 1024) > 20) { // 20MB
        const warningMsg = `⚠️ 动画太大 (${fileSizeFormatted})，超出20MB限制，无法上传。`;
        if (messageId) {
          await editMessage(chatId, messageId, warningMsg, env);
        } else {
          await sendMessage(chatId, warningMsg, env);
        }
        return;
      }

      const formData = new FormData();
      const mimeType = isDocument 
        ? message.document.mime_type || 'image/gif' 
        : (message.animation.mime_type || 'image/gif');
      formData.append('file', new File([animBuffer], fileName, { type: mimeType }));

      const uploadUrl = new URL(IMG_BED_URL + "/upload");
      uploadUrl.searchParams.append('returnFormat', 'full');

      if (AUTH_CODE) {
        uploadUrl.searchParams.append('authCode', AUTH_CODE);
      }

      console.log(`动画上传请求 URL: ${uploadUrl.toString()}`);

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: AUTH_CODE ? { 'Authorization': `Bearer ${AUTH_CODE}` } : {},
        body: formData
      });

      const responseText = await uploadResponse.text();
      console.log('动画上传原始响应:', responseText);

      let uploadResult;
      try {
        uploadResult = JSON.parse(responseText);
      } catch (e) {
        uploadResult = responseText;
      }

      const extractedResult = extractUrlFromResult(uploadResult, IMG_BED_URL);
      const animUrl = extractedResult.url;
      // 使用提取的文件名或默认值
      const actualFileName = extractedResult.fileName || fileName;
      // 使用上传的文件大小，而不是响应中的（如果响应中有，会在extractUrlFromResult中提取）
      const actualFileSize = extractedResult.fileSize || animSize;

      if (animUrl) {
        const msgText = `✅ 动画/GIF上传成功！\n\n` +
                       `📄 文件名: ${actualFileName}\n` +
                       `📦 文件大小: ${formatFileSize(actualFileSize)}\n\n` +
                       `🔗 URL：${animUrl}`;
        
        // 更新之前的消息而不是发送新消息
        if (messageId) {
          await editMessage(chatId, messageId, msgText, env);
        } else {
          await sendMessage(chatId, msgText, env);
        }
      } else {
        const errorMsg = `⚠️ 无法从图床获取动画链接。原始响应 (前200字符):\n${responseText.substring(0, 200)}... \n\n或者尝试Telegram临时链接 (有效期有限):\n${fileUrl}`;
        if (messageId) {
          await editMessage(chatId, messageId, errorMsg, env);
        } else {
          await sendMessage(chatId, errorMsg, env);
        }
      }
    } catch (error) {
      console.error('处理动画时出错:', error);
      let errorDetails = '';
      if (error.message) {
        errorDetails = `\n错误详情: ${error.message}`;
      }
      
      const errorMsg = `❌ 处理动画时出错。${errorDetails}\n\n建议尝试:\n1. 重新发送GIF\n2. 尝试将动画转换为标准GIF格式`;
      if (messageId) {
        await editMessage(chatId, messageId, errorMsg, env);
      } else {
        await sendMessage(chatId, errorMsg, env);
      }
    }
  } else {
    let errorDetails = '';
    if (fileInfo.error) {
      errorDetails = `\n错误详情: ${fileInfo.error}`;
      console.error(`获取动画文件信息失败: ${fileInfo.error}`);
    }
    
    const errorMsg = `❌ 无法获取动画信息，请稍后再试。${errorDetails}\n\n建议尝试:\n1. 重新发送GIF\n2. 尝试将动画转换为标准GIF格式`;
    if (messageId) {
      await editMessage(chatId, messageId, errorMsg, env);
    } else {
      await sendMessage(chatId, errorMsg, env);
    }
  }
}

// 处理文档上传（通用文件处理）
async function handleDocument(message, chatId, env) {
  const fileId = message.document.file_id;
  const fileName = message.document.file_name || `file_${Date.now()}`;
  const mimeType = message.document.mime_type || 'application/octet-stream';

  // 检查文件扩展名是否支持
  const fileExt = fileName.split('.').pop().toLowerCase();
  const isSupported = isExtValid(fileExt);
  
  // 从 env 获取配置
  const IMG_BED_URL = env.IMG_BED_URL;
  const BOT_TOKEN = env.BOT_TOKEN;
  const AUTH_CODE = env.AUTH_CODE;

  // 获取文件类型图标
  const fileIcon = getFileIcon(fileName, mimeType);
  
  // 发送处理中消息并获取消息ID以便后续更新
  const sendResult = await sendMessage(chatId, `${fileIcon} 正在处理您的文件 "${fileName}"${isSupported ? '' : ' (不支持的扩展名，但仍将尝试上传)'}，请稍候...`, env);
  const messageId = sendResult && sendResult.ok ? sendResult.result.message_id : null;

  const fileInfo = await getFile(fileId, env);

  if (fileInfo && fileInfo.ok) {
    const filePath = fileInfo.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    try {
      const fileResponse = await fetch(fileUrl);
      if (!fileResponse.ok) throw new Error(`获取文件失败: ${fileResponse.status}`);

      const fileBuffer = await fileResponse.arrayBuffer();
      const fileSize = fileBuffer.byteLength;
      const fileSizeFormatted = formatFileSize(fileSize);

      if (fileSize / (1024 * 1024) > 20) { // 20MB
        const warningMsg = `⚠️ 文件太大 (${fileSizeFormatted})，超出20MB限制，无法上传。`;
        if (messageId) {
          await editMessage(chatId, messageId, warningMsg, env);
        } else {
          await sendMessage(chatId, warningMsg, env);
        }
        return;
      }

      const formData = new FormData();
      
      // 修复exe文件上传问题：确保文件名保持原样，不要修改扩展名
      let safeFileName = fileName;
      
      // 确保MIME类型正确
      let safeMimeType = mimeType;
      // 基于文件扩展名设置正确的MIME类型
      if (fileExt) {
        // 应用程序可执行文件
        if (['exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'snap', 'flatpak', 'appimage'].includes(fileExt)) {
          safeMimeType = 'application/octet-stream';
        }
        // 移动应用程序
        else if (['apk', 'ipa'].includes(fileExt)) {
          safeMimeType = 'application/vnd.android.package-archive';
        }
        // 压缩文件
        else if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'tbz2', 'txz'].includes(fileExt)) {
          safeMimeType = fileExt === 'zip' ? 'application/zip' : 'application/x-compressed';
        }
        // 光盘镜像
        else if (['iso', 'img', 'vdi', 'vmdk', 'vhd', 'vhdx', 'ova', 'ovf'].includes(fileExt)) {
          safeMimeType = 'application/octet-stream';
        }
      }
      
      formData.append('file', new File([fileBuffer], safeFileName, { type: safeMimeType }));

      const uploadUrl = new URL(IMG_BED_URL + "/upload");
      uploadUrl.searchParams.append('returnFormat', 'full');

      if (AUTH_CODE) {
        uploadUrl.searchParams.append('authCode', AUTH_CODE);
      }

      console.log(`文件上传请求 URL: ${uploadUrl.toString()}`);

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: AUTH_CODE ? { 'Authorization': `Bearer ${AUTH_CODE}` } : {},
        body: formData
      });

      const responseText = await uploadResponse.text();
      console.log('文件上传原始响应:', responseText);

      let uploadResult;
      try {
        uploadResult = JSON.parse(responseText);
      } catch (e) {
        uploadResult = responseText;
      }

      const extractedResult = extractUrlFromResult(uploadResult, IMG_BED_URL);
      const fileUrl2 = extractedResult.url;
      // 使用提取的文件名或默认值
      const actualFileName = extractedResult.fileName || safeFileName;
      // 使用上传的文件大小，而不是响应中的（如果响应中有，会在extractUrlFromResult中提取）
      const actualFileSize = extractedResult.fileSize || fileSize;

      if (fileUrl2) {
        const msgText = `✅ 文件上传成功！\n\n` +
                       `📄 文件名: ${actualFileName}\n` +
                       `📦 文件大小: ${formatFileSize(actualFileSize)}\n\n` +
                       `🔗 URL：${fileUrl2}`;
        
        // 更新之前的消息而不是发送新消息
        if (messageId) {
          await editMessage(chatId, messageId, msgText, env);
        } else {
          await sendMessage(chatId, msgText, env);
        }
      } else {
        const errorMsg = `⚠️ 无法从图床获取文件链接。原始响应 (前200字符):\n${responseText.substring(0, 200)}... \n\n或者尝试Telegram临时链接 (有效期有限):\n${fileUrl}`;
        if (messageId) {
          await editMessage(chatId, messageId, errorMsg, env);
        } else {
          await sendMessage(chatId, errorMsg, env);
        }
      }
    } catch (error) {
      console.error('处理文件时出错:', error);
      let errorDetails = '';
      if (error.message) {
        errorDetails = `\n错误详情: ${error.message}`;
      }
      
      const errorMsg = `❌ 处理文件时出错。${errorDetails}\n\n建议尝试:\n1. 重新发送文件\n2. 如果文件较大，可以尝试压缩后再发送`;
      if (messageId) {
        await editMessage(chatId, messageId, errorMsg, env);
      } else {
        await sendMessage(chatId, errorMsg, env);
      }
    }
  } else {
    let errorDetails = '';
    if (fileInfo.error) {
      errorDetails = `\n错误详情: ${fileInfo.error}`;
      console.error(`获取文档文件信息失败: ${fileInfo.error}`);
    }
    
    const errorMsg = `❌ 无法获取文件信息，请稍后再试。${errorDetails}\n\n建议尝试:\n1. 重新发送文件\n2. 如果文件较大，可以尝试压缩后再发送`;
    if (messageId) {
      await editMessage(chatId, messageId, errorMsg, env);
    } else {
      await sendMessage(chatId, errorMsg, env);
    }
  }
}

// 辅助函数：从图床返回结果中提取URL，接收基础URL
function extractUrlFromResult(result, imgBedUrl) {
  let url = '';
  let fileName = '';
  let fileSize = 0;
  
  // 尝试从传入的 IMG_BED_URL 获取 origin
  let baseUrl = 'https://your.default.domain'; // 提供一个备用基础URL
  try {
    if (imgBedUrl && (imgBedUrl.startsWith('https://') || imgBedUrl.startsWith('http://'))) {
      baseUrl = new URL(imgBedUrl).origin;
    }
  } catch (e) {
    console.error("无法解析 IMG_BED_URL:", imgBedUrl, e);
  }

  console.log("提取URL，结果类型:", typeof result, "值:", JSON.stringify(result).substring(0, 200));

  // 处理可能的错误响应
  if (typeof result === 'string' && result.includes("The string did not match the expected pattern")) {
    console.error("遇到模式匹配错误，可能是文件扩展名问题");
    // 尝试从错误响应中提取可能的URL
    const urlMatch = result.match(/(https?:\/\/[^\s"]+)/);
    if (urlMatch) {
      return { url: urlMatch[0], fileName: '', fileSize: 0 };
    }
  }

  // 优先处理 [{"src": "/file/path.jpg"}] 这样的响应格式
  if (Array.isArray(result) && result.length > 0) {
    const item = result[0];
    if (item.url) {
      url = item.url;
      fileName = item.fileName || extractFileName(url);
      fileSize = item.fileSize || 0;
    } else if (item.src) {
      // 特别处理以 /file/ 开头的路径
      if (item.src.startsWith('/file/')) {
        url = `${baseUrl}${item.src}`;
        fileName = extractFileName(item.src);
      } else if (item.src.startsWith('/')) {
        url = `${baseUrl}${item.src}`;
        fileName = extractFileName(item.src);
      } else if (item.src.startsWith('http')) {
        url = item.src;
        fileName = extractFileName(item.src);
      } else {
        url = `${baseUrl}/${item.src}`;
        fileName = extractFileName(item.src);
      }
      fileSize = item.fileSize || 0;
    } else if (typeof item === 'string') {
      url = item.startsWith('http') ? item : `${baseUrl}/file/${item}`;
      fileName = extractFileName(item);
    }
  } else if (result && typeof result === 'object') {
    if (result.url) {
      url = result.url;
      fileName = result.fileName || extractFileName(url);
      fileSize = result.fileSize || 0;
    } else if (result.src) {
      if (result.src.startsWith('/file/')) {
        url = `${baseUrl}${result.src}`;
        fileName = extractFileName(result.src);
      } else if (result.src.startsWith('/')) {
        url = `${baseUrl}${result.src}`;
        fileName = extractFileName(result.src);
      } else if (result.src.startsWith('http')) {
        url = result.src;
        fileName = extractFileName(result.src);
      } else {
        url = `${baseUrl}/${result.src}`;
        fileName = extractFileName(result.src);
      }
      fileSize = result.fileSize || 0;
    } else if (result.file) {
      url = `${baseUrl}/file/${result.file}`;
      fileName = result.fileName || extractFileName(result.file);
      fileSize = result.fileSize || 0;
    } else if (result.data && result.data.url) {
      url = result.data.url;
      fileName = result.data.fileName || extractFileName(url);
      fileSize = result.data.fileSize || 0;
    }
  } else if (typeof result === 'string') {
    if (result.startsWith('http://') || result.startsWith('https://')) {
      url = result;
      fileName = extractFileName(result);
    } else {
      url = `${baseUrl}/file/${result}`;
      fileName = extractFileName(result);
    }
  }

  console.log("提取的最终URL:", url);
  return { url, fileName, fileSize };
}

// 辅助函数：从URL中提取文件名
function extractFileName(url) {
  if (!url) return '';
  
  // 先尝试取最后的部分
  let parts = url.split('/');
  let fileName = parts[parts.length - 1];
  
  // 如果有查询参数，去掉查询参数
  fileName = fileName.split('?')[0];
  
  // 如果没有扩展名，尝试基于URL结构猜测
  if (!fileName.includes('.') && url.includes('/file/')) {
    fileName = url.split('/file/')[1].split('?')[0];
    // 如果还是没有扩展名，可能需要基于内容类型添加一个默认扩展名
    if (!fileName.includes('.')) {
      // 由于没有内容类型信息，暂时不添加扩展名
    }
  }
  
  return fileName || '未知文件';
}

// getFile 函数，接收 env 对象
async function getFile(fileId, env) {
  const BOT_TOKEN = env.BOT_TOKEN;
  const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`; // 构建API URL
  
  // 添加重试逻辑
  let retries = 0;
  const maxRetries = 3;
  let lastError = null;
  
  while (retries < maxRetries) {
    try {
      console.log(`尝试获取文件信息，fileId: ${fileId.substring(0, 10)}...，第${retries + 1}次尝试`);
      const response = await fetch(`${API_URL}/getFile?file_id=${fileId}`);
      
      if (!response.ok) {
        throw new Error(`Telegram API返回错误: ${response.status} ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.ok) {
        throw new Error(`Telegram API返回非成功结果: ${JSON.stringify(result)}`);
      }
      
      if (!result.result || !result.result.file_path) {
        throw new Error(`Telegram API返回结果缺少file_path: ${JSON.stringify(result)}`);
      }
      
      return result;
    } catch (error) {
      lastError = error;
      console.error(`获取文件信息失败，第${retries + 1}次尝试: ${error.message}`);
      retries++;
      
      if (retries < maxRetries) {
        // 等待时间随重试次数增加
        const waitTime = 1000 * retries; // 1秒, 2秒, 3秒...
        console.log(`等待${waitTime / 1000}秒后重试...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  console.error(`获取文件信息失败，已达到最大重试次数(${maxRetries}): ${lastError.message}`);
  return { ok: false, error: `获取文件信息失败: ${lastError.message}` };
}

// sendMessage 函数，接收 env 对象
async function sendMessage(chatId, text, env) {
  const BOT_TOKEN = env.BOT_TOKEN;
  
  // 确保BOT_TOKEN可用
  if (!BOT_TOKEN) {
    console.error("sendMessage: BOT_TOKEN不可用");
    return { ok: false, error: "BOT_TOKEN not available" };
  }
  
  const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;
  console.log(`准备发送消息到聊天ID: ${chatId}, API URL: ${API_URL.substring(0, 40)}...`);
  
  try {
    const body = JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
    });
    
    console.log(`请求体: ${body.substring(0, 50)}...`);
    
    const response = await fetch(`${API_URL}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: body,
    });
    
    console.log(`Telegram API响应状态: ${response.status}`);
    const responseData = await response.json();
    console.log(`Telegram API响应数据: ${JSON.stringify(responseData).substring(0, 100)}...`);
    
    return responseData;
  } catch (error) {
    console.error(`发送消息错误: ${error}`);
    return { ok: false, error: error.message };
  }
}

// editMessage 函数，用于更新已发送的消息
async function editMessage(chatId, messageId, text, env) {
  if (!messageId) return null;
  
  const BOT_TOKEN = env.BOT_TOKEN;
  const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`; // 构建API URL
  
  try {
    const response = await fetch(`${API_URL}/editMessageText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: 'HTML',
      }),
    });
    return await response.json();
  } catch (error) {
    console.error('编辑消息失败:', error);
    // 如果编辑失败，尝试发送新消息
    return sendMessage(chatId, text, env);
  }
}

// 获取文件类型图标
function getFileIcon(filename, mimeType) {
  if (mimeType) {
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📄';
    if (mimeType.includes('msword') || mimeType.includes('document')) return '📝';
    if (mimeType.includes('excel') || mimeType.includes('sheet')) return '📊';
    if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return '📊';
    if (mimeType.includes('text/')) return '📝';
    if (mimeType.includes('zip') || mimeType.includes('compressed')) return '🗜️';
    if (mimeType.includes('html')) return '🌐';
    if (mimeType.includes('application/x-msdownload') || mimeType.includes('application/octet-stream')) return '⚙️';
  }
  
  if (filename) {
    const ext = filename.split('.').pop().toLowerCase();
    
    // 检查扩展名是否在支持列表中
    if (isExtValid(ext)) {
      // 图片文件
      if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'tif', 'ico', 'heic', 'heif', 'avif', 'raw', 'arw', 'cr2', 'nef', 'orf', 'rw2', 'dng', 'raf'].includes(ext)) {
        return '🖼️';
      }
      
      // 视频文件
      if (['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm', 'm4v', '3gp', 'mpeg', 'mpg', 'mpe', 'ts', 'rmvb', 'rm', 'asf', 'amv', 'mts', 'm2ts', 'vob', 'divx', 'tp', 'ogm', 'ogv'].includes(ext)) {
        return '🎬';
      }
      
      // 音频文件
      if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus', 'mid', 'midi', 'ape', 'ra', 'amr', 'au', 'voc', 'ac3', 'dsf', 'dsd', 'dts', 'dtsma', 'ast', 'aiff', 'aifc', 'spx', 'gsm', 'wv', 'tta', 'mpc', 'tak'].includes(ext)) {
        return '🎵';
      }
      
      // 电子书和文档文件
      if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'md', 'csv', 'json', 'xml', 'epub', 'mobi', 'azw', 'azw3', 'fb2', 'djvu', 'cbz', 'cbr', 'lit', 'lrf', 'opf', 'prc', 'azw1', 'azw4', 'azw6', 'cb7', 'cbt', 'cba', 'chm', 'xps', 'oxps', 'ps', 'dvi'].includes(ext)) {
        return '📝';
      }
      
      // 压缩文件
      if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'tbz2', 'txz', 'z', 'lz', 'lzma', 'lzo', 'rz', 'sfx', 'cab', 'arj', 'lha', 'lzh', 'zoo', 'arc', 'ace', 'dgc', 'dgn', 'lbr', 'pak', 'pit', 'sit', 'sqx'].includes(ext)) {
        return '🗜️';
      }
      
      // 可执行文件和系统镜像
      if (['exe', 'msi', 'apk', 'ipa', 'app', 'dmg', 'pkg', 'deb', 'rpm', 'snap', 'flatpak', 'appimage', 'iso', 'img', 'vdi', 'vmdk', 'vhd', 'vhdx', 'ova', 'ovf', 'qcow2', 'pvm', 'dsk', 'hdd', 'bin', 'cue', 'mds', 'mdf', 'nrg', 'ccd', 'cif', 'c2d', 'daa', 'b6t', 'b5t', 'bwt', 'isz', 'cdi', 'flp', 'uif', 'xdi', 'sdi'].includes(ext)) {
        return '⚙️';
      }
      
      // 网页和脚本文件
      if (['html', 'htm', 'css', 'js', 'ts', 'jsx', 'tsx', 'php', 'py', 'rb', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'swift', 'kt', 'rs', 'dart', 'lua', 'groovy', 'scala', 'perl', 'r', 'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'sql', 'yaml', 'yml', 'toml', 'wasm', 'wat'].includes(ext)) {
        return '🌐';
      }
      
      // 字体文件
      if (['ttf', 'otf', 'woff', 'woff2', 'eot'].includes(ext)) {
        return '🔤';
      }
      
      // 3D、游戏和设计文件
      if (['obj', 'fbx', 'blend', 'stl', 'psd', 'ai', 'eps', 'sketch', 'fig', 'svg', 'dae', '3ds', 'gltf', 'glb', 'mb', 'unity3d', 'unitypackage', 'max', 'c4d', 'w3x', 'pk3', 'wad', 'bsp', 'map', 'rom', 'n64', 'z64', 'v64', 'nes', 'smc', 'sfc', 'gb', 'gbc', 'gba', 'nds'].includes(ext)) {
        return '🎨';
      }
      
      // 科学和专业数据文件
      if (['mat', 'fits', 'hdf', 'hdf5', 'h5', 'nx', 'ngc', 'nxs', 'nb', 'cdf', 'nc', 'spss', 'sav', 'dta', 'do', 'odb', 'odt', 'ott', 'odp', 'otp', 'ods', 'ots', 'parquet', 'avro', 'proto', 'pbtxt', 'fbs'].includes(ext)) {
        return '📊';
      }
      
      // 其他特殊文件
      if (['torrent', 'ico', 'crx', 'xpi', 'jar', 'war', 'ear', 'srt', 'vtt', 'ass', 'ssa'].includes(ext)) {
        return '📄';
      }
    }
  }
  
  return '📄'; // 默认文件图标
}

// 格式化文件大小
function formatFileSize(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// 检查文件扩展名是否在支持列表中
function isExtValid(fileExt) {
  return ['jpeg', 'jpg', 'png', 'gif', 'webp', 
    'mp4', 'mp3', 'ogg',
    'mp3', 'wav', 'flac', 'aac', 'opus',
    'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'pdf', 
    'txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'ts', 'go', 'java', 'php', 'py', 'rb', 'sh', 'bat', 'cmd', 'ps1', 'psm1', 'psd', 'ai', 'sketch', 'fig', 'svg', 'eps', 
    // 压缩包格式
    'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'tbz2', 'txz',
    // 应用程序包
    'apk', 'ipa', 'exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'snap', 'flatpak', 'appimage',
    // 光盘镜像
    'iso', 'img', 'vdi', 'vmdk', 'vhd', 'vhdx', 'ova', 'ovf',
    // 文档格式
    'epub', 'mobi', 'azw', 'azw3', 'fb2', 'djvu', 'cbz', 'cbr',
    // 字体
    'ttf', 'otf', 'woff', 'woff2', 'eot', 
    // 其他文件格式
    'torrent', 'ico', 'crx', 'xpi', 'jar', 'war', 'ear',
    'qcow2', 'pvm', 'dsk', 'hdd', 'bin', 'cue', 'mds', 'mdf', 'nrg', 'ccd', 'cif', 'c2d', 'daa', 'b6t', 'b5t', 'bwt', 'isz', 'cdi', 'flp', 'uif', 'xdi', 'sdi',
    // 源代码文件
    'c', 'cpp', 'h', 'hpp', 'cs', 'swift', 'kt', 'rs', 'dart', 'lua', 'groovy', 'scala', 'perl', 'r', 'vbs', 'sql', 'yaml', 'yml', 'toml',
    // 视频和音频相关
    'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', '3gp', 'm4v', 'm4a', 'mid', 'midi',
    // 小众图像格式
    'tiff', 'tif', 'bmp', 'pcx', 'tga', 'icns', 'heic', 'heif', 'arw', 'cr2', 'nef', 'orf', 'rw2', 'dng', 'raf', 'raw',
    // 小众档案格式
    'z', 'lz', 'lzma', 'lzo', 'rz', 'sfx', 'cab', 'arj', 'lha', 'lzh', 'zoo', 'arc', 'ace', 'dgc', 'dgn', 'lbr', 'pak', 'pit', 'sit', 'sqx', 'gz.gpg', 'z.gpg',
    // 小众视频格式
    'rmvb', 'rm', 'asf', 'amv', 'mts', 'm2ts', 'vob', 'divx', 'mpeg', 'mpg', 'mpe', 'tp', 'ts', 'ogm', 'ogv', 
    // 小众音频格式
    'ape', 'wma', 'ra', 'amr', 'au', 'voc', 'ac3', 'dsf', 'dsd', 'dts', 'dtsma', 'ast', 'aiff', 'aifc', 'spx', 'gsm', 'wv', 'tta', 'mpc', 'tak',
    // 小众电子书和文档格式
    'lit', 'lrf', 'opf', 'prc', 'azw1', 'azw4', 'azw6', 'cbz', 'cbr', 'cb7', 'cbt', 'cba', 'chm', 'xps', 'oxps', 'ps', 'dvi',
    // 小众开发和数据格式
    'wasm', 'wat', 'f', 'for', 'f90', 'f95', 'hs', 'lhs', 'elm', 'clj', 'csv', 'tsv', 'parquet', 'avro', 'proto', 'pbtxt', 'fbs',
    // 3D和游戏相关格式
    'obj', 'fbx', 'dae', '3ds', 'stl', 'gltf', 'glb', 'blend', 'mb', 'unity3d', 'unitypackage', 'max', 'c4d', 'w3x', 'pk3', 'wad', 'bsp', 'map', 'rom', 'n64', 'z64', 'v64', 'nes', 'smc', 'sfc', 'gb', 'gbc', 'gba', 'nds',
    // 科学和专业格式
    'mat', 'fits', 'hdf', 'hdf5', 'h5', 'nx', 'ngc', 'nxs', 'nb', 'cdf', 'nc', 'spss', 'sav', 'dta', 'do', 'odb', 'odt', 'ott', 'odp', 'otp', 'ods', 'ots'
  ].includes(fileExt);
}
