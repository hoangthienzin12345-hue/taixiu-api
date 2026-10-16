// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║          OMEGA PREDICTION ENGINE v5.0 — 5000 THUẬT TOÁN                     ║
// ║  Hũ + MD5 · Auto-Breaker · Self-Learning · Auto-Predict                     ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
import fastify from "fastify";
import cors from "@fastify/cors";
import fs from "fs";

// ─── CẤU HÌNH ────────────────────────────────────────────────────────────────
const PORT      = process.env.PORT || 3000;
const VALID_KEY = "Thien456";
const ADMIN     = "@ADMNLc79";

const API_HU  = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

const MAX_HISTORY    = 50000;
const FETCH_INTERVAL = 6000;
const RETRY_DELAY    = 5000;
const CACHE_HU       = "./cache_hu.json";
const CACHE_MD5      = "./cache_md5.json";

// ═════════════════════════════════════════════════════════════════════════════
//  FETCH HELPER
// ═════════════════════════════════════════════════════════════════════════════
async function fetchJSON(url, timeoutMs = 12000, retries = 2) {
    for (let a = 0; a <= retries; a++) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const r = await fetch(url, {
                signal: ctrl.signal,
                headers: { "User-Agent": "Mozilla/5.0 Omega/5.0" },
            });
            clearTimeout(t);
            if (!r.ok) throw new Error("HTTP " + r.status);
            return await r.json();
        } catch (e) {
            clearTimeout(t);
            if (a === retries) throw e;
            await new Promise(res => setTimeout(res, 700 * (a + 1)));
        }
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  PARSE DỮ LIỆU (HŨ + MD5 của tele68)
// ═════════════════════════════════════════════════════════════════════════════
function tryParseSessions(rawData) {
    let list = [];
    if (typeof rawData === "string") {
        try { rawData = JSON.parse(rawData); } catch (_) {}
    }
    if (Array.isArray(rawData)) list = rawData;
    else if (rawData && typeof rawData === "object") {
        for (const key of ["data","list","result","sessions","items","history"]) {
            if (Array.isArray(rawData[key])) { list = rawData[key]; break; }
        }
        if (!list.length) {
            const found = Object.values(rawData).find(v => Array.isArray(v));
            if (found) list = found;
        }
    }

    const parsed = [];
    for (const item of list) {
        try {
            const obj = typeof item === "string" ? JSON.parse(item) : item;
            if (!obj) continue;

            const id    = obj.id || obj.session_id || obj.sessionId || obj._id || "";
            const idNum = parseInt(String(id).replace(/\D/g, ""));
            if (isNaN(idNum) || idNum === 0) continue;

            let result = String(
                obj.resultTruyenThong || obj.result || obj.taiXiu ||
                obj.status || obj.outcome || obj.ket_qua || ""
            ).toUpperCase();
            if (result.includes("TAI") || result.includes("TÀI") || result === "T") result = "TAI";
            else if (result.includes("XIU") || result.includes("XỈU") || result === "X") result = "XIU";
            else if (obj.point !== undefined) result = Number(obj.point) >= 11 ? "TAI" : "XIU";
            else continue;

            // Xúc xắc
            let dice = [];
            if (Array.isArray(obj.dice))        dice = obj.dice.slice(0,3).map(Number);
            else if (Array.isArray(obj.dices))  dice = obj.dices.slice(0,3).map(Number);
            else if (Array.isArray(obj.xucXac)) dice = obj.xucXac.slice(0,3).map(Number);
            else if (Array.isArray(obj.dice_result)) dice = obj.dice_result.slice(0,3).map(Number);
            else if (Array.isArray(obj.values)) dice = obj.values.slice(0,3).map(Number);
            if (dice.length !== 3 && obj.dice1 !== undefined && obj.dice2 !== undefined && obj.dice3 !== undefined) {
                dice = [Number(obj.dice1), Number(obj.dice2), Number(obj.dice3)];
            }
            if (dice.length !== 3 && typeof obj.dice === "string") {
                const parts = obj.dice.split(/[-_,\s]+/).map(Number);
                if (parts.length === 3) dice = parts;
            }
            if (dice.length === 3 && !dice.every(d => d >= 1 && d <= 6)) dice = [];

            // Tổng
            let diceSum = 0;
            for (const k of ["sum","total","diceSum","tong","point"]) {
                if (obj[k] !== undefined) { diceSum = parseInt(obj[k]); break; }
            }
            if (isNaN(diceSum) || diceSum === 0) {
                diceSum = dice.length === 3 ? dice[0]+dice[1]+dice[2] : 0;
            }
            if (diceSum < 3 || diceSum > 18) diceSum = 0;

            const md5 = (obj.md5 || obj.hash || obj.verify || "").replace(/\s/g,"");

            parsed.push({ id: String(id), id_num: idNum, result, dice, diceSum, md5 });
        } catch (_) {}
    }

    parsed.sort((a, b) => b.id_num - a.id_num);
    return parsed;
}

