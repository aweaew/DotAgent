"ui";

__PQ_DEBUG = false;
// --- priority helpers (新增) ---
function __stableHash(input) {
    try {
        const s = (typeof input === 'string') ? input : JSON.stringify(input || {});
        let h = 5381, i = s.length;
        while (i) { h = (h * 33) ^ s.charCodeAt(--i); }
        return (h >>> 0).toString(36);
    } catch (e) { return '0'; }
}

let __saveProfileTimer = null, __saveDirty = false;
function saveCurrentProfileThrottled(delayMs) {
    const d = (typeof delayMs === 'number' ? delayMs : 800);
    __saveDirty = true;
    if (__saveProfileTimer) clearTimeout(__saveProfileTimer);
    __saveProfileTimer = setTimeout(function(){
        if (__saveDirty && typeof saveCurrentProfile === 'function') {
            try { saveCurrentProfile(); } catch(e) { logErrorToScreen("saveCurrentProfile() 调用失败: " + e); }
        }
        __saveDirty = false;
        __saveProfileTimer = null;
    }, d);
}

// === PriorityQueue quick-persist helpers ===
// 存储路径（Auto.js 常用可写目录）；你也可以改成其他路径
const __PQ_STORE_PATH = "/sdcard/dotagent_priority_queue.json";

// Write priorityQueue for a given sequence to a small JSON file (atomic)
function writePriorityQueueQuick(sequence) {
    try {
        if (!sequence || !sequence.name) return;
        var obj = {
            sequenceName: sequence.name,
            ts: Date.now(),
            priorityQueue: Array.isArray(sequence.priorityQueue) ? sequence.priorityQueue : []
        };
        var tmp = __PQ_STORE_PATH + ".tmp";
        files.write(tmp, JSON.stringify(obj)); // write temp
        // move/rename to final (atomic-ish)
        try { files.remove(__PQ_STORE_PATH); } catch(e){}
        files.rename(tmp, __PQ_STORE_PATH);
    } catch (e) {
        try { logErrorToScreen("[PQ write err] " + e); } catch(e){}
    }
}

// Read persisted priorityQueue if newer than last loaded time, return object or null
var __PQ_lastLoadMtime = 0;
function tryLoadPriorityQueueQuickIfNewer(sequence) {
    try {
        if (!files.exists(__PQ_STORE_PATH)) return null;
        var stat = files.stat(__PQ_STORE_PATH);
        var mtime = stat.mtime || +stat.lastModifiedDate || Date.now();
        if (!mtime) mtime = Date.now();
        if (mtime <= (__PQ_lastLoadMtime || 0)) {
            return null;
        }
        var txt = files.read(__PQ_STORE_PATH);
        if (!txt) return null;
        var obj = JSON.parse(txt);
        // optional: ensure it belongs to this sequence by name
        if (!obj || !obj.priorityQueue) return null;
        __PQ_lastLoadMtime = mtime;
        return obj;
    } catch (e) {
        try { logErrorToScreen("[PQ load err] " + e); } catch(e){}
        return null;
    }
}

function cleanupPriorityQueue(sequence){
    try{
        const ids = new Set(((sequence.triggers)||[]).map(getTriggerId));
        sequence.priorityQueue = (sequence.priorityQueue && Array.isArray(sequence.priorityQueue)) ? sequence.priorityQueue.filter(id => ids.has(id)) : [];
    }catch(e){}
}
// --- end helpers ---
// 1) getTriggerId 增强调试（放在函数体起始处）
function getTriggerId(trigger) {
    try {
        const t = trigger.type || 'image';
        const target = trigger.target || '';
        const areaHash = __stableHash(trigger.search_area || trigger.area || null);
        const actionType = (trigger.action && trigger.action.type) ? trigger.action.type : '';
        const id = `${t}::${target}::${areaHash}::${actionType}`;
        // Debug: 少量打印，避免刷屏。只在开发时打开
        if (typeof __PQ_DEBUG !== 'undefined' && __PQ_DEBUG) {
            logToScreen(`[getTriggerId] id=${id} target=${target} areaHash=${areaHash}`);
        }
        return id;
    } catch (e) {
        return 'unknown::' + Math.random().toString(36).slice(2);
    }
}

// --- end getTriggerId ---
function ensurePriorityQueue(sequence) {
    if (!sequence.priorityQueue || !Array.isArray(sequence.priorityQueue)) {
        sequence.priorityQueue = [];
    }
    return sequence.priorityQueue;
}
// --- 替换 bumpTriggerPriority ---
// 2) bumpTriggerPriority 增强：打印 id / pq 以及版本标记（放 bumpTriggerPriority 尾部）
function bumpTriggerPriority(sequence, trigger) {
    try {
        if (!sequence) return;
        if (!sequence.priorityQueue || !Array.isArray(sequence.priorityQueue)) sequence.priorityQueue = [];
        const pq = sequence.priorityQueue;
        const id = getTriggerId(trigger);

        if (typeof __PQ_DEBUG !== 'undefined' && __PQ_DEBUG) {
            logToScreen(`[PQ] bump BEFORE: ${JSON.stringify(pq.slice(0,10))}`);
            logToScreen(`[PQ] bump ID: ${id}`);
        }

        const exist = pq.indexOf(id);
        if (exist >= 0) pq.splice(exist, 1);
        pq.unshift(id);

        // 更新一个内存版本号，watcher 可观察到
        sequence.__priorityVersion = (sequence.__priorityVersion || 0) + 1;

        if (typeof __PQ_DEBUG !== 'undefined' && __PQ_DEBUG) {
            logToScreen(`[PQ] bump AFTER: ${JSON.stringify(pq.slice(0,10))} ver=${sequence.__priorityVersion}`);
        }

        saveCurrentProfileThrottled();
    } catch (e) {
        logErrorToScreen(`[PQ] bumpTriggerPriority Error: ${e}`);
    }
    // 在 bumpTriggerPriority 的尾部（确保内存 pq 已更新）
    try {
        // 轻量持久化当前 sequence 的优先队列（快速文件写，覆盖小文件）
        try { writePriorityQueueQuick(sequence); } catch (e) { }
    } catch (e) { }
    

}


// --- end bumpTriggerPriority ---


function reorderByPriority(sequence, triggers) {
    try {
        if (!sequence) return triggers || [];
        // 确保队列存在
        if (!sequence.priorityQueue || !Array.isArray(sequence.priorityQueue)) sequence.priorityQueue = [];

        // 构建 id -> pos 映射（避免多次 indexOf）
        const posMap = {};
        for (let i = 0; i < sequence.priorityQueue.length; i++) {
            const id = sequence.priorityQueue[i];
            // 只记录第一个出现的位置（优先位置）
            if (posMap[id] === undefined) posMap[id] = i;
        }

        return (triggers || [])
            .map((t, idx) => {
                const id = getTriggerId(t);
                const pos = (posMap[id] !== undefined) ? posMap[id] : (100000 + idx);
                return { t, idx, pos };
            })
            .sort((a, b) => {
                // --- 新增逻辑开始 ---
                // 1. 检查“置顶优先”标志 (isTopPriority)
                // 如果 a 是置顶，b 不是，a 排前 (-1)
                // 如果 a 不是，b 是置顶，b 排前 (1)
                const aTop = a.t.isTopPriority === true;
                const bTop = b.t.isTopPriority === true;
                if (aTop !== bTop) {
                    return aTop ? -1 : 1;
                }
                // --- 新增逻辑结束 ---

                // 2. 按照 PQ 动态位置排序
                if (a.pos !== b.pos) return a.pos - b.pos;
                
                // 3. 按照原始列表顺序排序
                return a.idx - b.idx; 
            })
            .map(x => x.t);
    } catch (e) {
        try { logErrorToScreen('[reorderByPriority error] ' + e); } catch(e){}
        return triggers || [];
    }
}
// ==================== 触发器优先队列工具 /END ====================



// =================================================================================
// 脚本常量 (CONSTANTS)
// =================================================================================
const CONSTANTS = {
    // [新增] 新增图片截图
    VERSION: "5.2.8 图片重命名或删除",
    UI: {
        LONG_PRESS_DURATION_MS: 800,
        CLICK_DURATION_MS: 300,
        CLICK_PRESS_DURATION_MS: 50,
        HIGHLIGHT_DURATION_MS: 1500,
        HIGHLIGHT_COLOR: "#F9A825",
        TASK_CLICK_VISUAL_SIZE: 80,
        TASK_SWIPE_VISUAL_SIZE: 80,
        MAX_LOG_LINES: 150,
        THEME: {
            BACKGROUND: "#121212", // 更深的背景色
            PRIMARY_CARD: "#1E1E1E",
            SECONDARY_CARD: "#2A2A2A",
            ACCENT_GRADIENT_START: "#007BFF", // 蓝色调
            ACCENT_GRADIENT_END: "#00C6FF",
            PRIMARY_TEXT: "#E0E0E0",
            SECONDARY_TEXT: "#B0B0B0",
            ACTIVE_TAB_COLOR: "#00A2FF",
            INACTIVE_TAB_COLOR: "#B0B0B0",
            DEFAULT_TARGET_VIEW_COLOR: "#AA007BFF",
            DEFAULT_TASK_CLICK_COLOR: "#AA1E1E1E",
            DEFAULT_TASK_SWIPE_COLOR: "#AA2A2A2A"
        }
    },
    FILES: {
        CONFIG_DIR: context.getExternalFilesDir(null).getAbsolutePath(),
        IMAGE_DIR: files.join(context.getExternalFilesDir(null).getAbsolutePath(), "images"),
        META_CONFIG_FILE: files.join(context.getExternalFilesDir(null).getAbsolutePath(), "meta_config.json"),
        PROFILE_PREFIX: "profile_"
    },
    // --- 5.1.2 在这里添加新代码 ---
    REQUEST_CODES: {
        NEW_IMAGE_SELECT: 2001,
        NEW_IMAGE_CROP: 2002
    },
    TEMP_FILES: {
        CROP_OUTPUT: "new_crop_output.jpg" // 临时裁剪文件名
    }
    // --- 添加结束 ---
};

const DEFAULT_SETTINGS = {
    useGestureSwipe: true,
    mainTargetPos: { x: 300, y: 300 },
    controlPanelPos: { x: 100, y: 800 },
    clickDelayMs: 100,
    yOffset: 115,
    swipe: { duration: 300 },
    controlButtonsHidden: false,
    panelWidth: 240,
    targetViewSize: 100,
    showPanelCoordinates: true,
    mainSequenceKey: null,
    mainMonitorKey: null,
    theme: {
        targetViewColor: CONSTANTS.UI.THEME.DEFAULT_TARGET_VIEW_COLOR,
        taskClickColor: CONSTANTS.UI.THEME.DEFAULT_TASK_CLICK_COLOR,
        taskSwipeColor: CONSTANTS.UI.THEME.DEFAULT_TASK_SWIPE_COLOR
    },
    taskVisualsHidden: false, // <-- 1. 在这里添加新行 (别忘了逗号)
    defaultCachePadding: 50   // <-- 在它下面添加这一行
};


// =================================================================================
// 全局状态与引用 (Global State & References)
// =================================================================================

let appState = {
    isFloatyCreated: false,
    isExecuting: false,
    isMonitoring: false,
    threads: {},
    activeMonitors: {},
    timers: {},
    ui: {
        instructionWindow: null,
        tutorialWindow: null,
        // --- 5.1.2 在这里添加新代码 ---
        imageResultCallback: null, // 存储“结果”应该发给谁
        pendingCropUri: null,       // 存储“待裁剪”的图片URI
        systemTimeTimer: null,    // <-- 在这里添加新行
        currentWaitTask: null // <-- 在这里添加新行
        // --- 添加结束 ---
    }
};

let uiRefs = {
    mainView: null,
    targetView: null,
    redDot: null,
    controlPanel: null,
    taskVisuals: [],
};

let appSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
let sequences = {};
let currentProfileName = "";
let metaConfig = {
    lastProfile: null,
    hasSeenTutorial: false
};

let statusBarHeight = 0;
try {
    let statusBarId = context.resources.getIdentifier("status_bar_height", "dimen", "android");
    if (statusBarId > 0) {
        statusBarHeight = context.resources.getDimensionPixelSize(statusBarId);
    }
} catch (e) { /* 忽略错误 */ }
DEFAULT_SETTINGS.yOffset = statusBarHeight; // 自动将默认偏移设为状态栏高度

// =================================================================================
// UI布局 (UI Layout)
// =================================================================================

ui.layout(
    <frame bg="{{CONSTANTS.UI.THEME.BACKGROUND}}">
        <vertical>

            {/* --- 1. New Compact Header (v2 - Corrected) --- */}
            <card w="*" margin="16 8" cardCornerRadius="16dp" cardElevation="4dp" bg="{{CONSTANTS.UI.THEME.PRIMARY_CARD}}">
                <horizontal gravity="center_vertical" padding="16 12">
                    {/* 标题 */}
                    <vertical layout_weight="1" marginRight="12">
                        <text text="🚀 点点特工" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" textSize="20sp" textStyle="bold" singleLine="true" ellipsize="end" />
                        <text text="v{{CONSTANTS.VERSION}}" textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}" textSize="12sp" />
                    </vertical>
                    {/* 启动按钮 */}
                    <button id="startFloatyBtn" text="启动" h="48dp" minWidth="72dp" style="Widget.AppCompat.Button.Borderless" textColor="#FFFFFF" />
                </horizontal>
            </card>


            {/* --- 2. Main Content Card (This is UNCHANGED from your file) --- */}
            <card w="*" margin="16 8" cardCornerRadius="16dp" cardElevation="4dp" bg="{{CONSTANTS.UI.THEME.PRIMARY_CARD}}" layout_weight="1">
                <vertical>
                    {/* --- Tabs --- */}
                    <horizontal id="tabContainer" padding="8 0" gravity="center_vertical">
                        <vertical id="graphicalTabBtn" layout_weight="1" gravity="center" padding="8 8">
                            <text id="graphicalTabIcon" text="⚙️" textSize="20sp" />
                            <text id="graphicalTabLabel" text="设置" textSize="10sp" />
                            <View id="graphicalTabIndicator" w="24dp" h="2dp" marginTop="4" />
                        </vertical>
                        <vertical id="jsonTabBtn" layout_weight="1" gravity="center" padding="8 8">
                            <text id="jsonTabIcon" text="{ }" textSize="20sp" />
                            <text id="jsonTabLabel" text="JSON" textSize="10sp" />
                            <View id="jsonTabIndicator" w="24dp" h="2dp" marginTop="4" />
                        </vertical>
                        <vertical id="logTabBtn" layout_weight="1" gravity="center" padding="8 8">
                            <text id="logTabIcon" text="📋" textSize="20sp" />
                            <text id="logTabLabel" text="日志" textSize="10sp" />
                            <View id="logTabIndicator" w="24dp" h="2dp" marginTop="4" />
                        </vertical>
                        <vertical id="errorLogTabBtn" layout_weight="1" gravity="center" padding="8 8">
                            <text id="errorLogTabIcon" text="⚠️" textSize="20sp" />
                            <text id="errorLogTabLabel" text="错误" textSize="10sp" />
                            <View id="errorLogTabIndicator" w="24dp" h="2dp" marginTop="4" />
                        </vertical>
                        <vertical id="sequenceTabBtn" layout_weight="1" gravity="center" padding="8 8">
                            <text id="sequenceTabIcon" text="🗂️" textSize="20sp" />
                            <text id="sequenceTabLabel" text="编辑" textSize="10sp" />
                            <View id="sequenceTabIndicator" w="24dp" h="2dp" marginTop="4" />
                        </vertical>
                    </horizontal>

                    <View w="*" h="1dp" bg="{{CONSTANTS.UI.THEME.SECONDARY_CARD}}" />

                    {/* --- View Container --- */}
                    <FrameLayout id="viewContainer" layout_weight="1" padding="16">
                        {/* Graphical Settings */}
                        <ScrollView id="graphicalSettingsView">
                            <vertical>
                                <text text="通用设置" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" textStyle="bold" />
                                <horizontal gravity="center_vertical" marginTop="10"><text textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}">点击后延迟(ms):</text><input id="clickDelayInput" inputType="number" layout_weight="1" singleLine="true" textSize="14sp" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" /></horizontal>
                                <horizontal gravity="center_vertical" marginTop="10"><text textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}">默认滑动时长(ms):</text><input id="swipeDurationInput" inputType="number" layout_weight="1" singleLine="true" textSize="14sp" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" /></horizontal>
                                <horizontal gravity="center_vertical" marginTop="10">
                                    <text id="yOffsetTextLabel" textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}">Y轴偏移:</text>
                                    <text id="yOffsetHelp" text=" (?) " textColor="#3498db" textSize="12sp" clickable="true" />
                                    <input id="yOffsetInput" inputType="number" layout_weight="1" singleLine="true" textSize="14sp" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" />
                                </horizontal>
                                <checkbox id="useGestureSwipeCheckbox" text="使用手势滑动(更真实)" textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}" marginTop="10" />
                                <horizontal gravity="center_vertical" marginTop="10">
                                    <text textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}">默认缓存扩边(px):</text>
                                    <input id="defaultCachePaddingInput" inputType="number" layout_weight="1" singleLine="true" textSize="14sp" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" />
                                </horizontal>
                                <text text="界面定制" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" textStyle="bold" marginTop="20" />
                                <horizontal gravity="center_vertical" marginTop="10"><text textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}">控制面板宽度:</text><input id="panelWidthInput" inputType="number" layout_weight="1" singleLine="true" textSize="14sp" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" /></horizontal>
                                <horizontal gravity="center_vertical" marginTop="10"><text textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}">目标视图大小:</text><input id="targetViewSizeInput" inputType="number" layout_weight="1" singleLine="true" textSize="14sp" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" /></horizontal>
                                <checkbox id="taskVisualsHiddenCheckbox" text="隐藏任务浮窗 (🎯, S, E)" textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}" marginTop="10" />
                                <checkbox id="showCoordsCheckbox" text="悬浮窗显示坐标" textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}" marginTop="10" />
                                <horizontal gravity="center_vertical" marginTop="10"><text textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}">目标视图颜色:</text><input id="targetColorInput" layout_weight="1" singleLine="true" textSize="14sp" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" /></horizontal>
                                <horizontal gravity="center_vertical" marginTop="10"><text textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}">点击任务颜色:</text><input id="clickTaskColorInput" layout_weight="1" singleLine="true" textSize="14sp" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" /></horizontal>
                                <horizontal gravity="center_vertical" marginTop="10"><text textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}">滑动任务颜色:</text><input id="swipeTaskColorInput" layout_weight="1" singleLine="true" textSize="14sp" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" /></horizontal>

                                <button id="saveGraphicalSettingsBtn" text="保存设置" marginTop="20" style="Widget.AppCompat.Button.Borderless" textColor="#FFFFFF" w="*" h="50dp" />
                            </vertical>
                        </ScrollView>

                        {/* JSON Editor */}
                        <vertical id="jsonEditorView" visibility="gone">
                            <input id="configEditor" h="0dp" layout_weight="1" singleLine="false" gravity="top" textSize="12sp" enabled="false" bg="{{CONSTANTS.UI.THEME.SECONDARY_CARD}}" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" padding="8" />
                            <button id="saveConfigBtn" text="保存JSON并应用" marginTop="10" style="Widget.AppCompat.Button.Borderless" textColor="#FFFFFF" w="*" h="50dp" enabled="false" />
                        </vertical>

                        {/* Log View */}
                        <vertical id="logViewContainer" visibility="gone">
                            <ScrollView id="logScrollView" h="0dp" layout_weight="1" bg="{{CONSTANTS.UI.THEME.SECONDARY_CARD}}" padding="8">
                                <text id="logView" textSize="10sp" textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}" textIsSelectable="true" />
                            </ScrollView>
                            <button id="clearLogBtn" text="清空日志" marginTop="10" style="Widget.AppCompat.Button.Borderless" textColor="#FFFFFF" w="*" h="50dp" />
                        </vertical>

                        {/* Error Log View */}
                        <vertical id="errorLogViewContainer" visibility="gone">
                            <ScrollView id="errorLogScrollView" h="0dp" layout_weight="1" bg="#2E1A1A" padding="8">
                                <text id="errorLogView" textSize="10sp" textColor="#FFB3B3" textIsSelectable="true" />
                            </ScrollView>
                            <button id="clearErrorLogBtn" text="清空错误日志" marginTop="10" style="Widget.AppCompat.Button.Borderless" textColor="#FFFFFF" w="*" h="50dp" />
                        </vertical>
                        <FrameLayout id="sequenceEditorView" visibility="gone">
                            </FrameLayout>
                    </FrameLayout>
                </vertical>
            </card>


            {/* --- 3. New Compact Footer (5个按钮一排) --- */}
            <card w="*" margin="16 8" cardCornerRadius="16dp" cardElevation="4dp" bg="{{CONSTANTS.UI.THEME.PRIMARY_CARD}}">
                <horizontal padding="8 4">
                    <button id="profileManagerBtn" text="方案" layout_weight="1" style="Widget.AppCompat.Button.Borderless.Colored" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" />
                    <button id="importExportBtn" text="导入" layout_weight="1" style="Widget.AppCompat.Button.Borderless.Colored" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" />
                    <button id="showHelpBtn" text="帮助" layout_weight="1" style="Widget.AppCompat.Button.Borderless.Colored" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" />
                    <button id="newImageBtn" text="新建" layout_weight="1" style="Widget.AppCompat.Button.Borderless.Colored" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" />
                    <button id="exitAppBtn" text="退出" layout_weight="1" style="Widget.AppCompat.Button.Borderless.Colored" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" />
                </horizontal>
            </card>

        </vertical>
    </frame>
);

// --- Apply Gradient Backgrounds ---
function applyGradient(button) {
    let colors = [
        android.graphics.Color.parseColor(CONSTANTS.UI.THEME.ACCENT_GRADIENT_START),
        android.graphics.Color.parseColor(CONSTANTS.UI.THEME.ACCENT_GRADIENT_END)
    ];
    let gradient = new android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT, colors);
    gradient.setCornerRadius(30);
    button.setBackground(gradient);
}
ui.post(() => {
    applyGradient(ui.startFloatyBtn);
    applyGradient(ui.saveGraphicalSettingsBtn);
    applyGradient(ui.saveConfigBtn);
    applyGradient(ui.clearLogBtn);
    applyGradient(ui.clearErrorLogBtn);
});


// =================================================================================
// 初始化与主逻辑 (Initialization & Main Logic)
// =================================================================================

uiRefs.mainView = ui;
ui.yOffsetTextLabel.setText(`Y轴偏移 (自动: ${statusBarHeight}px):`);
logToScreen("应用界面已加载。");

// ... (在 "初始化与主逻辑" 部分) ...

const views = [ui.graphicalSettingsView, ui.jsonEditorView, ui.logViewContainer, ui.errorLogViewContainer, ui.sequenceEditorView]; // <-- 添加 ui.sequenceEditorView
const tabs = [ui.graphicalTabBtn, ui.jsonTabBtn, ui.logTabBtn, ui.errorLogTabBtn, ui.sequenceTabBtn]; // <-- 添加 ui.sequenceTabBtn
const tabIndicators = [ui.graphicalTabIndicator, ui.jsonTabIndicator, ui.logTabIndicator, ui.errorLogTabIndicator, ui.sequenceTabIndicator]; // <-- 添加 ui.sequenceTabIndicator
const tabLabels = [ui.graphicalTabLabel, ui.jsonTabLabel, ui.logTabLabel, ui.errorLogTabLabel, ui.sequenceTabLabel]; // <-- 添加 ui.sequenceTabLabel
const tabIcons = [ui.graphicalTabIcon, ui.jsonTabIcon, ui.logTabIcon, ui.errorLogTabIcon, ui.sequenceTabIcon]; // <-- 添加 ui.sequenceTabIcon

function switchView(viewToShow) {
    views.forEach(view => view.setVisibility(8)); // GONE
    viewToShow.setVisibility(0); // VISIBLE

    const activeIndex = views.indexOf(viewToShow);

    tabIndicators.forEach((indicator, index) => {
        indicator.setBackgroundColor(colors.parseColor(index === activeIndex ? CONSTANTS.UI.THEME.ACTIVE_TAB_COLOR : "#00000000"));
    });

    tabLabels.forEach((label, index) => {
        label.setTextColor(colors.parseColor(index === activeIndex ? CONSTANTS.UI.THEME.ACTIVE_TAB_COLOR : CONSTANTS.UI.THEME.INACTIVE_TAB_COLOR));
    });

    tabIcons.forEach((icon, index) => {
        icon.setTextColor(colors.parseColor(index === activeIndex ? CONSTANTS.UI.THEME.ACTIVE_TAB_COLOR : CONSTANTS.UI.THEME.INACTIVE_TAB_COLOR));
    });
}


switchView(ui.graphicalSettingsView);

ui.graphicalTabBtn.click(() => switchView(ui.graphicalSettingsView));
ui.jsonTabBtn.click(() => switchView(ui.jsonEditorView));
ui.logTabBtn.click(() => switchView(ui.logViewContainer));
ui.errorLogTabBtn.click(() => switchView(ui.errorLogViewContainer));
// --- 在这里添加新代码块 ---
// 当点击“编辑”选项卡时
ui.sequenceTabBtn.click(() => {
    switchView(ui.sequenceEditorView);
    // 检查是否已初始化，如果未初始化 (子视图为0)，则渲染它
    if (ui.sequenceEditorView.getChildCount() === 0) {
        logToScreen("初始化序列编辑器...");
        renderSequenceListEditor();
    }
});
// --- 添加结束 ---
ui.yOffsetHelp.click(() => {
    dialogs.build({
        title: "什么是Y轴偏移？",
        content: "此设置用于补偿手机顶部状态栏的高度，确保点击位置精准。\n\n通常将其设置为状态栏高度或稍大的值即可。如果点击位置偏上，可以适当增大此数值。",
        positive: "明白了",
        titleColor: CONSTANTS.UI.THEME.PRIMARY_TEXT,
        contentColor: CONSTANTS.UI.THEME.SECONDARY_TEXT,
        backgroundColor: CONSTANTS.UI.THEME.PRIMARY_CARD,
        positiveColor: CONSTANTS.UI.THEME.ACCENT_GRADIENT_START
    }).show();
});
// --- V7.3 (线程修复 - 解决"缺少形参" 和 "UI线程"Bug) ---
ui.newImageBtn.click(() => {

    // 1. Click 发生在 UI 线程, 立即启动一个新线程来处理耗时操作
    threads.start(function() {
        try {
            // 2. 在新线程中检查悬浮窗权限
            if (!floaty.hasPermission()) {
                ui.run(() => toast("需要悬浮窗权限")); // toast 必须在 ui.run 中
                return;
            }

            // 3. 【核心修复】在新线程中调用 "同步" 截图请求
            //    因为它不在UI线程了, "同步" 版本是允许的，而且逻辑更简单
            if (!requestScreenCapture()) {
                ui.run(() => toast("截图权限已被拒绝")); // 用户点击了“取消”
                return;
            }

            // 4. 所有权限都OK了，启动工作流
            //    (launchImageCreationWorkflow 内部也是安全的, 它会启动 Activity)
            launchImageCreationWorkflow();

        } catch (e) {
            logErrorToScreen("权限检查失败: " + e);
            ui.run(() => toast("权限检查失败: " + e.message));
        }
    });
});
// --- V7.3 修复结束 ---

ui.exitAppBtn.click(closeAllAndExit);
// --- 5.1.2 (v3 修复) 在这里添加 Back 键 和 Activity 监听器 ---

// 1. 添加 Back 键监听 (调用正确的退出函数)
ui.emitter.on("back_pressed", e => { 
    e.consumed = true; 
    logErrorToScreen("检测到返回键，正在退出脚本...");
    closeAllAndExit(); 
});

// 2. 【核心】全局 Activity 结果监听器
events.on("activity_result", (requestCode, resultCode, data) => {
    if (resultCode != activity.RESULT_OK) {
        // 如果用户在任何一步取消了，重置回调
        if (requestCode === CONSTANTS.REQUEST_CODES.NEW_IMAGE_SELECT || requestCode === CONSTANTS.REQUEST_CODES.NEW_IMAGE_CROP) {
            toast("新建图片已取消");
            appState.ui.imageResultCallback = null;
            appState.ui.pendingCropUri = null;
        }
        return; 
    }

    const flags = android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION;

    // ... (events.on("activity_result", ... 内部) ...

    // 步骤 1: 用户从相册 "选择" 完毕
    if (requestCode == CONSTANTS.REQUEST_CODES.NEW_IMAGE_SELECT) {
        let uri = data.getData();
        if (!uri) {
            toast("选择图片失败");
            return;
        }

        try {
            // 1. 获取权限
            context.getContentResolver().takePersistableUriPermission(uri, flags);
            appState.ui.pendingCropUri = uri; // 存储待裁剪的URI

            // 2. 准备临时文件
            cleanupTempCropFile();
            let tempCroppedFile = new java.io.File(files.cwd(), CONSTANTS.TEMP_FILES.CROP_OUTPUT);
            let outputUri = android.net.Uri.fromFile(tempCroppedFile);

            // 3. 立即启动 "系统裁剪" (由主窗口发起，100%稳定)
            let intent = new android.content.Intent("com.android.camera.action.CROP");
            intent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.setDataAndType(uri, "image/*");
            intent.putExtra("crop", "true"); 
            intent.putExtra("scale", true); 
            intent.putExtra("return-data", false); 
            intent.putExtra(android.provider.MediaStore.EXTRA_OUTPUT, outputUri);
            intent.putExtra("outputFormat", android.graphics.Bitmap.CompressFormat.JPEG.toString());

            activity.startActivityForResult(intent, CONSTANTS.REQUEST_CODES.NEW_IMAGE_CROP);

        } catch(e) {
            logErrorToScreen("启动裁剪器失败: " + e);
            toast("启动裁剪器失败");
            appState.ui.pendingCropUri = null; // 重置
        }
    }

    // 步骤 2: 用户 "裁剪" 完毕
    else if (requestCode == CONSTANTS.REQUEST_CODES.NEW_IMAGE_CROP) {

        let tempCroppedFile = new java.io.File(files.cwd(), CONSTANTS.TEMP_FILES.CROP_OUTPUT);

        if (!files.exists(tempCroppedFile.getAbsolutePath())) {
            toast("裁剪失败：未找到临时文件。");
            appState.ui.pendingCropUri = null; // 重置
            return;
        }

        // (使用线程，防止保存操作卡住UI)
        threads.start(function() {
            try {
                // 1. 读取裁剪后的临时JPG
                let img = images.read(tempCroppedFile.getAbsolutePath());
                if (!img) { throw new Error("读取裁剪图片失败"); }

                // 2. 生成新文件名并保存到 'images' 目录
                files.ensureDir(CONSTANTS.FILES.IMAGE_DIR);
                const newName = "img_" + new Date().getTime() + ".png"; // 自动命名
                let finalPath = files.join(CONSTANTS.FILES.IMAGE_DIR, newName);

                let success = images.save(img, finalPath, "png"); // 转换为PNG
                img.recycle();

                if (!success) { throw new Error("保存为 PNG 格式失败"); }

                // 3. 【V7 核心】: 裁剪成功后, 在主窗口用 "弹窗" 提示用户
                ui.run(() => {
                    dialogs.alert("新建图片成功", 
                        "图片已成功保存到 'images' 文件夹中：\n\n" + newName +
                        "\n\n您现在可以在“编辑任务”或“编辑触发器”中选择它。"
                    );
                });

            } catch (e) {
                logErrorToScreen("保存裁剪图片失败: " + e);
                toast("保存裁剪图片失败: " + e.message);
            } finally {
                // 4. 清理
                cleanupTempCropFile();
                appState.ui.pendingCropUri = null;
            }
        });
    }
});
// --- 5.1.2 (v3 修复) 结束 ---
ui.showHelpBtn.click(showHelpDialog);

ui.startFloatyBtn.click(function () {
    if (appState.isFloatyCreated) {
        toast("悬浮窗口已运行，无需重复启动。");
        return;
    }

    logToScreen("正在请求权限并启动悬浮窗...");
    ui.startFloatyBtn.setEnabled(false);
    ui.startFloatyBtn.setText("启动中...");

    threads.start(function () {
        if (!checkPermissions()) {
            ui.run(() => {
                logErrorToScreen("权限不足或用户拒绝。");
                ui.startFloatyBtn.setEnabled(true);
                ui.startFloatyBtn.setText("启动");
            });
            return;
        }

        files.ensureDir(CONSTANTS.FILES.IMAGE_DIR);
        logToScreen("权限检查通过，正在创建悬浮窗...");
        createTargetView();
        createRedDot();
        // --- V7.6 修复：延迟同步以等待UI线程绘制 ---
        setTimeout(syncRedDotPosition, 100);
        // --- 修复结束 ---
        ui.run(() => { createControlPanel(); });

        let waitMs = 0;
        while (!uiRefs.controlPanel && waitMs < 3000) {
            sleep(200);
            waitMs += 200;
        }

        if (!uiRefs.targetView || !uiRefs.redDot || !uiRefs.controlPanel) {
            ui.run(() => {
                toast("浮窗创建失败，请检查权限或重启");
                logErrorToScreen("浮窗创建失败。");
                ui.startFloatyBtn.setEnabled(true);
                ui.startFloatyBtn.setText("启动");
            });
            return;
        }

        appState.isFloatyCreated = true;
        loadLastUsedProfile();

        // --- 核心修复 (Bug 3)：刷新“编辑”选项卡 ---
        ui.run(() => {
            // 检查“编辑”选项卡是否已被渲染过
            if (ui.sequenceEditorView && ui.sequenceEditorView.getChildCount() > 0) {
                logToScreen("检测到浮窗启动，正在刷新‘编辑’选项卡...");
                let searchBox = ui.sequenceSearchBox;
                if (searchBox) searchBox.setText("");
                populateSequenceListEditor("");
            }
        });
        // --- 修复结束 ---

        ui.run(() => {
            refreshAllUI();
            populateGraphicalSettings();
            ui.configEditor.setEnabled(true);
            ui.saveConfigBtn.setEnabled(true);
            // (我们已经从XML中启用了这两个按钮)
            // ui.profileManagerBtn.setEnabled(true);
            // ui.importExportBtn.setEnabled(true);
            ui.startFloatyBtn.setEnabled(true);
            ui.startFloatyBtn.setText("启动");
            logToScreen(`✅ 悬浮窗启动成功！当前方案: ${currentProfileName.replace(CONSTANTS.FILES.PROFILE_PREFIX, '').replace('.json', '')}`);
            toast("悬浮窗口已启动！");
            
            // --- 核心修复 (Bug 4)：删除这一行，不再隐藏主窗口 ---
            // activity.moveTaskToBack(true);
            
            if (!metaConfig.hasSeenTutorial) {
                startTutorial();
            }
        });
    });
});

