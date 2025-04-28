const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Jimp = require('jimp');

// 详细错误日志函数
function logError(message, error) {
  console.error(`=================== ERROR ===================`);
  console.error(`${message}`);
  console.error(`时间: ${new Date().toISOString()}`);
  if (error) {
    console.error(`错误类型: ${error.name}`);
    console.error(`错误信息: ${error.message}`);
    console.error(`错误堆栈: ${error.stack}`);
  }
  console.error(`===========================================`);
}

// 未捕获的异常和Promise拒绝处理
process.on('uncaughtException', (error) => {
  logError('未捕获的异常', error);
  // 不退出进程，让服务器继续运行
});

process.on('unhandledRejection', (reason, promise) => {
  logError('未处理的Promise拒绝', reason instanceof Error ? reason : new Error(String(reason)));
});

// 检测是否在Vercel环境中运行
const isVercel = process.env.VERCEL === '1';

// 创建Express应用
const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors({
  origin: '*', // 允许所有来源访问
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// 静态文件提供
app.use(express.static(path.join(__dirname, 'public')));

// 在Vercel环境中特殊处理输出文件
if (isVercel) {
  // 将/outputs路径指向临时目录
  app.use('/outputs', (req, res, next) => {
    const requestedFile = req.path;
    const tmpFilePath = path.join('/tmp/outputs', requestedFile);
    const publicFilePath = path.join(__dirname, 'public', 'outputs', requestedFile);
    
    // 尝试按顺序从不同位置提供文件
    if (fs.existsSync(publicFilePath)) {
      return res.sendFile(publicFilePath);
    } else if (fs.existsSync(tmpFilePath)) {
      return res.sendFile(tmpFilePath);
    } else {
      // 请求的文件不存在
      console.log(`文件不存在: ${requestedFile}`);
      // 继续下一个中间件（可能返回404）
      next();
    }
  });
} else {
  // 在非Vercel环境中简单提供静态文件
  app.use('/outputs', express.static(path.join(__dirname, 'public', 'outputs')));
}

// 添加根路由，确保在Vercel上正确处理
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 配置文件上传
const storage = multer.memoryStorage(); // 使用内存存储而不是磁盘存储

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 限制文件大小为10MB
});

// 创建必要的目录（仅在非Vercel环境中）
const modelsDir = isVercel ? '/tmp/models' : path.join(__dirname, 'models');
const uploadsDir = isVercel ? '/tmp/uploads' : path.join(__dirname, 'uploads');
const outputDir = isVercel ? '/tmp/outputs' : path.join(__dirname, 'public', 'outputs');

// 确保目录存在并处理创建失败的情况
function ensureDirectoryExists(directory) {
  try {
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
      console.log(`目录创建成功: ${directory}`);
    }
  } catch (error) {
    logError(`创建目录失败: ${directory}`, error);
  }
}

// 确保所有必要的目录存在
if (!isVercel) {
  // 在本地环境创建永久目录
  ensureDirectoryExists(modelsDir);
  ensureDirectoryExists(uploadsDir);
  ensureDirectoryExists(outputDir);
} else {
  // 在Vercel环境中也应确保临时目录存在
  ensureDirectoryExists(modelsDir);
  ensureDirectoryExists(uploadsDir);
  ensureDirectoryExists(outputDir);
  ensureDirectoryExists(path.join(__dirname, 'public', 'outputs'));
}

// 内存中存储模板数据
const templates = [];

