/**
 * state.js - 全局状态管理与跨模块通信
 */
const Config = require('./config.js');

let GlobalState = {
    // --- 核心数据 ---
    settings: JSON.parse(JSON.stringify(Config.DEFAULT_SETTINGS)), // appSettings
    sequences: {},                                                // 所有序列数据
    currentProfileName: "",                                       // 当前文件名
    metaConfig: { lastProfile: null, profileTimestamps: {} },

    // --- 运行时状态 ---
    appState: {
        isFloatyCreated: false,
        isExecuting: false,
        isMonitoring: false,
        threads: {},       // 存储线程对象
        activeMonitors: {},// 存储监控ID
        timers: {},        // 存储计时器
        ui: {              // UI相关临时状态
            imageResultCallback: null,
            pendingCropUri: null,
            currentWaitTask: null
        }
    },

    // --- UI 引用 (由 main.js 注入) ---
    uiRefs: {
        mainView: null,    // 主窗口 ui 对象
        controlPanel: null,// 悬浮窗
        targetView: null,  // 星星
        redDot: null,      // 红点
        taskVisuals: []    // 任务序号浮窗
    },

    // --- 回调接口 (由 main.js 实现并注入，供 logic/editors 调用) ---
    callbacks: {
        log: (msg) => console.log(msg),
        logError: (msg) => console.error(msg),
        toast: (msg) => toast(msg),
        saveProfile: () => console.warn("saveProfile not implemented"), // 保存配置
        stopExecution: (msg) => {}, // 停止脚本
        refreshAllUI: () => {},     // 刷新浮窗和界面
        recreateVisuals: () => {},  // 重绘任务浮窗
        showClickDot: (x, y) => {}, // 显示点击光标
        updateMonitorUI: () => {}   // 更新监控按钮状态
    }
};

module.exports = GlobalState;