ui.profileManagerBtn.click(() => {
    showProfileManager();
});
ui.importExportBtn.click(() => {
    showImportExportDialog();
});
ui.saveConfigBtn.click(() => {
    if (!appState.isFloatyCreated) {
        toast("请先启动悬浮窗口后再保存");
        return;
    }
    try {
        const editorText = ui.configEditor.getText().toString();
        const newConfig = JSON.parse(editorText);
        // Validate new structure
        if (!newConfig || typeof newConfig.settings !== 'object' || typeof newConfig.sequences !== 'object') {
            throw new Error("配置文件格式不正确，缺少settings或sequences字段");
        }
        appSettings = newConfig.settings;
        sequences = newConfig.sequences;
        saveCurrentProfileThrottled();
        refreshAllUI();
        logToScreen("配置已通过JSON编辑器保存。");
        toast("修改已保存并应用！");
    } catch (e) {
        logErrorToScreen("JSON保存失败: " + e.message);
        dialogs.alert("保存失败！", "JSON格式无效或内容不合法，请检查您的修改。\n\n错误详情: " + e.message);
    }
});

function isValidHexColor(colorStr) {
    return /^#(?:[0-9a-fA-F]{3,4}){1,2}$/.test(colorStr) && (colorStr.length === 7 || colorStr.length === 9);
}

ui.saveGraphicalSettingsBtn.click(() => {
    try {
        const targetColor = ui.targetColorInput.getText().toString();
        const clickTaskColor = ui.clickTaskColorInput.getText().toString();
        const swipeTaskColor = ui.swipeTaskColorInput.getText().toString();
        if (!isValidHexColor(targetColor) || !isValidHexColor(clickTaskColor) || !isValidHexColor(swipeTaskColor)) {
            toast("颜色代码格式不正确，应为 #RRGGBB 或 #AARRGGBB 格式。");
            return;
        }

        const clickDelayStr = ui.clickDelayInput.getText().toString();
        const swipeDurationStr = ui.swipeDurationInput.getText().toString();
        const yOffsetStr = ui.yOffsetInput.getText().toString();
        const panelWidthStr = ui.panelWidthInput.getText().toString();
        const targetViewSizeStr = ui.targetViewSizeInput.getText().toString();
        // --- 1. 在这里添加新行 ---
        const defaultCachePaddingStr = ui.defaultCachePaddingInput.getText().toString();
        // --- 2. 修改下面的 if 语句 ---
        if (!validateNumericInput(clickDelayStr) || !validateNumericInput(swipeDurationStr) || !validateNumericInput(yOffsetStr) || !validateNumericInput(panelWidthStr) || !validateNumericInput(targetViewSizeStr) || !validateNumericInput(defaultCachePaddingStr)) {
            return;
        }
        appSettings.clickDelayMs = parseInt(clickDelayStr);
        appSettings.swipe.duration = parseInt(swipeDurationStr);
        appSettings.yOffset = parseInt(yOffsetStr) || statusBarHeight;
        appSettings.panelWidth = parseInt(panelWidthStr);
        appSettings.targetViewSize = parseInt(targetViewSizeStr);
        // --- 3. 在这里添加新行 ---
        appSettings.defaultCachePadding = parseInt(defaultCachePaddingStr);
        appSettings.showPanelCoordinates = ui.showCoordsCheckbox.isChecked();
        appSettings.theme.targetViewColor = targetColor;
        appSettings.theme.taskClickColor = clickTaskColor;
        appSettings.theme.taskSwipeColor = swipeTaskColor;
        appSettings.useGestureSwipe = ui.useGestureSwipeCheckbox.isChecked();
        appSettings.taskVisualsHidden = ui.taskVisualsHiddenCheckbox.isChecked();
        saveCurrentProfileThrottled();
        if (appState.isFloatyCreated) {
            refreshAllUI();
        }
        logToScreen("设置已通过图形化面板保存。");
        toast("设置已保存并应用！");
    } catch (e) {
        logErrorToScreen("图形化设置保存失败: " + e.message);
        toast("保存失败: " + e.message);
    }
});
ui.clearLogBtn.click(() => {
    ui.logView.setText("");
    logToScreen("常规日志已清空。");
});
ui.clearErrorLogBtn.click(() => {
    ui.errorLogView.setText("");
    logErrorToScreen("错误日志已清空。");
});

// =================================================================================
// 新手引导功能 (New User Tutorial)
// =================================================================================
function startTutorial() {
    let step = 0;
    const steps = [
        {
            text: "欢迎使用！这是控制面板，\n【长按并拖动】这里可以移动它。",
            position: (target) => getTutorialPosition(target, 'above')
        },
        {
            text: "【单击】头部区域可以收起/展开按钮。",
            position: (target) => getTutorialPosition(target, 'above')
        },
        {
            text: "这是【目标视图】，所有点击和滑动都以它为基准。\n【拖动】它可以改变位置。",
            position: (target) => getTutorialPosition(target, 'above')
        },
        {
            text: "这是【序列管理器】，所有自动化流程都在这里创建和管理。\n【长按】序列可以将其设为主序列或主监控。",
            position: (target) => getTutorialPosition(target, 'auto')
        },
        {
            text: "所有设置和任务都保存在“方案”中，\n您可以在这里管理、新建和切换方案。\n\n教程结束，开始使用吧！",
            position: (target) => getTutorialPosition(target, 'auto')
        }
    ];

    const targets = [
        () => uiRefs.controlPanel,
        () => uiRefs.controlPanel,
        () => uiRefs.targetView,
        () => uiRefs.controlPanel,
        () => ui.profileManagerBtn,
    ];

    function getTutorialPosition(targetWindow, preference) {
        if (!targetWindow) return { x: device.width / 4, y: device.height / 3 };

        const targetX = targetWindow.getX();
        const targetY = targetWindow.getY();
        const targetH = targetWindow.getHeight();
        const estTutorialH = 250;
        const spacing = 20;
        let yPos;
        if (preference === 'above') {
            yPos = targetY - estTutorialH - spacing;
        } else if (preference === 'below') {
            yPos = targetY + targetH + spacing;
        } else { // auto
            if (targetY + targetH + estTutorialH + spacing > device.height) {
                yPos = targetY - estTutorialH - spacing;
            } else {
                yPos = targetY + targetH + spacing;
            }
        }
        return { x: targetX, y: Math.max(0, yPos) };
    }


    function showStep(index) {
        if (appState.ui.tutorialWindow) {
            appState.ui.tutorialWindow.close();
            appState.ui.tutorialWindow = null;
        }
        if (index >= steps.length) {
            metaConfig.hasSeenTutorial = true;
            saveMetaConfig();
            toast("引导结束！");
            return;
        }
        const currentStep = steps[index];
        const target = targets[index]();
        const pos = currentStep.position(target);
        appState.ui.tutorialWindow = floaty.rawWindow(
            <card w="*" h="*" cardCornerRadius="10dp" cardElevation="8dp" bg="#C0000000">
                <vertical gravity="center" padding="16">
                    <text id="text" textColor="#FFFFFF" textSize="18sp" textStyle="bold" gravity="center" />
                    <button id="nextBtn" text="下一步" marginTop="20" />
                </vertical>
            </card>
        );
        appState.ui.tutorialWindow.text.setText(currentStep.text);
        appState.ui.tutorialWindow.setSize(device.width / 2, -2);
        appState.ui.tutorialWindow.setPosition(pos.x, pos.y);
        setTimeout(() => {
            validateAndResetWindowPosition(appState.ui.tutorialWindow);
        }, 50);
        appState.ui.tutorialWindow.nextBtn.click(() => {
            showStep(index + 1);
        });
    }
    showStep(step);
}

// =================================================================================
// 核心功能：任务序列执行
// =================================================================================

function getStopSignal(contextType) {
    if (contextType === 'main') {
        return !appState.isExecuting;
    } else { // 'monitor' or sub-sequence from monitor
        const isAnyMonitorRunning = appState.isMonitoring || Object.keys(appState.activeMonitors).length > 0;
        return !isAnyMonitorRunning;
    }
}

function handleOcrSuccess(ocrResult, successAction) {
    if (!successAction) return;
    switch (successAction.action) {
        case 'click':
            const ocrOffsetX = successAction.offsetX || 0;
            const ocrOffsetY = successAction.offsetY || 0;
            let targetBounds = ocrResult.bounds;
            let clickX = targetBounds.centerX() + ocrOffsetX;
            let clickY = targetBounds.centerY() + ocrOffsetY;
            logToScreen(`对 "${ocrResult.label}" 执行点击操作 at (${clickX}, ${clickY}) (偏移: ${ocrOffsetX},${ocrOffsetY})`);
            showClickDot(clickX, clickY);
            safePress(clickX, clickY, CONSTANTS.UI.CLICK_PRESS_DURATION_MS);
            sleep(appSettings.clickDelayMs);
            break;
        case 'back':
            logToScreen(`识别成功，执行返回操作`);
            back();
            sleep(appSettings.clickDelayMs);
            break;
    }
}

function handleImageSuccess(location, successAction) {
    if (!successAction) return;
    switch (successAction.action) {
        case 'click':
            const imgOffsetX = successAction.offsetX || 0;
            const imgOffsetY = successAction.offsetY || 0;
            let clickX = location.centerX() + imgOffsetX;
            let clickY = location.centerY() + imgOffsetY;
            logToScreen(`对找到的图片执行点击操作 at (${clickX}, ${clickY}) (偏移: ${imgOffsetX},${imgOffsetY})`);
            showClickDot(clickX, clickY);
            safePress(clickX, clickY, CONSTANTS.UI.CLICK_PRESS_DURATION_MS);
            sleep(appSettings.clickDelayMs);
            break;
        case 'back':
            logToScreen(`图片识别成功，执行返回操作`);
            back();
            sleep(appSettings.clickDelayMs);
            break;
    }
}

function handleGeneralSuccessAction(successAction, actionName, sourceName, contextType, depth) {
    if (!successAction) return;

    if (successAction.action === 'execute_sequence') {
        if (successAction.sequenceName) {
            const subSequence = sequences[successAction.sequenceName];
            if (subSequence) {
                logToScreen(`...[${actionName}]成功，调用子序列: ${subSequence.name || successAction.sequenceName}`);
                executeSequence(subSequence.tasks, `子序列 (${subSequence.name || successAction.sequenceName})`, contextType, depth + 1);
            } else {
                logErrorToScreen(`错误: 找不到名为 "${successAction.sequenceName}" 的子序列`);
            }
        }
    } else if (successAction.action === 'back') {
        logToScreen(`...[${actionName}]成功，执行返回。`);
        back();
        sleep(appSettings.clickDelayMs);
    }
    // 'skip' is the default and does nothing, so no need to handle it here.
}


function handleGeneralFailAction(failAction, actionName, sourceName, contextType, depth) {
    if (!failAction) return;

    if (failAction.action === 'execute_sequence') {
        if (failAction.sequenceName) {
            const subSequence = sequences[failAction.sequenceName];
            if (subSequence) {
                logToScreen(`...[${actionName}]失败，调用备用序列: ${subSequence.name || failAction.sequenceName}`);
                executeSequence(subSequence.tasks, `备用序列 (${subSequence.name})`, contextType, depth + 1);
            } else {
                logErrorToScreen(`错误: 找不到名为 "${failAction.sequenceName}" 的备用序列`);
            }
        }
    } else if (failAction.action === 'stop') {
        logToScreen(`...[${actionName}]失败，停止执行。`);
        ui.run(() => stopExecution(`任务因 [${actionName}] 失败而停止`));
    } else { // 'skip' is the default
        logToScreen(`...[${actionName}]失败，跳过当前任务，继续执行。`);
    }
}


function smoothSwipe(x1, y1, x2, y2) {
    const totalDuration = appSettings.swipe.duration;
    sleep(50);
    try {
        gestures([0, totalDuration, [x1, y1], [x2, y2]]);
        logToScreen(`手势滑动成功 (简化模式): 从 (${x1}, ${y1}) 到 (${x2}, ${y2})，总时长 ${totalDuration}ms`);
    } catch (e) {
        logErrorToScreen("手势滑动失败，回退到 swipe(): " + e);
        swipe(x1, y1, x2, y2, totalDuration);
        logToScreen(`回退到 swipe() 成功: 从 (${x1}, ${y1}) 到 (${x2}, ${y2})，时长 ${totalDuration}ms`);
    }
    sleep(appSettings.clickDelayMs);
}

function isBusy() {
    if (appState.ui.instructionWindow || appState.ui.tutorialWindow) {
        toast("请先完成或取消当前的操作");
        return true;
    }
    return false;
}

function executeSequence(tasksToRun, sourceName, contextType, depth) {
    depth = depth || 0;
    if (depth > 50) {
        logErrorToScreen(`错误: 序列调用深度过深(>${depth})，可能存在无限循环: ${sourceName}`);
        return;
    }

    if (!tasksToRun || !Array.isArray(tasksToRun)) {
        logToScreen(`序列 [${sourceName}] 为空或无效，跳过执行。`);
        return;
    }
    logToScreen(`开始执行序列: ${sourceName}`);
    for (let i = 0; i < tasksToRun.length; i++) {
        if (getStopSignal(contextType)) {
            logToScreen(`序列 [${sourceName}] 在任务 ${i + 1} 前被外部停止信号中断。`);
            break;
        }

        let task = tasksToRun[i];
        if (typeof task !== 'object' || task === null) {
            logErrorToScreen(`警告: 在序列 [${sourceName}] 的第 ${i + 1} 个位置发现无效任务 (非对象)，跳过。`);
            continue;
        }

        // --- 核心修改：在这里添加 ---
        // (如果 task.enabled 未定义, 'undefined === false' 为 false, 任务会正常运行)
        if (task.enabled === false) {
            logToScreen(`[${sourceName}] 任务 ${i + 1} (${task.name || task.type}) 已被禁用，跳过。`);
            continue; // 跳过此任务，执行下一个
        }
        // --- 修改结束 ---

        if (task.delayMs > 0) {
            logToScreen(`任务 [${task.name}] 延迟执行 ${task.delayMs}ms`);
            sleep(task.delayMs);
            if (threads.currentThread().isInterrupted()) break;
        }

        const taskName = task.name || `[${task.type}]`;

        switch (task.type) {
            case 'click': {
                logToScreen(`[${sourceName}] 执行任务 ${i + 1}: ${taskName}`);
                let offsetX = task.offsetX || 0;
                let offsetY = task.offsetY || 0;
                let clickX = task.x + offsetX;
                let clickY = task.y + offsetY;
                logToScreen(`... 点击坐标: (${clickX}, ${clickY}) (基准: ${task.x},${task.y} | 偏移: ${offsetX},${offsetY})`);
                safePress(clickX, clickY, CONSTANTS.UI.CLICK_PRESS_DURATION_MS);
                showClickDot(clickX, clickY);
                sleep(appSettings.clickDelayMs);
                if (threads.currentThread().isInterrupted()) break;
                break;
            }
            case 'wait': {
                logToScreen(`[${sourceName}] 执行任务 ${i + 1}: ${taskName}`);
                let totalWaitTime = task.duration || 1000;
                toast(`执行: ${taskName}`);

                // --- 核心修改：在这里设置倒计时 ---
                appState.currentWaitTask = { remaining: totalWaitTime, total: totalWaitTime };
                // --- 修改结束 ---

                let timeWaited = 0;
                const sleepInterval = 1000; // 保持 1000ms, 与我们的时钟同步
                const toastThreshold = 10000;
                let nextToastPoint = toastThreshold;

                try {
                    while (timeWaited < totalWaitTime) {
                        if (getStopSignal(contextType) || threads.currentThread().isInterrupted()) break;
                        sleep(sleepInterval);
                        if (threads.currentThread().isInterrupted()) break;
                        timeWaited += sleepInterval;

                        // --- 核心修改：更新倒计时 ---
                        if (appState.currentWaitTask) {
                            appState.currentWaitTask.remaining = totalWaitTime - timeWaited;
                        }
                        // --- 修改结束 ---
                    }
                } finally {
                    // --- 核心修改：清除倒计时 ---
                    appState.currentWaitTask = null;
                    // --- 修改结束 ---
                }
                break;
            }
            case 'swipe': {
                logToScreen(`[${sourceName}] 执行任务 ${i + 1}: ${taskName}`);
                toast(`执行: ${taskName}`);
                if (appSettings.useGestureSwipe) {
                    smoothSwipe(task.startX, task.startY, task.endX, task.endY);
                } else {
                    swipe(task.startX, task.startY, task.endX, task.endY, task.duration || appSettings.swipe.duration);
                    logToScreen(`成功执行普通滑动: 从 (${task.startX}, ${task.startY}) 到 (${task.endX}, ${task.endY})，时长 ${task.duration || appSettings.swipe.duration}ms`);
                    sleep(appSettings.clickDelayMs);
                }
                if (threads.currentThread().isInterrupted()) break;
                break;
            }
            case 'ocr': {
                // 使用 var 避免重复声明
                var taskNameLog = task.name ? taskName : `${taskName} ("${task.textToFind}")`;
                logToScreen(`[${sourceName}] 执行任务 ${i + 1}: ${taskNameLog}`);
                
                var foundResult = null;
                var timeout = task.timeout || 5000;

                // --- 1. 尝试缓存搜索 ---
                if (task.cachedBounds && task.cachedBounds.left !== undefined) {
                    logToScreen(`... 尝试缓存搜索`);
                    var captured = captureScreen();
                    if (captured) {
                        var b = task.cachedBounds;
                        var padding = (task.cachePadding !== undefined) ? task.cachePadding : (appSettings.defaultCachePadding || 50);
                        var region = calculatePaddedRegion(b, padding);
                        var ocrResults = ocr.paddle.detect(captured, { region: region, useSlim: true });
                        var target = ocrResults.find(r => r.label.includes(task.textToFind));
                        if (target) {
                            logToScreen("... 缓存命中");
                            foundResult = target;
                        }
                        captured.recycle();
                    }
                }

                // --- 2. 全屏/区域搜索 ---
                if (!foundResult) {
                    var startTime = new Date().getTime();
                    while (new Date().getTime() - startTime < timeout) {
                        if (getStopSignal(contextType) || threads.currentThread().isInterrupted()) break;
                        
                        var captured = captureScreen();
                        if (!captured) { sleep(1000); continue; }

                        var ocrOptions = { useSlim: true };
                        if (task.search_area && task.search_area.length === 4) {
                            var [x1, y1, x2, y2] = task.search_area;
                            var searchBounds = { left: x1, top: y1, right: x2, bottom: y2 };
                            ocrOptions.region = calculatePaddedRegion(searchBounds, 0);
                        }
                        var ocrResults = ocr.paddle.detect(captured, ocrOptions);
                        captured.recycle();
                        
                        var target = ocrResults.find(r => r.label.includes(task.textToFind));
                        if (target) {
                            foundResult = target;
                            task.cachedBounds = { left: target.bounds.left, top: target.bounds.top, right: target.bounds.right, bottom: target.bounds.bottom };
                            saveCurrentProfileThrottled();
                            break;
                        }
                        sleep(300);
                    }
                }

                if (getStopSignal(contextType) || threads.currentThread().isInterrupted()) break;

                // --- 3. 结果处理 ---
                if (foundResult) {
                    var successAction = task.onSuccess || { action: 'click', after: 'none' };
                    var taskActionType = successAction.action; 

                    // handleOcrSuccess 处理主动作
                    handleOcrSuccess(foundResult, successAction);

                    // 处理后续操作
                    if (successAction.after === 'terminate') {
                        logToScreen(`任务 [${taskNameLog}] 成功，后续操作: 终止序列。`);
                        ui.run(() => stopExecution(`任务 [${taskNameLog}] 触发终止`));
                        break; 
                    } else if (successAction.after === 'sequence') {
                        if (successAction.sequenceName) {
                            logToScreen(`任务 [${taskNameLog}] 成功，后续操作: 调用子序列。`);
                            // 【修复点】使用 var subSeq
                            var subSeq = sequences[successAction.sequenceName];
                            if (subSeq) {
                                executeSequence(subSeq.tasks, `子序列 (${subSeq.name})`, contextType, depth + 1);
                            } else {
                                logErrorToScreen(`错误: 找不到子序列 ${successAction.sequenceName}`);
                            }
                        }
                    }

                } else {
                    logToScreen(`超时 ${timeout}ms 未找到文本 "${task.textToFind}"`);
                    handleGeneralFailAction(task.onFail, '识别失败', sourceName, contextType, depth);
                }
                break;
            }
            case 'image': {
                // 使用 var
                var taskNameLog = task.name ? taskName : `${taskName} ("${task.imageFile}")`;
                logToScreen(`[${sourceName}] 执行任务 ${i + 1}: ${taskNameLog}`);
                
                var foundImagePoint = null;
                var imageTimeout = task.timeout || 5000;
                var imagePath = files.join(CONSTANTS.FILES.IMAGE_DIR, task.imageFile);

                if (!files.exists(imagePath)) {
                    logErrorToScreen(`图片不存在: ${task.imageFile}`);
                    handleGeneralFailAction(task.onFail, '找图失败', sourceName, contextType, depth);
                    break;
                }
                var template = images.read(imagePath);
                if (!template) {
                    logErrorToScreen(`无法读取图片: ${task.imageFile}`);
                    handleGeneralFailAction(task.onFail, '找图失败', sourceName, contextType, depth);
                    break;
                }

                // --- 1. 缓存搜索 ---
                if (task.cachedBounds && task.cachedBounds.x !== undefined) {
                    logToScreen(`... 尝试缓存搜索`);
                    var captured = captureScreen();
                    if (captured) {
                        var b = task.cachedBounds;
                        var padding = (task.cachePadding !== undefined) ? task.cachePadding : (appSettings.defaultCachePadding || 50);
                        var region = calculatePaddedRegion(b, padding);
                        var p = images.findImage(captured, template, { region: region, threshold: task.threshold || 0.8 });
                        if (p) {
                            logToScreen("... 缓存命中");
                            foundImagePoint = p;
                        }
                        captured.recycle();
                    }
                }

                // --- 2. 全屏/区域搜索 ---
                if (!foundImagePoint) {
                    var startTime = new Date().getTime();
                    while (new Date().getTime() - startTime < imageTimeout) {
                        if (getStopSignal(contextType) || threads.currentThread().isInterrupted()) break;
                        
                        var captured = captureScreen();
                        if (!captured) { sleep(1000); continue; }

                        var findOptions = { threshold: task.threshold || 0.8 };
                        if (task.search_area && task.search_area.length === 4) {
                            var [x1, y1, x2, y2] = task.search_area;
                            var searchBounds = { left: x1, top: y1, right: x2, bottom: y2 };
                            findOptions.region = calculatePaddedRegion(searchBounds, 0);
                        }
                        var p = images.findImage(captured, template, findOptions);
                        captured.recycle();

                        if (p) {
                            foundImagePoint = p;
                            task.cachedBounds = { x: p.x, y: p.y, width: template.getWidth(), height: template.getHeight() };
                            saveCurrentProfileThrottled();
                            break;
                        }
                        sleep(300);
                    }
                }

                if (getStopSignal(contextType) || threads.currentThread().isInterrupted()) {
                    template.recycle();
                    break;
                }

                // --- 3. 结果处理 ---
                if (foundImagePoint) {
                    var location = {
                        left: foundImagePoint.x, 
                        top: foundImagePoint.y, 
                        right: foundImagePoint.x + template.getWidth(), 
                        bottom: foundImagePoint.y + template.getHeight(),
                        centerX: function () { return this.left + (this.right - this.left) / 2; },
                        centerY: function () { return this.top + (this.bottom - this.top) / 2; }
                    };

                    var successAction = task.onSuccess || { action: 'click', after: 'none' };
                    var taskActionType = successAction.action;

                    // 处理主动作
                    handleImageSuccess(location, successAction);

                    // 处理后续操作
                    if (successAction.after === 'terminate') {
                        logToScreen(`任务 [${taskNameLog}] 成功，后续操作: 终止序列。`);
                        ui.run(() => stopExecution(`任务 [${taskNameLog}] 触发终止`));
                        break; 
                    } else if (successAction.after === 'sequence') {
                        if (successAction.sequenceName) {
                            logToScreen(`任务 [${taskNameLog}] 成功，后续操作: 调用子序列。`);
                            // 【修复点】使用 var subSeq
                            var subSeq = sequences[successAction.sequenceName];
                            if (subSeq) {
                                executeSequence(subSeq.tasks, `子序列 (${subSeq.name})`, contextType, depth + 1);
                            } else {
                                logErrorToScreen(`错误: 找不到子序列 ${successAction.sequenceName}`);
                            }
                        }
                    }

                } else {
                    logToScreen(`超时 ${imageTimeout}ms 未找到图片 "${task.imageFile}"`);
                    handleGeneralFailAction(task.onFail, '找图失败', sourceName, contextType, depth);
                }
                
                template.recycle();
                break;
            }
            case 'wait_for_dissapear': {
                logToScreen(`[${sourceName}] 执行任务 ${i + 1}: ${task.name || `等待'${task.target}'消失`}`);
                toast(`执行: ${task.name}`);

                let targetFound = false;
                let findStartTime = new Date().getTime();
                const findTimeout = task.findTimeout || 5000;
                let findOptions = {};
                let imageTemplate = null;

                // 准备查找选项和图片模板
                if (task.targetType === 'image') {
                    let imagePath = files.join(CONSTANTS.FILES.IMAGE_DIR, task.target);
                    if (!files.exists(imagePath)) {
                        logErrorToScreen(`错误: 图片文件不存在 at ${imagePath}`);
                        handleGeneralFailAction(task.onFail, '等待消失-文件不存在', sourceName, contextType, depth);
                        break;
                    }
                    imageTemplate = images.read(imagePath);
                    if (!imageTemplate) {
                        logErrorToScreen(`错误: 无法读取图片文件 at ${imagePath}`);
                        handleGeneralFailAction(task.onFail, '等待消失-无法读取', sourceName, contextType, depth);
                        break;
                    }
                    findOptions = { threshold: task.threshold || 0.8 };
                } else { // ocr
                    findOptions = { useSlim: true };
                }

                if (task.search_area && task.search_area.length === 4) {
                    // --- 核心修复：使用 calculatePaddedRegion 来限制 search_area ---
                    let [x1, y1, x2, y2] = task.search_area;
                    let searchBounds = { left: x1, top: y1, right: x2, bottom: y2 };
                    findOptions.region = calculatePaddedRegion(searchBounds, 0); // 0 padding
                    // --- 修复结束 ---
                }

                // 1. 查找阶段: 等待目标出现
                logToScreen(`...阶段1: 查找目标 "${task.target}" (超时: ${findTimeout}ms)`);
                while (new Date().getTime() - findStartTime < findTimeout) {
                    if (getStopSignal(contextType) || threads.currentThread().isInterrupted()) break;

                    let captured = captureScreen();
                    if (!captured) {
                        logToScreen("截图失败，稍后重试...");
                        sleep(500);
                        if (threads.currentThread().isInterrupted()) break;
                        continue;
                    }

                    let result = null;
                    if (task.targetType === 'image') {
                        result = images.findImage(captured, imageTemplate, findOptions);
                    } else { // ocr
                        let ocrResults = ocr.paddle.detect(captured, findOptions);
                        result = ocrResults.find(r => r.label.includes(task.target));
                    }
                    captured.recycle();

                    if (result) {
                        targetFound = true;
                        logToScreen(`...目标 "${task.target}" 已找到，进入下一阶段。`);
                        break;
                    }
                    sleep(300); // 检查间隔
                    if (threads.currentThread().isInterrupted()) break;
                }

                if (getStopSignal(contextType) || threads.currentThread().isInterrupted()) {
                    if (imageTemplate) imageTemplate.recycle();
                    break;
                }

                if (!targetFound) {
                    logToScreen(`...阶段1失败: 在 ${findTimeout}ms 内未找到目标 "${task.target}"。`);
                    handleGeneralFailAction(task.onFail, 'onFail (未找到)', sourceName, contextType, depth);
                    if (imageTemplate) imageTemplate.recycle();
                    break;
                }

                // 2. 消失阶段: 等待目标消失
                let targetDisappeared = false;
                let disappearStartTime = new Date().getTime();
                const disappearTimeout = task.disappearTimeout || 10000;

                logToScreen(`...阶段2: 等待目标 "${task.target}" 消失 (超时: ${disappearTimeout}ms)`);
                while (new Date().getTime() - disappearStartTime < disappearTimeout) {
                    if (getStopSignal(contextType) || threads.currentThread().isInterrupted()) break;

                    let captured = captureScreen();
                    if (!captured) {
                        logToScreen("截图失败，稍后重试...");
                        sleep(500);
                        if (threads.currentThread().isInterrupted()) break;
                        continue;
                    }

                    let result = null;
                    if (task.targetType === 'image') {
                        result = images.findImage(captured, imageTemplate, findOptions);
                    } else { // ocr
                        let ocrResults = ocr.paddle.detect(captured, findOptions);
                        result = ocrResults.find(r => r.label.includes(task.target));
                    }
                    captured.recycle();

                    if (!result) {
                        targetDisappeared = true;
                        logToScreen(`...目标 "${task.target}" 已消失。`);
                        break;
                    }
                    sleep(500); // 消失检查间隔
                    if (threads.currentThread().isInterrupted()) break;
                }

                if (imageTemplate) imageTemplate.recycle();
                if (getStopSignal(contextType) || threads.currentThread().isInterrupted()) break;

                // 3. 动作阶段
                if (targetDisappeared) {
                    logToScreen(`...阶段2成功: 目标成功消失，执行成功后操作。`);
                    handleGeneralSuccessAction(task.onSuccess, 'onSuccess', sourceName, contextType, depth);
                } else {
                    logToScreen(`...阶段2失败: 在 ${disappearTimeout}ms 后目标 "${task.target}" 仍未消失。`);
                    handleGeneralFailAction(task.onTimeout, 'onTimeout (未消失)', sourceName, contextType, depth);
                }

                break;
            }
            case 'back': {
                logToScreen(`[${sourceName}] 执行任务 ${i + 1}: ${taskName}`);
                back();
                sleep(appSettings.clickDelayMs);
                if (threads.currentThread().isInterrupted()) break;
                break;
            }
            case 'launch_app': {
                logToScreen(`[${sourceName}] 执行任务 ${i + 1}: ${taskName}`);
                if (task.appName) {
                    app.launchApp(task.appName);
                    logToScreen(`已尝试启动应用: ${task.appName}`);
                } else {
                    logErrorToScreen(`错误: launch_app 任务未指定 appName`);
                }
                sleep(appSettings.clickDelayMs);
                if (threads.currentThread().isInterrupted()) break;
                break;
            }
            case 'start_monitor': {
                // --- 修复 2: (并发控制) 检查是否已有 *任何* 监控在运行 ---
                const isAnyMonitorRunning = appState.isMonitoring || Object.keys(appState.activeMonitors).length > 0;
                if (isAnyMonitorRunning) {
                    logErrorToScreen(`[${sourceName}] 启动监控 [${task.sequenceName}] 失败：已有其他监控正在运行。`);
                    toast("启动监控失败：已有其他监控在运行");
                    break; // 跳过此任务
                }
                // --- 修复 2 结束 ---

                logToScreen(`[${sourceName}] 动态启动监控: ${task.sequenceName}`);
                const sequenceToMonitor = sequences[task.sequenceName];
                
                if (sequenceToMonitor && sequenceToMonitor.executionPolicy.mode === 'monitor') {
                    // (这个内部检查是多余的，因为上面的全局检查已经覆盖了，但保留它也无害)
                    if (appState.activeMonitors[task.sequenceName]) {
                        logToScreen(`警告: 监控 [${task.sequenceName}] 已在运行中，无需重复启动。`);
                        break;
                    }
                    
                    // 启动监控线程
                    runSingleMonitorThread(sequenceToMonitor, task.sequenceName);
                    
                    // --- 修复 1: (UI同步) 启动后，手动更新 👁️ 按钮状态 ---
                    updateMonitorStatusUI();
                    // --- 修复 1 结束 ---

                } else {
                    logErrorToScreen(`错误: 找不到名为 "${task.sequenceName}" 的监控序列，或其模式不为 'monitor'`);
                }
                break;
            }
            case 'stop_monitor': {
                logToScreen(`[${sourceName}] 正在停止监控: ${task.sequenceName}`);
                
                const monitorThreadId = appState.activeMonitors[task.sequenceName];
                
                if (monitorThreadId) {
                    // 【核心修复 1】先清理数据，再停止线程。防止线程提前终止导致状态残留。
                    
                    // 1. 从活动列表中移除
                    delete appState.activeMonitors[task.sequenceName];
                    
                    // 2. 检查并更新全局开关状态
                    // 如果停止的是主监控，或者当前没有任何监控在运行了，必须把总开关 isMonitoring 关掉
                    // 这样 updateMonitorStatusUI 才能正确识别状态
                    if (task.sequenceName === appSettings.mainMonitorKey || Object.keys(appState.activeMonitors).length === 0) {
                        appState.isMonitoring = false;
                        appState.timers = {}; 
                        logToScreen("所有监控已停止，重置全局状态。");
                    }

                    // 3. 强制 UI 刷新 (放在中断线程之前)
                    ui.post(() => {
                        updateMonitorStatusUI();
                        // 双重保险：强制重置图标
                        if (!appState.isMonitoring && Object.keys(appState.activeMonitors).length === 0) {
                            if (uiRefs.controlPanel && uiRefs.controlPanel.monitorBtn) {
                                uiRefs.controlPanel.monitorBtn.setText("👁️");
                                uiRefs.controlPanel.monitorStatusIcon.setVisibility(8);
                            }
                        }
                    });
                    
                    // 4. 最后再处理线程停止
                    if (appState.threads[monitorThreadId]) {
                        // 如果是停止自己(当前线程)，interrupt后脚本可能随时停止，所以这步放最后
                        if (appState.threads[monitorThreadId].isAlive()) {
                            logToScreen(`正在终止线程: ${monitorThreadId}`);
                            appState.threads[monitorThreadId].interrupt();
                        }
                        delete appState.threads[monitorThreadId];
                    }
                    
                    logToScreen(`已停止监控 [${task.sequenceName}]`);
                    
                } else {
                    logToScreen(`警告: 监控 [${task.sequenceName}] 未在运行，无法停止。`);
                }
                break;
            }
            case 'execute_sequence': {
                logToScreen(`[${sourceName}] 执行任务 ${i + 1}: ${taskName}`);
                const sequenceToRun = sequences[task.sequenceName];
                if (sequenceToRun) {
                    executeSequence(sequenceToRun.tasks, `子序列 (${sequenceToRun.name || task.sequenceName})`, contextType, depth + 1);
                } else {
                    logErrorToScreen(`错误: 找不到名为 "${task.sequenceName}" 的子序列`);
                }
                break;
            }
            case 'timer': {
                logToScreen(`[${sourceName}] 执行任务 ${i + 1}: ${taskName}`);
                if (task.timerName && task.duration > 0) {
                    appState.timers[task.timerName] = new Date().getTime() + task.duration;
                    logToScreen(`...计时器 [${task.timerName}] 已启动/重置，时长: ${task.duration}ms`);
                } else {
                    logErrorToScreen(`...错误: 计时器任务 [${taskName}] 配置不正确 (缺少名称或时长)`);
                }
                break;
            }
            default: {
                logErrorToScreen(`[${sourceName}] 警告: 发现未知任务类型 "${task.type}"，已跳过。`);
                break;
            }
        }
    }
    logToScreen(`序列 [${sourceName}] 执行完毕。`);
}