// 初始化函数 - 在应用程序启动时检查和设置环境
function initializeApp() {
  console.log('初始化应用程序...');
  console.log(`当前环境: ${isVercel ? 'Vercel' : '本地开发'}`);
  
  // 确保所有必要目录存在
  ensureDirectoryExists(modelsDir);
  ensureDirectoryExists(uploadsDir);
  ensureDirectoryExists(outputDir);
  ensureDirectoryExists(path.join(__dirname, 'public', 'outputs'));
  
  // 添加示例模板（如果没有模板）
  if (templates.length === 0) {
    console.log('没有模板，可能是首次启动或重新部署');
    
    // 在开发环境中添加默认模板以便测试
    if (process.env.NODE_ENV !== 'production' && process.env.ADD_TEST_TEMPLATE === 'true') {
      console.log('正在创建测试模板...');
      templates.push({
        _id: 'test-template-' + Date.now(),
        name: '测试模板',
        imageCount: 5,
        thumbnailUrl: '',
        styleData: {
          dominantColor: { r: 200, g: 200, b: 200 },
          colorCount: 1000
        },
        createdAt: new Date()
      });
      console.log(`创建了默认测试模板: ${templates[0]._id}`);
    }
  }
  
  // 检查文件系统权限
  const permissionsCheck = {
    '/tmp': checkWritePermission('/tmp'),
    'public/outputs': checkWritePermission(path.join(__dirname, 'public', 'outputs'))
  };
  
  console.log('文件系统权限检查:', permissionsCheck);
  
  // 设置定期健康检查
  setInterval(selfHealthCheck, 5 * 60 * 1000); // 每5分钟检查一次
  
  return true;
}

// 检查目录是否可写
function checkWritePermission(directory) {
  try {
    ensureDirectoryExists(directory);
    const testFile = path.join(directory, `test-${Date.now()}.txt`);
    fs.writeFileSync(testFile, 'test', { flag: 'w' });
    fs.unlinkSync(testFile);
    return true;
  } catch (error) {
    logError(`目录不可写: ${directory}`, error);
    return false;
  }
}

