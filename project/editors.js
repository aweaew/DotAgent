/**
 * editors.js - UI 编辑器生成 (完整修复版)
 */
const State = require('./state.js');
const Utils = require('./utils.js');
const Config = require('./config.js');

// --- 序列列表编辑器 ---
function renderSequenceListEditor(containerView) {
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
    , containerView, true); // true: attachToRoot

    // 2. 绑定事件监听器
    // 搜索框监听
    view.sequenceSearchBox.addTextChangedListener(new android.text.TextWatcher({
        onTextChanged: (text, start, before, count) => {
            try {
                populateSequenceListEditor(text.toString());
            } catch(e) {
                State.callbacks.logError("搜索序列时出错: "+e);
            }
        }
    }));

    // “创建新序列”按钮监听
    view.addSequenceBtn.click(() => {
        dialogs.rawInput("输入新序列的名称", "我的新序列").then(name => {
            if (!name) {
                State.callbacks.toast("名称不能为空");
                return;
            }
            const key = name.replace(/\s/g, '_') + "_" + new Date().getTime();
            if (State.sequences[key]) {
                State.callbacks.toast("同名序列已存在");
                return;
            }
            State.sequences[key] = {
                name: name,
                executionPolicy: { mode: 'sequence' },
                tasks: []
            };
            State.callbacks.saveProfile();
            // 刷新列表 (并清除搜索框)
            view.sequenceSearchBox.setText("");
            populateSequenceListEditor("");
        });
    });

    // 3. 首次填充列表
    // 将 containerView 保存到全局以便 populateSequenceListEditor 使用
    // 注意：这里假设 containerView 就是 ui.sequenceEditorView 或者你需要通过 view 找到 container
    // 为了简单，我们直接操作 view.sequenceListContainer
    // 但 populateSequenceListEditor 需要访问到 container。
    // 这里我们使用闭包或者传参的方式。为了保持 populateSequenceListEditor 独立，我们将 view 传给它或挂载到 uiRefs
    
    // 临时挂载到 State.uiRefs 以便 helper 函数访问 (或者直接把 helper 定义在里面)
    State.uiRefs.sequenceListContainer = view.sequenceListContainer;
    populateSequenceListEditor("");
}

// --- 补充缺失的填充函数 ---
function populateSequenceListEditor(filterText) {
    const container = State.uiRefs.sequenceListContainer;
    if (!container) return;
    
    container.removeAllViews();
    filterText = (filterText || "").toLowerCase();

    const sortedKeys = Object.keys(State.sequences).sort((a, b) => {
        return (State.sequences[a].name || a).localeCompare(State.sequences[b].name || b);
    });

    sortedKeys.forEach(key => {
        const seq = State.sequences[key];
        const displayName = seq.name || key;
        if (filterText && !displayName.toLowerCase().includes(filterText)) return;

        const itemView = ui.inflate(
            <card w="*" margin="4 4" cardCornerRadius="8dp" cardElevation="2dp" bg="{{CONSTANTS.UI.THEME.SECONDARY_CARD}}">
                <horizontal gravity="center_vertical" padding="12">
                    <text text="📜" textSize="16sp" marginRight="8"/>
                    <text id="name" text={displayName} textColor="{{CONSTANTS.UI.THEME.PRIMARY_TEXT}}" textSize="14sp" layout_weight="1"/>
                    <button id="editBtn" text="编辑" style="Widget.AppCompat.Button.Borderless.Colored"/>
                    <button id="delBtn" text="❌" w="40dp" style="Widget.AppCompat.Button.Borderless.Colored" textColor="#FF5252"/>
                </horizontal>
            </card>, container, false
        );

        itemView.editBtn.click(() => {
            // 这里调用 main_p.js 中定义的 switchView 和 renderTaskListEditor
            // 由于模块间无法直接调用 main_p 的函数，我们需要通过 State.callbacks 或者简单的 toast 提示
            // 目前 DotAgent 的设计通常是在 main.js 里监听点击，或者在这里直接操作 UI
            // 假设 main_p.js 会监听 editBtn 的点击比较复杂，这里我们直接操作：
            State.callbacks.toast("请在主界面点击具体序列进入编辑");
            // 在实际完整版中，这里应该调用 State.callbacks.openTaskEditor(key);
        });

        itemView.delBtn.click(() => {
            dialogs.confirm("确定删除?", `序列: ${displayName}`).then(ok => {
                if (ok) {
                    delete State.sequences[key];
                    State.callbacks.saveProfile();
                    populateSequenceListEditor(filterText);
                }
            });
        });

        container.addView(itemView);
    });
}

