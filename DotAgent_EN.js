"ui";

// =================================================================================
// SCRIPT CONSTANTS
// =================================================================================
const CONSTANTS = {
    VERSION: "1.2.2", // Version update, fixed tutorial window positioning bug
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
// GLOBAL STATE AND REFERENCES
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
} catch (e) { /* Ignore error */ }

// =================================================================================
// UI AND MAIN LOGIC
// =================================================================================

ui.layout(
    <vertical gravity="top">
        <text id="mainTitle" textSize="20sp" textColor="#000000" text="DotAgent Automation Tool (Pro)" padding="16 16 16 0" />
        <text textSize="14sp" textColor="#555555" text="Click the button below to launch the floating control panel." padding="16 8 16 0" />
        <button id="startFloatyBtn" text="Launch Floating Window" margin="16 20 16 0" />

        <card w="*" margin="16 15 16 0" cardCornerRadius="8dp" cardElevation="2dp">
            <vertical>
                <horizontal padding="10" gravity="center_vertical">
                    <text text="Configuration and Settings" textColor="#212121" textSize="16sp" layout_weight="1" />
                    <button id="toggleEditorBtn" text="Switch to JSON Mode" style="Widget.AppCompat.Button.Borderless.Colored" textSize="12sp" />
                </horizontal>

                <vertical id="graphicalSettingsView" padding="0 10 10 10">
                    <ScrollView h="200dp">
                        <vertical>
                            <horizontal gravity="center_vertical" marginTop="5"><text>Loop Count:</text><input id="loopCountInput" inputType="number" layout_weight="1" singleLine="true" textSize="14sp" /></horizontal>
                            <horizontal gravity="center_vertical" marginTop="5"><text>Delay After Click (ms):</text><input id="clickDelayInput" inputType="number" layout_weight="1" singleLine="true" textSize="14sp" /></horizontal>
                            <horizontal gravity="center_vertical" marginTop="5"><text>Default Swipe Duration (ms):</text><input id="swipeDurationInput" inputType="number" layout_weight="1" singleLine="true" textSize="14sp" /></horizontal>
                            <horizontal gravity="center_vertical" marginTop="5"><text id="yOffsetTextLabel" text="Y-Axis Offset:" /><input id="yOffsetInput" inputType="number" layout_weight="1" singleLine="true" textSize="14sp" /></horizontal>
                            <horizontal gravity="center_vertical" marginTop="5"><text>Standalone Countdown (s):</text><input id="countdownSecondsInput" inputType="number" layout_weight="1" singleLine="true" textSize="14sp" /></horizontal>
                            <horizontal gravity="center_vertical" marginTop="5"><text>Control Panel Width:</text><input id="panelWidthInput" inputType="number" layout_weight="1" singleLine="true" textSize="14sp" /></horizontal>
                            <horizontal gravity="center_vertical" marginTop="5"><text>Target View Size:</text><input id="targetViewSizeInput" inputType="number" layout_weight="1" singleLine="true" textSize="14sp" /></horizontal>
                            <text text="Theme and Colors (Hex format: #AARRGGBB)" textColor="#757575" marginTop="10"/>
                            <horizontal gravity="center_vertical" marginTop="5"><text>Target View Color(🌟):</text><input id="targetColorInput" layout_weight="1" singleLine="true" textSize="14sp" /></horizontal>
                            <horizontal gravity="center_vertical" marginTop="5"><text>Click Task Color(🎯):</text><input id="clickTaskColorInput" layout_weight="1" singleLine="true" textSize="14sp" /></horizontal>
                            <horizontal gravity="center_vertical" marginTop="5"><text>Swipe Task Color(S/E):</text><input id="swipeTaskColorInput" layout_weight="1" singleLine="true" textSize="14sp" /></horizontal>
                        </vertical>
                    </ScrollView>
                    <button id="saveGraphicalSettingsBtn" text="Save Settings" marginTop="10" />
                </vertical>

                <vertical id="jsonEditorView" visibility="gone" padding="0 10 10 10">
                    <input id="configEditor" h="200dp" marginTop="5" singleLine="false" gravity="top" textSize="12sp" enabled="false" />
                    <button id="saveConfigBtn" text="Save JSON Changes and Apply" marginTop="10" enabled="false" />
                </vertical>
            </vertical>
        </card>

        <ScrollView layout_weight="1" margin="0 10 0 10">
            <vertical padding="6 5 6 16">
                <card w="*" cardCornerRadius="8dp" cardElevation="2dp" marginTop="15">
                    <vertical padding="10">
                        <horizontal gravity="center_vertical">
                            <text text="Task Execution Log" textColor="#212121" textSize="16sp" layout_weight="1" />
                            <button id="clearLogBtn" text="Clear" style="Widget.AppCompat.Button.Borderless" textSize="12sp" />
                        </horizontal>
                        <ScrollView id="logScrollView" h="200dp" marginTop="5" bg="#F5F5F5">
                            <text id="logView" padding="5" textSize="10sp" textColor="#333333" />
                        </ScrollView>
                    </vertical>
                </card>
                <button id="profileManagerBtn" text="Profile Management and Backup" marginTop="15" enabled="false" />
                <button id="importExportBtn" text="Import/Export" marginTop="10" enabled="false" />
                <button id="showHelpBtn" text="Help and Information" marginTop="10" />
                <button id="exitAppBtn" text="Exit Application" marginTop="20" />
            </vertical>
        </ScrollView>
    </vertical>
);
uiRefs.mainView = ui;
ui.mainTitle.setText(`DotAgent Automation Tool (Pro) v${CONSTANTS.VERSION}`);
ui.yOffsetTextLabel.setText(`Y-Axis Offset (Status Bar: ${statusBarHeight}):`);
logToScreen("Application UI loaded.");