function toggleSequenceExecution() {
    if (isBusy()) return;
    if (appState.isExecuting) {
        stopExecution("已手动停止任务序列");
        return;
    }
    if (appState.threads.execution && appState.threads.execution.isAlive()) {
        toast("任务已在运行，请勿重复启动！");
        return;
    }

    const mainSequenceKey = appSettings.mainSequenceKey;
    const mainSequence = mainSequenceKey ? sequences[mainSequenceKey] : null;

    if (!mainSequence || !mainSequence.tasks || mainSequence.tasks.length === 0) {
        toast("没有可执行的主序列。请在序列管理器中长按一个序列来设置。");
        return;
    }

    appState.isExecuting = true;
    updateControlButtonText("⏹️", "stop");
    const executionThread = threads.start(function () {
        try {
            const loopCount = (mainSequence.executionPolicy && mainSequence.executionPolicy.loopCount) || 1;
            logToScreen(`主序列 [${mainSequence.name}] 开始，共 ${loopCount} 轮。`);
            for (let loop = 1; loop <= loopCount; loop++) {
                if (!appState.isExecuting || threads.currentThread().isInterrupted()) break;
                logToScreen(`第 ${loop} / ${loopCount} 轮开始`);
                executeSequence(mainSequence.tasks, `主序列 (${mainSequence.name})`, 'main');
                if (!appState.isExecuting || threads.currentThread().isInterrupted()) break;
                logToScreen(`第 ${loop} 轮执行完毕。`);
            }
        } catch (e) {
            if (!(e instanceof java.lang.ThreadDeath) && !(e instanceof java.lang.InterruptedException)) {
                logErrorToScreen("任务执行异常: " + e);
                ui.run(() => toast("任务执行出现异常，详情请查看错误日志！"));
            }
        } finally {
            if (appState.isExecuting) {
                ui.run(() => stopExecution("任务序列执行完毕"));
            }
        }
    });
    appState.threads.execution = executionThread;
}

function stopExecution(message) {
    if (!appState.isExecuting) return;
    appState.isExecuting = false;

    if (appState.threads.execution && appState.threads.execution.isAlive()) {
        appState.threads.execution.interrupt();
    }
    appState.threads.execution = null;

    toast(message);
    logToScreen(message);
    updateControlButtonText("▶️", "start");
}

// =================================================================================
// 监控模式核心逻辑
// =================================================================================

function executeTriggerAction(trigger, location) {
    const action = trigger.action || { type: 'click' };
    const targetName = trigger.target || '未知目标';

    logToScreen(`监控触发: 找到 "${targetName}"，准备执行动作 [${action.type}]...`);

    if (action.delayMs > 0) {
        logToScreen(`动作延迟 ${action.delayMs}ms...`);
        sleep(action.delayMs);
    }

    switch (action.type) {
        case 'click': {
            const offsetX = action.offsetX || 0;
            const offsetY = action.offsetY || 0;
            const clickX = (location.x + location.width / 2) + offsetX;
            const clickY = (location.y + location.height / 2) + offsetY;
            logToScreen(`...对 "${targetName}" 执行点击 at (${clickX.toFixed(0)}, ${clickY.toFixed(0)}) (偏移: ${offsetX},${offsetY})`);
            showClickDot(clickX, clickY);
            safePress(clickX, clickY, CONSTANTS.UI.CLICK_PRESS_DURATION_MS);
            sleep(appSettings.clickDelayMs);
            break;
        }
        case 'back': {
            logToScreen(`...执行返回操作`);
            back();
            sleep(appSettings.clickDelayMs);
            break;
        }
        case 'swipe': {
            // --- 核心修改：区分 坐标滑动 和 向量滑动 ---
            if (action.swipeCoords) {
                // 1. 新增：使用固定的“坐标”滑动
                logToScreen(`...执行坐标滑动: (${action.swipeCoords.startX}, ${action.swipeCoords.startY}) -> (${action.swipeCoords.endX}, ${action.swipeCoords.endY})`);
                if (appSettings.useGestureSwipe) {
                    smoothSwipe(action.swipeCoords.startX, action.swipeCoords.startY, action.swipeCoords.endX, action.swipeCoords.endY);
                } else {
                    swipe(action.swipeCoords.startX, action.swipeCoords.startY, action.swipeCoords.endX, action.swipeCoords.endY, action.swipeCoords.duration || appSettings.swipe.duration);
                    sleep(appSettings.clickDelayMs);
                }
            } else if (action.swipeVector) {
                // 2. 保留：使用“向量”滑动 (从目标中心)
                const startX = location.x + location.width / 2;
                const startY = location.y + location.height / 2;
                const endX = startX + (action.swipeVector.dx || 0);
                const endY = startY + (action.swipeVector.dy || 0);
                const duration = action.swipeVector.duration || appSettings.swipe.duration;
                logToScreen(`...从目标中心 (${startX.toFixed(0)}, ${startY.toFixed(0)}) 开始执行向量滑动`);
                
                if (appSettings.useGestureSwipe) {
                    smoothSwipe(startX, startY, endX, endY);
                } else {
                    swipe(startX, startY, endX, endY, duration);
                    sleep(appSettings.clickDelayMs);
                }
            } else {
                logErrorToScreen(`...错误: 滑动动作未定义 swipeVector (向量) 或 swipeCoords (坐标)`);
            }
            break;
        }
        case 'launch_app': {
            if (action.appName) {
                logToScreen(`...执行启动应用操作: ${action.appName}`);
                app.launchApp(action.appName);
                sleep(appSettings.clickDelayMs);
            } else {
                logErrorToScreen(`...错误: 启动应用动作未定义 appName 参数`);
            }
            break;
        }
        case 'skip':
        default: {
            logToScreen(`...主动作类型为 [${action.type}] 或未知，跳过主动作。`);
            break;
        }
    }

    if (action.sequenceName) {
        const sequenceToExecute = sequences[action.sequenceName];
        if (sequenceToExecute) {
            logToScreen(`...主动作完成后，开始执行后续序列: "${sequenceToExecute.name || action.sequenceName}"`);
            executeSequence(sequenceToExecute.tasks, `子序列 (${sequenceToExecute.name})`, 'monitor');
        } else {
            logErrorToScreen(`...错误! 在配置中找不到名为 "${action.sequenceName}" 的后续序列。`);
        }
    } else {
        logToScreen(`...无后续序列，动作执行完毕。`);
    }
}
/**
 * (新函数)
 * 当监控触发器 "未找到" 目标时，执行 onFail 动作
 * @param {object} trigger - 触发器对象
 */
function executeMonitorFailAction(trigger) {
    if (!trigger.onFail) return;
    const failAction = trigger.onFail;
    const triggerName = trigger.target || '未知触发器';

    logToScreen(`监控未命中: [${triggerName}] 未找到, 执行 onFail 动作 [${failAction.action}]...`);

    if (failAction.delayMs > 0) {
        logToScreen(`动作延迟 ${failAction.delayMs}ms...`);
        sleep(failAction.delayMs);
    }

    switch (failAction.action) {
        case 'back':
            back();
            sleep(appSettings.clickDelayMs);
            break;
        case 'launch_app':
            if (failAction.appName) {
                app.launchApp(failAction.appName);
                sleep(appSettings.clickDelayMs);
            }
            break;
        case 'execute_sequence':
            if (failAction.sequenceName) {
                const sequenceToExecute = sequences[failAction.sequenceName];
                if (sequenceToExecute) {
                    executeSequence(sequenceToExecute.tasks, `子序列 (${sequenceToExecute.name})`, 'monitor');
                } else {
                    logErrorToScreen(`...错误! 找不到名为 "${failAction.sequenceName}" 的 onFail 序列。`);
                }
            }
            break;
        case 'skip':
        default:
            // Do nothing
            break;
    }
}
function makeId(t) {
  return ((t && t.type) ? t.type : "image") + "::" + ((t && t.target) ? t.target : "");
}

function deepClone(o) {
  try { return JSON.parse(JSON.stringify(o)); } catch (_) { return Object.assign({}, o); }
}

function rotateArray(arr, start) {
  if (!arr || arr.length === 0) return arr;
  var s = Math.max(0, Math.min(start || 0, arr.length - 1));
  if (s === 0) return arr.slice();
  var head = arr.slice(s);
  var tail = arr.slice(0, s);
  return head.concat(tail);
}


function runSingleMonitorThread(sequence, sequenceKey) {
    let monitorThreadId = "monitor_" + sequenceKey + "_" + new Date().getTime();

    let monitorThread = threads.start(function () {
        logToScreen(`监控序列 [${sequence.name}] 线程已启动 (ID: ${monitorThreadId})。`);

        let warmedUp = false;
        for (let i = 0; i < 3; i++) {
            let img = captureScreen();
            if (img) {
                img.recycle();
                warmedUp = true;
                break;
            }
            sleep(500);
        }
        if (!warmedUp) {
            logErrorToScreen("⚠️ 截图预热失败，可能导致首次触发器失效！");
        }

        sleep(1000);
        if (threads.currentThread().isInterrupted()) return;

        //const localTriggers = sequence.triggers || [];
        let __triggersSig = __stableHash(sequence.triggers || []);

        const interval = sequence.executionPolicy.interval || 1000;
        let triggerCooldowns = {};

        while (!threads.currentThread().isInterrupted()) {
            // 每轮首行确保 PQ 与触发器集合一致并打印（调试用）
            try {
                // 清理 PQ 中已不存在的 ID（保持一致性）
                try { cleanupPriorityQueue(sequence); } catch (e) { }

                // Debug 打印当前 PQ 与版本号
                if (typeof __PQ_DEBUG !== 'undefined' && __PQ_DEBUG) {
                    try {
                        logToScreen('[Watcher-Start] pq=' + JSON.stringify(sequence.priorityQueue || []).slice(0, 200) + ' ver=' + (sequence.__priorityVersion || 0));
                    } catch (e) { }
                }
            } catch (e) { }

            const __curSig = __stableHash(sequence.triggers || []);
            if (__curSig !== __triggersSig) {
                __triggersSig = __curSig;
                try { cleanupPriorityQueue(sequence); } catch (e) { }
                try {
                    const liveIds = new Set(((sequence.triggers || [])).map(getTriggerId));
                    Object.keys(triggerCooldowns || {}).forEach(k => { if (!liveIds.has(k)) delete triggerCooldowns[k]; });
                } catch (e) { }
                try { logToScreen('🔄 触发器集合已变更，已热更新。'); } catch (e) { }
            }
            // 在 while 循环最开始（或在你已有的热更新检测之后）合入：
            try {
                // 尝试读取 quick-persist 的 PQ，如果是新的就合并到内存
                var __pqObj = tryLoadPriorityQueueQuickIfNewer(sequence);
                if (__pqObj && Array.isArray(__pqObj.priorityQueue)) {
                    // 合并策略：采用 quick 文件的优先队列为准（但只替换 priorityQueue 字段，不替换整个 sequence）
                    try {
                        const old = sequence.priorityQueue || [];
                        sequence.priorityQueue = __pqObj.priorityQueue.slice();
                        // bump 内存版本号，便于其他检测看到变化
                        sequence.__priorityVersion = (sequence.__priorityVersion || 0) + 1;
                        logToScreen(`[PQ merge] loaded quick PQ (len=${sequence.priorityQueue.length}) ts=${__pqObj.ts}`);
                    } catch (e) {
                        try { logErrorToScreen("[PQ merge err] " + e); } catch (e) { }
                    }
                }
            } catch (e) { }

            // 每轮取一次快照
            const localTriggers = Array.isArray(sequence.triggers) ? sequence.triggers.slice() : [];
            try {
                let triggerFiredInCycle = false;
                let capturedImage = null;
                for (let retry = 0; retry < 3; retry++) {
                    capturedImage = captureScreen();
                    if (capturedImage) break;
                    sleep(300);
                }
                if (!capturedImage) {
                    logErrorToScreen(`[${sequence.name}] 连续截图失败，跳过本轮。`);
                    if (!sequence._failCount) sequence._failCount = 0;
                    sequence._failCount++;
                    if (sequence._failCount >= 5) {
                        logErrorToScreen(`[${sequence.name}] 截图服务可能异常，请重启脚本。`);
                        stopMonitoring("截图服务异常");
                        return;
                    }
                    sleep(interval);
                    continue;
                } else {
                    sequence._failCount = 0;
                }

                // 3) watcher 循环里：排序后打印 priorityQueue 与 ordered（放在每轮 reorder 之后）
                // 【核心修复】直接使用 reorderByPriority 的结果。
                // 它已经完美处理了 "🔥 置顶优先" 和 "PQ 动态排序" 的混合逻辑。
                // 我们不再需要旧版的 mismatch/rebuild 逻辑，因为它会强制覆盖掉置顶效果。
                
                var ordered_final = reorderByPriority(sequence, localTriggers);

                // debug print (可选，保留用于调试)
                try {
                    if (typeof __PQ_DEBUG !== 'undefined' && __PQ_DEBUG) {
                        // 打印前几个触发器的名字，看看置顶是否生效
                        var debugNames = ordered_final.slice(0, 5).map(t => (t.isTopPriority ? "🔥" : "") + (t.name || t.target || "unnamed"));
                        logToScreen(`[Watcher] Final Order: ${debugNames.join(', ')}`);
                    }
                } catch (e) { }

                // debug print
                try {
                    if (typeof __PQ_DEBUG !== 'undefined' && __PQ_DEBUG) {
                        logToScreen(`[Watcher] pq=${JSON.stringify((sequence.priorityQueue || []).slice(0, 10))} ordered=${ordered_final.slice(0, 6).map(t => (t.name || t.target || getTriggerId(t))).join(',')} ver=${sequence.__priorityVersion || 0}`);
                    }
                } catch (e) { }

                ordered_final.forEach(function (trigger) {
                    if (trigger.enabled === false) return; // 关键：跳过已禁用的触发器
                    if (triggerFiredInCycle || threads.currentThread().isInterrupted()) return;

                    const triggerId = getTriggerId(trigger);
                    const cooldownEndTime = triggerCooldowns[triggerId];

                    // 【核心修复】在检查的“当下”获取最新时间
                    const realNowTime = new Date().getTime();

                    // 1. 检查是否正在冷却
                    if (cooldownEndTime && realNowTime < cooldownEndTime) {

                        // 【新的调试日志】
                        const remainingMs = cooldownEndTime - realNowTime;
                        logToScreen(`[Debug Cooldown] [${triggerId}] 冷却中... 剩余: ${remainingMs} ms`);

                        return; // 仍在冷却中，跳过
                    }

                    // 2. （可选）如果冷却时间刚结束
                    if (cooldownEndTime && realNowTime >= cooldownEndTime) {
                        logToScreen(`[Debug Cooldown] [${triggerId}] 冷却结束。`);
                        delete triggerCooldowns[triggerId]; // 清理旧时间
                    }

                    let foundLocation = null;

                    if (trigger.type === 'image') {
                        let template = null;
                        try {
                            let imagePath = files.join(CONSTANTS.FILES.IMAGE_DIR, trigger.target);
                            if (files.exists(imagePath)) {
                                template = images.read(imagePath);
                                if (template) {
                                    let p = null;
                                    // --- 关键修改: 启用缓存并使用 padding 变量 ---
                                    if (trigger.cachedBounds) { // <-- 1. 修复: 移除了 'false &&'
                                        let b = trigger.cachedBounds;
                                        let padding = (trigger.cachePadding !== undefined) ? trigger.cachePadding : (appSettings.defaultCachePadding || 50);
                                        let region = calculatePaddedRegion(b, padding);
                                        p = images.findImage(capturedImage, template, { region: region, threshold: trigger.threshold || 0.8 });
                                        if (!p) {
                                            toast(`...[${trigger.target}] 缓存未命中，将执行全屏扫描。`);
                                        }
                                    }
                                    // --- 修改结束 ---
                                    if (!p) {
                                        let findOptions = { threshold: trigger.threshold || 0.8 };
                                        if (trigger.search_area && trigger.search_area.length === 4) {
                                            // --- 核心修复：使用 calculatePaddedRegion 来限制 search_area ---
                                            let [x1, y1, x2, y2] = trigger.search_area;
                                            let searchBounds = { left: x1, top: y1, right: x2, bottom: y2 };
                                            findOptions.region = calculatePaddedRegion(searchBounds, 0); // 0 padding
                                            // --- 修复结束 ---
                                        }
                                        p = images.findImage(capturedImage, template, findOptions);
                                        if (p) {
                                            trigger.cachedBounds = { x: p.x, y: p.y, width: template.getWidth(), height: template.getHeight() };
                                            saveCurrentProfileThrottled();
                                        }
                                    }
                                    if (p) {
                                        foundLocation = { x: p.x, y: p.y, width: template.getWidth(), height: template.getHeight() };
                                    }
                                }
                            }
                        } finally {
                            if (template) template.recycle();
                        }
                    } else if (trigger.type === 'ocr') {
                        let ocrTarget = null;
                        // --- 关键修改: 为 OCR 应用 padding 变量 ---
                        if (trigger.cachedBounds) {
                            let b = trigger.cachedBounds;
                            // 1. 修复: 为 OCR 也应用 cachePadding 变量
                            let padding = (trigger.cachePadding !== undefined) ? trigger.cachePadding : (appSettings.defaultCachePadding || 50);
                            let cacheRegion = calculatePaddedRegion(b, padding);
                            let ocrResults = ocr.paddle.detect(capturedImage, { region: cacheRegion, useSlim: true });
                            ocrTarget = ocrResults.find(r => r.label.includes(trigger.target));
                            if (!ocrTarget) {
                                logToScreen(`...缓存未命中，将执行全屏扫描。`);
                            }
                        }
                        // --- 修改结束 ---
                        if (!ocrTarget) {
                            let ocrOptions = { useSlim: true };
                            if (trigger.search_area && trigger.search_area.length === 4) {
                                // --- 核心修复：使用 calculatePaddedRegion 来限制 search_area ---
                                let [x1, y1, x2, y2] = trigger.search_area;
                                let searchBounds = { left: x1, top: y1, right: x2, bottom: y2 };
                                ocrOptions.region = calculatePaddedRegion(searchBounds, 0); // 0 padding
                                // --- 修复结束 ---
                            }
                            let ocrResults = ocr.paddle.detect(capturedImage, ocrOptions);
                            ocrTarget = ocrResults.find(r => r.label.includes(trigger.target));
                            if (ocrTarget) {
                                let b = ocrTarget.bounds;
                                trigger.cachedBounds = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
                                saveCurrentProfileThrottled();
                            }
                        }
                        if (ocrTarget) {
                            let b = ocrTarget.bounds;
                            foundLocation = { x: b.left, y: b.top, width: b.width(), height: b.height() };
                        }
                    // 【修复 3b】: 添加 timer_end 触发器的检查逻辑
                    } else if (trigger.type === 'timer_end') {
                        const timerName = trigger.target;
                        // (使用 realNowTime 检查)
                        if (appState.timers[timerName] && realNowTime > appState.timers[timerName]) {
                            logToScreen(`...计时器 [${timerName}] 已到期，触发动作。`);
                            foundLocation = { x: 0, y: 0, width: 0, height: 0 }; 
                            delete appState.timers[timerName]; // 删除计时器防止重复触发
                        }
                    }

                    if (foundLocation) {
                        // --- 目标找到 (onSuccess) ---
                        executeTriggerAction(trigger, foundLocation);
                        triggerFiredInCycle = true;
                        // 优先队列：命中后前置
                        bumpTriggerPriority(sequence, trigger);
                        if (trigger.cooldownMs > 0) {
                            triggerCooldowns[triggerId] = new Date().getTime() + trigger.cooldownMs;
                        }
                    } else {
                        // --- 目标未找到 (onFail) [新逻辑] ---
                        if (trigger.onFail && trigger.onFail.action && trigger.onFail.action !== 'skip') {
                            // 执行 onFail 动作
                            executeMonitorFailAction(trigger);
                            // 标记为已触发，这样“默认任务”就不会运行了
                            triggerFiredInCycle = true;
                        }
                        // --- onFail 逻辑结束 ---
                    }
                });

                capturedImage.recycle();

                if (!triggerFiredInCycle && sequence.tasks && sequence.tasks.length > 0) {
                    logToScreen(`[${sequence.name}] 未触发任何条件，执行序列内任务...`);
                    executeSequence(sequence.tasks, `监控序列 (${sequence.name}) 的未命中任务`, 'monitor');
                }
                if (new Date().getTime() % 30000 < interval) {
                    try {
                        //images.gc();
                        java.lang.System.gc();
                        logToScreen("🧹 已执行内存清理");
                    } catch (e) {
                        logErrorToScreen("内存清理失败: " + e);
                    }
                }

            } catch (e) {
                if (e instanceof java.lang.InterruptedException) break;
                logErrorToScreen(`监控线程 [${sequence.name}] 出现严重错误: ${e}`);
            }
            sleep(interval);
        }
        logToScreen(`监控序列 [${sequence.name}] 线程已优雅地停止。`);
    });

    appState.threads[monitorThreadId] = monitorThread;
    appState.activeMonitors[sequenceKey] = monitorThreadId;

}

/**
 * (已修正 - V2)
 * 切换主监控（👁️）或停止所有正在运行的监控（🛑）。
 */
function toggleMonitoring() {
    if (isBusy()) return;

    // --- 核心修复：检查 *任何* 监控是否在运行 ---
    // (包括主监控 'isMonitoring' 或 动态监控 'activeMonitors')
    const isAnyMonitorRunning = appState.isMonitoring || Object.keys(appState.activeMonitors).length > 0;

    if (isAnyMonitorRunning) {
        // 如果任何监控在运行，点击 🛑 按钮时，调用 stopMonitoring
        stopMonitoring("已手动停止所有监控");
        return;
    }
    // --- 修复结束 ---


    // (如果代码运行到这里，说明没有监控在运行，用户点击的是 👁️)
    const mainMonitorKey = appSettings.mainMonitorKey;
    const mainMonitor = mainMonitorKey ? sequences[mainMonitorKey] : null;

    if (!mainMonitor) {
        toast("没有可执行的主监控。请在序列管理器中长按一个监控来设置。");
        return;
    }

    // 标记“主监控”已启动
    appState.isMonitoring = true; 
    appState.timers = {}; // Reset timers on global monitor start

    runSingleMonitorThread(mainMonitor, mainMonitorKey);

    updateMonitorStatusUI();
}


function stopMonitoring(message) {
    if (!appState.isMonitoring && Object.keys(appState.activeMonitors).length === 0) return;

    appState.isMonitoring = false;
    appState.timers = {}; // Clear all timers on global monitor stop

    for (let threadId in appState.threads) {
        if (threadId.startsWith("monitor_")) {
            const thread = appState.threads[threadId];
            if (thread && thread.isAlive()) {
                thread.interrupt();
            }
        }
    }

    appState.threads = Object.fromEntries(Object.entries(appState.threads).filter(([key, value]) => !key.startsWith("monitor_")));
    appState.activeMonitors = {};

    toast(message);
    logToScreen(message);
    updateMonitorStatusUI();
}


function updateControlButtonText(text, state) {
    if (uiRefs.controlPanel && uiRefs.controlPanel.executeBtn) {
        ui.run(() => {
            if (uiRefs.controlPanel && uiRefs.controlPanel.executeBtn) {
                uiRefs.controlPanel.executeBtn.setText(text);
            }
        });
    }
}

// =================================================================================
// UI & 浮窗管理 (UI & Floaty Management)
// =================================================================================
function checkPermissions() {
    if (!auto.service) {
        toast("请先开启无障碍服务，然后重试。");
        app.startActivity({ packageName: "com.android.settings", className: "com.android.settings.Settings$AccessibilitySettingsActivity" });
        return false;
    }
    if (!floaty.hasPermission()) {
        toast("请授予悬浮窗权限后，再启动应用！");
        floaty.requestPermission();
        return false;
    }
    if (!requestScreenCapture()) {
        toast("请求截图权限失败，OCR和找图功能将不可用！");
        return false;
    }
    //auto.waitFor(); 避免启动悬浮窗口点击取消崩盘
    return true;
}
function createTargetView() {
    uiRefs.targetView = floaty.rawWindow(<frame id="root"><text id="label" text="🌟" textSize="24sp" bg="#00000000" gravity="center" /></frame>);
    try {
        uiRefs.targetView.root.setBackgroundColor(android.graphics.Color.parseColor(appSettings.theme.targetViewColor));
    } catch (e) {
        logErrorToScreen("目标视图颜色格式错误，使用默认色");
        uiRefs.targetView.root.setBackgroundColor(android.graphics.Color.parseColor(DEFAULT_SETTINGS.theme.targetViewColor));
    }
    uiRefs.targetView.setSize(appSettings.targetViewSize, appSettings.targetViewSize);
    uiRefs.targetView.setPosition(appSettings.mainTargetPos.x, appSettings.mainTargetPos.y);
    ui.run(() => {
        setupDraggable(uiRefs.targetView,
            (x, y) => { appSettings.mainTargetPos = { x, y }; saveCurrentProfileThrottled(); syncRedDotPosition(); },
            syncRedDotPosition,
            null, null, uiRefs.targetView.label
        );
    });
}
function createRedDot() {
    uiRefs.redDot = floaty.rawWindow(<frame><vertical><view bg="#FFFF0000" w="30" h="30" style="border-radius:15px;" /><text text="点击点" textSize="10sp" textColor="#FFFFFF" gravity="center" /></vertical></frame>);
    uiRefs.redDot.setTouchable(false);
    uiRefs.redDot.setSize(30, -2);
}
function createControlPanel() {
    // 1. 定义悬浮窗布局 (回归最稳健的单文本模式)
    uiRefs.controlPanel = floaty.rawWindow(
        <card id="mainLayout" bg="{{CONSTANTS.UI.THEME.PRIMARY_CARD}}" cardCornerRadius="12dp" cardElevation="8dp">
            <vertical>
                
                <vertical id="headerContainer" padding="4">
                    
                    {/* --- 第 1 行: 方案名称 --- */}
                    <horizontal gravity="center_vertical" w="*">
                        <horizontal layout_weight="1" gravity="left|center_vertical" marginLeft="4">
                            <text id="monitorStatusIcon" text="👁️" textSize="12sp" textColor="{{CONSTANTS.UI.THEME.ACTIVE_TAB_COLOR}}" visibility="gone" marginRight="4" />
                            <text id="profileNameText" textSize="12sp" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" singleLine="true" ellipsize="end" />
                        </horizontal>
                        <text id="positionText" textSize="10sp" textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}" singleLine="true" />
                    </horizontal>
                    
                    {/* --- 第 2 行: 状态 (轮播) 和 时间 --- */}
                    <horizontal gravity="center_vertical" w="*" marginTop="2">
                        
                        {/* 状态文本：单行，末尾省略，占据剩余空间 */}
                        <text id="statusText" text="准备就绪" textSize="10sp" textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}" 
                              singleLine="true" ellipsize="end"
                              layout_weight="1" w="0dp" marginLeft="4" />

                        {/* 时间 */}
                        <text id="systemTimeText" text="--:--:--" textSize="10sp" textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}" singleLine="true" marginRight="4" marginLeft="4"/>
                    </horizontal>

                </vertical>

                <View w="*" h="1dp" bg="{{CONSTANTS.UI.THEME.SECONDARY_CARD}}" />

                <vertical id="buttonsContainer" padding="0 4 4 4">
                    <horizontal gravity="center">
                        <button id="executeBtn" text="▶️" layout_weight="1" style="Widget.AppCompat.Button.Borderless" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" textSize="20sp" minWidth="0" padding="0" />
                        <View w="1dp" h="*" bg="{{CONSTANTS.UI.THEME.SECONDARY_CARD}}" />
                        <button id="monitorBtn" text="👁️" layout_weight="1" style="Widget.AppCompat.Button.Borderless" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" textSize="20sp" minWidth="0" padding="0" />
                        <View w="1dp" h="*" bg="{{CONSTANTS.UI.THEME.SECONDARY_CARD}}" />
                        <button id="addTaskBtn" text="✏️" layout_weight="1" style="Widget.AppCompat.Button.Borderless" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" textSize="20sp" minWidth="0" padding="0" />
                        <View w="1dp" h="*" bg="{{CONSTANTS.UI.THEME.SECONDARY_CARD}}" />
                        <button id="manageBtn" text="⚙️" layout_weight="1" style="Widget.AppCompat.Button.Borderless" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" textSize="20sp" minWidth="0" padding="0" />
                    </horizontal>
                </vertical>

            </vertical>
        </card>
    );

    uiRefs.controlPanel.setSize(appSettings.panelWidth, -2);
    uiRefs.controlPanel.setPosition(appSettings.controlPanelPos.x, appSettings.controlPanelPos.y);

    ui.post(() => {
        if (!uiRefs.controlPanel) return;
        
        // 拖动句柄安全绑定
        let safeHandle = uiRefs.controlPanel.headerContainer;
        if (!safeHandle) safeHandle = uiRefs.controlPanel.mainLayout; 

        if (safeHandle) {
            setupDraggable(
                uiRefs.controlPanel,
                (x, y) => { appSettings.controlPanelPos = { x, y }; saveCurrentProfileThrottled(); },
                updatePositionDisplay,
                null,
                toggleControlButtonsVisibility,
                safeHandle
            );
        }

        if (uiRefs.controlPanel.executeBtn) uiRefs.controlPanel.executeBtn.click(toggleSequenceExecution);
        if (uiRefs.controlPanel.monitorBtn) uiRefs.controlPanel.monitorBtn.click(toggleMonitoring);
        if (uiRefs.controlPanel.addTaskBtn) uiRefs.controlPanel.addTaskBtn.click(showProfileManager);
        
        if (uiRefs.controlPanel.manageBtn) {
            let manageClickCount = 0;
            let manageClickTimer = null;
            const doubleClickDelay = 300; 
            
            uiRefs.controlPanel.manageBtn.click(() => {
                manageClickCount++; 
                if (manageClickTimer) { clearTimeout(manageClickTimer); }
                manageClickTimer = setTimeout(() => {
                    if (manageClickCount === 1) {
                        logToScreen("正在打开主编辑器...");
                        app.launch(context.getPackageName());
                        setTimeout(() => {
                            ui.run(() => {
                                switchView(ui.sequenceEditorView);
                                if (ui.sequenceEditorView.getChildCount() === 0) {
                                    logToScreen("初始化序列编辑器...");
                                    renderSequenceListEditor();
                                }
                            });
                        }, 500); 
                    } else if (manageClickCount >= 2) {
                        activity.moveTaskToBack(true);
                        toast("主窗口已隐藏");
                    }
                    manageClickCount = 0;
                    manageClickTimer = null;
                }, doubleClickDelay);
            });
        }
    });

    // --- 核心逻辑：状态轮播定时器 ---
    
    if (appState.ui.systemTimeTimer) {
        clearInterval(appState.ui.systemTimeTimer);
    }
    
    let tickCount = 0;

    appState.ui.systemTimeTimer = setInterval(() => {
        if (uiRefs.controlPanel && uiRefs.controlPanel.systemTimeText && uiRefs.controlPanel.statusText) {
            
            tickCount++;
            
            // 1. 时钟
            let now = new Date();
            let h = now.getHours();
            let m = String(now.getMinutes()).padStart(2, '0');
            let s = String(now.getSeconds()).padStart(2, '0');
            
            // 2. 状态文本逻辑
            let statusStr = "";

            // 优先级 1: 倒计时 (忙碌)
            if (appState.currentWaitTask && appState.currentWaitTask.remaining > 0) {
                let remainingSeconds = Math.round(appState.currentWaitTask.remaining / 1000);
                statusStr = `⏳ 等待: ${remainingSeconds}s`;
            } 
            // 优先级 2: 序列运行中 (忙碌)
            else if (appState.isExecuting && appSettings.mainSequenceKey) {
                let name = (sequences[appSettings.mainSequenceKey] || {}).name || appSettings.mainSequenceKey || '序列运行中';
                statusStr = `▶️ ${name}`;
            } 
            // 优先级 3: 监控运行中 (忙碌 - 只有监控在跑)
            else if (appState.isMonitoring || Object.keys(appState.activeMonitors).length > 0) {
                let key = appSettings.mainMonitorKey;
                if (!appState.isMonitoring) { key = Object.keys(appState.activeMonitors)[0] || key; }
                let name = key ? ((sequences[key] || {}).name || key) : '监控中';
                statusStr = `👁️ ${name}`;
            }
            // 优先级 4: 空闲 (轮播显示)
            else { 
                const mainSeqKey = appSettings.mainSequenceKey;
                const mainMonKey = appSettings.mainMonitorKey;
                let seqName = (mainSeqKey && sequences[mainSeqKey]) ? (sequences[mainSeqKey].name || mainSeqKey) : '无';
                let monName = (mainMonKey && sequences[mainMonKey]) ? (sequences[mainMonKey].name || mainMonKey) : '无';
                
                // 轮播逻辑：6秒一个周期
                // 0, 1, 2秒 -> 显示主序列
                // 3, 4, 5秒 -> 显示主监控
                if ((tickCount % 6) < 3) {
                    statusStr = `⭐ ${seqName}`;
                } else {
                    statusStr = `🧿 ${monName}`;
                }
            }

            // 3. 更新 UI
            ui.run(() => {
                if (!uiRefs.controlPanel) return;
                
                if (uiRefs.controlPanel.systemTimeText) {
                    uiRefs.controlPanel.systemTimeText.setText(`${h}:${m}:${s}`);
                }
                
                if (uiRefs.controlPanel.statusText) {
                    uiRefs.controlPanel.statusText.setText(statusStr);
                }
            });

        } else {
            if (appState.ui.systemTimeTimer) {
                clearInterval(appState.ui.systemTimeTimer);
                appState.ui.systemTimeTimer = null;
            }
        }
    }, 1000); // 1秒刷新一次

    applyButtonVisibility();
}