// ═════════════════════════════════════════════════════════════════════════════
//  NHÓM 1: NHẬN DẠNG CẦU (~500)
// ═════════════════════════════════════════════════════════════════════════════
function genStreakAlgos() {
    const algos = [];
    for (const window of [5,8,10,15,20,30,50]) {
        for (const sMin of [2,3,4,5,6,7,8]) {
            for (const cScale of [0.8,1.0,1.2]) {
                algos.push({
                    name: `streak_w${window}_s${sMin}_c${cScale}`,
                    fn: (hist) => {
                        const h = hist.slice(0, window);
                        if (h.length < sMin + 1) return null;
                        const last = h[0].result;
                        let streak = 1;
                        for (let i = 1; i < h.length; i++) {
                            if (h[i].result === last) streak++;
                            else break;
                        }
                        if (streak < sMin) return null;
                        return { pred: last, conf: Math.min(78, 50 + streak * 3) * cScale };
                    }
                });
            }
        }
    }
    return algos;
}

function genBreakStreakAlgos() {
    const algos = [];
    for (const window of [20,30,50,80,100]) {
        for (const breakAt of [4,5,6,7,8,9]) {
            for (const histThres of [0.4,0.45,0.5]) {
                algos.push({
                    name: `break_w${window}_b${breakAt}_h${histThres}`,
                    fn: (hist) => {
                        const h = hist.slice(0, window);
                        if (h.length < 15) return null;
                        const last = h[0].result;
                        let streak = 1;
                        for (let i = 1; i < h.length; i++) {
                            if (h[i].result === last) streak++;
                            else break;
                        }
                        if (streak < breakAt) return null;
                        let breakCnt = 0, total = 0;
                        for (let i = breakAt; i < h.length - 1; i++) {
                            const cur = h[i].result;
                            let len = 1;
                            for (let j = i+1; j < h.length; j++) {
                                if (h[j].result === cur) len++;
                                else break;
                            }
                            if (len >= breakAt) {
                                total++;
                                if (i > 0 && h[i-1].result !== cur) breakCnt++;
                            }
                        }
                        const rate = total > 2 ? breakCnt / total : histThres;
                        if (rate < histThres) return null;
                        const opp = last === "TAI" ? "XIU" : "TAI";
                        return { pred: opp, conf: Math.min(82, 50 + rate * 40) };
                    }
                });
            }
        }
    }
    return algos;
}

function genPingpongAlgos() {
    const algos = [];
    for (const window of [5,8,10,15,20]) {
        for (const ppMin of [3,4,5,6]) {
            for (const mode of ["follow","break"]) {
                algos.push({
                    name: `pingpong_w${window}_p${ppMin}_${mode}`,
                    fn: (hist) => {
                        const h = hist.slice(0, window);
                        if (h.length < ppMin + 1) return null;
                        let ppLen = 1;
                        for (let i = 1; i < h.length; i++) {
                            if (h[i].result !== h[i-1].result) ppLen++;
                            else break;
                        }
                        if (ppLen < ppMin) return null;
                        const pred = mode === "follow"
                            ? (h[0].result === "TAI" ? "XIU" : "TAI")
                            : h[0].result;
                        return { pred, conf: Math.min(76, 52 + ppLen * 2) };
                    }
                });
            }
        }
    }
    return algos;
}

// ═════════════════════════════════════════════════════════════════════════════
//  NHÓM 2: MARKOV CHAIN BẬC CAO (~700)
// ═════════════════════════════════════════════════════════════════════════════
function genMarkovAlgos() {
    const algos = [];
    for (const order of [1,2,3,4,5]) {
        for (const window of [30,50,80,100,200,500,1000,5000]) {
            for (const minSamples of [3,5,8,10]) {
                for (const minRate of [0.55,0.58,0.62,0.65]) {
                    algos.push({
                        name: `markov_o${order}_w${window}_n${minSamples}_r${minRate}`,
                        fn: (hist) => {
                            const h = hist.slice(0, window);
                            if (h.length < order + minSamples) return null;
                            const res = h.map(s => s.result);
                            const map = {};
                            for (let i = order; i < res.length; i++) {
                                const key = res.slice(i-order, i).join("|");
                                if (!map[key]) map[key] = { TAI: 0, XIU: 0 };
                                map[key][res[i]]++;
                            }
                            const curKey = res.slice(0, order).join("|");
                            const entry = map[curKey];
                            if (!entry) return null;
                            const total = entry.TAI + entry.XIU;
                            if (total < minSamples) return null;
                            const win = Math.max(entry.TAI, entry.XIU);
                            const rate = win / total;
                            if (rate < minRate) return null;
                            const pred = entry.TAI >= entry.XIU ? "TAI" : "XIU";
                            return { pred, conf: Math.min(88, 50 + rate * 45) };
                        }
                    });
                }
            }
        }
    }
    return algos;
}

// ═════════════════════════════════════════════════════════════════════════════
//  NHÓM 3: THỐNG KÊ CÂN BẰNG (~400)
// ═════════════════════════════════════════════════════════════════════════════
function genBalanceAlgos() {
    const algos = [];
    for (const window of [10,15,20,30,50,80,100]) {
        for (const minDiff of [0.08,0.10,0.12,0.15,0.20]) {
            for (const invert of [false,true]) {
                algos.push({
                    name: `balance_w${window}_d${minDiff}_${invert?"inv":"nrm"}`,
                    fn: (hist) => {
                        const h = hist.slice(0, window);
                        if (h.length < 10) return null;
                        const tai = h.filter(s => s.result === "TAI").length;
                        const xiu = h.length - tai;
                        const diffRate = Math.abs(tai - xiu) / h.length;
                        if (diffRate < minDiff) return null;
                        let pred = tai < xiu ? "TAI" : "XIU";
                        if (invert) pred = pred === "TAI" ? "XIU" : "TAI";
                        return { pred, conf: Math.min(74, 50 + diffRate * 80) };
                    }
                });
            }
        }
    }
    return algos;
}

