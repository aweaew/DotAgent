"ui";

// =================================================================================
// 脚本常量 (CONSTANTS)
// =================================================================================
const CONSTANTS = {
    VERSION: "1.2.2", // 版本号更新，修复引导窗口定位bug
    UI: {
        LONG_PRESS_DURATION_MS: 800,
        CLICK_DURATION_MS: 300,
        HIGHLIGHT_DURATION_MS: 1500,
        HIGHLIGHT_COLOR: "#FFEB3B",
        TASK_CLICK_VISUAL_SIZE: 80,
        TASK_SWIPE_VISUAL_SIZE: 80,
    },
    FILES: {
        CONFIG_DIR: context.getExternalFilesDir(null).getAbsolutePath(),
        META_CONFIG_FILE: files.join(context.getExternalFilesDir(null).getAbsolutePath(), "meta_config.json"),
        PROFILE_PREFIX: "profile_"
    }
};

const DEFAULT_SETTINGS = {
    mainTargetPos: { x: 300, y: 300 },
    controlPanelPos: { x: 100, y: 800 },
    clickDelayMs: 100,
    yOffset: 115,
    loopCount: 1,
    swipe: { duration: 300 },
    countdownSeconds: 3,
    controlButtonsHidden: false,
    panelWidth: 400,
    targetViewSize: 100,
    theme: {
        targetViewColor: "#55FF0000",
        taskClickColor: "#88FF0000",
        taskSwipeColor: "#8842A5F5"
    }
};


// =================================================================================
// 全局状态与引用 (Global State & References)
// =================================================================================

let appState = {
    isFloatyCreated: false,
    isExecuting: false,
    threads: {
        execution: null,
        countdown: null
    },
    ui: {
        instructionWindow: null,
        isJsonEditorVisible: false,
        tutorialWindow: null
    }
};

let uiRefs = {
    mainView: null,
    targetView: null,
    redDot: null,
    controlPanel: null,
    taskVisuals: [],
    swipeVisualizationWindows: []
};

let appSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
let taskSequence = [];
let currentProfileName = "";
let metaConfig = {};

let statusBarHeight = 0;
try {
    let statusBarId = context.resources.getIdentifier("status_bar_height", "dimen", "android");
    if (statusBarId > 0) {
        statusBarHeight = context.resources.getDimensionPixelSize(statusBarId);
    }
} catch (e) { /* 忽略错误 */ }

// =================================================================================
// 初始化与主逻辑 (UI & Main Logic)
// =================================================================================

ui.layout(
    <vertical gravity="top">
        <text id="mainTitle" textSize="20sp" textColor="#000000" text="点点点 自动化工具 (Pro)" padding="16 16 16 0" />
        <text textSize="14sp" textColor="#555555" text="点击下方按钮启动悬浮控制面板。" padding="16 8 16 0" />
        <button id="startFloatyBtn" text="启动悬浮窗口" margin="16 20 16 0" />

        <card w="*" margin="16 15 16 0" cardCornerRadius="8dp" cardElevation="2dp">
            <vertical>
                <horizontal padding="10" gravity="center_vertical">
                    <text text="配置与设置" textColor="#212121" textSize="16sp" layout_weight="1" />
                    <button id="toggleEditorBtn" text="切换至JSON模式" style="Widget.AppCompat.Button.Borderless.Colored" textSize="12sp" />
                </horizontal>

                <vertical id="graphicalSettingsView" padding="0 10 10 10">
                    <ScrollView h="200dp">
                        <vertical>
                            <horizontal gravity="center_vertical" marginTop="5"><text>循环次数:</text><input id="loopCountInput" inputType="number" layout_weight="1" singleLine="true" textSize="14sp" /></horizontal>
                            <horizontal gravity="center_vertical" marginTop="5"><text>点击后延迟(ms):</text><input id="clickDelayInput" inputType="number" layout_weight="1" singleLine="true" textSize="14sp" /></horizontal>
                            <horizontal gravity="center_vertical" marginTop="5"><text>默认滑动时长(ms):</text><input id="swipeDurationInput" inputType="number" layout_weight="1" singleLine="true" textSize="14sp" /></horizontal>
                            <horizontal gravity="center_vertical" marginTop="5"><text id="yOffsetTextLabel" text="Y轴偏移:" /><input id="yOffsetInput" inputType="number" layout_weight="1" singleLine="true" textSize="14sp" /></horizontal>
                            <horizontal gravity="center_vertical" marginTop="5"><text>独立倒计秒数:</text><input id="countdownSecondsInput" inputType="number" layout_weight="1" singleLine="true" textSize="14sp" /></horizontal>
                            <horizontal gravity="center_vertical" marginTop="5"><text>控制面板宽度:</text><input id="panelWidthInput" inputType="number" layout_weight="1" singleLine="true" textSize="14sp" /></horizontal>
                            <horizontal gravity="center_vertical" marginTop="5"><text>目标视图大小:</text><input id="targetViewSizeInput" inputType="number" layout_weight="1" singleLine="true" textSize="14sp" /></horizontal>
                            <text text="主题与颜色 (Hex格式: #AARRGGBB)" textColor="#757575" marginTop="10"/>
                            <horizontal gravity="center_vertical" marginTop="5"><text>目标视图颜色(🌟):</text><input id="targetColorInput" layout_weight="1" singleLine="true" textSize="14sp" /></horizontal>
                            <horizontal gravity="center_vertical" marginTop="5"><text>点击任务颜色(🎯):</text><input id="clickTaskColorInput" layout_weight="1" singleLine="true" textSize="14sp" /></horizontal>
                            <horizontal gravity="center_vertical" marginTop="5"><text>滑动任务颜色(S/E):</text><input id="swipeTaskColorInput" layout_weight="1" singleLine="true" textSize="14sp" /></horizontal>
                        </vertical>
                    </ScrollView>
                    <button id="saveGraphicalSettingsBtn" text="保存设置" marginTop="10" />
                </vertical>

                <vertical id="jsonEditorView" visibility="gone" padding="0 10 10 10">
                    <input id="configEditor" h="200dp" marginTop="5" singleLine="false" gravity="top" textSize="12sp" enabled="false" />
                    <button id="saveConfigBtn" text="保存JSON修改并应用" marginTop="10" enabled="false" />
                </vertical>
            </vertical>
        </card>

        <ScrollView layout_weight="1" margin="0 10 0 10">
            <vertical padding="6 5 6 16">
                <card w="*" cardCornerRadius="8dp" cardElevation="2dp" marginTop="15">
                    <vertical padding="10">
                        <horizontal gravity="center_vertical">
                            <text text="任务执行日志" textColor="#212121" textSize="16sp" layout_weight="1" />
                            <button id="clearLogBtn" text="清空" style="Widget.AppCompat.Button.Borderless" textSize="12sp" />
                        </horizontal>
                        <ScrollView id="logScrollView" h="200dp" marginTop="5" bg="#F5F5F5">
                            <text id="logView" padding="5" textSize="10sp" textColor="#333333" />
                        </ScrollView>
                    </vertical>
                </card>
                <button id="profileManagerBtn" text="方案管理与备份" marginTop="15" enabled="false" />
                <button id="importExportBtn" text="导入/导出" marginTop="10" enabled="false" />
                <button id="showHelpBtn" text="帮助与说明" marginTop="10" />
                <button id="exitAppBtn" text="退出应用" marginTop="20" />
            </vertical>
        </ScrollView>
    </vertical>
);
uiRefs.mainView = ui;
ui.mainTitle.setText(`点点点 自动化工具 (Pro) v${CONSTANTS.VERSION}`);
ui.yOffsetTextLabel.setText(`Y轴偏移 (状态栏高: ${statusBarHeight}):`);
logToScreen("应用界面已加载。");