function updateMonitorStatusUI() {
    if (!uiRefs.controlPanel || !uiRefs.controlPanel.monitorBtn) return;
    ui.run(() => {
        if (!uiRefs.controlPanel || !uiRefs.controlPanel.monitorBtn) return;
        const isAnyMonitorRunning = appState.isMonitoring || Object.keys(appState.activeMonitors).length > 0;
        if (isAnyMonitorRunning) {
            uiRefs.controlPanel.monitorBtn.setText("🛑");
            uiRefs.controlPanel.monitorStatusIcon.setVisibility(0); // VISIBLE
        } else {
            uiRefs.controlPanel.monitorBtn.setText("👁️");
            uiRefs.controlPanel.monitorStatusIcon.setVisibility(8); // GONE
        }
    });
}

function createTaskWindow(task, sequence) {
    let win = floaty.rawWindow(<frame id="root" padding="5"><text id="label" textSize="18sp" textColor="#FFFFFF" gravity="center" /></frame>);
    let color;
    try { color = android.graphics.Color.parseColor(appSettings.theme.taskClickColor); } catch (e) { color = android.graphics.Color.parseColor(DEFAULT_SETTINGS.theme.taskClickColor); }
    win.root.setBackgroundColor(color);
    win.setSize(CONSTANTS.UI.TASK_CLICK_VISUAL_SIZE, -2);
    ui.post(() => win.setPosition(task.x - win.getWidth() / 2, task.y - win.getHeight() / 2));

    let displayIndex = sequence.tasks.indexOf(task);
    ui.run(() => win.label.setText(`🎯${displayIndex + 1}`));

    setupDraggable(win, (x, y) => {
        task.x = x + win.getWidth() / 2;
        task.y = y + win.getHeight() / 2;
        saveCurrentProfileThrottled();
        toast(`任务 ${displayIndex + 1} 位置已更新`);
    }, null, null, () => showTaskEditor(task, sequence.tasks, sequences[appSettings.mainSequenceKey]), win.root);

    uiRefs.taskVisuals.push({ type: 'click', window: win, originalBg: appSettings.theme.taskClickColor });
}
function createSwipeVisuals(task, sequence) {
    const visual = { type: 'swipe', startWindow: null, endWindow: null, originalBg: appSettings.theme.taskSwipeColor };
    let displayIndex = sequence.tasks.indexOf(task);

    function createMarker(text, x, y, onClickCallback) {
        let win = floaty.rawWindow(<frame id="root" w="40" h="40" style="border-radius:20px;"><text text={text} gravity="center" textColor="#FFFFFF" textSize="16sp" textStyle="bold" /></frame>);
        let color;
        try { color = android.graphics.Color.parseColor(visual.originalBg); } catch (e) { color = android.graphics.Color.parseColor(DEFAULT_SETTINGS.theme.taskSwipeColor); }
        win.root.setBackgroundColor(color);
        win.setSize(CONSTANTS.UI.TASK_SWIPE_VISUAL_SIZE, CONSTANTS.UI.TASK_SWIPE_VISUAL_SIZE);
        ui.post(() => win.setPosition(x - win.getWidth() / 2, y - win.getHeight() / 2));
        setupDraggable(win, (newX, newY) => {
            if (text.startsWith("S")) {
                task.startX = newX + win.getWidth() / 2;
                task.startY = newY + win.getHeight() / 2;
            } else {
                task.endX = newX + win.getWidth() / 2;
                task.endY = newY + win.getHeight() / 2;
            }
            saveCurrentProfileThrottled();
        }, null, null, onClickCallback, win.root);
        return win;
    }
    const onClick = () => showTaskEditor(task, sequence.tasks, sequences[appSettings.mainSequenceKey]);
    visual.startWindow = createMarker(`S${displayIndex + 1}`, task.startX, task.startY, onClick);
    visual.endWindow = createMarker(`E${displayIndex + 1}`, task.endX, task.endY, onClick);
    uiRefs.taskVisuals.push(visual);
}
function recreateAllTaskVisuals() {
    // 1. 始终先运行在 UI 线程，确保界面操作安全
    ui.run(() => {
        // 2. 先关闭旧的浮窗
        closeTaskVisuals();

        // 3. 检查总开关 (默认为 false/显示)
        // 注意：这里要做严格的检查，防止 undefined 导致意外
        const isHidden = appSettings.taskVisualsHidden === true;

        if (isHidden) {
            // 【A】开关为 "隐藏" -> 关闭所有相关浮窗
            if (uiRefs.targetView) {
                uiRefs.targetView.close();
                uiRefs.targetView = null;
            }
            if (uiRefs.redDot) {
                uiRefs.redDot.close();
                uiRefs.redDot = null;
            }
            return; // 结束
        }

        // --- 【B】开关为 "显示" -> 创建浮窗 ---

        // 1. 确保 🌟 目标视图存在
        if (!uiRefs.targetView) {
            createTargetView();
        }

        // 2. 确保 🔴 红点存在
        if (!uiRefs.redDot) {
            createRedDot();
        }
        
        // 延迟同步红点位置，确保布局已完成
        setTimeout(syncRedDotPosition, 50);

        // 3. 创建任务序号浮窗 (🎯)
        const mainSequenceKey = appSettings.mainSequenceKey;
        const mainSequence = mainSequenceKey ? sequences[mainSequenceKey] : null;

        if (mainSequence && mainSequence.tasks && mainSequence.tasks.length > 0) {
            mainSequence.tasks.forEach((task) => {
                // 仅为启用的任务显示浮窗 (可选，这里先全部显示方便调试)
                if (task.type === 'click') {
                    createTaskWindow(task, mainSequence);
                } else if (task.type === 'swipe') {
                    createSwipeVisuals(task, mainSequence);
                }
            });
        }
    });
}
function highlightTaskVisual(index) {
    // This function needs to be adapted if we want to highlight tasks from different sequences
    // For now, it's disabled to avoid complexity.
}

// =================================================================================
// 任务管理 & 设置 (Management & Settings)
// =================================================================================
function addNewTask(task, targetSequence) {
    if (!targetSequence.tasks) {
        targetSequence.tasks = [];
    }
    targetSequence.tasks.push(task);
    saveCurrentProfileThrottled();
    logToScreen(`已添加新任务: ${task.name}`);
    toast(`已添加: ${task.name}`);
    return task;
}

function showAddTaskToMainDialog() {
    if (isBusy()) return;

    const mainSequenceKey = appSettings.mainSequenceKey;
    const mainSequence = mainSequenceKey ? sequences[mainSequenceKey] : null;

    if (!mainSequence) {
        toast("错误: 未找到主执行序列。请在管理器中长按一个序列来设置。");
        return;
    }

    // A. 定义XML布局
    const view = ui.inflate(
        <vertical>
            {/* 总开关：控制所有浮窗的显示/隐藏 */}
            <horizontal padding="16 8" gravity="center_vertical">
                <text text="显示任务浮窗 (🎯, S, E)" textSize="16sp" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" layout_weight="1"/>
                <Switch id="toggleVisuals" />
            </horizontal>

            <View w="*" h="1dp" bg="{{CONSTANTS.UI.THEME.SECONDARY_CARD}}" />

            <text text="请选择要添加的任务类型:" padding="16 12 16 0" textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}" />

            {/* 任务列表 */}
            <ScrollView h="300dp">
                <vertical id="taskListContainer" />
            </ScrollView>
        </vertical>, null, false
    );

    const dialog = dialogs.build({
        customView: view,
        title: "添加步骤 & 设置",
        negative: "关闭"
    }).show();

    // B. 设置 Switch 逻辑
    // 逻辑：Checked(开) = 显示(Hidden=false) ; Unchecked(关) = 隐藏(Hidden=true)
    const isCurrentlyShown = appSettings.taskVisualsHidden !== true; 
    view.toggleVisuals.setChecked(isCurrentlyShown);

    view.toggleVisuals.setOnCheckedChangeListener((btn, isChecked) => {
        // 更新设置
        appSettings.taskVisualsHidden = !isChecked; 
        saveCurrentProfileThrottled(); 

        // 立即刷新界面
        recreateAllTaskVisuals();

        if (isChecked) {
            toast("浮窗已开启 (🌟, 🎯)");
        } else {
            toast("浮窗已隐藏");
        }
    });

    // C. 填充任务列表 (保持原有逻辑)
    const taskTypes = [
        "[点击] 任务",
        "[滑动] 任务",
        "[等待] 任务",
        "[等待消失] 任务",
        "[计时器] 任务",
        "[识别] 文本任务",
        "[图像] 找图任务",
        "[返回] 操作",
        "[应用] 启动/切换App",
        "[调用] 其他序列",
        "[监控] 启动一个监控",
        "[监控] 停止一个监控"
    ];

    const actions = [
        (cb) => addClickTask(mainSequence, cb),
        (cb) => addSwipeTask(mainSequence, cb),
        (cb) => addWaitTask(mainSequence, cb),
        (cb) => addWaitForDissapearTask(mainSequence, cb),
        (cb) => addTimerTask(mainSequence, cb),
        (cb) => addOcrTask(mainSequence, cb),
        (cb) => addImageTask(mainSequence, cb),
        (cb) => addBackTask(mainSequence, cb),
        (cb) => addLaunchAppTask(mainSequence, cb),
        (cb) => addExecuteSequenceTask(mainSequence, mainSequenceKey, cb),
        (cb) => addStartMonitorTask(mainSequence, cb),
        (cb) => addStopMonitorTask(mainSequence, cb)
    ];

    taskTypes.forEach((taskName, index) => {
        const itemView = ui.inflate(
            <card w="*" margin="8 4" cardCornerRadius="8dp" cardElevation="2dp" bg="{{CONSTANTS.UI.THEME.SECONDARY_CARD}}">
                <text id="task_name_label" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" padding="16 12" bg="?attr/selectableItemBackground" />
            </card>,
            view.taskListContainer, false
        );

        itemView.task_name_label.setText(taskName);

        itemView.click(() => {
            if (actions[index]) {
                actions[index](() => {
                    // 添加完任务后，强制刷新一次浮窗，确保新任务的 🎯 出现
                    recreateAllTaskVisuals();
                });
            }
            dialog.dismiss();
        });

        view.taskListContainer.addView(itemView);
    });
}

function showAddTaskDialog(targetSequence, targetSequenceKey, onComplete) {
    if (isBusy()) return;

    dialogs.select("请选择要添加的任务类型", [
        "[点击] 任务",
        "[滑动] 任务",
        "[等待] 任务",
        "[等待消失] 任务",
        "[计时器] 任务",
        "[识别] 文本任务",
        "[图像] 找图任务",
        "[返回] 操作",
        "[应用] 启动/切换App",
        "[调用] 其他序列",
        "[监控] 启动一个监控",
        "[监控] 停止一个监控"
    ]).then(i => {
        if (i < 0) {
            if (onComplete) onComplete();
            return;
        }
        const actions = [
            (cb) => addClickTask(targetSequence, cb),
            (cb) => addSwipeTask(targetSequence, cb),
            (cb) => addWaitTask(targetSequence, cb),
            (cb) => addWaitForDissapearTask(targetSequence, cb),
            (cb) => addTimerTask(targetSequence, cb),
            (cb) => addOcrTask(targetSequence, cb),
            (cb) => addImageTask(targetSequence, cb),
            (cb) => addBackTask(targetSequence, cb),
            (cb) => addLaunchAppTask(targetSequence, cb),
            (cb) => addExecuteSequenceTask(targetSequence, targetSequenceKey, cb),
            (cb) => addStartMonitorTask(targetSequence, cb),
            (cb) => addStopMonitorTask(targetSequence, cb)
        ];
        if (actions[i]) {
            actions[i](onComplete);
        }
    });
}

function addClickTask(targetSequence, onComplete) {
    let x, y;

    // 1. 检查悬浮窗是否已启动
    if (appState.isFloatyCreated && uiRefs.targetView) {
        // 情况A: 悬浮窗存在，使用星星(🌟)的位置
        x = uiRefs.targetView.getX() + uiRefs.targetView.getWidth() / 2;
        y = uiRefs.targetView.getY() + uiRefs.targetView.getHeight() / 2;
    } else {
        // 情况B: 悬浮窗未启动，使用屏幕中心作为默认值
        x = device.width / 2;
        y = device.height / 2;
        toast("悬浮窗未启动，坐标默认为屏幕中心");
    }

    let newIndex = targetSequence.tasks.length;
    let task = { type: 'click', name: "点击任务 " + (newIndex + 1), x: x, y: y, offsetX: 0, offsetY: 0 };

    addNewTask(task, targetSequence);

    // 2. 仅当悬浮窗存在时，才尝试创建可视化浮窗(🎯)
    if (appState.isFloatyCreated && sequences[appSettings.mainSequenceKey] === targetSequence) {
        createTaskWindow(task, targetSequence);
    }
    
    if (onComplete) onComplete();
}

function addSwipeTask(targetSequence, onComplete) {
    if (isBusy()) return;

    // --- 核心修改：移除所有弹窗，使用默认值 ---
    try {
        let newIndex = targetSequence.tasks.length;
        let task = { 
            type: 'swipe', 
            name: `滑动任务 ${newIndex + 1}`, 
            startX: 1000, // 默认值
            startY: 1000, // 默认值
            endX: 1000,   // 默认值
            endY: 500,    // 默认值
            duration: appSettings.swipe.duration 
        };

        const addedTask = addNewTask(task, targetSequence); // addNewTask 已经包含了 toast
        
        // 仅当可视化开启时，才尝试创建浮窗
        if (sequences[appSettings.mainSequenceKey] === targetSequence && !appSettings.taskVisualsHidden) {
            createSwipeVisuals(addedTask, targetSequence);
        }
        
        if (onComplete) onComplete();

    } catch (e) {
        toast("添加失败: " + e.message);
        logErrorToScreen("添加滑动任务失败: " + e);
        if (onComplete) onComplete();
    }
}

function addWaitTask(targetSequence, onComplete) {
    dialogs.rawInput("输入等待时间 (毫秒)", "1000").then(durationStr => {
        if (durationStr === null) {
            if (onComplete) onComplete();
            return;
        }
        if (!validateNumericInput(durationStr)) return;
        let duration = parseInt(durationStr);
        if (duration > 0) {
            let task = { type: 'wait', name: `等待 ${duration}ms`, duration: duration };
            addNewTask(task, targetSequence);
        } else {
            toast("输入无效");
        }
        if (onComplete) onComplete();
    });
}

function addWaitForDissapearTask(targetSequence, onComplete) {
    dialogs.select("请选择等待消失的目标类型", ["图片", "文本(OCR)"]).then(typeIndex => {
        if (typeIndex < 0) {
            if (onComplete) onComplete();
            return;
        }
        const targetType = (typeIndex === 0) ? 'image' : 'ocr';
        const promptText = (targetType === 'image') ? "请输入图片文件名 (例如: button.png)" : "请输入要识别的文本";

        dialogs.rawInput(promptText, "").then(target => {
            if (target) {
                let task = {
                    type: 'wait_for_dissapear',
                    name: `等待'${target}'消失`,
                    targetType: targetType,
                    target: target,
                    findTimeout: 5000,
                    disappearTimeout: 10000,
                    onSuccess: { action: 'skip' }, // Default action
                    onFail: { action: 'stop' },      // Default if not found
                    onTimeout: { action: 'stop' }   // Default if doesn't disappear
                };
                if (targetType === 'image') {
                    task.threshold = 0.8;
                }
                addNewTask(task, targetSequence);
            } else if (target !== null) {
                toast("目标内容不能为空");
            }
            if (onComplete) onComplete();
        });
    });
}

function addTimerTask(targetSequence, onComplete) {
    dialogs.rawInput("输入计时器名称 (例如: my_timer)", "my_timer").then(timerName => {
        if (!timerName) {
            if (timerName !== null) toast("计时器名称不能为空");
            if (onComplete) onComplete();
            return;
        }
        dialogs.rawInput("输入计时时长 (毫秒)", "10000").then(durationStr => {
            if (durationStr === null) {
                if (onComplete) onComplete();
                return;
            }
            if (!validateNumericInput(durationStr)) return;
            let duration = parseInt(durationStr);
            if (duration > 0) {
                let task = { type: 'timer', name: `启动/重置计时器: ${timerName}`, timerName: timerName, duration: duration };
                addNewTask(task, targetSequence);
            } else {
                toast("输入无效");
            }
            if (onComplete) onComplete();
        });
    });
}

function addOcrTask(targetSequence, onComplete) {
    dialogs.rawInput("请输入要识别的文本", "").then(textToFind => {
        if (textToFind) {
            let task = {
                type: 'ocr',
                name: `识别: "${textToFind}"`,
                textToFind: textToFind,
                timeout: 5000,
                cachePadding: appSettings.defaultCachePadding || 50, // <-- 新增: 默认 padding
                onSuccess: { action: 'click', offsetX: 0, offsetY: 0 },
                onFail: { action: 'stop' },
            };
            addNewTask(task, targetSequence);
        } else if (textToFind !== null) {
            toast("识别文本不能为空");
        }
        if (onComplete) onComplete();
    });
}

function addImageTask(targetSequence, onComplete) {
    dialogs.rawInput("请输入要查找的图片文件名 (例如: button.png)", "image.png").then(imageFile => {
        if (imageFile) {
            let task = {
                type: 'image',
                name: `找图: "${imageFile}"`,
                imageFile: imageFile,
                threshold: 0.8,
                timeout: 5000,
                cachePadding: appSettings.defaultCachePadding || 50, // <-- 新增: 默认 padding
                onSuccess: { action: 'click', offsetX: 0, offsetY: 0 },
                onFail: { action: 'stop' },
            };
            addNewTask(task, targetSequence);
        } else if (imageFile !== null) {
            toast("图片文件名不能为空");
        }
        if (onComplete) onComplete();
    });
}

function addBackTask(targetSequence, onComplete) {
    let task = {
        type: 'back',
        name: `返回操作`,
    };
    addNewTask(task, targetSequence);
    if (onComplete) onComplete();
}

function addLaunchAppTask(targetSequence, onComplete) {
    dialogs.rawInput("请输入要启动的应用名称 (例如: 闲鱼)", "闲鱼").then(appName => {
        if (appName) {
            let task = {
                type: 'launch_app',
                name: `启动应用: ${appName}`,
                appName: appName
            };
            addNewTask(task, targetSequence);
        } else if (appName !== null) {
            toast("应用名称不能为空");
        }
        if (onComplete) onComplete();
    });
}

function addExecuteSequenceTask(targetSequence, targetSequenceKey, onComplete) {
    const callableSequences = Object.entries(sequences)
        .filter(([key, seq]) => key !== targetSequenceKey)
        .map(([key, seq]) => ({ id: key, name: seq.name || key }));

    if (callableSequences.length === 0) {
        toast("没有其他可供调用的序列");
        if (onComplete) onComplete();
        return;
    }

    const callableSequenceNames = callableSequences.map(s => s.name);

    dialogs.select("选择要调用的序列", callableSequenceNames).then(i => {
        if (i >= 0) {
            const selectedSequence = callableSequences[i];
            let task = {
                type: 'execute_sequence',
                name: `调用: ${selectedSequence.name}`,
                sequenceName: selectedSequence.id
            };
            addNewTask(task, targetSequence);
        }
        if (onComplete) onComplete();
    });
}

function addStartMonitorTask(targetSequence, onComplete) {
    const monitorSequences = Object.entries(sequences)
        .filter(([key, seq]) => seq.executionPolicy && seq.executionPolicy.mode === 'monitor')
        .map(([key, seq]) => ({ id: key, name: seq.name || key }));

    if (monitorSequences.length === 0) {
        toast("没有可供启动的监控序列 (请先创建模式为'监控'的序列)");
        if (onComplete) onComplete();
        return;
    }

    const monitorSequenceNames = monitorSequences.map(s => s.name);
    dialogs.select("选择要动态启动的监控序列", monitorSequenceNames).then(i => {
        if (i >= 0) {
            const selectedSequence = monitorSequences[i];
            let task = {
                type: 'start_monitor',
                name: `启动监控: ${selectedSequence.name}`,
                sequenceName: selectedSequence.id
            };
            addNewTask(task, targetSequence);
        }
        if (onComplete) onComplete();
    });
}

function addStopMonitorTask(targetSequence, onComplete) {
    const monitorSequences = Object.entries(sequences)
        .filter(([key, seq]) => seq.executionPolicy && seq.executionPolicy.mode === 'monitor')
        .map(([key, seq]) => ({ id: key, name: seq.name || key }));

    if (monitorSequences.length === 0) {
        toast("没有可供停止的监控序列");
        if (onComplete) onComplete();
        return;
    }

    const monitorSequenceNames = monitorSequences.map(s => s.name);
    dialogs.select("选择要动态停止的监控序列", monitorSequenceNames).then(i => {
        if (i >= 0) {
            const selectedSequence = monitorSequences[i];
            let task = {
                type: 'stop_monitor',
                name: `停止监控: ${selectedSequence.name}`,
                sequenceName: selectedSequence.id
            };
            addNewTask(task, targetSequence);
        }
        if (onComplete) onComplete();
    });
}
/**
 * 获取【实时】的屏幕物理宽度
 */
function getRealWidth() {
    try {
        // 使用 Android context 获取最新的显示指标
        return context.getResources().getDisplayMetrics().widthPixels;
    } catch(e) {
        logErrorToScreen("getRealWidth Gagal: " + e);
        return device.width; // 备用方案
    }
}

/**
 * 获取【实时】的屏幕物理高度
 */
function getRealHeight() {
    try {
        // 使用 Android context 获取最新的显示指标
        return context.getResources().getDisplayMetrics().heightPixels;
    } catch(e) {
        logErrorToScreen("getRealHeight Gagal: " + e);
        return device.height; // 备用方案
    }
}
// =================================================================================
// --- 在这里粘贴新函数 (主UI编辑器) ---
// =================================================================================

/**
 * (辅助函数) 根据过滤器文本对序列进行排序和过滤
 */
function filterAndSortSequences(filterText) {
    const mainSeqKey = appSettings.mainSequenceKey;
    const mainMonKey = appSettings.mainMonitorKey;
    const sequenceKeys = Object.keys(sequences);
    
    filterText = filterText ? filterText.toLowerCase() : "";

    const sortedList = sequenceKeys.map(key => {
        const sequence = sequences[key];
        const policy = sequence.executionPolicy || {};
        let sortPriority = 3; 
        let type = "🔗"; 

        if (key === mainSeqKey) { sortPriority = 0; type = "⭐"; }
        else if (key === mainMonKey) { sortPriority = 0; type = "🧿"; }
        else if (policy.mode === 'monitor') { sortPriority = 1; type = "👁️"; }

        return { key: key, name: sequence.name || key, icon: type, priority: sortPriority };
    })
    // --- 核心过滤逻辑 ---
    .filter(item => {
        if (!filterText) return true; // 如果没有过滤器，全部显示
        return item.name.toLowerCase().includes(filterText);
    })
    // --- 排序逻辑 ---
    .sort((a, b) => {
        if (a.priority !== b.priority) {
            return a.priority - b.priority;
        }
        return a.name.localeCompare(b.name);
    });
    
    return sortedList;
}


/**
 * (新) 填充主UI中的序列列表
 * @param {string} [filterText=""] - 用于过滤列表的搜索词
 */
function populateSequenceListEditor(filterText) {
    if (!ui.sequenceListContainer) return; // 防止UI未渲染时出错
    
    const container = ui.sequenceListContainer;
    filterText = filterText || "";

    ui.run(() => {
        container.removeAllViews();
        
        const sortedList = filterAndSortSequences(filterText);

        if (sortedList.length === 0) {
            container.addView(ui.inflate(<text text="没有匹配的序列" textColor="#9E9E9E" gravity="center" padding="20" />, container, false));
        }

        sortedList.forEach(item => {
            const key = item.key;
            const sequence = sequences[key];
            const policy = sequence.executionPolicy || {};

            const itemView = ui.inflate(
                <card w="*" margin="8 4" cardCornerRadius="8dp" cardElevation="2dp" bg="{{CONSTANTS.UI.THEME.SECONDARY_CARD}}">
                    <horizontal w="*" gravity="center_vertical" padding="16 12">
                        <text id="seqIcon" textSize="18sp" marginRight="12" />
                        <text id="seqName" layout_weight="1" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" ellipsize="end" maxLines="1" />
                        <text text=">" textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}" />
                    </horizontal>
                </card>, container, false);

            itemView.seqName.setText(item.name);
            itemView.seqIcon.setText(item.icon);
            
            // 定义一个回调函数，用于在弹窗关闭后刷新此列表
            const refreshListCallback = () => {
                let currentFilter = ui.sequenceSearchBox ? ui.sequenceSearchBox.getText().toString() : "";
                populateSequenceListEditor(currentFilter);
            };

            itemView.click(() => {
                // !!! 关键：我们仍然打开旧的 "弹窗" 编辑器
                // !!! 但我们把它的 "onBack" 回调函数改成了 "refreshListCallback"
                renderTaskListEditor(key);
            });

            itemView.longClick(() => {
                const seqName = sequence.name || key;
                const policy = sequence.executionPolicy || {};
                const isMonitor = policy.mode === 'monitor';

                let actions = ["复制序列 (Copy)", "删除序列 (Delete)"];
                if (isMonitor) { actions.push("设为主监控 (Set Main Monitor)"); }
                else { actions.push("设为主序列 (Set Main Sequence)"); }
                actions.push("取消"); 

                dialogs.select(`操作: "${seqName}"`, actions).then(i => {
                    if (i < 0) return; 
                    const action = actions[i];

                    if (action === "复制序列 (Copy)") {
                        dialogs.rawInput("输入新序列的名称", `${seqName}_copy`).then(newName => {
                            if (!newName) { toast("名称不能为空"); return; }
                            const newKey = newName.replace(/\s/g, '_') + "_" + new Date().getTime();
                            if (sequences[newKey]) { toast("同名序列已存在"); return; }
                            const newSequence = JSON.parse(JSON.stringify(sequence)); 
                            newSequence.name = newName;
                            sequences[newKey] = newSequence;
                            saveCurrentProfileThrottled();
                            refreshListCallback(); // 刷新列表
                            toast(`序列已复制为 "${newName}"`);
                        });
                    } else if (action === "删除序列 (Delete)") {
                        dialogs.confirm("确定删除序列?", `将永久删除序列: "${seqName}"`).then(ok => {
                            if (ok) {
                                if (appSettings.mainSequenceKey === key) appSettings.mainSequenceKey = null;
                                if (appSettings.mainMonitorKey === key) appSettings.mainMonitorKey = null;
                                delete sequences[key];
                                saveCurrentProfileThrottled();
                                refreshListCallback(); // 刷新列表
                                toast(`序列 "${seqName}" 已删除`);
                            }
                        });
                    } else if (action.startsWith("设为主监控")) {
                        appSettings.mainMonitorKey = key;
                        saveCurrentProfileThrottled();
                        toast(`"${seqName}" 已设为主监控`);
                        refreshListCallback(); // 刷新图标
                    } else if (action.startsWith("设为主序列")) {
                        appSettings.mainSequenceKey = key;
                        saveCurrentProfileThrottled();
                        toast(`"${seqName}" 已设为主序列`);
                        refreshListCallback(); // 刷新图标
                        // --- 核心修复：只在悬浮窗存在时才刷新 ---
                        if (appState.isFloatyCreated) {
                            recreateAllTaskVisuals();
                        }
                    }
                });
                return true; 
            });
            container.addView(itemView);
        });
    });
}


/**
 * (新) 渲染“序列列表”编辑器到主UI选项卡
 * (此函数只在用户第一次点击“编辑”选项卡时运行一次)
 */