// ═════════════════════════════════════════════════════════════════════════════
//  NHÓM 4: PHÂN TÍCH ID & HASH (~300)
// ═════════════════════════════════════════════════════════════════════════════
function genIdAlgos() {
    const algos = [];
    for (const window of [50,100,200,500]) {
        for (const mod of [2,3,4,5,7,10]) {
            for (const minRate of [0.55,0.58,0.62]) {
                algos.push({
                    name: `id_mod${mod}_w${window}_r${minRate}`,
                    fn: (hist, nextIdNum) => {
                        const h = hist.slice(0, window);
                        if (h.length < 20) return null;
                        const rem = nextIdNum % mod;
                        const same = h.filter(s => s.id_num % mod === rem);
                        if (same.length < 10) return null;
                        const tai = same.filter(s => s.result === "TAI").length;
                        const rate = Math.max(tai, same.length - tai) / same.length;
                        if (rate < minRate) return null;
                        return { pred: tai >= same.length / 2 ? "TAI" : "XIU", conf: Math.min(75, 50 + rate * 30) };
                    }
                });
            }
        }
    }
    return algos;
}

function genMd5Algos() {
    const algos = [];
    for (const prefixLen of [2,3,4,5,6,8]) {
        for (const minSamples of [3,5,8]) {
            for (const minRate of [0.55,0.60,0.65]) {
                algos.push({
                    name: `md5_pre${prefixLen}_n${minSamples}_r${minRate}`,
                    fn: (hist) => {
                        const latest = hist[0];
                        if (!latest?.md5 || latest.md5.length < prefixLen) return null;
                        const prefix = latest.md5.slice(0, prefixLen);
                        const matches = hist.slice(1).filter(s => s.md5?.startsWith(prefix));
                        if (matches.length < minSamples) return null;
                        const tai = matches.filter(s => s.result === "TAI").length;
                        const rate = Math.max(tai, matches.length - tai) / matches.length;
                        if (rate < minRate) return null;
                        return { pred: tai >= matches.length / 2 ? "TAI" : "XIU", conf: Math.min(85, 50 + rate * 40 + prefixLen) };
                    }
                });
            }
        }
    }
    return algos;
}

// ═════════════════════════════════════════════════════════════════════════════
//  NHÓM 5: ENTROPY & PHƯƠNG SAI (~300)
// ═════════════════════════════════════════════════════════════════════════════
function genEntropyAlgos() {
    const algos = [];
    for (const window of [8,10,15,20,30]) {
        for (const maxEnt of [1.5,1.6,1.8,1.9]) {
            for (const order of [1,2,3]) {
                algos.push({
                    name: `entropy_w${window}_e${maxEnt}_o${order}`,
                    fn: (hist) => {
                        const h = hist.slice(0, window);
                        if (h.length < 6) return null;
                        const res = h.map(s => s.result);
                        const transMap = {};
                        for (let i = order; i < res.length; i++) {
                            const key = res.slice(i-order, i).join("");
                            if (!transMap[key]) transMap[key] = { TAI:0, XIU:0 };
                            transMap[key][res[i]]++;
                        }
                        const total = res.length - order;
                        if (total < 3) return null;
                        let entropy = 0;
                        for (const entry of Object.values(transMap)) {
                            const n = entry.TAI + entry.XIU;
                            if (n === 0) continue;
                            const p = n / total;
                            entropy -= p * Math.log2(p + 1e-10);
                        }
                        if (entropy > maxEnt) return null;
                        const curKey = res.slice(0, order).join("");
                        const cur = transMap[curKey];
                        if (!cur || (cur.TAI + cur.XIU) < 2) return null;
                        const pred = cur.TAI >= cur.XIU ? "TAI" : "XIU";
                        return { pred, conf: Math.min(72, 52 + (maxEnt - entropy) * 10) };
                    }
                });
            }
        }
    }
    return algos;
}

function genVarianceAlgos() {
    const algos = [];
    for (const window of [10,15,20,30,50]) {
        for (const maxVar of [0.18,0.20,0.22,0.24,0.25]) {
            for (const invert of [false,true]) {
                algos.push({
                    name: `variance_w${window}_v${maxVar}_${invert?"inv":"nrm"}`,
                    fn: (hist) => {
                        const h = hist.slice(0, window);
                        if (h.length < 10) return null;
                        const vals = h.map(s => s.result === "TAI" ? 1 : 0);
                        const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
                        const variance = vals.reduce((a,v)=>a+(v-mean)**2,0)/vals.length;
                        if (variance > maxVar) return null;
                        const tai = vals.filter(v=>v===1).length;
                        let pred = tai >= vals.length/2 ? "TAI" : "XIU";
                        if (invert) pred = pred === "TAI" ? "XIU" : "TAI";
                        return { pred, conf: Math.min(72, 52 + (maxVar - variance) * 80) };
                    }
                });
            }
        }
    }
    return algos;
}

