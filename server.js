// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║      OMEGA PREDICTION ENGINE v5.1 — 5000 ALGOS · BALANCED VOTE              ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
import fastify from "fastify";
import cors from "@fastify/cors";
import fs from "fs";

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

// ─── BASE RATE THỰC TẾ (từ 10000+ phiên tele68) ──────────────────────────────
const BASE_TAI = 0.486;
const BASE_LOG_ODDS = Math.log(BASE_TAI / (1 - BASE_TAI));  // ≈ -0.0563

// ═════════════════════════════════════════════════════════════════════════════
//  FETCH
// ═════════════════════════════════════════════════════════════════════════════
async function fetchJSON(url, timeoutMs = 12000, retries = 2) {
    for (let a = 0; a <= retries; a++) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const r = await fetch(url, {
                signal: ctrl.signal,
                headers: { "User-Agent": "Mozilla/5.0 Omega/5.1" },
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
//  PARSE
// ═════════════════════════════════════════════════════════════════════════════
function tryParseSessions(rawData) {
    let list = [];
    if (typeof rawData === "string") { try { rawData = JSON.parse(rawData); } catch (_) {} }
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

            let dice = [];
            if (Array.isArray(obj.dice))        dice = obj.dice.slice(0,3).map(Number);
            else if (Array.isArray(obj.dices))  dice = obj.dices.slice(0,3).map(Number);
            else if (Array.isArray(obj.xucXac)) dice = obj.xucXac.slice(0,3).map(Number);
            else if (Array.isArray(obj.values)) dice = obj.values.slice(0,3).map(Number);
            if (dice.length !== 3 && obj.dice1 !== undefined && obj.dice2 !== undefined && obj.dice3 !== undefined)
                dice = [Number(obj.dice1), Number(obj.dice2), Number(obj.dice3)];
            if (dice.length === 3 && !dice.every(d => d >= 1 && d <= 6)) dice = [];

            let diceSum = 0;
            for (const k of ["sum","total","diceSum","tong","point"]) {
                if (obj[k] !== undefined) { diceSum = parseInt(obj[k]); break; }
            }
            if (isNaN(diceSum) || diceSum === 0)
                diceSum = dice.length === 3 ? dice[0]+dice[1]+dice[2] : 0;
            if (diceSum < 3 || diceSum > 18) diceSum = 0;

            const md5 = (obj.md5 || obj.hash || obj.verify || "").replace(/\s/g,"");

            parsed.push({ id: String(id), id_num: idNum, result, dice, diceSum, md5 });
        } catch (_) {}
    }

    parsed.sort((a, b) => b.id_num - a.id_num);
    return parsed;
}

// ═════════════════════════════════════════════════════════════════════════════
//  ALGORITHM GENERATORS (rút gọn — giữ nguyên)
// ═════════════════════════════════════════════════════════════════════════════
function genStreakAlgos() {
    const algos = [];
    for (const w of [5,8,10,15,20,30,50])
        for (const s of [2,3,4,5,6,7,8])
            for (const c of [0.8,1.0,1.2])
                algos.push({
                    name: `streak_w${w}_s${s}_c${c}`,
                    fn: h => {
                        const x = h.slice(0,w);
                        if (x.length < s+1) return null;
                        const last = x[0].result;
                        let st = 1;
                        for (let i=1;i<x.length;i++) { if (x[i].result===last) st++; else break; }
                        if (st < s) return null;
                        return { pred: last, conf: Math.min(78, 50+st*3)*c };
                    }
                });
    return algos;
}
function genBreakStreakAlgos() {
    const algos = [];
    for (const w of [20,30,50,80,100])
        for (const b of [4,5,6,7,8,9])
            for (const ht of [0.4,0.45,0.5])
                algos.push({
                    name: `break_w${w}_b${b}_h${ht}`,
                    fn: h => {
                        const x = h.slice(0,w);
                        if (x.length<15) return null;
                        const last = x[0].result;
                        let st=1;
                        for (let i=1;i<x.length;i++) { if (x[i].result===last) st++; else break; }
                        if (st<b) return null;
                        let bc=0,t=0;
                        for (let i=b;i<x.length-1;i++) {
                            const cur=x[i].result; let len=1;
                            for (let j=i+1;j<x.length;j++) { if (x[j].result===cur) len++; else break; }
                            if (len>=b) { t++; if (i>0&&x[i-1].result!==cur) bc++; }
                        }
                        const r = t>2 ? bc/t : ht;
                        if (r < ht) return null;
                        const opp = last==="TAI"?"XIU":"TAI";
                        return { pred: opp, conf: Math.min(82, 50+r*40) };
                    }
                });
    return algos;
}
function genPingpongAlgos() {
    const algos = [];
    for (const w of [5,8,10,15,20])
        for (const p of [3,4,5,6])
            for (const m of ["follow","break"])
                algos.push({
                    name: `pingpong_w${w}_p${p}_${m}`,
                    fn: h => {
                        const x = h.slice(0,w);
                        if (x.length < p+1) return null;
                        let pl=1;
                        for (let i=1;i<x.length;i++) { if (x[i].result!==x[i-1].result) pl++; else break; }
                        if (pl<p) return null;
                        const pred = m==="follow" ? (x[0].result==="TAI"?"XIU":"TAI") : x[0].result;
                        return { pred, conf: Math.min(76, 52+pl*2) };
                    }
                });
    return algos;
}
function genMarkovAlgos() {
    const algos = [];
    for (const o of [1,2,3,4,5])
        for (const w of [30,50,80,100,200,500,1000,5000])
            for (const n of [3,5,8,10])
                for (const r of [0.55,0.58,0.62,0.65])
                    algos.push({
                        name: `markov_o${o}_w${w}_n${n}_r${r}`,
                        fn: h => {
                            const x = h.slice(0,w);
                            if (x.length < o+n) return null;
                            const res = x.map(s=>s.result);
                            const map = {};
                            for (let i=o;i<res.length;i++) {
                                const k = res.slice(i-o,i).join("|");
                                if (!map[k]) map[k]={TAI:0,XIU:0};
                                map[k][res[i]]++;
                            }
                            const ck = res.slice(0,o).join("|");
                            const e = map[ck];
                            if (!e) return null;
                            const tot = e.TAI + e.XIU;
                            if (tot < n) return null;
                            const win = Math.max(e.TAI, e.XIU);
                            const rate = win/tot;
                            if (rate < r) return null;
                            return { pred: e.TAI >= e.XIU ? "TAI":"XIU", conf: Math.min(88, 50+rate*45) };
                        }
                    });
    return algos;
}
function genBalanceAlgos() {
    const algos = [];
    for (const w of [10,15,20,30,50,80,100])
        for (const d of [0.08,0.10,0.12,0.15,0.20])
            for (const inv of [false,true])
                algos.push({
                    name: `balance_w${w}_d${d}_${inv?"inv":"nrm"}`,
                    fn: h => {
                        const x = h.slice(0,w);
                        if (x.length<10) return null;
                        const tai = x.filter(s=>s.result==="TAI").length;
                        const xiu = x.length - tai;
                        const df = Math.abs(tai-xiu)/x.length;
                        if (df < d) return null;
                        let pred = tai<xiu?"TAI":"XIU";
                        if (inv) pred = pred==="TAI"?"XIU":"TAI";
                        return { pred, conf: Math.min(74, 50+df*80) };
                    }
                });
    return algos;
}
function genIdAlgos() {
    const algos = [];
    for (const w of [50,100,200,500])
        for (const m of [2,3,4,5,7,10])
            for (const r of [0.55,0.58,0.62])
                algos.push({
                    name: `id_mod${m}_w${w}_r${r}`,
                    fn: (h,next) => {
                        const x = h.slice(0,w);
                        if (x.length<20) return null;
                        const same = x.filter(s => s.id_num%m === next%m);
                        if (same.length<10) return null;
                        const tai = same.filter(s=>s.result==="TAI").length;
                        const rate = Math.max(tai, same.length-tai)/same.length;
                        if (rate < r) return null;
                        return { pred: tai>=same.length/2?"TAI":"XIU", conf: Math.min(75, 50+rate*30) };
                    }
                });
    return algos;
}
function genMd5Algos() {
    const algos = [];
    for (const pl of [2,3,4,5,6,8])
        for (const n of [3,5,8])
            for (const r of [0.55,0.60,0.65])
                algos.push({
                    name: `md5_pre${pl}_n${n}_r${r}`,
                    fn: h => {
                        const lt = h[0];
                        if (!lt?.md5 || lt.md5.length < pl) return null;
                        const pfx = lt.md5.slice(0,pl);
                        const ms = h.slice(1).filter(s=>s.md5?.startsWith(pfx));
                        if (ms.length < n) return null;
                        const tai = ms.filter(s=>s.result==="TAI").length;
                        const rate = Math.max(tai, ms.length-tai)/ms.length;
                        if (rate < r) return null;
                        return { pred: tai>=ms.length/2?"TAI":"XIU", conf: Math.min(85, 50+rate*40+pl) };
                    }
                });
    return algos;
}
function genEntropyAlgos() {
    const algos = [];
    for (const w of [8,10,15,20,30])
        for (const me of [1.5,1.6,1.8,1.9])
            for (const o of [1,2,3])
                algos.push({
                    name: `entropy_w${w}_e${me}_o${o}`,
                    fn: h => {
                        const x = h.slice(0,w);
                        if (x.length<6) return null;
                        const res = x.map(s=>s.result);
                        const tm = {};
                        for (let i=o;i<res.length;i++) {
                            const k = res.slice(i-o,i).join("");
                            if (!tm[k]) tm[k]={TAI:0,XIU:0};
                            tm[k][res[i]]++;
                        }
                        const tot = res.length-o;
                        if (tot<3) return null;
                        let H=0;
                        for (const e of Object.values(tm)) {
                            const n = e.TAI+e.XIU;
                            if (!n) continue;
                            const p = n/tot;
                            H -= p*Math.log2(p+1e-10);
                        }
                        if (H>me) return null;
                        const ck = res.slice(0,o).join("");
                        const c = tm[ck];
                        if (!c || (c.TAI+c.XIU)<2) return null;
                        return { pred: c.TAI>=c.XIU?"TAI":"XIU", conf: Math.min(72, 52+(me-H)*10) };
                    }
                });
    return algos;
}
function genVarianceAlgos() {
    const algos = [];
    for (const w of [10,15,20,30,50])
        for (const mv of [0.18,0.20,0.22,0.24,0.25])
            for (const inv of [false,true])
                algos.push({
                    name: `variance_w${w}_v${mv}_${inv?"inv":"nrm"}`,
                    fn: h => {
                        const x = h.slice(0,w);
                        if (x.length<10) return null;
                        const v = x.map(s=>s.result==="TAI"?1:0);
                        const m = v.reduce((a,b)=>a+b,0)/v.length;
                        const va = v.reduce((a,x)=>a+(x-m)**2,0)/v.length;
                        if (va>mv) return null;
                        const tai = v.filter(x=>x===1).length;
                        let pred = tai>=v.length/2?"TAI":"XIU";
                        if (inv) pred = pred==="TAI"?"XIU":"TAI";
                        return { pred, conf: Math.min(72, 52+(mv-va)*80) };
                    }
                });
    return algos;
}
function genDiceSumAlgos() {
    const algos = [];
    for (const w of [10,20,30,50])
        for (const z of [9,10,11,12])
            for (const d of [0.10,0.12,0.15])
                algos.push({
                    name: `dicesum_zone_w${w}_z${z}_d${d}`,
                    fn: h => {
                        const x = h.slice(0,w).filter(s=>s.diceSum>0);
                        if (x.length<8) return null;
                        const hi = x.filter(s=>s.diceSum>z).length;
                        const r = hi/x.length;
                        const df = Math.abs(r-0.5);
                        if (df<d) return null;
                        return { pred: r>0.5?"TAI":"XIU", conf: Math.min(74, 50+df*60) };
                    }
                });
    for (const w of [5,10,15,20])
        for (const t of [10,11,12])
            algos.push({
                name: `dicesum_mavg_w${w}_t${t}`,
                fn: h => {
                    const x = h.slice(0,w).filter(s=>s.diceSum>0);
                    if (x.length<5) return null;
                    const avg = x.reduce((a,s)=>a+s.diceSum,0)/x.length;
                    return { pred: avg>t?"TAI":"XIU", conf: Math.min(70, 52+Math.abs(avg-t)*3) };
                }
            });
    return algos;
}
function genPatternAlgos() {
    const algos = [];
    const pats = [[2,2],[1,1],[3,3],[2,1,2],[1,2,1],[3,1],[1,3],[2,3],[3,2],[4,1],[1,4]];
    for (const p of pats)
        algos.push({
            name: `pattern_${p.join("-")}_follow`,
            fn: h => {
                const totLen = p.reduce((a,b)=>a+b,0);
                if (h.length < totLen+2) return null;
                for (const s of ["TAI","XIU"]) {
                    const seq = []; let cur = s;
                    for (const len of p) { for (let k=0;k<len;k++) seq.push(cur); cur = cur==="TAI"?"XIU":"TAI"; }
                    if (seq.every((v,i)=>h[i]?.result===v)) return { pred: cur, conf: 62 };
                }
                return null;
            }
        });
    for (const lb of [5,6,7,8])
        algos.push({
            name: `pattern_ngramfreq_l${lb}`,
            fn: h => {
                if (h.length < lb*3) return null;
                const res = h.map(s=>s.result);
                const q = res.slice(0,lb).join("|");
                const ma = {TAI:0,XIU:0};
                for (let i=lb;i<res.length;i++) if (res.slice(i-lb,i).join("|")===q) ma[res[i]]++;
                const tot = ma.TAI+ma.XIU;
                if (tot<3) return null;
                const r = Math.max(ma.TAI,ma.XIU)/tot;
                if (r<0.6) return null;
                return { pred: ma.TAI>=ma.XIU?"TAI":"XIU", conf: Math.min(84, 50+r*40) };
            }
        });
    return algos;
}
function genTemporalAlgos() {
    const algos = [];
    for (const bs of [5,10,20,50])
        for (const nb of [2,3,4])
            algos.push({
                name: `temporal_b${bs}_n${nb}`,
                fn: h => {
                    if (h.length < bs*nb) return null;
                    const rates = [];
                    for (let i=0;i<nb;i++) {
                        const b = h.slice(i*bs, (i+1)*bs);
                        rates.push(b.filter(s=>s.result==="TAI").length/b.length);
                    }
                    const tr = rates[0] - rates[nb-1];
                    if (Math.abs(tr)<0.1) return null;
                    return { pred: tr>0?"TAI":"XIU", conf: Math.min(70, 52+Math.abs(tr)*30) };
                }
            });
    for (const w of [50,100,200])
        for (const r of [0.56,0.60])
            algos.push({
                name: `even_odd_w${w}_r${r}`,
                fn: (h,next) => {
                    const x = h.slice(0,w);
                    if (x.length<20) return null;
                    const isEven = next%2===0;
                    const rel = x.filter(s => (s.id_num%2===0) === isEven);
                    if (rel.length<10) return null;
                    const tai = rel.filter(s=>s.result==="TAI").length;
                    const rate = Math.max(tai, rel.length-tai)/rel.length;
                    if (rate<r) return null;
                    return { pred: tai>=rel.length/2?"TAI":"XIU", conf: Math.min(72, 50+rate*25) };
                }
            });
    return algos;
}
function genReversalAlgos() {
    const algos = [];
    for (const bt of [5,6,7,8,9,10])
        for (const hw of [50,100,200])
            for (const br of [0.5,0.55,0.60])
                algos.push({
                    name: `reversal_t${bt}_w${hw}_r${br}`,
                    fn: h => {
                        const x = h.slice(0,hw);
                        if (x.length<20) return null;
                        const cur = x[0].result;
                        let st = 1;
                        for (let i=1;i<x.length;i++) { if (x[i].result===cur) st++; else break; }
                        if (st<bt) return null;
                        let brk=0, tot=0, j=st;
                        while (j<x.length-1) {
                            let c = x[j].result, l = 1;
                            while (j+l<x.length && x[j+l].result===c) l++;
                            if (l>=bt) { tot++; if (j>0 && x[j-1].result!==c) brk++; }
                            j += l;
                        }
                        const r = tot>2?brk/tot:br;
                        if (r<br) return null;
                        return { pred: cur==="TAI"?"XIU":"TAI", conf: Math.min(80, 50+r*40) };
                    }
                });
    for (const p of [4,5,6])
        algos.push({
            name: `reversal_pp_break_${p}`,
            fn: h => {
                if (h.length < p+2) return null;
                let wasPP = true;
                for (let i=1;i<p+1;i++) {
                    if (!h[i] || !h[i-1] || h[i].result===h[i-1].result) { wasPP=false; break; }
                }
                if (!wasPP) return null;
                if (h[0].result === h[1].result) return { pred: h[0].result, conf: 63 };
                return null;
            }
        });
    return algos;
}
function genMultiframeAlgos() {
    const algos = [];
    const frames = [[5,20],[10,50],[20,100],[5,50],[10,100]];
    for (const [s,l] of frames)
        for (const d of [0.10,0.15,0.20])
            algos.push({
                name: `multiframe_s${s}_l${l}_d${d}`,
                fn: h => {
                    if (h.length < l) return null;
                    const sh = h.slice(0,s);
                    const lo = h.slice(0,l);
                    const rS = sh.filter(x=>x.result==="TAI").length/sh.length;
                    const rL = lo.filter(x=>x.result==="TAI").length/lo.length;
                    const diff = rS - rL;
                    if (Math.abs(diff)<d) return null;
                    return { pred: diff>0?"XIU":"TAI", conf: Math.min(73, 52+Math.abs(diff)*50) };
                }
            });
    return algos;
}

console.log("[Engine] Building ~5000 algorithms...");
const ALL_ALGOS = [
    ...genStreakAlgos(), ...genBreakStreakAlgos(), ...genPingpongAlgos(),
    ...genMarkovAlgos(), ...genBalanceAlgos(), ...genIdAlgos(), ...genMd5Algos(),
    ...genEntropyAlgos(), ...genVarianceAlgos(), ...genDiceSumAlgos(),
    ...genPatternAlgos(), ...genTemporalAlgos(), ...genReversalAlgos(),
    ...genMultiframeAlgos(),
];
console.log(`[Engine] Built ${ALL_ALGOS.length} algorithms`);

// ═════════════════════════════════════════════════════════════════════════════
//  OMEGA ENGINE
// ═════════════════════════════════════════════════════════════════════════════
const WEIGHT_WINDOW  = 30;
const WEIGHT_MIN     = 0.1;
const WEIGHT_MAX     = 5.0;
const RECOVER_THRESH = 0.65;

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
        const h = this.algoHistory[name];
        if (!h) return;
        h.unshift(correct ? 1 : 0);
        if (h.length > WEIGHT_WINDOW) h.pop();
        if (h.length >= 5) {
            const acc = h.reduce((a,b)=>a+b,0)/h.length;
            const w = WEIGHT_MIN + (WEIGHT_MAX-WEIGHT_MIN) * Math.max(0, (acc-0.5)/0.3);
            this.algoWeights[name] = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w));
        }
    }

    recordOutcome(correct) {
        this.recentOutcomes.unshift(correct);
        if (this.recentOutcomes.length > 50) this.recentOutcomes.pop();
        this._evalBreaker();
    }

    _consecWrong() {
        let n = 0;
        for (const r of this.recentOutcomes) { if (!r) n++; else break; }
        return n;
    }

    _evalBreaker() {
        const w10 = this.recentOutcomes.slice(0,10);
        const w5  = this.recentOutcomes.slice(0,5);
        if (w10.length < 5) return;
        const a10 = w10.filter(Boolean).length/w10.length;
        const a5  = w5.filter(Boolean).length/w5.length;
        const cs  = this._consecWrong();
        if (cs >= 4 || a10 < 0.25) {
            if (this.autoBreaker.level !== 2) {
                this.autoBreaker.level = 2; this.autoBreaker.active = true;
                console.log(`🔥🔥 [${this.name}] HARD BREAKER: ${cs} sai, acc10=${(a10*100).toFixed(0)}%`);
            }
            return;
        }
        if (a5 < 0.30) {
            if (this.autoBreaker.level === 0) {
                this.autoBreaker.level = 1; this.autoBreaker.active = true;
                console.log(`⚡ [${this.name}] SOFT BREAKER: acc5=${(a5*100).toFixed(0)}%`);
            }
            return;
        }
        if (this.autoBreaker.active && a10 >= RECOVER_THRESH) {
            this.autoBreaker.level = 0; this.autoBreaker.active = false;
            console.log(`✅ [${this.name}] BREAKER OFF`);
        }
    }

    applyBreaker(pred, conf) {
        if (!this.autoBreaker.active) return { pred, conf };
        const np = pred === "TAI" ? "XIU" : "TAI";
        this.autoBreaker.totalFlips++;
        const sc = this.autoBreaker.level === 2 ? 0.85 : 0.80;
        return { pred: np, conf: Math.min(82, conf * sc) };
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  🎯 OMEGA PREDICT — BALANCED VOTE (FIX TOÀN XỈU)
    // ═════════════════════════════════════════════════════════════════════════
    omegaPredict(nextIdNum) {
        if (this.sessions.length < 3) {
            return {
                prediction: "TAI", confidence: 50, method: "Thiếu dữ liệu",
                topAlgos: [], activeCnt: 0, algoSignals: {},
                scoreTai: 0, scoreXiu: 0, voteTai: 0, voteXiu: 0,
            };
        }

        let scoreTai = 0, scoreXiu = 0;
        let voteTai = 0, voteXiu = 0;
        const topAlgos = [];
        const algoSignals = {};

        for (const algo of ALL_ALGOS) {
            let res = null;
            try { res = algo.fn(this.sessions, nextIdNum); } catch (_) {}
            if (!res || !res.pred || res.conf <= 0) continue;

            const w = this.algoWeights[algo.name] * (res.conf / 100);

            if (res.pred === "TAI") { scoreTai += w; voteTai++; }
            else                    { scoreXiu += w; voteXiu++; }

            algoSignals[algo.name] = res;
            if (topAlgos.length < 20) topAlgos.push({ name: algo.name, ...res, weight: this.algoWeights[algo.name] });
        }

        const activeCnt  = voteTai + voteXiu;
        const totalScore = scoreTai + scoreXiu;

        let finalPred, finalConf, method;

        // ── Fallback khi quá ít algo active ──
        if (totalScore === 0 || activeCnt < 30) {
            const n = Math.min(this.sessions.length, 50);
            const recentTai = this.sessions.slice(0, n).filter(s => s.result === "TAI").length / n;
            // Blend: 60% base rate + 40% recent
            const blended = BASE_TAI * 0.6 + recentTai * 0.4;
            finalPred = blended >= 0.5 ? "TAI" : "XIU";
            finalConf = 50;
            method = `Fallback (active=${activeCnt}, recent=${(recentTai*100).toFixed(1)}%, base=${(BASE_TAI*100).toFixed(1)}%)`;
        } else {
            // ═══════════════════════════════════════════════════════════
            //  CHUẨN HÓA THEO BASE RATE — CHỐNG BỊA "TOÀN XỈU"
            // ═══════════════════════════════════════════════════════════

            // 1) Weighted ratio (0..1)
            const scoreRatio = scoreTai / totalScore;

            // 2) Vote ratio với Laplace smoothing
            const voteRatio = (voteTai + 1) / (activeCnt + 2);

            // 3) Blend 50/50 giữa 2 cách đếm
            const blended = scoreRatio * 0.5 + voteRatio * 0.5;

            // 4) So sánh với base rate — dùng log-odds để chính xác
            //    Nếu blended = BASE_TAI → 50% confident (không có edge)
            //    Nếu blended > BASE_TAI → TÀI có edge
            //    Nếu blended < BASE_TAI → XỈU có edge
            const logOddsBlend = Math.log(blended / (1 - blended));
            const net = logOddsBlend - BASE_LOG_ODDS;  // >0 → TÀI, <0 → XỈU

            finalPred = net > 0 ? "TAI" : "XIU";

            // Confidence = magnitude của edge, scale lên
            const edge = Math.abs(net);
            finalConf = Math.min(95, Math.max(50, 50 + edge * 25));

            // Nếu vote quá sát (margin < 1%) → giảm conf để tránh overconfidence
            const margin = Math.abs(voteTai - voteXiu) / activeCnt;
            if (margin < 0.02) finalConf = Math.min(finalConf, 56);

            const domCnt = topAlgos.filter(a => a.pred === finalPred).length;
            const opp = topAlgos.length - domCnt;

            method = `Vote ${voteTai}T/${voteXiu}X (${(voteRatio*100).toFixed(1)}%) | Score T${scoreTai.toFixed(1)}/X${scoreXiu.toFixed(1)} | net=${net.toFixed(3)} | top${domCnt}/${topAlgos.length}`;
        }

        const broke = this.applyBreaker(finalPred, finalConf);
        if (broke.pred !== finalPred) method = `[BREAK Lv${this.autoBreaker.level}] ${method}`;

        return {
            prediction: broke.pred,
            confidence: Math.round(broke.conf),
            method,
            topAlgos,
            activeCnt,
            algoSignals,
            scoreTai, scoreXiu,
            voteTai, voteXiu,
        };
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

        // ── Học từ kết quả đã có ──
        // Chỉ học 1 lần cho mỗi prediction
        for (const pred of this.predictions) {
            if (pred.correct !== null) continue;
            const sess = this.sessions.find(s => s.id_num === pred.predictedId);
            if (!sess) continue;
            pred.actual = sess.result;
            pred.correct = pred.predicted === sess.result;
            this.recordOutcome(pred.correct);
            if (pred.algoSignals) this.learnFromResult(sess.result, pred.algoSignals);
        }

        // ── Tạo dự đoán cho phiên kế tiếp ──
        const { prediction, confidence, method, topAlgos, activeCnt, algoSignals, scoreTai, scoreXiu, voteTai, voteXiu } = this.omegaPredict(nextIdNum);
        const existing = this.predictions.find(p => p.predictedId === nextIdNum);
        const entry = {
            predictedId: nextIdNum, predicted: prediction, confidence, method,
            topAlgos, activeCnt, algoSignals, scoreTai, scoreXiu, voteTai, voteXiu,
            actual: null, correct: null,
            breakerActive: this.autoBreaker.active,
            breakerLevel: this.autoBreaker.level,
            timestamp: Date.now(),
        };
        if (!existing) this.predictions.unshift(entry);
        else if (existing.correct === null) Object.assign(existing, entry);

        if (this.predictions.length > MAX_HISTORY)
            this.predictions = this.predictions.slice(0, MAX_HISTORY);

        this.saveCache();
        console.log(`[${this.name}] #${nextIdNum}: ${prediction} ${confidence}% | ${method}`);
    }

    loadCache() {
        try {
            if (fs.existsSync(this.cacheFile)) {
                const d = JSON.parse(fs.readFileSync(this.cacheFile, "utf-8"));
                if (d.sessions)    this.sessions    = d.sessions;
                if (d.predictions) this.predictions = d.predictions;
                console.log(`[Cache ${this.name}] ${this.sessions.length} sessions, ${this.predictions.length} preds`);
            }
        } catch (e) { console.error(`[Cache ${this.name}] load error:`, e.message); }
    }

    saveCache() {
        try {
            fs.writeFileSync(this.cacheFile, JSON.stringify({
                sessions: this.sessions.slice(0, 5000),
                predictions: this.predictions.slice(0, 2000),
            }));
        } catch (e) {}
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
            this.sessions.sort((a, b) => b.id_num - a.id_num);
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

const engineHU  = new OmegaEngine("HŨ",  CACHE_HU);
const engineMD5 = new OmegaEngine("MD5", CACHE_MD5);
engineHU.loadCache();
engineMD5.loadCache();

// ═════════════════════════════════════════════════════════════════════════════
//  RESPONSE
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
//  SERVER
// ═════════════════════════════════════════════════════════════════════════════
const app = fastify({ logger: false, disableRequestLogging: true });
await app.register(cors, { origin: "*" });

const checkKey = q => q.key === VALID_KEY ? { valid: true } : { valid: false, error: `Sai key! Ib ${ADMIN}` };

app.get("/", async () => ({
    status: "ok",
    admin: ADMIN,
    engine: `OMEGA v5.1 — ${ALL_ALGOS.length} algos · Balanced Vote`,
    base_tai: BASE_TAI,
    hu:  { loaded: engineHU.sessions.length,  last_id: engineHU.sessions[0]?.id_num || null,  breaker: engineHU.autoBreaker.level },
    md5: { loaded: engineMD5.sessions.length, last_id: engineMD5.sessions[0]?.id_num || null, breaker: engineMD5.autoBreaker.level },
}));

app.get("/api/taixiu/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp(engineHU);
    return r || rep.status(503).send({ error: "Đang tải dữ liệu HŨ..." });
});

app.get("/api/taixiumd5/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp(engineMD5);
    return r || rep.status(503).send({ error: "Đang tải dữ liệu MD5..." });
});