function renderSequenceListEditor() {
    // 1. 定义新UI的XML布局
    const view = ui.inflate(
        <vertical bg="{{CONSTANTS.UI.THEME.BACKGROUND}}" w="*" h="*">
            {/* --- 搜索/过滤框 --- */}
            <card w="*" margin="16 8" cardCornerRadius="16dp" cardElevation="4dp" bg="{{CONSTANTS.UI.THEME.PRIMARY_CARD}}">
                <input id="sequenceSearchBox" hint="搜索序列..." padding="12" textSize="16sp" singleLine="true" bg="{{CONSTANTS.UI.THEME.PRIMARY_CARD}}" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" />
            </card>
            
            {/* --- 序列列表 --- */}
            <card w="*" margin="16 8" cardCornerRadius="16dp" cardElevation="4dp" bg="{{CONSTANTS.UI.THEME.PRIMARY_CARD}}" layout_weight="1">
                <ScrollView>
                    <vertical id="sequenceListContainer" padding="8" />
                </ScrollView>
            </card>
            
            {/* --- 操作按钮 --- */}
            <card w="*" margin="16 8" cardCornerRadius="16dp" cardElevation="4dp" bg="{{CONSTANTS.UI.THEME.PRIMARY_CARD}}">
                 <button id="addSequenceBtn" text="创建新序列" style="Widget.AppCompat.Button.Borderless.Colored" textColor="{{CONSTANTS.UI.THEME.ACCENT_GRADIENT_START}}" />
            </card>
        </vertical>
    , ui.sequenceEditorView, false); // 注意：父容器是 ui.sequenceEditorView

    // 2. 将新UI添加到选项卡
    ui.run(() => {
        ui.sequenceEditorView.addView(view);
    });

    // 3. 绑定事件监听器
    ui.post(() => {
        // --- 在这里添加新行 (核心修复) ---
        // 将搜索框注册到全局ui对象，以便其他函数可以访问它
        ui.sequenceSearchBox = view.sequenceSearchBox;
        // --- 添加结束 ---
        // 搜索框监听
        view.sequenceSearchBox.addTextChangedListener(new android.text.TextWatcher({
            onTextChanged: (text, start, before, count) => {
                try {
                    populateSequenceListEditor(text.toString());
                } catch(e) {
                    logErrorToScreen("搜索序列时出错: "+e);
                }
            }
        }));

        // “创建新序列”按钮监听
        view.addSequenceBtn.click(() => {
            dialogs.rawInput("输入新序列的名称", "我的新序列").then(name => {
                if (!name) {
                    toast("名称不能为空");
                    return;
                }
                const key = name.replace(/\s/g, '_') + "_" + new Date().getTime();
                if (sequences[key]) {
                    toast("同名序列已存在");
                    return;
                }
                sequences[key] = {
                    name: name,
                    executionPolicy: { mode: 'sequence' },
                    tasks: []
                };
                saveCurrentProfileThrottled();
                // 刷新列表 (并清除搜索框)
                view.sequenceSearchBox.setText("");
                populateSequenceListEditor("");
            });
        });

        // 4. 首次填充列表
        populateSequenceListEditor("");
    });
}
function showSequenceManager() {
    if (isBusy()) return;
    const dialogView = ui.inflate(
        <vertical>
            <ScrollView h="400dp">
                <vertical id="sequenceListContainer" />
            </ScrollView>
            <horizontal>
                <button id="addSequenceBtn" text="创建新序列" layout_weight="1" style="Widget.AppCompat.Button.Borderless.Colored" />
                <button id="profileManagerBtn" text="方案管理" layout_weight="1" style="Widget.AppCompat.Button.Borderless.Colored" />
                <button id="showAppBtn" text="主窗口" layout_weight="1" style="Widget.AppCompat.Button.Borderless.Colored" />
            </horizontal>
        </vertical>, null, false);

    //const dialog = dialogs.build({ customView: dialogView, title: "序列管理器 (长按设为主项)", positive: "完成", neutral: "退出脚本" }).on("neutral", closeAllAndExit).show();
    // --- 新增代码块 开始 ---
    // 清理当前方案名称，用于显示
    let displayName = "未知";
    if (currentProfileName) {
        displayName = currentProfileName.replace(CONSTANTS.FILES.PROFILE_PREFIX, '').replace('.json', '');
    }
    const dialogTitle = `序列管理器 (当前: ${displayName})`;
    // --- 新增代码块 结束 ---

    const dialog = dialogs.build({
        customView: dialogView,
        title: dialogTitle, // <-- 修改点：使用新的标题变量
        positive: "关闭",
        neutral: "退出脚本"
    }).on("neutral", closeAllAndExit).show();

    function populateSequenceList(container) {
        ui.run(() => {
            container.removeAllViews();
            // --- 开始替换 ---
            const mainSeqKey = appSettings.mainSequenceKey;
            const mainMonKey = appSettings.mainMonitorKey;

            const sequenceKeys = Object.keys(sequences);

            // 1. 将序列和key映射，并添加排序所需的信息
            const sortedList = sequenceKeys.map(key => {
                const sequence = sequences[key];
                const policy = sequence.executionPolicy || {};
                let sortPriority = 3; // 默认优先级
                let type = "🔗"; // 默认：序列

                if (key === mainSeqKey) {
                    sortPriority = 0; // 最高优先级
                    type = "⭐";
                } else if (key === mainMonKey) {
                    sortPriority = 0; // 最高优先级
                    type = "🧿";
                } else if (policy.mode === 'monitor') {
                    sortPriority = 1; // 第二优先级
                    type = "👁️";
                }

                return {
                    key: key,
                    name: sequence.name || key,
                    icon: type,
                    priority: sortPriority
                };
            });

            // 2. 执行排序
            // 规则: 1.按优先级(主项 > 监控 > 序列) 2.按名称字母
            sortedList.sort((a, b) => {
                if (a.priority !== b.priority) {
                    return a.priority - b.priority;
                }
                return a.name.localeCompare(b.name);
            });

            // 3. 遍历排序后的列表来创建视图
            sortedList.forEach(item => {
                const key = item.key;
                const sequence = sequences[key];
                const policy = sequence.executionPolicy || {};

                const itemView = ui.inflate(
                    <card w="*" margin="8 4" cardCornerRadius="8dp" cardElevation="2dp" bg="{{CONSTANTS.UI.THEME.SECONDARY_CARD}}">
                        <horizontal w="*" gravity="center_vertical" padding="16 12">
                            <text id="seqIcon" textSize="18sp" marginRight="12" />
                            <text id="seqName" layout_weight="1" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" ellipsize="end" maxLines="1" />
                            <text text=">" textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}" />
                        </horizontal>
                    </card>, container, false);

                itemView.seqName.setText(item.name);
                itemView.seqIcon.setText(item.icon);

                itemView.click(() => {
                    dialog.dismiss();
                    showUnifiedSequenceEditor(key, showSequenceManager);
                });

                // --- 替换为新的 longClick 逻辑 ---
                // --- 替换为新的 longClick 逻辑 (包含复制、设置主项、删除) ---
                itemView.longClick(() => {
                    const seqName = sequence.name || key;
                    const policy = sequence.executionPolicy || {};
                    const isMonitor = policy.mode === 'monitor';

                    // 1. 定义长按后弹出的菜单
                    let actions = ["复制序列 (Copy)", "删除序列 (Delete)"]; // <-- 新增删除

                    if (isMonitor) {
                        actions.push("设为主监控 (Set Main Monitor)");
                    } else {
                        actions.push("设为主序列 (Set Main Sequence)");
                    }
                    actions.push("取消"); // 添加取消选项

                    dialogs.select(`操作: "${seqName}"`, actions).then(i => {
                        if (i < 0) return; // 用户取消

                        const action = actions[i];

                        if (action === "复制序列 (Copy)") {
                            // 2. 复制逻辑
                            dialogs.rawInput("输入新序列的名称", `${seqName}_copy`).then(newName => {
                                if (!newName) { toast("名称不能为空"); return; }
                                const newKey = newName.replace(/\s/g, '_') + "_" + new Date().getTime();
                                if (sequences[newKey]) { toast("同名序列已存在"); return; }

                                const newSequence = JSON.parse(JSON.stringify(sequence)); // 深拷贝
                                newSequence.name = newName;

                                sequences[newKey] = newSequence;
                                saveCurrentProfileThrottled();
                                populateSequenceList(container); // 刷新列表
                                toast(`序列已复制为 "${newName}"`);
                            });

                        } else if (action === "删除序列 (Delete)") {
                            // 3. 删除逻辑 (新)
                            dialogs.confirm("确定删除序列?", `将永久删除序列: "${seqName}"`).then(ok => {
                                if (ok) {
                                    // 检查是否为主项，如果是则清空
                                    if (appSettings.mainSequenceKey === key) {
                                        appSettings.mainSequenceKey = null;
                                    }
                                    if (appSettings.mainMonitorKey === key) {
                                        appSettings.mainMonitorKey = null;
                                    }
                                    // 删除
                                    delete sequences[key];
                                    saveCurrentProfileThrottled();
                                    populateSequenceList(container); // 刷新列表
                                    toast(`序列 "${seqName}" 已删除`);
                                }
                            });

                        } else if (action.startsWith("设为主监控")) {
                            // 4. 设为主监控逻辑
                            appSettings.mainMonitorKey = key;
                            saveCurrentProfileThrottled();
                            toast(`"${seqName}" 已设为主监控`);
                            populateSequenceList(container); // 刷新图标

                        } else if (action.startsWith("设为主序列")) {
                            // 5. 设为主序列逻辑
                            appSettings.mainSequenceKey = key;
                            saveCurrentProfileThrottled();
                            toast(`"${seqName}" 已设为主序列`);
                            populateSequenceList(container); // 刷新图标
                            recreateAllTaskVisuals();
                        }
                    });
                    return true; // 消耗长按事件
                });
                // --- 替换结束 ---
                container.addView(itemView);
            });
            // --- 结束替换 ---
        });
    }

    dialogView.addSequenceBtn.click(() => {
        dialogs.rawInput("输入新序列的名称", "我的新序列").then(name => {
            if (!name) {
                toast("名称不能为空");
                return;
            }
            const key = name.replace(/\s/g, '_') + "_" + new Date().getTime();
            if (sequences[key]) {
                toast("同名序列已存在");
                return;
            }
            sequences[key] = {
                name: name,
                executionPolicy: { mode: 'sequence' },
                tasks: []
            };
            saveCurrentProfileThrottled();
            populateSequenceList(dialogView.sequenceListContainer);
        });
    });

    dialogView.profileManagerBtn.click(() => {
        dialog.dismiss();
        showProfileManager();
    });
    // --- 在这里添加新事件 ---
    dialogView.showAppBtn.click(() => {
        app.launch(context.getPackageName()); // <-- 【已修改】使用此方法来显示主窗口
        toast("正在显示主窗口...");
        dialog.dismiss(); // 关闭序列管理器
    });
    // --- 添加结束 ---
    populateSequenceList(dialogView.sequenceListContainer);
}
/**
 * (新 - UI V2 - 已添加 过滤 和 排序按钮)
 * 填充“任务列表”到UI容器。
 */
function populateTaskList(container, sequence, sequenceKey, filterText) {
    const tasks = sequence.tasks || []; // 原始、未过滤的数组
    filterText = (filterText || "").toLowerCase();

    // --- 1. 过滤逻辑 ---
    const filteredTasks = tasks.filter(task => {
        if (!filterText) return true;
        return (task.name || "").toLowerCase().includes(filterText) ||
               (task.type || "").toLowerCase().includes(filterText);
    });
    
    // --- 2. 定义统一的回调函数 (用于刷新) ---
    const refreshTaskList = () => {
        let currentFilter = ui.taskSearchBox ? ui.taskSearchBox.getText().toString() : "";
        populateTaskList(container, sequence, sequenceKey, currentFilter);
    };

    ui.run(() => {
        container.removeAllViews();
        
        if (filteredTasks.length === 0) {
            container.addView(ui.inflate(<text text="没有匹配的任务" textColor="#9E9E9E" gravity="center" padding="20" />, container, false));
            return;
        }

        filteredTasks.forEach(task => {
            // 关键：我们从“原始数组”中获取索引，以便排序
            const index = tasks.indexOf(task);

            // --- 核心修改：以 Card 为根, 将 Vertical 移入 ---
            // (并采用您在调试中使用的 "1 0" 和 "10 1" 间距)
            const itemView = ui.inflate(
                <card w="*" margin="2 2" cardCornerRadius="8dp" cardElevation="2dp" bg="{{CONSTANTS.UI.THEME.SECONDARY_CARD}}">
                    <horizontal w="*" gravity="center_vertical" padding="10 1" bg="?attr/selectableItemBackground">
                        
                        {/* 1. 任务信息 (名称 + 勾选框) */}
                        <horizontal layout_weight="1" gravity="center_vertical">
                            <text id="taskName" layout_weight="1" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" ellipsize="end" maxLines="1" />
                            <checkbox id="enabledCheckbox" w="auto" />
                        </horizontal>
                        
                        {/* 2. 排序按钮 (移入Card) */}
                        <vertical gravity="center_vertical">
                            <button id="moveUpBtn" text="↑" w="30dp" h="40dp" marginBottom="-10dp" style="Widget.AppCompat.Button.Borderless.Colored" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" />
                            <button id="moveDownBtn" text="↓" w="30dp" h="40dp" marginTop="-10dp" style="Widget.AppCompat.Button.Borderless.Colored" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" />
                        </vertical>
                    </horizontal>
                </card>
            , container, false);
            // --- 修改结束 ---

            // --- 核心修复：在 JS 中设置 enabled 状态 ---
            itemView.moveUpBtn.setEnabled(index > 0);
            itemView.moveDownBtn.setEnabled(index < tasks.length - 1);
            // --- 修复结束 ---

            // --- 填充内容 (与旧逻辑相同) ---
            let taskDisplayName = `${index + 1}. [${task.type.toUpperCase()}] ${task.name || ''}`;
            itemView.enabledCheckbox.setChecked(task.enabled !== false);
            if (task.enabled === false) {
                taskDisplayName += " (已禁用)";
                itemView.taskName.setTextColor(colors.parseColor("#757575"));
            }
            itemView.taskName.setText(taskDisplayName);

            // --- 绑定事件 (与旧逻辑相同) ---
            itemView.enabledCheckbox.click(() => {
                task.enabled = itemView.enabledCheckbox.isChecked();
                saveCurrentProfileThrottled();
                const taskIdentifier = task.name || task.type;
                toast(`任务: ${taskIdentifier} ${task.enabled ? "已启用" : "已禁用"}`);
                refreshTaskList(); // 刷新以更新文本
            });

            itemView.taskName.click(() => {
                showTaskEditor(task, tasks, sequenceKey, refreshTaskList);
            });

            itemView.taskName.longClick(() => {
                const currentTaskName = task.name || `[${task.type}]`;
                dialogs.select(`操作: "${currentTaskName}"`, ["复制 (Copy)", "删除 (Delete)", "取消"])
                    .then(i => {
                        if (i === 0) { // 复制
                            const newTask = JSON.parse(JSON.stringify(task));
                            newTask.name = (task.name || '副本') + " (复制)";
                            newTask.enabled = true; 
                            delete newTask.cachedBounds; 
                            tasks.splice(index + 1, 0, newTask);
                            refreshTaskList();
                            toast("任务已复制");
                        } else if (i === 1) { // 删除
                            dialogs.confirm("删除任务?", `将永久删除任务: "${currentTaskName}"`).then(ok => {
                                if (ok) {
                                    tasks.splice(index, 1);
                                    refreshTaskList();
                                    toast("任务已删除");
                                }
                            });
                        }
                    });
                return true; 
            });
            
            itemView.moveUpBtn.click(() => {
                if (index > 0) {
                    const taskToMove = tasks.splice(index, 1)[0];
                    tasks.splice(index - 1, 0, taskToMove);
                    saveCurrentProfileThrottled();
                    refreshTaskList();
                }
            });
            itemView.moveDownBtn.click(() => {
                if (index < tasks.length - 1) {
                    const taskToMove = tasks.splice(index, 1)[0];
                    tasks.splice(index + 1, 0, taskToMove);
                    saveCurrentProfileThrottled();
                    refreshTaskList();
                }
            });

            container.addView(itemView);
        });
    });
}
/**
 * (新 - UI V2 - 布局已修正) 
 * 渲染“任务列表”(Level 2) 编辑器到主UI选项卡。
 * 此函数替换了旧的 showUnifiedSequenceEditor() 弹窗。
 */
function renderTaskListEditor(sequenceKey) {
    const sequence = sequences[sequenceKey];
    if (!sequence) {
        logErrorToScreen("无法渲染任务列表: 找不到序列 " + sequenceKey);
        return;
    }

    // 1. 定义新UI的XML布局 (包含“返回”按钮)
    const view = ui.inflate(
        <vertical bg="{{CONSTANTS.UI.THEME.BACKGROUND}}" w="*" h="*">
            
            {/* --- 1. 头部 & 导航 (已修改) --- */}
            <card w="*" margin="2 1" cardCornerRadius="16dp" cardElevation="4dp" bg="{{CONSTANTS.UI.THEME.PRIMARY_CARD}}">
                {/* --- 核心修改：添加 singleLine="true" --- */}
                <horizontal gravity="center_vertical" singleLine="true">
                    
                    {/* --- 核心修改：移除 text, JS中设置 --- */}
                    <button id="backToSequenceListBtn" style="Widget.AppCompat.Button.Borderless.Colored" textColor="{{CONSTANTS.UI.THEME.ACCENT_GRADIENT_START}}" w="40" />
                    
                    {/* --- 核心修改：添加 singleLine 和 ellipsize --- */}
                    <input id="sequenceName" hint="序列名称" layout_weight="1" textSize="16sp" bg="{{CONSTANTS.UI.THEME.PRIMARY_CARD}}" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" singleLine="true" ellipsize="end" />
                    
                    {/* --- 核心修改：改为图标 --- */}
                    <button id="saveSequenceNameBtn" text="💾" style="Widget.AppCompat.Button.Borderless.Colored" textColor="{{CONSTANTS.UI.THEME.ACCENT_GRADIENT_START}}" w="40" />
                    
                    <input id="taskSearchBox" hint="搜索..." ems="4" padding="5" margin="0 4" textSize="18sp" singleLine="true" bg="{{CONSTANTS.UI.THEME.BACKGROUND}}" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" />
                
                </horizontal>
            </card>
            
            {/* --- 2. 任务列表 --- */}
            <card w="*" margin="1" cardCornerRadius="4dp" cardElevation="4dp" bg="{{CONSTANTS.UI.THEME.PRIMARY_CARD}}" layout_weight="1">
                <vertical>
                    {/* (搜索框已移到顶部) */}
                    <ScrollView layout_weight="1">
                        <vertical id="taskListContainer" padding="1 1" />
                    </ScrollView>
                    
                    {/* ❌ "添加新步骤" 按钮已从此卡片中移除 ❌ */}
                </vertical>
            </card>
            
            {/* --- 3. 策略 & 触发器 (已合并 "添加" 按钮) --- */}
            <card w="*" margin="2 1" cardCornerRadius="16dp" cardElevation="4dp" bg="{{CONSTANTS.UI.THEME.PRIMARY_CARD}}">
                 {/* --- 核心修改：添加了 "addTaskBtn" --- */}
                 <horizontal padding="8 4">
                    <button id="addTaskBtn" text="添加步骤" layout_weight="1" style="Widget.AppCompat.Button.Borderless.Colored" textColor="{{CONSTANTS.UI.THEME.ACCENT_GRADIENT_START}}" />
                    <button id="editPolicyBtn" text="执行策略" layout_weight="1" style="Widget.AppCompat.Button.Borderless.Colored" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" />
                    <button id="editTriggersBtn" text="触发器" layout_weight="1" style="Widget.AppCompat.Button.Borderless.Colored" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" />
                </horizontal>
            </card>
        </vertical>
    , ui.sequenceEditorView, false);

    // 2. 清除旧视图 ("序列列表") 并添加新视图 ("任务列表")
    ui.run(() => {
        ui.sequenceEditorView.removeAllViews();
        ui.sequenceEditorView.addView(view);
    });

    // 3. 绑定所有新UI的逻辑
    ui.post(() => {
        ui.taskSearchBox = view.taskSearchBox;

        // --- 核心修改：用JS设置返回按钮，并增大字体 ---
        view.sequenceName.setText(sequence.name);
        view.backToSequenceListBtn.setText("<"); 
        view.backToSequenceListBtn.setTextSize(20); // 增大箭头
        // --- 修改结束 ---
        
        view.backToSequenceListBtn.click(() => {
            ui.run(() => {
                ui.sequenceEditorView.removeAllViews();
                renderSequenceListEditor(); // 重新渲染“第1层”序列列表
            });
        });

        view.saveSequenceNameBtn.click(() => {
            const newName = view.sequenceName.getText().toString();
            if (newName) {
                sequence.name = newName;
                saveCurrentProfileThrottled();
                toast("名称已保存");
            } else {
                toast("序列名称不能为空");
            }
        });

        view.taskSearchBox.addTextChangedListener(new android.text.TextWatcher({
            onTextChanged: (text, start, before, count) => {
                try {
                    populateTaskList(view.taskListContainer, sequence, sequenceKey, text.toString());
                } catch(e) {
                    logErrorToScreen("搜索任务时出错: " + e);
                }
            }
        }));

        function refreshTriggersButton() {
            const isMonitor = sequence.executionPolicy && sequence.executionPolicy.mode === 'monitor';
            view.editTriggersBtn.setVisibility(isMonitor ? 0 : 8);
        }
        refreshTriggersButton();

        // 首次填充列表 (无过滤器)
        populateTaskList(view.taskListContainer, sequence, sequenceKey, ""); 

        // --- 核心修改：addTaskBtn 的回调 ---
        view.addTaskBtn.click(() => {
            showAddTaskDialog(sequence, sequenceKey, () => {
                // 刷新时使用当前的过滤器
                populateTaskList(view.taskListContainer, sequence, sequenceKey, ui.taskSearchBox.getText().toString());
            });
        });
        // --- 修改结束 ---

        view.editPolicyBtn.click(() => {
            showExecutionPolicyEditor(sequence, sequenceKey, () => {
                refreshTriggersButton(); 
            });
        });

        view.editTriggersBtn.click(() => {
            renderTriggerManager(sequence, sequenceKey);
        });
    });
}

function showExecutionPolicyEditor(sequence, sequenceKey, onBackCallback) {
    const policy = sequence.executionPolicy || { mode: 'sequence' };
    const view = ui.inflate(
        <vertical padding="16">
            <text>运行模式:</text>
            <spinner id="mode" entries="序列 (可循环/被调用)|监控 (后台持续运行)" />
            <vertical id="sequence_options">
                <text>循环次数:</text>
                <input id="loopCount" inputType="number" />
            </vertical>
            <vertical id="monitor_options">
                <text>扫描间隔 (ms):</text>
                <input id="interval" inputType="number" />
            </vertical>
        </vertical>, null, false
    );

    const modeMap = ['sequence', 'monitor'];
    const currentModeIndex = modeMap.indexOf(policy.mode);
    view.mode.setSelection(currentModeIndex > -1 ? currentModeIndex : 0);
    view.loopCount.setText(String(policy.loopCount || 1));
    view.interval.setText(String(policy.interval || 1000));

    function updateVisibility(position) {
        view.sequence_options.setVisibility(position === 0 ? 0 : 8);
        view.monitor_options.setVisibility(position === 1 ? 0 : 8);
    }
    updateVisibility(currentModeIndex);

    view.mode.setOnItemSelectedListener({
        onItemSelected: function (p, v, position, id) {
            updateVisibility(position);
        }
    });

    dialogs.build({
        customView: view,
        title: "设置执行策略",
        positive: "保存",
        negative: "取消"
    }).on("positive", () => {
        const selectedMode = modeMap[view.mode.getSelectedItemPosition()];

        policy.mode = selectedMode;
        policy.loopCount = parseInt(view.loopCount.getText().toString()) || 1;
        policy.interval = parseInt(view.interval.getText().toString()) || 1000;
        delete policy.dynamic;

        sequence.executionPolicy = policy;

        if (selectedMode === 'monitor' && appSettings.mainSequenceKey === sequenceKey) {
            appSettings.mainSequenceKey = null;
        } else if (selectedMode === 'sequence' && appSettings.mainMonitorKey === sequenceKey) {
            appSettings.mainMonitorKey = null;
        }

        saveCurrentProfileThrottled();
        onBackCallback();
    }).on("negative", onBackCallback).show();
}

// ✅✅✅ 替换为这个新版本 (v5.1.3 UI 改进) ✅✅✅
// =================================================================================
// --- 在这里粘贴 第1个 新函数 ---
// (这是从旧的 populateTriggers 升级而来的)
// =================================================================================
/**
 * (新 - UI V2) 
 * 填充“触发器列表”到UI容器，并支持过滤。
 */
function populateTriggerList(container, sequence, sequenceKey, filterText) {
    ui.run(() => {
        container.removeAllViews();
        const triggers = sequence.triggers || [];
        filterText = (filterText || "").toLowerCase();

        // --- 1. 过滤逻辑 ---
        const filteredTriggers = triggers.filter(trigger => {
            if (!filterText) return true;
            return (trigger.target || "").toLowerCase().includes(filterText) || 
                   (trigger.type || "").toLowerCase().includes(filterText) ||
                   (trigger.action.type || "").toLowerCase().includes(filterText) ||
                   (trigger.action.sequenceName || "").toLowerCase().includes(filterText);
        });

        if (filteredTriggers.length === 0) {
            container.addView(ui.inflate(<text text="没有匹配的触发器" textColor="#9E9E9E" gravity="center" padding="20" />, container, false));
            return;
        }

        // --- 2. 定义统一的回调函数 ---
        // (用于在弹窗关闭后刷新此列表)
        const refreshTriggerListCallback = () => {
            let currentFilter = ui.triggerSearchBox ? ui.triggerSearchBox.getText().toString() : "";
            populateTriggerList(container, sequence, sequenceKey, currentFilter);
        };

        // --- 3. 渲染列表 ---
        filteredTriggers.forEach(trigger => {
            const index = triggers.indexOf(trigger); // 获取在“完整列表”中的原始索引

            const triggerView = ui.inflate(
                <CardView w="*" margin="5" cardCornerRadius="8dp" cardElevation="2dp" bg="{{CONSTANTS.UI.THEME.SECONDARY_CARD}}">
                    <horizontal w="*" padding="12 10" gravity="center_vertical" bg="?attr/selectableItemBackground">
                        <text id="triggerInfo" layout_weight="1" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" />
                        <checkbox id="enabledCheckbox" w="50dp" />
                    </horizontal>
                </CardView>, container, false
            );

            // --- 4. 填充内容 (与旧逻辑相同) ---
            let actionInfo = "";
            const action = trigger.action || { type: 'click' };
            switch (action.type) {
                case 'click': actionInfo = `点击(偏移:${action.offsetX || 0},${action.offsetY || 0})`; break;
                case 'back': actionInfo = "执行返回"; break;
                case 'skip': actionInfo = "跳过(无操作)"; break;
                case 'swipe': actionInfo = "执行滑动"; break;
                case 'launch_app': actionInfo = `启动应用: ${action.appName || '未指定'}`; break;
                default: actionInfo = `未知操作: ${action.type}`;
            }
            if (action.sequenceName) {
                const seqName = (sequences[action.sequenceName] && sequences[action.sequenceName].name) || action.sequenceName || "未指定";
                actionInfo += ` -> 然后调用序列: ${seqName}`;
            }

            let info = `${index + 1}. [${trigger.type}] 目标: ${trigger.target}\n动作: ${actionInfo}`;
            // --- 修改开始：添加置顶图标 ---
            if (trigger.isTopPriority) {
                info = `🔥 ${info}`; // 加个火苗图标表示置顶
            }
            // --- 修改结束 ---
            triggerView.enabledCheckbox.setChecked(trigger.enabled !== false); // 默认启用
            if (trigger.enabled === false) {
                info += "\n(已禁用)";
                triggerView.triggerInfo.setTextColor(colors.parseColor("#757575")); // 禁用时变灰
            }
            triggerView.triggerInfo.setText(info);

            // --- 5. 绑定事件 (使用新回调) ---
            triggerView.enabledCheckbox.click(() => {
                const isChecked = triggerView.enabledCheckbox.isChecked();
                trigger.enabled = isChecked;
                saveCurrentProfileThrottled(); 
                toast(`触发器: ${trigger.target} ${isChecked ? "已启用" : "已禁用"}`);

                if (trigger.enabled === false) {
                    triggerView.triggerInfo.setText(info + "\n(已禁用)");
                    triggerView.triggerInfo.setTextColor(colors.parseColor("#757575"));
                } else {
                    triggerView.triggerInfo.setText(info); 
                    triggerView.triggerInfo.setTextColor(colors.parseColor(CONSTANTS.UI.THEME.PRIMARY_TEXT));
                }
            });            
            // --- 核心修复：将 .click() 和 .longClick() 绑定到同一个元素 ---

            // 点击文本区域，打开“弹窗”编辑器
            triggerView.triggerInfo.click(() => {
                showTriggerEditor(trigger, sequence, sequenceKey, refreshTriggerListCallback);
            });

            // 长按“也”在文本区域上，以避免冲突
            triggerView.triggerInfo.longClick(() => {
                const currentTriggerName = trigger.target || `[${trigger.type}]`;
                dialogs.select(`操作: "${currentTriggerName}"`, ["复制 (Copy)", "删除 (Delete)", "取消"])
                    .then(i => {
                        if (i === 0) { // 复制
                            dialogs.rawInput("输入新触发器的目标", `${trigger.target}_copy`).then(newTarget => {
                                if (!newTarget) { toast("目标不能为空"); return; }
                                const newTrigger = JSON.parse(JSON.stringify(trigger)); 
                                newTrigger.target = newTarget;
                                newTrigger.enabled = true; 
                                delete newTrigger.cachedBounds; 
                                if (!sequence.triggers) sequence.triggers = [];
                                sequence.triggers.push(newTrigger); 
                                saveCurrentProfileThrottled();
                                refreshTriggerListCallback(); 
                                toast("触发器已复制");
                            });
                        } else if (i === 1) { // 删除
                            dialogs.confirm("删除触发器?", `将永久删除: "${currentTriggerName}"`).then(ok => {
                                if (ok) {
                                    triggers.splice(index, 1);
                                    saveCurrentProfileThrottled();
                                    refreshTriggerListCallback(); 
                                    toast("触发器已删除");
                                }
                            });
                        }
                    });
                return true; // 消耗长按事件
            });

            // ❌ 已删除绑定在 triggerView 上的 longClick ❌

            container.addView(triggerView);
        });
    });
}

/**
 * (新 - UI V3 - 布局已修正为"嵌套选项卡") 
 * 渲染“触发器列表”(Level 3) 编辑器到主UI选项卡。
 */
function renderTriggerManager(sequence, sequenceKey) {
    const view = ui.inflate(
        <vertical bg="{{CONSTANTS.UI.THEME.BACKGROUND}}" w="*" h="*">
            {/* --- 1. 头部 & 导航 --- */}
            <card w="*" margin="16 8" cardCornerRadius="16dp" cardElevation="4dp" bg="{{CONSTANTS.UI.THEME.PRIMARY_CARD}}">
                <horizontal gravity="center_vertical">
                    <button id="backToTaskListBtn" style="Widget.AppCompat.Button.Borderless.Colored" textColor="{{CONSTANTS.UI.THEME.ACCENT_GRADIENT_START}}" w="auto" />
                    <input id="triggerSearchBox" hint="搜索触发器..." layout_weight="1" textSize="16sp" bg="{{CONSTANTS.UI.THEME.PRIMARY_CARD}}" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" />
                </horizontal>
            </card>

            {/* --- 2. 主内容卡片 (带嵌套选项卡) --- */}
            <card w="*" margin="16 8" cardCornerRadius="16dp" cardElevation="4dp" bg="{{CONSTANTS.UI.THEME.PRIMARY_CARD}}" layout_weight="1">
                <vertical>
                    {/* --- 2a. 嵌套选项卡按钮 --- */}
                    <horizontal>
                        <button id="triggerTabBtn" text="触发器列表" layout_weight="1" style="Widget.AppCompat.Button.Borderless.Colored" textColor="{{CONSTANTS.UI.THEME.ACTIVE_TAB_COLOR}}" />
                        <button id="pqTabBtn" text="优先队列 (PQ)" layout_weight="1" style="Widget.AppCompat.Button.Borderless.Colored" textColor="{{CONSTANTS.UI.THEME.INACTIVE_TAB_COLOR}}" />
                    </horizontal>
                    <View w="*" h="1dp" bg="{{CONSTANTS.UI.THEME.SECONDARY_CARD}}" />

                    {/* --- 2b. 嵌套内容宿主 --- */}
                    <FrameLayout id="triggerContentHost" layout_weight="1">

                        {/* --- 视图1: 触发器列表 (默认显示) --- */}
                        <vertical id="triggerListView">
                            <ScrollView layout_weight="1">
                                <vertical id="triggersContainer" padding="8" />
                            </ScrollView>
                            <button id="addTriggerBtn" text="添加新触发器" style="Widget.AppCompat.Button.Borderless.Colored" textColor="{{CONSTANTS.UI.THEME.ACCENT_GRADIENT_START}}" />
                        </vertical>

                        {/* --- 视图2: PQ 管理器 (默认隐藏) --- */}
                        <vertical id="pqView" visibility="gone" padding="10">
                            <text text="触发器优先队列 (Priority Queue)" textStyle="bold" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}"/>
                            <text text="当前队列 (0=最高):" textSize="12sp" textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}"/>
                            
                            {/* --- 核心修复：这里添加了 layout_weight="1" --- */}
                            <ScrollView layout_weight="1" bg="{{CONSTANTS.UI.THEME.BACKGROUND}}" padding="4" marginTop="5">
                                <text id="pq_display" textSize="10sp" textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}" textIsSelectable="true" />
                            </ScrollView>
                            {/* --- 修复结束 --- */}

                            <horizontal gravity="center_vertical" marginTop="5">
                                <text textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}">队列最大长度:</text>
                                <input id="pq_maxLength" inputType="number" layout_weight="1" textSize="14sp" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}"/>
                                <button id="pq_saveBtn" text="保存" style="Widget.AppCompat.Button.Borderless.Colored" />
                            </horizontal>
                            <horizontal gravity="right" marginTop="-10">
                                <button id="pq_clearBtn" text="清空队列" style="Widget.AppCompat.Button.Borderless.Colored" />
                            </horizontal>
                        </vertical>

                    </FrameLayout>
                </vertical>
            </card>
        </vertical>
    , ui.sequenceEditorView, false);

    // 2. 切换视图
    ui.run(() => {
        ui.sequenceEditorView.removeAllViews();
        ui.sequenceEditorView.addView(view);
    });

    // 3. 绑定所有新UI的逻辑
    ui.post(() => {
        // --- 注册全局搜索框 ---
        ui.triggerSearchBox = view.triggerSearchBox;
        
        // --- 绑定导航 ---
        view.backToTaskListBtn.setText("< 返回任务列表");
        view.backToTaskListBtn.click(() => {
            ui.run(() => {
                ui.sequenceEditorView.removeAllViews();
                renderTaskListEditor(sequenceKey); // 重新渲染“第2层”任务列表
            });
        });

        // --- 绑定搜索 ---
        view.triggerSearchBox.addTextChangedListener(new android.text.TextWatcher({
            onTextChanged: (text, start, before, count) => {
                try {
                    // 确保只在“触发器列表”选项卡激活时才过滤
                    if (view.triggerListView.getVisibility() === 0) {
                         populateTriggerList(view.triggersContainer, sequence, sequenceKey, text.toString());
                    }
                } catch(e) {
                    logErrorToScreen("搜索触发器时出错: " + e);
                }
            }
        }));
        
        // --- 绑定嵌套选项卡切换 (新!) ---
        view.triggerTabBtn.click(() => {
            view.triggerListView.setVisibility(0);
            view.pqView.setVisibility(8);
            view.triggerSearchBox.setVisibility(0); // 显示搜索框
            view.triggerTabBtn.setTextColor(colors.parseColor(CONSTANTS.UI.THEME.ACTIVE_TAB_COLOR));
            view.pqTabBtn.setTextColor(colors.parseColor(CONSTANTS.UI.THEME.INACTIVE_TAB_COLOR));
        });
        view.pqTabBtn.click(() => {
            view.triggerListView.setVisibility(8);
            view.pqView.setVisibility(0);
            view.triggerSearchBox.setVisibility(8); // 隐藏搜索框
            view.triggerTabBtn.setTextColor(colors.parseColor(CONSTANTS.UI.THEME.INACTIVE_TAB_COLOR));
            view.pqTabBtn.setTextColor(colors.parseColor(CONSTANTS.UI.THEME.ACTIVE_TAB_COLOR));
        });

        // --- 绑定“添加”按钮 (打开弹窗) ---
        view.addTriggerBtn.click(() => {
            const refreshTriggerListCallback = () => {
                let currentFilter = ui.triggerSearchBox ? ui.triggerSearchBox.getText().toString() : "";
                populateTriggerList(view.triggersContainer, sequence, sequenceKey, currentFilter);
            };
            // 打开“第4层”编辑器弹窗
            showTriggerEditor(null, sequence, sequenceKey, refreshTriggerListCallback);
        });

        // --- 绑定PQ管理 (从旧弹窗移植) ---
        const pq = ensurePriorityQueue(sequence);
        if (pq.length === 0) {
            view.pq_display.setText("[队列为空]");
        } else {
            view.pq_display.setText(pq.map((id, index) => `${index}: ${id}`).join('\n'));
        }
        view.pq_maxLength.setText(String((sequence.priorityQueueMaxLength !== undefined) ? sequence.priorityQueueMaxLength : 50));
        
        view.pq_saveBtn.click(() => {
            try {
                const newMaxLengthStr = view.pq_maxLength.getText().toString();
                if (validateNumericInput(newMaxLengthStr)) {
                    const newMaxLength = parseInt(newMaxLengthStr);
                    if (newMaxLength >= 0) {
                        sequence.priorityQueueMaxLength = newMaxLength;
                        saveCurrentProfileThrottled(); 
                        toast("队列设置已保存");
                    } else {
                        toast("队列长度不能为负数");
                    }
                }
            } catch (e) { logErrorToScreen("保存在队列长度失败: " + e); toast("保存失败: " + e.message); }
        });
        
        view.pq_clearBtn.click(() => {
            dialogs.confirm("清空优先队列?", "这将重置此监控序列的触发器优先级，恢复为默认排序。").then(ok => {
                if (ok) {
                    sequence.priorityQueue = [];
                    saveCurrentProfileThrottled(); 
                    view.pq_display.setText("[队列为空]");
                    toast("优先队列已清空");
                }
            });
        });
        
        // --- 4. 首次填充列表 ---
        populateTriggerList(view.triggersContainer, sequence, sequenceKey, "");
    });
}

