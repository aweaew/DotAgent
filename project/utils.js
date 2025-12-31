/**
 * utils.js - 通用工具函数
 */

// 生成稳定的哈希值
function stableHash(input) {
    try {
        const s = (typeof input === 'string') ? input : JSON.stringify(input || {});
        let h = 5381, i = s.length;
        while (i) { h = (h * 33) ^ s.charCodeAt(--i); }
        return (h >>> 0).toString(36);
    } catch (e) { return '0'; }
}

// 验证数字输入
function validateNumericInput(inputStr, allowFloat, allowSigned) {
    if (!inputStr || inputStr.trim() === "") return false;
    const regex = allowSigned ?
        (allowFloat ? /^-?[\d.]+$/ : /^-?\d+$/) :
        (allowFloat ? /^\d*\.?\d+$/ : /^\d+$/);
    return regex.test(inputStr);
}

// 获取真实屏幕宽度
function getRealWidth() {
    try {
        return context.getResources().getDisplayMetrics().widthPixels;
    } catch(e) {
        return device.width;
    }
}

// 获取真实屏幕高度
function getRealHeight() {
    try {
        return context.getResources().getDisplayMetrics().heightPixels;
    } catch(e) {
        return device.height;
    }
}

// 计算安全的带 Padding 区域 (防止越界)
function calculatePaddedRegion(bounds, padding) {
    try {
        let x1_orig, y1_orig, x2_orig, y2_orig;
        padding = padding || 0; 
        
        const realWidth = getRealWidth();
        const realHeight = getRealHeight();

        if (bounds.left !== undefined) {
            x1_orig = bounds.left - padding; y1_orig = bounds.top - padding;
            x2_orig = bounds.right + padding; y2_orig = bounds.bottom + padding;
        } else if (bounds.x !== undefined) {
            x1_orig = bounds.x - padding; y1_orig = bounds.y - padding;
            x2_orig = bounds.x + bounds.width + padding; y2_orig = bounds.y + bounds.height + padding;
        } else {
            return [0, 0, 10, 10];
        }
        
        let final_x1, final_y1, final_x2, final_y2;

        // X轴钳制
        if (x1_orig >= realWidth || x2_orig <= 0) {
            final_x1 = 0; final_x2 = realWidth;
        } else {
            final_x1 = Math.max(0, Math.min(x1_orig, realWidth - 1));
            final_x2 = Math.max(0, Math.min(x2_orig, realWidth));
            if (final_x1 >= final_x2) final_x1 = (final_x2 > 0) ? final_x2 - 1 : 0;
        }

        // Y轴钳制
        if (y1_orig >= realHeight || y2_orig <= 0) {
            final_y1 = 0; final_y2 = realHeight;
        } else {
            final_y1 = Math.max(0, Math.min(y1_orig, realHeight - 1));
            final_y2 = Math.max(0, Math.min(y2_orig, realHeight));
            if (final_y1 >= final_y2) final_y1 = (final_y2 > 0) ? final_y2 - 1 : 0;
        }

        return [final_x1, final_y1, Math.max(0, final_x2 - final_x1), Math.max(0, final_y2 - final_y1)];
    } catch (e) {
        return [0, 0, 10, 10];
    }
}

// 安全点击
function safePress(x, y, duration) {
    try {
        const realWidth = getRealWidth();
        const realHeight = getRealHeight();
        let clampedX = Math.round(Math.max(0, Math.min(x, realWidth - 1)));
        let clampedY = Math.round(Math.max(0, Math.min(y, realHeight - 1)));
        press(clampedX, clampedY, duration);
    } catch (e) {
        // quiet fail
    }
}

module.exports = {
    stableHash: stableHash,
    validateNumericInput: validateNumericInput,
    getRealWidth: getRealWidth,
    getRealHeight: getRealHeight,
    calculatePaddedRegion: calculatePaddedRegion,
    safePress: safePress
};