// -- 主界面按钮事件绑定 --
ui.exitAppBtn.click(closeAllAndExit);
ui.showHelpBtn.click(showHelpDialog);
ui.startFloatyBtn.click(function () {
    if (appState.isFloatyCreated) {
        toast("悬浮窗口已运行，无需重复启动。");
        return;
    }
    if (!checkPermissions()) return;
    logToScreen("权限检查通过，正在启动悬浮窗...");
    ui.startFloatyBtn.setEnabled(false);
    ui.startFloatyBtn.setText("正在启动中...");
    threads.start(function () {
        sleep(800);
        createTargetView();
        createRedDot();
        ui.run(() => { createControlPanel(); });
        let waitMs = 0;
        while (!uiRefs.controlPanel && waitMs < 3000) {
            sleep(200);
            waitMs += 200;
        }
        if (!uiRefs.targetView || !uiRefs.redDot || !uiRefs.controlPanel) {
            ui.run(() => {
                toast("浮窗创建失败，请检查权限或重启");
                logToScreen("❌ 浮窗创建失败。");
                ui.startFloatyBtn.setEnabled(true);
                ui.startFloatyBtn.setText("启动悬浮窗口");
            });
            return;
        }
        appState.isFloatyCreated = true;
        loadLastUsedProfile();
        ui.run(() => {
            refreshAllUI();
            populateGraphicalSettings();
            ui.configEditor.setEnabled(true);
            ui.saveConfigBtn.setEnabled(true);
            ui.profileManagerBtn.setEnabled(true);
            ui.importExportBtn.setEnabled(true);
            ui.startFloatyBtn.setEnabled(true);
            ui.startFloatyBtn.setText("启动悬浮窗口");
            logToScreen(`✅ 悬浮窗启动成功！当前方案: ${currentProfileName.replace(CONSTANTS.FILES.PROFILE_PREFIX, '').replace('.json', '')}`);
            toast("悬浮窗口已启动！");
            activity.moveTaskToBack(true);
            if (!metaConfig.hasSeenTutorial) {
                startTutorial();
            }
        });
    });
});
ui.profileManagerBtn.click(() => {
    if (appState.isFloatyCreated) showProfileManager();
    else toast("请先启动悬浮窗口");
});
ui.importExportBtn.click(() => {
    if (appState.isFloatyCreated) showImportExportDialog();
    else toast("请先启动悬浮窗口");
});
ui.saveConfigBtn.click(() => {
    if (!appState.isFloatyCreated) {
        toast("请先启动悬浮窗口后再保存");
        return;
    }
    try {
        const editorText = ui.configEditor.getText().toString();
        const newConfig = JSON.parse(editorText);
        if (!newConfig || typeof newConfig.settings !== 'object' || !Array.isArray(newConfig.tasks)) {
            throw new Error("配置文件格式不正确，缺少settings或tasks字段");
        }
        appSettings = newConfig.settings;
        taskSequence = newConfig.tasks;
        saveCurrentProfile();
        refreshAllUI();
        logToScreen("配置已通过JSON编辑器保存。");
        toast("修改已保存并应用！");
    } catch (e) {
        logToScreen("JSON保存失败: " + e.message);
        dialogs.alert("保存失败！", "JSON格式无效或内容不合法，请检查您的修改。\n\n错误详情: " + e.message);
    }
});
ui.saveGraphicalSettingsBtn.click(() => {
    try {
        const loopCountStr = ui.loopCountInput.getText().toString();
        const clickDelayStr = ui.clickDelayInput.getText().toString();
        const swipeDurationStr = ui.swipeDurationInput.getText().toString();
        const yOffsetStr = ui.yOffsetInput.getText().toString();
        const countdownSecondsStr = ui.countdownSecondsInput.getText().toString();
        const panelWidthStr = ui.panelWidthInput.getText().toString();
        const targetViewSizeStr = ui.targetViewSizeInput.getText().toString();
        if (!validateNumericInput(loopCountStr) || !validateNumericInput(clickDelayStr) || !validateNumericInput(swipeDurationStr) || !validateNumericInput(yOffsetStr) || !validateNumericInput(countdownSecondsStr) || !validateNumericInput(panelWidthStr) || !validateNumericInput(targetViewSizeStr)) {
            return;
        }
        appSettings.loopCount = parseInt(loopCountStr);
        appSettings.clickDelayMs = parseInt(clickDelayStr);
        appSettings.swipe.duration = parseInt(swipeDurationStr);
        appSettings.yOffset = parseInt(yOffsetStr);
        appSettings.countdownSeconds = parseInt(countdownSecondsStr);
        appSettings.panelWidth = parseInt(panelWidthStr);
        appSettings.targetViewSize = parseInt(targetViewSizeStr);
        appSettings.theme.targetViewColor = ui.targetColorInput.getText().toString();
        appSettings.theme.taskClickColor = ui.clickTaskColorInput.getText().toString();
        appSettings.theme.taskSwipeColor = ui.swipeTaskColorInput.getText().toString();
        saveCurrentProfile();
        if (appState.isFloatyCreated) {
            refreshAllUI();
        }
        logToScreen("设置已通过图形化面板保存。");
        toast("设置已保存并应用！");
    } catch (e) {
        logToScreen("图形化设置保存失败: " + e.message);
        toast("保存失败: " + e.message);
    }
});
ui.toggleEditorBtn.click(() => {
    appState.isJsonEditorVisible = !appState.isJsonEditorVisible;
    if (appState.isJsonEditorVisible) {
        ui.graphicalSettingsView.setVisibility(8);
        ui.jsonEditorView.setVisibility(0);
        ui.toggleEditorBtn.setText("切换至图形模式");
        displayConfigInEditor();
    } else {
        ui.jsonEditorView.setVisibility(8);
        ui.graphicalSettingsView.setVisibility(0);
        ui.toggleEditorBtn.setText("切换至JSON模式");
        populateGraphicalSettings();
    }
});
ui.clearLogBtn.click(() => {
    ui.logView.setText("");
    logToScreen("日志已清空。");
});