function showTriggerEditor(trigger, sequence, sequenceKey, onBackCallback) {
    const isNew = !trigger;
    const triggers = sequence.triggers || [];
    
    // 1. 准备数据副本
    const currentTrigger = isNew ?
        { type: 'image', target: 'new_image.png', threshold: 0.8, action: { type: 'click', delayMs: 0 }, cooldownMs: 0, cachePadding: (appSettings.defaultCachePadding || 50), onFail: { action: 'skip' }, enabled: true, isTopPriority: false } : 
        JSON.parse(JSON.stringify(trigger));

    // 确保对象结构完整
    if (!currentTrigger.action) currentTrigger.action = { type: 'click' };
    if (!currentTrigger.onFail) currentTrigger.onFail = { action: 'skip' }; 

    const originalIndex = isNew ? -1 : triggers.indexOf(trigger);
    const currentOrder = isNew ? triggers.length + 1 : originalIndex + 1;

    const callableSequences = Object.entries(sequences)
        .filter(([key, seq]) => key !== sequenceKey)
        .map(([key, seq]) => ({ id: key, name: seq.name || key }));
    const sequenceEntries = callableSequences.length > 0 ? callableSequences.map(s => s.name).join('|').replace(/\|/g, '|') : "无可用序列"; // 简单修复 join

    // --- XML 界面 ---
    const viewXML = `
        <vertical padding="16">
            <horizontal id="order_row" gravity="center_vertical">
                <text>触发器序号:</text>
                <input id="order" inputType="number" text="${currentOrder.toString()}" w="50dp"/>
                <View w="10dp" />
                <checkbox id="isTopPriority" text="🔥 置顶优先 (忽略PQ排序)" textColor="#FF5722" textStyle="bold"/>
            </horizontal>

            <text>触发类型:</text>
            <spinner id="type" entries="图像|文本(OCR)|计时器结束" />
            <text id="target_label">目标:</text>
            <horizontal>
                <input id="target" layout_weight="1" />
                <button id="browse_trigger_image" text="..." w="auto" style="Widget.AppCompat.Button.Borderless.Colored" visibility="gone"/>
            </horizontal>
            <vertical id="image_options">
                <text>相似度 (0.1 - 1.0):</text><input id="threshold" inputType="numberDecimal" />
                 <vertical id="image_cache_info" marginTop="5" visibility="gone">
                    <text textSize="12sp">缓存位置:</text>
                    <horizontal>
                        <input id="image_cached_bounds_display" enabled="false" layout_weight="1" textSize="10sp"/>
                        <button id="image_copy_cache_btn" text="写入搜索区" style="Widget.AppCompat.Button.Borderless.Colored" />
                        <button id="image_clear_cache_btn" text="清除" style="Widget.AppCompat.Button.Borderless.Colored" />
                    </horizontal>
                </vertical>
            </vertical>
             <vertical id="ocr_options" visibility="gone">
                 <vertical id="ocr_cache_info" marginTop="5" visibility="gone">
                    <text textSize="12sp">缓存位置:</text>
                    <horizontal>
                        <input id="ocr_cached_bounds_display" enabled="false" layout_weight="1" textSize="10sp"/>
                        <button id="ocr_copy_cache_btn" text="写入搜索区" style="Widget.AppCompat.Button.Borderless.Colored" />
                        <button id="ocr_clear_cache_btn" text="清除" style="Widget.AppCompat.Button.Borderless.Colored" />
                    </horizontal>
                </vertical>
            </vertical>
            
            <text id="search_area_label">搜索区域 (X1, Y1, X2, Y2):</text>
            <horizontal>
                <input id="sa_x1" hint="X1" inputType="number" layout_weight="1" textSize="14sp"/><input id="sa_y1" hint="Y1" inputType="number" layout_weight="1" textSize="14sp"/>
                <input id="sa_x2" hint="X2" inputType="number" layout_weight="1" textSize="14sp"/><input id="sa_y2" hint="Y2" inputType="number" layout_weight="1" textSize="14sp"/>
            </horizontal>
            <text id="cache_padding_label">缓存扩边 (Padding):</text>
            <input id="cache_padding_input" inputType="number" />
            <text>冷却 (ms):</text><input id="cooldownMs" inputType="number" />
            
            <text text="触发后动作 (onSuccess)" marginTop="10" textStyle="bold" textColor="{{CONSTANTS.UI.THEME.ACCENT_GRADIENT_START}}"/>
            <text>类型:</text><spinner id="actionType" entries="点击目标|执行返回|跳过(无操作)|滑动|启动App" />
            <text>延迟 (ms):</text><input id="actionDelayMs" inputType="number" />
            <vertical id="click_offset_fields" visibility="gone">
                <horizontal><text>OffX:</text><input id="click_offsetX" inputType="numberSigned" layout_weight="1"/><text>OffY:</text><input id="click_offsetY" inputType="numberSigned" layout_weight="1"/></horizontal>
            </vertical>
            <vertical id="swipe_fields" visibility="gone">
                <text>滑动模式:</text><spinner id="swipeMode" entries="向量 (从目标中心)|坐标 (固定位置)" />
                <vertical id="swipe_vector_fields">
                    <horizontal><text>dx:</text><input id="swipe_dx" inputType="numberSigned" layout_weight="1"/><text>dy:</text><input id="swipe_dy" inputType="numberSigned" layout_weight="1"/></horizontal>
                    <text>时长:</text><input id="swipe_duration_vector" inputType="number"/>
                </vertical>
                <vertical id="swipe_coords_fields" visibility="gone">
                    <horizontal><text>SX:</text><input id="swipe_startX" inputType="number" layout_weight="1"/><text>SY:</text><input id="swipe_startY" inputType="number" layout_weight="1"/></horizontal>
                    <horizontal><text>EX:</text><input id="swipe_endX" inputType="number" layout_weight="1"/><text>EY:</text><input id="swipe_endY" inputType="number" layout_weight="1"/></horizontal>
                    <text>时长:</text><input id="swipe_duration_coords" inputType="number"/>
                </vertical>
            </vertical>
            <vertical id="launch_app_fields" visibility="gone"><text>App名称:</text><input id="launch_app_name" /></vertical>
            <horizontal marginTop="5" gravity="center_vertical">
                <checkbox id="callSequenceCheckbox" text="然后调用序列"/>
                <spinner id="sequenceName" entries="${sequenceEntries.replace(/\|/g, '|')}" visibility="gone"/>
            </horizontal>

            <text text="未找到时动作 (onFail)" marginTop="15" textStyle="bold" textColor="#FF5252"/>
            <text>类型:</text><spinner id="onFailActionType" entries="跳过(无操作)|执行返回|启动App|调用序列" />
            <text>延迟 (ms):</text><input id="onFailActionDelayMs" inputType="number" />
            <vertical id="onFail_launch_app_fields" visibility="gone"><text>App名称:</text><input id="onFail_launch_app_name" /></vertical>
            <horizontal id="onFail_callSequence_fields" marginTop="5" gravity="center_vertical" visibility="gone">
                <text>调用序列:</text><spinner id="onFailSequenceName" entries="${sequenceEntries.replace(/\|/g, '|')}" />
            </horizontal>

        </vertical>
    `;
    const view = ui.inflate(viewXML, null, false);

    // --- UI 初始化 ---
    // 1. 设置置顶 Checkbox
    view.isTopPriority.setChecked(currentTrigger.isTopPriority === true);

    if (isNew) view.order_row.setVisibility(0); // 显示序号行

    const typeMap = { 'image': 0, 'ocr': 1, 'timer_end': 2 };
    view.type.setSelection(typeMap[currentTrigger.type] || 0);
    
    function updateTriggerFields(position) {
        const isImage = position === 0;
        const isOcr = position === 1;
        const isTimer = position === 2;
        view.image_options.setVisibility(isImage ? 0 : 8);
        view.browse_trigger_image.setVisibility(isImage ? 0 : 8); 
        view.ocr_options.setVisibility(isOcr ? 0 : 8);
        view.search_area_label.setVisibility(isTimer ? 8 : 0);
        view.sa_x1.setVisibility(isTimer ? 8 : 0); view.sa_y1.setVisibility(isTimer ? 8 : 0);
        view.sa_x2.setVisibility(isTimer ? 8 : 0); view.sa_y2.setVisibility(isTimer ? 8 : 0);
        view.cache_padding_input.setVisibility(isTimer ? 8 : 0);
        view.cache_padding_label.setVisibility(isTimer ? 8 : 0);
        view.target_label.setText(isTimer ? "目标 (计时器名称):" : "目标:");
    }
    updateTriggerFields(typeMap[currentTrigger.type] || 0);
    view.type.setOnItemSelectedListener({ onItemSelected: (p, v, pos, id) => updateTriggerFields(pos) });
    
    view.browse_trigger_image.click(() => { showImageSelectorDialog((n) => view.target.setText(n)); });
    view.target.setText(currentTrigger.target);
    view.threshold.setText(String(currentTrigger.threshold || 0.8));
    view.cooldownMs.setText(String(currentTrigger.cooldownMs || 0));
    if (currentTrigger.search_area) {
        view.sa_x1.setText(String(currentTrigger.search_area[0])); view.sa_y1.setText(String(currentTrigger.search_area[1]));
        view.sa_x2.setText(String(currentTrigger.search_area[2])); view.sa_y2.setText(String(currentTrigger.search_area[3]));
    }
    view.cache_padding_input.setText(String(currentTrigger.cachePadding !== undefined ? currentTrigger.cachePadding : (appSettings.defaultCachePadding || 50)));

    // Cache UI
    if (currentTrigger.cachedBounds) {
        const b = currentTrigger.cachedBounds;
        if (currentTrigger.type === 'ocr') {
            view.ocr_cache_info.setVisibility(0);
            view.ocr_cached_bounds_display.setText(`[${b.left},${b.top},${b.right},${b.bottom}]`);
            view.ocr_clear_cache_btn.click(() => { currentTrigger.cachedBounds = null; view.ocr_cache_info.setVisibility(8); });
            view.ocr_copy_cache_btn.click(() => { view.sa_x1.setText(String(b.left)); view.sa_y1.setText(String(b.top)); view.sa_x2.setText(String(b.right)); view.sa_y2.setText(String(b.bottom)); });
        } else if (currentTrigger.type === 'image') {
            view.image_cache_info.setVisibility(0);
            view.image_cached_bounds_display.setText(`x:${b.x},y:${b.y},w:${b.width},h:${b.height}`);
            view.image_clear_cache_btn.click(() => { currentTrigger.cachedBounds = null; view.image_cache_info.setVisibility(8); });
            view.image_copy_cache_btn.click(() => { view.sa_x1.setText(String(b.x)); view.sa_y1.setText(String(b.y)); view.sa_x2.setText(String(b.x + b.width)); view.sa_y2.setText(String(b.y + b.height)); });
        }
    }

    // --- 动作 UI 填充 (Success) ---
    const actionMap = { 'click': 0, 'back': 1, 'skip': 2, 'swipe': 3, 'launch_app': 4 };
    view.actionType.setSelection(actionMap[currentTrigger.action.type] || 0);
    view.actionDelayMs.setText(String(currentTrigger.action.delayMs || 0));

    function updateActionFields(pos) {
        view.click_offset_fields.setVisibility(pos === 0 ? 0 : 8);
        view.swipe_fields.setVisibility(pos === 3 ? 0 : 8); 
        view.launch_app_fields.setVisibility(pos === 4 ? 0 : 8);
        if (pos === 0) { // Click
            view.click_offsetX.setText(String(currentTrigger.action.offsetX || 0));
            view.click_offsetY.setText(String(currentTrigger.action.offsetY || 0));
        } else if (pos === 3) { // Swipe
            const isCoords = !!currentTrigger.action.swipeCoords || !currentTrigger.action.swipeVector; 
            view.swipeMode.setSelection(isCoords ? 1 : 0);
            view.swipe_vector_fields.setVisibility(isCoords ? 8 : 0);
            view.swipe_coords_fields.setVisibility(isCoords ? 0 : 8);
            if (isCoords) {
                const c = currentTrigger.action.swipeCoords || {}; 
                view.swipe_startX.setText(String(c.startX||1000)); view.swipe_startY.setText(String(c.startY||1000));
                view.swipe_endX.setText(String(c.endX||1000)); view.swipe_endY.setText(String(c.endY||500));
                view.swipe_duration_coords.setText(String(c.duration||appSettings.swipe.duration));
            } else {
                const v = currentTrigger.action.swipeVector || {};
                view.swipe_dx.setText(String(v.dx||0)); view.swipe_dy.setText(String(v.dy||0));
                view.swipe_duration_vector.setText(String(v.duration||appSettings.swipe.duration));
            }
        } else if (pos === 4) {
            view.launch_app_name.setText(currentTrigger.action.appName || "");
        }
    }
    updateActionFields(actionMap[currentTrigger.action.type] || 0);
    view.actionType.setOnItemSelectedListener({ onItemSelected: (p, v, pos, id) => updateActionFields(pos) });
    view.swipeMode.setOnItemSelectedListener({ onItemSelected: (p, v, pos, id) => { view.swipe_vector_fields.setVisibility(pos === 0 ? 0 : 8); view.swipe_coords_fields.setVisibility(pos === 1 ? 0 : 8); } });
    
    if (currentTrigger.action.sequenceName) {
        view.callSequenceCheckbox.setChecked(true);
        view.sequenceName.setVisibility(0);
        const sIdx = callableSequences.findIndex(s => s.id === currentTrigger.action.sequenceName);
        if (sIdx > -1) view.sequenceName.setSelection(sIdx);
    }
    view.callSequenceCheckbox.setOnCheckedChangeListener((c, isChecked) => { view.sequenceName.setVisibility(isChecked ? 0 : 8); });

    // --- 动作 UI 填充 (Fail) ---
    const onFailMap = { 'skip': 0, 'back': 1, 'launch_app': 2, 'execute_sequence': 3 };
    view.onFailActionType.setSelection(onFailMap[currentTrigger.onFail.action] || 0);
    view.onFailActionDelayMs.setText(String(currentTrigger.onFail.delayMs || 0));

    function updateOnFailFields(pos) {
        view.onFail_launch_app_fields.setVisibility(pos === 2 ? 0 : 8);
        view.onFail_callSequence_fields.setVisibility(pos === 3 ? 0 : 8);
        if (pos === 2) {
            view.onFail_launch_app_name.setText(currentTrigger.onFail.appName || "");
        } else if (pos === 3) {
            const sIdx = callableSequences.findIndex(s => s.id === currentTrigger.onFail.sequenceName);
            if (sIdx > -1) view.onFailSequenceName.setSelection(sIdx);
        }
    }
    updateOnFailFields(onFailMap[currentTrigger.onFail.action] || 0);
    view.onFailActionType.setOnItemSelectedListener({ onItemSelected: (p, v, pos, id) => updateOnFailFields(pos) });

    // Helper to read actions
    function readActionFromUI(isFail) {
        let typeIndex, delayStr;
        if (!isFail) { 
             typeIndex = view.actionType.getSelectedItemPosition();
             delayStr = view.actionDelayMs.getText().toString();
        } else { 
             typeIndex = view.onFailActionType.getSelectedItemPosition();
             delayStr = view.onFailActionDelayMs.getText().toString();
        }

        let currentTypeStr = "";
        if (!isFail) {
            let sTypes = ['click', 'back', 'skip', 'swipe', 'launch_app'];
            currentTypeStr = sTypes[typeIndex];
        } else {
            let fTypes = ['skip', 'back', 'launch_app', 'execute_sequence'];
            currentTypeStr = fTypes[typeIndex];
        }

        let actionObj = {};
        if (isFail) actionObj.action = currentTypeStr;
        else actionObj.type = currentTypeStr;
        
        actionObj.delayMs = parseInt(delayStr) || 0;

        switch (currentTypeStr) {
            case 'click':
                actionObj.offsetX = parseInt(view.click_offsetX.getText().toString()) || 0;
                actionObj.offsetY = parseInt(view.click_offsetY.getText().toString()) || 0;
                break;
            case 'swipe':
                const isCoords = view.swipeMode.getSelectedItemPosition() === 1;
                if (!isCoords) { 
                    actionObj.swipeVector = {
                        dx: parseInt(view.swipe_dx.getText().toString()) || 0,
                        dy: parseInt(view.swipe_dy.getText().toString()) || 0,
                        duration: parseInt(view.swipe_duration_vector.getText().toString()) || appSettings.swipe.duration
                    };
                } else { 
                    actionObj.swipeCoords = {
                        startX: parseInt(view.swipe_startX.getText().toString() || "1000"),
                        startY: parseInt(view.swipe_startY.getText().toString() || "1000"),
                        endX: parseInt(view.swipe_endX.getText().toString() || "1000"),
                        endY: parseInt(view.swipe_endY.getText().toString() || "500"),
                        duration: parseInt(view.swipe_duration_coords.getText().toString()) || appSettings.swipe.duration
                    };
                }
                break;
            case 'launch_app':
                if (!isFail) actionObj.appName = view.launch_app_name.getText().toString();
                else actionObj.appName = view.onFail_launch_app_name.getText().toString();
                break;
            case 'execute_sequence': 
                if (callableSequences.length > 0) {
                    actionObj.sequenceName = callableSequences[view.onFailSequenceName.getSelectedItemPosition()].id;
                }
                break;
        }

        if (!isFail && view.callSequenceCheckbox.isChecked()) {
            if (callableSequences.length > 0) {
                actionObj.sequenceName = callableSequences[view.sequenceName.getSelectedItemPosition()].id;
            }
        }
        return actionObj;
    }

    // --- 保存 ---
    dialogs.build({
        customView: view,
        title: isNew ? "添加新触发器" : "编辑触发器",
        positive: "保存",
        negative: "取消"
    }).on("positive", () => {
        
        let newTriggerData = {};

        const typeKeys = ['image', 'ocr', 'timer_end'];
        newTriggerData.type = typeKeys[view.type.getSelectedItemPosition()];
        newTriggerData.target = view.target.getText().toString();
        newTriggerData.threshold = parseFloat(view.threshold.getText().toString()) || 0.8;
        newTriggerData.cooldownMs = parseInt(view.cooldownMs.getText().toString()) || 0;
        newTriggerData.enabled = currentTrigger.enabled !== false;
        
        // --- 保存置顶优先 ---
        newTriggerData.isTopPriority = view.isTopPriority.isChecked();
        // --- 保存结束 ---

        const pTxt = view.cache_padding_input.getText().toString();
        newTriggerData.cachePadding = !isNaN(parseInt(pTxt)) ? parseInt(pTxt) : (appSettings.defaultCachePadding || 50);

        if (newTriggerData.type !== 'timer_end') {
            const x1 = parseInt(view.sa_x1.getText().toString() || "0");
            const y1 = parseInt(view.sa_y1.getText().toString() || "0");
            const x2 = parseInt(view.sa_x2.getText().toString() || String(device.width));
            const y2 = parseInt(view.sa_y2.getText().toString() || String(device.height));
            const strSum = view.sa_x1.getText().toString() + view.sa_y1.getText().toString() + view.sa_x2.getText().toString() + view.sa_y2.getText().toString();
            if (strSum.length > 0) {
                 newTriggerData.search_area = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
            }
            if (currentTrigger.cachedBounds) newTriggerData.cachedBounds = currentTrigger.cachedBounds;
        }

        newTriggerData.action = readActionFromUI(false); 
        newTriggerData.onFail = readActionFromUI(true);  

        const newOrder = parseInt(view.order.getText().toString());
        if (isNaN(newOrder) || newOrder < 1) { toast("序号无效"); return; }

        if (isNew) {
            if (!sequence.triggers) sequence.triggers = [];
            sequence.triggers.push(newTriggerData);
        } else {
            triggers.splice(originalIndex, 1);
            triggers.splice(newOrder - 1, 0, newTriggerData);
        }

        saveCurrentProfileThrottled();
        onBackCallback();

    }).on("negative", onBackCallback).show();
}
/**
 * (V4 - 兼容性修复版：解决 idx 重复声明问题)
 * 显示任务编辑器弹窗
 */