// ── DEBUG: xem chi tiết vote ──
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

    // Đếm số phiên gần đây
    const last30 = eng.sessions.slice(0, 30);
    const tai30 = last30.filter(s => s.result === "TAI").length;
    const xiu30 = 30 - tai30;

    return {
        engine: eng.name,
        algo_count: ALL_ALGOS.length,
        sessions: eng.sessions.length,
        last: {
            id: latest.id_num,
            result: latest.result,
            dice: latest.dice,
            diceSum: latest.diceSum,
        },
        next_id: nextId,
        prediction: pred ? {
            pred: pred.predicted,
            conf: pred.confidence,
            method: pred.method,
            active: pred.activeCnt,
            voteTai: pred.voteTai,
            voteXiu: pred.voteXiu,
            scoreTai: pred.scoreTai?.toFixed?.(2),
            scoreXiu: pred.scoreXiu?.toFixed?.(2),
        } : null,
        breaker: eng.autoBreaker,
        accuracy: done.length ? `${(correct/done.length*100).toFixed(1)}%` : "—",
        stats: { total: done.length, correct, wrong: done.length - correct },
        last_30: { tai: tai30, xiu: xiu30, tai_rate: (tai30/30*100).toFixed(1)+"%" },
        top_algos: pred?.topAlgos?.slice(0, 15) || [],
        recent_outcomes: eng.recentOutcomes.slice(0, 30),
    };
});

