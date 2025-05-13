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

  // 检查必要的环境变量是否存在
  if (!IMG_BED_URL || !BOT_TOKEN) {
    return new Response('必要的环境变量 (IMG_BED_URL, BOT_TOKEN) 未配置', { status: 500 });
  }

  // API_URL 现在在需要时基于 BOT_TOKEN 构建
  const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

  if (request.method !== 'POST') {
    return new Response('只接受POST请求', { status: 405 });
  }

  try {
    const update = await request.json();
    if (!update.message) return new Response('OK', { status: 200 });

    const message = update.message;
    const chatId = message.chat.id;
    const text = message.text?.trim();

    // 处理命令
    if (text && text.startsWith('/')) {
      const command = text.split(' ')[0];
      if (command === '/start') {
        await sendMessage(chatId, '🤖 机器人已启用！\n\n直接发送文件即可自动上传，支持图片、视频、音频、文档等多种格式。支持最大50Mb的文件上传(telegram bot自身限制)。', env);
      } else if (command === '/help') {
        await sendMessage(chatId, '📖 使用说明：\n\n1. 发送 /start 启动机器人（仅首次需要）。\n2. 直接发送图片、视频、音频、文档或其他文件，机器人会自动处理上传。\n3. 支持最大50Mb的文件上传（受Cloudflare Worker限制，超大文件可能会失败）。\n4. 无需输入其他命令，无需切换模式。\n5. 此机器人由 @uki0x 开发，支持多种文件类型上传', env);
      }
      return new Response('OK', { status: 200 });
    }

    // 自动处理图片
    if (message.photo && message.photo.length > 0) {
      await handlePhoto(message, chatId, env);
    }
    // 自动处理视频
    else if (message.video || (message.document &&
            (message.document.mime_type?.startsWith('video/') ||
             message.document.file_name?.match(/\.(mp4|avi|mov|wmv|flv|mkv|webm|m4v|3gp|mpeg|mpg|ts)$/i)))) {
      await handleVideo(message, chatId, !!message.document, env);
    }
    // 自动处理音频
    else if (message.audio || (message.document &&
            (message.document.mime_type?.startsWith('audio/') ||
             message.document.file_name?.match(/\.(mp3|wav|ogg|flac|aac|m4a|wma|opus|mid|midi)$/i)))) {
      await handleAudio(message, chatId, !!message.document, env);
    }
    // 自动处理动画/GIF
    else if (message.animation || (message.document &&
            (message.document.mime_type?.includes('animation') ||
             message.document.file_name?.match(/\.gif$/i)))) {
      await handleAnimation(message, chatId, !!message.document, env);
    }
    // 处理其他所有文档类型
    else if (message.document) {
      await handleDocument(message, chatId, env);
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
    if (fileSize / (1024 * 1024) > 2048) { // 2GB (2048MB)
      const warningMsg = `⚠️ 图片太大 (${formatFileSize(fileSize)})，超出2GB限制，无法上传。`;
      if (messageId) {
        await editMessage(chatId, messageId, warningMsg, env);
      } else {
        await sendMessage(chatId, warningMsg, env);
      }
      return;
    }

    const formData = new FormData();
    formData.append('file', new File([imgBuffer], fileName, { type: 'image/jpeg' }));

    const uploadUrl = new URL(IMG_BED_URL);
    uploadUrl.searchParams.append('returnFormat', 'full');

    if (AUTH_CODE) { // 检查从env获取的AUTH_CODE
      uploadUrl.searchParams.append('authCode', AUTH_CODE);
    }

    console.log(`图片上传请求 URL: ${uploadUrl.toString()}`);

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      body: formData
    });

    const responseText = await uploadResponse.text();
    console.log('图片上传原始响应:', responseText);

    let uploadResult;
    try {
      uploadResult = JSON.parse(responseText);
    } catch (e) {
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
      
      if (videoSize / (1024 * 1024) > 2048) { // 2GB (2048MB)
        const warningMsg = `⚠️ 视频太大 (${fileSizeFormatted})，超出2GB限制，无法上传。`;
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

      const uploadUrl = new URL(IMG_BED_URL);
      uploadUrl.searchParams.append('returnFormat', 'full');

      if (AUTH_CODE) { // 检查从env获取的AUTH_CODE
        uploadUrl.searchParams.append('authCode', AUTH_CODE);
      }

      console.log(`视频上传请求 URL: ${uploadUrl.toString()}`);

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
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
      const errorMsg = `❌ 处理视频时出错: ${error.message}\n\n可能是视频太大或格式不支持。`;
      if (messageId) {
        await editMessage(chatId, messageId, errorMsg, env);
      } else {
        await sendMessage(chatId, errorMsg, env);
      }
    }
  } else {
    const errorMsg = '❌ 无法获取视频信息，请稍后再试。';
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
      
      if (audioSize / (1024 * 1024) > 2048) { // 2GB (2048MB)
        const warningMsg = `⚠️ 音频太大 (${fileSizeFormatted})，超出2GB限制，无法上传。`;
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

      const uploadUrl = new URL(IMG_BED_URL);
      uploadUrl.searchParams.append('returnFormat', 'full');

      if (AUTH_CODE) {
        uploadUrl.searchParams.append('authCode', AUTH_CODE);
      }

      console.log(`音频上传请求 URL: ${uploadUrl.toString()}`);

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
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
      const errorMsg = `❌ 处理音频时出错: ${error.message}\n\n可能是音频太大或格式不支持。`;
      if (messageId) {
        await editMessage(chatId, messageId, errorMsg, env);
      } else {
        await sendMessage(chatId, errorMsg, env);
      }
    }
  } else {
    const errorMsg = '❌ 无法获取音频信息，请稍后再试。';
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
      
      if (animSize / (1024 * 1024) > 2048) { // 2GB (2048MB)
        const warningMsg = `⚠️ 动画太大 (${fileSizeFormatted})，超出2GB限制，无法上传。`;
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

      const uploadUrl = new URL(IMG_BED_URL);
      uploadUrl.searchParams.append('returnFormat', 'full');

      if (AUTH_CODE) {
        uploadUrl.searchParams.append('authCode', AUTH_CODE);
      }

      console.log(`动画上传请求 URL: ${uploadUrl.toString()}`);

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
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
      const errorMsg = `❌ 处理动画时出错: ${error.message}\n\n可能是文件太大或格式不支持。`;
      if (messageId) {
        await editMessage(chatId, messageId, errorMsg, env);
      } else {
        await sendMessage(chatId, errorMsg, env);
      }
    }
  } else {
    const errorMsg = '❌ 无法获取动画信息，请稍后再试。';
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

  // 从 env 获取配置
  const IMG_BED_URL = env.IMG_BED_URL;
  const BOT_TOKEN = env.BOT_TOKEN;
  const AUTH_CODE = env.AUTH_CODE;

  // 获取文件类型图标
  const fileIcon = getFileIcon(fileName, mimeType);
  
  // 发送处理中消息并获取消息ID以便后续更新
  const sendResult = await sendMessage(chatId, `${fileIcon} 正在处理您的文件 "${fileName}"，请稍候...`, env);
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

      if (fileSize / (1024 * 1024) > 2048) { // 2GB (2048MB)
        const warningMsg = `⚠️ 文件太大 (${fileSizeFormatted})，超出2GB限制，无法上传。`;
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
      
      // 如果是可执行文件，确保MIME类型正确
      let safeMimeType = mimeType;
      if (fileName.toLowerCase().endsWith('.exe')) {
        safeMimeType = 'application/octet-stream';
      }
      
      formData.append('file', new File([fileBuffer], safeFileName, { type: safeMimeType }));

      const uploadUrl = new URL(IMG_BED_URL);
      uploadUrl.searchParams.append('returnFormat', 'full');

      if (AUTH_CODE) {
        uploadUrl.searchParams.append('authCode', AUTH_CODE);
      }

      console.log(`文件上传请求 URL: ${uploadUrl.toString()}`);

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
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
      const errorMsg = `❌ 处理文件时出错: ${error.message}\n\n可能是文件太大或格式不支持。`;
      if (messageId) {
        await editMessage(chatId, messageId, errorMsg, env);
      } else {
        await sendMessage(chatId, errorMsg, env);
      }
    }
  } else {
    const errorMsg = '❌ 无法获取文件信息，请稍后再试。';
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
  const response = await fetch(`${API_URL}/getFile?file_id=${fileId}`);
  return await response.json();
}