function showTaskEditor(task, taskList, sequenceKey, onSaveCallback) {
    if (!task) return;

    // 获取当前任务序号
    const currentOrder = taskList.indexOf(task) + 1;

    // 准备可调用的序列列表 (排除当前序列)
    const onDemandSequences = Object.entries(sequences)
        .filter(([key, seq]) => key !== sequenceKey)
        .map(([key, seq]) => ({ id: key, name: seq.name || key }));
    const onDemandSequenceNames = onDemandSequences.length > 0 ? onDemandSequences.map(s => s.name) : ["无可用序列"];
    const onDemandEntries = onDemandSequenceNames.map(name => name.replace(/\|/g, ' ')).join('|');

    // 准备监控序列列表
    const monitorSequences = Object.entries(sequences)
        .filter(([key, seq]) => seq.executionPolicy && seq.executionPolicy.mode === 'monitor')
        .map(([key, seq]) => ({ id: key, name: seq.name || key }));
    const monitorSequenceNames = monitorSequences.length > 0 ? monitorSequences.map(s => s.name) : ["无可用监控"];
    const monitorEntries = monitorSequenceNames.map(name => name.replace(/\|/g, ' ')).join('|');

    // XML 布局定义
    const viewXML = `
        <vertical padding="16">
            <horizontal id="order_row" gravity="center_vertical">
                <text>任务序号 (1-${taskList.length}):</text>
                <input id="order" inputType="number" text="${currentOrder.toString()}"/>
            </horizontal>
            
            <text>任务名称:</text><input id="name" />
            <checkbox id="taskEnabled" text="启用此任务" textColor="#E0E0E0" />
            <text>执行前延迟 (ms):</text><input id="delayMs" inputType="number" />
            
            <vertical id="wait_fields" visibility="gone">
                <text>等待时间 (ms):</text><input id="wait_duration" inputType="number" />
            </vertical>
            
            <vertical id="timer_fields" visibility="gone">
                <text>计时器名称:</text><input id="timer_name" />
                <text>时长 (ms):</text><input id="timer_duration" inputType="number" />
            </vertical>

            <vertical id="click_fields" visibility="gone">
                <horizontal><text>X:</text><input id="click_x" inputType="numberDecimal" layout_weight="1"/><text>Y:</text><input id="click_y" inputType="numberDecimal" layout_weight="1"/></horizontal>
                <horizontal><text>OffsetX:</text><input id="click_offsetX" inputType="numberSigned" layout_weight="1"/><text>OffsetY:</text><input id="click_offsetY" inputType="numberSigned" layout_weight="1"/></horizontal>
            </vertical>
            
            <vertical id="swipe_fields" visibility="gone">
                <horizontal><text>开始X:</text><input id="swipe_startX" inputType="numberDecimal" layout_weight="1"/><text>开始Y:</text><input id="swipe_startY" inputType="numberDecimal" layout_weight="1"/></horizontal>
                <horizontal><text>结束X:</text><input id="swipe_endX" inputType="numberDecimal" layout_weight="1"/><text>结束Y:</text><input id="swipe_endY" inputType="numberDecimal" layout_weight="1"/></horizontal>
                <text>滑动时长 (ms):</text><input id="swipe_duration" inputType="number" />
            </vertical>
            
            <vertical id="ocr_fields" visibility="gone">
                <text>要查找的文本:</text><input id="ocr_textToFind" />
                <text>超时时间 (ms):</text><input id="ocr_timeout" inputType="number" />
                
                <text text="成功后操作 (主动作):" marginTop="10" textStyle="bold"/>
                <spinner id="ocr_onSuccessAction" entries="点击找到的文本|执行返回|跳过(无操作)" />
                
                <horizontal id="ocr_click_offset_fields">
                    <text>点击偏移:</text>
                    <input id="ocr_offsetX" hint="X" inputType="numberSigned" w="60dp"/><input id="ocr_offsetY" hint="Y" inputType="numberSigned" w="60dp"/>
                </horizontal>

                <horizontal marginTop="5" gravity="center_vertical">
                    <text>后续操作:</text>
                    <spinner id="ocr_afterAction" entries="无|调用序列|终止序列" marginLeft="5" layout_weight="1"/>
                </horizontal>
                <spinner id="ocr_onSuccessSequence" entries="${onDemandEntries}" visibility="gone"/>

                <text text="失败后操作:" marginTop="10" textStyle="bold"/>
                <spinner id="ocr_onFailAction" entries="停止任务|跳过|调用序列" />
                <spinner id="ocr_onFailSequence" entries="${onDemandEntries}" visibility="gone"/>
                
                <vertical id="ocr_cache_info" marginTop="10" visibility="gone">
                    <text textSize="12sp">缓存的位置数据:</text>
                    <horizontal>
                        <input id="ocr_cached_bounds_display" enabled="false" layout_weight="1" textSize="10sp"/>
                        <button id="ocr_copy_cache_btn" text="写入搜索区" style="Widget.AppCompat.Button.Borderless.Colored" />
                        <button id="ocr_clear_cache_btn" text="清除" style="Widget.AppCompat.Button.Borderless.Colored" />
                    </horizontal>
                </vertical>
            </vertical>
            
            <vertical id="image_fields" visibility="gone">
                <text>要查找的图片文件名:</text>
                <horizontal>
                    <input id="image_file" layout_weight="1" />
                    <button id="browse_image_file" text="..." w="auto" style="Widget.AppCompat.Button.Borderless.Colored"/>
                </horizontal>
                <text>相似度 (0.1-1.0):</text><input id="image_threshold" inputType="numberDecimal" />
                <text>超时时间 (ms):</text><input id="image_timeout" inputType="number" />
                
                <text text="成功后操作 (主动作):" marginTop="10" textStyle="bold"/>
                <spinner id="image_onSuccessAction" entries="点击找到的图片|执行返回|跳过(无操作)" />
                
                <horizontal id="image_click_offset_fields">
                    <text>点击偏移:</text>
                    <input id="image_offsetX" hint="X" inputType="numberSigned" w="60dp"/><input id="image_offsetY" hint="Y" inputType="numberSigned" w="60dp"/>
                </horizontal>

                <horizontal marginTop="5" gravity="center_vertical">
                    <text>后续操作:</text>
                    <spinner id="image_afterAction" entries="无|调用序列|终止序列" marginLeft="5" layout_weight="1"/>
                </horizontal>
                <spinner id="image_onSuccessSequence" entries="${onDemandEntries}" visibility="gone"/>

                <text text="失败后操作:" marginTop="10" textStyle="bold"/>
                <spinner id="image_onFailAction" entries="停止任务|跳过|调用序列" />
                <spinner id="image_onFailSequence" entries="${onDemandEntries}" visibility="gone"/>
                
                <vertical id="image_cache_info" marginTop="10" visibility="gone">
                    <text textSize="12sp">缓存的位置数据:</text>
                    <horizontal>
                        <input id="image_cached_bounds_display" enabled="false" layout_weight="1" textSize="10sp"/>
                        <button id="image_copy_cache_btn" text="写入搜索区" style="Widget.AppCompat.Button.Borderless.Colored" />
                        <button id="image_clear_cache_btn" text="清除" style="Widget.AppCompat.Button.Borderless.Colored" />
                    </horizontal>
                </vertical>
            </vertical>

            <vertical id="wait_for_dissapear_fields" visibility="gone">
                <text>目标类型:</text><spinner id="wfd_targetType" entries="图片|文本(OCR)" />
                <text>目标 (文件名/文本):</text><input id="wfd_target" />
                <horizontal>
                    <text>查找超时:</text><input id="wfd_findTimeout" inputType="number" layout_weight="1"/>
                    <text>消失超时:</text><input id="wfd_disappearTimeout" inputType="number" layout_weight="1"/>
                </horizontal>
                <vertical id="wfd_image_options">
                    <text>相似度:</text><input id="wfd_threshold" inputType="numberDecimal" />
                </vertical>
                <text>成功后(已消失):</text><spinner id="wfd_onSuccessAction" entries="跳过(无操作)|执行返回|调用序列" />
                <spinner id="wfd_onSuccessSequence" entries="${onDemandEntries}" visibility="gone"/>
                <text>失败后(未找到):</text><spinner id="wfd_onFailAction" entries="停止任务|跳过|调用序列" />
                <spinner id="wfd_onFailSequence" entries="${onDemandEntries}" visibility="gone"/>
                <text>超时后(未消失):</text><spinner id="wfd_onTimeoutAction" entries="停止任务|跳过|调用序列" />
                <spinner id="wfd_onTimeoutSequence" entries="${onDemandEntries}" visibility="gone"/>
            </vertical>
            
            <vertical id="search_area_fields" visibility="gone">
                 <text>搜索区域 (X1,Y1,X2,Y2):</text>
                 <horizontal>
                    <input id="sa_x1" hint="X1" inputType="number" layout_weight="1" textSize="14sp"/>
                    <input id="sa_y1" hint="Y1" inputType="number" layout_weight="1" textSize="14sp"/>
                    <input id="sa_x2" hint="X2" inputType="number" layout_weight="1" textSize="14sp"/>
                    <input id="sa_y2" hint="Y2" inputType="number" layout_weight="1" textSize="14sp"/>
                </horizontal>
            </vertical>

            <vertical id="cache_padding_fields" visibility="gone">
                 <text>缓存扩边 (Padding):</text><input id="cache_padding_input" inputType="number" />
            </vertical>
            
            <vertical id="launch_app_fields" visibility="gone"><text>App名称:</text><input id="launch_app_name" /></vertical>
            <vertical id="execute_sequence_fields" visibility="gone"><text>调用序列:</text><spinner id="execute_sequence_name" entries="${onDemandEntries}" /></vertical>
            <vertical id="start_monitor_fields" visibility="gone"><text>启动监控:</text><spinner id="start_monitor_name" entries="${monitorEntries}" /></vertical>
            <vertical id="stop_monitor_fields" visibility="gone"><text>停止监控:</text><spinner id="stop_monitor_name" entries="${monitorEntries}" /></vertical>
        </vertical>
    `;
    
    const view = ui.inflate(viewXML, null, false);

    // 1. 加载通用数据
    view.name.setText(task.name || '');
    view.delayMs.setText(String(task.delayMs || 0));
    view.taskEnabled.setChecked(task.enabled !== false);

    const fieldsToShow = [task.type + "_fields"];
    if (['ocr', 'image', 'wait_for_dissapear'].includes(task.type)) {
        fieldsToShow.push('search_area_fields');
        if (task.search_area) {
            view.sa_x1.setText(String(task.search_area[0]));
            view.sa_y1.setText(String(task.search_area[1]));
            view.sa_x2.setText(String(task.search_area[2]));
            view.sa_y2.setText(String(task.search_area[3]));
        }
    }
    if (['ocr', 'image'].includes(task.type)) {
        fieldsToShow.push('cache_padding_fields');
        view.cache_padding_input.setText(String(task.cachePadding !== undefined ? task.cachePadding : (appSettings.defaultCachePadding || 50)));
    }
    fieldsToShow.forEach(id => { if (view[id]) view[id].setVisibility(0) });

    // 2. 根据任务类型加载特定数据
    switch (task.type) {
        case 'wait': view.wait_duration.setText(String(task.duration || 1000)); break;
        case 'timer': view.timer_name.setText(task.timerName || ''); view.timer_duration.setText(String(task.duration || 10000)); break;
        case 'click':
            view.click_x.setText(String(task.x || 0)); view.click_y.setText(String(task.y || 0));
            view.click_offsetX.setText(String(task.offsetX || 0)); view.click_offsetY.setText(String(task.offsetY || 0));
            break;
        case 'swipe': 
            view.swipe_startX.setText(String(task.startX || 0)); view.swipe_startY.setText(String(task.startY || 0)); 
            view.swipe_endX.setText(String(task.endX || 0)); view.swipe_endY.setText(String(task.endY || 0)); 
            view.swipe_duration.setText(String(task.duration || 300)); 
            break;
        
        case 'ocr':
            view.ocr_textToFind.setText(task.textToFind || "");
            view.ocr_timeout.setText(String(task.timeout || 5000));
            
            // 2a. 加载主动作 (Click, Back, Skip)
            const ocrActionMap = {'click':0, 'back':1, 'skip':2}; // skip在这里表示"无操作"
            const ocrAction = (task.onSuccess && task.onSuccess.action) || 'click';
            view.ocr_onSuccessAction.setSelection(ocrActionMap[ocrAction] || 0);
            
            view.ocr_offsetX.setText(String((task.onSuccess && task.onSuccess.offsetX) || 0));
            view.ocr_offsetY.setText(String((task.onSuccess && task.onSuccess.offsetY) || 0));
            
            // 监听主动作变化 -> 隐藏/显示偏移
            view.ocr_onSuccessAction.setOnItemSelectedListener({
                onItemSelected: (p,v,pos,id) => { view.ocr_click_offset_fields.setVisibility(pos === 0 ? 0 : 8); }
            });
            // 初始显示状态
            view.ocr_click_offset_fields.setVisibility(view.ocr_onSuccessAction.getSelectedItemPosition() === 0 ? 0 : 8);

            // 2b. 加载后续操作 (None, Sequence, Terminate)
            let ocrAfterIndex = 0; // 0=None
            if (task.onSuccess && task.onSuccess.after === 'sequence') ocrAfterIndex = 1;
            else if (task.onSuccess && task.onSuccess.after === 'terminate') ocrAfterIndex = 2;
            view.ocr_afterAction.setSelection(ocrAfterIndex);

            if (ocrAfterIndex === 1 && onDemandSequences.length > 0) {
                // 【修复】使用 var 避免重复声明
                var idx = onDemandSequences.findIndex(s => s.id === task.onSuccess.sequenceName);
                if (idx > -1) view.ocr_onSuccessSequence.setSelection(idx);
            }
            
            // 监听后续操作变化 -> 显示序列选择器
            view.ocr_afterAction.setOnItemSelectedListener({
                onItemSelected: (p,v,pos,id) => { view.ocr_onSuccessSequence.setVisibility(pos === 1 ? 0 : 8); }
            });
            view.ocr_onSuccessSequence.setVisibility(ocrAfterIndex === 1 ? 0 : 8);

            // 2c. 失败操作
            if (task.onFail && task.onFail.action === 'execute_sequence') {
                view.ocr_onFailAction.setSelection(2);
                if (onDemandSequences.length > 0) {
                    // 【修复】使用 var
                    var idx = onDemandSequences.findIndex(s => s.id === task.onFail.sequenceName);
                    if (idx > -1) view.ocr_onFailSequence.setSelection(idx);
                }
            } else {
                view.ocr_onFailAction.setSelection((task.onFail && task.onFail.action === 'skip') ? 1 : 0);
            }
            view.ocr_onFailAction.setOnItemSelectedListener({
                onItemSelected: (p,v,pos,id) => { view.ocr_onFailSequence.setVisibility(pos === 2 ? 0 : 8); }
            });
            view.ocr_onFailSequence.setVisibility(view.ocr_onFailAction.getSelectedItemPosition() === 2 ? 0 : 8);

            // Cache Info
            if (task.cachedBounds) {
                view.ocr_cache_info.setVisibility(0);
                view.ocr_cached_bounds_display.setText(`[${task.cachedBounds.left},${task.cachedBounds.top},${task.cachedBounds.right},${task.cachedBounds.bottom}]`);
                view.ocr_clear_cache_btn.click(() => { task.cachedBounds = null; view.ocr_cache_info.setVisibility(8); toast("缓存已清除"); });
                view.ocr_copy_cache_btn.click(() => { const b=task.cachedBounds; view.sa_x1.setText(String(b.left)); view.sa_y1.setText(String(b.top)); view.sa_x2.setText(String(b.right)); view.sa_y2.setText(String(b.bottom)); toast("已写入"); });
            }
            break;

        case 'image':
            view.image_file.setText(task.imageFile || "");
            view.browse_image_file.click(() => { showImageSelectorDialog((f) => view.image_file.setText(f)); });
            view.image_threshold.setText(String(task.threshold || 0.8));
            view.image_timeout.setText(String(task.timeout || 5000));

            // 3a. 加载主动作
            const imgActionMap = {'click':0, 'back':1, 'skip':2};
            const imgAction = (task.onSuccess && task.onSuccess.action) || 'click';
            view.image_onSuccessAction.setSelection(imgActionMap[imgAction] || 0);
            
            view.image_offsetX.setText(String((task.onSuccess && task.onSuccess.offsetX) || 0));
            view.image_offsetY.setText(String((task.onSuccess && task.onSuccess.offsetY) || 0));
            
            view.image_onSuccessAction.setOnItemSelectedListener({
                onItemSelected: (p,v,pos,id) => { view.image_click_offset_fields.setVisibility(pos === 0 ? 0 : 8); }
            });
            view.image_click_offset_fields.setVisibility(view.image_onSuccessAction.getSelectedItemPosition() === 0 ? 0 : 8);

            // 3b. 加载后续操作
            let imgAfterIndex = 0; 
            if (task.onSuccess && task.onSuccess.after === 'sequence') imgAfterIndex = 1;
            else if (task.onSuccess && task.onSuccess.after === 'terminate') imgAfterIndex = 2;
            view.image_afterAction.setSelection(imgAfterIndex);

            if (imgAfterIndex === 1 && onDemandSequences.length > 0) {
                // 【修复】使用 var
                var idx = onDemandSequences.findIndex(s => s.id === task.onSuccess.sequenceName);
                if (idx > -1) view.image_onSuccessSequence.setSelection(idx);
            }
            
            view.image_afterAction.setOnItemSelectedListener({
                onItemSelected: (p,v,pos,id) => { view.image_onSuccessSequence.setVisibility(pos === 1 ? 0 : 8); }
            });
            view.image_onSuccessSequence.setVisibility(imgAfterIndex === 1 ? 0 : 8);

            // 3c. 失败操作
            if (task.onFail && task.onFail.action === 'execute_sequence') {
                view.image_onFailAction.setSelection(2);
                if (onDemandSequences.length > 0) {
                    // 【修复】使用 var
                    var idx = onDemandSequences.findIndex(s => s.id === task.onFail.sequenceName);
                    if (idx > -1) view.image_onFailSequence.setSelection(idx);
                }
            } else {
                view.image_onFailAction.setSelection((task.onFail && task.onFail.action === 'skip') ? 1 : 0);
            }
            view.image_onFailAction.setOnItemSelectedListener({
                onItemSelected: (p,v,pos,id) => { view.image_onFailSequence.setVisibility(pos === 2 ? 0 : 8); }
            });
            view.image_onFailSequence.setVisibility(view.image_onFailAction.getSelectedItemPosition() === 2 ? 0 : 8);

            // Cache Info
            if (task.cachedBounds) {
                view.image_cache_info.setVisibility(0);
                view.image_cached_bounds_display.setText(`x:${task.cachedBounds.x},y:${task.cachedBounds.y},w:${task.cachedBounds.width},h:${task.cachedBounds.height}`);
                view.image_clear_cache_btn.click(() => { task.cachedBounds = null; view.image_cache_info.setVisibility(8); toast("缓存已清除"); });
                view.image_copy_cache_btn.click(() => { const b=task.cachedBounds; view.sa_x1.setText(String(b.x)); view.sa_y1.setText(String(b.y)); view.sa_x2.setText(String(b.x+b.width)); view.sa_y2.setText(String(b.y+b.height)); toast("已写入"); });
            }
            break;

        case 'wait_for_dissapear':
            const isImg = task.targetType === 'image';
            view.wfd_targetType.setSelection(isImg ? 0 : 1);
            view.wfd_target.setText(task.target || "");
            view.wfd_findTimeout.setText(String(task.findTimeout || 5000));
            view.wfd_disappearTimeout.setText(String(task.disappearTimeout || 10000));
            if (isImg) view.wfd_threshold.setText(String(task.threshold || 0.8));
            
            function setupWfdSpinner(spinner, seqSpinner, actionObj, defAction, defSeqSelection) {
                if (actionObj && actionObj.action === 'execute_sequence') {
                    spinner.setSelection(2);
                    if (onDemandSequences.length > 0) {
                        // 【修复】使用 var
                        var idx = onDemandSequences.findIndex(s => s.id === actionObj.sequenceName);
                        if (idx > -1) seqSpinner.setSelection(idx);
                    }
                } else {
                    spinner.setSelection((actionObj && actionObj.action === defAction) ? 1 : 0);
                }
                seqSpinner.setVisibility(spinner.getSelectedItemPosition() === 2 ? 0 : 8);
            }
            // Success: Back(1) else Skip(0)
            setupWfdSpinner(view.wfd_onSuccessAction, view.wfd_onSuccessSequence, task.onSuccess, 'back', 'skip');
            // Fail: Skip(1) else Stop(0)
            setupWfdSpinner(view.wfd_onFailAction, view.wfd_onFailSequence, task.onFail, 'skip', 'stop');
            // Timeout: Skip(1) else Stop(0)
            setupWfdSpinner(view.wfd_onTimeoutAction, view.wfd_onTimeoutSequence, task.onTimeout, 'skip', 'stop');

            view.wfd_targetType.setOnItemSelectedListener({ onItemSelected: (p,v,pos) => view.wfd_image_options.setVisibility(pos===0?0:8) });
            view.wfd_onSuccessAction.setOnItemSelectedListener({ onItemSelected: (p,v,pos) => view.wfd_onSuccessSequence.setVisibility(pos===2?0:8) });
            view.wfd_onFailAction.setOnItemSelectedListener({ onItemSelected: (p,v,pos) => view.wfd_onFailSequence.setVisibility(pos===2?0:8) });
            view.wfd_onTimeoutAction.setOnItemSelectedListener({ onItemSelected: (p,v,pos) => view.wfd_onTimeoutSequence.setVisibility(pos===2?0:8) });
            break;

        case 'launch_app': view.launch_app_name.setText(task.appName || ""); break;
        case 'execute_sequence':
            if (onDemandSequences.length > 0) {
                // 【修复】使用 var
                var idx = onDemandSequences.findIndex(s => s.id === task.sequenceName);
                if (idx > -1) view.execute_sequence_name.setSelection(idx);
            }
            break;
        case 'start_monitor':
        case 'stop_monitor':
            if (monitorSequences.length > 0) {
                // 【修复】使用 var
                var idx = monitorSequences.findIndex(s => s.id === task.sequenceName);
                if (idx > -1) view[task.type + '_name'].setSelection(idx);
            }
            break;
    }

    // 3. 保存逻辑
    dialogs.build({ customView: view, title: `编辑任务`, positive: "保存", negative: "取消", neutral: "删除任务" })
        .on("positive", () => {
            task.name = view.name.getText().toString();
            task.delayMs = parseInt(view.delayMs.getText().toString()) || 0;
            task.enabled = view.taskEnabled.isChecked();

            // 序号处理
            const newOrderStr = view.order.getText().toString();
            if (!validateNumericInput(newOrderStr)) return;
            const newOrder = parseInt(newOrderStr);
            if (newOrder !== currentOrder && newOrder > 0 && newOrder <= taskList.length) {
                const currentTask = taskList.splice(currentOrder - 1, 1)[0];
                taskList.splice(newOrder - 1, 0, currentTask);
            }

            // Search Area & Padding
            // Search Area & Padding
            if (['ocr', 'image', 'wait_for_dissapear'].includes(task.type)) {
                const x1Str = view.sa_x1.getText().toString();
                const y1Str = view.sa_y1.getText().toString();
                const x2Str = view.sa_x2.getText().toString();
                const y2Str = view.sa_y2.getText().toString();
                
                // 只有当至少有一个框填写了内容时才保存
                if (x1Str || y1Str || x2Str || y2Str) {
                    const vx1 = parseInt(x1Str || "0");
                    const vy1 = parseInt(y1Str || "0");
                    const vx2 = parseInt(x2Str || String(device.width));
                    const vy2 = parseInt(y2Str || String(device.height));
                    
                    // ✅ 修复：正确计算左上角和右下角，不混淆X和Y
                    task.search_area = [
                        Math.min(vx1, vx2), // Left
                        Math.min(vy1, vy2), // Top
                        Math.max(vx1, vx2), // Right
                        Math.max(vy1, vy2)  // Bottom
                    ];
                } else {
                    delete task.search_area;
                }
            }
            if (['ocr', 'image'].includes(task.type)) {
                const pt = view.cache_padding_input.getText().toString();
                task.cachePadding = !isNaN(parseInt(pt)) ? parseInt(pt) : (appSettings.defaultCachePadding || 50);
            }

            // 具体任务保存
            switch (task.type) {
                case 'wait': task.duration = parseInt(view.wait_duration.getText().toString()) || 1000; break;
                case 'timer': task.timerName = view.timer_name.getText().toString(); task.duration = parseInt(view.timer_duration.getText().toString()) || 10000; break;
                case 'click':
                    task.x = parseFloat(view.click_x.getText().toString()) || 0; task.y = parseFloat(view.click_y.getText().toString()) || 0;
                    task.offsetX = parseInt(view.click_offsetX.getText().toString()) || 0; task.offsetY = parseInt(view.click_offsetY.getText().toString()) || 0;
                    break;
                case 'swipe':
                    task.startX = parseFloat(view.swipe_startX.getText().toString()) || 0; task.startY = parseFloat(view.swipe_startY.getText().toString()) || 0;
                    task.endX = parseFloat(view.swipe_endX.getText().toString()) || 0; task.endY = parseFloat(view.swipe_endY.getText().toString()) || 0;
                    task.duration = parseInt(view.swipe_duration.getText().toString()) || 300;
                    break;
                
                case 'ocr':
                    task.textToFind = view.ocr_textToFind.getText().toString();
                    task.timeout = parseInt(view.ocr_timeout.getText().toString()) || 5000;
                    
                    // 保存主动作
                    const ocrActions = ['click', 'back', 'skip']; // 对应 Spinner 索引
                    task.onSuccess = {
                        action: ocrActions[view.ocr_onSuccessAction.getSelectedItemPosition()],
                        offsetX: parseInt(view.ocr_offsetX.getText().toString()) || 0,
                        offsetY: parseInt(view.ocr_offsetY.getText().toString()) || 0
                    };

                    // 保存后续动作 (After)
                    const ocrAfterPos = view.ocr_afterAction.getSelectedItemPosition();
                    if (ocrAfterPos === 1) { // Sequence
                        task.onSuccess.after = 'sequence';
                        if (onDemandSequences.length > 0) {
                            task.onSuccess.sequenceName = onDemandSequences[view.ocr_onSuccessSequence.getSelectedItemPosition()].id;
                        }
                    } else if (ocrAfterPos === 2) { // Terminate
                        task.onSuccess.after = 'terminate';
                    } else {
                        task.onSuccess.after = 'none';
                    }

                    // 保存失败动作
                    const ocrFailPos = view.ocr_onFailAction.getSelectedItemPosition();
                    if (ocrFailPos === 2) {
                        if (onDemandSequences.length > 0) {
                            task.onFail = { action: 'execute_sequence', sequenceName: onDemandSequences[view.ocr_onFailSequence.getSelectedItemPosition()].id };
                        }
                    } else {
                        task.onFail = { action: ocrFailPos === 0 ? 'stop' : 'skip' };
                    }
                    break;

                case 'image':
                    task.imageFile = view.image_file.getText().toString();
                    task.threshold = parseFloat(view.image_threshold.getText().toString()) || 0.8;
                    task.timeout = parseInt(view.image_timeout.getText().toString()) || 5000;

                    // 保存主动作
                    const imgActions = ['click', 'back', 'skip'];
                    task.onSuccess = {
                        action: imgActions[view.image_onSuccessAction.getSelectedItemPosition()],
                        offsetX: parseInt(view.image_offsetX.getText().toString()) || 0,
                        offsetY: parseInt(view.image_offsetY.getText().toString()) || 0
                    };

                    // 保存后续动作
                    const imgAfterPos = view.image_afterAction.getSelectedItemPosition();
                    if (imgAfterPos === 1) {
                        task.onSuccess.after = 'sequence';
                        if (onDemandSequences.length > 0) {
                            task.onSuccess.sequenceName = onDemandSequences[view.image_onSuccessSequence.getSelectedItemPosition()].id;
                        }
                    } else if (imgAfterPos === 2) {
                        task.onSuccess.after = 'terminate';
                    } else {
                        task.onSuccess.after = 'none';
                    }

                    // 保存失败动作
                    const imgFailPos = view.image_onFailAction.getSelectedItemPosition();
                    if (imgFailPos === 2) {
                        if (onDemandSequences.length > 0) {
                            task.onFail = { action: 'execute_sequence', sequenceName: onDemandSequences[view.image_onFailSequence.getSelectedItemPosition()].id };
                        }
                    } else {
                        task.onFail = { action: imgFailPos === 0 ? 'stop' : 'skip' };
                    }
                    break;

                case 'wait_for_dissapear':
                    task.targetType = view.wfd_targetType.getSelectedItemPosition() === 0 ? 'image' : 'ocr';
                    task.target = view.wfd_target.getText().toString();
                    task.findTimeout = parseInt(view.wfd_findTimeout.getText().toString()) || 5000;
                    task.disappearTimeout = parseInt(view.wfd_disappearTimeout.getText().toString()) || 10000;
                    if (task.targetType === 'image') task.threshold = parseFloat(view.wfd_threshold.getText().toString()) || 0.8;
                    
                    const getWfdAct = (sp, seqSp, def) => {
                        const idx = sp.getSelectedItemPosition();
                        if (idx === 2) {
                            if (onDemandSequences.length > 0) return { action: 'execute_sequence', sequenceName: onDemandSequences[seqSp.getSelectedItemPosition()].id };
                            return { action: def };
                        }
                        return { action: idx === 1 ? def : (def==='back'?'skip':'stop') }; // Simplified mapping
                    };
                    
                    const wfdSuccIdx = view.wfd_onSuccessAction.getSelectedItemPosition();
                    if (wfdSuccIdx===2 && onDemandSequences.length>0) task.onSuccess = { action:'execute_sequence', sequenceName:onDemandSequences[view.wfd_onSuccessSequence.getSelectedItemPosition()].id };
                    else task.onSuccess = { action: wfdSuccIdx===1?'back':'skip' };

                    // Fail: Stop(0), Skip(1), Seq(2)
                    const wfdFailIdx = view.wfd_onFailAction.getSelectedItemPosition();
                    if (wfdFailIdx===2 && onDemandSequences.length>0) task.onFail = { action:'execute_sequence', sequenceName:onDemandSequences[view.wfd_onFailSequence.getSelectedItemPosition()].id };
                    else task.onFail = { action: wfdFailIdx===1?'skip':'stop' };

                    // Timeout: Stop(0), Skip(1), Seq(2)
                    const wfdToutIdx = view.wfd_onTimeoutAction.getSelectedItemPosition();
                    if (wfdToutIdx===2 && onDemandSequences.length>0) task.onTimeout = { action:'execute_sequence', sequenceName:onDemandSequences[view.wfd_onTimeoutSequence.getSelectedItemPosition()].id };
                    else task.onTimeout = { action: wfdToutIdx===1?'skip':'stop' };
                    break;

                case 'launch_app': task.appName = view.launch_app_name.getText().toString(); break;
                case 'execute_sequence':
                    if (onDemandSequences.length > 0) {
                        task.sequenceName = onDemandSequences[view.execute_sequence_name.getSelectedItemPosition()].id;
                    }
                    break;
                case 'start_monitor':
                case 'stop_monitor':
                    if (monitorSequences.length > 0) {
                        task.sequenceName = monitorSequences[view[task.type + '_name'].getSelectedItemPosition()].id;
                    } else {
                        toast("无法保存：没有可操作的监控序列。");
                        return;
                    }
                    break;
            }

            recreateAllTaskVisuals();
            saveCurrentProfileThrottled();
            toast("任务已保存");
            if (onSaveCallback) onSaveCallback();
        })
        .on("neutral", () => { dialogs.confirm("确定删除?", `将删除任务: ${task.name}`).then(ok => { if (ok) { taskList.splice(taskList.indexOf(task), 1); recreateAllTaskVisuals(); saveCurrentProfileThrottled(); toast("任务已删除"); if (onSaveCallback) onSaveCallback(); } }); })
        .on("negative", () => { if (onSaveCallback) onSaveCallback(); })
        .show();
}

// =================================================================================
// 辅助函数 (Utility Functions)
// =================================================================================

// --- 5.1.2 (V7 方案): 图片创建工作流 (从主窗口启动) ---
function launchImageCreationWorkflow() {
    if (appState.ui.pendingCropUri) {
        toast("错误：另一个图片创建流程已在进行中。");
        return;
    }

    // 启动系统图片选择器 (逻辑同 jpgtopng.js)
    try {
        let intent = new android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(android.content.Intent.CATEGORY_OPENABLE);
        intent.setType("image/*"); // 接受所有图片类型
        intent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
        activity.startActivityForResult(intent, CONSTANTS.REQUEST_CODES.NEW_IMAGE_SELECT);
    } catch (e) {
        logErrorToScreen("启动相册失败: " + e);
        toast("启动相册失败");
    }
}
// --- 5.1.2 新增结束 ---
// --- 5.1.2 (v3 修复) : 清理临时文件 ---
function cleanupTempCropFile() {
    let oldCroppedFile = files.join(files.cwd(), CONSTANTS.TEMP_FILES.CROP_OUTPUT);
    if (files.exists(oldCroppedFile)) {
        files.remove(oldCroppedFile);
        console.log("已清理旧的裁剪文件。");
    }
}
// =================================================================================
// 图片选择器 (V3: 支持预览/重命名/删除)
// =================================================================================
function showImageSelectorDialog(onImageSelected) {
    let imageDir = CONSTANTS.FILES.IMAGE_DIR;
    
    if (!files.exists(imageDir)) {
        files.ensureDir(imageDir);
        toast("图片目录 'images' 不存在，已自动创建。");
    }

    // 1. 创建 UI 框架
    const view = ui.inflate(
        <FrameLayout>
            <ScrollView> 
                <vertical id="image_list_container" padding="5"/>
            </ScrollView>
        </FrameLayout>, null, false
    );

    // 2. 动态设置高度
    let heightInPixels = Math.round(400 * device.density); 
    let layoutParams = new android.widget.FrameLayout.LayoutParams(
        android.view.ViewGroup.LayoutParams.MATCH_PARENT, 
        heightInPixels
    );
    view.setLayoutParams(layoutParams);

    const dialog = dialogs.build({
        customView: view,
        title: "请选择图片文件",
        negative: "取消"
    }).show();

    // 3. 封装列表刷新逻辑
    function refreshImageList() {
        ui.run(() => {
            view.image_list_container.removeAllViews();
            
            let imageFiles = files.listDir(imageDir, (name) => {
                name = name.toLowerCase();
                return name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg");
            });
            
            if (!imageFiles || imageFiles.length === 0) {
                 view.image_list_container.addView(ui.inflate(<text text="暂无图片，请点击主界面“新建”" gravity="center" padding="20" textColor="#999999"/>, null, false));
                 return;
            }

            imageFiles.sort();

            imageFiles.forEach(fileName => {
                const itemView = ui.inflate(
                    <card w="*" margin="4 2" cardCornerRadius="6dp" cardElevation="2dp" bg="{{CONSTANTS.UI.THEME.SECONDARY_CARD}}">
                        <horizontal w="*" gravity="center_vertical" padding="12 8" bg="?attr/selectableItemBackground">
                            <text id="image_icon" text="🖼️" textSize="16sp" marginRight="8"/>
                            <text id="image_name_label" 
                                textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" 
                                textSize="14sp"
                                layout_weight="1"
                                />
                             <text text="⋮" textColor="#888888" textSize="16sp" padding="4"/>
                        </horizontal>
                    </card>, 
                    view.image_list_container, false
                );

                itemView.image_name_label.setText(fileName);
                
                // --- 点击：选择图片 ---
                itemView.click(() => {
                    onImageSelected(fileName); 
                    dialog.dismiss();
                });
                
                // --- 长按：弹出管理菜单 ---
                itemView.longClick(() => {
                    // 新增了 "预览" 选项
                    const options = ["👁️ 预览 (Preview)", "✏️ 重命名 (Rename)", "🗑️ 删除 (Delete)", "取消"];
                    
                    dialogs.select(`操作: ${fileName}`, options).then(i => {
                        if (i < 0 || i === 3) return; // 取消
                        
                        const fullPath = files.join(imageDir, fileName);

                        if (i === 0) { // 预览
                            try {
                                // 核心逻辑：调用系统查看器打开文件
                                app.viewFile(fullPath);
                            } catch (e) {
                                toast("无法打开预览，请检查是否有相册应用");
                            }
                        } 
                        else if (i === 1) { // 重命名
                            dialogs.rawInput("请输入新文件名", fileName).then(newName => {
                                if (!newName) return;
                                newName = newName.trim();
                                if (newName === fileName) return;
                                
                                if (!newName.toLowerCase().match(/\.(png|jpg|jpeg)$/)) {
                                    const ext = fileName.substring(fileName.lastIndexOf("."));
                                    newName += ext;
                                }

                                const newPath = files.join(imageDir, newName);
                                if (files.exists(newPath)) {
                                    toast("文件名已存在！");
                                    return;
                                }

                                if (files.rename(fullPath, newName)) {
                                    toast("重命名成功");
                                    refreshImageList(); 
                                } else {
                                    toast("重命名失败");
                                }
                            });
                        } 
                        else if (i === 2) { // 删除
                            dialogs.confirm("确认删除?", `将永久删除图片:\n${fileName}`).then(ok => {
                                if (ok) {
                                    if (files.remove(fullPath)) {
                                        toast("已删除");
                                        refreshImageList(); 
                                    } else {
                                        toast("删除失败");
                                    }
                                }
                            });
                        }
                    });
                    return true; 
                });
                
                view.image_list_container.addView(itemView);
            });
        });
    }

    refreshImageList();
}
function showHelpDialog() {
    dialogs.build({ title: "帮助与说明", content: `【核心概念】\n1. 序列 (Sequence): 所有自动化流程的单元。每个序列都有自己的任务步骤和执行策略。\n\n2. 主序列 (⭐): 在序列管理器中长按指定，点击 ▶️ 按钮时运行的序列。\n\n3. 主监控 (🧿): 同样长按指定，是点击 👁️ 按钮时运行的后台监控序列。\n\n4. 执行策略: 定义序列如何运行。\n   - 序列: 作为主任务或子任务执行，可设置循环次数。\n   - 监控: 在后台持续运行，根据触发器（如找图）执行相应动作。`, positive: "我明白了" }).show();
}
function checkStoragePermissions() {
    try {
        var permissions = ["android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE"];
        var arePermissionsGranted = function () {
            for (var i = 0; i < permissions.length; i++) {
                if (context.checkSelfPermission(permissions[i]) != android.content.pm.PackageManager.PERMISSION_GRANTED) return false;
            }
            return true;
        };
        if (!arePermissionsGranted()) {
            toast("需要授予存储权限才能导入导出");
            runtime.requestPermissions(permissions);
            sleep(2000);
            if (!arePermissionsGranted()) {
                toast("未授予存储权限，操作中止");
                return false;
            }
        }
        return true;
    } catch (e) {
        toast("权限请求失败: " + e);
        logErrorToScreen("权限请求失败: " + e);
        return false;
    }
}
function showInstructionPanel(instructionText, buttonText, onConfirm, onCancel) {
    if (appState.ui.instructionWindow) {
        appState.ui.instructionWindow.close();
    }
    let win = floaty.rawWindow(<card cardCornerRadius="10dp" cardElevation="5dp" margin="10"><horizontal bg="#E0E0E0" padding="10" gravity="center_vertical"><text id="instruction_text" textColor="#000000" textSize="16sp" layout_weight="1" /><button id="cancel_btn" text="取消" style="?android:attr/borderlessButtonStyle" textColor="#757575" /><button id="confirm_btn" style="Widget.AppCompat.Button.Colored" /></horizontal></card>);
    win.setSize(-1, -2);
    win.setPosition(0, device.height / 2);
    ui.run(() => {
        win.instruction_text.setText(instructionText);
        win.confirm_btn.setText(buttonText);
        win.confirm_btn.click(() => { onConfirm(); win.close(); appState.ui.instructionWindow = null; });
        win.cancel_btn.click(() => { if (onCancel) onCancel(); win.close(); appState.ui.instructionWindow = null; });
    });
    appState.ui.instructionWindow = win;
}
function setupDraggable(view, onDragEnd, onDragMove, onLongPress, onClick, handle) {
    let x = 0, y = 0, winX = 0, winY = 0;
    let downTime = 0, hasMoved = false, longPressTimeout = null;
    const DRAG_THRESHOLD = 20;
    let targetView = handle || view;
    targetView.setOnTouchListener((v, event) => {
        switch (event.getAction()) {
            case event.ACTION_DOWN:
                x = event.getRawX(); y = event.getRawY();
                winX = view.getX(); winY = view.getY();
                downTime = new Date().getTime();
                hasMoved = false;
                if (onLongPress) {
                    longPressTimeout = setTimeout(() => {
                        if (!hasMoved) { onLongPress(); }
                        longPressTimeout = null;
                    }, CONSTANTS.UI.LONG_PRESS_DURATION_MS);
                }
                return true;
            case event.ACTION_MOVE:
                if (!hasMoved && Math.sqrt(Math.pow(event.getRawX() - x, 2) + Math.pow(event.getRawY() - y, 2)) > DRAG_THRESHOLD) {
                    hasMoved = true;
                    if (longPressTimeout) { clearTimeout(longPressTimeout); longPressTimeout = null; }
                }
                if (hasMoved) {
                    view.setPosition(winX + (event.getRawX() - x), winY + (event.getRawY() - y));
                    if (onDragMove) { onDragMove(); }
                }
                return true;
            case event.ACTION_UP:
                if (longPressTimeout) { clearTimeout(longPressTimeout); longPressTimeout = null; }
                if (hasMoved) { if (onDragEnd) { onDragEnd(view.getX(), view.getY()); } }
                else { if (new Date().getTime() - downTime < CONSTANTS.UI.CLICK_DURATION_MS) { if (onClick) { onClick(); } } }
                return true;
        }
        return false;
    });
}
function syncRedDotPosition() {
    if (!uiRefs.targetView || !uiRefs.redDot) return;
    let centerX = uiRefs.targetView.getX() + uiRefs.targetView.getWidth() / 2;
    let centerY = uiRefs.targetView.getY() + uiRefs.targetView.getHeight() / 2;
    let actualY = centerY - (appSettings.yOffset || statusBarHeight);
    uiRefs.redDot.setPosition(centerX - 15, actualY - 15);
}
function showClickDot(x, y) {
    ui.run(() => {
        const size = 40;
        let dot = floaty.rawWindow(<frame><view bg="#FF00FF00" w={size} h={size} style="border-radius:20px;" /></frame>);
        dot.setTouchable(false);
        dot.setSize(size, size);
        let actualY = y - (appSettings.yOffset || statusBarHeight);
        dot.setPosition(x - size / 2, actualY - size / 2);
        setTimeout(() => { if (dot) dot.close() }, 300);
    });
}
function closeTaskVisuals() { uiRefs.taskVisuals.forEach(v => { if (v.window) v.window.close(); if (v.startWindow) v.startWindow.close(); if (v.endWindow) v.endWindow.close(); }); uiRefs.taskVisuals = []; }
function applyButtonVisibility() { if (!uiRefs.controlPanel || !uiRefs.controlPanel.buttonsContainer) return; let visibility = (appSettings.controlButtonsHidden === true) ? 8 : 0; ui.run(() => { if (uiRefs.controlPanel && uiRefs.controlPanel.buttonsContainer) uiRefs.controlPanel.buttonsContainer.setVisibility(visibility); }); }
function toggleControlButtonsVisibility() { appSettings.controlButtonsHidden = !appSettings.controlButtonsHidden; applyButtonVisibility(); saveCurrentProfileThrottled(); updateProfileNameDisplay(); toast(appSettings.controlButtonsHidden ? "按钮已隐藏 (单击头部可恢复)" : "按钮已显示"); }
function validateAndResetWindowPosition(windowInstance) {
    if (!windowInstance) return;
    const screenW = device.width; const screenH = device.height;
    let winX = windowInstance.getX(); let winY = windowInstance.getY();
    const winW = windowInstance.getWidth(); const winH = windowInstance.getHeight();
    if (winW <= 0 || winH <= 0) return;
    let newX = Math.max(0, Math.min(winX, screenW - winW));
    let newY = Math.max(0, Math.min(winY, screenH - winH));
    if (newX !== winX || newY !== winY) {
        windowInstance.setPosition(newX, newY);
    }
}
function refreshAllUI() {
    if (uiRefs.targetView && uiRefs.targetView.root) {
        try { uiRefs.targetView.root.setBackgroundColor(android.graphics.Color.parseColor(appSettings.theme.targetViewColor)); } catch (e) { logErrorToScreen("目标视图颜色格式错误"); }
    }
    recreateAllTaskVisuals();
    ui.post(() => {
        if (!appState.isFloatyCreated) return;
        if (uiRefs.targetView) { uiRefs.targetView.setSize(appSettings.targetViewSize, appSettings.targetViewSize); }
        if (uiRefs.controlPanel) { uiRefs.controlPanel.setSize(appSettings.panelWidth, -2); }
        if (uiRefs.targetView && appSettings.mainTargetPos) { uiRefs.targetView.setPosition(appSettings.mainTargetPos.x, appSettings.mainTargetPos.y); }
        if (uiRefs.controlPanel && appSettings.controlPanelPos) { uiRefs.controlPanel.setPosition(appSettings.controlPanelPos.x, appSettings.controlPanelPos.y); }
        validateAndResetWindowPosition(uiRefs.targetView);
        validateAndResetWindowPosition(uiRefs.controlPanel);
        syncRedDotPosition();
        applyButtonVisibility();
        updateProfileNameDisplay();
        updatePositionDisplay();
    }, 50);
}
/**
 * (最终修正版) 更新悬浮窗上的“坐标”文本
 * (此函数显示 *悬浮窗* 的 *视觉* 坐标, 并应用 yOffset)
 */