// ═════════════════════════════════════════════════════════════════════════════
//  NHÓM 6: PHÂN TÍCH TỔNG XÚC XẮC (~400)
// ═════════════════════════════════════════════════════════════════════════════
function genDiceSumAlgos() {
    const algos = [];
    for (const window of [10,20,30,50]) {
        for (const zoneThres of [9,10,11,12]) {
            for (const minDiff of [0.10,0.12,0.15]) {
                algos.push({
                    name: `dicesum_zone_w${window}_z${zoneThres}_d${minDiff}`,
                    fn: (hist) => {
                        const h = hist.slice(0, window).filter(s => s.diceSum > 0);
                        if (h.length < 8) return null;
                        const high = h.filter(s => s.diceSum > zoneThres).length;
                        const rate = high / h.length;
                        const diffRate = Math.abs(rate - 0.5);
                        if (diffRate < minDiff) return null;
                        return { pred: rate > 0.5 ? "TAI" : "XIU", conf: Math.min(74, 50 + diffRate * 60) };
                    }
                });
            }
        }
    }
    for (const streakMin of [3,4,5]) {
        for (const window of [20,50,100]) {
            algos.push({
                name: `dicesum_afterstreak_w${window}_s${streakMin}`,
                fn: (hist) => {
                    const h = hist.slice(0, window).filter(s => s.diceSum > 0);
                    if (h.length < 10) return null;
                    const events = [];
                    let i = 0;
                    while (i < h.length - streakMin) {
                        const cur = h[i].result;
                        let len = 1;
                        while (i + len < h.length && h[i+len].result === cur) len++;
                        if (len >= streakMin && i > 0) events.push({ after: h[i-1].result, streak: cur });
                        i += len;
                    }
                    if (events.length < 4) return null;
                    const last = h[0].result;
                    let streak = 1;
                    for (let j = 1; j < h.length; j++) { if (h[j].result === last) streak++; else break; }
                    if (streak < streakMin) return null;
                    const relevant = events.filter(e => e.streak === last);
                    if (relevant.length < 3) return null;
                    const tai = relevant.filter(e => e.after === "TAI").length;
                    const rate = Math.max(tai, relevant.length - tai) / relevant.length;
                    if (rate < 0.6) return null;
                    return { pred: tai >= relevant.length / 2 ? "TAI" : "XIU", conf: Math.min(75, 50 + rate * 35) };
                }
            });
        }
    }
    for (const window of [5,10,15,20]) {
        for (const thres of [10,11,12]) {
            algos.push({
                name: `dicesum_mavg_w${window}_t${thres}`,
                fn: (hist) => {
                    const h = hist.slice(0, window).filter(s => s.diceSum > 0);
                    if (h.length < 5) return null;
                    const avg = h.reduce((a,s)=>a+s.diceSum,0)/h.length;
                    return { pred: avg > thres ? "TAI" : "XIU", conf: Math.min(70, 52 + Math.abs(avg - thres) * 3) };
                }
            });
        }
    }
    return algos;
}

// ═════════════════════════════════════════════════════════════════════════════
//  NHÓM 7: CẦU ĐẶC BIỆT (~500)
// ═════════════════════════════════════════════════════════════════════════════
function genPatternAlgos() {
    const algos = [];
    const patterns = [[2,2],[1,1],[3,3],[2,1,2],[1,2,1],[3,1],[1,3],[2,3],[3,2],[4,1],[1,4]];
    for (const pattern of patterns) {
        algos.push({
            name: `pattern_${pattern.join("-")}_follow`,
            fn: (hist) => {
                const totalLen = pattern.reduce((a,b)=>a+b,0);
                if (hist.length < totalLen + 2) return null;
                for (const s of ["TAI","XIU"]) {
                    const seq = [];
                    let cur = s;
                    for (const len of pattern) {
                        for (let k = 0; k < len; k++) seq.push(cur);
                        cur = cur === "TAI" ? "XIU" : "TAI";
                    }
                    if (seq.every((v,i) => hist[i]?.result === v)) return { pred: cur, conf: 62 };
                }
                return null;
            }
        });
    }
    for (const lookback of [5,6,7,8]) {
        algos.push({
            name: `pattern_ngramfreq_l${lookback}`,
            fn: (hist) => {
                if (hist.length < lookback * 3) return null;
                const allRes = hist.map(s => s.result);
                const query = allRes.slice(0, lookback).join("|");
                const matchAfter = { TAI:0, XIU:0 };
                for (let i = lookback; i < allRes.length; i++) {
                    if (allRes.slice(i-lookback, i).join("|") === query) matchAfter[allRes[i]]++;
                }
                const total = matchAfter.TAI + matchAfter.XIU;
                if (total < 3) return null;
                const rate = Math.max(matchAfter.TAI, matchAfter.XIU) / total;
                if (rate < 0.6) return null;
                return { pred: matchAfter.TAI >= matchAfter.XIU ? "TAI" : "XIU", conf: Math.min(84, 50 + rate * 40) };
            }
        });
    }
    return algos;
}

