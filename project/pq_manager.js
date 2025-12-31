/**
 * pq_manager.js - 优先队列持久化逻辑
 */

const PQ_STORE_PATH = "/sdcard/dotagent_priority_queue.json";
let __PQ_lastLoadMtime = 0;

// 写入
function writePriorityQueue(sequence, currentProfileName) {
    try {
        if (!sequence || !sequence.name) return;
        
        var curProfile = currentProfileName || "default";

        var obj = {
            profileName: curProfile,
            sequenceName: sequence.name,
            ts: Date.now(),
            priorityQueue: Array.isArray(sequence.priorityQueue) ? sequence.priorityQueue : []
        };
        
        var tmp = PQ_STORE_PATH + ".tmp";
        files.write(tmp, JSON.stringify(obj)); 
        try { files.remove(PQ_STORE_PATH); } catch(e){}
        files.rename(tmp, PQ_STORE_PATH);
    } catch (e) {
        // console.error("[PQ Write Error] " + e);
    }
}

// 读取
function tryLoadPriorityQueue(sequence, currentProfileName) {
    try {
        if (!files.exists(PQ_STORE_PATH)) return null;
        var stat = files.stat(PQ_STORE_PATH);
        var mtime = stat.mtime || +stat.lastModifiedDate || Date.now();
        if (!mtime) mtime = Date.now();
        
        if (mtime <= (__PQ_lastLoadMtime || 0)) return null;
        
        var txt = files.read(PQ_STORE_PATH);
        if (!txt) return null;
        var obj = JSON.parse(txt);
        
        if (!obj || !obj.priorityQueue) return null;

        var curProfile = currentProfileName || "default";
        
        // 校验方案名和序列名，防止污染
        if (obj.profileName !== curProfile) return null; 
        if (obj.sequenceName !== sequence.name) return null;

        __PQ_lastLoadMtime = mtime;
        return obj;
    } catch (e) {
        return null;
    }
}

module.exports = {
    write: writePriorityQueue,
    tryLoad: tryLoadPriorityQueue
};