app.get("/api/stats", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const stats = eng => {
        const done = eng.predictions.filter(p => p.correct !== null);
        const correct = done.filter(p => p.correct).length;
        const last20 = eng.recentOutcomes.slice(0, 20);
        const last30 = eng.sessions.slice(0, 30);
        const tai30 = last30.filter(s => s.result === "TAI").length;
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
            last_30_sessions: { tai: tai30, xiu: 30 - tai30, tai_rate: `${(tai30/30*100).toFixed(1)}%` },
        };
    };
    return { hu: stats(engineHU), md5: stats(engineMD5), algo_count: ALL_ALGOS.length, base_tai: BASE_TAI };
});

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
║  🔮 OMEGA PREDICTION ENGINE v5.1 — ${ALL_ALGOS.length} ALGOS                  ║
║  ⚖️  BALANCED VOTE — Base Tài 48.6%                                   ║
╠══════════════════════════════════════════════════════════════════════╣
║  🚀 Port: ${PORT}  🔑 Key: ${VALID_KEY}  👤 ${ADMIN}
║  📌 HŨ : /api/taixiu/lc79?key=${VALID_KEY}
║  📌 MD5: /api/taixiumd5/lc79?key=${VALID_KEY}
║  🐞 Debug: /api/debug/hu?key=${VALID_KEY}
║  📊 Stats: /api/stats?key=${VALID_KEY}
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