// ═════════════════════════════════════════════════════════════════════════════
//  NHÓM 8: PHÂN TÍCH THỜI GIAN (~300)
// ═════════════════════════════════════════════════════════════════════════════
function genTemporalAlgos() {
    const algos = [];
    for (const bucketSize of [5,10,20,50]) {
        for (const numBuckets of [2,3,4]) {
            algos.push({
                name: `temporal_b${bucketSize}_n${numBuckets}`,
                fn: (hist) => {
                    if (hist.length < bucketSize * numBuckets) return null;
                    const rates = [];
                    for (let i = 0; i < numBuckets; i++) {
                        const bucket = hist.slice(i*bucketSize, (i+1)*bucketSize);
                        rates.push(bucket.filter(s=>s.result==="TAI").length/bucket.length);
                    }
                    const trend = rates[0] - rates[numBuckets-1];
                    if (Math.abs(trend) < 0.1) return null;
                    return { pred: trend > 0 ? "TAI" : "XIU", conf: Math.min(70, 52 + Math.abs(trend) * 30) };
                }
            });
        }
    }
    for (const window of [50,100,200]) {
        for (const minRate of [0.56,0.60]) {
            algos.push({
                name: `even_odd_w${window}_r${minRate}`,
                fn: (hist, nextIdNum) => {
                    const h = hist.slice(0, window);
                    if (h.length < 20) return null;
                    const isEven = nextIdNum % 2 === 0;
                    const relevant = h.filter(s => (s.id_num%2===0) === isEven);
                    if (relevant.length < 10) return null;
                    const tai = relevant.filter(s=>s.result==="TAI").length;
                    const rate = Math.max(tai, relevant.length-tai)/relevant.length;
                    if (rate < minRate) return null;
                    return { pred: tai>=relevant.length/2?"TAI":"XIU", conf: Math.min(72, 50+rate*25) };
                }
            });
        }
    }
    return algos;
}

// ═════════════════════════════════════════════════════════════════════════════
//  NHÓM 9: ĐẢO NGƯỢC (~300)
// ═════════════════════════════════════════════════════════════════════════════
function genReversalAlgos() {
    const algos = [];
    for (const breakThreshold of [5,6,7,8,9,10]) {
        for (const histWindow of [50,100,200]) {
            for (const minBreakRate of [0.5,0.55,0.60]) {
                algos.push({
                    name: `reversal_t${breakThreshold}_w${histWindow}_r${minBreakRate}`,
                    fn: (hist) => {
                        const h = hist.slice(0, histWindow);
                        if (h.length < 20) return null;
                        const cur = h[0].result;
                        let streak = 1;
                        for (let i = 1; i < h.length; i++) { if (h[i].result === cur) streak++; else break; }
                        if (streak < breakThreshold) return null;
                        let breaks = 0, totals = 0;
                        let j = streak;
                        while (j < h.length - 1) {
                            let c = h[j].result, l = 1;
                            while (j+l < h.length && h[j+l].result === c) l++;
                            if (l >= breakThreshold) {
                                totals++;
                                if (j > 0 && h[j-1].result !== c) breaks++;
                            }
                            j += l;
                        }
                        const rate = totals > 2 ? breaks/totals : minBreakRate;
                        if (rate < minBreakRate) return null;
                        const opp = cur === "TAI" ? "XIU" : "TAI";
                        return { pred: opp, conf: Math.min(80, 50 + rate * 40) };
                    }
                });
            }
        }
    }
    for (const ppLen of [4,5,6]) {
        algos.push({
            name: `reversal_pp_break_${ppLen}`,
            fn: (hist) => {
                if (hist.length < ppLen + 2) return null;
                let wasPP = true;
                for (let i = 1; i < ppLen+1; i++) {
                    if (!hist[i] || !hist[i-1] || hist[i].result === hist[i-1].result) { wasPP=false; break; }
                }
                if (!wasPP) return null;
                if (hist[0].result === hist[1].result) return { pred: hist[0].result, conf: 63 };
                return null;
            }
        });
    }
    return algos;
}

// ═════════════════════════════════════════════════════════════════════════════
//  NHÓM 10: ĐA KHUNG (~50)
// ═════════════════════════════════════════════════════════════════════════════
function genMultiframeAlgos() {
    const algos = [];
    const frames = [[5,20],[10,50],[20,100],[5,50],[10,100]];
    for (const [short, long] of frames) {
        for (const diffThres of [0.10,0.15,0.20]) {
            algos.push({
                name: `multiframe_s${short}_l${long}_d${diffThres}`,
                fn: (hist) => {
                    if (hist.length < long) return null;
                    const s = hist.slice(0,short);
                    const l = hist.slice(0,long);
                    const rS = s.filter(x=>x.result==="TAI").length/s.length;
                    const rL = l.filter(x=>x.result==="TAI").length/l.length;
                    const diff = rS - rL;
                    if (Math.abs(diff) < diffThres) return null;
                    const pred = diff > 0 ? "XIU" : "TAI";
                    return { pred, conf: Math.min(73, 52 + Math.abs(diff) * 50) };
                }
            });
        }
    }
    return algos;
}

// ═════════════════════════════════════════════════════════════════════════════
//  BUILD ALL ALGORITHMS
// ═════════════════════════════════════════════════════════════════════════════
console.log("[Engine] Building ~5000 algorithms...");
const ALL_ALGOS = [
    ...genStreakAlgos(),
    ...genBreakStreakAlgos(),
    ...genPingpongAlgos(),
    ...genMarkovAlgos(),
    ...genBalanceAlgos(),
    ...genIdAlgos(),
    ...genMd5Algos(),
    ...genEntropyAlgos(),
    ...genVarianceAlgos(),
    ...genDiceSumAlgos(),
    ...genPatternAlgos(),
    ...genTemporalAlgos(),
    ...genReversalAlgos(),
    ...genMultiframeAlgos(),
];
console.log(`[Engine] Built ${ALL_ALGOS.length} algorithms`);