// =================================================================================
// 新手引导功能 (New User Tutorial)
// =================================================================================
function startTutorial() {
    let step = 0;
    // **[FIXED]** 优化了 position 函数，使其能智能判断位置
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
            text: "将目标视图移动到想点击的位置，\n然后按【添加任务】->【点击任务】即可创建一个点。",
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
        () => uiRefs.controlPanel,
    ];

    // 新的辅助函数，用于计算引导位置
    function getTutorialPosition(targetWindow, preference) {
        if (!targetWindow) return { x: device.width / 4, y: device.height / 3 };

        const targetX = targetWindow.getX();
        const targetY = targetWindow.getY();
        const targetH = targetWindow.getHeight();
        const estTutorialH = 250; // 预估的引导窗口高度
        const spacing = 20;

        let yPos;

        if (preference === 'above') {
            yPos = targetY - estTutorialH - spacing;
        } else if (preference === 'below') {
            yPos = targetY + targetH + spacing;
        } else { // auto
            if (targetY + targetH + estTutorialH + spacing > device.height) {
                // 如果下方空间不足，则放到上方
                yPos = targetY - estTutorialH - spacing;
            } else {
                // 否则放到下方
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
                    <text id="text" textColor="#FFFFFF" textSize="18sp" textStyle="bold" gravity="center"/>
                    <button id="nextBtn" text="下一步" marginTop="20"/>
                </vertical>
            </card>
        );
        appState.ui.tutorialWindow.text.setText(currentStep.text);
        appState.ui.tutorialWindow.setSize(device.width / 2, -2);
        appState.ui.tutorialWindow.setPosition(pos.x, pos.y);
        
        // 使用延时确保窗口尺寸计算完成后再验证位置
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
// 核心功能：任务序列执行 (Core Execution)
// =================================================================================
function isBusy() {
    if (appState.ui.instructionWindow || appState.ui.tutorialWindow) {
        toast("请先完成或取消当前的操作");
        return true;
    }
    return false;
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
    if (taskSequence.length === 0) {
        toast("任务序列为空，请先添加任务。");
        return;
    }
    appState.isExecuting = true;
    updateControlButtonText("正在执行...", "stop");
    const executionThread = threads.start(function () {
        try {
            logToScreen(`任务序列开始，共 ${appSettings.loopCount} 轮。`);
            for (let loop = 1; loop <= appSettings.loopCount; loop++) {
                if (!appState.isExecuting) break;
                logToScreen(`第 ${loop} / ${appSettings.loopCount} 轮开始`);
                for (let i = 0; i < taskSequence.length; i++) {
                    if (!appState.isExecuting) break;
                    let task = taskSequence[i];
                    if (!task) {
                        logToScreen(`警告: 在第 ${i + 1} 个位置发现无效任务，可能在执行期间被修改。跳过此任务。`);
                        continue;
                    }
                    logToScreen(`执行任务 ${i + 1}: [${task.type}] ${task.name}`);
                    switch (task.type) {
                        case 'click':
                            showClickDot(task.x, task.y);
                            press(task.x, task.y, 50);
                            sleep(appSettings.clickDelayMs);
                            break;
                        case 'wait':
                            toast(`执行: ${task.name}`);
                            sleep(task.duration);
                            break;
                        case 'swipe':
                            toast(`执行: ${task.name}`);
                            swipe(task.startX, task.startY, task.endX, task.endY, task.duration);
                            sleep(appSettings.clickDelayMs);
                            break;
                    }
                }
                if (!appState.isExecuting) break;
                logToScreen(`第 ${loop} 轮执行完毕。`);
            }
        } catch (e) {
            if (!(e instanceof java.lang.ThreadDeath)) {
                logToScreen("任务执行异常: " + e);
                ui.run(() => toast("任务执行出现异常，详情请查看日志！"));
            }
        }
    });
    appState.threads.execution = executionThread;
    threads.start(function () {
        executionThread.join();
        if (appState.isExecuting) {
            stopExecution("任务序列执行完毕");
        }
    });
}
function stopExecution(message) {
    if (!appState.isExecuting && !appState.threads.execution) return;
    appState.isExecuting = false;
    if (appState.threads.execution && appState.threads.execution.isAlive()) {
        appState.threads.execution.interrupt();
    }
    appState.threads.execution = null;
    toast(message);
    logToScreen(message);
    updateControlButtonText("执行序列", "start");
}
function updateControlButtonText(text, state) {
    if (uiRefs.controlPanel) {
        ui.run(() => {
            if (uiRefs.controlPanel && uiRefs.controlPanel.executeBtn) {
                uiRefs.controlPanel.executeBtn.setText(text);
            }
        });
    }
}
function runCountdown(seconds) {
    let countdownWindow;
    try {
        ui.run(() => {
            countdownWindow = floaty.rawWindow(<frame bg="#80000000" gravity="center"><text id="countdownText" text="" textSize="80sp" textColor="#FFFFFF" textStyle="bold" /></frame>);
            countdownWindow.setSize(-1, -1);
            countdownWindow.setTouchable(false);
        });
        for (let i = seconds; i > 0; i--) {
            if (appState.isExecuting) break;
            ui.run(() => {
                if (countdownWindow && countdownWindow.countdownText) {
                    countdownWindow.countdownText.setText(String(i));
                }
            });
            sleep(1000);
        }
    } catch (e) {
        if (!(e instanceof java.lang.ThreadDeath)) logToScreen("倒计时发生未知错误: " + e);
    } finally {
        ui.run(() => { if (countdownWindow) countdownWindow.close(); });
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
    auto.waitFor();
    return true;
}
function createTargetView() {
    uiRefs.targetView = floaty.rawWindow(<frame id="root"><text id="label" text="🌟" textSize="24sp" bg="#00000000" gravity="center" /></frame>);
    try {
        uiRefs.targetView.root.setBackgroundColor(android.graphics.Color.parseColor(appSettings.theme.targetViewColor));
    } catch(e) {
        logToScreen("目标视图颜色格式错误，使用默认色");
        uiRefs.targetView.root.setBackgroundColor(android.graphics.Color.parseColor(DEFAULT_SETTINGS.theme.targetViewColor));
    }
    uiRefs.targetView.setSize(appSettings.targetViewSize, appSettings.targetViewSize);
    uiRefs.targetView.setPosition(appSettings.mainTargetPos.x, appSettings.mainTargetPos.y);
    ui.run(() => {
        setupDraggable(uiRefs.targetView,
            (x, y) => { appSettings.mainTargetPos = { x, y }; saveCurrentProfile(); syncRedDotPosition(); },
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
    uiRefs.controlPanel = floaty.rawWindow(
        <vertical id="mainLayout" bg="#DDDDDD" padding="5">
            <horizontal id="headerBar" gravity="center_vertical" w="*" padding="5">
                <text id="a_dragHandle" text="✥ " textSize="20sp" textColor="#757575" />
                <text id="profileNameText" textSize="10sp" textColor="#333333" layout_weight="1" />
                <text id="positionText" textSize="10sp" textColor="#333333" gravity="right" />
            </horizontal>
            <vertical id="buttonsContainer" padding="5 0 0 0">
                <button id="executeBtn" text="执行序列" />
                <button id="singleClickBtn" text="单次点击" />
                <button id="countdownBtn" text="独立倒计时" />
                <button id="addTaskBtn" text="添加任务" />
                <button id="manageBtn" text="管理与设置" />
            </vertical>
        </vertical>
    );
    uiRefs.controlPanel.setSize(appSettings.panelWidth, -2);
    uiRefs.controlPanel.setPosition(appSettings.controlPanelPos.x, appSettings.controlPanelPos.y);
    ui.post(() => {
        if (!uiRefs.controlPanel) return;
        setupDraggable(
            uiRefs.controlPanel,
            (x, y) => { appSettings.controlPanelPos = { x, y }; saveCurrentProfile(); },
            updatePositionDisplay,
            null,
            toggleControlButtonsVisibility,
            uiRefs.controlPanel.headerBar
        );
        uiRefs.controlPanel.singleClickBtn.click(() => {
            if (isBusy()) return;
            if (uiRefs.targetView) {
                let x = uiRefs.targetView.getX() + uiRefs.targetView.getWidth() / 2;
                let y = uiRefs.targetView.getY() + uiRefs.targetView.getHeight() / 2;
                threads.start(function () {
                    showClickDot(x, y);
                    press(x, y, 50);
                    toast("已执行单次点击");
                });
            }
        });
        uiRefs.controlPanel.countdownBtn.click(() => {
            if (isBusy()) return;
            if (appState.threads.countdown && appState.threads.countdown.isAlive()) {
                appState.threads.countdown.interrupt();
            }
            if (appSettings.countdownSeconds > 0) {
                appState.threads.countdown = threads.start(() => runCountdown(appSettings.countdownSeconds));
            } else {
                toast("请先在设置中设定一个大于0的倒计时秒数");
            }
        });
        uiRefs.controlPanel.executeBtn.click(toggleSequenceExecution);
        uiRefs.controlPanel.addTaskBtn.click(showAddTaskDialog);
        uiRefs.controlPanel.manageBtn.click(showManagementDialog);
    });
    applyButtonVisibility();
}
function createTaskWindow(task, index) {
    let win = floaty.rawWindow(<frame id="root" padding="5"><text id="label" textSize="18sp" textColor="#FFFFFF" gravity="center" /></frame>);
    let color;
    try { color = android.graphics.Color.parseColor(appSettings.theme.taskClickColor); } catch(e) { color = android.graphics.Color.parseColor(DEFAULT_SETTINGS.theme.taskClickColor); }
    win.root.setBackgroundColor(color);
    win.setSize(CONSTANTS.UI.TASK_CLICK_VISUAL_SIZE, -2);
    ui.post(() => win.setPosition(task.x - win.getWidth() / 2, task.y - win.getHeight() / 2));
    ui.run(() => win.label.setText(`🎯${index + 1}`));
    setupDraggable(win, (x, y) => {
        task.x = x + win.getWidth() / 2;
        task.y = y + win.getHeight() / 2;
        saveCurrentProfile();
        toast(`任务 ${index + 1} 位置已更新`);
    }, null, null, () => showTaskEditor(taskSequence[index], index), win.root);
    uiRefs.taskVisuals[index] = { type: 'click', window: win, originalBg: appSettings.theme.taskClickColor };
}
function createSwipeVisuals(task, index) {
    const visual = { type: 'swipe', startWindow: null, endWindow: null, originalBg: appSettings.theme.taskSwipeColor };
    function createMarker(text, x, y, onClickCallback) {
        let win = floaty.rawWindow(<frame id="root" w="40" h="40" style="border-radius:20px;"><text text={text} gravity="center" textColor="#FFFFFF" textSize="16sp" textStyle="bold" /></frame>);
        let color;
        try { color = android.graphics.Color.parseColor(visual.originalBg); } catch(e) { color = android.graphics.Color.parseColor(DEFAULT_SETTINGS.theme.taskSwipeColor); }
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
            saveCurrentProfile();
        }, null, null, onClickCallback, win.root);
        return win;
    }
    const onClick = () => showTaskEditor(taskSequence[index], index);
    visual.startWindow = createMarker(`S${index + 1}`, task.startX, task.startY, onClick);
    visual.endWindow = createMarker(`E${index + 1}`, task.endX, task.endY, onClick);
    uiRefs.taskVisuals[index] = visual;
}
function recreateAllTaskVisuals() {
    closeTaskVisuals();
    taskSequence.forEach((task, index) => {
        if (task.type === 'click') {
            createTaskWindow(task, index);
        } else if (task.type === 'swipe') {
            createSwipeVisuals(task, index);
        }
    });
}
function highlightTaskVisual(index) {
    const visual = uiRefs.taskVisuals[index];
    if (!visual) return;
    function setHighlight(win, highlight) {
        if (win && win.root) {
            ui.run(() => {
                let color;
                try { color = android.graphics.Color.parseColor(highlight ? CONSTANTS.UI.HIGHLIGHT_COLOR : visual.originalBg); } catch(e) { color = android.graphics.Color.parseColor(CONSTANTS.UI.HIGHLIGHT_COLOR); }
                win.root.setBackgroundColor(color);
            });
        }
    }
    if (visual.type === 'click') {
        setHighlight(visual.window, true);
        setTimeout(() => setHighlight(visual.window, false), CONSTANTS.UI.HIGHLIGHT_DURATION_MS);
    } else if (visual.type === 'swipe') {
        setHighlight(visual.startWindow, true);
        setHighlight(visual.endWindow, true);
        setTimeout(() => {
            setHighlight(visual.startWindow, false);
            setHighlight(visual.endWindow, false);
        }, CONSTANTS.UI.HIGHLIGHT_DURATION_MS);
    }
}

// =================================================================================
// 任务管理 & 设置 (Management & Settings)
// =================================================================================
function showAddTaskDialog() {
    if (isBusy()) return;
    dialogs.select("请选择要添加的任务类型", ["[点击] 任务", "[滑动] 任务", "[等待] 任务"])
        .then(i => {
            if (i < 0) return;
            switch (i) {
                case 0: addClickTask(); break;
                case 1: addSwipeTask(); break;
                case 2: addWaitTask(); break;
            }
        });
}
function addClickTask() {
    let x = uiRefs.targetView.getX() + uiRefs.targetView.getWidth() / 2;
    let y = uiRefs.targetView.getY() + uiRefs.targetView.getHeight() / 2;
    let newIndex = taskSequence.length;
    let name = "点击任务 " + (newIndex + 1);
    let task = { type: 'click', name: name, x: x, y: y };
    taskSequence.push(task);
    createTaskWindow(task, newIndex);
    saveCurrentProfile();
    logToScreen(`已添加新任务: ${name}`);
    toast(`已添加: ${name}`);
}
function addSwipeTask() {
    if (isBusy()) return;
    let tempPos = {};
    showInstructionPanel("请将 🌟 拖动到滑动起点，然后点击确认", "记录起点", () => {
        tempPos.startX = uiRefs.targetView.getX() + uiRefs.targetView.getWidth() / 2;
        tempPos.startY = uiRefs.targetView.getY() + uiRefs.targetView.getHeight() / 2;
        showInstructionPanel("请将 🌟 拖动到滑动终点，然后点击确认", "记录终点并完成", () => {
            tempPos.endX = uiRefs.targetView.getX() + uiRefs.targetView.getWidth() / 2;
            tempPos.endY = uiRefs.targetView.getY() + uiRefs.targetView.getHeight() / 2;
            let newIndex = taskSequence.length;
            let task = { type: 'swipe', name: `滑动任务 ${newIndex + 1}`, startX: tempPos.startX, startY: tempPos.startY, endX: tempPos.endX, endY: tempPos.endY, duration: appSettings.swipe.duration };
            taskSequence.push(task);
            createSwipeVisuals(task, newIndex);
            saveCurrentProfile();
            logToScreen(`已添加新任务: ${task.name}`);
            toast(`已添加: ${task.name}`);
        }, () => { toast("操作已取消"); });
    }, () => { toast("操作已取消"); });
}
function addWaitTask() {
    dialogs.rawInput("输入等待时间 (毫秒)", "1000").then(durationStr => {
        if (!validateNumericInput(durationStr)) return;
        let duration = parseInt(durationStr);
        if (duration > 0) {
            let task = { type: 'wait', name: `等待 ${duration}ms`, duration: duration };
            taskSequence.push(task);
            saveCurrentProfile();
            logToScreen(`已添加等待任务: ${task.name}`);
            toast(`已添加等待任务`);
        } else {
            toast("输入无效");
        }
    });
}
function showManagementDialog() {
    if (isBusy()) return;
    const dialogView = ui.inflate(
        <vertical>
            <text text="任务序列 (点击名称可编辑)" padding="10 5" textSize="14sp" textColor="#757575" />
            <ScrollView h="300dp">
                <vertical id="taskListContainer" />
            </ScrollView>
            <CardView w="*" margin="10 15 10 5" cardCornerRadius="8dp" cardElevation="2dp">
                <vertical>
                    <horizontal id="loopSettingRow" w="*" padding="12 10" gravity="center_vertical" bg="?attr/selectableItemBackground">
                        <text text="🔄" textSize="18sp" marginRight="10" />
                        <text text="循环次数" layout_weight="1" textColor="#212121" textSize="16sp" />
                        <text id="loopCountValue" text={`${appSettings.loopCount} 次`} marginRight="5" textColor="#757575" />
                        <text text=">" textColor="#BDBDBD" />
                    </horizontal>
                    <View h="1dp" bg="#E0E0E0" marginLeft="12" marginRight="12" />
                    <horizontal id="countdownSettingRow" w="*" padding="12 10" gravity="center_vertical" bg="?attr/selectableItemBackground">
                        <text text="⏱️" textSize="18sp" marginRight="10" />
                        <text text="独立倒计时" layout_weight="1" textColor="#212121" textSize="16sp" />
                        <text id="countdownValue" text={`${appSettings.countdownSeconds} 秒`} marginRight="5" textColor="#757575" />
                        <text text=">" textColor="#BDBDBD" />
                    </horizontal>
                    <View h="1dp" bg="#E0E0E0" marginLeft="12" marginRight="12" />
                    <horizontal id="profileManagerRow" w="*" padding="12 10" gravity="center_vertical" bg="?attr/selectableItemBackground">
                        <text text="💾" textSize="18sp" marginRight="10" />
                        <text text="方案管理与备份" layout_weight="1" textColor="#212121" textSize="16sp" />
                        <text text=">" textColor="#BDBDBD" />
                    </horizontal>
                    <View h="1dp" bg="#E0E0E0" marginLeft="12" marginRight="12" />
                    <horizontal id="showTutorialRow" w="*" padding="12 10" gravity="center_vertical" bg="?attr/selectableItemBackground">
                        <text text="❓" textSize="18sp" marginRight="10" />
                        <text text="显示新手引导" layout_weight="1" textColor="#212121" textSize="16sp" />
                        <text text=">" textColor="#BDBDBD" />
                    </horizontal>
                </vertical>
            </CardView>
        </vertical>
        , null, false);
    const dialog = dialogs.build({ customView: dialogView, title: "管理与设置", positive: "完成", neutral: "退出脚本" }).on("neutral", closeAllAndExit).show();
    function populateTaskList(container) {
        ui.run(() => {
            container.removeAllViews();
            if (taskSequence.length === 0) {
                const emptyView = ui.inflate(<text text="当前无任务，请先添加" textColor="#9E9E9E" gravity="center" padding="20" />, container, false);
                container.addView(emptyView);
                return;
            }
            taskSequence.forEach((task, index) => {
                const taskItemView = ui.inflate(
                    <horizontal w="*" gravity="center_vertical" padding="5 0">
                        <text id="taskName" text="{{this.name}}" layout_weight="1" textColor="#000000" ellipsize="end" maxLines="1" />
                        <button id="upBtn" text="🔼" style="Widget.AppCompat.Button.Borderless" w="50dp" />
                        <button id="downBtn" text="🔽" style="Widget.AppCompat.Button.Borderless" w="50dp" />
                    </horizontal>, container, false);
                taskItemView.taskName.setText(`${index + 1}. [${task.type.toUpperCase()}] ${task.name}`);
                taskItemView.taskName.click(() => { dialog.dismiss(); showTaskEditor(task, index); });
                taskItemView.upBtn.setVisibility(index === 0 ? 4 : 0);
                taskItemView.upBtn.click(() => {
                    if (index > 0) {
                        [taskSequence[index], taskSequence[index - 1]] = [taskSequence[index - 1], taskSequence[index]];
                        saveAndRefreshAfterReorder();
                        populateTaskList(container);
                    }
                });
                taskItemView.downBtn.setVisibility(index === taskSequence.length - 1 ? 4 : 0);
                taskItemView.downBtn.click(() => {
                    if (index < taskSequence.length - 1) {
                        [taskSequence[index], taskSequence[index + 1]] = [taskSequence[index + 1], taskSequence[index]];
                        saveAndRefreshAfterReorder();
                        populateTaskList(container);
                    }
                });
                container.addView(taskItemView);
            });
        });
    }
    function saveAndRefreshAfterReorder() { saveCurrentProfile(); recreateAllTaskVisuals(); }
    dialogView.loopSettingRow.click(() => { promptToSetLoopCount(() => { ui.run(() => dialogView.loopCountValue.setText(appSettings.loopCount + " 次")); }); });
    dialogView.countdownSettingRow.click(() => { promptToSetCountdown(() => { ui.run(() => dialogView.countdownValue.setText(appSettings.countdownSeconds + " 秒")); }); });
    dialogView.profileManagerRow.click(() => { dialog.dismiss(); showProfileManager(); });
    dialogView.showTutorialRow.click(() => { dialog.dismiss(); startTutorial(); });
    populateTaskList(dialogView.taskListContainer);
}
function promptToSetLoopCount(onSuccessCallback) {
    dialogs.rawInput("输入任务序列的循环执行次数", appSettings.loopCount.toString()).then(countStr => {
        if (!validateNumericInput(countStr)) return;
        let count = parseInt(countStr);
        if (count > 0) {
            appSettings.loopCount = count;
            saveCurrentProfile();
            toast(`循环次数已设置为: ${count}`);
            if (onSuccessCallback) onSuccessCallback();
        } else {
            toast("循环次数必须大于0");
        }
    });
}
function promptToSetCountdown(onSuccessCallback) {
    dialogs.rawInput("输入独立倒计时的秒数 (推荐1-10)", appSettings.countdownSeconds.toString())
        .then(secondsStr => {
            if (!validateNumericInput(secondsStr)) return;
            let seconds = parseInt(secondsStr);
            appSettings.countdownSeconds = seconds;
            saveCurrentProfile();
            toast(`倒计时已设置为: ${seconds}秒`);
            if (onSuccessCallback) onSuccessCallback();
        });
}
function showTaskEditor(task, index) {
    if (!task) return;
    const view = ui.inflate(
        <vertical padding="16">
            <text>任务名称:</text><input id="name" />
            <vertical id="wait_fields" visibility="gone"><text>等待时间 (ms):</text><input id="wait_duration" inputType="number" /></vertical>
            <vertical id="click_fields" visibility="gone"><horizontal><text>X:</text><input id="click_x" inputType="numberDecimal" /><text>Y:</text><input id="click_y" inputType="numberDecimal" /></horizontal></vertical>
            <vertical id="swipe_fields" visibility="gone">
                <horizontal><text>开始X:</text><input id="swipe_startX" inputType="numberDecimal" /><text>开始Y:</text><input id="swipe_startY" inputType="numberDecimal" /></horizontal>
                <horizontal><text>结束X:</text><input id="swipe_endX" inputType="numberDecimal" /><text>结束Y:</text><input id="swipe_endY" inputType="numberDecimal" /></horizontal>
                <text>滑动时长 (ms):</text><input id="swipe_duration" inputType="number" />
            </vertical>
        </vertical>, null, false);
    view.name.setText(task.name);
    switch (task.type) {
        case 'wait': view.wait_duration.setText(String(task.duration || 1000)); break;
        case 'click': view.click_x.setText(String(task.x || 0)); view.click_y.setText(String(task.y || 0)); break;
        case 'swipe': view.swipe_startX.setText(String(task.startX || 0)); view.swipe_startY.setText(String(task.startY || 0)); view.swipe_endX.setText(String(task.endX || 0)); view.swipe_endY.setText(String(task.endY || 0)); view.swipe_duration.setText(String(task.duration || 300)); break;
    }
    view[task.type + "_fields"].setVisibility(0);
    dialogs.build({ customView: view, title: `编辑任务 ${index + 1}`, positive: "保存", negative: "取消", neutral: "删除任务" })
    .on("positive", dialog => {
        task.name = view.name.getText().toString();
        let needsVisualRefresh = false;
        switch (task.type) {
            case 'wait':
                if (!validateNumericInput(view.wait_duration.getText().toString())) return;
                task.duration = parseInt(view.wait_duration.getText().toString());
                break;
            case 'click':
                if (!validateNumericInput(view.click_x.getText().toString(), true) || !validateNumericInput(view.click_y.getText().toString(), true)) return;
                task.x = parseFloat(view.click_x.getText().toString());
                task.y = parseFloat(view.click_y.getText().toString());
                needsVisualRefresh = true;
                break;
            case 'swipe':
                if (!validateNumericInput(view.swipe_startX.getText().toString(), true) || !validateNumericInput(view.swipe_startY.getText().toString(), true) || !validateNumericInput(view.swipe_endX.getText().toString(), true) || !validateNumericInput(view.swipe_endY.getText().toString(), true) || !validateNumericInput(view.swipe_duration.getText().toString())) return;
                task.startX = parseFloat(view.swipe_startX.getText().toString());
                task.startY = parseFloat(view.swipe_startY.getText().toString());
                task.endX = parseFloat(view.swipe_endX.getText().toString());
                task.endY = parseFloat(view.swipe_endY.getText().toString());
                task.duration = parseInt(view.swipe_duration.getText().toString());
                needsVisualRefresh = true;
                break;
        }
        if (needsVisualRefresh) recreateAllTaskVisuals();
        saveCurrentProfile();
        toast("任务已保存");
    }).on("neutral", dialog => {
        dialogs.confirm("确定删除?", `将删除任务: ${task.name}`).then(ok => {
            if (ok) {
                taskSequence.splice(index, 1);
                recreateAllTaskVisuals();
                saveCurrentProfile();
                logToScreen(`任务 "${task.name}" 已删除。`);
                toast("任务已删除");
            }
        });
    }).show();
}

// =================================================================================
// 辅助函数 (Utility Functions)
// =================================================================================
function showHelpDialog() {
    dialogs.build({ title: "帮助与说明", content: `【核心概念】\n1. 目标视图(🌟): 这是所有操作的基准点。添加任务或单次点击时，它的位置就是目标位置。\n\n2. Y轴偏移: 由于安卓顶部的状态栏存在，实际触摸点需要向下偏移才能精确点击。这个值就是向下偏移的像素，通常设置为状态栏高度（或略大）效果最佳。\n\n【方案与任务】\n• 方案: 一套完整的“设置”和“任务序列”的集合，可以随时保存和加载。\n• 任务: “点击”、“滑动”、“等待”的组合，按顺序执行。\n\n【导入/导出】\n• 路径: 所有导入/导出操作均基于您手机内部存储的 "点点特工备份" 文件夹中。\n• 格式: 导出的文件是标准的 .json 文件，可分享给他人或用于备份。\n\n【隐藏按钮】\n• 操作: 单击控制面板的顶部拖动条，可以隐藏/显示下方的功能按钮，以节省屏幕空间。\n\n--------------------\n版本号: ${CONSTANTS.VERSION}`, positive: "我明白了" }).show();
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
        logToScreen("权限请求失败: " + e);
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
    let actualY = centerY - appSettings.yOffset;
    uiRefs.redDot.setPosition(centerX - 15, actualY - 15);
}
function showClickDot(x, y) {
    ui.run(() => {
        const size = 40;
        let dot = floaty.rawWindow(<frame><view bg="#FF00FF00" w={size} h={size} style="border-radius:20px;" /></frame>);
        dot.setTouchable(false);
        dot.setSize(size, size);
        let actualY = y - appSettings.yOffset;
        dot.setPosition(x - size / 2, actualY - size / 2);
        setTimeout(() => { if (dot) dot.close() }, 300);
    });
}
function visualizeSwipePath(task) { clearSwipeVisualization(); }
function clearSwipeVisualization() { if (uiRefs.swipeVisualizationWindows.length > 0) { uiRefs.swipeVisualizationWindows.forEach(w => w.close()); uiRefs.swipeVisualizationWindows = []; } }
function applyButtonVisibility() { if (!uiRefs.controlPanel || !uiRefs.controlPanel.buttonsContainer) return; let visibility = (appSettings.controlButtonsHidden === true) ? 8 : 0; ui.run(() => { uiRefs.controlPanel.buttonsContainer.setVisibility(visibility); }); }
function toggleControlButtonsVisibility() { appSettings.controlButtonsHidden = !appSettings.controlButtonsHidden; applyButtonVisibility(); saveCurrentProfile(); updateProfileNameDisplay(); toast(appSettings.controlButtonsHidden ? "按钮已隐藏 (单击头部可恢复)" : "按钮已显示"); }
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
        try { uiRefs.targetView.root.setBackgroundColor(android.graphics.Color.parseColor(appSettings.theme.targetViewColor)); } catch(e) { logToScreen("目标视图颜色格式错误"); }
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
function updateProfileNameDisplay() { if (uiRefs.controlPanel && uiRefs.controlPanel.profileNameText) { let displayName = currentProfileName.replace(CONSTANTS.FILES.PROFILE_PREFIX, '').replace('.json', ''); let displayText = appSettings.controlButtonsHidden ? `(点击显示) ${displayName}` : `方案: ${displayName}`; ui.run(() => { uiRefs.controlPanel.profileNameText.setText(displayText); }); } }
function updatePositionDisplay() { if (uiRefs.controlPanel && uiRefs.controlPanel.positionText) { ui.run(() => { if (uiRefs.controlPanel && uiRefs.controlPanel.positionText) { let x = uiRefs.controlPanel.getX(); let y = uiRefs.controlPanel.getY(); uiRefs.controlPanel.positionText.setText(`X:${x}, Y:${y}`); } }); } }
function populateGraphicalSettings() {
    if (ui.loopCountInput) {
        ui.run(() => {
            ui.loopCountInput.setText(String(appSettings.loopCount));
            ui.clickDelayInput.setText(String(appSettings.clickDelayMs));
            ui.swipeDurationInput.setText(String(appSettings.swipe.duration));
            ui.yOffsetInput.setText(String(appSettings.yOffset));
            ui.countdownSecondsInput.setText(String(appSettings.countdownSeconds));
            ui.panelWidthInput.setText(String(appSettings.panelWidth));
            ui.targetViewSizeInput.setText(String(appSettings.targetViewSize));
            if (!appSettings.theme) { appSettings.theme = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.theme)); }
            ui.targetColorInput.setText(appSettings.theme.targetViewColor);
            ui.clickTaskColorInput.setText(appSettings.theme.taskClickColor);
            ui.swipeTaskColorInput.setText(appSettings.theme.taskSwipeColor);
        });
    }
}
function logToScreen(message) { if (ui.logView) { let now = new Date(); let timestamp = util.format("%d:%d:%d", now.getHours(), now.getMinutes(), now.getSeconds()); ui.run(() => { ui.logView.append(timestamp + " - " + message + "\n"); ui.logScrollView.fullScroll(android.view.View.FOCUS_DOWN); }); } }
function validateNumericInput(inputStr, allowFloat = false) { if (!inputStr || inputStr.trim() === "") { toast("输入不能为空"); return false; } const regex = allowFloat ? /^-?[\d.]+$/ : /^\d+$/; if (!regex.test(inputStr)) { toast(`请输入有效的${allowFloat ? "" : "整"}数字格式`); return false; } return true; }

// =================================================================================
// 文件与配置管理 (File & Configuration)
// =================================================================================
function saveMetaConfig() { files.write(CONSTANTS.FILES.META_CONFIG_FILE, JSON.stringify(metaConfig, null, 2)); }
function saveCurrentProfile() {
    const config = { settings: appSettings, tasks: taskSequence };
    const profilePath = files.join(CONSTANTS.FILES.CONFIG_DIR, currentProfileName);
    files.write(profilePath, JSON.stringify(config, null, 2));
    metaConfig.lastProfile = currentProfileName;
    saveMetaConfig();
    if (appState.isFloatyCreated) updateProfileNameDisplay();
    displayConfigInEditor();
    populateGraphicalSettings();
}
function loadProfile(profileName) {
    const profilePath = files.join(CONSTANTS.FILES.CONFIG_DIR, profileName);
    if (files.exists(profilePath)) {
        try {
            const configStr = files.read(profilePath);
            if (!configStr) throw new Error("文件为空。");
            const loadedConfig = JSON.parse(configStr);
            let newSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
            Object.assign(newSettings, loadedConfig.settings);
            if (!newSettings.theme) { newSettings.theme = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.theme)); }
            if (newSettings.redDotOffsetY !== undefined) { newSettings.yOffset = newSettings.redDotOffsetY; delete newSettings.redDotOffsetY; }
            appSettings = newSettings;
            taskSequence = loadedConfig.tasks || [];
            currentProfileName = profileName;
            logToScreen(`方案 "${profileName.replace(CONSTANTS.FILES.PROFILE_PREFIX, '').replace('.json', '')}" 加载成功。`);
            return true;
        } catch (e) {
            logToScreen(`加载方案 "${profileName}" 失败: ${e.message}。文件可能已损坏。`);
            toast(`加载方案失败: ${profileName.replace(CONSTANTS.FILES.PROFILE_PREFIX, '').replace('.json', '')}。将重置为默认方案。`);
            resetToDefaultProfile();
            return false;
        }
    } else {
        logToScreen(`方案文件不存在: ${profileName}，将使用默认方案。`);
        return false;
    }
}
function loadLastUsedProfile() {
    if (files.exists(CONSTANTS.FILES.META_CONFIG_FILE)) {
        try { metaConfig = JSON.parse(files.read(CONSTANTS.FILES.META_CONFIG_FILE)) || {}; } catch (e) { logToScreen("读取元配置文件失败，使用默认。"); metaConfig = {}; }
    }
    let profileToLoad = metaConfig.lastProfile || CONSTANTS.FILES.PROFILE_PREFIX + "default.json";
    if (!loadProfile(profileToLoad)) {
        resetToDefaultProfile();
    }
}
function resetToDefaultProfile() {
    currentProfileName = CONSTANTS.FILES.PROFILE_PREFIX + "default.json";
    appSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    taskSequence = [];
    saveCurrentProfile();
    logToScreen("已重置为默认方案。");
}
function showProfileManager() {
    if (isBusy()) return;
    const profiles = files.listDir(CONSTANTS.FILES.CONFIG_DIR).filter(name => name.startsWith(CONSTANTS.FILES.PROFILE_PREFIX) && name.endsWith('.json'));
    const displayNames = profiles.map(name => name.replace(CONSTANTS.FILES.PROFILE_PREFIX, '').replace('.json', ''));
    const currentProfileDisplayName = currentProfileName.replace(CONSTANTS.FILES.PROFILE_PREFIX, '').replace('.json', '');
    displayNames.unshift("【创建新方案】");
    dialogs.select(`请选择一个方案进行操作\n(当前: ${currentProfileDisplayName})`, displayNames)
        .then(selectedIndex => {
            if (selectedIndex < 0) { toast("操作已取消"); return; }
            if (selectedIndex === 0) {
                dialogs.rawInput("为新方案输入名称", "我的新方案").then(newName => {
                    newName = newName.trim();
                    if (!newName || newName.includes('/') || newName.includes('\\') || newName === 'default') {
                        toast("名称不合法或与默认方案冲突!");
                        return;
                    }
                    const newProfileName = CONSTANTS.FILES.PROFILE_PREFIX + newName + ".json";
                    const newProfilePath = files.join(CONSTANTS.FILES.CONFIG_DIR, newProfileName);
                    if (files.exists(newProfilePath)) {
                        toast("错误：同名方案已存在！");
                        return;
                    }
                    currentProfileName = newProfileName;
                    appSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
                    taskSequence = [];
                    saveCurrentProfile();
                    refreshAllUI();
                    toast(`已创建并加载新方案: "${newName}"`);
                    logToScreen(`已创建并加载新方案: "${newName}"`);
                });
                return;
            }
            const profileIndex = selectedIndex - 1;
            const selectedProfile = profiles[profileIndex];
            const selectedDisplayName = displayNames[selectedIndex];
            const actions = ["加载", "另存为...", "删除"];
            if (selectedProfile === CONSTANTS.FILES.PROFILE_PREFIX + "default.json") {
                actions.pop();
            }
            dialogs.select(`请选择对 [${selectedDisplayName}] 的操作`, actions)
                .then(actionIndex => {
                    if (actionIndex < 0) return;
                    switch (actions[actionIndex]) {
                        case "加载":
                            if (loadProfile(selectedProfile)) { saveCurrentProfile(); refreshAllUI(); toast(`方案 "${selectedDisplayName}" 加载成功`); }
                            break;
                        case "另存为...":
                            dialogs.rawInput("为新方案输入名称", "").then(newName => {
                                newName = newName.trim();
                                if (!newName || newName.includes('/') || newName.includes('\\')) { toast("名称不能为空且不能包含特殊字符!"); return; }
                                const newProfileName = CONSTANTS.FILES.PROFILE_PREFIX + newName + ".json";
                                const newProfilePath = files.join(CONSTANTS.FILES.CONFIG_DIR, newProfileName);
                                if (files.exists(newProfilePath)) { toast("错误：同名方案已存在！"); return; }
                                const sourceProfilePath = files.join(CONSTANTS.FILES.CONFIG_DIR, selectedProfile);
                                if (files.copy(sourceProfilePath, newProfilePath)) {
                                    currentProfileName = newProfileName;
                                    loadProfile(currentProfileName);
                                    saveCurrentProfile();
                                    refreshAllUI();
                                    toast(`方案已另存为 "${newName}" 并加载！`);
                                    logToScreen(`方案 "${selectedDisplayName}" 已另存为 "${newName}" 并自动加载。`);
                                } else {
                                    toast("另存为失败！无法复制文件。");
                                }
                            });
                            break;
                        case "删除":
                            dialogs.confirm("确定删除?", `将永久删除方案: "${selectedDisplayName}"`).then(ok => {
                                if (ok) {
                                    const profilePath = files.join(CONSTANTS.FILES.CONFIG_DIR, selectedProfile);
                                    if (files.remove(profilePath)) {
                                        toast("删除成功");
                                        logToScreen(`方案 "${selectedDisplayName}" 已被删除。`);
                                        if (currentProfileName === selectedProfile) {
                                            resetToDefaultProfile();
                                            refreshAllUI();
                                        }
                                    } else {
                                        toast("删除失败");
                                    }
                                }
                            });
                            break;
                    }
                });
        });
}
function displayConfigInEditor() { if (!ui.configEditor) return; const config = { settings: appSettings, tasks: taskSequence }; ui.run(() => { ui.configEditor.setText(JSON.stringify(config, null, 2)); }); }
function showImportExportDialog() { dialogs.select("导入/导出当前方案", ["导入 (覆盖当前)", "导出"]).then(i => { if (i < 0) return; if (i === 0) { importConfiguration(); } else if (i === 1) { exportConfiguration(); } }); }
function exportConfiguration() { threads.start(function () { if (!checkStoragePermissions()) { return; } try { const configStr = JSON.stringify({ settings: appSettings, tasks: taskSequence }, null, 2); const backupDirName = "点点特工备份"; const backupPath = files.join(files.getSdcardPath(), backupDirName); files.ensureDir(backupPath); const defaultFileName = currentProfileName.replace(CONSTANTS.FILES.PROFILE_PREFIX, 'export_'); const defaultPath = files.join(backupPath, defaultFileName); dialogs.alert("导出当前方案", `方案将保存到公共目录。\n\n路径: ${defaultPath}`).then(() => { files.write(defaultPath, configStr); ui.run(() => toast("方案已成功导出！")); logToScreen(`方案已导出到 ${defaultPath}`); }); } catch (e) { ui.run(() => toast("导出失败: " + e)); logToScreen(`导出失败: ${e}`); } }); }
function importConfiguration() { threads.start(function () { if (!checkStoragePermissions()) { return; } dialogs.confirm("导入配置", "这将覆盖您当前的全部任务和设置，确定吗？").then(ok => { if (ok) { const backupDirName = "点点特工备份"; const backupPath = files.join(files.getSdcardPath(), backupDirName); files.ensureDir(backupPath); dialogs.rawInput(`请输入位于 "${backupDirName}" 文件夹中的配置文件名`, "export_default.json").then(fileName => { if (!fileName) { ui.run(() => toast("文件名不能为空")); return; } const path = files.join(backupPath, fileName); if (files.exists(path)) { try { let configStr = files.read(path); const loadedConfig = JSON.parse(configStr); if (!loadedConfig || typeof loadedConfig.settings !== 'object' || !Array.isArray(loadedConfig.tasks)) { throw new Error("配置文件格式不正确或缺少关键字段"); } let newSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); Object.assign(newSettings, loadedConfig.settings); if (!newSettings.theme) { newSettings.theme = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.theme)); } if (newSettings.redDotOffsetY !== undefined) { newSettings.yOffset = newSettings.redDotOffsetY; delete newSettings.redDotOffsetY; } appSettings = newSettings; taskSequence = loadedConfig.tasks; ui.run(() => { saveCurrentProfile(); refreshAllUI(); toast("配置导入成功！"); }); logToScreen(`已从 ${path} 成功导入方案。`); } catch (e) { ui.run(() => toast("导入失败: " + e)); logToScreen(`导入失败: ${e}`); } } else { ui.run(() => toast("文件不存在: " + path)); logToScreen(`导入失败，文件不存在: ${path}`); } }); } }); }); }