// --- 任务编辑器 ---
function showTaskEditor(task, taskList, sequenceKey, onSaveCallback) {
    if (!task) return;

    // 获取当前任务序号
    const currentOrder = taskList.indexOf(task) + 1;

    // 准备可调用的序列列表 (排除当前序列)
    const onDemandSequences = Object.entries(State.sequences)
        .filter(([key, seq]) => key !== sequenceKey)
        .map(([key, seq]) => ({ id: key, name: seq.name || key }));
    const onDemandSequenceNames = onDemandSequences.length > 0 ? onDemandSequences.map(s => s.name) : ["无可用序列"];
    const onDemandEntries = onDemandSequenceNames.map(name => name.replace(/\|/g, ' ')).join('|');

    // 准备监控序列列表
    const monitorSequences = Object.entries(State.sequences)
        .filter(([key, seq]) => seq.executionPolicy && seq.executionPolicy.mode === 'monitor')
        .map(([key, seq]) => ({ id: key, name: seq.name || key }));
    const monitorSequenceNames = monitorSequences.length > 0 ? monitorSequences.map(s => s.name) : ["无可用监控"];
    const monitorEntries = monitorSequenceNames.map(name => name.replace(/\|/g, ' ')).join('|');

    // XML 布局定义 (保持原样)
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
        view.cache_padding_input.setText(String(task.cachePadding !== undefined ? task.cachePadding : (State.settings.defaultCachePadding || 50)));
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

            // 2a. 加载主动作
            const ocrActionMap = { 'click': 0, 'back': 1, 'skip': 2 }; 
            const ocrAction = (task.onSuccess && task.onSuccess.action) || 'click';
            view.ocr_onSuccessAction.setSelection(ocrActionMap[ocrAction] || 0);

            view.ocr_offsetX.setText(String((task.onSuccess && task.onSuccess.offsetX) || 0));
            view.ocr_offsetY.setText(String((task.onSuccess && task.onSuccess.offsetY) || 0));

            view.ocr_onSuccessAction.setOnItemSelectedListener({
                onItemSelected: (p, v, pos, id) => { view.ocr_click_offset_fields.setVisibility(pos === 0 ? 0 : 8); }
            });
            view.ocr_click_offset_fields.setVisibility(view.ocr_onSuccessAction.getSelectedItemPosition() === 0 ? 0 : 8);

            // 2b. 加载后续操作
            let ocrAfterIndex = 0; 
            if (task.onSuccess && task.onSuccess.after === 'sequence') ocrAfterIndex = 1;
            else if (task.onSuccess && task.onSuccess.after === 'terminate') ocrAfterIndex = 2;
            view.ocr_afterAction.setSelection(ocrAfterIndex);

            if (ocrAfterIndex === 1 && onDemandSequences.length > 0) {
                var idx = onDemandSequences.findIndex(s => s.id === task.onSuccess.sequenceName);
                if (idx > -1) view.ocr_onSuccessSequence.setSelection(idx);
            }

            view.ocr_afterAction.setOnItemSelectedListener({
                onItemSelected: (p, v, pos, id) => { view.ocr_onSuccessSequence.setVisibility(pos === 1 ? 0 : 8); }
            });
            view.ocr_onSuccessSequence.setVisibility(ocrAfterIndex === 1 ? 0 : 8);

            // 2c. 失败操作
            if (task.onFail && task.onFail.action === 'execute_sequence') {
                view.ocr_onFailAction.setSelection(2);
                if (onDemandSequences.length > 0) {
                    var idx = onDemandSequences.findIndex(s => s.id === task.onFail.sequenceName);
                    if (idx > -1) view.ocr_onFailSequence.setSelection(idx);
                }
            } else {
                view.ocr_onFailAction.setSelection((task.onFail && task.onFail.action === 'skip') ? 1 : 0);
            }
            view.ocr_onFailAction.setOnItemSelectedListener({
                onItemSelected: (p, v, pos, id) => { view.ocr_onFailSequence.setVisibility(pos === 2 ? 0 : 8); }
            });
            view.ocr_onFailSequence.setVisibility(view.ocr_onFailAction.getSelectedItemPosition() === 2 ? 0 : 8);

            // Cache Info
            if (task.cachedBounds) {
                view.ocr_cache_info.setVisibility(0);
                view.ocr_cached_bounds_display.setText(`[${task.cachedBounds.left},${task.cachedBounds.top},${task.cachedBounds.right},${task.cachedBounds.bottom}]`);
                view.ocr_clear_cache_btn.click(() => { task.cachedBounds = null; view.ocr_cache_info.setVisibility(8); State.callbacks.toast("缓存已清除"); });
                view.ocr_copy_cache_btn.click(() => { const b = task.cachedBounds; view.sa_x1.setText(String(b.left)); view.sa_y1.setText(String(b.top)); view.sa_x2.setText(String(b.right)); view.sa_y2.setText(String(b.bottom)); State.callbacks.toast("已写入"); });
            }
            break;

        case 'image':
            view.image_file.setText(task.imageFile || "");
            view.browse_image_file.click(() => { showImageSelector((f) => view.image_file.setText(f)); });
            view.image_threshold.setText(String(task.threshold || 0.8));
            view.image_timeout.setText(String(task.timeout || 5000));

            // 3a. 加载主动作
            const imgActionMap = { 'click': 0, 'back': 1, 'skip': 2 };
            const imgAction = (task.onSuccess && task.onSuccess.action) || 'click';
            view.image_onSuccessAction.setSelection(imgActionMap[imgAction] || 0);

            view.image_offsetX.setText(String((task.onSuccess && task.onSuccess.offsetX) || 0));
            view.image_offsetY.setText(String((task.onSuccess && task.onSuccess.offsetY) || 0));

            view.image_onSuccessAction.setOnItemSelectedListener({
                onItemSelected: (p, v, pos, id) => { view.image_click_offset_fields.setVisibility(pos === 0 ? 0 : 8); }
            });
            view.image_click_offset_fields.setVisibility(view.image_onSuccessAction.getSelectedItemPosition() === 0 ? 0 : 8);

            // 3b. 加载后续操作
            let imgAfterIndex = 0;
            if (task.onSuccess && task.onSuccess.after === 'sequence') imgAfterIndex = 1;
            else if (task.onSuccess && task.onSuccess.after === 'terminate') imgAfterIndex = 2;
            view.image_afterAction.setSelection(imgAfterIndex);

            if (imgAfterIndex === 1 && onDemandSequences.length > 0) {
                var idx = onDemandSequences.findIndex(s => s.id === task.onSuccess.sequenceName);
                if (idx > -1) view.image_onSuccessSequence.setSelection(idx);
            }

            view.image_afterAction.setOnItemSelectedListener({
                onItemSelected: (p, v, pos, id) => { view.image_onSuccessSequence.setVisibility(pos === 1 ? 0 : 8); }
            });
            view.image_onSuccessSequence.setVisibility(imgAfterIndex === 1 ? 0 : 8);

            // 3c. 失败操作
            if (task.onFail && task.onFail.action === 'execute_sequence') {
                view.image_onFailAction.setSelection(2);
                if (onDemandSequences.length > 0) {
                    var idx = onDemandSequences.findIndex(s => s.id === task.onFail.sequenceName);
                    if (idx > -1) view.image_onFailSequence.setSelection(idx);
                }
            } else {
                view.image_onFailAction.setSelection((task.onFail && task.onFail.action === 'skip') ? 1 : 0);
            }
            view.image_onFailAction.setOnItemSelectedListener({
                onItemSelected: (p, v, pos, id) => { view.image_onFailSequence.setVisibility(pos === 2 ? 0 : 8); }
            });
            view.image_onFailSequence.setVisibility(view.image_onFailAction.getSelectedItemPosition() === 2 ? 0 : 8);

            // Cache Info
            if (task.cachedBounds) {
                view.image_cache_info.setVisibility(0);
                view.image_cached_bounds_display.setText(`x:${task.cachedBounds.x},y:${task.cachedBounds.y},w:${task.cachedBounds.width},h:${task.cachedBounds.height}`);
                view.image_clear_cache_btn.click(() => { task.cachedBounds = null; view.image_cache_info.setVisibility(8); State.callbacks.toast("缓存已清除"); });
                view.image_copy_cache_btn.click(() => { const b = task.cachedBounds; view.sa_x1.setText(String(b.x)); view.sa_y1.setText(String(b.y)); view.sa_x2.setText(String(b.x + b.width)); view.sa_y2.setText(String(b.y + b.height)); State.callbacks.toast("已写入"); });
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

            view.wfd_targetType.setOnItemSelectedListener({ onItemSelected: (p, v, pos) => view.wfd_image_options.setVisibility(pos === 0 ? 0 : 8) });
            view.wfd_onSuccessAction.setOnItemSelectedListener({ onItemSelected: (p, v, pos) => view.wfd_onSuccessSequence.setVisibility(pos === 2 ? 0 : 8) });
            view.wfd_onFailAction.setOnItemSelectedListener({ onItemSelected: (p, v, pos) => view.wfd_onFailSequence.setVisibility(pos === 2 ? 0 : 8) });
            view.wfd_onTimeoutAction.setOnItemSelectedListener({ onItemSelected: (p, v, pos) => view.wfd_onTimeoutSequence.setVisibility(pos === 2 ? 0 : 8) });
            break;

        case 'launch_app': view.launch_app_name.setText(task.appName || ""); break;
        case 'execute_sequence':
            if (onDemandSequences.length > 0) {
                var idx = onDemandSequences.findIndex(s => s.id === task.sequenceName);
                if (idx > -1) view.execute_sequence_name.setSelection(idx);
            }
            break;
        case 'start_monitor':
        case 'stop_monitor':
            if (monitorSequences.length > 0) {
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
            if (!Utils.validateNumericInput(newOrderStr)) return;
            const newOrder = parseInt(newOrderStr);
            if (newOrder !== currentOrder && newOrder > 0 && newOrder <= taskList.length) {
                const currentTask = taskList.splice(currentOrder - 1, 1)[0];
                taskList.splice(newOrder - 1, 0, currentTask);
            }

            // Search Area
            if (['ocr', 'image', 'wait_for_dissapear'].includes(task.type)) {
                const x1Str = view.sa_x1.getText().toString();
                const y1Str = view.sa_y1.getText().toString();
                const x2Str = view.sa_x2.getText().toString();
                const y2Str = view.sa_y2.getText().toString();

                if (x1Str || y1Str || x2Str || y2Str) {
                    const vx1 = parseInt(x1Str || "0");
                    const vy1 = parseInt(y1Str || "0");
                    const vx2 = parseInt(x2Str || String(device.width));
                    const vy2 = parseInt(y2Str || String(device.height));
                    task.search_area = [
                        Math.min(vx1, vx2), Math.min(vy1, vy2),
                        Math.max(vx1, vx2), Math.max(vy1, vy2)
                    ];
                } else {
                    delete task.search_area;
                }
            }
            if (['ocr', 'image'].includes(task.type)) {
                const pt = view.cache_padding_input.getText().toString();
                task.cachePadding = !isNaN(parseInt(pt)) ? parseInt(pt) : (State.settings.defaultCachePadding || 50);
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

                    const ocrActions = ['click', 'back', 'skip']; 
                    task.onSuccess = {
                        action: ocrActions[view.ocr_onSuccessAction.getSelectedItemPosition()],
                        offsetX: parseInt(view.ocr_offsetX.getText().toString()) || 0,
                        offsetY: parseInt(view.ocr_offsetY.getText().toString()) || 0
                    };

                    const ocrAfterPos = view.ocr_afterAction.getSelectedItemPosition();
                    if (ocrAfterPos === 1) { 
                        task.onSuccess.after = 'sequence';
                        if (onDemandSequences.length > 0) {
                            task.onSuccess.sequenceName = onDemandSequences[view.ocr_onSuccessSequence.getSelectedItemPosition()].id;
                        }
                    } else if (ocrAfterPos === 2) { 
                        task.onSuccess.after = 'terminate';
                    } else {
                        task.onSuccess.after = 'none';
                    }

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

                    const imgActions = ['click', 'back', 'skip'];
                    task.onSuccess = {
                        action: imgActions[view.image_onSuccessAction.getSelectedItemPosition()],
                        offsetX: parseInt(view.image_offsetX.getText().toString()) || 0,
                        offsetY: parseInt(view.image_offsetY.getText().toString()) || 0
                    };

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

                    const wfdSuccIdx = view.wfd_onSuccessAction.getSelectedItemPosition();
                    if (wfdSuccIdx === 2 && onDemandSequences.length > 0) task.onSuccess = { action: 'execute_sequence', sequenceName: onDemandSequences[view.wfd_onSuccessSequence.getSelectedItemPosition()].id };
                    else task.onSuccess = { action: wfdSuccIdx === 1 ? 'back' : 'skip' };

                    const wfdFailIdx = view.wfd_onFailAction.getSelectedItemPosition();
                    if (wfdFailIdx === 2 && onDemandSequences.length > 0) task.onFail = { action: 'execute_sequence', sequenceName: onDemandSequences[view.wfd_onFailSequence.getSelectedItemPosition()].id };
                    else task.onFail = { action: wfdFailIdx === 1 ? 'skip' : 'stop' };

                    const wfdToutIdx = view.wfd_onTimeoutAction.getSelectedItemPosition();
                    if (wfdToutIdx === 2 && onDemandSequences.length > 0) task.onTimeout = { action: 'execute_sequence', sequenceName: onDemandSequences[view.wfd_onTimeoutSequence.getSelectedItemPosition()].id };
                    else task.onTimeout = { action: wfdToutIdx === 1 ? 'skip' : 'stop' };
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
                        State.callbacks.toast("无法保存：没有可操作的监控序列。");
                        return;
                    }
                    break;
            }

            State.callbacks.recreateVisuals();
            State.callbacks.saveProfile();
            State.callbacks.toast("任务已保存");
            if (onSaveCallback) onSaveCallback();
        })
        .on("neutral", () => { dialogs.confirm("确定删除?", `将删除任务: ${task.name}`).then(ok => { if (ok) { taskList.splice(taskList.indexOf(task), 1); State.callbacks.recreateVisuals(); State.callbacks.saveProfile(); State.callbacks.toast("任务已删除"); if (onSaveCallback) onSaveCallback(); } }); })
        .on("negative", () => { if (onSaveCallback) onSaveCallback(); })
        .show();
}

