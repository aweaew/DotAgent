/**
 * logic.js - 核心执行逻辑 (任务执行 + 监控) (修复版)
 */
const Utils = require('./utils.js');
const PQManager = require('./pq_manager.js');
const ProjectConfig = require('./config.js');
const CONSTANTS = ProjectConfig.GLOBAL_CONSTANTS; // 引用常量
const State = require('./state.js'); // 引用状态

// --- 辅助函数：获取停止信号 ---
function getStopSignal(contextType) {
    if (contextType === 'main') {
        return !State.appState.isExecuting;
    } else {
        // 监控模式：只要全局监控关了，或者当前监控线程被移除，就停止
        const isAnyMonitorRunning = State.appState.isMonitoring || Object.keys(State.appState.activeMonitors).length > 0;
        return !isAnyMonitorRunning;
    }
}

// --- 核心函数：执行序列 ---
function executeSequence(tasksToRun, sourceName, contextType, depth) {
    depth = depth || 0;
    if (depth > 50) {
        State.callbacks.logError(`错误: 序列深度过深(>${depth})，可能死循环: ${sourceName}`);
        return;
    }
    if (!tasksToRun || !Array.isArray(tasksToRun)) {
        State.callbacks.log(`序列 [${sourceName}] 为空，跳过。`);
        return;
    }

    State.callbacks.log(`开始执行序列: ${sourceName}`);

    for (let i = 0; i < tasksToRun.length; i++) {
        if (getStopSignal(contextType)) {
            State.callbacks.log(`序列 [${sourceName}] 被中断。`);
            break;
        }

        let task = tasksToRun[i];
        if (!task || task.enabled === false) continue; // 跳过禁用任务

        if (task.delayMs > 0) {
            State.callbacks.log(`任务 [${task.name}] 延迟 ${task.delayMs}ms`);
            sleep(task.delayMs);
        }
        if (threads.currentThread().isInterrupted()) break;

        // 执行具体任务逻辑
        runTaskDispatch(task, sourceName, i, contextType, depth);
    }
    State.callbacks.log(`序列 [${sourceName}] 执行完毕。`);
}

