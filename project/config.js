/**
 * config.js - 全局配置与常量
 */

const GLOBAL_CONSTANTS = {
    VERSION: "5.2.9 (Modular)",
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
            BACKGROUND: "#121212",
            PRIMARY_CARD: "#1E1E1E",
            SECONDARY_CARD: "#2A2A2A",
            ACCENT_GRADIENT_START: "#007BFF",
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
    REQUEST_CODES: {
        NEW_IMAGE_SELECT: 2001,
        NEW_IMAGE_CROP: 2002
    },
    TEMP_FILES: {
        CROP_OUTPUT: "new_crop_output.jpg"
    }
};

const DEFAULT_SETTINGS = {
    useGestureSwipe: true,
    mainTargetPos: { x: 300, y: 300 },
    controlPanelPos: { x: 100, y: 800 },
    clickDelayMs: 100,
    yOffset: 0, // 会在 main.js 中被 statusBarHeight 覆盖
    swipe: { duration: 300 },
    controlButtonsHidden: false,
    panelWidth: 400,
    targetViewSize: 100,
    showPanelCoordinates: true,
    mainSequenceKey: null,
    mainMonitorKey: null,
    theme: {
        targetViewColor: GLOBAL_CONSTANTS.UI.THEME.DEFAULT_TARGET_VIEW_COLOR,
        taskClickColor: GLOBAL_CONSTANTS.UI.THEME.DEFAULT_TASK_CLICK_COLOR,
        taskSwipeColor: GLOBAL_CONSTANTS.UI.THEME.DEFAULT_TASK_SWIPE_COLOR
    },
    taskVisualsHidden: false,
    defaultCachePadding: 50
};

module.exports = {
    GLOBAL_CONSTANTS: GLOBAL_CONSTANTS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS
};