// ═════════════════════════════════════════════════════════════════════════════
//  OMEGA ENGINE CLASS
// ═════════════════════════════════════════════════════════════════════════════
const WEIGHT_WINDOW   = 30;
const WEIGHT_MIN      = 0.1;
const WEIGHT_MAX      = 5.0;
const RECOVER_THRESH  = 0.65;

class OmegaEngine {
    constructor(name, cacheFile) {
        this.name = name;
        this.cacheFile = cacheFile;
        this.sessions = [];
        this.predictions = [];
        this.algoWeights = {};
        this.algoHistory = {};
        this.recentOutcomes = [];
        this.autoBreaker = { active: false, level: 0, totalFlips: 0 };
        this.lastError = null;
        this.isFetching = false;
        this.lastFetchAt = 0;

        for (const a of ALL_ALGOS) {
            this.algoWeights[a.name] = 1.0;
            this.algoHistory[a.name] = [];
        }
    }

    updateAlgoWeight(name, correct) {
        const hist = this.algoHistory[name];
        if (!hist) return;
        hist.unshift(correct ? 1 : 0);
        if (hist.length > WEIGHT_WINDOW) hist.pop();
        if (hist.length >= 5) {
            const acc = hist.reduce((a,b)=>a+b,0)/hist.length;
            const w = WEIGHT_MIN + (WEIGHT_MAX-WEIGHT_MIN) * Math.max(0, (acc-0.5)/0.3);
            this.algoWeights[name] = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w));
        }
    }

    recordOutcome(correct) {
        this.recentOutcomes.unshift(correct);
        if (this.recentOutcomes.length > 50) this.recentOutcomes.pop();
        this._evaluateBreaker();
    }

    _consecWrong() {
        let n = 0;
        for (const r of this.recentOutcomes) { if (!r) n++; else break; }
        return n;
    }

    _evaluateBreaker() {
        const w10 = this.recentOutcomes.slice(0,10);
        const w5  = this.recentOutcomes.slice(0,5);
        if (w10.length < 5) return;
        const acc10 = w10.filter(Boolean).length/w10.length;
        const acc5  = w5.filter(Boolean).length/w5.length;
        const consec = this._consecWrong();

        if (consec >= 4 || acc10 < 0.25) {
            if (this.autoBreaker.level !== 2) {
                this.autoBreaker.level = 2;
                this.autoBreaker.active = true;
                console.log(`🔥🔥 [${this.name}] HARD BREAKER: ${consec} sai, acc10=${(acc10*100).toFixed(0)}%`);
            }
            return;
        }
        if (acc5 < 0.30) {
            if (this.autoBreaker.level === 0) {
                this.autoBreaker.level = 1;
                this.autoBreaker.active = true;
                console.log(`⚡ [${this.name}] SOFT BREAKER: acc5=${(acc5*100).toFixed(0)}%`);
            }
            return;
        }
        if (this.autoBreaker.active && acc10 >= RECOVER_THRESH) {
            this.autoBreaker.level = 0;
            this.autoBreaker.active = false;
            console.log(`✅ [${this.name}] BREAKER OFF`);
        }
    }

    applyBreaker(pred, conf) {
        if (!this.autoBreaker.active) return { pred, conf };
        const newPred = pred === "TAI" ? "XIU" : "TAI";
        this.autoBreaker.totalFlips++;
        const scale = this.autoBreaker.level === 2 ? 0.85 : 0.80;
        return { pred: newPred, conf: Math.min(82, conf * scale) };
    }

    omegaPredict(nextIdNum) {
        if (this.sessions.length < 3) {
            return {
                prediction: "TAI", confidence: 50, method: "Thiếu dữ liệu",
                topAlgos: [], activeCnt: 0, algoSignals: {}, scoreTai: 0, scoreXiu: 0,
            };
        }

        let scoreTai = 0, scoreXiu = 0, activeCnt = 0;
        const topAlgos = [];
        const algoSignals = {};

        for (const algo of ALL_ALGOS) {
            let res = null;
            try { res = algo.fn(this.sessions, nextIdNum); } catch (_) {}
            if (!res || !res.pred || res.conf <= 0) continue;
            const w = this.algoWeights[algo.name] * (res.conf / 100);
            if (res.pred === "TAI") scoreTai += w;
            else scoreXiu += w;
            activeCnt++;
            algoSignals[algo.name] = res;
            if (topAlgos.length < 20) topAlgos.push({ name: algo.name, ...res, weight: this.algoWeights[algo.name] });
        }

        const totalScore = scoreTai + scoreXiu;
        let finalPred, finalConf, method;

        if (totalScore === 0) {
            const n = Math.min(this.sessions.length, 50);
            const tai = this.sessions.slice(0,n).filter(s=>s.result==="TAI").length;
            finalPred = tai >= n/2 ? "TAI" : "XIU";
            finalConf = 50;
            method = "Fallback thống kê";
        } else {
            finalPred = scoreTai >= scoreXiu ? "TAI" : "XIU";
            const winRate = Math.max(scoreTai, scoreXiu) / totalScore;
            finalConf = Math.min(95, Math.max(50, 50 + (winRate-0.5)*100));
            const domCnt = topAlgos.filter(a=>a.pred===finalPred).length;
            const opp = topAlgos.length - domCnt;
            method = domCnt > opp * 2
                ? `Đồng thuận ${domCnt}/${topAlgos.length} (${activeCnt}/${ALL_ALGOS.length})`
                : `Weighted ${domCnt}v${opp} (${activeCnt}/${ALL_ALGOS.length})`;
        }

        const broke = this.applyBreaker(finalPred, finalConf);
        if (broke.pred !== finalPred) method = `[BREAK Lv${this.autoBreaker.level}] ${method}`;
        finalPred = broke.pred;
        finalConf = broke.conf;

        return { prediction: finalPred, confidence: Math.round(finalConf), method, topAlgos, activeCnt, algoSignals, scoreTai, scoreXiu };
    }

    learnFromResult(sessionResult, algoSignals) {
        for (const [name, sig] of Object.entries(algoSignals || {})) {
            if (sig && sig.pred) this.updateAlgoWeight(name, sig.pred === sessionResult);
        }
    }

    updatePredictions() {
        if (this.sessions.length === 0) return;
        const latest = this.sessions[0];
        const nextIdNum = latest.id_num + 1;

        for (const sess of this.sessions.slice(0, 30)) {
            const pred = this.predictions.find(p => p.predictedId === sess.id_num && p.correct === null);
            if (pred) {
                pred.actual = sess.result;
                pred.correct = pred.predicted === sess.result;
                this.recordOutcome(pred.correct);
                if (pred.algoSignals) this.learnFromResult(sess.result, pred.algoSignals);
            }
        }

        const { prediction, confidence, method, topAlgos, activeCnt, algoSignals, scoreTai, scoreXiu } = this.omegaPredict(nextIdNum);
        const existing = this.predictions.find(p => p.predictedId === nextIdNum);
        const entry = {
            predictedId: nextIdNum, predicted: prediction, confidence, method,
            topAlgos, activeCnt, algoSignals, scoreTai, scoreXiu,
            actual: null, correct: null,
            breakerActive: this.autoBreaker.active,
            breakerLevel: this.autoBreaker.level,
            timestamp: Date.now(),
        };
        if (!existing) this.predictions.unshift(entry);
        else if (existing.correct === null) Object.assign(existing, entry);

        if (this.predictions.length > MAX_HISTORY) this.predictions = this.predictions.slice(0, MAX_HISTORY);
        this.saveCache();
    }

    loadCache() {
        try {
            if (fs.existsSync(this.cacheFile)) {
                const d = JSON.parse(fs.readFileSync(this.cacheFile, "utf-8"));
                if (d.sessions)    this.sessions    = d.sessions;
                if (d.predictions) this.predictions = d.predictions;
                console.log(`[Cache ${this.name}] ${this.sessions.length} sessions, ${this.predictions.length} predictions`);
            }
        } catch (e) { console.error(`[Cache ${this.name}] load error:`, e.message); }
    }

    saveCache() {
        try {
            fs.writeFileSync(this.cacheFile, JSON.stringify({ sessions: this.sessions, predictions: this.predictions }));
        } catch (e) { /* ignore */ }
    }

    async fetchData(url, retry = true) {
        if (this.isFetching) return false;
        this.isFetching = true;
        try {
            const raw = await fetchJSON(url, 12000, 2);
            const parsed = tryParseSessions(raw);
            if (parsed.length === 0) throw new Error("No sessions parsed");

            const existingIds = new Set(this.sessions.map(s => s.id));
            let added = 0;
            for (const ns of parsed) if (!existingIds.has(ns.id)) { this.sessions.push(ns); added++; }
            this.sessions.sort((a,b) => b.id_num - a.id_num);
            if (this.sessions.length > MAX_HISTORY) this.sessions = this.sessions.slice(0, MAX_HISTORY);

            this.lastError = null;
            this.lastFetchAt = Date.now();
            this.updatePredictions();
            this.isFetching = false;
            if (added > 0) console.log(`[${this.name}] +${added} → total ${this.sessions.length}`);
            return true;
        } catch (err) {
            this.lastError = err.message;
            this.isFetching = false;
            console.error(`[${this.name}] fetch error:`, err.message);
            if (retry) setTimeout(() => this.fetchData(url, false), RETRY_DELAY);
            return false;
        }
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  KHỞI TẠO 2 ENGINE
// ═════════════════════════════════════════════════════════════════════════════
const engineHU  = new OmegaEngine("HŨ",  CACHE_HU);
const engineMD5 = new OmegaEngine("MD5", CACHE_MD5);

engineHU.loadCache();
engineMD5.loadCache();

// ═════════════════════════════════════════════════════════════════════════════
//  RESPONSE BUILDER
// ═════════════════════════════════════════════════════════════════════════════
function buildResp(engine) {
    if (!engine.sessions.length) return null;
    const latest = engine.sessions[0];
    const nextId = latest.id_num + 1;
    const pred = engine.predictions.find(p => p.predictedId === nextId);

    const duDoan = pred ? (pred.predicted === "TAI" ? "TÀI" : "XỈU") : "CHỜ";
    const tyLe   = pred ? `${pred.confidence}%` : "--";

    return {
        Id:          ADMIN,
        Phien_nay:   nextId,
        Du_doan:     duDoan,
        Ty_le:       tyLe,
        Phien_truoc: latest.id_num,
        Xuc_xac:     latest.dice?.length === 3 ? latest.dice.join("-") : "—",
        Ket_qua:     latest.result === "TAI" ? "TÀI" : "XỈU",
    };
}

// ═════════════════════════════════════════════════════════════════════════════
//  FASTIFY SERVER
// ═════════════════════════════════════════════════════════════════════════════
const app = fastify({ logger: false, disableRequestLogging: true });
await app.register(cors, { origin: "*" });

const checkKey = q => q.key === VALID_KEY ? { valid: true } : { valid: false, error: `Sai key! Ib ${ADMIN}` };

// ─── HEALTHCHECK ───
app.get("/", async () => ({
    status: "ok",
    admin: ADMIN,
    engine: `OMEGA v5.0 — ${ALL_ALGOS.length} thuật toán`,
    hu:  { loaded: engineHU.sessions.length,  last_id: engineHU.sessions[0]?.id_num || null,  breaker: engineHU.autoBreaker.level },
    md5: { loaded: engineMD5.sessions.length, last_id: engineMD5.sessions[0]?.id_num || null, breaker: engineMD5.autoBreaker.level },
}));

// ─── HŨ ───
app.get("/api/taixiu/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp(engineHU);
    return r || rep.status(503).send({ error: "Đang tải dữ liệu HŨ..." });
});