// --- 任务分发器 ---
function runTaskDispatch(task, sourceName, index, contextType, depth) {
    const taskName = task.name || `[${task.type}]`;

    switch (task.type) {
        case 'click':
            let cx = task.x + (task.offsetX || 0);
            let cy = task.y + (task.offsetY || 0);
            State.callbacks.log(`[${sourceName}] 点击: (${cx}, ${cy})`);
            State.callbacks.showClickDot(cx, cy);
            Utils.safePress(cx, cy, CONSTANTS.UI.CLICK_PRESS_DURATION_MS);
            sleep(State.settings.clickDelayMs);
            break;

        case 'wait':
            State.callbacks.toast(`执行: ${taskName}`);
            let totalWait = task.duration || 1000;
            State.appState.ui.currentWaitTask = { remaining: totalWait, total: totalWait };
            let waited = 0;
            try {
                while (waited < totalWait) {
                    if (getStopSignal(contextType)) break;
                    sleep(1000);
                    waited += 1000;
                    if (State.appState.ui.currentWaitTask) State.appState.ui.currentWaitTask.remaining = totalWait - waited;
                }
            } finally {
                State.appState.ui.currentWaitTask = null;
            }
            break;

        case 'swipe':
            State.callbacks.log(`[${sourceName}] 滑动: ${taskName}`);
            if (State.settings.useGestureSwipe) {
                gestures([0, task.duration || 300, [task.startX, task.startY], [task.endX, task.endY]]);
            } else {
                swipe(task.startX, task.startY, task.endX, task.endY, task.duration || 300);
            }
            sleep(State.settings.clickDelayMs);
            break;

        case 'ocr': {
            let taskNameLog = task.name ? taskName : `${taskName} ("${task.textToFind}")`;
            State.callbacks.log(`[${sourceName}] 执行任务 ${index + 1}: ${taskNameLog}`);

            let foundResult = null;
            let timeout = task.timeout || 5000;

            // --- 1. 尝试缓存搜索 ---
            if (task.cachedBounds && task.cachedBounds.left !== undefined) {
                State.callbacks.log(`... 尝试缓存搜索`);
                let captured = captureScreen();
                if (captured) {
                    let b = task.cachedBounds;
                    let padding = (task.cachePadding !== undefined) ? task.cachePadding : (State.settings.defaultCachePadding || 50);
                    let region = Utils.calculatePaddedRegion(b, padding);
                    let ocrResults = ocr.paddle.detect(captured, { region: region, useSlim: true });
                    let target = ocrResults.find(r => r.label.includes(task.textToFind));
                    if (target) {
                        State.callbacks.log("... 缓存命中");
                        foundResult = target;
                    }
                    captured.recycle();
                }
            }

            // --- 2. 全屏/区域搜索 ---
            if (!foundResult) {
                let startTime = new Date().getTime();
                while (new Date().getTime() - startTime < timeout) {
                    if (getStopSignal(contextType) || threads.currentThread().isInterrupted()) break;

                    let captured = captureScreen();
                    if (!captured) { sleep(1000); continue; }

                    let ocrOptions = { useSlim: true };
                    if (task.search_area && task.search_area.length === 4) {
                        let [x1, y1, x2, y2] = task.search_area;
                        let searchBounds = { left: x1, top: y1, right: x2, bottom: y2 };
                        ocrOptions.region = Utils.calculatePaddedRegion(searchBounds, 0);
                    }
                    let ocrResults = ocr.paddle.detect(captured, ocrOptions);
                    captured.recycle();

                    let target = ocrResults.find(r => r.label.includes(task.textToFind));
                    if (target) {
                        foundResult = target;
                        task.cachedBounds = { left: target.bounds.left, top: target.bounds.top, right: target.bounds.right, bottom: target.bounds.bottom };
                        State.callbacks.saveProfile();
                        break;
                    }
                    sleep(300);
                }
            }

            if (getStopSignal(contextType) || threads.currentThread().isInterrupted()) break;

            // --- 3. 结果处理 ---
            if (foundResult) {
                let successAction = task.onSuccess || { action: 'click', after: 'none' };
                
                handleOcrSuccess(foundResult, successAction);

                if (successAction.after === 'terminate') {
                    State.callbacks.log(`任务 [${taskNameLog}] 成功，后续操作: 终止序列。`);
                    ui.run(() => State.callbacks.stopExecution(`任务 [${taskNameLog}] 触发终止`));
                    break;
                } else if (successAction.after === 'sequence') {
                    if (successAction.sequenceName) {
                        State.callbacks.log(`任务 [${taskNameLog}] 成功，后续操作: 调用子序列。`);
                        // 【修复】使用 let 避免提升冲突
                        let subSeq = State.sequences[successAction.sequenceName];
                        if (subSeq) {
                            executeSequence(subSeq.tasks, `子序列 (${subSeq.name})`, contextType, depth + 1);
                        } else {
                            State.callbacks.logError(`错误: 找不到子序列 ${successAction.sequenceName}`);
                        }
                    }
                }
            } else {
                State.callbacks.log(`超时 ${timeout}ms 未找到文本 "${task.textToFind}"`);
                handleGeneralFailAction(task.onFail, '识别失败', sourceName, contextType, depth);
            }
            break;
        }

        case 'image': {
            let taskNameLog = task.name ? taskName : `${taskName} ("${task.imageFile}")`;
            State.callbacks.log(`[${sourceName}] 执行任务 ${index + 1}: ${taskNameLog}`);

            let foundImagePoint = null;
            let imageTimeout = task.timeout || 5000;
            let imagePath = files.join(CONSTANTS.FILES.IMAGE_DIR, task.imageFile);

            if (!files.exists(imagePath)) {
                State.callbacks.logError(`图片不存在: ${task.imageFile}`);
                handleGeneralFailAction(task.onFail, '找图失败', sourceName, contextType, depth);
                break;
            }
            let template = images.read(imagePath);
            if (!template) {
                State.callbacks.logError(`无法读取图片: ${task.imageFile}`);
                handleGeneralFailAction(task.onFail, '找图失败', sourceName, contextType, depth);
                break;
            }

            // --- 1. 缓存搜索 ---
            if (task.cachedBounds && task.cachedBounds.x !== undefined) {
                State.callbacks.log(`... 尝试缓存搜索`);
                let captured = captureScreen();
                if (captured) {
                    let b = task.cachedBounds;
                    let padding = (task.cachePadding !== undefined) ? task.cachePadding : (State.settings.defaultCachePadding || 50);
                    let region = Utils.calculatePaddedRegion(b, padding);
                    let p = images.findImage(captured, template, { region: region, threshold: task.threshold || 0.8 });
                    if (p) {
                        State.callbacks.log("... 缓存命中");
                        foundImagePoint = p;
                    }
                    captured.recycle();
                }
            }

            // --- 2. 全屏/区域搜索 ---
            if (!foundImagePoint) {
                let startTime = new Date().getTime();
                while (new Date().getTime() - startTime < imageTimeout) {
                    if (getStopSignal(contextType) || threads.currentThread().isInterrupted()) break;

                    let captured = captureScreen();
                    if (!captured) { sleep(1000); continue; }

                    let findOptions = { threshold: task.threshold || 0.8 };
                    if (task.search_area && task.search_area.length === 4) {
                        let [x1, y1, x2, y2] = task.search_area;
                        let searchBounds = { left: x1, top: y1, right: x2, bottom: y2 };
                        findOptions.region = Utils.calculatePaddedRegion(searchBounds, 0);
                    }
                    let p = images.findImage(captured, template, findOptions);
                    captured.recycle();

                    if (p) {
                        foundImagePoint = p;
                        task.cachedBounds = { x: p.x, y: p.y, width: template.getWidth(), height: template.getHeight() };
                        State.callbacks.saveProfile();
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
                let location = {
                    left: foundImagePoint.x,
                    top: foundImagePoint.y,
                    right: foundImagePoint.x + template.getWidth(),
                    bottom: foundImagePoint.y + template.getHeight(),
                    centerX: function () { return this.left + (this.right - this.left) / 2; },
                    centerY: function () { return this.top + (this.bottom - this.top) / 2; }
                };

                let successAction = task.onSuccess || { action: 'click', after: 'none' };

                handleImageSuccess(location, successAction);

                if (successAction.after === 'terminate') {
                    State.callbacks.log(`任务 [${taskNameLog}] 成功，后续操作: 终止序列。`);
                    ui.run(() => State.callbacks.stopExecution(`任务 [${taskNameLog}] 触发终止`));
                    break;
                } else if (successAction.after === 'sequence') {
                    if (successAction.sequenceName) {
                        State.callbacks.log(`任务 [${taskNameLog}] 成功，后续操作: 调用子序列。`);
                        // 【修复】使用 let
                        let subSeq = State.sequences[successAction.sequenceName];
                        if (subSeq) {
                            executeSequence(subSeq.tasks, `子序列 (${subSeq.name})`, contextType, depth + 1);
                        } else {
                            State.callbacks.logError(`错误: 找不到子序列 ${successAction.sequenceName}`);
                        }
                    }
                }
            } else {
                State.callbacks.log(`超时 ${imageTimeout}ms 未找到图片 "${task.imageFile}"`);
                handleGeneralFailAction(task.onFail, '找图失败', sourceName, contextType, depth);
            }
            template.recycle();
            break;
        }

        case 'wait_for_dissapear': {
            State.callbacks.log(`[${sourceName}] 执行任务 ${index + 1}: ${task.name || `等待'${task.target}'消失`}`);
            State.callbacks.toast(`执行: ${task.name}`);

            let targetFound = false;
            let findStartTime = new Date().getTime();
            const findTimeout = task.findTimeout || 5000;
            let findOptions = {};
            let imageTemplate = null;

            if (task.targetType === 'image') {
                let imagePath = files.join(CONSTANTS.FILES.IMAGE_DIR, task.target);
                if (!files.exists(imagePath)) {
                    State.callbacks.logError(`错误: 图片文件不存在 at ${imagePath}`);
                    handleGeneralFailAction(task.onFail, '等待消失-文件不存在', sourceName, contextType, depth);
                    break;
                }
                imageTemplate = images.read(imagePath);
                if (!imageTemplate) {
                    State.callbacks.logError(`错误: 无法读取图片文件 at ${imagePath}`);
                    handleGeneralFailAction(task.onFail, '等待消失-无法读取', sourceName, contextType, depth);
                    break;
                }
                findOptions = { threshold: task.threshold || 0.8 };
            } else { // ocr
                findOptions = { useSlim: true };
            }

            if (task.search_area && task.search_area.length === 4) {
                let [x1, y1, x2, y2] = task.search_area;
                let searchBounds = { left: x1, top: y1, right: x2, bottom: y2 };
                findOptions.region = Utils.calculatePaddedRegion(searchBounds, 0); 
            }

            State.callbacks.log(`...阶段1: 查找目标 "${task.target}" (超时: ${findTimeout}ms)`);
            while (new Date().getTime() - findStartTime < findTimeout) {
                if (getStopSignal(contextType) || threads.currentThread().isInterrupted()) break;
                let captured = captureScreen();
                if (!captured) { State.callbacks.log("截图失败"); sleep(500); continue; }

                let result = null;
                if (task.targetType === 'image') {
                    result = images.findImage(captured, imageTemplate, findOptions);
                } else { 
                    let ocrResults = ocr.paddle.detect(captured, findOptions);
                    result = ocrResults.find(r => r.label.includes(task.target));
                }
                captured.recycle();

                if (result) {
                    targetFound = true;
                    State.callbacks.log(`...目标 "${task.target}" 已找到，进入下一阶段。`);
                    break;
                }
                sleep(300);
            }

            if (getStopSignal(contextType) || threads.currentThread().isInterrupted()) {
                if (imageTemplate) imageTemplate.recycle();
                break;
            }

            if (!targetFound) {
                State.callbacks.log(`...阶段1失败: 未找到目标。`);
                handleGeneralFailAction(task.onFail, 'onFail (未找到)', sourceName, contextType, depth);
                if (imageTemplate) imageTemplate.recycle();
                break;
            }

            let targetDisappeared = false;
            let disappearStartTime = new Date().getTime();
            const disappearTimeout = task.disappearTimeout || 10000;

            State.callbacks.log(`...阶段2: 等待目标消失`);
            while (new Date().getTime() - disappearStartTime < disappearTimeout) {
                if (getStopSignal(contextType) || threads.currentThread().isInterrupted()) break;
                let captured = captureScreen();
                if (!captured) { sleep(500); continue; }

                let result = null;
                if (task.targetType === 'image') {
                    result = images.findImage(captured, imageTemplate, findOptions);
                } else {
                    let ocrResults = ocr.paddle.detect(captured, findOptions);
                    result = ocrResults.find(r => r.label.includes(task.target));
                }
                captured.recycle();

                if (!result) {
                    targetDisappeared = true;
                    State.callbacks.log(`...目标 "${task.target}" 已消失。`);
                    break;
                }
                sleep(500);
            }

            if (imageTemplate) imageTemplate.recycle();
            if (getStopSignal(contextType) || threads.currentThread().isInterrupted()) break;

            if (targetDisappeared) {
                State.callbacks.log(`...阶段2成功。`);
                handleGeneralSuccessAction(task.onSuccess, 'onSuccess', sourceName, contextType, depth);
            } else {
                State.callbacks.log(`...阶段2失败: 目标未消失。`);
                handleGeneralFailAction(task.onTimeout, 'onTimeout (未消失)', sourceName, contextType, depth);
            }
            break;
        }

        case 'back':
            State.callbacks.log(`[${sourceName}] 执行任务 ${index + 1}: ${taskName}`);
            back();
            sleep(State.settings.clickDelayMs);
            break;

        case 'launch_app':
            State.callbacks.log(`[${sourceName}] 执行任务 ${index + 1}: ${taskName}`);
            if (task.appName) {
                app.launchApp(task.appName);
                State.callbacks.log(`已尝试启动应用: ${task.appName}`);
            } else {
                State.callbacks.logError(`错误: launch_app 任务未指定 appName`);
            }
            sleep(State.settings.clickDelayMs);
            break;

        case 'start_monitor': {
            const isAnyMonitorRunning = State.appState.isMonitoring || Object.keys(State.appState.activeMonitors).length > 0;
            if (isAnyMonitorRunning) {
                State.callbacks.logError(`[${sourceName}] 启动监控 [${task.sequenceName}] 失败：已有其他监控正在运行。`);
                State.callbacks.toast("启动监控失败：已有其他监控在运行");
                break; 
            }

            State.callbacks.log(`[${sourceName}] 动态启动监控: ${task.sequenceName}`);
            const sequenceToMonitor = State.sequences[task.sequenceName];

            if (sequenceToMonitor && sequenceToMonitor.executionPolicy.mode === 'monitor') {
                if (State.appState.activeMonitors[task.sequenceName]) {
                    State.callbacks.log(`警告: 监控 [${task.sequenceName}] 已在运行中。`);
                    break;
                }
                runSingleMonitorThread(sequenceToMonitor, task.sequenceName);
                State.callbacks.updateMonitorUI();
            } else {
                State.callbacks.logError(`错误: 找不到监控序列 "${task.sequenceName}"`);
            }
            break;
        }

        case 'stop_monitor': {
            State.callbacks.log(`[${sourceName}] 正在停止监控: ${task.sequenceName}`);
            const monitorThreadId = State.appState.activeMonitors[task.sequenceName];

            if (monitorThreadId) {
                delete State.appState.activeMonitors[task.sequenceName];
                if (task.sequenceName === State.settings.mainMonitorKey || Object.keys(State.appState.activeMonitors).length === 0) {
                    State.appState.isMonitoring = false;
                    State.appState.timers = {};
                    State.callbacks.log("所有监控已停止，重置全局状态。");
                }
                
                ui.post(() => {
                    State.callbacks.updateMonitorUI();
                    if (!State.appState.isMonitoring && Object.keys(State.appState.activeMonitors).length === 0) {
                        if (State.uiRefs.controlPanel && State.uiRefs.controlPanel.monitorBtn) {
                            State.uiRefs.controlPanel.monitorBtn.setText("👁️");
                            State.uiRefs.controlPanel.monitorStatusIcon.setVisibility(8);
                        }
                    }
                });

                if (State.appState.threads[monitorThreadId]) {
                    if (State.appState.threads[monitorThreadId].isAlive()) {
                        State.callbacks.log(`正在终止线程: ${monitorThreadId}`);
                        State.appState.threads[monitorThreadId].interrupt();
                    }
                    delete State.appState.threads[monitorThreadId];
                }
                State.callbacks.log(`已停止监控 [${task.sequenceName}]`);
            } else {
                State.callbacks.log(`警告: 监控 [${task.sequenceName}] 未在运行。`);
            }
            break;
        }

        // 【修复】加上大括号，避免 subSeq 声明冲突
        case 'execute_sequence': {
            const subSeq = State.sequences[task.sequenceName];
            if (subSeq) {
                executeSequence(subSeq.tasks, `子序列 (${subSeq.name})`, contextType, depth + 1);
            } else {
                State.callbacks.logError(`未找到子序列: ${task.sequenceName}`);
            }
            break;
        }

        case 'timer':
            State.callbacks.log(`[${sourceName}] 执行任务 ${index + 1}: ${taskName}`);
            if (task.timerName && task.duration > 0) {
                State.appState.timers[task.timerName] = new Date().getTime() + task.duration;
                State.callbacks.log(`...计时器 [${task.timerName}] 已启动/重置，时长: ${task.duration}ms`);
            } else {
                State.callbacks.logError(`...错误: 计时器任务 [${taskName}] 配置不正确`);
            }
            break;

        default:
            State.callbacks.log(`[${sourceName}] 任务 ${task.type} 暂不支持或未实现`);
            break;
    }
}

// --- 监控线程逻辑 ---
function runSingleMonitorThread(sequence, sequenceKey) {
    let threadId = "monitor_" + sequenceKey + "_" + new Date().getTime();
    let triggerCooldowns = {}; // 定义冷却时间记录

    let th = threads.start(function () {
        State.callbacks.log(`监控 [${sequence.name}] 启动 (ID: ${threadId})`);
        for (let i = 0; i < 3; i++) { try { captureScreen(); } catch (e) { } sleep(200); }

        while (!threads.currentThread().isInterrupted()) {
            try {
                try { cleanupPriorityQueue(sequence); } catch (e) { }

                // 热更新 PQ
                try {
                    var __pqObj = PQManager.tryLoad(sequence, State.currentProfileName);
                    if (__pqObj && Array.isArray(__pqObj.priorityQueue)) {
                        const old = sequence.priorityQueue || [];
                        sequence.priorityQueue = __pqObj.priorityQueue.slice();
                        State.callbacks.log(`[PQ merge] loaded quick PQ`);
                    }
                } catch (e) { }

                const localTriggers = Array.isArray(sequence.triggers) ? sequence.triggers.slice() : [];
                let triggerFiredInCycle = false;
                let capturedImage = null;
                for (let retry = 0; retry < 3; retry++) {
                    capturedImage = captureScreen();
                    if (capturedImage) break;
                    sleep(300);
                }
                
                if (!capturedImage) {
                    State.callbacks.logError(`[${sequence.name}] 截图失败`);
                    sleep(sequence.executionPolicy.interval || 1000);
                    continue;
                }

                var ordered_final = reorderByPriority(sequence, localTriggers);

                ordered_final.forEach(function (trigger) {
                    if (trigger.enabled === false) return;
                    if (triggerFiredInCycle || threads.currentThread().isInterrupted()) return;

                    const triggerId = getTriggerId(trigger);
                    const cooldownEndTime = triggerCooldowns[triggerId];
                    const realNowTime = new Date().getTime();

                    if (cooldownEndTime && realNowTime < cooldownEndTime) return;
                    if (cooldownEndTime && realNowTime >= cooldownEndTime) delete triggerCooldowns[triggerId];

                    let foundLocation = null;

                    if (trigger.type === 'image') {
                        let template = null;
                        try {
                            let imagePath = files.join(CONSTANTS.FILES.IMAGE_DIR, trigger.target);
                            if (files.exists(imagePath)) {
                                template = images.read(imagePath);
                                if (template) {
                                    let p = null;
                                    if (trigger.cachedBounds) {
                                        let b = trigger.cachedBounds;
                                        let padding = (trigger.cachePadding !== undefined) ? trigger.cachePadding : (State.settings.defaultCachePadding || 50);
                                        let region = Utils.calculatePaddedRegion(b, padding);
                                        p = images.findImage(capturedImage, template, { region: region, threshold: trigger.threshold || 0.8 });
                                    }
                                    if (!p) {
                                        let findOptions = { threshold: trigger.threshold || 0.8 };
                                        if (trigger.search_area && trigger.search_area.length === 4) {
                                            let [x1, y1, x2, y2] = trigger.search_area;
                                            let searchBounds = { left: x1, top: y1, right: x2, bottom: y2 };
                                            findOptions.region = Utils.calculatePaddedRegion(searchBounds, 0);
                                        }
                                        p = images.findImage(capturedImage, template, findOptions);
                                        if (p) {
                                            trigger.cachedBounds = { x: p.x, y: p.y, width: template.getWidth(), height: template.getHeight() };
                                            State.callbacks.saveProfile();
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
                        if (trigger.cachedBounds) {
                            let b = trigger.cachedBounds;
                            let padding = (trigger.cachePadding !== undefined) ? trigger.cachePadding : (State.settings.defaultCachePadding || 50);
                            let cacheRegion = Utils.calculatePaddedRegion(b, padding);
                            let ocrResults = ocr.paddle.detect(capturedImage, { region: cacheRegion, useSlim: true });
                            ocrTarget = ocrResults.find(r => r.label.includes(trigger.target));
                        }
                        if (!ocrTarget) {
                            let ocrOptions = { useSlim: true };
                            if (trigger.search_area && trigger.search_area.length === 4) {
                                let [x1, y1, x2, y2] = trigger.search_area;
                                let searchBounds = { left: x1, top: y1, right: x2, bottom: y2 };
                                ocrOptions.region = Utils.calculatePaddedRegion(searchBounds, 0);
                            }
                            let ocrResults = ocr.paddle.detect(capturedImage, ocrOptions);
                            ocrTarget = ocrResults.find(r => r.label.includes(trigger.target));
                            if (ocrTarget) {
                                let b = ocrTarget.bounds;
                                trigger.cachedBounds = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
                                State.callbacks.saveProfile();
                            }
                        }
                        if (ocrTarget) {
                            let b = ocrTarget.bounds;
                            foundLocation = { x: b.left, y: b.top, width: b.width(), height: b.height() };
                        }
                    } else if (trigger.type === 'timer_end') {
                        const timerName = trigger.target;
                        if (State.appState.timers[timerName] && realNowTime > State.appState.timers[timerName]) {
                            foundLocation = { x: 0, y: 0, width: 0, height: 0 };
                            delete State.appState.timers[timerName];
                        }
                    }

                    if (foundLocation) {
                        executeTriggerAction(trigger, foundLocation);
                        triggerFiredInCycle = true;
                        bumpTriggerPriority(sequence, trigger);
                        if (trigger.cooldownMs > 0) {
                            triggerCooldowns[triggerId] = new Date().getTime() + trigger.cooldownMs;
                        }
                    } else {
                        if (trigger.onFail && trigger.onFail.action && trigger.onFail.action !== 'skip') {
                            executeMonitorFailAction(trigger);
                            triggerFiredInCycle = true;
                        }
                    }
                });

                capturedImage.recycle();

                if (!triggerFiredInCycle && sequence.tasks && sequence.tasks.length > 0) {
                    executeSequence(sequence.tasks, `监控序列 (${sequence.name}) 的未命中任务`, 'monitor');
                }
                if (new Date().getTime() % 30000 < (sequence.executionPolicy.interval || 1000)) {
                     // 简单GC
                     java.lang.System.gc();
                }

            } catch (e) {
                if (e instanceof java.lang.InterruptedException) break;
                State.callbacks.logError(`监控线程 [${sequence.name}] 出现严重错误: ${e}`);
            }
            sleep(sequence.executionPolicy.interval || 1000);
        }
    });

    State.appState.threads[threadId] = th;
    State.appState.activeMonitors[sequenceKey] = threadId;
}

// --- 补充辅助函数 ---

function handleOcrSuccess(result, successAction) {
    if (!result) return;
    const b = result.bounds;
    const centerX = b.left + (b.right - b.left) / 2;
    const centerY = b.top + (b.bottom - b.top) / 2;
    
    if (successAction.action === 'click') {
        const finalX = centerX + (successAction.offsetX || 0);
        const finalY = centerY + (successAction.offsetY || 0);
        State.callbacks.log(`OCR点击: (${finalX}, ${finalY})`);
        State.callbacks.showClickDot(finalX, finalY);
        Utils.safePress(finalX, finalY, CONSTANTS.UI.CLICK_PRESS_DURATION_MS);
    } else if (successAction.action === 'back') {
        back();
    }
}

function handleImageSuccess(location, successAction) {
    if (!location) return;
    if (successAction.action === 'click') {
        const finalX = location.centerX() + (successAction.offsetX || 0);
        const finalY = location.centerY() + (successAction.offsetY || 0);
        State.callbacks.log(`图点击: (${finalX}, ${finalY})`);
        State.callbacks.showClickDot(finalX, finalY);
        Utils.safePress(finalX, finalY, CONSTANTS.UI.CLICK_PRESS_DURATION_MS);
    } else if (successAction.action === 'back') {
        back();
    }
}

function handleGeneralFailAction(onFail, reason, sourceName, contextType, depth) {
    if (!onFail) return;
    if (onFail.action === 'stop') {
        State.callbacks.log(`任务失败 [${reason}]，停止脚本。`);
        State.callbacks.stopExecution(`任务失败: ${reason}`);
    } else if (onFail.action === 'execute_sequence') {
        if (onFail.sequenceName && State.sequences[onFail.sequenceName]) {
            State.callbacks.log(`任务失败 [${reason}]，执行Fail序列: ${onFail.sequenceName}`);
            executeSequence(State.sequences[onFail.sequenceName].tasks, "FailAction", contextType, depth + 1);
        }
    }
}

function handleGeneralSuccessAction(onSuccess, sourceName, contextType, depth) {
     if (!onSuccess) return;
     if (onSuccess.action === 'back') back();
     else if (onSuccess.action === 'execute_sequence') {
         if (onSuccess.sequenceName && State.sequences[onSuccess.sequenceName]) {
             executeSequence(State.sequences[onSuccess.sequenceName].tasks, "SuccessAction", contextType, depth + 1);
         }
     }
}

function getTriggerId(trigger) {
    return Utils.stableHash(trigger.target + trigger.type + (trigger.action ? trigger.action.type : ""));
}

function cleanupPriorityQueue(sequence) {
    if(!sequence.triggers) return;
    const ids = new Set(sequence.triggers.map(getTriggerId));
    if(sequence.priorityQueue && Array.isArray(sequence.priorityQueue)) {
        sequence.priorityQueue = sequence.priorityQueue.filter(id => ids.has(id));
    }
}

function reorderByPriority(sequence, triggers) {
    return triggers.sort((a, b) => {
        if (a.isTopPriority && !b.isTopPriority) return -1;
        if (!a.isTopPriority && b.isTopPriority) return 1;
        
        // PQ 逻辑：如果 PQ 中有记录，按 PQ 索引排序
        let idxA = -1, idxB = -1;
        if(sequence.priorityQueue) {
            idxA = sequence.priorityQueue.indexOf(getTriggerId(a));
            idxB = sequence.priorityQueue.indexOf(getTriggerId(b));
        }
        
        // 如果都在 PQ 中，按索引
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        // 如果 A 在 PQ 中，A 优先
        if (idxA !== -1) return -1;
        // 如果 B 在 PQ 中，B 优先
        if (idxB !== -1) return 1;
        
        return (a.order || 0) - (b.order || 0);
    });
}

function executeTriggerAction(trigger, location) {
    const action = trigger.action;
    if(!action) return;
    
    if(action.delayMs > 0) sleep(action.delayMs);

    if(action.type === 'click') {
         let x = location.x + (location.width/2) + (action.offsetX||0);
         let y = location.y + (location.height/2) + (action.offsetY||0);
         State.callbacks.showClickDot(x, y);
         Utils.safePress(x, y, CONSTANTS.UI.CLICK_PRESS_DURATION_MS);
    } else if (action.type === 'launch_app') {
         if(action.appName) app.launchApp(action.appName);
    } else if (action.type === 'back') {
         back();
    } else if (action.type === 'swipe') {
        if (action.swipeVector) {
             const cx = location.x + (location.width/2);
             const cy = location.y + (location.height/2);
             swipe(cx, cy, cx + action.swipeVector.dx, cy + action.swipeVector.dy, action.swipeVector.duration);
        } else if (action.swipeCoords) {
             swipe(action.swipeCoords.startX, action.swipeCoords.startY, action.swipeCoords.endX, action.swipeCoords.endY, action.swipeCoords.duration);
        }
    }
}

function executeMonitorFailAction(trigger) {
     if (trigger.onFail.action === 'back') back();
     else if (trigger.onFail.action === 'launch_app') {
         if(trigger.onFail.appName) app.launchApp(trigger.onFail.appName);
     } else if (trigger.onFail.action === 'execute_sequence') {
         if(trigger.onFail.sequenceName && State.sequences[trigger.onFail.sequenceName]) {
             executeSequence(State.sequences[trigger.onFail.sequenceName].tasks, "TriggerFail", "monitor", 0);
         }
     }
}

function bumpTriggerPriority(sequence, trigger) {
    if (!sequence.priorityQueue) sequence.priorityQueue = [];
    const id = getTriggerId(trigger);
    const idx = sequence.priorityQueue.indexOf(id);
    if (idx > -1) sequence.priorityQueue.splice(idx, 1);
    sequence.priorityQueue.unshift(id);
    if(sequence.priorityQueue.length > 50) sequence.priorityQueue.pop(); // limit size
    
    PQManager.write(sequence, State.currentProfileName);
}

// --- 导出 ---
module.exports = {
    executeSequence: executeSequence,
    runSingleMonitorThread: runSingleMonitorThread,
    getStopSignal: getStopSignal
};