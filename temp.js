// 请求截图权限
if (!requestScreenCapture()) {
    toastLog("请求截图权限失败！");
    exit();
}

console.show();
console.info("============== 🚀 OCR 性能压测 ==============");
console.log("正在截取当前屏幕...");

// 延迟 1 秒，等待控制台弹出的动画结束，防止截到半截动画
sleep(1000);

let img = captureScreen();
if (!img) {
    console.error("截图失败");
    exit();
}
console.log(`✅ 截图成功，分辨率: ${img.getWidth()} x ${img.getHeight()}`);

// ==================================================
// 0. 引擎预热 (Warm-up)
// 第一次调用 OCR 时系统需要加载模型文件，会非常耗时。
// 为了保证后续测试公平，我们先进行一次不计时的预热。
// ==================================================
console.log("\n⏳ 正在预热 OCR 引擎 (加载底层模型)...");
ocr.paddle.detect(img, { useSlim: true }); 
console.log("✅ 预热完成，开始正式测速！");


// ==================================================
// 1. 测试：系统默认参数
// ==================================================
console.info("\n▶️ [测试 1] 系统默认参数");
let start1 = new Date().getTime();
let result1 = ocr.paddle.detect(img);
let time1 = new Date().getTime() - start1;
console.log(`⏱️ 耗时: ${time1} ms，共识别到 ${result1.length} 处文字`);


// ==================================================
// 2. 测试：官方推荐的高性能参数 (Slim 模型 + 4 线程)
// 参考自 AutoJs6 官方 PaddleOCR 示例
// ==================================================
console.info("\n▶️ [测试 2] 高性能参数 (Slim模型 + 4核心多线程)");
let configFast = {
    useSlim: true,       // 使用精简版模型
    cpuThreadNum: 4,     // 开启 4 线程并发
    useOpenCL: false     // 关闭 GPU (纯 CPU 运算)
};
let start2 = new Date().getTime();
let result2 = ocr.paddle.detect(img, configFast);
let time2 = new Date().getTime() - start2;
console.log(`⏱️ 耗时: ${time2} ms，共识别到 ${result2.length} 处文字`);


// ==================================================
// 3. 测试：GPU 硬件加速 (OpenCL)
// ==================================================
console.info("\n▶️ [测试 3] 实验性：GPU 硬件加速 (OpenCL)");
let configGPU = {
    useSlim: true,
    cpuThreadNum: 4,
    useOpenCL: true      // 尝试调用手机 GPU 加速 (并非所有手机芯片都支持)
};
let start3 = new Date().getTime();
let result3 = ocr.paddle.detect(img, configGPU);
let time3 = new Date().getTime() - start3;
console.log(`⏱️ 耗时: ${time3} ms，共识别到 ${result3.length} 处文字`);


// ==================================================
// 打印识别结果校验准确度
// ==================================================
console.info("\n📊 [识别内容预览 (取前 5 条)]");
for (let i = 0; i < Math.min(5, result2.length); i++) {
    // 官方新版 API 返回的文本字段是 label.js]
    console.log(`[${i+1}] 置信度: ${result2[i].confidence.toFixed(2)} | 文本: ${result2[i].label}`);
}

// 释放图片内存，防止闪退
img.recycle();
console.info("\n🎉 压测结束！");