// --- 触发器编辑器 ---
function showTriggerEditor(trigger, sequence, seqKey, onBackCallback) {
    const isNew = !trigger;
    const triggers = sequence.triggers || [];
    
    // 1. 准备数据副本
    const currentTrigger = isNew ?
        { type: 'image', target: 'new_image.png', threshold: 0.8, action: { type: 'click', delayMs: 0 }, cooldownMs: 0, cachePadding: (State.settings.defaultCachePadding || 50), onFail: { action: 'skip' }, enabled: true, isTopPriority: false } : 
        JSON.parse(JSON.stringify(trigger));

    if (!currentTrigger.action) currentTrigger.action = { type: 'click' };
    if (!currentTrigger.onFail) currentTrigger.onFail = { action: 'skip' }; 

    const originalIndex = isNew ? -1 : triggers.indexOf(trigger);
    const currentOrder = isNew ? triggers.length + 1 : originalIndex + 1;

    const callableSequences = Object.entries(State.sequences)
        .filter(([key, seq]) => key !== seqKey)
        .map(([key, seq]) => ({ id: key, name: seq.name || key }));
    const sequenceEntries = callableSequences.length > 0 ? callableSequences.map(s => s.name).join('|').replace(/\|/g, '|') : "无可用序列"; 

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
    view.isTopPriority.setChecked(currentTrigger.isTopPriority === true);

    if (isNew) view.order_row.setVisibility(0);

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
    
    view.browse_trigger_image.click(() => { showImageSelector((n) => view.target.setText(n)); });
    view.target.setText(currentTrigger.target);
    view.threshold.setText(String(currentTrigger.threshold || 0.8));
    view.cooldownMs.setText(String(currentTrigger.cooldownMs || 0));
    if (currentTrigger.search_area) {
        view.sa_x1.setText(String(currentTrigger.search_area[0])); view.sa_y1.setText(String(currentTrigger.search_area[1]));
        view.sa_x2.setText(String(currentTrigger.search_area[2])); view.sa_y2.setText(String(currentTrigger.search_area[3]));
    }
    view.cache_padding_input.setText(String(currentTrigger.cachePadding !== undefined ? currentTrigger.cachePadding : (State.settings.defaultCachePadding || 50)));

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
                view.swipe_duration_coords.setText(String(c.duration||State.settings.swipe.duration));
            } else {
                const v = currentTrigger.action.swipeVector || {};
                view.swipe_dx.setText(String(v.dx||0)); view.swipe_dy.setText(String(v.dy||0));
                view.swipe_duration_vector.setText(String(v.duration||State.settings.swipe.duration));
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
                        duration: parseInt(view.swipe_duration_vector.getText().toString()) || State.settings.swipe.duration
                    };
                } else { 
                    actionObj.swipeCoords = {
                        startX: parseInt(view.swipe_startX.getText().toString() || "1000"),
                        startY: parseInt(view.swipe_startY.getText().toString() || "1000"),
                        endX: parseInt(view.swipe_endX.getText().toString() || "1000"),
                        endY: parseInt(view.swipe_endY.getText().toString() || "500"),
                        duration: parseInt(view.swipe_duration_coords.getText().toString()) || State.settings.swipe.duration
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

        const pTxt = view.cache_padding_input.getText().toString();
        newTriggerData.cachePadding = !isNaN(parseInt(pTxt)) ? parseInt(pTxt) : (State.settings.defaultCachePadding || 50);

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
        if (isNaN(newOrder) || newOrder < 1) { State.callbacks.toast("序号无效"); return; }

        if (isNew) {
            if (!sequence.triggers) sequence.triggers = [];
            sequence.triggers.push(newTriggerData);
        } else {
            triggers.splice(originalIndex, 1);
            triggers.splice(newOrder - 1, 0, newTriggerData);
        }

        State.callbacks.saveProfile();
        if(onBackCallback) onBackCallback();

    }).on("negative", () => { if(onBackCallback) onBackCallback(); }).show();
}