// =================================================================================
// 退出与清理 (Exit & Cleanup)
// =================================================================================
function closeTaskVisuals() { uiRefs.taskVisuals.forEach(visual => { if (visual.type === 'click' && visual.window) { visual.window.close(); } else if (visual.type === 'swipe') { if (visual.startWindow) visual.startWindow.close(); if (visual.endWindow) visual.endWindow.close(); } }); uiRefs.taskVisuals = []; }
function closeAllAndExit() {
    stopExecution("应用退出，停止所有任务");
    if (appState.threads.countdown && appState.threads.countdown.isAlive()) {
        appState.threads.countdown.interrupt();
    }
    if (appState.ui.instructionWindow) {
        appState.ui.instructionWindow.close();
    }
    if (appState.ui.tutorialWindow) {
        appState.ui.tutorialWindow.close();
    }
    appState.threads.countdown = null;
    appState.ui.instructionWindow = null;
    appState.ui.tutorialWindow = null;
    if (uiRefs.targetView) uiRefs.targetView.close();
    if (uiRefs.redDot) uiRefs.redDot.close();
    if (uiRefs.controlPanel) uiRefs.controlPanel.close();
    closeTaskVisuals();
    clearSwipeVisualization();
    appState.isFloatyCreated = false;
    toast("应用已退出。");
    exit();
}