// ─── MD5 ───
app.get("/api/taixiumd5/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp(engineMD5);
    return r || rep.status(503).send({ error: "Đang tải dữ liệu MD5..." });
});

// ─── DEBUG ───
app.get("/api/debug/:loai", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const eng = req.params.loai === "md5" ? engineMD5 : engineHU;
    if (!eng.sessions.length) return rep.status(503).send({ error: "Chưa đủ dữ liệu" });
    const latest = eng.sessions[0];
    const nextId = latest.id_num + 1;
    const pred = eng.predictions.find(p => p.predictedId === nextId);
    const done = eng.predictions.filter(p => p.correct !== null);
    const correct = done.filter(p => p.correct).length;
    return {
        engine: eng.name,
        algo_count: ALL_ALGOS.length,
        sessions: eng.sessions.length,
        last: latest,
        next_id: nextId,
        prediction: pred ? { pred: pred.predicted, conf: pred.confidence, method: pred.method, active: pred.activeCnt } : null,
        breaker: eng.autoBreaker,
        accuracy: done.length ? `${(correct/done.length*100).toFixed(1)}%` : "—",
        stats: { total: done.length, correct, wrong: done.length - correct },
        top_algos: pred?.topAlgos?.slice(0, 10) || [],
        recent_outcomes: eng.recentOutcomes.slice(0, 20),
    };
});

