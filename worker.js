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
        await sendMessage(chatId, '🤖 机器人已启用！\n\n直接发送图片或视频即可自动上传，无需输入命令。', env);
      } else if (command === '/help') {
        await sendMessage(chatId, '📖 使用说明：\n\n1. 发送 /start 启动机器人（仅首次需要）。\n2. 直接发送图片或视频，机器人会自动处理上传。\n3. 无需输入其他命令，无需切换模式。\n4. 此机器人由 @uki0x 开发', env); // 传递env
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
             message.document.file_name?.match(/\.(mp4|avi|mov|wmv|flv|mkv)$/i)))) {
      await handleVideo(message, chatId, !!message.document, env);
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

  await sendMessage(chatId, '🔄 正在处理您的图片，请稍候...', env);

  const fileInfo = await getFile(fileId, env); // 传递env

  if (fileInfo && fileInfo.ok) {
    const filePath = fileInfo.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    const imgResponse = await fetch(fileUrl);
    const imgBuffer = await imgResponse.arrayBuffer();

    const formData = new FormData();
    formData.append('file', new File([imgBuffer], 'image.jpg', { type: 'image/jpeg' }));

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

    let imgUrl = extractUrlFromResult(uploadResult, IMG_BED_URL); // 传递 IMG_BED_URL 作为基础

    if (imgUrl) {
      const plainLink = imgUrl;
      const msgText = `✅ 图片上传成功！\n\n` +
                     `🔗 原始链接:\n${plainLink}\n\n`;
      await sendMessage(chatId, msgText, env);
    } else {
      await sendMessage(chatId, `❌ 无法解析上传结果，原始响应:\n${responseText.substring(0, 200)}...`, env);
    }
  } else {
    await sendMessage(chatId, '❌ 无法获取图片信息，请稍后再试。', env);
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

  await sendMessage(chatId, '🔄 正在处理您的视频，请稍候...\n(视频处理可能需要较长时间，取决于视频大小)', env);

  const fileInfo = await getFile(fileId, env); // 传递env

  if (fileInfo && fileInfo.ok) {
    const filePath = fileInfo.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    try {
      const videoResponse = await fetch(fileUrl);
      if (!videoResponse.ok) throw new Error(`获取视频失败: ${videoResponse.status}`);

      const videoBuffer = await videoResponse.arrayBuffer();
      const videoSize = videoBuffer.byteLength / (1024 * 1024); // MB

      if (videoSize > 200) { // 注意：检查 Cloudflare Worker 的内存和CPU限制
        await sendMessage(chatId, `⚠️ 视频太大 (${videoSize.toFixed(2)}MB)，可能无法在Worker环境中处理或上传。尝试上传中...`, env);
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

      let videoUrl = extractUrlFromResult(uploadResult, IMG_BED_URL); // 传递 IMG_BED_URL 作为基础

      if (videoUrl) {
        const plainLink = videoUrl;
        const msgText = `✅ 视频上传成功！\n\n` +
                       `🔗 下载链接:\n${plainLink}\n\n`;
        await sendMessage(chatId, msgText, env);
      } else {
        await sendMessage(chatId, `⚠️ 无法从图床获取视频链接。原始响应 (前200字符):\n${responseText.substring(0, 200)}... \n\n或者尝试Telegram临时链接 (有效期有限):\n${fileUrl}`, env);
      }
    } catch (error) {
      console.error('处理视频时出错:', error);
      await sendMessage(chatId, `❌ 处理视频时出错: ${error.message}\n\n可能是视频太大或格式不支持。`, env);
    }
  } else {
    await sendMessage(chatId, '❌ 无法获取视频信息，请稍后再试。', env);
  }
}

// 辅助函数：从图床返回结果中提取URL，接收基础URL
function extractUrlFromResult(result, imgBedUrl) {
  let url = '';
  // 尝试从传入的 IMG_BED_URL 获取 origin
  let baseUrl = 'https://your.default.domain'; // 提供一个备用基础URL
  try {
      if (imgBedUrl && (imgBedUrl.startsWith('https://') || imgBedUrl.startsWith('http://'))) {
         baseUrl = new URL(imgBedUrl).origin;
      }
  } catch (e) {
      console.error("无法解析 IMG_BED_URL:", imgBedUrl, e);
  }


  if (Array.isArray(result) && result.length > 0) {
    const item = result[0];
    if (item.url) url = item.url;
    else if (item.src) url = item.src.startsWith('http') ? item.src : `${baseUrl}${item.src}`; // 使用动态baseUrl
    else if (typeof item === 'string') url = item.startsWith('http') ? item : `${baseUrl}/file/${item}`; // 使用动态baseUrl
  }
  else if (result && typeof result === 'object') {
    if (result.url) url = result.url;
    else if (result.src) url = result.src.startsWith('http') ? result.src : `${baseUrl}${result.src}`; // 使用动态baseUrl
    else if (result.file) url = `${baseUrl}/file/${result.file}`; // 使用动态baseUrl
    else if (result.data && result.data.url) url = result.data.url;
  }
  else if (typeof result === 'string') {
    if (result.startsWith('http://') || result.startsWith('https://')) {
        url = result;
    } else {
        url = `${baseUrl}/file/${result}`; // 使用动态baseUrl
    }
  }
  return url;
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