// 测试路由，检查API是否响应
app.get('/api/health', (req, res) => {
  try {
    const healthStatus = {
      status: 'ok',
      env: isVercel ? 'vercel' : 'local',
      timestamp: new Date().toISOString(),
      versions: {
        node: process.version,
        jimp: require('jimp/package.json').version,
        express: require('express/package.json').version
      },
      memory: {
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
      },
      directories: {
        modelsDir: fs.existsSync(modelsDir),
        uploadsDir: fs.existsSync(uploadsDir),
        outputDir: fs.existsSync(outputDir),
        publicOutputs: fs.existsSync(path.join(__dirname, 'public', 'outputs'))
      },
      templates: templates.length
    };
    
    // 尝试写入测试文件
    try {
      const testFile = path.join(outputDir, `health-check-${Date.now()}.txt`);
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      healthStatus.writeTest = 'passed';
    } catch (error) {
      healthStatus.writeTest = 'failed';
      healthStatus.writeError = error.message;
      logError('健康检查写入测试失败', error);
    }
    
    res.json(healthStatus);
  } catch (error) {
    logError('健康检查失败', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 路由：获取所有模板
app.get('/api/templates', (req, res) => {
  res.json(templates);
});

// 路由：创建新模板
app.post('/api/templates', upload.array('images', 10), async (req, res) => {
  try {
    const { name } = req.body;
    const files = req.files;
    
    if (!name || !files || files.length < 5) {
      return res.status(400).json({ error: '需要模板名称和至少5张图片' });
    }
    
    // 为模板创建唯一ID
    const templateId = Date.now().toString();
    
    // 在Vercel环境中，确保临时目录存在
    if (isVercel) {
      const templateDir = path.join(modelsDir, templateId);
      ensureDirectoryExists(templateDir);
      ensureDirectoryExists(outputDir);
      ensureDirectoryExists(path.join(__dirname, 'public', 'outputs'));
    }
    
    // 分析模板颜色
    const images = [];
    for (const file of files) {
      try {
        // 为每个内存中的文件创建Jimp对象
        const image = await Jimp.read(file.buffer);
        images.push(image);
      } catch (error) {
        logError(`读取图片失败: ${file.originalname}`, error);
        // 继续处理其他图片
      }
    }
    
    if (images.length < 1) {
      return res.status(400).json({ error: '无法读取任何图片，请检查图片格式' });
    }
    
    const avgColors = await analyzeTemplateColorsFromMemory(images);
    
    // 创建缩略图
    const thumbnailFileName = `thumbnail-${templateId}.jpg`;
    const thumbnailPath = path.join(outputDir, thumbnailFileName);
    
    try {
      await createThumbnailFromMemory(images[0], thumbnailPath);
      
      // 如果在Vercel环境中，复制缩略图到public目录
      if (isVercel) {
        const publicThumbnailPath = path.join(__dirname, 'public', 'outputs', thumbnailFileName);
        safeCopyFile(thumbnailPath, publicThumbnailPath);
      }
    } catch (error) {
      logError(`创建缩略图失败: ${thumbnailPath}`, error);
      return res.status(500).json({ error: '创建缩略图失败: ' + error.message });
    }
    
    // 保存模板信息
    const template = {
      _id: templateId,
      name,
      imageCount: files.length,
      thumbnailUrl: `/outputs/${thumbnailFileName}`,
      styleData: avgColors,
      createdAt: new Date()
    };
    
    templates.push(template);
    res.status(201).json(template);
  } catch (error) {
    logError('创建模板错误', error);
    res.status(500).json({ error: '服务器错误: ' + error.message });
  }
});

// 路由：删除模板
app.delete('/api/templates/:id', (req, res) => {
  try {
    const templateId = req.params.id;
    const templateIndex = templates.findIndex(t => t._id === templateId);
    
    if (templateIndex === -1) {
      return res.status(404).json({ error: '模板不存在' });
    }
    
    // 从数组中删除
    templates.splice(templateIndex, 1);
    
    res.json({ success: true });
  } catch (error) {
    logError(`删除模板错误: templateId=${req.params.id}`, error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 路由：转换图片
app.post('/api/convert', upload.single('photo'), async (req, res) => {
  try {
    const { templateId, generateOutline, generateColored } = req.body;
    const photo = req.file;
    
    if (!templateId || !photo) {
      return res.status(400).json({ error: '需要模板ID和照片' });
    }
    
    // 确保输出目录存在
    if (isVercel) {
      ensureDirectoryExists(outputDir);
      ensureDirectoryExists(path.join(__dirname, 'public', 'outputs'));
    }
    
    // 查找模板
    const template = templates.find(t => t._id === templateId);
    if (!template) {
      return res.status(404).json({ error: '模板不存在' });
    }
    
    // 从内存中读取图片
    let image;
    try {
      image = await Jimp.read(photo.buffer);
    } catch (error) {
      logError(`读取上传图片失败: ${photo.originalname}`, error);
      return res.status(400).json({ error: '无法读取上传的图片，请检查图片格式' });
    }
    
    const results = {};
    const timestamp = Date.now();
    
    // 生成线稿
    if (generateOutline === 'true') {
      try {
        const outlineFileName = `outline-${timestamp}.jpg`;
        const outlinePath = path.join(outputDir, outlineFileName);
        await generateOutlineDrawingFromMemory(image, outlinePath);
        
        // 如果在Vercel环境中，复制文件到public目录
        if (isVercel) {
          const publicOutlinePath = path.join(__dirname, 'public', 'outputs', outlineFileName);
          if (safeCopyFile(outlinePath, publicOutlinePath)) {
            results.outline = `/outputs/${outlineFileName}`;
          }
        } else {
          results.outline = `/outputs/${outlineFileName}`;
        }
      } catch (error) {
        logError(`生成线稿错误: templateId=${templateId}`, error);
        // 继续尝试生成彩色插图
      }
    }
    
    // 生成彩色插画
    if (generateColored === 'true') {
      try {
        const coloredFileName = `colored-${timestamp}.jpg`;
        const coloredPath = path.join(outputDir, coloredFileName);
        await generateColoredIllustrationFromMemory(image, coloredPath, template);
        
        // 如果在Vercel环境中，复制文件到public目录
        if (isVercel) {
          const publicColoredPath = path.join(__dirname, 'public', 'outputs', coloredFileName);
          if (safeCopyFile(coloredPath, publicColoredPath)) {
            results.colored = `/outputs/${coloredFileName}`;
          }
        } else {
          results.colored = `/outputs/${coloredFileName}`;
        }
      } catch (error) {
        logError(`生成彩色插画错误: templateId=${templateId}`, error);
      }
    }
    
    if (!results.outline && !results.colored) {
      return res.status(500).json({ error: '转换失败，无法生成任何图片' });
    }
    
    res.json(results);
  } catch (error) {
    logError('转换图片错误', error);
    res.status(500).json({ error: '转换失败: ' + error.message });
  }
});

// 分析内存中模板图像的颜色
async function analyzeTemplateColorsFromMemory(images) {
  try {
    let totalR = 0, totalG = 0, totalB = 0;
    let pixelCount = 0;
    
    for (const img of images) {
      // 采样图像颜色
      img.scan(0, 0, img.bitmap.width, img.bitmap.height, function(x, y, idx) {
        const r = this.bitmap.data[idx + 0];
        const g = this.bitmap.data[idx + 1];
        const b = this.bitmap.data[idx + 2];
        
        totalR += r;
        totalG += g;
        totalB += b;
        pixelCount++;
      });
    }
    
    // 计算平均颜色
    const avgColor = {
      r: Math.round(totalR / pixelCount),
      g: Math.round(totalG / pixelCount),
      b: Math.round(totalB / pixelCount)
    };
    
    return {
      dominantColor: avgColor,
      colorCount: pixelCount
    };
  } catch (error) {
    logError('分析模板颜色错误', error);
    throw error;
  }
}

// 从内存创建缩略图
async function createThumbnailFromMemory(image, outputPath) {
  try {
    // 创建副本避免修改原始图像
    const thumbnail = image.clone();
    
    // 裁剪为正方形并调整大小
    const size = Math.min(thumbnail.bitmap.width, thumbnail.bitmap.height);
    const x = (thumbnail.bitmap.width - size) / 2;
    const y = (thumbnail.bitmap.height - size) / 2;
    
    await thumbnail
      .crop(x, y, size, size)
      .resize(200, 200)
      .quality(80)
      .writeAsync(outputPath);
    
    return outputPath;
  } catch (error) {
    logError(`创建缩略图错误: ${outputPath}`, error);
    throw error;
  }
}

// 从内存生成线稿
async function generateOutlineDrawingFromMemory(image, outputPath) {
  try {
    // 创建新的图像作为线稿
    const outline = new Jimp(image.bitmap.width, image.bitmap.height, 0xffffffff);
    
    // 边缘检测 - 简化版
    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function(x, y, idx) {
      // 跳过边缘像素
      if (x === 0 || y === 0 || x === image.bitmap.width - 1 || y === image.bitmap.height - 1) return;
      
      const thisPixel = Jimp.intToRGBA(image.getPixelColor(x, y));
      const leftPixel = Jimp.intToRGBA(image.getPixelColor(x - 1, y));
      const rightPixel = Jimp.intToRGBA(image.getPixelColor(x + 1, y));
      const topPixel = Jimp.intToRGBA(image.getPixelColor(x, y - 1));
      const bottomPixel = Jimp.intToRGBA(image.getPixelColor(x, y + 1));
      
      // 计算相邻像素的差异
      const diffX = Math.abs(leftPixel.r - rightPixel.r) + 
                   Math.abs(leftPixel.g - rightPixel.g) + 
                   Math.abs(leftPixel.b - rightPixel.b);
                   
      const diffY = Math.abs(topPixel.r - bottomPixel.r) + 
                   Math.abs(topPixel.g - bottomPixel.g) + 
                   Math.abs(topPixel.b - bottomPixel.b);
      
      // 如果差异大于阈值，则标记为边缘
      if (diffX > 100 || diffY > 100) {
        outline.setPixelColor(0x000000ff, x, y); // 黑色
      }
    });
    
    // 保存为文件
    await outline.writeAsync(outputPath);
    
    return outputPath;
  } catch (error) {
    logError(`生成线稿错误: ${outputPath}`, error);
    throw error;
  }
}

// 从内存生成彩色插画
async function generateColoredIllustrationFromMemory(image, outputPath, template) {
  try {
    // 创建副本避免修改原始图像
    const coloredImage = image.clone();
    
    // 风格化处理
    coloredImage.scan(0, 0, coloredImage.bitmap.width, coloredImage.bitmap.height, function(x, y, idx) {
      const r = this.bitmap.data[idx + 0];
      const g = this.bitmap.data[idx + 1];
      const b = this.bitmap.data[idx + 2];
      
      // 计算亮度和饱和度
      const avg = (r + g + b) / 3;
      
      // 增强饱和度
      this.bitmap.data[idx + 0] = Math.min(255, r + (r - avg) * 0.5);
      this.bitmap.data[idx + 1] = Math.min(255, g + (g - avg) * 0.5);
      this.bitmap.data[idx + 2] = Math.min(255, b + (b - avg) * 0.5);
      
      // 量化颜色 (卡通效果)
      this.bitmap.data[idx + 0] = Math.round(this.bitmap.data[idx + 0] / 32) * 32;
      this.bitmap.data[idx + 1] = Math.round(this.bitmap.data[idx + 1] / 32) * 32;
      this.bitmap.data[idx + 2] = Math.round(this.bitmap.data[idx + 2] / 32) * 32;
    });
    
    // 创建线稿
    const outline = new Jimp(coloredImage.bitmap.width, coloredImage.bitmap.height, 0x00000000); // 透明
    
    // 检测边缘
    coloredImage.scan(0, 0, coloredImage.bitmap.width, coloredImage.bitmap.height, function(x, y, idx) {
      // 跳过边缘像素
      if (x === 0 || y === 0 || x === coloredImage.bitmap.width - 1 || y === coloredImage.bitmap.height - 1) return;
      
      const thisPixel = Jimp.intToRGBA(coloredImage.getPixelColor(x, y));
      const leftPixel = Jimp.intToRGBA(coloredImage.getPixelColor(x - 1, y));
      const rightPixel = Jimp.intToRGBA(coloredImage.getPixelColor(x + 1, y));
      const topPixel = Jimp.intToRGBA(coloredImage.getPixelColor(x, y - 1));
      const bottomPixel = Jimp.intToRGBA(coloredImage.getPixelColor(x, y + 1));
      
      // 计算相邻像素的差异
      const diffX = Math.abs(leftPixel.r - rightPixel.r) + 
                   Math.abs(leftPixel.g - rightPixel.g) + 
                   Math.abs(leftPixel.b - rightPixel.b);
                   
      const diffY = Math.abs(topPixel.r - bottomPixel.r) + 
                   Math.abs(topPixel.g - bottomPixel.g) + 
                   Math.abs(topPixel.b - bottomPixel.b);
      
      // 如果差异大于阈值，则标记为边缘
      if (diffX > 100 || diffY > 100) {
        outline.setPixelColor(0x000000ff, x, y); // 黑色
      }
    });
    
    // 合并线稿和彩色图像
    coloredImage.composite(outline, 0, 0, {
      mode: Jimp.BLEND_SOURCE_OVER,
      opacitySource: 1,
      opacityDest: 1
    });
    
    // 保存为文件
    await coloredImage.writeAsync(outputPath);
    
    return outputPath;
  } catch (error) {
    logError(`生成彩色插画错误: ${outputPath}`, error);
    throw error;
  }
}

// 在所有其他路由之后添加通配符路由，捕获所有其他请求
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 在所有路由之后，通配符路由之前添加错误处理中间件
// 错误处理中间件
app.use((err, req, res, next) => {
  logError('Express路由错误', err);
  
  // 确定是什么类型的错误并记录详细信息
  let errorMessage = '应用程序发生错误';
  let statusCode = 500;
  
  if (err.name === 'MulterError') {
    // 文件上传错误
    statusCode = 400;
    errorMessage = `文件上传错误: ${err.message}`;
  } else if (err.name === 'SyntaxError' && err.message.includes('JSON')) {
    // JSON解析错误
    statusCode = 400;
    errorMessage = '无效的JSON数据';
  } else if (err.code === 'ENOENT') {
    // 文件不存在错误
    statusCode = 404;
    errorMessage = '请求的资源不存在';
  } else if (err.code === 'EACCES') {
    // 权限错误
    statusCode = 403;
    errorMessage = '服务器权限错误';
  }
  
  // 在开发环境中提供更多细节
  res.status(statusCode).json({
    error: '服务器内部错误', 
    message: process.env.NODE_ENV === 'production' ? errorMessage : `${errorMessage}: ${err.message}`,
    path: req.path,
    timestamp: new Date().toISOString()
  });
});

// 在启动服务器之前添加尝试创建目录的函数
// 启动服务器
if (process.env.NODE_ENV !== 'production') {
  // 确保在启动前创建必要的目录
  ensureAllDirectoriesExist();
  
  app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    // 初始化应用程序
    initializeApp();
  });
} else {
  // 在生产环境中也确保目录存在
  ensureAllDirectoriesExist();
  
  // 在生产环境中也初始化应用程序
  initializeApp();
}

// 确保所有必要的目录都存在
function ensureAllDirectoriesExist() {
  const requiredDirs = [
    modelsDir,
    uploadsDir,
    outputDir,
    path.join(__dirname, 'public', 'outputs'),
    path.join(__dirname, 'public', 'css'),
    path.join(__dirname, 'public', 'js')
  ];
  
  for (const dir of requiredDirs) {
    ensureDirectoryExists(dir);
    
    // 验证目录是否真的创建成功
    const exists = fs.existsSync(dir);
    if (!exists) {
      logError(`目录创建失败，无法验证: ${dir}`, new Error('目录验证失败'));
    } else {
      console.log(`目录验证成功: ${dir}`);
    }
  }
}

// 对于Vercel和类似平台的部署
module.exports = app;

// 安全地复制文件的辅助函数
function safeCopyFile(sourcePath, destinationPath) {
  try {
    // 确保目标目录存在
    const destinationDir = path.dirname(destinationPath);
    ensureDirectoryExists(destinationDir);
    
    // 复制文件
    fs.copyFileSync(sourcePath, destinationPath);
    console.log(`文件成功复制: ${sourcePath} -> ${destinationPath}`);
    return true;
  } catch (error) {
    logError(`复制文件失败: ${sourcePath} -> ${destinationPath}`, error);
    return false;
  }
}

// 自我健康检查函数，检测服务状态
async function selfHealthCheck() {
  try {
    console.log('执行自我健康检查...');
    
    // 检查目录
    const dirChecks = {
      modelsDir: fs.existsSync(modelsDir),
      uploadsDir: fs.existsSync(uploadsDir),
      outputDir: fs.existsSync(outputDir),
      publicOutputs: fs.existsSync(path.join(__dirname, 'public', 'outputs'))
    };
    
    // 检查写入权限
    const writeCheck = checkWritePermission(outputDir);
    
    // 检查内存使用
    const memoryUsage = process.memoryUsage();
    const memoryCheck = {
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB',
      rss: Math.round(memoryUsage.rss / 1024 / 1024) + 'MB'
    };
    
    console.log('健康检查结果:', {
      directories: dirChecks,
      writePermission: writeCheck,
      memory: memoryCheck,
      templateCount: templates.length
    });
    
    // 如果检测到问题，进行修复
    if (!dirChecks.outputDir || !dirChecks.publicOutputs || !writeCheck) {
      console.log('自动修复目录问题...');
      ensureDirectoryExists(outputDir);
      ensureDirectoryExists(path.join(__dirname, 'public', 'outputs'));
    }
    
    return true;
  } catch (error) {
    logError('自我健康检查失败', error);
    return false;
  }
} 