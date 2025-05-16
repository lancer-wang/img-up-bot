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
  const ADMIN_USERS = env.ADMIN_USERS ? env.ADMIN_USERS.split(',').map(id => id.trim()) : []; // 管理员用户ID列表

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
    const userId = message.from.id; // 获取用户ID
    const username = message.from.username || '未知用户';
    const text = message.text?.trim();
    
    // 检查用户是否被禁止使用机器人
    const isBanned = await isUserBanned(userId, env);
    const isAdmin = ADMIN_USERS.includes(userId.toString());
    
    // 如果用户被禁止且不是管理员，则拒绝处理请求
    if (isBanned && !isAdmin) {
      await sendMessage(chatId, `⛔ 很抱歉，您已被管理员限制使用本机器人。如需解除限制，请联系管理员。`, env);
      return new Response('OK', { status: 200 });
    }

    // 处理命令
    if (text && text.startsWith('/')) {
      console.log("收到命令:", text);
      const command = text.split(' ')[0];
      
      // 管理员命令
      if (command === '/admin' && isAdmin) {
        const subCommand = text.split(' ')[1]?.toLowerCase();
        const targetId = text.split(' ')[2];
        
        if (!subCommand) {
          // 显示管理员帮助
          await sendMessage(chatId, `🔐 *管理员命令面板*\n\n以下是可用的管理员命令：\n\n/admin ban [用户ID] - 限制指定用户使用机器人\n/admin unban [用户ID] - 解除对指定用户的限制\n/admin list - 查看所有被限制的用户\n/admin users - 查看所有使用过机器人的用户\n/admin stats - 查看机器人使用统计\n/admin broadcast [消息] - 向所有用户广播消息`, env);
          return new Response('OK', { status: 200 });
        }
        
        if (subCommand === 'ban' && targetId) {
          await banUser(targetId, username, env);
          await sendMessage(chatId, `✅ 已限制用户 ${targetId} 使用机器人`, env);
          return new Response('OK', { status: 200 });
        }
        
        if (subCommand === 'unban' && targetId) {
          await unbanUser(targetId, env);
          await sendMessage(chatId, `✅ 已解除对用户 ${targetId} 的限制`, env);
          return new Response('OK', { status: 200 });
        }
        
        if (subCommand === 'list') {
          const bannedUsers = await getBannedUsers(env);
          if (bannedUsers.length === 0) {
            await sendMessage(chatId, `📋 当前没有被限制的用户`, env);
          } else {
            let message = `📋 *被限制的用户列表*\n\n`;
            bannedUsers.forEach((user, index) => {
              message += `${index + 1}. 用户ID: ${user.userId}\n   封禁原因: ${user.reason || '未指定'}\n   封禁时间: ${formatDate(user.bannedAt)}\n   操作管理员: ${user.bannedBy || '未知'}\n\n`;
            });
            await sendMessage(chatId, message, env);
          }
          return new Response('OK', { status: 200 });
        }
        
        if (subCommand === 'users') {
          // 获取所有用户详细信息
          const usersList = await getAllUsersDetails(env);
          
          if (usersList.length === 0) {
            await sendMessage(chatId, `📋 目前没有用户使用过机器人`, env);
          } else {
            let message = `👥 *用户列表* (共${usersList.length}人)\n\n`;
            
            // 添加分页功能
            const page = parseInt(targetId) || 1;
            const itemsPerPage = 10;
            const totalPages = Math.ceil(usersList.length / itemsPerPage);
            const startIndex = (page - 1) * itemsPerPage;
            const endIndex = Math.min(startIndex + itemsPerPage, usersList.length);
            
            message += `📄 当前页码: ${page}/${totalPages}\n\n`;
            
            // 只显示当前页的用户
            const pageUsers = usersList.slice(startIndex, endIndex);
            
            for (let i = 0; i < pageUsers.length; i++) {
              const user = pageUsers[i];
              const userNumber = startIndex + i + 1;
              const isBanned = await isUserBanned(user.userId, env);
              
              message += `${userNumber}. 用户ID: ${user.userId}\n`;
              message += `   用户名: ${user.username || '未知'}\n`;
              message += `   首次使用: ${formatDate(user.firstSeen)}\n`;
              message += `   最后使用: ${formatDate(user.lastSeen)}\n`;
              
              // 获取该用户的上传统计
              const userStats = await getUserStats(user.userId, env);
              message += `   上传文件: ${userStats.totalUploads || 0} 个\n`;
              message += `   存储空间: ${formatFileSize(userStats.totalSize || 0)}\n`;
              message += `   状态: ${isBanned ? '⛔已限制' : '✅正常'}\n\n`;
            }
            
            // 添加翻页指引
            if (totalPages > 1) {
              message += `\n翻页指令:\n`;
              if (page > 1) {
                message += `/admin users ${page - 1} - 上一页\n`;
              }
              if (page < totalPages) {
                message += `/admin users ${page + 1} - 下一页\n`;
              }
            }
            
            await sendMessage(chatId, message, env);
          }
          return new Response('OK', { status: 200 });
        }
        
        if (subCommand === 'stats') {
          // 获取机器人使用统计
          const stats = await getBotStats(env);
          let message = `📊 *机器人使用统计*\n\n`;
          message += `👥 总用户数: ${stats.totalUsers || 0}\n`;
          message += `📤 总上传文件数: ${stats.totalUploads || 0}\n`;
          message += `📦 总上传大小: ${formatFileSize(stats.totalSize || 0)}\n`;
          message += `⛔ 被限制用户数: ${stats.bannedUsers || 0}\n`;
          await sendMessage(chatId, message, env);
          return new Response('OK', { status: 200 });
        }
        
        if (subCommand === 'broadcast' && text.split(' ').slice(2).join(' ')) {
          const broadcastMessage = text.split(' ').slice(2).join(' ');
          // 获取所有用户并发送广播
          const users = await getAllUsers(env);
          
          await sendMessage(chatId, `🔄 正在向 ${users.length} 个用户发送广播消息...`, env);
          
          let successCount = 0;
          for (const user of users) {
            try {
              await sendMessage(user, `📢 *管理员广播*\n\n${broadcastMessage}`, env);
              successCount++;
            } catch (error) {
              console.error(`向用户 ${user} 发送广播失败:`, error);
            }
          }
          
          await sendMessage(chatId, `✅ 广播完成！成功发送给 ${successCount}/${users.length} 个用户`, env);
          return new Response('OK', { status: 200 });
        }
      }
      
      if (command === '/start') {
        try {
          console.log("开始处理/start命令");
          const result = await sendMessage(chatId, '🤖 机器人已启用！\n\n直接发送文件即可自动上传，支持图片、视频、音频、文档等400多种格式。发送文件时添加文字描述可作为文件备注，方便后续查找。支持最大20Mb的文件上传(Telegram Bot自身限制)。', env);
          console.log("/start命令响应:", JSON.stringify(result).substring(0, 200));
          
          // 记录用户使用，更新用户列表
          await addUserToList(userId, username, env);
        } catch (error) {
          console.error("发送/start消息失败:", error);
        }
      } else if (command === '/help') {
        try {
          console.log("开始处理/help命令");
          const result = await sendMessage(chatId, '📖 使用说明：\n\n1. 发送 /start 启动机器人（仅首次需要）。\n2. 直接发送图片、视频、音频、文档或其他文件，机器人会自动处理上传。\n3. 发送图片视频文件时填入文字描述可作为文件备注，方便后续查找。\n4. 支持最大20Mb的文件上传（受Telegram Bot限制）。\n5. 支持400多种文件格式，包括常见的图片、视频、音频、文档、压缩包、可执行文件等。\n6. 使用 /formats 命令查看支持的文件格式类别。\n7. 使用 /analytics 命令查看所有统计分析（支持多种参数）。\n8. 使用 /history 命令查看您的上传历史记录。\n9. 此机器人由 @uki0x 开发', env);
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
      } else if (command === '/stats') {
        try {
          console.log("开始处理/stats命令");
          const stats = await getUserStats(chatId, env);
          const statsMessage = formatStatsMessage(stats);
          const result = await sendMessage(chatId, statsMessage, env);
          console.log("/stats命令响应:", JSON.stringify(result).substring(0, 200));
        } catch (error) {
          console.error("发送/stats消息失败:", error);
        }
      } else if (command === '/storage') {
        try {
          console.log("开始处理/storage命令");
          const stats = await getUserStats(chatId, env);
          const storageMessage = formatStorageMessage(stats);
          const result = await sendMessage(chatId, storageMessage, env);
          console.log("/storage命令响应:", JSON.stringify(result).substring(0, 200));
        } catch (error) {
          console.error("发送/storage消息失败:", error);
        }
      } else if (command === '/report') {
        try {
          console.log("开始处理/report命令");
          const periodArg = text.split(' ')[1]?.toLowerCase();
          let period = 'monthly'; // 默认为月报告
          
          if (periodArg === 'daily' || periodArg === 'day') {
            period = 'daily';
          } else if (periodArg === 'weekly' || periodArg === 'week') {
            period = 'weekly';
          }
          
          const report = await getUserReport(chatId, period, env);
          const reportMessage = formatReportMessage(report, period);
          const result = await sendMessage(chatId, reportMessage, env);
          console.log(`/${period} report命令响应:`, JSON.stringify(result).substring(0, 200));
        } catch (error) {
          console.error("发送/report消息失败:", error);
        }
      } else if (command === '/success_rate') {
        try {
          console.log("开始处理/success_rate命令");
          const stats = await getUserStats(chatId, env);
          const successRateMessage = formatSuccessRateMessage(stats);
          const result = await sendMessage(chatId, successRateMessage, env);
          console.log("/success_rate命令响应:", JSON.stringify(result).substring(0, 200));
        } catch (error) {
          console.error("发送/success_rate消息失败:", error);
        }
      } else if (command === '/analytics' || command === '/analytics@' + env.BOT_USERNAME) {
        try {
          console.log("开始处理/analytics命令");
          const args = text.split(' ')[1]?.toLowerCase();
          
          // 根据参数决定显示哪种统计信息
          if (args === 'storage') {
            // 显示存储统计
            const stats = await getUserStats(chatId, env);
            const storageMessage = formatStorageMessage(stats);
            await sendMessage(chatId, storageMessage, env);
          } else if (args === 'report' || args === 'daily' || args === 'weekly' || args === 'monthly') {
            // 显示使用报告
            let period = 'monthly'; // 默认为月报告
            
            if (args === 'daily') {
              period = 'daily';
            } else if (args === 'weekly') {
              period = 'weekly';
            }
            
            const report = await getUserReport(chatId, period, env);
            const reportMessage = formatReportMessage(report, period);
            await sendMessage(chatId, reportMessage, env);
          } else if (args === 'success' || args === 'success_rate') {
            // 显示成功率
            const stats = await getUserStats(chatId, env);
            const successRateMessage = formatSuccessRateMessage(stats);
            await sendMessage(chatId, successRateMessage, env);
          } else {
            // 默认显示综合统计信息
            const stats = await getUserStats(chatId, env);
            const statsMessage = formatStatsMessage(stats);
            await sendMessage(chatId, statsMessage, env);
          }
          
          console.log("/analytics命令响应已发送");
        } catch (error) {
          console.error("发送/analytics消息失败:", error);
          await sendMessage(chatId, `❌ 获取统计信息失败: ${error.message}`, env);
        }
      } else if (command === '/history' || command === '/history@' + env.BOT_USERNAME) {
        try {
          console.log("开始处理/history命令");
          // 解析参数
          const args = text.split(' ');
          let page = 1;
          let fileType = null;
          let searchQuery = null;
          let descQuery = null; // 新增：专门用于备注搜索的查询
          
          // 寻找搜索关键词
          if (text.includes('search:') || text.includes('搜索:')) {
            const searchMatch = text.match(/(search:|搜索:)\s*([^\s]+)/i);
            if (searchMatch && searchMatch[2]) {
              searchQuery = searchMatch[2].trim();
            }
          }
          
          // 寻找备注搜索关键词
          if (text.includes('desc:') || text.includes('备注:')) {
            const descMatch = text.match(/(desc:|备注:)\s*([^\s]+)/i);
            if (descMatch && descMatch[2]) {
              descQuery = descMatch[2].trim();
            }
          }
          
          // 解析页码参数
          for (let i = 1; i < args.length; i++) {
            const arg = args[i].toLowerCase();
            
            // 如果已经找到搜索关键词，跳过后续处理
            if (searchQuery || descQuery) continue;
            
            if (arg.startsWith('p') || arg.startsWith('page')) {
              const pageNum = parseInt(arg.replace(/^p(age)?/, ''));
              if (!isNaN(pageNum) && pageNum > 0) {
                page = pageNum;
              }
            } else if (['image', 'video', 'audio', 'document', 'animation'].includes(arg)) {
              fileType = arg;
            } else if (arg.startsWith('search:') || arg.startsWith('搜索:')) {
              searchQuery = arg.split(':')[1];
            } else if (arg.startsWith('desc:') || arg.startsWith('备注:')) {
              descQuery = arg.split(':')[1];
            }
          }
          
          await handleHistoryCommand(chatId, page, fileType, searchQuery, descQuery, env);
        } catch (error) {
          console.error("发送/history消息失败:", error);
          await sendMessage(chatId, `❌ 获取历史记录失败: ${error.message}`, env);
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
  // 获取用户的图片描述作为备注
  const photoDescription = message.caption || "";

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
        let msgText = `✅ 图片上传成功！\n\n` +
                     `📄 文件名: ${actualFileName}\n`;
        
        // 如果有图片描述，添加备注信息
        if (photoDescription) {
          msgText += `📝 备注: ${photoDescription}\n`;
        }
        
        msgText += `📦 文件大小: ${formatFileSize(actualFileSize)}\n\n` +
                  `🔗 URL：${imgUrl}`;
        
        // 更新之前的消息而不是发送新消息
        if (messageId) {
          await editMessage(chatId, messageId, msgText, env);
        } else {
          await sendMessage(chatId, msgText, env);
        }
        
        // 更新用户统计数据，添加备注字段
        await updateUserStats(chatId, {
          fileType: 'image',
          fileSize: actualFileSize,
          success: true,
          fileName: actualFileName,
          url: imgUrl,
          description: photoDescription
        }, env);
      } else {
        const errorMsg = `❌ 无法解析上传结果，原始响应:\n${responseText.substring(0, 200)}...`;
        if (messageId) {
          await editMessage(chatId, messageId, errorMsg, env);
        } else {
          await sendMessage(chatId, errorMsg, env);
        }
        
        // 更新失败统计
        await updateUserStats(chatId, {
          fileType: 'image',
          fileSize: fileSize,
          success: false
        }, env);
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
  // 获取用户的视频描述作为备注
  const videoDescription = message.caption || "";

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

      const extractedResult = extractUrlFromResult(uploadResult, IMG_BED_URL);
      const videoUrl = extractedResult.url;
      const actualFileName = extractedResult.fileName || fileName;
      const actualFileSize = extractedResult.fileSize || videoSize;

      if (videoUrl) {
        let msgText = `✅ 视频上传成功！\n\n` + 
                     `📄 文件名: ${actualFileName}\n`;
        
        // 如果有视频描述，添加备注信息
        if (videoDescription) {
          msgText += `📝 备注: ${videoDescription}\n`;
        }
        
        msgText += `📦 文件大小: ${formatFileSize(actualFileSize)}\n\n` +
                  `🔗 URL：${videoUrl}`;

        if (messageId) {
          await editMessage(chatId, messageId, msgText, env);
        } else {
          await sendMessage(chatId, msgText, env);
        }
        
        // 更新用户统计数据，添加备注字段
        await updateUserStats(chatId, {
          fileType: 'video',
          fileSize: actualFileSize,
          success: true,
          fileName: actualFileName,
          url: videoUrl,
          description: videoDescription
        }, env);
      } else {
        const errorMsg = `⚠️ 无法从图床获取视频链接。请稍后再试。`;
        if (messageId) {
          await editMessage(chatId, messageId, errorMsg, env);
        } else {
          await sendMessage(chatId, errorMsg, env);
        }
        
        // 更新失败统计
        await updateUserStats(chatId, {
          fileType: 'video',
          fileSize: videoSize,
          success: false
        }, env);
      }
    } catch (error) {
      console.error('处理视频时出错:', error);
      const errorMsg = `❌ 处理视频时出错: ${error.message}`;
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
  // 获取用户的音频描述作为备注
  const audioDescription = message.caption || "";

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
        let msgText = `✅ 音频上传成功！\n\n` +
                     `📄 文件名: ${actualFileName}\n`;
        
        // 如果有音频描述，添加备注信息
        if (audioDescription) {
          msgText += `📝 备注: ${audioDescription}\n`;
        }
        
        msgText += `📦 文件大小: ${formatFileSize(actualFileSize)}\n\n` +
                  `🔗 URL：${audioUrl}`;
        
        // 更新之前的消息而不是发送新消息
        if (messageId) {
          await editMessage(chatId, messageId, msgText, env);
        } else {
          await sendMessage(chatId, msgText, env);
        }
        
        // 更新用户统计数据，添加备注字段
        await updateUserStats(chatId, {
          fileType: 'audio',
          fileSize: actualFileSize,
          success: true,
          fileName: actualFileName,
          url: audioUrl,
          description: audioDescription
        }, env);
      } else {
        const errorMsg = `⚠️ 无法从图床获取音频链接。原始响应 (前200字符):\n${responseText.substring(0, 200)}... \n\n或者尝试Telegram临时链接 (有效期有限):\n${fileUrl}`;
        if (messageId) {
          await editMessage(chatId, messageId, errorMsg, env);
        } else {
          await sendMessage(chatId, errorMsg, env);
        }
        
        // 更新失败统计
        await updateUserStats(chatId, {
          fileType: 'audio',
          fileSize: audioSize,
          success: false
        }, env);
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
  // 获取用户的动画描述作为备注
  const animDescription = message.caption || "";

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
        let msgText = `✅ 动画/GIF上传成功！\n\n` +
                     `📄 文件名: ${actualFileName}\n`;
        
        // 如果有动画描述，添加备注信息
        if (animDescription) {
          msgText += `📝 备注: ${animDescription}\n`;
        }
        
        msgText += `📦 文件大小: ${formatFileSize(actualFileSize)}\n\n` +
                  `🔗 URL：${animUrl}`;
        
        // 更新之前的消息而不是发送新消息
        if (messageId) {
          await editMessage(chatId, messageId, msgText, env);
        } else {
          await sendMessage(chatId, msgText, env);
        }
        
        // 更新用户统计数据，添加备注字段
        await updateUserStats(chatId, {
          fileType: 'animation',
          fileSize: actualFileSize,
          success: true,
          fileName: actualFileName,
          url: animUrl,
          description: animDescription
        }, env);
      } else {
        const errorMsg = `⚠️ 无法从图床获取动画链接。原始响应 (前200字符):\n${responseText.substring(0, 200)}... \n\n或者尝试Telegram临时链接 (有效期有限):\n${fileUrl}`;
        if (messageId) {
          await editMessage(chatId, messageId, errorMsg, env);
        } else {
          await sendMessage(chatId, errorMsg, env);
        }
        
        // 更新失败统计
        await updateUserStats(chatId, {
          fileType: 'animation',
          fileSize: animSize,
          success: false
        }, env);
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
  // 获取用户的文件描述作为备注
  const fileDescription = message.caption || "";

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
        let msgText = `✅ 文件上传成功！\n\n` +
                       `📄 文件名: ${actualFileName}\n`;
        
        // 如果有文件描述，添加备注信息
        if (fileDescription) {
          msgText += `📝 备注: ${fileDescription}\n`;
        }
        
        msgText += `📦 文件大小: ${formatFileSize(actualFileSize)}\n\n` +
                   `🔗 URL：${fileUrl2}`;
        
        // 更新之前的消息而不是发送新消息
        if (messageId) {
          await editMessage(chatId, messageId, msgText, env);
        } else {
          await sendMessage(chatId, msgText, env);
        }
        
        // 更新用户统计数据，添加备注信息
        await updateUserStats(chatId, {
          fileType: 'document',
          fileSize: actualFileSize,
          success: true,
          fileName: actualFileName,
          url: fileUrl2,
          description: fileDescription // 添加备注字段
        }, env);
      } else {
        const errorMsg = `⚠️ 无法从图床获取文件链接。原始响应 (前200字符):\n${responseText.substring(0, 200)}... \n\n或者尝试Telegram临时链接 (有效期有限):\n${fileUrl}`;
        if (messageId) {
          await editMessage(chatId, messageId, errorMsg, env);
        } else {
          await sendMessage(chatId, errorMsg, env);
        }
        
        // 更新失败统计
        await updateUserStats(chatId, {
          fileType: 'document',
          fileSize: fileSize,
          success: false
        }, env);
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
      if (['exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'snap', 'flatpak', 'appimage', 'apk', 'ipa'].includes(ext)) {
        return '⚙️';
      }
      
      // 光盘镜像
      if (['iso', 'img', 'vdi', 'vmdk', 'vhd', 'vhdx', 'ova', 'ovf'].includes(ext)) {
        return '💿';
      }
      
      // 小众图像格式
      if (['tiff', 'tif', 'bmp', 'pcx', 'tga', 'icns', 'heic', 'heif', 'arw', 'cr2', 'nef', 'orf', 'rw2', 'dng', 'raf', 'raw'].includes(ext)) {
        return '🖼️';
      }
      
      // 小众档案格式
      if (['z', 'lz', 'lzma', 'lzo', 'rz', 'sfx', 'cab', 'arj', 'lha', 'lzh', 'zoo', 'arc', 'ace', 'dgc', 'dgn', 'lbr', 'pak', 'pit', 'sit', 'sqx', 'gz.gpg', 'z.gpg'].includes(ext)) {
        return '🗜️';
      }
      
      // 小众视频格式
      if (['rmvb', 'rm', 'asf', 'amv', 'mts', 'm2ts', 'vob', 'divx', 'mpeg', 'mpg', 'mpe', 'tp', 'ts', 'ogm', 'ogv'].includes(ext)) {
        return '🎬';
      }
      
      // 小众音频格式
      if (['ape', 'wma', 'ra', 'amr', 'au', 'voc', 'ac3', 'dsf', 'dsd', 'dts', 'dtsma', 'ast', 'aiff', 'aifc', 'spx', 'gsm', 'wv', 'tta', 'mpc', 'tak'].includes(ext)) {
        return '🎵';
      }
      
      // 小众电子书和文档格式
      if (['lit', 'lrf', 'opf', 'prc', 'azw1', 'azw4', 'azw6', 'cbz', 'cbr', 'cb7', 'cbt', 'cba', 'chm', 'xps', 'oxps', 'ps', 'dvi'].includes(ext)) {
        return '📝';
      }
      
      // 小众开发和数据格式
      if (['wasm', 'wat', 'f', 'for', 'f90', 'f95', 'hs', 'lhs', 'elm', 'clj', 'csv', 'tsv', 'parquet', 'avro', 'proto', 'pbtxt', 'fbs'].includes(ext)) {
        return '📄';
      }
      
      // 3D和游戏相关格式
      if (['obj', 'fbx', 'dae', '3ds', 'stl', 'gltf', 'glb', 'blend', 'mb', 'unity3d', 'unitypackage', 'max', 'c4d', 'w3x', 'pk3', 'wad', 'bsp', 'map', 'rom', 'n64', 'z64', 'v64', 'nes', 'smc', 'sfc', 'gb', 'gbc', 'gba', 'nds'].includes(ext)) {
        return '🎨';
      }
      
      // 科学和专业格式
      if (['mat', 'fits', 'hdf', 'hdf5', 'h5', 'nx', 'ngc', 'nxs', 'nb', 'cdf', 'nc', 'spss', 'sav', 'dta', 'do', 'odb', 'odt', 'ott', 'odp', 'otp', 'ods', 'ots'].includes(ext)) {
        return '📊';
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
  ].includes(fileExt.toLowerCase());
}

// 更新用户统计数据
async function updateUserStats(chatId, data, env) {
  try {
    if (!env.STATS_STORAGE) {
      console.log("KV存储未配置，跳过统计更新");
      return;
    }
    
    const statsKey = `user_stats_${chatId}`;
    const userStats = await getUserStats(chatId, env);
    
    // 更新总上传数据
    userStats.totalUploads += 1;
    
    // 更新文件类型计数
    const fileType = data.fileType || 'other';
    userStats.fileTypes[fileType] = (userStats.fileTypes[fileType] || 0) + 1;
    
    // 更新总大小
    if (data.fileSize) {
      userStats.totalSize += data.fileSize;
    }
    
    // 更新成功/失败计数
    if (data.success) {
      userStats.successfulUploads += 1;
      
      // 如果上传成功，添加到历史记录
      if (!userStats.uploadHistory) {
        userStats.uploadHistory = [];
      }
      
      // 创建历史记录条目
      const historyEntry = {
        id: Date.now().toString(), // 使用时间戳作为唯一ID
        timestamp: new Date().toISOString(),
        fileName: data.fileName || `file_${Date.now()}`,
        fileType: fileType,
        fileSize: data.fileSize || 0,
        url: data.url || '',
        thumbnailUrl: data.thumbnailUrl || '',
        description: data.description || '' // 添加备注字段
      };
      
      // 添加到历史记录，保持最新的记录在前面
      userStats.uploadHistory.unshift(historyEntry);
      
      // 限制历史记录大小，最多保存100条
      if (userStats.uploadHistory.length > 100) {
        userStats.uploadHistory = userStats.uploadHistory.slice(0, 100);
      }
    } else {
      userStats.failedUploads += 1;
    }
    
    // 更新时间记录
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // 日报告
    if (!userStats.dailyData[todayStr]) {
      userStats.dailyData[todayStr] = {
        uploads: 0,
        size: 0,
        successful: 0,
        failed: 0
      };
    }
    userStats.dailyData[todayStr].uploads += 1;
    userStats.dailyData[todayStr].size += (data.fileSize || 0);
    if (data.success) {
      userStats.dailyData[todayStr].successful += 1;
    } else {
      userStats.dailyData[todayStr].failed += 1;
    }
    
    // 限制dailyData大小，保留最近60天的数据
    const dailyKeys = Object.keys(userStats.dailyData).sort();
    if (dailyKeys.length > 60) {
      const keysToRemove = dailyKeys.slice(0, dailyKeys.length - 60);
      keysToRemove.forEach(key => {
        delete userStats.dailyData[key];
      });
    }
    
    // 保存更新后的统计数据
    await env.STATS_STORAGE.put(statsKey, JSON.stringify(userStats));
    console.log(`已更新用户${chatId}的统计数据`);
  } catch (error) {
    console.error(`更新用户统计数据时出错:`, error);
  }
}

// 获取用户统计数据
async function getUserStats(chatId, env) {
  try {
    if (!env.STATS_STORAGE) {
      console.log("KV存储未配置，返回空统计");
      return createEmptyStats();
    }
    
    const statsKey = `user_stats_${chatId}`;
    const storedStats = await env.STATS_STORAGE.get(statsKey);
    
    if (!storedStats) {
      return createEmptyStats();
    }
    
    return JSON.parse(storedStats);
  } catch (error) {
    console.error(`获取用户统计数据时出错:`, error);
    return createEmptyStats();
  }
}

// 创建空的统计数据结构
function createEmptyStats() {
  return {
    totalUploads: 0,
    successfulUploads: 0,
    failedUploads: 0,
    totalSize: 0,
    fileTypes: {},
    dailyData: {},
    createdAt: new Date().toISOString(),
    uploadHistory: [] // 添加上传历史数组
  };
}

// 获取用户报告
async function getUserReport(chatId, period, env) {
  const stats = await getUserStats(chatId, env);
  
  // 获取当前日期
  const now = new Date();
  const report = {
    period: period,
    data: {}
  };
  
  if (period === 'daily') {
    // 日报表只返回今天的数据
    const todayStr = now.toISOString().split('T')[0];
    if (stats.dailyData[todayStr]) {
      report.data[todayStr] = stats.dailyData[todayStr];
    }
  } else if (period === 'weekly') {
    // 周报表返回过去7天的数据
    for (let i = 0; i < 7; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      if (stats.dailyData[dateStr]) {
        report.data[dateStr] = stats.dailyData[dateStr];
      }
    }
  } else {
    // 月报表返回过去30天的数据
    for (let i = 0; i < 30; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      if (stats.dailyData[dateStr]) {
        report.data[dateStr] = stats.dailyData[dateStr];
      }
    }
  }
  
  return report;
}

// 格式化统计消息
function formatStatsMessage(stats) {
  let message = `📊 *用户统计信息* 📊\n\n`;
  
  message += `📤 *总上传文件*: ${stats.totalUploads} 个文件\n`;
  message += `📦 *总存储空间*: ${formatFileSize(stats.totalSize)}\n`;
  message += `✅ *成功上传*: ${stats.successfulUploads} 个文件\n`;
  message += `❌ *失败上传*: ${stats.failedUploads} 个文件\n\n`;
  
  // 计算成功率
  const successRate = stats.totalUploads > 0 
    ? Math.round((stats.successfulUploads / stats.totalUploads) * 100) 
    : 0;
  
  message += `📈 *上传成功率*: ${successRate}%\n\n`;
  
  // 文件类型统计
  message += `*文件类型分布*:\n`;
  for (const [type, count] of Object.entries(stats.fileTypes)) {
    const icon = type === 'image' ? '🖼️' : 
                type === 'video' ? '🎬' : 
                type === 'audio' ? '🎵' : 
                type === 'animation' ? '🎞️' : 
                type === 'document' ? '📄' : '📁';
    
    message += `${icon} ${type}: ${count} 个文件\n`;
  }
  
  return message;
}

// 格式化存储消息
function formatStorageMessage(stats) {
  let message = `📊 *存储使用情况* 📊\n\n`;
  
  message += `📦 *总存储空间*: ${formatFileSize(stats.totalSize)}\n\n`;
  
  // 基于文件类型的存储分布
  message += `*存储空间分布*:\n`;
  
  // 遍历dailyData计算每种文件类型的总大小
  // 由于现在无法直接追踪每种类型的大小，这里只能显示总体情况
  
  // 计算平均文件大小
  const avgFileSize = stats.totalUploads > 0 
    ? stats.totalSize / stats.totalUploads 
    : 0;
  
  message += `📊 *平均文件大小*: ${formatFileSize(avgFileSize)}\n\n`;
  
  // 添加使用趋势
  message += `📈 *存储使用趋势*:\n`;
  message += `使用 /report 命令查看详细的使用报告\n`;
  
  return message;
}

// 格式化报告消息
function formatReportMessage(report, period) {
  const periodName = period === 'daily' ? '日' : 
                   period === 'weekly' ? '周' : '月';
  
  let message = `📊 *${periodName}度报告* 📊\n\n`;
  
  // 计算总计
  let totalUploads = 0;
  let totalSize = 0;
  let totalSuccessful = 0;
  let totalFailed = 0;
  
  for (const data of Object.values(report.data)) {
    totalUploads += data.uploads || 0;
    totalSize += data.size || 0;
    totalSuccessful += data.successful || 0;
    totalFailed += data.failed || 0;
  }
  
  message += `📤 *总上传文件*: ${totalUploads} 个文件\n`;
  message += `📦 *总存储空间*: ${formatFileSize(totalSize)}\n`;
  message += `✅ *成功上传*: ${totalSuccessful} 个文件\n`;
  message += `❌ *失败上传*: ${totalFailed} 个文件\n\n`;
  
  // 每日/每周/每月数据
  message += `*${periodName}度数据明细*:\n`;
  
  // 按日期排序
  const sortedDates = Object.keys(report.data).sort();
  
  for (const date of sortedDates) {
    const data = report.data[date];
    message += `📅 ${date}: ${data.uploads || 0} 个文件, ${formatFileSize(data.size || 0)}\n`;
  }
  
  return message;
}

// 格式化成功率消息
function formatSuccessRateMessage(stats) {
  let message = `📊 *上传成功率分析* 📊\n\n`;
  
  // 计算总体成功率
  const successRate = stats.totalUploads > 0 
    ? Math.round((stats.successfulUploads / stats.totalUploads) * 100) 
    : 0;
  
  message += `✅ *总体成功率*: ${successRate}%\n`;
  message += `📤 *总上传*: ${stats.totalUploads} 个文件\n`;
  message += `✓ *成功上传*: ${stats.successfulUploads} 个文件\n`;
  message += `✗ *失败上传*: ${stats.failedUploads} 个文件\n\n`;
  
  // 按文件类型的成功率
  message += `*各文件类型成功率*:\n`;
  for (const [type, count] of Object.entries(stats.fileTypes)) {
    // 由于我们没有按类型跟踪成功/失败，这里只显示总数
    const icon = type === 'image' ? '🖼️' : 
               type === 'video' ? '🎬' : 
               type === 'audio' ? '🎵' : 
               type === 'animation' ? '🎞️' : 
               type === 'document' ? '📄' : '📁';
    
    message += `${icon} ${type}: ${count} 个文件\n`;
  }
  
  // 添加时间趋势
  message += `\n📈 *使用频率*:\n`;
  message += `使用 /report 命令查看详细的使用报告\n`;
  
  return message;
}

// 处理历史命令
async function handleHistoryCommand(chatId, page, fileType, searchQuery, descQuery, env) {
  try {
    // 每页显示的记录数
    const ITEMS_PER_PAGE = 5;
    
    // 获取用户统计数据
    const userStats = await getUserStats(chatId, env);
    
    // 检查是否有上传历史
    if (!userStats.uploadHistory || userStats.uploadHistory.length === 0) {
      await sendMessage(chatId, "📂 您还没有上传过任何文件。", env);
      return;
    }
    
    // 检查是否是删除请求
    const args = fileType ? fileType.split('_') : [];
    if (args.length > 0 && args[0] === 'delete' && args[1]) {
      // 处理删除请求
      const recordId = args[1];
      await handleDeleteHistoryRecord(chatId, recordId, env);
      return;
    }
    
    // 根据文件类型过滤历史记录
    let filteredHistory = userStats.uploadHistory;
    if (fileType && !fileType.startsWith('delete_')) {
      filteredHistory = filteredHistory.filter(entry => entry.fileType === fileType);
      
      if (filteredHistory.length === 0) {
        await sendMessage(chatId, `📂 没有找到类型为 ${fileType} 的上传记录。`, env);
        return;
      }
    }
    
    // 搜索功能：根据关键词过滤（包括文件名和备注）
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filteredHistory = filteredHistory.filter(entry => 
        (entry.fileName && entry.fileName.toLowerCase().includes(query)) ||
        (entry.description && entry.description.toLowerCase().includes(query))
      );
      
      if (filteredHistory.length === 0) {
        await sendMessage(chatId, `📂 没有找到包含关键词 "${searchQuery}" 的上传记录。`, env);
        return;
      }
    }
    
    // 备注搜索功能：根据备注关键词过滤
    if (descQuery) {
      const descQueryLower = descQuery.toLowerCase();
      filteredHistory = filteredHistory.filter(entry => 
        entry.description && entry.description.toLowerCase().includes(descQueryLower)
      );
      
      if (filteredHistory.length === 0) {
        await sendMessage(chatId, `📂 没有找到包含备注关键词 "${descQuery}" 的上传记录。`, env);
        return;
      }
    }
    
    // 计算总页数
    const totalPages = Math.ceil(filteredHistory.length / ITEMS_PER_PAGE);
    
    // 验证页码范围
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    
    // 计算当前页的记录
    const startIndex = (page - 1) * ITEMS_PER_PAGE;
    const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, filteredHistory.length);
    const pageRecords = filteredHistory.slice(startIndex, endIndex);
    
    // 生成历史记录消息
    let message = `📋 *上传历史记录* ${fileType ? `(${fileType})` : ''} ${searchQuery ? `🔍搜索: "${searchQuery}"` : ''} ${descQuery ? `🔍备注搜索: "${descQuery}"` : ''}\n\n`;
    
    for (let i = 0; i < pageRecords.length; i++) {
      const record = pageRecords[i];
      const date = new Date(record.timestamp);
      const formattedDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
      
      // 获取文件类型图标
      const fileIcon = getFileTypeIcon(record.fileType);
      
      message += `${i + 1 + startIndex}. ${fileIcon} *${record.fileName}*\n`;
      
      // 如果有备注，显示备注信息
      if (record.description) {
        message += `   📝 备注: ${record.description}\n`;
      }
      
      message += `   📅 上传时间: ${formattedDate}\n`;
      message += `   📦 文件大小: ${formatFileSize(record.fileSize)}\n`;
      message += `   🔗 URL: ${record.url}\n`;
      message += `   🆔 记录ID: ${record.id}\n\n`;
    }
    
    // 添加分页导航信息
    message += `📄 页码: ${page}/${totalPages}`;
    
    // 添加导航说明
    message += `\n\n使用命令 /history page${page+1} 查看下一页`;
    if (page > 1) {
      message += `\n使用命令 /history page${page-1} 查看上一页`;
    }
    
    // 添加筛选说明
    if (!fileType && !searchQuery && !descQuery) {
      message += `\n\n可按文件类型筛选:\n/history image - 仅查看图片\n/history video - 仅查看视频\n/history document - 仅查看文档`;
    } else if (!searchQuery && !descQuery) {
      message += `\n\n使用 /history 查看所有类型的文件`;
    } else if (!descQuery) {
      message += `\n\n使用 /history search:关键词 查看包含关键词的文件`;
    } else {
      message += `\n\n使用 /history desc:关键词 查看包含备注关键词的文件`;
    }
    
    // 添加搜索说明
    message += `\n\n🔍 要搜索文件名或备注，请使用:\n/history search:关键词`;
    
    // 添加备注搜索说明
    message += `\n\n🔍 要搜索备注，请使用:\n/history desc:关键词`;
    
    // 添加删除说明
    message += `\n\n🗑️ 要删除某条记录，请使用:\n/history delete_记录ID`;
    
    await sendMessage(chatId, message, env);
  } catch (error) {
    console.error("处理历史命令出错:", error);
    await sendMessage(chatId, `❌ 获取历史记录失败: ${error.message}`, env);
  }
}

// 处理删除历史记录请求
async function handleDeleteHistoryRecord(chatId, recordId, env) {
  try {
    if (!env.STATS_STORAGE) {
      await sendMessage(chatId, "❌ KV存储未配置，无法删除记录", env);
      return;
    }
    
    const statsKey = `user_stats_${chatId}`;
    const userStats = await getUserStats(chatId, env);
    
    if (!userStats.uploadHistory || userStats.uploadHistory.length === 0) {
      await sendMessage(chatId, "📂 您还没有上传过任何文件。", env);
      return;
    }
    
    // 查找记录索引
    const recordIndex = userStats.uploadHistory.findIndex(record => record.id === recordId);
    
    if (recordIndex === -1) {
      await sendMessage(chatId, "❌ 未找到指定的记录，可能已被删除。", env);
      return;
    }
    
    // 获取记录详情用于确认消息
    const record = userStats.uploadHistory[recordIndex];
    
    // 删除记录
    userStats.uploadHistory.splice(recordIndex, 1);
    
    // 保存更新后的统计数据
    await env.STATS_STORAGE.put(statsKey, JSON.stringify(userStats));
    
    // 发送确认消息
    let confirmMessage = `✅ 已成功删除以下记录:\n\n` +
                         `📄 文件名: ${record.fileName}\n`;
    
    // 如果有备注，添加备注信息
    if (record.description) {
      confirmMessage += `📝 备注: ${record.description}\n`;
    }
    
    confirmMessage += `📅 上传时间: ${formatDate(record.timestamp)}\n` +
                     `🔗 URL: ${record.url}`;
    
    await sendMessage(chatId, confirmMessage, env);
  } catch (error) {
    console.error("删除历史记录出错:", error);
    await sendMessage(chatId, `❌ 删除记录失败: ${error.message}`, env);
  }
}

// 格式化日期
function formatDate(dateString) {
  try {
    const date = new Date(dateString);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  } catch (e) {
    return dateString;
  }
}

// 获取文件类型图标
function getFileTypeIcon(fileType) {
  switch (fileType) {
    case 'image': return '🖼️';
    case 'video': return '🎬';
    case 'audio': return '🎵';
    case 'animation': return '🎞️';
    case 'document': return '📄';
    default: return '📁';
  }
}

// 检查用户是否被禁止
async function isUserBanned(userId, env) {
  try {
    if (!env.STATS_STORAGE) return false;
    
    const bannedUsersKey = 'banned_users';
    const bannedUsersData = await env.STATS_STORAGE.get(bannedUsersKey);
    
    if (!bannedUsersData) return false;
    
    const bannedUsers = JSON.parse(bannedUsersData);
    return bannedUsers.some(user => user.userId.toString() === userId.toString());
  } catch (error) {
    console.error('检查用户是否被禁止时出错:', error);
    return false;
  }
}

// 禁止用户
async function banUser(userId, reason, env) {
  try {
    if (!env.STATS_STORAGE) return false;
    
    const bannedUsersKey = 'banned_users';
    const bannedUsersData = await env.STATS_STORAGE.get(bannedUsersKey);
    
    let bannedUsers = [];
    if (bannedUsersData) {
      bannedUsers = JSON.parse(bannedUsersData);
    }
    
    // 检查用户是否已被禁止
    const existingIndex = bannedUsers.findIndex(user => user.userId.toString() === userId.toString());
    
    if (existingIndex !== -1) {
      // 更新禁止信息
      bannedUsers[existingIndex] = {
        ...bannedUsers[existingIndex],
        reason: reason,
        bannedAt: new Date().toISOString()
      };
    } else {
      // 添加新的禁止用户
      bannedUsers.push({
        userId: userId,
        reason: reason,
        bannedAt: new Date().toISOString(),
        bannedBy: 'admin' // 可以改为记录真实管理员ID或名称
      });
    }
    
    await env.STATS_STORAGE.put(bannedUsersKey, JSON.stringify(bannedUsers));
    return true;
  } catch (error) {
    console.error('禁止用户时出错:', error);
    return false;
  }
}

// 解除用户禁止
async function unbanUser(userId, env) {
  try {
    if (!env.STATS_STORAGE) return false;
    
    const bannedUsersKey = 'banned_users';
    const bannedUsersData = await env.STATS_STORAGE.get(bannedUsersKey);
    
    if (!bannedUsersData) return true; // 没有禁止列表，直接返回成功
    
    let bannedUsers = JSON.parse(bannedUsersData);
    
    // 移除指定用户
    bannedUsers = bannedUsers.filter(user => user.userId.toString() !== userId.toString());
    
    await env.STATS_STORAGE.put(bannedUsersKey, JSON.stringify(bannedUsers));
    return true;
  } catch (error) {
    console.error('解除用户禁止时出错:', error);
    return false;
  }
}

// 获取被禁止的用户列表
async function getBannedUsers(env) {
  try {
    if (!env.STATS_STORAGE) return [];
    
    const bannedUsersKey = 'banned_users';
    const bannedUsersData = await env.STATS_STORAGE.get(bannedUsersKey);
    
    if (!bannedUsersData) return [];
    
    return JSON.parse(bannedUsersData);
  } catch (error) {
    console.error('获取被禁止用户列表时出错:', error);
    return [];
  }
}

// 添加用户到用户列表
async function addUserToList(userId, username, env) {
  try {
    if (!env.STATS_STORAGE) return false;
    
    const usersListKey = 'users_list';
    const usersListData = await env.STATS_STORAGE.get(usersListKey);
    
    let usersList = [];
    if (usersListData) {
      usersList = JSON.parse(usersListData);
    }
    
    // 检查用户是否已存在
    const existingIndex = usersList.findIndex(user => user.userId.toString() === userId.toString());
    
    if (existingIndex !== -1) {
      // 更新用户信息
      usersList[existingIndex] = {
        ...usersList[existingIndex],
        username: username,
        lastSeen: new Date().toISOString()
      };
    } else {
      // 添加新用户
      usersList.push({
        userId: userId,
        username: username,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString()
      });
    }
    
    await env.STATS_STORAGE.put(usersListKey, JSON.stringify(usersList));
    return true;
  } catch (error) {
    console.error('添加用户到用户列表时出错:', error);
    return false;
  }
}

// 获取所有用户
async function getAllUsers(env) {
  try {
    if (!env.STATS_STORAGE) return [];
    
    const usersListKey = 'users_list';
    const usersListData = await env.STATS_STORAGE.get(usersListKey);
    
    if (!usersListData) return [];
    
    const usersList = JSON.parse(usersListData);
    return usersList.map(user => user.userId);
  } catch (error) {
    console.error('获取所有用户时出错:', error);
    return [];
  }
}

// 获取机器人使用统计
async function getBotStats(env) {
  try {
    if (!env.STATS_STORAGE) return {};
    
    // 获取用户列表
    const usersListKey = 'users_list';
    const usersListData = await env.STATS_STORAGE.get(usersListKey);
    let usersList = [];
    if (usersListData) {
      usersList = JSON.parse(usersListData);
    }
    
    // 获取被禁止用户列表
    const bannedUsers = await getBannedUsers(env);
    
    // 计算总上传统计
    let totalUploads = 0;
    let totalSize = 0;
    
    // 遍历所有用户获取上传统计
    for (const user of usersList) {
      const statsKey = `user_stats_${user.userId}`;
      const userStatsData = await env.STATS_STORAGE.get(statsKey);
      
      if (userStatsData) {
        const userStats = JSON.parse(userStatsData);
        totalUploads += userStats.totalUploads || 0;
        totalSize += userStats.totalSize || 0;
      }
    }
    
    return {
      totalUsers: usersList.length,
      totalUploads: totalUploads,
      totalSize: totalSize,
      bannedUsers: bannedUsers.length
    };
  } catch (error) {
    console.error('获取机器人使用统计时出错:', error);
    return {};
  }
}

// 获取所有用户的详细信息
async function getAllUsersDetails(env) {
  try {
    if (!env.STATS_STORAGE) return [];
    
    const usersListKey = 'users_list';
    const usersListData = await env.STATS_STORAGE.get(usersListKey);
    
    if (!usersListData) return [];
    
    // 返回完整的用户信息列表，包括时间、用户名等
    return JSON.parse(usersListData);
  } catch (error) {
    console.error('获取所有用户详细信息时出错:', error);
    return [];
  }
}