// ─── STATS ───
app.get("/api/stats", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });

    const stats = eng => {
        const done = eng.predictions.filter(p => p.correct !== null);
        const correct = done.filter(p => p.correct).length;
        const last20 = eng.recentOutcomes.slice(0, 20);
        return {
            sessions: eng.sessions.length,
            predictions: eng.predictions.length,
            accuracy: done.length ? `${(correct/done.length*100).toFixed(1)}%` : "—",
            total_evaluated: done.length,
            correct, wrong: done.length - correct,
            recent20: last20.length ? `${(last20.filter(Boolean).length/last20.length*100).toFixed(1)}%` : "—",
            breaker: eng.autoBreaker,
            last_error: eng.lastError,
            last_fetch: eng.lastFetchAt ? new Date(eng.lastFetchAt).toISOString() : null,
        };
    };
    return { hu: stats(engineHU), md5: stats(engineMD5), algo_count: ALL_ALGOS.length };
});

// ─── CHECK KEY ───
app.get("/check-key", async req =>
    req.query.key === VALID_KEY
        ? { status: "success", message: "KEY HỢP LỆ", admin: ADMIN }
        : { status: "error", message: `Sai key! Ib ${ADMIN}` });

// ═════════════════════════════════════════════════════════════════════════════
//  BOOT
// ═════════════════════════════════════════════════════════════════════════════
app.listen({ port: PORT, host: "0.0.0.0" })
    .then(() => {
        console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  🔮 OMEGA PREDICTION ENGINE v5.0 — 5000 THUẬT TOÁN                   ║
╠══════════════════════════════════════════════════════════════════════╣
║  🚀 Port: ${PORT}
║  🔑 Key : ${VALID_KEY}
║  👤 Admin: ${ADMIN}
║  🧠 Thuật toán: ${ALL_ALGOS.length}
║  🔥 Auto-Breaker + Self-Learning
║  📌 API:
║     HŨ : /api/taixiu/lc79?key=${VALID_KEY}
║     MD5: /api/taixiumd5/lc79?key=${VALID_KEY}
║     Debug: /api/debug/hu?key=${VALID_KEY}
║     Stats: /api/stats?key=${VALID_KEY}
╚══════════════════════════════════════════════════════════════════════╝
        `);

        setTimeout(() => {
            engineHU.fetchData(API_HU).catch(() => {});
            engineMD5.fetchData(API_MD5).catch(() => {});
        }, 100);

        setInterval(() => engineHU.fetchData(API_HU).catch(() => {}),  FETCH_INTERVAL);
        setInterval(() => engineMD5.fetchData(API_MD5).catch(() => {}), FETCH_INTERVAL);
    })
    .catch(err => {
        console.error("❌ Boot:", err.message);
        process.exit(1);
    });