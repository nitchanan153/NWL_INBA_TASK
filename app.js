/* NWL Task · บันทึกงานรายวัน
 * แอปหน้าเดียว (ไม่มี build step) — ข้อมูลทั้งหมดเก็บใน LocalStorage ของเบราว์เซอร์ผู้ใช้
 * ไม่มีข้อมูลงานฝังอยู่ในไฟล์นี้ เพื่อให้ขึ้นเว็บสาธารณะ (เช่น Vercel) ได้อย่างปลอดภัย
 */
(function () {
  'use strict';

  /* =========================================================
   * 1–2) ค่าคงที่
   * ========================================================= */
  const STORE_KEY = 'nwl-task-tracker:v3';
  const OLD_KEYS = ['nwl-task-tracker:v2', 'nwl-task-tracker:v1'];
  const DATA_VERSION = 3;
  const N_TASKS = 5;

  // สถานะงาน — เลือกแยกในแต่ละช่อง Task
  const STATUSES = [
    { sym: '✓', label: 'เสร็จแล้ว',        k: 'done' },
    { sym: '◐', label: 'กำลังทำ / ทำต่อ',  k: 'wip' },
    { sym: '✗', label: 'ไม่เสร็จ',          k: 'fail' },
    { sym: '⊘', label: 'ยกเลิก',            k: 'cancel' }
  ];
  // การมาทำงาน — เลือกครั้งเดียวต่อวัน (แถวบนสุดของตาราง) แยกจากสถานะงาน
  const ATTENDS = [
    { k: 'office', sym: '●', label: 'มาทำงาน (ออฟฟิศ)', short: 'ออฟฟิศ' },
    { k: 'wfa',    sym: '⌂', label: 'WFA',              short: 'WFA' },
    { k: 'leave',  sym: '○', label: 'ลา',               short: 'ลา' },
    { k: 'off',    sym: '–', label: 'ไม่มีงาน',          short: 'ไม่มีงาน' }
  ];
  const ATTEND_OF = Object.fromEntries(ATTENDS.map(a => [a.k, a]));
  const KEY_OF = Object.fromEntries(STATUSES.map(s => [s.sym, s.k]));
  const OPEN = new Set(['◐', '✗']);   // สถานะที่ถือว่ายังต้องทำต่อ
  const TH_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  const TH_MON_S = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const EN_MON_S = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const TH_DOW = ['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.'];

  const $ = (s, r = document) => r.querySelector(s);
  const grid = $('#grid');
  const wrap = $('#grid-wrap');

  /* =========================================================
   * 3) ตัวช่วยเรื่องวันที่ (เวลาท้องถิ่น ไม่เพี้ยนตาม timezone)
   * ========================================================= */
  const pad = n => String(n).padStart(2, '0');
  const toISO = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const isISO = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
  const dowOf = s => { const { y, m, d } = parseISO(s); return new Date(y, m - 1, d).getDay(); };
  const addDays = (s, n) => { const { y, m, d } = parseISO(s); const t = new Date(y, m - 1, d + n); return toISO(t.getFullYear(), t.getMonth() + 1, t.getDate()); };
  const daysBetween = (a, b) => { const A = parseISO(a), B = parseISO(b); return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 864e5); };
  const todayISO = () => { const t = new Date(); return toISO(t.getFullYear(), t.getMonth() + 1, t.getDate()); };
  const fmtShort = s => { const { m, d } = parseISO(s); return `${d} ${TH_MON_S[m - 1]}`; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const uid = () => 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const holidaySet = () => new Set(state.holidays.map(h => h.date));
  function isWorkday(iso, hol = holidaySet()) { const w = dowOf(iso); return w !== 0 && w !== 6 && !hol.has(iso); }
  function nextWorkday(iso) { const hol = holidaySet(); let d = addDays(iso, 1); while (!isWorkday(d, hol)) d = addDays(d, 1); return d; }
  function workdayOnOrAfter(iso) { const hol = holidaySet(); let d = iso; while (!isWorkday(d, hol)) d = addDays(d, 1); return d; }
  // วันปลายทางเวลา "ทำต่อ": วันทำงานถัดไปของวันต้นทาง แต่ไม่ย้อนไปก่อนวันนี้
  function carryTarget(srcIso) {
    const t = nextWorkday(srcIso), today = todayISO();
    return t < today ? workdayOnOrAfter(today) : t;
  }
  // วันปลายทางเวลา "ดึงมาวันนี้" จากแผงงานค้าง
  function pullTarget(srcIso) {
    const t = workdayOnOrAfter(todayISO());
    return srcIso >= t ? nextWorkday(srcIso) : t;
  }

  // คอลัมน์ของเดือน: ข้ามเสาร์-อาทิตย์และวันหยุด (ตรรกะเดียวกับ WORKDAY ใน Excel)
  function monthColumns(y, m) {
    const hol = new Map(state.holidays.map(h => [h.date, h.name]));
    const last = new Date(y, m, 0).getDate();
    const cols = [], skippedInMonth = [];
    let pendingSkip = [];
    for (let d = 1; d <= last; d++) {
      const iso = toISO(y, m, d);
      const w = new Date(y, m - 1, d).getDay();
      if (w === 0 || w === 6) continue;
      if (hol.has(iso)) { const h = { iso, d, name: hol.get(iso) }; pendingSkip.push(h); skippedInMonth.push(h); continue; }
      cols.push({ iso, d, w, skippedBefore: pendingSkip });
      pendingSkip = [];
    }
    return { cols, skippedInMonth };
  }

  /* =========================================================
   * 4) State, การแปลงข้อมูลเวอร์ชันเก่า และ LocalStorage
   *    day = { attend, tasks:[{s,t,from?,to?}×5], assigns:[{id,t,done,due?,to?}], remark }
   *    attend = การมาทำงานของวัน ('' | office | wfa | leave | off)
   *    from   = ที่มาของ Task (ยกมาจาก Task อื่น หรือมาจากงานมอบหมาย)
   *    to     = Task ปลายทางที่ถูกยกไป
   * ========================================================= */
  let state = { days: {}, holidays: [] };
  let view = (() => { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth() + 1 }; })();
  let cols = [];

  const blankTask = () => ({ s: '', t: '' });
  const blankDay = () => ({ attend: '', tasks: Array.from({ length: N_TASKS }, blankTask), assigns: [], remark: '' });

  // เวอร์ชัน 1 มี 4 สถานะ: แยก "–" เป็น ลา/WFA/ไม่มีงาน และ "✗" เป็น ไม่เสร็จ/ยกเลิก โดยดูจากข้อความ
  function migrateStatus(s, text) {
    if (s === '–') {
      if (/\bWF[AH]\b/i.test(text)) return '⌂';
      if (/^\s*ลา/.test(text)) return '○';
      return '–';
    }
    if (s === '✗' && /ยกเลิก|ไม่ต้อง/.test(text)) return '⊘';
    return s;
  }
  // เวอร์ชัน 1 เก็บงานมอบหมายรวมในข้อความ Remark: ดึงบรรทัดใต้หัวข้อ Assignment: / การบ้าน > ออกมาเป็นรายการ
  const AS_HEAD = /^\s*(assignment|การบ้าน|งานมอบหมาย)\s*[:>]\s*(.*)$/i;
  const cleanItem = s => s.replace(/^\s*'?\s*[-•*]\s*/, '').trim();
  function splitRemark(text) {
    const lines = text.split('\n'), keep = [], items = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(AS_HEAD);
      if (!m) { keep.push(lines[i]); continue; }
      if (m[2].trim()) items.push(cleanItem(m[2]));
      let j = i + 1;
      for (; j < lines.length && lines[j].trim() !== ''; j++) items.push(cleanItem(lines[j]));
      i = j - 1;
    }
    if (!items.length) return { remark: text, items };
    return { remark: keep.join('\n').replace(/^\n+|\n+$/g, ''), items: items.filter(Boolean) };
  }

  function normFrom(o) {
    if (!o || !isISO(o.date)) return undefined;
    if (o.kind === 'task' && Number.isInteger(o.row) && o.row >= 0 && o.row < N_TASKS) return { kind: 'task', date: o.date, row: o.row };
    if (o.kind === 'assign' && typeof o.id === 'string') return { kind: 'assign', date: o.date, id: o.id };
    return undefined;
  }
  const normTo = o => (o && isISO(o.date) && Number.isInteger(o.row) && o.row >= 0 && o.row < N_TASKS) ? { date: o.date, row: o.row } : undefined;

  // เวอร์ชัน 1–2 ใช้ดร็อปดาวน์เดียวกันทั้ง "สถานะงาน" และ "การมาทำงาน" จึงมักมีช่อง Task ที่พิมพ์แค่ "WFA" / "ลา"
  // เวอร์ชัน 3 ย้ายค่าเหล่านี้ไปเป็นการมาทำงานของวัน แล้วคืนช่อง Task นั้นให้ใช้กับงานจริง
  const OLD_ATTEND = { '○': 'leave', '⌂': 'wfa', '–': 'off' };
  const ATTEND_WORD = /^(WF[AH]|ลา|ไม่มีงาน|-|–)$/i;                 // ป้ายล้วน → ลบทิ้งได้
  const ATTEND_LINE = /^(WF[AHO]\b|Work\s*from|ลา)[^\n]{0,40}$/i;   // ป้ายพร้อมรายละเอียด เช่น "ลาป่วย" → ย้ายไปไว้ในโน้ต
  const pickAttend = (cur, k) => (!cur || cur === 'off') ? k : cur; // ลา/WFA สำคัญกว่า "ไม่มีงาน"

  function normDay(raw, ver) {
    const day = blankDay();
    if (!raw) return { day };
    if (ver >= 3 && ATTEND_OF[raw.attend]) day.attend = raw.attend;
    const removed = new Set(), notes = [];
    if (Array.isArray(raw.tasks)) raw.tasks.slice(0, N_TASKS).forEach((t, i) => {
      if (!t) return;
      const text = typeof t.t === 'string' ? t.t : '';
      let s = typeof t.s === 'string' ? t.s : '';
      if (ver < 2) s = migrateStatus(s, text);
      if (ver < 3 && OLD_ATTEND[s]) {
        const k = OLD_ATTEND[s], tx = text.trim();
        const marker = !tx || ATTEND_WORD.test(tx) || (k !== 'off' && ATTEND_LINE.test(tx));
        s = '';
        if (k !== 'off' || marker) day.attend = pickAttend(day.attend, k);
        if (marker) {                       // ช่องนี้ใช้แค่บอกการมาทำงาน → เอาออกจาก Task
          if (tx && !ATTEND_WORD.test(tx)) notes.push(tx);
          removed.add(i);
          return;
        }
      }
      const task = { s: KEY_OF[s] ? s : '', t: text };
      const from = normFrom(t.from), to = normTo(t.to);
      if (from) task.from = from;
      if (to) task.to = to;
      day.tasks[i] = task;
    });
    // เลื่อน Task ที่เหลือขึ้นมาแทนช่องที่เอาออก (จดตำแหน่งใหม่ไว้แก้ลิงก์ใน normState)
    let rowMap;
    if (removed.size) {
      rowMap = [];
      const kept = [];
      day.tasks.forEach((t, i) => { if (removed.has(i)) rowMap[i] = null; else { rowMap[i] = kept.length; kept.push(t); } });
      while (kept.length < N_TASKS) kept.push(blankTask());
      day.tasks = kept;
    }
    if (Array.isArray(raw.assigns)) day.assigns = raw.assigns
      .filter(a => a && typeof a.t === 'string')
      .map(a => {
        const o = { id: typeof a.id === 'string' ? a.id : uid(), t: a.t, done: !!a.done };
        if (isISO(a.due)) o.due = a.due;
        const to = normTo(a.to); if (to) o.to = to;
        return o;
      });
    if (typeof raw.remark === 'string') {
      if (ver < 2) {
        const sp = splitRemark(raw.remark);
        day.remark = sp.remark;
        sp.items.forEach(t => day.assigns.push({ id: uid(), t, done: false }));
      } else day.remark = raw.remark;
    }
    if (notes.length) day.remark = notes.join('\n') + (day.remark ? '\n' + day.remark : '');
    return { day, rowMap };
  }
  // แก้ลิงก์ "ทำต่อ / ที่มา" ที่ชี้ไปยังช่อง Task ซึ่งถูกเลื่อนตำแหน่งระหว่างแปลงข้อมูล
  function remapRows(days, shifted) {
    const fix = p => {
      const m = p && shifted[p.date];
      if (!m || !Number.isInteger(p.row)) return p;
      return m[p.row] == null ? undefined : { ...p, row: m[p.row] };
    };
    Object.values(days).forEach(day => {
      day.tasks.forEach(t => {
        if (t.from && t.from.kind === 'task') { const f = fix(t.from); if (f) t.from = f; else delete t.from; }
        if (t.to) { const to = fix(t.to); if (to) t.to = to; else delete t.to; }
      });
      day.assigns.forEach(a => { if (a.to) { const to = fix(a.to); if (to) a.to = to; else delete a.to; } });
    });
  }
  function normState(raw) {
    if (!raw || typeof raw !== 'object' || !raw.days || typeof raw.days !== 'object') throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');
    const ver = Number(raw.version) || 1;   // ไฟล์รุ่นแรกไม่มีเลขเวอร์ชัน
    const days = {}, shifted = {};
    for (const [k, v] of Object.entries(raw.days)) {
      if (!isISO(k)) continue;
      const r = normDay(v, ver);
      days[k] = r.day;
      if (r.rowMap) shifted[k] = r.rowMap;
    }
    if (Object.keys(shifted).length) remapRows(days, shifted);
    const holidays = (Array.isArray(raw.holidays) ? raw.holidays : [])
      .filter(h => h && isISO(h.date))
      .map(h => ({ date: h.date, name: String(h.name || '') }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { days, holidays };
  }
  const ensureDay = iso => (state.days[iso] ||= blankDay());
  const dayHasData = d => !!d && (d.attend !== '' || d.remark !== '' || d.assigns.length > 0 || d.tasks.some(t => t.s !== '' || t.t !== ''));
  const hasAnyData = () => Object.values(state.days).some(dayHasData);
  const findAssign = (iso, id) => state.days[iso]?.assigns.find(a => a.id === id);

  function snapshot() {
    const days = {};
    Object.keys(state.days).sort().forEach(k => { if (dayHasData(state.days[k])) days[k] = state.days[k]; });
    return { app: 'NWL Task', version: DATA_VERSION, savedAt: new Date().toISOString(), days, holidays: state.holidays };
  }

  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORE_KEY);
      if (!raw) for (const k of OLD_KEYS) { raw = localStorage.getItem(k); if (raw) break; }  // ข้อมูลจากเวอร์ชันก่อน
    } catch (e) { /* storage ถูกบล็อก */ }
    if (raw) { try { state = normState(JSON.parse(raw)); saveNow(); return; } catch (e) { /* ข้อมูลเสีย → เริ่มว่าง */ } }
    state = { days: {}, holidays: [] };   // เปิดครั้งแรก → ตารางว่าง (นำเข้าไฟล์สำรองได้ที่ปุ่ม "ข้อมูล")
  }

  let saveTimer = null;
  function save() { setSaveStatus('pending'); clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); }
  function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(snapshot())); setSaveStatus('saved'); }
    catch (e) { setSaveStatus('error'); }
  }
  function setSaveStatus(st) {
    const box = $('#save-status'), txt = $('#save-text');
    box.dataset.state = st;
    if (st === 'pending') txt.textContent = 'กำลังบันทึก…';
    else if (st === 'error') txt.textContent = 'บันทึกไม่ได้ — เบราว์เซอร์ไม่อนุญาตให้เก็บข้อมูล';
    else { const t = new Date(); txt.textContent = `บันทึกอัตโนมัติแล้ว ${pad(t.getHours())}:${pad(t.getMinutes())}`; }
  }
  window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) saveNow(); });

  /* =========================================================
   * 5) ลิงก์ระหว่างงาน: ยกไปแล้วหรือยัง / หางานมอบหมายต้นทาง
   * ========================================================= */
  function taskCarried(iso, row) {
    const t = state.days[iso]?.tasks[row];
    if (!t || !t.to) return false;
    const g = state.days[t.to.date]?.tasks[t.to.row];
    return !!(g && g.from && g.from.kind === 'task' && g.from.date === iso && g.from.row === row && g.t.trim() !== '');
  }
  function assignSent(iso, a) {
    if (!a || !a.to) return false;
    const g = state.days[a.to.date]?.tasks[a.to.row];
    return !!(g && g.from && g.from.kind === 'assign' && g.from.date === iso && g.from.id === a.id && g.t.trim() !== '');
  }
  // ไล่ย้อนสาย "ต่อจาก" ไปจนเจองานมอบหมายต้นทาง (ถ้ามี)
  function rootAssign(task) {
    let cur = task, n = 0;
    while (cur && cur.from && n++ < 60) {
      const f = cur.from;
      if (f.kind === 'assign') return { iso: f.date, a: findAssign(f.date, f.id) };
      cur = state.days[f.date]?.tasks[f.row];
    }
    return null;
  }
  // หาช่อง Task ว่างช่องแรก เริ่มจากวันที่กำหนด (ถ้าเต็มทั้ง 5 ช่อง เลื่อนไปวันทำงานถัดไป)
  function placeTask(startIso, task) {
    let d = startIso;
    for (let i = 0; i < 90; i++) {
      const day = ensureDay(d);
      const row = day.tasks.findIndex(t => t.t.trim() === '' && !t.s);
      if (row >= 0) { day.tasks[row] = task; return { date: d, row }; }
      d = nextWorkday(d);
    }
    return null;
  }

  function carryTask(iso, row, start) {
    const src = state.days[iso].tasks[row];
    const pos = placeTask(start || carryTarget(iso), { s: '◐', t: src.t, from: { kind: 'task', date: iso, row } });
    if (!pos) { toast('ไม่พบช่อง Task ว่างในช่วงถัดไป'); return null; }
    src.to = pos;
    saveNow();
    return pos;
  }
  function sendAssign(iso, id, start) {
    const a = findAssign(iso, id);
    if (!a) return null;
    const pos = placeTask(start || carryTarget(iso), { s: '◐', t: a.t, from: { kind: 'assign', date: iso, id } });
    if (!pos) { toast('ไม่พบช่อง Task ว่างในช่วงถัดไป'); return null; }
    a.to = pos;
    saveNow();
    return pos;
  }
  // เปลี่ยนสถานะ Task + ติ๊กงานมอบหมายต้นทางให้อัตโนมัติเมื่อขึ้น ✓
  function setStatus(iso, row, s) {
    const t = ensureDay(iso).tasks[row];
    const old = t.s;
    t.s = s;
    if (s === '✓' || old === '✓') {
      const r = rootAssign(t);
      if (r && r.a) { r.a.done = s === '✓'; return r; }
    }
    return null;
  }

  // ต้นทางของงานที่ยกมา (Task เดิม หรือ งานมอบหมาย)
  const sourceOf = f => !f ? null : (f.kind === 'task' ? state.days[f.date]?.tasks[f.row] : findAssign(f.date, f.id));

  // ลบงานที่ยกมา (ช่องปลายทาง) แล้วคืนสถานะ "ยังไม่ได้ยก" ให้ต้นทาง
  // ถ้างานนี้ถูกยกต่อไปอีกทอด จะต่อสายจากต้นทางไปยังทอดถัดไปให้เลย
  function unlinkCopy(iso, row) {
    const day = state.days[iso], t = day && day.tasks[row];
    if (!t || !t.from) return null;
    const f = t.from, src = sourceOf(f);
    const next = taskCarried(iso, row) ? { ...t.to } : null;
    const snap = { iso, row, task: JSON.parse(JSON.stringify(t)), next, nextFrom: null };
    if (src) { if (next) src.to = { ...next }; else delete src.to; }
    if (next) {
      const n = state.days[next.date].tasks[next.row];
      snap.nextFrom = { ...n.from };
      n.from = { ...f };
    }
    day.tasks[row] = blankTask();
    saveNow();
    return snap;
  }
  function restoreCopy(snap) {
    const day = ensureDay(snap.iso), cur = day.tasks[snap.row];
    if (cur.t.trim() || cur.s) { toast('เลิกทำไม่ได้ เพราะช่องเดิมมีงานอื่นแล้ว'); return; }
    day.tasks[snap.row] = snap.task;
    const src = sourceOf(snap.task.from);
    if (src) src.to = { date: snap.iso, row: snap.row };
    if (snap.next) { const n = state.days[snap.next.date]?.tasks[snap.next.row]; if (n) n.from = snap.nextFrom; }
    saveNow();
  }
  // ย้ายงานที่ยกมาไปวันอื่น (ถ้าเลือกวันหยุด/เสาร์-อาทิตย์ จะเลื่อนไปวันทำงานถัดไป)
  function moveCopy(iso, row, wanted) {
    const day = state.days[iso], t = day && day.tasks[row];
    if (!t || !isISO(wanted)) return null;
    const target = workdayOnOrAfter(wanted);
    day.tasks[row] = blankTask();
    const pos = placeTask(target, t);
    if (!pos) { day.tasks[row] = t; toast('ไม่พบช่อง Task ว่างในช่วงนั้น'); return null; }
    const src = sourceOf(t.from);
    if (src && src.to && src.to.date === iso && src.to.row === row) src.to = { ...pos };
    if (t.to) {
      const n = state.days[t.to.date]?.tasks[t.to.row];
      if (n && n.from && n.from.kind === 'task' && n.from.date === iso && n.from.row === row) n.from = { kind: 'task', date: pos.date, row: pos.row };
    }
    saveNow();
    return { pos, shifted: target !== wanted };
  }
  // ถ้าช่องถูกลบจนว่างเอง (ไม่มีข้อความและสถานะ) ให้ตัดลิงก์ทิ้งด้วย
  function tidySlot(iso, row) {
    const t = state.days[iso]?.tasks[row];
    if (!t || t.t !== '' || t.s || (!t.from && !t.to)) return;
    const f = t.from;
    delete t.from; delete t.to;
    updateLinks(iso, row);
    if (f) updateSourceOf({ from: f });
  }

  /* =========================================================
   * 6) สรุปวันนี้: [จำนวน ✓] / [จำนวน Task ที่มีข้อความ] เสร็จ (สูตรเดียวกับ Excel)
   * ========================================================= */
  function daySummary(iso) {
    const day = state.days[iso];
    const filled = day ? day.tasks.filter(t => t.t.trim() !== '') : [];
    if (!filled.length) return { text: '-', done: 0, total: 0 };
    const done = filled.filter(t => t.s === '✓').length;
    return { text: `${done} / ${filled.length} เสร็จ`, done, total: filled.length };
  }
  function sumHTML(iso) {
    const s = daySummary(iso);
    const cls = s.total === 0 ? ' empty' : (s.done === s.total ? ' full' : '');
    const bar = s.total ? `<span class="sum-bar" aria-hidden="true"><i style="width:${Math.round(s.done / s.total * 100)}%"></i></span>` : '';
    return `<div class="sum-in"><span class="sum-text${cls}">${s.text}</span>${bar}</div>`;
  }

  /* =========================================================
   * 7) วาดตาราง
   * ========================================================= */
  function statusOptions(cur) {
    return `<option value=""${cur === '' ? ' selected' : ''}>สถานะงาน</option>` + STATUSES
      .map(s => `<option value="${s.sym}"${s.sym === cur ? ' selected' : ''}>${s.sym}  ${s.label}</option>`).join('');
  }
  function attendOptions(cur) {
    return `<option value=""${cur === '' ? ' selected' : ''}>ระบุการมาทำงาน</option>` + ATTENDS
      .map(a => `<option value="${a.k}"${a.k === cur ? ' selected' : ''}>${a.sym}  ${a.label}</option>`).join('');
  }
  // ป้ายเล็กบนหัววันที่ (หัวตารางติดบน จึงเห็นการมาทำงานตลอดแม้เลื่อนลง)
  function attendTagHTML(iso) {
    const a = ATTEND_OF[state.days[iso]?.attend];
    return `<span class="att-tag" id="ah-${iso}"${a ? ` data-k="${a.k}"` : ' hidden'}>${a ? `${a.sym} ${a.short}` : ''}</span>`;
  }

  function linkHTML(iso, row) {
    const t = state.days[iso]?.tasks[row];
    if (!t) return '';
    let h = '';
    if (t.from && t.t.trim()) {
      const f = t.from;
      h += f.kind === 'assign'
        ? `<button type="button" class="lk jump" data-go="${f.date}" data-assign="${f.id}">↩ จากงานมอบหมาย ${fmtShort(f.date)}</button>`
        : `<button type="button" class="lk jump" data-go="${f.date}" data-row="${f.row}">↩ ต่อจาก ${fmtShort(f.date)}</button>`;
      h += `<button type="button" class="lk tool" data-move="${iso}" data-row="${row}" title="ย้ายงานนี้ไปวันอื่น">ย้ายวัน</button>`;
      h += `<button type="button" class="lk tool del" data-unlink="${iso}" data-row="${row}" title="ลบงานที่ยกมานี้ ต้นทางจะกลับเป็นงานค้าง">× ลบ</button>`;
    }
    if (taskCarried(iso, row)) {
      h += `<button type="button" class="lk jump done" data-go="${t.to.date}" data-row="${t.to.row}">↪ ยกไป ${fmtShort(t.to.date)} แล้ว</button>`;
      h += `<button type="button" class="lk tool del" data-unlink="${t.to.date}" data-row="${t.to.row}" title="ลบงานที่ยกไปวันที่ ${fmtShort(t.to.date)} แล้วกลับมาเป็นงานค้างที่นี่">เลิกยก</button>`;
    } else if (OPEN.has(t.s) && t.t.trim()) {
      h += `<button type="button" class="lk carry" data-carry="${iso}" data-row="${row}">↪ ทำต่อ ${fmtShort(carryTarget(iso))}</button>`;
    }
    return h;
  }

  function assignMetaHTML(iso, a) {
    const today = todayISO();
    let h = '';
    if (a.due) h += `<span class="due${!a.done && a.due < today ? ' late' : ''}">กำหนดส่ง ${fmtShort(a.due)}</span>`;
    if (assignSent(iso, a)) {
      h += `<button type="button" class="lk jump done" data-go="${a.to.date}" data-row="${a.to.row}">→ อยู่ใน Task ${fmtShort(a.to.date)}</button>`;
      h += `<button type="button" class="lk tool del" data-unlink="${a.to.date}" data-row="${a.to.row}" title="ลบ Task ที่ส่งไปวันที่ ${fmtShort(a.to.date)}">เลิกส่ง</button>`;
    }
    else if (!a.done) h += `<button type="button" class="lk carry as-send" data-date="${iso}" data-id="${a.id}">→ ลง Task ${fmtShort(carryTarget(iso))}</button>`;
    h += `<label class="as-duefield">ส่ง <input type="date" class="as-due" id="ad-${iso}-${a.id}" data-date="${iso}" data-id="${a.id}" value="${a.due || ''}" aria-label="กำหนดส่ง"></label>`;
    h += `<button type="button" class="lk as-del" data-date="${iso}" data-id="${a.id}" aria-label="ลบงานมอบหมายนี้">ลบ</button>`;
    return h;
  }
  function assignHTML(iso, a) {
    return `<li class="as${a.done ? ' is-done' : ''}" data-id="${a.id}">
      <input type="checkbox" class="as-check" id="ac-${iso}-${a.id}" data-date="${iso}" data-id="${a.id}"${a.done ? ' checked' : ''} aria-label="ทำแล้ว">
      <div class="min-w-0">
        <textarea class="as-text" id="at-${iso}-${a.id}" data-date="${iso}" data-id="${a.id}" rows="1" aria-label="งานมอบหมาย วันที่ ${iso}"></textarea>
        <div class="as-meta" id="am-${iso}-${a.id}">${assignMetaHTML(iso, a)}</div>
      </div>
    </li>`;
  }
  function assignCount(iso) {
    const as = state.days[iso]?.assigns || [];
    return as.length ? `<b>${as.filter(a => a.done).length}/${as.length}</b>` : '';
  }

  function render() {
    const { y, m } = view;
    const res = monthColumns(y, m);
    cols = res.cols;
    const today = todayISO();

    $('#month-title').textContent = `${TH_MONTHS[m - 1]} ${y + 543}`;
    $('#month-sub').textContent = `${EN_MON_S[m - 1]} ${y}`;
    $('#month-pick').value = `${y}-${pad(m)}`;

    let prevW = 9;
    const colCls = cols.map((c, i) => {
      const cls = [];
      if (i > 0 && c.w <= prevW) cls.push('wk');
      if (c.iso === today) cls.push('today');
      prevW = c.w;
      return cls.join(' ');
    });

    let html = '<thead><tr><th class="corner" scope="col"><span class="eyebrow">วันที่</span></th>';
    cols.forEach((c, i) => {
      const isToday = c.iso === today;
      const skip = c.skippedBefore.length
        ? `<div class="skip" title="${esc(c.skippedBefore.map(s => `${s.iso} ${s.name}`).join(', '))}">ข้าม ${c.skippedBefore.map(s => `${s.d} ${TH_MON_S[m - 1]} ${esc(s.name)}`).join(', ')}</div>`
        : '';
      html += `<th scope="col" class="day ${colCls[i]}" data-date="${c.iso}">
        <div class="dow">${TH_DOW[c.w]}${isToday ? '<span class="today-tag">วันนี้</span>' : ''}${attendTagHTML(c.iso)}</div>
        <div class="dnum">${c.d}<span>${TH_MON_S[m - 1]}</span></div>
        <div class="diso">${c.iso}</div>${skip}</th>`;
    });
    html += '</tr></thead><tbody>';

    // แถวการมาทำงาน (1 ค่าต่อวัน) — แยกจากสถานะงานของแต่ละ Task
    html += '<tr class="attend-row"><th scope="row" class="rowlab">การมาทำงาน<small>ออฟฟิศ / WFA / ลา</small></th>';
    cols.forEach((c, i) => {
      const a = state.days[c.iso]?.attend || '';
      html += `<td class="cell ${colCls[i]}"><div class="cell-in">
        <span class="sel att" data-k="${a || 'none'}"><select class="attend" id="w-${c.iso}" data-date="${c.iso}" aria-label="การมาทำงาน วันที่ ${c.iso}">${attendOptions(a)}</select></span>
      </div></td>`;
    });
    html += '</tr>';

    for (let r = 0; r < N_TASKS; r++) {
      html += `<tr class="task-row"><th scope="row" class="rowlab">Task ${r + 1}</th>`;
      cols.forEach((c, i) => {
        const s = state.days[c.iso]?.tasks[r]?.s || '';
        html += `<td class="cell ${colCls[i]}"><div class="cell-in">
          <span class="sel" data-k="${KEY_OF[s] || 'none'}"><select class="status" id="s-${c.iso}-${r}" data-date="${c.iso}" data-row="${r}" aria-label="สถานะงาน Task ${r + 1} วันที่ ${c.iso}">${statusOptions(s)}</select></span>
          <div class="note-wrap"><textarea class="note" id="t-${c.iso}-${r}" data-date="${c.iso}" data-row="${r}" rows="2" placeholder="+ พิมพ์งาน" aria-label="Task ${r + 1} วันที่ ${c.iso}"></textarea></div>
          <div class="links" id="lk-${c.iso}-${r}">${linkHTML(c.iso, r)}</div>
        </div></td>`;
      });
      html += '</tr>';
    }

    html += '<tr class="remark-row"><th scope="row" class="rowlab">Remark/ Assignment<small>งานมอบหมาย (ติ๊กได้) และโน้ตประจำวัน</small></th>';
    cols.forEach((c, i) => {
      const as = state.days[c.iso]?.assigns || [];
      html += `<td class="cell ${colCls[i]}"><div class="cell-in">
        <div class="sec-label" id="ac-count-${c.iso}">งานมอบหมาย ${assignCount(c.iso)}</div>
        ${as.length ? `<ul class="assigns">${as.map(a => assignHTML(c.iso, a)).join('')}</ul>` : ''}
        <input type="text" class="as-add" id="aa-${c.iso}" data-date="${c.iso}" placeholder="+ เพิ่มงานมอบหมาย แล้วกด Enter" aria-label="เพิ่มงานมอบหมาย วันที่ ${c.iso}">
        <div class="sec-label">โน้ต</div>
        <div class="note-wrap"><textarea class="note remark" id="r-${c.iso}" data-date="${c.iso}" data-field="remark" rows="3" placeholder="+ โน้ต / สรุปประชุม" aria-label="โน้ต วันที่ ${c.iso}"></textarea></div>
      </div></td>`;
    });
    html += '</tr><tr class="sum-row"><th scope="row" class="rowlab">สรุปวันนี้</th>';
    cols.forEach((c, i) => { html += `<td class="sum ${colCls[i]}" data-date="${c.iso}">${sumHTML(c.iso)}</td>`; });
    html += '</tr></tbody>';

    grid.innerHTML = html;

    // ใส่ข้อความผ่าน .value (รักษาบรรทัดว่าง/ช่องว่างได้ครบตามต้นฉบับ)
    grid.querySelectorAll('textarea.note').forEach(el => {
      const day = state.days[el.dataset.date];
      if (!day) return;
      el.value = el.dataset.field === 'remark' ? day.remark : day.tasks[+el.dataset.row].t;
    });
    grid.querySelectorAll('textarea.as-text').forEach(el => {
      const a = findAssign(el.dataset.date, el.dataset.id);
      if (a) el.value = a.t;
    });

    renderStats(res.skippedInMonth);
    autosizeAll();
    updateBadge();
    updateEmptyHint();
  }
  // แถบแนะนำตอนยังไม่มีข้อมูลเลย (เช่น เปิดเว็บครั้งแรกบนโดเมนใหม่)
  function updateEmptyHint() { $('#empty-hint').hidden = hasAnyData(); }

  // วาดใหม่ทั้งเดือน โดยคงตำแหน่งเลื่อนและโฟกัสไว้
  function refresh(focusId) {
    const sl = wrap.scrollLeft, st = wrap.scrollTop;
    render();
    wrap.scrollLeft = sl; wrap.scrollTop = st;
    if (focusId) { const el = document.getElementById(focusId); if (el) el.focus({ preventScroll: true }); }
    if ($('#dlg-backlog').open) renderBacklog();
  }

  // สรุปทั้งเดือน (แถบด้านบน)
  let lastSkipped = [];
  function renderStats(skipped) {
    if (skipped) lastSkipped = skipped;
    const cnt = Object.fromEntries(STATUSES.map(s => [s.k, 0])); cnt.none = 0;
    const att = Object.fromEntries(ATTENDS.map(a => [a.k, 0]));
    let total = 0;
    cols.forEach(c => {
      const d = state.days[c.iso];
      if (!d) return;
      if (d.attend) att[d.attend]++;
      d.tasks.forEach(t => { if (t.t.trim() === '') return; total++; cnt[KEY_OF[t.s] || 'none']++; });
    });
    const pct = total ? Math.round(cnt.done / total * 100) : 0;
    let html = `<span class="chip"><b>${cols.length}</b> วันทำงาน</span>`;
    lastSkipped.forEach(h => { html += `<span class="chip hol" title="${h.iso}">หยุด ${h.d} ${TH_MON_S[view.m - 1]} · ${esc(h.name)}</span>`; });
    html += `<span class="chip"><b>${total}</b> งานที่บันทึก</span>`;
    html += `<span class="chip" title="สัดส่วนงานที่ขึ้น ✓"><span class="meter" aria-hidden="true"><i style="width:${pct}%"></i></span><b>${pct}%</b></span>`;
    STATUSES.forEach(s => {
      if (s.k !== 'done' && !cnt[s.k]) return;
      html += `<span class="chip" data-k="${s.k}" title="${s.label}">${s.sym} <span class="lbl">${s.label}</span> <b>${cnt[s.k]}</b></span>`;
    });
    if (cnt.none) html += `<span class="chip" title="มีข้อความแต่ยังไม่เลือกสถานะ">ยังไม่ระบุสถานะ <b>${cnt.none}</b></span>`;
    const attHTML = ATTENDS.filter(a => att[a.k])
      .map(a => `<span class="chip" data-k="${a.k}" title="${a.label}">${a.sym} <span class="lbl">${a.short}</span> <b>${att[a.k]}</b> วัน</span>`).join('');
    if (attHTML) html += `<span class="stat-sep" aria-hidden="true"></span><span class="stat-lab">การมาทำงาน</span>${attHTML}`;
    $('#month-stats').innerHTML = html;
  }

  const updateSummary = iso => { const td = grid.querySelector(`td.sum[data-date="${iso}"]`); if (td) td.innerHTML = sumHTML(iso); };
  const updateLinks = (iso, row) => { const el = document.getElementById(`lk-${iso}-${row}`); if (el) el.innerHTML = linkHTML(iso, row); };
  function updateAssignUI(iso, a) {
    const cb = document.getElementById(`ac-${iso}-${a.id}`);
    if (cb) { cb.checked = a.done; cb.closest('li').classList.toggle('is-done', a.done); }
    const meta = document.getElementById(`am-${iso}-${a.id}`);
    if (meta && !meta.contains(document.activeElement)) meta.innerHTML = assignMetaHTML(iso, a);
    const cnt = document.getElementById(`ac-count-${iso}`);
    if (cnt) cnt.innerHTML = `งานมอบหมาย ${assignCount(iso)}`;
  }
  // เมื่อ Task เปลี่ยน อัปเดตลิงก์ของต้นทางด้วย (ปุ่ม "ทำต่อ" อาจกลับมา ถ้าลบข้อความปลายทาง)
  function updateSourceOf(task) {
    const f = task && task.from;
    if (!f) return;
    if (f.kind === 'task') updateLinks(f.date, f.row);
    else { const a = findAssign(f.date, f.id); if (a) updateAssignUI(f.date, a); }
  }

  /* =========================================================
   * 8) ช่องข้อความขยายตามเนื้อหา
   * ========================================================= */
  function maxFor(el) {
    if (el === document.activeElement) return Math.max(260, Math.round(window.innerHeight * 0.6));
    if (el.classList.contains('as-text')) return 110;
    return el.dataset.field === 'remark' ? 180 : 132;
  }
  function autosize(el) {
    el.style.height = 'auto';
    const h = el.scrollHeight + 2, max = maxFor(el);
    el.style.height = Math.min(h, max) + 'px';
    el.classList.toggle('clipped', h > max);
  }
  function autosizeAll() {
    const els = [...grid.querySelectorAll('textarea')];
    els.forEach(el => { el.style.height = 'auto'; });
    const hs = els.map(el => el.scrollHeight + 2);
    els.forEach((el, i) => {
      const max = maxFor(el);
      el.style.height = Math.min(hs[i], max) + 'px';
      el.classList.toggle('clipped', hs[i] > max);
    });
  }

  /* =========================================================
   * 9) Event ในตาราง
   * ========================================================= */
  function afterChange(iso) { updateSummary(iso); renderStats(); updateBadge(); updateEmptyHint(); save(); }

  grid.addEventListener('change', e => {
    const el = e.target;
    if (el.matches('select.attend')) {
      const iso = el.dataset.date;
      ensureDay(iso).attend = ATTEND_OF[el.value] ? el.value : '';
      el.parentElement.dataset.k = el.value || 'none';
      const tag = document.getElementById(`ah-${iso}`);
      if (tag) tag.outerHTML = attendTagHTML(iso);
      afterChange(iso);
    } else if (el.matches('select.status')) {
      const iso = el.dataset.date, row = +el.dataset.row;
      const r = setStatus(iso, row, el.value);
      el.parentElement.dataset.k = KEY_OF[el.value] || 'none';
      updateLinks(iso, row);
      tidySlot(iso, row);
      if (r && r.a) updateAssignUI(r.iso, r.a);
      afterChange(iso);
    } else if (el.classList.contains('as-check')) {
      const a = findAssign(el.dataset.date, el.dataset.id);
      if (!a) return;
      a.done = el.checked;
      updateAssignUI(el.dataset.date, a);
      afterChange(el.dataset.date);
    } else if (el.classList.contains('as-due')) {
      const a = findAssign(el.dataset.date, el.dataset.id);
      if (!a) return;
      if (isISO(el.value)) a.due = el.value; else delete a.due;
      const meta = document.getElementById(`am-${el.dataset.date}-${a.id}`);
      const due = meta && meta.querySelector('.due');
      const html = a.due ? `<span class="due${!a.done && a.due < todayISO() ? ' late' : ''}">กำหนดส่ง ${fmtShort(a.due)}</span>` : '';
      if (due) due.outerHTML = html || '<span hidden></span>';
      else if (meta && html) meta.insertAdjacentHTML('afterbegin', html);
      afterChange(el.dataset.date);
    }
  });

  grid.addEventListener('input', e => {
    const el = e.target;
    if (el.matches('textarea.note')) {
      const iso = el.dataset.date, day = ensureDay(iso);
      if (el.dataset.field === 'remark') day.remark = el.value;
      else {
        const row = +el.dataset.row;
        day.tasks[row].t = el.value;
        updateLinks(iso, row);
        updateSourceOf(day.tasks[row]);
        tidySlot(iso, row);
      }
      autosize(el);
      afterChange(iso);
    } else if (el.matches('textarea.as-text')) {
      const a = findAssign(el.dataset.date, el.dataset.id);
      if (!a) return;
      a.t = el.value;
      autosize(el);
      save();
    }
  });

  grid.addEventListener('keydown', e => {
    const el = e.target;
    if (!el.classList.contains('as-add') || e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const text = el.value.trim();
    if (!text) return;
    const iso = el.dataset.date;
    ensureDay(iso).assigns.push({ id: uid(), t: text, done: false });
    saveNow();
    refresh(`aa-${iso}`);
  });

  grid.addEventListener('focusin', e => { if (e.target.tagName === 'TEXTAREA') autosize(e.target); });
  grid.addEventListener('focusout', e => {
    const el = e.target;
    if (el.tagName !== 'TEXTAREA') return;
    setTimeout(() => { autosize(el); el.scrollTop = 0; }, 0);
    // ลบงานมอบหมายที่ข้อความว่าง
    if (el.classList.contains('as-text') && el.value.trim() === '') {
      const iso = el.dataset.date, day = state.days[iso];
      if (!day) return;
      day.assigns = day.assigns.filter(a => a.id !== el.dataset.id);
      el.closest('li').remove();
      const cnt = document.getElementById(`ac-count-${iso}`);
      if (cnt) cnt.innerHTML = `งานมอบหมาย ${assignCount(iso)}`;
      updateBadge(); saveNow();
    }
  });

  grid.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.carry) {
      const pos = carryTask(b.dataset.carry, +b.dataset.row);
      if (pos) { refresh(); toastPlaced(`ยกไป Task ${pos.row + 1} วันที่ ${fmtShort(pos.date)} แล้ว`, pos); }
    } else if (b.classList.contains('as-send')) {
      const pos = sendAssign(b.dataset.date, b.dataset.id);
      if (pos) { refresh(); toastPlaced(`ลง Task ${pos.row + 1} วันที่ ${fmtShort(pos.date)} แล้ว`, pos); }
    } else if (b.dataset.unlink) {
      // ลบงานที่ยกมา / เลิกยก / เลิกส่ง
      const snap = unlinkCopy(b.dataset.unlink, +b.dataset.row);
      if (snap) {
        refresh();
        toast(`ลบงานที่ยกไปวันที่ ${fmtShort(snap.iso)} แล้ว`, [{ label: 'เลิกทำ', fn: () => { restoreCopy(snap); refresh(); } }]);
      }
    } else if (b.dataset.move) {
      // เปิดช่องเลือกวันที่ใหม่ในช่องนั้น
      const iso = b.dataset.move, row = +b.dataset.row;
      const slot = document.getElementById(`lk-${iso}-${row}`);
      slot.innerHTML = `<div class="move-box"><span>ย้ายไป</span>
        <input type="date" class="move-date" id="mv-${iso}-${row}" value="${iso}" aria-label="ย้ายไปวันที่">
        <button type="button" class="lk solid" data-domove="${iso}" data-row="${row}">ย้าย</button>
        <button type="button" class="lk" data-cancelmove="${iso}" data-row="${row}">ยกเลิก</button></div>`;
      const inp = document.getElementById(`mv-${iso}-${row}`);
      inp.focus();
      try { inp.showPicker && inp.showPicker(); } catch (err) { /* บางเบราว์เซอร์ไม่อนุญาต */ }
    } else if (b.dataset.domove) {
      const iso = b.dataset.domove, row = +b.dataset.row;
      const wanted = document.getElementById(`mv-${iso}-${row}`).value;
      if (!isISO(wanted)) { toast('เลือกวันที่ก่อน แล้วกด "ย้าย"'); return; }
      if (wanted === iso) { updateLinks(iso, row); return; }
      const res = moveCopy(iso, row, wanted);
      if (!res) return;
      refresh();
      const note = res.shifted ? ` (${fmtShort(wanted)} เป็นวันหยุด จึงเลื่อนไป ${fmtShort(res.pos.date)})` : '';
      toast(`ย้ายไป Task ${res.pos.row + 1} วันที่ ${fmtShort(res.pos.date)} แล้ว${note}`, [
        { label: 'ไปดู', fn: () => jumpTo(res.pos.date, { row: res.pos.row }) },
        { label: 'เลิกทำ', fn: () => { if (moveCopy(res.pos.date, res.pos.row, iso)) refresh(); } }
      ]);
    } else if (b.dataset.cancelmove) {
      updateLinks(b.dataset.cancelmove, +b.dataset.row);
    } else if (b.classList.contains('as-del')) {
      const iso = b.dataset.date, day = state.days[iso];
      const idx = day.assigns.findIndex(a => a.id === b.dataset.id);
      if (idx < 0) return;
      const [removed] = day.assigns.splice(idx, 1);
      saveNow(); refresh();
      toast('ลบงานมอบหมายแล้ว', [{ label: 'เลิกทำ', fn: () => { ensureDay(iso).assigns.splice(idx, 0, removed); saveNow(); refresh(); } }]);
    } else if (b.classList.contains('jump')) {
      jumpTo(b.dataset.go, b.dataset.row != null ? { row: +b.dataset.row } : { assign: b.dataset.assign });
    }
  });

  /* =========================================================
   * 10) เปลี่ยนเดือน / ไปวันที่ที่ต้องการ
   * ========================================================= */
  function scrollToDate(iso, center) {
    const th = grid.querySelector(`th.day[data-date="${iso}"]`);
    if (!th) { if (!center) wrap.scrollLeft = 0; return false; }
    const corner = grid.querySelector('th.corner').offsetWidth;
    const room = wrap.clientWidth - corner - th.offsetWidth;
    wrap.scrollLeft = Math.max(0, th.offsetLeft - corner - room * (center ? 0.5 : 0.75));
    return true;
  }
  function goMonth(y, m) {
    if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
    view = { y, m };
    render();
    wrap.scrollTop = 0;
    scrollToDate(todayISO());
  }
  // กระโดดไปยังช่องที่ระบุ แล้วกะพริบให้เห็น
  function jumpTo(iso, opt = {}) {
    const { y, m } = parseISO(iso);
    if (y !== view.y || m !== view.m) { view = { y, m }; render(); }
    if (!scrollToDate(iso, true)) { toast(`วันที่ ${fmtShort(iso)} ถูกซ่อนเพราะเป็นวันหยุด`); return; }
    let el = null;
    if (opt.row != null) el = document.getElementById(`t-${iso}-${opt.row}`);
    else if (opt.assign) el = document.getElementById(`at-${iso}-${opt.assign}`) || document.getElementById(`aa-${iso}`);
    else el = document.getElementById(`t-${iso}-0`);
    const td = el && el.closest('td');
    if (!td) return;
    const headH = grid.tHead ? grid.tHead.offsetHeight : 0;
    wrap.scrollTop = Math.max(0, td.offsetTop - headH - 12);
    td.classList.remove('flash'); void td.offsetWidth; td.classList.add('flash');
    setTimeout(() => td.classList.remove('flash'), 2000);
    el.focus({ preventScroll: true });
  }
  $('#prev-month').addEventListener('click', () => goMonth(view.y, view.m - 1));
  $('#next-month').addEventListener('click', () => goMonth(view.y, view.m + 1));
  $('#month-pick').addEventListener('change', e => {
    const v = e.target.value;
    if (/^\d{4}-\d{2}$/.test(v)) { const [y, m] = v.split('-').map(Number); goMonth(y, m); }
  });
  $('#go-today').addEventListener('click', () => { const t = new Date(); goMonth(t.getFullYear(), t.getMonth() + 1); });

  /* =========================================================
   * 11) แผงงานค้าง: Task ◐/✗ ที่ยังไม่ได้ยกต่อ + งานมอบหมายที่ยังไม่ติ๊ก (ถึงวันนี้)
   * ========================================================= */
  function openItems() {
    const today = todayISO();
    const tasks = [], assigns = [];
    Object.keys(state.days).sort().forEach(iso => {
      if (iso > today) return;
      const day = state.days[iso];
      day.tasks.forEach((t, row) => {
        if (OPEN.has(t.s) && t.t.trim() && !taskCarried(iso, row)) tasks.push({ iso, row, t });
      });
      day.assigns.forEach(a => {
        if (!a.done && a.t.trim() && !assignSent(iso, a)) assigns.push({ iso, a });
      });
    });
    return { tasks, assigns, total: tasks.length + assigns.length };
  }
  function updateBadge() {
    const n = openItems().total;
    const b = $('#backlog-badge');
    b.textContent = n;
    b.classList.toggle('zero', n === 0);
  }
  function ageHTML(iso) {
    const n = daysBetween(iso, todayISO());
    return `<span class="bl-age${n > 7 ? ' old' : ''}">${n === 0 ? 'วันนี้' : `ค้าง ${n} วัน`}</span>`;
  }
  function pullLabel(iso) {
    const t = pullTarget(iso);
    return t === todayISO() ? 'ดึงมาวันนี้' : `ดึงไป ${fmtShort(t)}`;
  }
  function renderBacklog() {
    const { tasks, assigns, total } = openItems();
    const today = todayISO();
    $('#bl-sub').textContent = total ? `${total} รายการที่ยังเปิดอยู่ ถึงวันที่ ${fmtShort(today)} · เรียงจากเก่าสุด` : '';
    if (!total) { $('#bl-body').innerHTML = '<p class="bl-empty">ไม่มีงานค้าง ทุกงานปิดหรือยกต่อไปแล้ว</p>'; return; }
    let h = '';
    if (assigns.length) {
      h += `<section class="bl-group"><h3>งานมอบหมายที่ยังไม่ทำ <span class="badge zero">${assigns.length}</span></h3><ul>`;
      assigns.forEach(({ iso, a }) => {
        const due = a.due ? `<span class="due${a.due < today ? ' late' : ''}">กำหนดส่ง ${fmtShort(a.due)}</span>` : '';
        h += `<li class="bl-item">
          <div class="bl-top"><span class="bl-kind" data-k="assign">☐</span><span>${fmtShort(iso)} · งานมอบหมาย</span>${ageHTML(iso)}${due}</div>
          <p class="bl-text">${esc(a.t)}</p>
          <div class="bl-actions">
            <button type="button" class="btn sm" data-act="as-done" data-date="${iso}" data-id="${a.id}">✓ ทำแล้ว</button>
            <button type="button" class="btn sm" data-act="as-pull" data-date="${iso}" data-id="${a.id}">→ ${pullLabel(iso)}</button>
            <button type="button" class="btn sm" data-act="go" data-date="${iso}" data-id="${a.id}">ไปที่วันนั้น</button>
          </div></li>`;
      });
      h += '</ul></section>';
    }
    if (tasks.length) {
      h += `<section class="bl-group"><h3>Task ที่ยังไม่เสร็จ (◐ / ✗) <span class="badge zero">${tasks.length}</span></h3>
        <p>ถ้าทำเสร็จแล้วแต่ยังไม่ได้อัปเดต กด "✓ เสร็จแล้ว" ได้เลย</p><ul>`;
      tasks.forEach(({ iso, row, t }) => {
        const st = STATUSES.find(s => s.sym === t.s);
        h += `<li class="bl-item">
          <div class="bl-top"><span class="bl-kind" data-k="${st.k}" title="${st.label}">${st.sym}</span><span>${fmtShort(iso)} · Task ${row + 1}</span>${ageHTML(iso)}</div>
          <p class="bl-text">${esc(t.t)}</p>
          <div class="bl-actions">
            <button type="button" class="btn sm" data-act="t-done" data-date="${iso}" data-row="${row}">✓ เสร็จแล้ว</button>
            <button type="button" class="btn sm" data-act="t-pull" data-date="${iso}" data-row="${row}">↪ ${pullLabel(iso)}</button>
            <button type="button" class="btn sm" data-act="t-cancel" data-date="${iso}" data-row="${row}">⊘ ยกเลิก</button>
            <button type="button" class="btn sm" data-act="go" data-date="${iso}" data-row="${row}">ไปที่วันนั้น</button>
          </div></li>`;
      });
      h += '</ul></section>';
    }
    $('#bl-body').innerHTML = h;
  }
  const dlgBl = $('#dlg-backlog');
  $('#open-backlog').addEventListener('click', () => { renderBacklog(); dlgBl.showModal(); });
  $('#bl-body').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const iso = b.dataset.date, row = b.dataset.row != null ? +b.dataset.row : null, id = b.dataset.id;
    const act = b.dataset.act;
    if (act === 'go') { dlgBl.close(); jumpTo(iso, row != null ? { row } : { assign: id }); return; }
    if (act === 'as-done') { const a = findAssign(iso, id); if (a) a.done = true; saveNow(); toast('ติ๊กงานมอบหมายแล้ว'); }
    if (act === 't-done') { setStatus(iso, row, '✓'); saveNow(); toast(`Task ${row + 1} วันที่ ${fmtShort(iso)} → ✓ เสร็จแล้ว`); }
    if (act === 't-cancel') { setStatus(iso, row, '⊘'); saveNow(); toast(`Task ${row + 1} วันที่ ${fmtShort(iso)} → ⊘ ยกเลิก`); }
    if (act === 't-pull' || act === 'as-pull') {
      const pos = act === 't-pull' ? carryTask(iso, row, pullTarget(iso)) : sendAssign(iso, id, pullTarget(iso));
      if (pos) toastPlaced(`ลง Task ${pos.row + 1} วันที่ ${fmtShort(pos.date)} แล้ว`, pos, true);
    }
    refresh();
    renderBacklog();
  });

  /* =========================================================
   * 12) จัดการวันหยุด
   * ========================================================= */
  const dlgHol = $('#dlg-holidays');
  function renderHolidays() {
    const list = $('#hol-list');
    if (!state.holidays.length) { list.innerHTML = '<li class="text-sm text-muted py-2">ยังไม่มีวันหยุดในระบบ</li>'; return; }
    list.innerHTML = state.holidays.map((h, i) => {
      const w = dowOf(h.date);
      const notes = [];
      if (dayHasData(state.days[h.date])) notes.push('มีบันทึกงานในวันนี้ — จะถูกซ่อนจนกว่าจะลบวันหยุดนี้');
      if (w === 0 || w === 6) notes.push('ตรงกับวันเสาร์-อาทิตย์อยู่แล้ว');
      return `<li class="hol-item">
        <span class="mono text-sm">${h.date} <span class="text-muted">${TH_DOW[w]}</span></span>
        <span class="text-sm">${esc(h.name) || '<span class="text-muted">(ไม่มีชื่อ)</span>'}</span>
        <button type="button" class="btn sm" data-del="${i}" aria-label="ลบวันหยุด ${h.date}">ลบ</button>
        ${notes.length ? `<span class="warn">${notes.join(' · ')}</span>` : ''}
      </li>`;
    }).join('');
  }
  $('#open-holidays').addEventListener('click', () => { renderHolidays(); dlgHol.showModal(); });
  $('#hol-list').addEventListener('click', e => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    const h = state.holidays.splice(+b.dataset.del, 1)[0];
    saveNow(); renderHolidays(); refresh();
    toast(`ลบวันหยุด ${h.date} แล้ว`);
  });
  $('#hol-form').addEventListener('submit', e => {
    e.preventDefault();
    const date = $('#hol-date').value, name = $('#hol-name').value.trim();
    if (!isISO(date)) return;
    const found = state.holidays.find(h => h.date === date);
    if (found) found.name = name; else state.holidays.push({ date, name });
    state.holidays.sort((a, b) => a.date.localeCompare(b.date));
    saveNow(); renderHolidays(); refresh();
    $('#hol-form').reset();
    toast(found ? `แก้ชื่อวันหยุด ${date} แล้ว` : `เพิ่มวันหยุด ${date} แล้ว`);
  });

  /* =========================================================
   * 13) ข้อมูล: สำรอง / นำเข้า / ล้าง
   * ========================================================= */
  const dlgData = $('#dlg-data');
  const dataMsg = t => { $('#data-msg').textContent = t; };
  $('#open-data').addEventListener('click', () => { dataMsg(''); dlgData.showModal(); });

  $('#export-file').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `NWL_Task_backup_${todayISO()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    dataMsg('เริ่มดาวน์โหลดไฟล์สำรองแล้ว (ถ้าไม่มีไฟล์ขึ้น ให้ใช้ปุ่ม "คัดลอก JSON" แล้ววางเก็บในไฟล์ข้อความ)');
  });
  $('#export-copy').addEventListener('click', () => {
    const text = JSON.stringify(snapshot(), null, 2);
    if (!navigator.clipboard) { dataMsg('เบราว์เซอร์นี้คัดลอกอัตโนมัติไม่ได้ ใช้ปุ่มดาวน์โหลดแทน'); return; }
    navigator.clipboard.writeText(text)
      .then(() => dataMsg('คัดลอกข้อมูลทั้งหมดแล้ว วางเก็บในไฟล์ .json ได้เลย'))
      .catch(() => dataMsg('คัดลอกไม่ได้ ลองใช้ปุ่มดาวน์โหลดไฟล์แทน'));
  });
  $('#import-file').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        state = normState(JSON.parse(rd.result));
        saveNow(); render(); scrollToDate(todayISO());
        const msg = `นำเข้าแล้ว: ${Object.keys(state.days).length} วันที่มีบันทึก, วันหยุด ${state.holidays.length} วัน`;
        dataMsg(msg); toast(msg);
      } catch (err) { dataMsg('นำเข้าไม่ได้: ไฟล์ต้องเป็น .json ที่สำรองจากแอปนี้'); toast('นำเข้าไม่ได้: ไฟล์ต้องเป็น .json ที่สำรองจากแอปนี้'); }
      e.target.value = '';
    };
    rd.readAsText(f);
  });

  // ปุ่มที่ต้องกด 2 ครั้งเพื่อยืนยัน (แทน confirm())
  function armed(btn, action) {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('armed')) {
        clearTimeout(btn._t); btn.classList.remove('armed'); btn.textContent = btn.dataset.label;
        action();
      } else {
        btn.classList.add('armed'); btn.textContent = 'กดอีกครั้งเพื่อยืนยัน';
        btn._t = setTimeout(() => { btn.classList.remove('armed'); btn.textContent = btn.dataset.label; }, 4000);
      }
    });
  }
  armed($('#clear-all'), () => {
    state.days = {}; saveNow(); render();
    dataMsg('ล้างบันทึกงานทั้งหมดแล้ว (วันหยุดยังอยู่)');
  });

  // ปิด dialog เมื่อกดปุ่ม × หรือคลิกพื้นหลัง
  document.querySelectorAll('dialog').forEach(dlg => {
    dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
  });

  // แจ้งเตือนด้านล่าง พร้อมปุ่มทางลัด (เช่น ไปดู / เลิกทำ)
  let toastT = null, toastActs = [];
  function toast(msg, actions = []) {
    const t = $('#toast'), box = $('#toast-actions');
    $('#toast-text').textContent = msg;
    toastActs = actions;
    box.innerHTML = actions.map((a, i) => `<button type="button" data-i="${i}">${esc(a.label)}</button>`).join('');
    t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, actions.length ? 6000 : 2400);
  }
  $('#toast-actions').addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const a = toastActs[+b.dataset.i];
    $('#toast').hidden = true; toastActs = [];
    if (a) a.fn();
  });
  // หลังยก/ส่งงาน: มีปุ่ม "ไปดู" และ "เลิกทำ" (ลบงานที่เพิ่งวาง)
  function toastPlaced(msg, pos, fromDrawer) {
    toast(msg, [
      { label: 'ไปดู', fn: () => { if (fromDrawer) dlgBl.close(); jumpTo(pos.date, { row: pos.row }); } },
      { label: 'เลิกทำ', fn: () => { unlinkCopy(pos.date, pos.row); refresh(); } }
    ]);
  }

  // ปุ่มนำเข้าบนแถบแนะนำ (ตอนยังไม่มีข้อมูล)
  $('#hint-import').addEventListener('click', () => $('#import-file').click());

  /* =========================================================
   * 14) Web app: ติดตั้งเป็นแอป + เปิดได้แม้ออฟไลน์
   * ========================================================= */
  let installEvt = null;
  const installBtn = $('#install-app');
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; installBtn.hidden = false; });
  installBtn.addEventListener('click', async () => {
    if (!installEvt) return;
    installBtn.hidden = true;
    installEvt.prompt();
    try { await installEvt.userChoice; } catch (err) { /* ผู้ใช้ปิดหน้าต่าง */ }
    installEvt = null;
  });
  window.addEventListener('appinstalled', () => { installBtn.hidden = true; toast('ติดตั้งแอปแล้ว'); });

  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if (secure && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => { /* ใช้งานต่อได้แบบออนไลน์ */ });
  // ขอให้เบราว์เซอร์ไม่ลบ LocalStorage ของแอปนี้เองตอนพื้นที่เครื่องใกล้เต็ม
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  /* =========================================================
   * 15) เริ่มต้น
   * ========================================================= */
  load();
  render();
  setSaveStatus('saved');
  requestAnimationFrame(() => scrollToDate(todayISO()));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { autosizeAll(); scrollToDate(todayISO()); });
  let rz = null;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(autosizeAll, 150); });

  // สำหรับทดสอบ/ดีบัก
  window.NWL = { daySummary, openItems, state: () => state };
})();