// sendMessage 函数，接收 env 对象
async function sendMessage(chatId, text, env) {
  const BOT_TOKEN = env.BOT_TOKEN;
  const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`; // 构建API URL
  const response = await fetch(`${API_URL}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
    }),
  });
  return await response.json();
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
    
    // 图片文件
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'tif', 'ico', 'heic', 'heif', 'avif'].includes(ext)) {
      return '🖼️';
    }
    
    // 视频文件
    if (['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm', 'm4v', '3gp', 'mpeg', 'mpg', 'ts'].includes(ext)) {
      return '🎬';
    }
    
    // 音频文件
    if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus', 'mid', 'midi'].includes(ext)) {
      return '🎵';
    }
    
    // 文档文件
    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'md', 'csv', 'json', 'xml'].includes(ext)) {
      return '📝';
    }
    
    // 压缩文件
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(ext)) {
      return '🗜️';
    }
    
    // 可执行文件
    if (['exe', 'msi', 'apk', 'app', 'dmg', 'iso'].includes(ext)) {
      return '⚙️';
    }
    
    // 网页文件
    if (['html', 'htm', 'css', 'js'].includes(ext)) {
      return '🌐';
    }
    
    // 字体文件
    if (['ttf', 'otf', 'woff', 'woff2', 'eot'].includes(ext)) {
      return '🔤';
    }
    
    // 3D和设计文件
    if (['obj', 'fbx', 'blend', 'stl', 'psd', 'ai', 'eps', 'sketch', 'fig'].includes(ext)) {
      return '🎨';
    }
    
    // 其他常见文件
    if (['torrent', 'srt', 'vtt', 'ass', 'ssa'].includes(ext)) {
      return '📄';
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