// -- Main Interface Button Bindings --
ui.exitAppBtn.click(closeAllAndExit);
ui.showHelpBtn.click(showHelpDialog);
ui.startFloatyBtn.click(function () {
    if (appState.isFloatyCreated) {
        toast("Floating window is already running, no need to restart.");
        return;
    }
    if (!checkPermissions()) return;
    logToScreen("Permission check passed, launching floating window...");
    ui.startFloatyBtn.setEnabled(false);
    ui.startFloatyBtn.setText("Launching...");
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
                toast("Floating window creation failed, please check permissions or restart");
                logToScreen("Floating window creation failed.");
                ui.startFloatyBtn.setEnabled(true);
                ui.startFloatyBtn.setText("Launch Floating Window");
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
            ui.startFloatyBtn.setText("Launch Floating Window");
            logToScreen(`Floating window launched successfully! Current profile: ${currentProfileName.replace(CONSTANTS.FILES.PROFILE_PREFIX, '').replace('.json', '')}`);
            toast("Floating window has been launched!");
            activity.moveTaskToBack(true);
            if (!metaConfig.hasSeenTutorial) {
                startTutorial();
            }
        });
    });
});
ui.profileManagerBtn.click(() => {
    if (appState.isFloatyCreated) showProfileManager();
    else toast("Please launch the floating window first");
});
ui.importExportBtn.click(() => {
    if (appState.isFloatyCreated) showImportExportDialog();
    else toast("Please launch the floating window first");
});
ui.saveConfigBtn.click(() => {
    if (!appState.isFloatyCreated) {
        toast("Please launch the floating window before saving");
        return;
    }
    try {
        const editorText = ui.configEditor.getText().toString();
        const newConfig = JSON.parse(editorText);
        if (!newConfig || typeof newConfig.settings !== 'object' || !Array.isArray(newConfig.tasks)) {
            throw new Error("Configuration file format is incorrect, missing settings or tasks field");
        }
        appSettings = newConfig.settings;
        taskSequence = newConfig.tasks;
        saveCurrentProfile();
        refreshAllUI();
        logToScreen("Configuration saved via JSON editor.");
        toast("Changes saved and applied!");
    } catch (e) {
        logToScreen("JSON save failed: " + e.message);
        dialogs.alert("Save failed!", "Invalid JSON format or illegal content, please check your modifications.\n\nError details: " + e.message);
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
        logToScreen("Settings saved via graphical panel.");
        toast("Settings saved and applied!");
    } catch (e) {
        logToScreen("Graphical settings save failed: " + e.message);
        toast("Save failed: " + e.message);
    }
});
ui.toggleEditorBtn.click(() => {
    appState.isJsonEditorVisible = !appState.isJsonEditorVisible;
    if (appState.isJsonEditorVisible) {
        ui.graphicalSettingsView.setVisibility(8);
        ui.jsonEditorView.setVisibility(0);
        ui.toggleEditorBtn.setText("Switch to Graphical Mode");
        displayConfigInEditor();
    } else {
        ui.jsonEditorView.setVisibility(8);
        ui.graphicalSettingsView.setVisibility(0);
        ui.toggleEditorBtn.setText("Switch to JSON Mode");
        populateGraphicalSettings();
    }
});
ui.clearLogBtn.click(() => {
    ui.logView.setText("");
    logToScreen("Log cleared.");
});