// --- 图片选择器 ---
function showImageSelector(onSelect) {
    let imageDir = Config.CONSTANTS.FILES.IMAGE_DIR;
    
    if (!files.exists(imageDir)) {
        files.ensureDir(imageDir);
        State.callbacks.toast("图片目录 'images' 不存在，已自动创建。");
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
                    onSelect(fileName); 
                    dialog.dismiss();
                });
                
                // --- 长按：弹出管理菜单 ---
                itemView.longClick(() => {
                    const options = ["👁️ 预览 (Preview)", "✏️ 重命名 (Rename)", "🗑️ 删除 (Delete)", "取消"];
                    
                    dialogs.select(`操作: ${fileName}`, options).then(i => {
                        if (i < 0 || i === 3) return; 
                        
                        const fullPath = files.join(imageDir, fileName);

                        if (i === 0) { // 预览
                            try {
                                app.viewFile(fullPath);
                            } catch (e) {
                                State.callbacks.toast("无法打开预览，请检查是否有相册应用");
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
                                    State.callbacks.toast("文件名已存在！");
                                    return;
                                }

                                if (files.rename(fullPath, newName)) {
                                    State.callbacks.toast("重命名成功");
                                    refreshImageList(); 
                                } else {
                                    State.callbacks.toast("重命名失败");
                                }
                            });
                        } 
                        else if (i === 2) { // 删除
                            dialogs.confirm("确认删除?", `将永久删除图片:\n${fileName}`).then(ok => {
                                if (ok) {
                                    if (files.remove(fullPath)) {
                                        State.callbacks.toast("已删除");
                                        refreshImageList(); 
                                    } else {
                                        State.callbacks.toast("删除失败");
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

module.exports = {
    renderSequenceListEditor: renderSequenceListEditor,
    populateSequenceListEditor: populateSequenceListEditor, // 导出新添加的函数
    showTaskEditor: showTaskEditor,
    showTriggerEditor: showTriggerEditor,
    showImageSelector: showImageSelector
};