function updatePositionDisplay() {
    if (uiRefs.controlPanel && uiRefs.controlPanel.positionText) {
        ui.run(() => {
            if (uiRefs.controlPanel && uiRefs.controlPanel.positionText) {
                if (appSettings.showPanelCoordinates) {
                    
                    // 1. 获取悬浮窗的“逻辑”坐标
                    let logicalX = uiRefs.controlPanel.getX();
                    let logicalY = uiRefs.controlPanel.getY();
                    
                    // 2. 计算“视觉”坐标 (y + offset)
                    let visualY = logicalY + (appSettings.yOffset || statusBarHeight);
                    
                    // 3. 使用您喜欢的 "X/Y" 格式显示“视觉”坐标
                    // (四舍五入以防万一)
                    uiRefs.controlPanel.positionText.setText(`${Math.round(logicalX)}/${Math.round(visualY)}`); 
                    
                    uiRefs.controlPanel.positionText.setVisibility(0);
                } else {
                    uiRefs.controlPanel.positionText.setVisibility(8);
                }
            }
        });
    }
}
function updateProfileNameDisplay() { 
    if (uiRefs.controlPanel && uiRefs.controlPanel.profileNameText) { 
        let displayName = currentProfileName.replace(CONSTANTS.FILES.PROFILE_PREFIX, '').replace('.json', ''); 
        
        // --- 核心修改：只使用 displayName ---
        let displayText = displayName; 
        
        ui.run(() => { 
            if (uiRefs.controlPanel && uiRefs.controlPanel.profileNameText) 
                uiRefs.controlPanel.profileNameText.setText(displayText); 
        }); 
    } 
}
function populateGraphicalSettings() {
    if (ui.clickDelayInput) {
        ui.run(() => {
            ui.clickDelayInput.setText(String(appSettings.clickDelayMs));
            ui.swipeDurationInput.setText(String(appSettings.swipe.duration));
            // 如果保存的yOffset无效(e.g. 0), 则使用自动计算的 statusBarHeight
            ui.yOffsetInput.setText(String(appSettings.yOffset || statusBarHeight));
            ui.panelWidthInput.setText(String(appSettings.panelWidth));
            ui.targetViewSizeInput.setText(String(appSettings.targetViewSize));
            if (!appSettings.theme) { appSettings.theme = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.theme)); }
            ui.showCoordsCheckbox.setChecked(appSettings.showPanelCoordinates === true);
            ui.targetColorInput.setText(appSettings.theme.targetViewColor);
            ui.useGestureSwipeCheckbox.setChecked(appSettings.useGestureSwipe === true);
            ui.clickTaskColorInput.setText(appSettings.theme.taskClickColor);
            ui.swipeTaskColorInput.setText(appSettings.theme.taskSwipeColor);
            // --- 在这里添加新行 ---
            ui.defaultCachePaddingInput.setText(String(appSettings.defaultCachePadding || 50));
            // --- 在这里添加新行 ---
            ui.defaultCachePaddingInput.setText(String(appSettings.defaultCachePadding || 50));
        });
    }
}

function logToScreen(message) {
    if (!ui.logView) return;

    let now = new Date();
    let timestamp = util.format("%d:%d:%d", now.getHours(), now.getMinutes(), now.getSeconds());
    const newMessage = timestamp + " - " + message;

    ui.run(() => {
        let currentText = ui.logView.getText().toString();
        let lines = currentText.split('\n');
        while (lines.length >= CONSTANTS.UI.MAX_LOG_LINES) { lines.shift(); }
        let updatedText = lines.join('\n');
        updatedText += (updatedText ? "\n" : "") + newMessage;
        ui.logView.setText(updatedText);
        ui.logScrollView.fullScroll(android.view.View.FOCUS_DOWN);
    });
}

function logErrorToScreen(message) {
    if (!ui.errorLogView) return;

    let now = new Date();
    let timestamp = util.format("%d:%d:%d", now.getHours(), now.getMinutes(), now.getSeconds());
    const newMessage = timestamp + " - ❌ " + message;

    ui.run(() => {
        let currentText = ui.errorLogView.getText().toString();
        let lines = currentText.split('\n');
        while (lines.length >= CONSTANTS.UI.MAX_LOG_LINES) { lines.shift(); }
        let updatedText = lines.join('\n');
        updatedText += (updatedText ? "\n" : "") + newMessage;
        ui.errorLogView.setText(updatedText);
        ui.errorLogScrollView.fullScroll(android.view.View.FOCUS_DOWN);
    });
}

function validateNumericInput(inputStr, allowFloat = false, allowSigned = false) {
    if (!inputStr || inputStr.trim() === "") { toast("输入不能为空"); return false; }
    const regex = allowSigned ?
        (allowFloat ? /^-?[\d.]+$/ : /^-?\d+$/) :
        (allowFloat ? /^\d*\.?\d+$/ : /^\d+$/);
    if (!regex.test(inputStr)) {
        toast(`请输入有效的${allowSigned ? "带符号" : ""}${allowFloat ? "" : "整"}数字格式`);
        return false;
    }
    return true;
}
// =================================================================================
// --- 在这里粘贴新函数 ---
// =================================================================================
/**
 * (V6 - 最终版：X/Y 独立OOB检测)
 * 计算带扩边（Padding）并限制在屏幕范围内的区域
 * @param {object} bounds - 原始边界 (可以是 {left, top, right, bottom} 或 {x, y, width, height})
 * @param {number} padding - 扩边像素
 * @returns {Array<number>} - 返回 [x, y, w, h] 格式的区域数组
 */
function calculatePaddedRegion(bounds, padding) {
    try {
        let x1_orig, y1_orig, x2_orig, y2_orig;
        padding = padding || 0; 
        
        const realWidth = getRealWidth();
        const realHeight = getRealHeight();

        // 1. 根据 bounds 类型，计算出带 padding 的 "原始" 坐标
        if (bounds.left !== undefined && bounds.right !== undefined) {
            x1_orig = bounds.left - padding;
            y1_orig = bounds.top - padding;
            x2_orig = bounds.right + padding;
            y2_orig = bounds.bottom + padding;
        } else if (bounds.x !== undefined && bounds.y !== undefined && bounds.width !== undefined && bounds.height !== undefined) {
            x1_orig = bounds.x - padding;
            y1_orig = bounds.y - padding;
            x2_orig = bounds.x + bounds.width + padding;
            y2_orig = bounds.y + bounds.height + padding;
        } else {
            logErrorToScreen("[calculatePaddedRegion] 无法识别的 bounds 格式: " + JSON.stringify(bounds));
            return [0, 0, 10, 10]; // Failsafe
        }
        
        let final_x1, final_y1, final_x2, final_y2;

        // 2. 【X 轴检查】检查 X 坐标是否完全 OOB (Out-of-Bounds)
        // (例如 x1=1560 > realWidth=1080)
        if (x1_orig >= realWidth || x2_orig <= 0) {
            // X 坐标已失效, 强制全宽搜索
            logToScreen(`[calculatePaddedRegion] 检测到 X 轴OOB (x=${x1_orig}), 强制全宽搜索。`);
            final_x1 = 0;
            final_x2 = realWidth;
        } else {
            // X 坐标未失效，使用标准钳制逻辑
            final_x1 = Math.max(0, Math.min(x1_orig, realWidth - 1));
            final_x2 = Math.max(0, Math.min(x2_orig, realWidth));
            // 确保 x1 < x2
            if (final_x1 >= final_x2) {
                final_x1 = (final_x2 > 0) ? final_x2 - 1 : 0;
            }
        }

        // 3. 【Y 轴检查】(新!) 检查 Y 坐标是否完全 OOB
        // (例如 y1=1800 > realHeight=1080)
        if (y1_orig >= realHeight || y2_orig <= 0) {
            // Y 坐标已失效, 强制全高搜索
            logToScreen(`[calculatePaddedRegion] 检测到 Y 轴OOB (y=${y1_orig}), 强制全高搜索。`);
            final_y1 = 0;
            final_y2 = realHeight;
        } else {
            // Y 坐标未失效，使用标准钳制逻辑
            final_y1 = Math.max(0, Math.min(y1_orig, realHeight - 1));
            final_y2 = Math.max(0, Math.min(y2_orig, realHeight));
            // 确保 y1 < y2
            if (final_y1 >= final_y2) {
                final_y1 = (final_y2 > 0) ? final_y2 - 1 : 0;
            }
        }

        // 4. 计算最终宽高
        let w = final_x2 - final_x1;
        let h = final_y2 - final_y1;

        return [final_x1, final_y1, Math.max(0, w), Math.max(0, h)];

    } catch (e) {
        logErrorToScreen("[calculatePaddedRegion] Error: " + e);
        return [0, 0, 10, 10]; // Failsafe
    }
}
// =================================================================================
// --- 在这里粘贴新函数 ---
// =================================================================================
/**
 * 执行一次安全的、防止越界的点击
 * (此版本【不】处理 yOffset, 仅做边界检查)
 * @param {number} x - 目标 x 坐标
 * @param {number} y - 目标 y 坐标
 * @param {number} duration - 按压时长
 */
function safePress(x, y, duration) {
    try {
        // 1. 将最终坐标限制在屏幕范围内
        // (使用 Math.round 以防坐标是浮点数, 并减 1 防止越界)
         // (需要 getRealWidth/Height 和 _clamp 辅助函数)
        const realWidth = getRealWidth();
        const realHeight = getRealHeight();
        let ry=realHeight;
        let rx=realWidth;
        let clampedX = Math.round(Math.max(0, Math.min(x, rx - 1)));
        let clampedY = Math.round(Math.max(0, Math.min(y, ry - 1)));
        
        // 2. 检查坐标是否被修正
        if (clampedX !== Math.round(x) || clampedY !== Math.round(y)) {
             logErrorToScreen(`[safePress] 坐标越界修正: (${Math.round(x)}, ${Math.round(y)}) -> (${clampedX}, ${clampedY})(屏幕: ${rx}x${ry})`);
        }

        // 3. 执行点击 (调用 Auto.js 原始的 press() 函数)
        press(clampedX, clampedY, duration);
        
    } catch (e) {
        logErrorToScreen(`[safePress Error] ${e} (Input: ${x},${y})`);
    }
}
// =================================================================================
// =================================================================================
// 文件与配置管理 (File & Configuration)
// =================================================================================
function saveMetaConfig() { files.write(CONSTANTS.FILES.META_CONFIG_FILE, JSON.stringify(metaConfig, null, 2)); }
function saveCurrentProfileThrottled() {
    const config = { version: CONSTANTS.VERSION, settings: appSettings, sequences: sequences };
    const profilePath = files.join(CONSTANTS.FILES.CONFIG_DIR, currentProfileName);
    files.write(profilePath, JSON.stringify(config, null, 2));
    metaConfig.lastProfile = currentProfileName;
    saveMetaConfig();
    if (appState.isFloatyCreated) updateProfileNameDisplay();
    displayConfigInEditor();
    populateGraphicalSettings();
}

function migrateLegacyProfile(legacyConfig) {
    logToScreen("检测到旧版方案 (无版本号，仅含tasks)，正在进行转换...");
    let newSequences = {};
    const validTasks = Array.isArray(legacyConfig.tasks) ? legacyConfig.tasks.filter(t => typeof t === 'object' && t !== null) : [];

    const mainTasks = validTasks.filter(t => t.type !== 'monitor');
    newSequences['main'] = {
        name: "主序列",
        executionPolicy: {
            mode: 'sequence',
            loopCount: (legacyConfig.settings && legacyConfig.settings.loopCount) || 1
        },
        tasks: mainTasks
    };

    const monitorTasks = validTasks.filter(t => t.type === 'monitor');
    monitorTasks.forEach((task, i) => {
        const key = (task.name || 'monitor_sequence_' + i).replace(/\s/g, '_');
        newSequences[key] = {
            name: task.name || '监控序列 ' + i,
            executionPolicy: {
                mode: 'monitor',
                interval: task.interval || 1000
            },
            triggers: task.triggers || [],
            tasks: []
        };
    });

    logToScreen("旧版方案转换成功！");
    return newSequences;
}

// --- 替换 loadLastUsedProfile (约 4436 行) ---
function loadLastUsedProfile() {
    // 【修改点】：添加 profileTimestamps 默认值
    const DEFAULTS = { lastProfile: null, hasSeenTutorial: false, profileTimestamps: {} };
    if (files.exists(CONSTANTS.FILES.META_CONFIG_FILE)) {
        try {
            const loadedMeta = JSON.parse(files.read(CONSTANTS.FILES.META_CONFIG_FILE));
            metaConfig = Object.assign({}, DEFAULTS, loadedMeta);
            if (!metaConfig.profileTimestamps) metaConfig.profileTimestamps = {}; // 确保初始化
            if (loadedMeta.mainSequenceKey) metaConfig.mainSequenceKey = loadedMeta.mainSequenceKey;
            if (loadedMeta.mainMonitorKey) metaConfig.mainMonitorKey = loadedMeta.mainMonitorKey;
        } catch (e) {
            logErrorToScreen("读取元配置文件失败，使用默认。");
            metaConfig = DEFAULTS;
        }
    }
    let profileToLoad = metaConfig.lastProfile || CONSTANTS.FILES.PROFILE_PREFIX + "default.json";
    loadProfile(profileToLoad);
}

// --- 替换 loadProfile (约 4475 行) ---
function loadProfile(profileName) {
    const profilePath = files.join(CONSTANTS.FILES.CONFIG_DIR, profileName);
    if (files.exists(profilePath)) {
        try {
            const configStr = files.read(profilePath);
            if (!configStr) throw new Error("文件为空。");

            const loadedConfig = JSON.parse(configStr);

            function mergeDeep(target, source) {
                for (var key in source) {
                    if (source.hasOwnProperty(key)) {
                        if (source[key] instanceof Object && key in target && target[key] instanceof Object) {
                            mergeDeep(target[key], source[key]);
                        } else {
                            target[key] = source[key];
                        }
                    }
                }
                return target;
            }

            let finalSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
            appSettings = mergeDeep(finalSettings, loadedConfig.settings || {});

            // MIGRATION: 保持迁移逻辑
            if (loadedConfig.settings && loadedConfig.settings.mainSequenceKey === undefined && metaConfig.mainSequenceKey) {
                logToScreen("正在迁移旧版全局主序列设置...");
                appSettings.mainSequenceKey = metaConfig.mainSequenceKey;
            }
            if (loadedConfig.settings && loadedConfig.settings.mainMonitorKey === undefined && metaConfig.mainMonitorKey) {
                logToScreen("正在迁移旧版全局主监控设置...");
                appSettings.mainMonitorKey = metaConfig.mainMonitorKey;
            }

            if (loadedConfig.version) {
                sequences = loadedConfig.sequences || {};
            } else if (loadedConfig.sequences) {
                sequences = loadedConfig.sequences;
            } else if (loadedConfig.tasks) {
                sequences = migrateLegacyProfile(loadedConfig);
            } else {
                sequences = {};
            }

            currentProfileName = profileName;

            // 【MRU 核心修改】: 更新时间戳并保存元数据
            metaConfig.profileTimestamps[profileName] = Date.now();
            saveMetaConfig();

            logToScreen(`方案 "${profileName.replace(CONSTANTS.FILES.PROFILE_PREFIX, '').replace('.json', '')}" 加载成功。`);
            return true;
        } catch (e) {
            logErrorToScreen(`加载方案 "${profileName}" 失败: ${e.message}。文件可能已损坏。`);
            toast(`加载方案失败: ${profileName.replace(CONSTANTS.FILES.PROFILE_PREFIX, '').replace('.json', '')}。将重置为默认方案。`);
            resetToDefaultProfile();
            return false;
        }
    } else {
        logToScreen(`方案文件不存在: ${profileName}，将使用默认方案。`);
        resetToDefaultProfile();
        return false;
    }
}
function resetToDefaultProfile() {
    currentProfileName = CONSTANTS.FILES.PROFILE_PREFIX + "default.json";
    appSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    sequences = {
        "main": {
            name: "主序列",
            executionPolicy: { mode: 'sequence', loopCount: 1 },
            tasks: []
        },
        "close_popup_example": {
            name: "关闭弹窗示例",
            executionPolicy: { mode: 'sequence' },
            tasks: [
                { "type": "wait", "name": "示例：等待1秒", "duration": 1000 },
                { "type": "back", "name": "示例：返回" }
            ]
        }
    };
    appSettings.mainSequenceKey = "main";
    appSettings.mainMonitorKey = null;
    saveCurrentProfileThrottled();
    logToScreen("已重置为默认方案。");
}
// =================================================================================
// 方案与权限管理 (Profile & Permission Manager) - 已修改
// =================================================================================
function showProfileManager() {
    if (isBusy()) return;

    // --- 1. 定义新的界面布局 (增加了顶部权限卡片) ---
    const dialogView = ui.inflate(
        <vertical>
            {/* --- 新增：权限状态与修复区域 --- */}
            <card w="*" margin="4 4 4 8" cardCornerRadius="8dp" cardElevation="2dp" bg="#F5F5F5">
                <vertical padding="12">
                    <horizontal gravity="center_vertical">
                        <text text="权限状态：" textStyle="bold" textColor="#333333" textSize="14sp"/>
                        <text id="permStatusText" text="正在检测..." layout_weight="1" textColor="#757575" textSize="12sp"/>
                    </horizontal>
                    
                    <View w="*" h="1dp" bg="#E0E0E0" margin="0 8"/>
                    
                    <horizontal>
                        <button id="repairPermBtn" text="🛠️ 申请/修复截图权限" layout_weight="1" style="Widget.AppCompat.Button.Colored" h="40dp" textSize="13sp"/>
                    </horizontal>
                </vertical>
            </card>

            {/* ---原有列表区域 --- */}
            <ScrollView h="350dp"> {/* 稍微调小高度给上方留空间 */}
                <vertical id="sequenceListContainer" />
            </ScrollView>
            
            <horizontal>
                <button id="showAppBtn" text="返回主窗口" layout_weight="1" style="Widget.AppCompat.Button.Borderless.Colored" />
            </horizontal>
        </vertical>, null, false);

    // 清理当前方案名称，用于显示
    let displayName = "未知";
    if (currentProfileName) {
        displayName = currentProfileName.replace(CONSTANTS.FILES.PROFILE_PREFIX, '').replace('.json', '');
    }
    const dialogTitle = `方案与权限 (当前: ${displayName})`;

    const dialog = dialogs.build({
        customView: dialogView,
        title: dialogTitle,
        positive: "关闭",
        neutral: "退出脚本"
    }).on("neutral", closeAllAndExit).show();

    // --- 2. 新增：权限检测与修复逻辑 ---
    
    // 辅助函数：更新UI状态显示
    function updatePermissionStatusUI() {
        ui.run(() => {
            if(!dialogView.permStatusText) return;
            dialogView.permStatusText.setText("正在检测...");
            dialogView.permStatusText.setTextColor(colors.parseColor("#757575"));
        });

        threads.start(function(){
            // 检测悬浮窗
            let floatyOk = floaty.hasPermission();
            
            // 检测截图 (尝试截取1x1像素来验证权限是否真的有效)
            let screenOk = false;
            try {
                let img = captureScreen();
                if(img) {
                    screenOk = true;
                    img.recycle();
                }
            } catch(e) {}

            ui.run(() => {
                if(!dialogView.permStatusText) return; // 防止窗口关闭后崩溃
                
                let statusStr = "";
                if(floatyOk) statusStr += "悬浮窗:✅  ";
                else statusStr += "悬浮窗:❌  ";

                if(screenOk) statusStr += "截图:✅";
                else statusStr += "截图:❌ (需修复)";

                dialogView.permStatusText.setText(statusStr);
                
                // 根据状态改变颜色
                if(floatyOk && screenOk) {
                    dialogView.permStatusText.setTextColor(colors.parseColor("#4CAF50")); // 绿色
                    dialogView.repairPermBtn.setText("✅ 权限正常 (点击强制刷新)");
                } else {
                    dialogView.permStatusText.setTextColor(colors.parseColor("#F44336")); // 红色
                    dialogView.repairPermBtn.setText("🛠️ 点击立即修复权限");
                }
            });
        });
    }

    // 绑定修复按钮点击事件
    dialogView.repairPermBtn.click(() => {
        // 防止重复点击
        dialogView.repairPermBtn.setEnabled(false);
        dialogView.repairPermBtn.setText("正在申请...");
        
        threads.start(function(){
            // 核心：请求截图权限
            let success = requestScreenCapture();
            
            ui.run(() => {
                dialogView.repairPermBtn.setEnabled(true);
                if(success) {
                    toast("申请成功！");
                } else {
                    toast("申请被取消或失败");
                }
                // 重新检测并刷新显示
                updatePermissionStatusUI();
            });
        });
    });

    // 窗口打开时自动检测一次
    updatePermissionStatusUI();

    // --- 3. 原有列表逻辑 (保持不变) ---
    function populateSequenceList(container) {
        ui.run(() => {
            container.removeAllViews();
            
            const profiles = files.listDir(CONSTANTS.FILES.CONFIG_DIR).filter(name => name.startsWith(CONSTANTS.FILES.PROFILE_PREFIX) && name.endsWith('.json'));

            // MRU 排序逻辑
            const sortedProfiles = profiles.map(name => {
                const timestamp = metaConfig.profileTimestamps[name] || 0;
                return { name, timestamp };
            })
            .sort((a, b) => {
                if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
                return a.name.localeCompare(b.name);
            })
            .map(p => p.name);

            const displayNames = sortedProfiles.map(name => name.replace(CONSTANTS.FILES.PROFILE_PREFIX, '').replace('.json', ''));
            displayNames.unshift("【创建新方案】");
            displayNames.push("【关闭】");

            sortedProfiles.forEach((key, index) => { 
                const displayName = displayNames[index + 1]; 
                
                const itemView = ui.inflate(
                    <card w="*" margin="8 4" cardCornerRadius="8dp" cardElevation="2dp" bg="{{CONSTANTS.UI.THEME.SECONDARY_CARD}}">
                        <horizontal w="*" gravity="center_vertical" padding="16 12">
                            <text id="seqIcon" textSize="18sp" marginRight="12" />
                            <text id="seqName" layout_weight="1" textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" ellipsize="end" maxLines="1" />
                            <text text=">" textColor="{{CONSTANTS.UI.THEME.SECONDARY_TEXT}}" />
                        </horizontal>
                    </card>, container, false);

                const isCurrent = key === currentProfileName;
                itemView.seqIcon.setText(isCurrent ? "⭐" : "🗂️");
                itemView.seqName.setText(displayName);

                itemView.click(() => {
                    if (loadProfile(key)) { 
                        saveCurrentProfileThrottled(); 
                        refreshAllUI(); 
                        if (ui.sequenceEditorView && ui.sequenceEditorView.getChildCount() > 0) {
                            ui.run(() => {
                                ui.sequenceEditorView.removeAllViews();
                                renderSequenceListEditor();
                            });
                        }
                        dialog.dismiss();
                        toast(`方案 "${displayName}" 加载成功`); 
                    }
                });

                itemView.longClick(() => {
                    const profileName = displayName;
                    let actions = ["加载", "另存为...", "删除"];
                    if (key === CONSTANTS.FILES.PROFILE_PREFIX + "default.json") {
                        actions.pop();
                    }
                    dialogs.select(`操作: [${profileName}]`, actions)
                        .then(actionIndex => {
                            if (actionIndex < 0) return;
                            switch (actions[actionIndex]) {
                                case "加载":
                                    if (loadProfile(key)) { 
                                        saveCurrentProfileThrottled(); 
                                        refreshAllUI(); 
                                        if (ui.sequenceEditorView && ui.sequenceEditorView.getChildCount() > 0) {
                                            ui.run(() => {
                                                ui.sequenceEditorView.removeAllViews();
                                                renderSequenceListEditor();
                                            });
                                        }
                                        populateSequenceList(container); 
                                        toast(`方案 "${displayName}" 加载成功`); 
                                    }
                                    break;
                                case "另存为...":
                                    dialogs.rawInput("输入新方案的名称", `${profileName}_copy`).then(newName => {
                                        newName = newName.trim();
                                        if (!newName || newName.includes('/') || newName.includes('\\') || newName === 'default') { toast("名称不合法!"); return; }
                                        const newProfileName = CONSTANTS.FILES.PROFILE_PREFIX + newName + ".json";
                                        const newProfilePath = files.join(CONSTANTS.FILES.CONFIG_DIR, newProfileName);
                                        if (files.exists(newProfilePath)) { toast("错误：同名方案已存在！"); return; }
                                        const sourceProfilePath = files.join(CONSTANTS.FILES.CONFIG_DIR, key);
                                        if (files.copy(sourceProfilePath, newProfilePath)) {
                                            currentProfileName = newProfileName;
                                            loadProfile(currentProfileName);
                                            saveCurrentProfileThrottled();
                                            refreshAllUI();
                                            populateSequenceList(container); 
                                            toast(`方案已另存为 "${newName}" 并加载！`);
                                        } else {
                                            toast("另存为失败！无法复制文件。");
                                        }
                                    });
                                    break;
                                case "删除":
                                    dialogs.confirm("确定删除?", `将永久删除方案: "${displayName}"`).then(ok => {
                                        if (ok) {
                                            const profilePath = files.join(CONSTANTS.FILES.CONFIG_DIR, key);
                                            if (files.remove(profilePath)) {
                                                if (currentProfileName === key) {
                                                    resetToDefaultProfile();
                                                    refreshAllUI();
                                                }
                                                populateSequenceList(container); 
                                                toast("删除成功");
                                            } else {
                                                toast("删除失败");
                                            }
                                        }
                                    });
                                    break;
                            }
                        });
                    return true;
                });
                container.addView(itemView);
            });
        });
    }

    dialogView.showAppBtn.click(() => {
        app.launch(context.getPackageName()); 
        toast("正在显示主窗口...");
        dialog.dismiss();
    });

    populateSequenceList(dialogView.sequenceListContainer);
}
function displayConfigInEditor() { if (!ui.configEditor) return; const config = { version: CONSTANTS.VERSION, settings: appSettings, sequences: sequences }; ui.run(() => { ui.configEditor.setText(JSON.stringify(config, null, 2)); }); }
function showImportExportDialog() { dialogs.select("导入/导出当前方案", ["导入 (覆盖当前)", "导出"]).then(i => { if (i < 0) return; if (i === 0) { importConfiguration(); } else if (i === 1) { exportConfiguration(); } }); }
function exportConfiguration() { threads.start(function () { if (!checkStoragePermissions()) { return; } try { const configStr = JSON.stringify({ version: CONSTANTS.VERSION, settings: appSettings, sequences: sequences }, null, 2); const backupDirName = "点点特工备份"; const backupPath = files.join(files.getSdcardPath(), backupDirName); files.ensureDir(backupPath); const defaultFileName = currentProfileName.replace(CONSTANTS.FILES.PROFILE_PREFIX, 'export_'); const defaultPath = files.join(backupPath, defaultFileName); dialogs.alert("导出当前方案", `方案将保存到公共目录。\n\n路径: ${defaultPath}`).then(() => { files.write(defaultPath, configStr); ui.run(() => toast("方案已成功导出！")); logToScreen(`方案已导出到 ${defaultPath}`); }); } catch (e) { ui.run(() => toast("导出失败: " + e)); logErrorToScreen(`导出失败: ${e}`); } }); }

function importConfiguration() {
    threads.start(function () {
        if (!checkStoragePermissions()) { return; }
        dialogs.confirm("导入配置", "这将覆盖您当前的全部任务和设置，确定吗？").then(ok => {
            if (ok) {
                const backupDirName = "点点特工备份";
                const backupPath = files.join(files.getSdcardPath(), backupDirName);
                files.ensureDir(backupPath);
                dialogs.rawInput(`请输入位于 "${backupDirName}" 文件夹中的配置文件名`, "export_default.json").then(fileName => {
                    if (!fileName) {
                        ui.run(() => toast("文件名不能为空"));
                        return;
                    }
                    const path = files.join(backupPath, fileName);
                    if (files.exists(path)) {
                        try {
                            let configStr = files.read(path);
                            const loadedConfig = JSON.parse(configStr);
                            if (!loadedConfig || (typeof loadedConfig.settings !== 'object' && !Array.isArray(loadedConfig.tasks) && typeof loadedConfig.sequences !== 'object')) {
                                throw new Error("配置文件格式不正确");
                            }

                            let newSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
                            Object.assign(newSettings, loadedConfig.settings);
                            appSettings = newSettings;

                            if (loadedConfig.sequences) {
                                sequences = loadedConfig.sequences;
                            } else {
                                sequences = migrateLegacyProfile(loadedConfig);
                            }

                            ui.run(() => {
                                saveCurrentProfileThrottled();
                                refreshAllUI();
                                toast("配置导入成功！");
                            });
                            logToScreen(`已从 ${path} 成功导入方案。`);
                        } catch (e) {
                            ui.run(() => toast("导入失败: " + e));
                            logErrorToScreen(`导入失败: ${e}`);
                        }
                    } else {
                        ui.run(() => toast("文件不存在: " + path));
                        logErrorToScreen(`导入失败，文件不存在: ${path}`);
                    }
                });
            }
        });
    });
}

// =================================================================================
// 退出与清理 (Exit & Cleanup)
// =================================================================================
function closeAllAndExit() {
    cleanupTempCropFile(); // <-- 【V3 修复】在这里添加清理
    stopExecution("应用退出，停止所有任务");
    stopMonitoring("应用退出，停止所有监控");
    // --- 在这里添加新行 ---
    if (appState.ui.systemTimeTimer) {
        clearInterval(appState.ui.systemTimeTimer);
        appState.ui.systemTimeTimer = null;
    }
    // --- 添加结束 ---
    for (let key in appState.threads) {
        if (appState.threads[key] && appState.threads[key].isAlive()) {
            appState.threads[key].interrupt();
        }
    }
    appState.threads = {};
    appState.activeMonitors = {};

    if (appState.ui.instructionWindow) appState.ui.instructionWindow.close();
    if (appState.ui.tutorialWindow) appState.ui.tutorialWindow.close();

    appState.ui.instructionWindow = null;
    appState.ui.tutorialWindow = null;

    if (uiRefs.targetView) uiRefs.targetView.close();
    if (uiRefs.redDot) uiRefs.redDot.close();
    if (uiRefs.controlPanel) uiRefs.controlPanel.close();
    closeTaskVisuals();
    appState.isFloatyCreated = false;
    toast("应用已退出。");
    exit();
}