// =================================================================================
// NEW USER TUTORIAL
// =================================================================================
function startTutorial() {
    let step = 0;
    // **[FIXED]** Optimized the position function to intelligently determine location
    const steps = [
        {
            text: "Welcome! This is the control panel.\n[Long press and drag] here to move it.",
            position: (target) => getTutorialPosition(target, 'above')
        },
        {
            text: "[Single click] the header area to collapse/expand the buttons.",
            position: (target) => getTutorialPosition(target, 'above')
        },
        {
            text: "This is the [Target View], all clicks and swipes are based on it.\n[Drag] it to change its position.",
            position: (target) => getTutorialPosition(target, 'above')
        },
        {
            text: "Move the target view to the desired click position,\nthen press [Add Task] -> [Click Task] to create a point.",
            position: (target) => getTutorialPosition(target, 'auto')
        },
        {
            text: "All settings and tasks are saved in 'Profiles'.\nYou can manage, create, and switch profiles here.\n\nTutorial finished, let's get started!",
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

    // New helper function to calculate tutorial position
    function getTutorialPosition(targetWindow, preference) {
        if (!targetWindow) return { x: device.width / 4, y: device.height / 3 };

        const targetX = targetWindow.getX();
        const targetY = targetWindow.getY();
        const targetH = targetWindow.getHeight();
        const estTutorialH = 250; // Estimated tutorial window height
        const spacing = 20;

        let yPos;

        if (preference === 'above') {
            yPos = targetY - estTutorialH - spacing;
        } else if (preference === 'below') {
            yPos = targetY + targetH + spacing;
        } else { // auto
            if (targetY + targetH + estTutorialH + spacing > device.height) {
                // If not enough space below, place it above
                yPos = targetY - estTutorialH - spacing;
            } else {
                // Otherwise, place it below
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
            toast("Tutorial finished!");
            return;
        }

        const currentStep = steps[index];
        const target = targets[index]();
        const pos = currentStep.position(target);

        appState.ui.tutorialWindow = floaty.rawWindow(
            <card w="*" h="*" cardCornerRadius="10dp" cardElevation="8dp" bg="#C0000000">
                <vertical gravity="center" padding="16">
                    <text id="text" textColor="#FFFFFF" textSize="18sp" textStyle="bold" gravity="center"/>
                    <button id="nextBtn" text="Next" marginTop="20"/>
                </vertical>
            </card>
        );
        appState.ui.tutorialWindow.text.setText(currentStep.text);
        appState.ui.tutorialWindow.setSize(device.width / 2, -2);
        appState.ui.tutorialWindow.setPosition(pos.x, pos.y);
        
        // Use a delay to ensure window dimensions are calculated before validating position
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
// CORE EXECUTION: TASK SEQUENCE
// =================================================================================
function isBusy() {
    if (appState.ui.instructionWindow || appState.ui.tutorialWindow) {
        toast("Please complete or cancel the current operation first");
        return true;
    }
    return false;
}
function toggleSequenceExecution() {
    if (isBusy()) return;
    if (appState.isExecuting) {
        stopExecution("Task sequence stopped manually");
        return;
    }
    if (appState.threads.execution && appState.threads.execution.isAlive()) {
        toast("Task is already running, do not start again!");
        return;
    }
    if (taskSequence.length === 0) {
        toast("Task sequence is empty, please add tasks first.");
        return;
    }
    appState.isExecuting = true;
    updateControlButtonText("Executing...", "stop");
    const executionThread = threads.start(function () {
        try {
            logToScreen(`Task sequence started, ${appSettings.loopCount} loops in total.`);
            for (let loop = 1; loop <= appSettings.loopCount; loop++) {
                if (!appState.isExecuting) break;
                logToScreen(`Loop ${loop} / ${appSettings.loopCount} begins`);
                for (let i = 0; i < taskSequence.length; i++) {
                    if (!appState.isExecuting) break;
                    let task = taskSequence[i];
                    if (!task) {
                        logToScreen(`Warning: Invalid task found at position ${i + 1}, it may have been modified during execution. Skipping this task.`);
                        continue;
                    }
                    logToScreen(`Executing task ${i + 1}: [${task.type}] ${task.name}`);
                    switch (task.type) {
                        case 'click':
                            showClickDot(task.x, task.y);
                            press(task.x, task.y, 50);
                            sleep(appSettings.clickDelayMs);
                            break;
                        case 'wait':
                            toast(`Executing: ${task.name}`);
                            sleep(task.duration);
                            break;
                        case 'swipe':
                            toast(`Executing: ${task.name}`);
                            swipe(task.startX, task.startY, task.endX, task.endY, task.duration);
                            sleep(appSettings.clickDelayMs);
                            break;
                    }
                }
                if (!appState.isExecuting) break;
                logToScreen(`Loop ${loop} finished.`);
            }
        } catch (e) {
            if (!(e instanceof java.lang.ThreadDeath)) {
                logToScreen("Task execution error: " + e);
                ui.run(() => toast("An error occurred during task execution, please check the log for details!"));
            }
        }
    });
    appState.threads.execution = executionThread;
    threads.start(function () {
        executionThread.join();
        if (appState.isExecuting) {
            stopExecution("Task sequence execution complete");
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
    updateControlButtonText("Execute Sequence", "start");
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
        if (!(e instanceof java.lang.ThreadDeath)) logToScreen("Unknown error in countdown: " + e);
    } finally {
        ui.run(() => { if (countdownWindow) countdownWindow.close(); });
    }
}

// =================================================================================
// UI AND FLOATY MANAGEMENT
// =================================================================================
function checkPermissions() {
    if (!auto.service) {
        toast("Please enable Accessibility Service first, then retry.");
        app.startActivity({ packageName: "com.android.settings", className: "com.android.settings.Settings$AccessibilitySettingsActivity" });
        return false;
    }
    if (!floaty.hasPermission()) {
        toast("Please grant the floating window permission, then launch the application!");
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
        logToScreen("Target view color format is incorrect, using default color");
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
    uiRefs.redDot = floaty.rawWindow(<frame><vertical><view bg="#FFFF0000" w="30" h="30" style="border-radius:15px;" /><text text="Click Point" textSize="10sp" textColor="#FFFFFF" gravity="center" /></vertical></frame>);
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
                <button id="executeBtn" text="Execute Sequence" />
                <button id="singleClickBtn" text="Single Click" />
                <button id="countdownBtn" text="Standalone Countdown" />
                <button id="addTaskBtn" text="Add Task" />
                <button id="manageBtn" text="Manage and Settings" />
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
                    toast("Single click executed");
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
                toast("Please set a countdown greater than 0 in the settings first");
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
        toast(`Task ${index + 1} position updated`);
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
// TASK MANAGEMENT AND SETTINGS
// =================================================================================
function showAddTaskDialog() {
    if (isBusy()) return;
    dialogs.select("Please select the type of task to add", ["[Click] Task", "[Swipe] Task", "[Wait] Task"])
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
    let name = "Click Task " + (newIndex + 1);
    let task = { type: 'click', name: name, x: x, y: y };
    taskSequence.push(task);
    createTaskWindow(task, newIndex);
    saveCurrentProfile();
    logToScreen(`Added new task: ${name}`);
    toast(`Added: ${name}`);
}
function addSwipeTask() {
    if (isBusy()) return;
    let tempPos = {};
    showInstructionPanel("Please drag 🌟 to the swipe start point, then click confirm", "Record Start Point", () => {
        tempPos.startX = uiRefs.targetView.getX() + uiRefs.targetView.getWidth() / 2;
        tempPos.startY = uiRefs.targetView.getY() + uiRefs.targetView.getHeight() / 2;
        showInstructionPanel("Please drag 🌟 to the swipe end point, then click confirm", "Record End Point and Finish", () => {
            tempPos.endX = uiRefs.targetView.getX() + uiRefs.targetView.getWidth() / 2;
            tempPos.endY = uiRefs.targetView.getY() + uiRefs.targetView.getHeight() / 2;
            let newIndex = taskSequence.length;
            let task = { type: 'swipe', name: `Swipe Task ${newIndex + 1}`, startX: tempPos.startX, startY: tempPos.startY, endX: tempPos.endX, endY: tempPos.endY, duration: appSettings.swipe.duration };
            taskSequence.push(task);
            createSwipeVisuals(task, newIndex);
            saveCurrentProfile();
            logToScreen(`Added new task: ${task.name}`);
            toast(`Added: ${task.name}`);
        }, () => { toast("Operation canceled"); });
    }, () => { toast("Operation canceled"); });
}
function addWaitTask() {
    dialogs.rawInput("Enter wait time (milliseconds)", "1000").then(durationStr => {
        if (!validateNumericInput(durationStr)) return;
        let duration = parseInt(durationStr);
        if (duration > 0) {
            let task = { type: 'wait', name: `Wait ${duration}ms`, duration: duration };
            taskSequence.push(task);
            saveCurrentProfile();
            logToScreen(`Added wait task: ${task.name}`);
            toast(`Added wait task`);
        } else {
            toast("Invalid input");
        }
    });
}
function showManagementDialog() {
    if (isBusy()) return;
    const dialogView = ui.inflate(
        <vertical>
            <text text="Task Sequence (Click name to edit)" padding="10 5" textSize="14sp" textColor="#757575" />
            <ScrollView h="300dp">
                <vertical id="taskListContainer" />
            </ScrollView>
            <CardView w="*" margin="10 15 10 5" cardCornerRadius="8dp" cardElevation="2dp">
                <vertical>
                    <horizontal id="loopSettingRow" w="*" padding="12 10" gravity="center_vertical" bg="?attr/selectableItemBackground">
                        <text text="🔄" textSize="18sp" marginRight="10" />
                        <text text="Loop Count" layout_weight="1" textColor="#212121" textSize="16sp" />
                        <text id="loopCountValue" text={`${appSettings.loopCount} times`} marginRight="5" textColor="#757575" />
                        <text text=">" textColor="#BDBDBD" />
                    </horizontal>
                    <View h="1dp" bg="#E0E0E0" marginLeft="12" marginRight="12" />
                    <horizontal id="countdownSettingRow" w="*" padding="12 10" gravity="center_vertical" bg="?attr/selectableItemBackground">
                        <text text="⏱️" textSize="18sp" marginRight="10" />
                        <text text="Standalone Countdown" layout_weight="1" textColor="#212121" textSize="16sp" />
                        <text id="countdownValue" text={`${appSettings.countdownSeconds} seconds`} marginRight="5" textColor="#757575" />
                        <text text=">" textColor="#BDBDBD" />
                    </horizontal>
                    <View h="1dp" bg="#E0E0E0" marginLeft="12" marginRight="12" />
                    <horizontal id="profileManagerRow" w="*" padding="12 10" gravity="center_vertical" bg="?attr/selectableItemBackground">
                        <text text="💾" textSize="18sp" marginRight="10" />
                        <text text="Profile Management and Backup" layout_weight="1" textColor="#212121" textSize="16sp" />
                        <text text=">" textColor="#BDBDBD" />
                    </horizontal>
                    <View h="1dp" bg="#E0E0E0" marginLeft="12" marginRight="12" />
                    <horizontal id="showTutorialRow" w="*" padding="12 10" gravity="center_vertical" bg="?attr/selectableItemBackground">
                        <text text="❓" textSize="18sp" marginRight="10" />
                        <text text="Show New User Tutorial" layout_weight="1" textColor="#212121" textSize="16sp" />
                        <text text=">" textColor="#BDBDBD" />
                    </horizontal>
                </vertical>
            </CardView>
        </vertical>
        , null, false);
    const dialog = dialogs.build({ customView: dialogView, title: "Manage and Settings", positive: "Done", neutral: "Exit Script" }).on("neutral", closeAllAndExit).show();
    function populateTaskList(container) {
        ui.run(() => {
            container.removeAllViews();
            if (taskSequence.length === 0) {
                const emptyView = ui.inflate(<text text="No tasks currently, please add one" textColor="#9E9E9E" gravity="center" padding="20" />, container, false);
                container.addView(emptyView);
                return;
            }
            taskSequence.forEach((task, index) => {
                const taskItemView = ui.inflate(
                    <horizontal w="*" gravity="center_vertical" padding="5 0">
                        <text id="taskName" text="{{this.name}}" layout_weight="1" textColor="#000000" ellipsize="end" maxLines="1" />
                        <button id="upBtn" text="Up" style="Widget.AppCompat.Button.Borderless" w="50dp" />
                        <button id="downBtn" text="Down" style="Widget.AppCompat.Button.Borderless" w="50dp" />
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
    dialogView.loopSettingRow.click(() => { promptToSetLoopCount(() => { ui.run(() => dialogView.loopCountValue.setText(appSettings.loopCount + " times")); }); });
    dialogView.countdownSettingRow.click(() => { promptToSetCountdown(() => { ui.run(() => dialogView.countdownValue.setText(appSettings.countdownSeconds + " seconds")); }); });
    dialogView.profileManagerRow.click(() => { dialog.dismiss(); showProfileManager(); });
    dialogView.showTutorialRow.click(() => { dialog.dismiss(); startTutorial(); });
    populateTaskList(dialogView.taskListContainer);
}
function promptToSetLoopCount(onSuccessCallback) {
    dialogs.rawInput("Enter the number of loops for the task sequence", appSettings.loopCount.toString()).then(countStr => {
        if (!validateNumericInput(countStr)) return;
        let count = parseInt(countStr);
        if (count > 0) {
            appSettings.loopCount = count;
            saveCurrentProfile();
            toast(`Loop count has been set to: ${count}`);
            if (onSuccessCallback) onSuccessCallback();
        } else {
            toast("Loop count must be greater than 0");
        }
    });
}
function promptToSetCountdown(onSuccessCallback) {
    dialogs.rawInput("Enter the seconds for the standalone countdown (1-10 recommended)", appSettings.countdownSeconds.toString())
        .then(secondsStr => {
            if (!validateNumericInput(secondsStr)) return;
            let seconds = parseInt(secondsStr);
            appSettings.countdownSeconds = seconds;
            saveCurrentProfile();
            toast(`Countdown set to: ${seconds} seconds`);
            if (onSuccessCallback) onSuccessCallback();
        });
}
function showTaskEditor(task, index) {
    if (!task) return;
    const view = ui.inflate(
        <vertical padding="16">
            <text>Task Name:</text><input id="name" />
            <vertical id="wait_fields" visibility="gone"><text>Wait Time (ms):</text><input id="wait_duration" inputType="number" /></vertical>
            <vertical id="click_fields" visibility="gone"><horizontal><text>X:</text><input id="click_x" inputType="numberDecimal" /><text>Y:</text><input id="click_y" inputType="numberDecimal" /></horizontal></vertical>
            <vertical id="swipe_fields" visibility="gone">
                <horizontal><text>Start X:</text><input id="swipe_startX" inputType="numberDecimal" /><text>Start Y:</text><input id="swipe_startY" inputType="numberDecimal" /></horizontal>
                <horizontal><text>End X:</text><input id="swipe_endX" inputType="numberDecimal" /><text>End Y:</text><input id="swipe_endY" inputType="numberDecimal" /></horizontal>
                <text>Swipe Duration (ms):</text><input id="swipe_duration" inputType="number" />
            </vertical>
        </vertical>, null, false);
    view.name.setText(task.name);
    switch (task.type) {
        case 'wait': view.wait_duration.setText(String(task.duration || 1000)); break;
        case 'click': view.click_x.setText(String(task.x || 0)); view.click_y.setText(String(task.y || 0)); break;
        case 'swipe': view.swipe_startX.setText(String(task.startX || 0)); view.swipe_startY.setText(String(task.startY || 0)); view.swipe_endX.setText(String(task.endX || 0)); view.swipe_endY.setText(String(task.endY || 0)); view.swipe_duration.setText(String(task.duration || 300)); break;
    }
    view[task.type + "_fields"].setVisibility(0);
    dialogs.build({ customView: view, title: `Edit Task ${index + 1}`, positive: "Save", negative: "Cancel", neutral: "Delete Task" })
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
        toast("Task saved");
    }).on("neutral", dialog => {
        dialogs.confirm("Confirm Deletion?", `This will delete the task: ${task.name}`).then(ok => {
            if (ok) {
                taskSequence.splice(index, 1);
                recreateAllTaskVisuals();
                saveCurrentProfile();
                logToScreen(`Task "${task.name}" has been deleted.`);
                toast("Task deleted");
            }
        });
    }).show();
}

// =================================================================================
// UTILITY FUNCTIONS
// =================================================================================
function showHelpDialog() {
    dialogs.build({ title: "Help and Information", content: `[Core Concepts]\n1. Target View(🌟): This is the reference point for all actions. When adding a task or performing a single click, its position is the target position.\n\n2. Y-Axis Offset: Due to the Android status bar at the top, the actual touch point needs to be offset downwards for precise clicking. This value is the downward pixel offset, usually set to the status bar height (or slightly larger) for best results.\n\n[Profiles and Tasks]\n- Profile: A complete collection of 'Settings' and a 'Task Sequence' that can be saved and loaded at any time.\n- Task: A combination of 'Click', 'Swipe', and 'Wait' actions, executed in sequence.\n\n[Import/Export]\n- Path: All import/export operations are based in the "DotAgentBackup" folder in your phone's internal storage.\n- Format: Exported files are standard .json files, which can be shared with others or used for backup.\n\n[Hide Buttons]\n- Action: Single-click the top drag bar of the control panel to hide/show the function buttons below to save screen space.\n\n--------------------\nVersion: ${CONSTANTS.VERSION}`, positive: "I Understand" }).show();
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
            toast("Storage permission is required for import/export");
            runtime.requestPermissions(permissions);
            sleep(2000);
            if (!arePermissionsGranted()) {
                toast("Storage permission not granted, operation aborted");
                return false;
            }
        }
        return true;
    } catch (e) {
        toast("Permission request failed: " + e);
        logToScreen("Permission request failed: " + e);
        return false;
    }
}
function showInstructionPanel(instructionText, buttonText, onConfirm, onCancel) {
    if (appState.ui.instructionWindow) {
        appState.ui.instructionWindow.close();
    }
    let win = floaty.rawWindow(<card cardCornerRadius="10dp" cardElevation="5dp" margin="10"><horizontal bg="#E0E0E0" padding="10" gravity="center_vertical"><text id="instruction_text" textColor="#000000" textSize="16sp" layout_weight="1" /><button id="cancel_btn" text="Cancel" style="?android:attr/borderlessButtonStyle" textColor="#757575" /><button id="confirm_btn" style="Widget.AppCompat.Button.Colored" /></horizontal></card>);
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
function toggleControlButtonsVisibility() { appSettings.controlButtonsHidden = !appSettings.controlButtonsHidden; applyButtonVisibility(); saveCurrentProfile(); updateProfileNameDisplay(); toast(appSettings.controlButtonsHidden ? "Buttons hidden (click header to restore)" : "Buttons shown"); }
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
        try { uiRefs.targetView.root.setBackgroundColor(android.graphics.Color.parseColor(appSettings.theme.targetViewColor)); } catch(e) { logToScreen("Target view color format is incorrect"); }
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
function updateProfileNameDisplay() { if (uiRefs.controlPanel && uiRefs.controlPanel.profileNameText) { let displayName = currentProfileName.replace(CONSTANTS.FILES.PROFILE_PREFIX, '').replace('.json', ''); let displayText = appSettings.controlButtonsHidden ? `(Click to show) ${displayName}` : `Profile: ${displayName}`; ui.run(() => { uiRefs.controlPanel.profileNameText.setText(displayText); }); } }
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
function validateNumericInput(inputStr, allowFloat = false) { if (!inputStr || inputStr.trim() === "") { toast("Input cannot be empty"); return false; } const regex = allowFloat ? /^-?[\d.]+$/ : /^\d+$/; if (!regex.test(inputStr)) { toast(`Please enter a valid ${allowFloat ? "" : "whole"} number format`); return false; } return true; }

// =================================================================================
// FILE AND CONFIGURATION MANAGEMENT
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
            if (!configStr) throw new Error("File is empty.");
            const loadedConfig = JSON.parse(configStr);
            let newSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
            Object.assign(newSettings, loadedConfig.settings);
            if (!newSettings.theme) { newSettings.theme = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.theme)); }
            if (newSettings.redDotOffsetY !== undefined) { newSettings.yOffset = newSettings.redDotOffsetY; delete newSettings.redDotOffsetY; }
            appSettings = newSettings;
            taskSequence = loadedConfig.tasks || [];
            currentProfileName = profileName;
            logToScreen(`Profile "${profileName.replace(CONSTANTS.FILES.PROFILE_PREFIX, '').replace('.json', '')}" loaded successfully.`);
            return true;
        } catch (e) {
            logToScreen(`Failed to load profile "${profileName}": ${e.message}. The file may be corrupted.`);
            toast(`Failed to load profile: ${profileName.replace(CONSTANTS.FILES.PROFILE_PREFIX, '').replace('.json', '')}. Will reset to default profile.`);
            resetToDefaultProfile();
            return false;
        }
    } else {
        logToScreen(`Profile file does not exist: ${profileName}, will use default profile.`);
        return false;
    }
}
function loadLastUsedProfile() {
    if (files.exists(CONSTANTS.FILES.META_CONFIG_FILE)) {
        try { metaConfig = JSON.parse(files.read(CONSTANTS.FILES.META_CONFIG_FILE)) || {}; } catch (e) { logToScreen("Failed to read meta config file, using defaults."); metaConfig = {}; }
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
    logToScreen("Reset to default profile.");
}
function showProfileManager() {
    if (isBusy()) return;
    const profiles = files.listDir(CONSTANTS.FILES.CONFIG_DIR).filter(name => name.startsWith(CONSTANTS.FILES.PROFILE_PREFIX) && name.endsWith('.json'));
    const displayNames = profiles.map(name => name.replace(CONSTANTS.FILES.PROFILE_PREFIX, '').replace('.json', ''));
    const currentProfileDisplayName = currentProfileName.replace(CONSTANTS.FILES.PROFILE_PREFIX, '').replace('.json', '');
    displayNames.unshift("[Create New Profile]");
    dialogs.select(`Select a profile to manage\n(Current: ${currentProfileDisplayName})`, displayNames)
        .then(selectedIndex => {
            if (selectedIndex < 0) { toast("Operation canceled"); return; }
            if (selectedIndex === 0) {
                dialogs.rawInput("Enter a name for the new profile", "My New Profile").then(newName => {
                    newName = newName.trim();
                    if (!newName || newName.includes('/') || newName.includes('\\') || newName === 'default') {
                        toast("Name is invalid or conflicts with the default profile!");
                        return;
                    }
                    const newProfileName = CONSTANTS.FILES.PROFILE_PREFIX + newName + ".json";
                    const newProfilePath = files.join(CONSTANTS.FILES.CONFIG_DIR, newProfileName);
                    if (files.exists(newProfilePath)) {
                        toast("Error: A profile with the same name already exists!");
                        return;
                    }
                    currentProfileName = newProfileName;
                    appSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
                    taskSequence = [];
                    saveCurrentProfile();
                    refreshAllUI();
                    toast(`Created and loaded new profile: "${newName}"`);
                    logToScreen(`Created and loaded new profile: "${newName}"`);
                });
                return;
            }
            const profileIndex = selectedIndex - 1;
            const selectedProfile = profiles[profileIndex];
            const selectedDisplayName = displayNames[selectedIndex];
            const actions = ["Load", "Save As...", "Delete"];
            if (selectedProfile === CONSTANTS.FILES.PROFILE_PREFIX + "default.json") {
                actions.pop();
            }
            dialogs.select(`Select an action for [${selectedDisplayName}]`, actions)
                .then(actionIndex => {
                    if (actionIndex < 0) return;
                    switch (actions[actionIndex]) {
                        case "Load":
                            if (loadProfile(selectedProfile)) { saveCurrentProfile(); refreshAllUI(); toast(`Profile "${selectedDisplayName}" loaded successfully`); }
                            break;
                        case "Save As...":
                            dialogs.rawInput("Enter a name for the new profile", "").then(newName => {
                                newName = newName.trim();
                                if (!newName || newName.includes('/') || newName.includes('\\')) { toast("Name cannot be empty and cannot contain special characters!"); return; }
                                const newProfileName = CONSTANTS.FILES.PROFILE_PREFIX + newName + ".json";
                                const newProfilePath = files.join(CONSTANTS.FILES.CONFIG_DIR, newProfileName);
                                if (files.exists(newProfilePath)) { toast("Error: A profile with the same name already exists!"); return; }
                                const sourceProfilePath = files.join(CONSTANTS.FILES.CONFIG_DIR, selectedProfile);
                                if (files.copy(sourceProfilePath, newProfilePath)) {
                                    currentProfileName = newProfileName;
                                    loadProfile(currentProfileName);
                                    saveCurrentProfile();
                                    refreshAllUI();
                                    toast(`Profile saved as "${newName}" and loaded!`);
                                    logToScreen(`Profile "${selectedDisplayName}" was saved as "${newName}" and loaded automatically.`);
                                } else {
                                    toast("Save As failed! Could not copy file.");
                                }
                            });
                            break;
                        case "Delete":
                            dialogs.confirm("Confirm Deletion?", `This will permanently delete the profile: "${selectedDisplayName}"`).then(ok => {
                                if (ok) {
                                    const profilePath = files.join(CONSTANTS.FILES.CONFIG_DIR, selectedProfile);
                                    if (files.remove(profilePath)) {
                                        toast("Deletion successful");
                                        logToScreen(`Profile "${selectedDisplayName}" has been deleted.`);
                                        if (currentProfileName === selectedProfile) {
                                            resetToDefaultProfile();
                                            refreshAllUI();
                                        }
                                    } else {
                                        toast("Deletion failed");
                                    }
                                }
                            });
                            break;
                    }
                });
        });
}
function displayConfigInEditor() { if (!ui.configEditor) return; const config = { settings: appSettings, tasks: taskSequence }; ui.run(() => { ui.configEditor.setText(JSON.stringify(config, null, 2)); }); }
function showImportExportDialog() { dialogs.select("Import/Export Current Profile", ["Import (Overwrite Current)", "Export"]).then(i => { if (i < 0) return; if (i === 0) { importConfiguration(); } else if (i === 1) { exportConfiguration(); } }); }
function exportConfiguration() { threads.start(function () { if (!checkStoragePermissions()) { return; } try { const configStr = JSON.stringify({ settings: appSettings, tasks: taskSequence }, null, 2); const backupDirName = "DotAgentBackup"; const backupPath = files.join(files.getSdcardPath(), backupDirName); files.ensureDir(backupPath); const defaultFileName = currentProfileName.replace(CONSTANTS.FILES.PROFILE_PREFIX, 'export_'); const defaultPath = files.join(backupPath, defaultFileName); dialogs.alert("Export Current Profile", `The profile will be saved to a public directory.\n\nPath: ${defaultPath}`).then(() => { files.write(defaultPath, configStr); ui.run(() => toast("Profile exported successfully!")); logToScreen(`Profile exported to ${defaultPath}`); }); } catch (e) { ui.run(() => toast("Export failed: " + e)); logToScreen(`Export failed: ${e}`); } }); }
function importConfiguration() { threads.start(function () { if (!checkStoragePermissions()) { return; } dialogs.confirm("Import Configuration", "This will overwrite all your current tasks and settings. Are you sure?").then(ok => { if (ok) { const backupDirName = "DotAgentBackup"; const backupPath = files.join(files.getSdcardPath(), backupDirName); files.ensureDir(backupPath); dialogs.rawInput(`Enter the configuration file name located in the "${backupDirName}" folder`, "export_default.json").then(fileName => { if (!fileName) { ui.run(() => toast("File name cannot be empty")); return; } const path = files.join(backupPath, fileName); if (files.exists(path)) { try { let configStr = files.read(path); const loadedConfig = JSON.parse(configStr); if (!loadedConfig || typeof loadedConfig.settings !== 'object' || !Array.isArray(loadedConfig.tasks)) { throw new Error("Configuration file format is incorrect or missing key fields"); } let newSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); Object.assign(newSettings, loadedConfig.settings); if (!newSettings.theme) { newSettings.theme = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.theme)); } if (newSettings.redDotOffsetY !== undefined) { newSettings.yOffset = newSettings.redDotOffsetY; delete newSettings.redDotOffsetY; } appSettings = newSettings; taskSequence = loadedConfig.tasks; ui.run(() => { saveCurrentProfile(); refreshAllUI(); toast("Configuration imported successfully!"); }); logToScreen(`Successfully imported profile from ${path}.`); } catch (e) { ui.run(() => toast("Import failed: " + e)); logToScreen(`Import failed: ${e}`); } } else { ui.run(() => toast("File not found: " + path)); logToScreen(`Import failed, file not found: ${path}`); } }); } }); }); }

// =================================================================================
// EXIT AND CLEANUP
// =================================================================================
function closeTaskVisuals() { uiRefs.taskVisuals.forEach(visual => { if (visual.type === 'click' && visual.window) { visual.window.close(); } else if (visual.type === 'swipe') { if (visual.startWindow) visual.startWindow.close(); if (visual.endWindow) visual.endWindow.close(); } }); uiRefs.taskVisuals = []; }
function closeAllAndExit() {
    stopExecution("Exiting application, stopping all tasks");
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
    toast("Application has exited.");
    exit();
}