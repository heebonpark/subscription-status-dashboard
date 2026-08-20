
(function () {
  "use strict";

  var DEFAULT_DATA = __DASHBOARD_DATA_JSON__;
  var STATUSES = ["유지", "청약", "청약취소"];
  var STATUS_COLOR = { "유지": "var(--good)", "청약": "var(--warning)", "청약취소": "var(--critical)" };
  var STATUS_LABEL = { "유지": "유지", "청약": "청약(진행)", "청약취소": "취소/해지" };
  var REQUIRED_COLS = ["영업지사명", "영업자명", "영업자소속", "청약일자", "계약상태(중)", "계약번호", "상호", "KTT월정료"];
  var PLACEHOLDER_AGENT = "추천자와동일";

  var RECORDS, ALL_HQS, ALL_BRANCHES, ALL_DATES;

  var state = {
    hq: null, branch: null, agent: null,
    dateFrom: null, dateTo: null,
    search: "",
    sortKey: "total", sortDir: -1,
    branchSortKey: "total", branchSortDir: -1,
    feeUnit: "천원",
    metric: "count", topN: 10, trendView: "daily", trendGranularity: "month", perfMetric: "전체", miniTrendMetric: "count", miniTrendView: "split",
    showMA: true, showCI: true, showOutliers: true,
    yoyMetric: "count", yoyYears: null, yoyMode: "raw",
    excludeCancelled: false, excludePlaceholder: false,
    summaryOpen: false, agentListOpen: false,
    goal: { count: null, fee: null }
  };

  // ---------- helpers ----------
  function fmt(n) { return Math.round(n).toLocaleString("ko-KR"); }
  function fmtDate(d) { var p = d.split("-"); return p[1] + "/" + p[2]; }
  function trendBucketKey(d, g) { return g === "year" ? d.slice(0, 4) : (g === "month" ? d.slice(0, 7) : d); }
  function trendBucketLabel(k, g, showYear) {
    if (g === "year") return k + "년";
    if (g === "month") {
      var p = k.split("-");
      return (showYear ? "'" + p[0].slice(2) + "." : "") + Number(p[1]) + "월";
    }
    return fmtDate(k);
  }
  function monthsSpanMultiYear(months) {
    return months.length > 0 && months[0].slice(0, 4) !== months[months.length - 1].slice(0, 4);
  }
  function fmtFee(v) {
    if (state.feeUnit === "백만원") {
      var m = v / 1000000;
      var decimals = Math.abs(m) >= 10 ? 1 : 2;
      return m.toLocaleString("ko-KR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + "백만원";
    }
    return fmt(Math.round(v / 1000)) + "천원";
  }
  function fmtFeeMillion(v) {
    return fmtFee(v);
  }
  function shortBranch(name) { return name ? name.replace(/지사$/, "") : name; }
  function fmtMetric(v, metric) { return metric === "fee" ? fmtFee(v) : (metric === "percent" ? Math.round(v) + "%" : (fmt(v) + "건")); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function emptyBucket() { return { "유지": { count: 0, fee: 0 }, "청약": { count: 0, fee: 0 }, "청약취소": { count: 0, fee: 0 } }; }
  function addToBucket(bucket, r) { var s = r[4]; bucket[s].count++; bucket[s].fee += r[7]; }
  function bucketTotal(bucket, metric) { return STATUSES.reduce(function (sum, s) { return sum + bucket[s][metric]; }, 0); }

  function aggregateByBranch(records) {
    var map = {};
    records.forEach(function (r) {
      if (!map[r[0]]) {
         map[r[0]] = emptyBucket();
         map[r[0]].hq = r[hqIdx] || "기타본부";
      }
      addToBucket(map[r[0]], r);
    });
    return Object.keys(map).map(function (b) {
      return { branch: b, hq: map[b].hq, bucket: map[b], count: bucketTotal(map[b], "count"), fee: bucketTotal(map[b], "fee") };
    });
  }

  function aggregateByAgent(records) {
    var map = {};
    records.forEach(function (r) {
      var key = r[0] + "␟" + r[1] + "␟" + r[2];
      if (!map[key]) {
        map[key] = { branch: r[0], agent: r[1], affiliation: r[2], bucket: emptyBucket(), monthly: {} };
      }
      addToBucket(map[key].bucket, r);
      var ym = r[3].slice(0, 7);
      if (!map[key].monthly[ym]) map[key].monthly[ym] = emptyBucket();
      addToBucket(map[key].monthly[ym], r);
    });
    return Object.keys(map).map(function (k) {
      var m = map[k];
      return {
        branch: m.branch, agent: m.agent, affiliation: m.affiliation,
        bucket: m.bucket, count: bucketTotal(m.bucket, "count"), fee: bucketTotal(m.bucket, "fee"),
        monthly: m.monthly
      };
    });
  }

  function aggregateByReferrer(records) {
    var map = {};
    records.forEach(function (r) {
      var name = r[8] || "(미기재)";
      if (!map[name]) map[name] = { referrer: name, bucket: emptyBucket() };
      addToBucket(map[name].bucket, r);
    });
    return Object.keys(map).map(function (k) {
      var m = map[k];
      return { referrer: m.referrer, bucket: m.bucket, count: bucketTotal(m.bucket, "count"), fee: bucketTotal(m.bucket, "fee") };
    });
  }

  function agentPerfRows(records) {
    return aggregateByAgent(records).map(function (r) {
      var maintain = r.bucket["유지"].count, pending = r.bucket["청약"].count;
      var fee = r.bucket["유지"].fee + r.bucket["청약"].fee;
      var denom = maintain + pending;
      return {
        branch: r.branch, agent: r.agent, count: denom, fee: fee,
        maintain: maintain, pending: pending,
        conv: denom > 0 ? (maintain / denom * 100) : null
      };
    });
  }

  function computeHqOrder(records) {
    var counts = {};
    records.forEach(function (r) { if (r[9]) counts[r[9]] = (counts[r[9]] || 0) + 1; });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
  }

  function computeBranchOrder(records) {
    var order = ["중앙", "강북", "서대문", "고양", "의정부", "남양주", "강릉", "원주지사", "중앙지사", "강북지사", "서대문지사", "고양지사", "의정부지사", "남양주지사", "강릉지사"];
    var counts = {};
    records.forEach(function (r) { counts[r[0]] = (counts[r[0]] || 0) + 1; });
    var keys = Object.keys(counts);
    keys.sort(function(a, b) {
      var aIdx = -1, bIdx = -1;
      for (var i = 0; i < order.length; i++) {
        if (a.indexOf(order[i]) !== -1 && aIdx === -1) aIdx = i;
        if (b.indexOf(order[i]) !== -1 && bIdx === -1) bIdx = i;
      }
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return counts[b] - counts[a];
    });
    return keys;
  }
  function computeDateList(records) {
    var s = {};
    records.forEach(function (r) { s[r[3]] = 1; });
    return Object.keys(s).sort();
  }

  function daysBetween(d1, d2) { return Math.round((new Date(d2) - new Date(d1)) / 86400000); }

  function computeHqList(records) {
    var s = {};
    records.forEach(function (r) { if (r[9]) s[r[9]] = 1; });
    var keys = Object.keys(s);
    return keys.length > 0 ? keys.sort() : null;
  }

  function loadData(data) {
    RECORDS = data.records;
    ALL_HQS = computeHqList(RECORDS);
    ALL_BRANCHES = computeBranchOrder(RECORDS);
    ALL_DATES = computeDateList(RECORDS);
    var span = ALL_DATES.length ? daysBetween(ALL_DATES[0], ALL_DATES[ALL_DATES.length - 1]) : 0;
    state.trendGranularity = span > 400 ? "year" : (span > 45 ? "month" : "day");
    document.querySelectorAll("#trend-granularity button").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-v") === state.trendGranularity);
    });
  }

  // ---------- scoping ----------
  function inDateRange(d) {
    if (state.dateFrom && d < state.dateFrom) return false;
    if (state.dateTo && d > state.dateTo) return false;
    return true;
  }
  function baseRecords() {
    return RECORDS.filter(function (r) {
      if (state.excludeCancelled && r[4] === "청약취소") return false;
      if (state.excludePlaceholder && r[1] === PLACEHOLDER_AGENT) return false;
      if (state.custom_branches) {
        var match = false;
        var bName = r[0];
        for (var i=0; i<state.custom_branches.length; i++) {
          if (bName && bName.indexOf(state.custom_branches[i]) !== -1) { match = true; break; }
        }
        if (!match) return false;
      }
      return true;
    });
  }
  function dateOnlyRecords() { return baseRecords().filter(function (r) { return inDateRange(r[3]); }); }
  function hqDateRecords() {
    return baseRecords().filter(function (r) {
      if (state.hq && r[9] !== state.hq) return false;
      if (!inDateRange(r[3])) return false;
      return true;
    });
  }
  function branchDateRecords() {
    return baseRecords().filter(function (r) {
      if (state.hq && r[9] !== state.hq) return false;
      if (state.branch && r[0] !== state.branch) return false;
      if (!inDateRange(r[3])) return false;
      return true;
    });
  }
  function fullScopedRecords() {
    return baseRecords().filter(function (r) {
      if (state.hq && r[9] !== state.hq) return false;
      if (state.branch && r[0] !== state.branch) return false;
      if (state.agent && r[1] !== state.agent) return false;
      if (!inDateRange(r[3])) return false;
      return true;
    });
  }
  function branchAgentRecords() {
    return baseRecords().filter(function (r) {
      if (state.hq && r[9] !== state.hq) return false;
      if (state.branch && r[0] !== state.branch) return false;
      if (state.agent && r[1] !== state.agent) return false;
      return true;
    });
  }

  // ---------- tooltip ----------
  var tooltipEl = document.getElementById("tooltip");
  function showTooltip(evt, title, rows, highlightStatus, metric) {
    metric = metric || "count";
    tooltipEl.innerHTML = "";
    tooltipEl.appendChild(el("div", "tt-title", title));
    rows.forEach(function (row) {
      var r = el("div", "tt-row" + (row.status === highlightStatus ? " hi" : ""));
      var k = el("span", "k");
      var i = document.createElement("i");
      i.style.background = STATUS_COLOR[row.status];
      k.appendChild(i);
      k.appendChild(el("span", null, STATUS_LABEL[row.status]));
      r.appendChild(k);
      r.appendChild(el("span", "v", fmtMetric(row.value, metric)));
      tooltipEl.appendChild(r);
    });
    tooltipEl.classList.add("show");
    positionTooltip(evt);
  }
  function showColorTooltip(evt, title, rows, metric) {
    metric = metric || "count";
    tooltipEl.innerHTML = "";
    tooltipEl.appendChild(el("div", "tt-title", title));
    rows.forEach(function (row) {
      var r = el("div", "tt-row");
      var k = el("span", "k");
      var i = document.createElement("i");
      i.style.background = row.color;
      k.appendChild(i);
      k.appendChild(el("span", null, row.label));
      r.appendChild(k);
      r.appendChild(el("span", "v", row.metric === "text" ? row.value : fmtMetric(row.value, row.metric || metric)));
      tooltipEl.appendChild(r);
    });
    tooltipEl.classList.add("show");
    positionTooltip(evt);
  }
  function positionTooltip(evt) {
    var x = evt.clientX, y = evt.clientY, pad = 14;
    var rect = tooltipEl.getBoundingClientRect();
    var left = x + pad, top = y + pad;
    if (left + rect.width > window.innerWidth - 8) left = x - rect.width - pad;
    if (top + rect.height > window.innerHeight - 8) top = y - rect.height - pad;
    tooltipEl.style.left = left + "px";
    tooltipEl.style.top = top + "px";
  }
  function hideTooltip() { tooltipEl.classList.remove("show"); }

  function buildLegend(containerId) {
    var e = document.getElementById(containerId);
    e.innerHTML = "";
    STATUSES.forEach(function (s) {
      var row = el("div", "lkey");
      var sw = el("span", "swatch");
      sw.style.background = STATUS_COLOR[s];
      row.appendChild(sw);
      row.appendChild(el("span", null, STATUS_LABEL[s]));
      e.appendChild(row);
    });
  }

  // ---------- date filter controls ----------
  var yearSel = document.getElementById("year-sel");
  var monthSel = document.getElementById("month-sel");
  var daySel = document.getElementById("day-sel");
  var dateFromInput = document.getElementById("date-from");
  var dateToInput = document.getElementById("date-to");

  function fillSelect(sel, values, allLabel, labelFn) {
    sel.innerHTML = "";
    var optAll = document.createElement("option");
    optAll.value = "ALL"; optAll.textContent = allLabel;
    sel.appendChild(optAll);
    values.forEach(function (v) {
      var o = document.createElement("option");
      o.value = v; o.textContent = labelFn(v);
      sel.appendChild(o);
    });
    sel.value = "ALL";
  }

  function populateDateSelects() {
    var years = {}, months = {}, days = {};
    ALL_DATES.forEach(function (d) {
      years[d.slice(0, 4)] = 1; months[d.slice(5, 7)] = 1; days[d.slice(8, 10)] = 1;
    });
    fillSelect(yearSel, Object.keys(years).sort(), "전체", function (y) { return y + "년"; });
    fillSelect(monthSel, Object.keys(months).sort(), "전체", function (m) { return Number(m) + "월"; });
    fillSelect(daySel, Object.keys(days).sort(), "전체", function (d) { return Number(d) + "일"; });
    var minD = ALL_DATES[0], maxD = ALL_DATES[ALL_DATES.length - 1];
    dateFromInput.min = minD; dateFromInput.max = maxD;
    dateToInput.min = minD; dateToInput.max = maxD;
  }

  function handleYMDChange() {
    var y = yearSel.value, m = monthSel.value, d = daySel.value;
    if (y === "ALL") { state.dateFrom = null; state.dateTo = null; }
    else if (m === "ALL") { state.dateFrom = y + "-01-01"; state.dateTo = y + "-12-31"; }
    else if (d === "ALL") {
      var last = new Date(Number(y), Number(m), 0).getDate();
      state.dateFrom = y + "-" + m + "-01";
      state.dateTo = y + "-" + m + "-" + String(last).padStart(2, "0");
    } else {
      state.dateFrom = y + "-" + m + "-" + d;
      state.dateTo = y + "-" + m + "-" + d;
    }
    dateFromInput.value = state.dateFrom || "";
    dateToInput.value = state.dateTo || "";
    render();
  }
  function handleRangeChange() {
    state.dateFrom = dateFromInput.value || null;
    state.dateTo = dateToInput.value || null;
    yearSel.value = "ALL"; monthSel.value = "ALL"; daySel.value = "ALL";
    render();
  }

  function selectMonth(ym) {
    if (ym === null) { state.dateFrom = null; state.dateTo = null; }
    else {
      var y = ym.slice(0, 4), m = ym.slice(5, 7);
      var last = new Date(Number(y), Number(m), 0).getDate();
      state.dateFrom = ym + "-01";
      state.dateTo = ym + "-" + String(last).padStart(2, "0");
    }
    yearSel.value = ym ? ym.slice(0, 4) : "ALL";
    monthSel.value = ym ? ym.slice(5, 7) : "ALL";
    daySel.value = "ALL";
    dateFromInput.value = state.dateFrom || "";
    dateToInput.value = state.dateTo || "";
    render();
  }

  function renderMonthButtons() {
    var months = [];
    var seen = {};
    ALL_DATES.forEach(function (d) {
      var ym = d.slice(0, 7);
      if (!seen[ym]) { seen[ym] = 1; months.push(ym); }
    });
    var multiYear = months.length > 0 && months[0].slice(0, 4) !== months[months.length - 1].slice(0, 4);

    var wrap = document.getElementById("month-filters");
    wrap.innerHTML = "";
    wrap.appendChild(el("span", "flabel", "청약월"));

    var isAllActive = !state.dateFrom && !state.dateTo;
    var allBtn = el("button", "chip" + (isAllActive ? " active" : ""), "전체");
    allBtn.addEventListener("click", function () { selectMonth(null); });
    wrap.appendChild(allBtn);

    months.forEach(function (ym) {
      var y = ym.slice(0, 4), m = ym.slice(5, 7);
      var last = new Date(Number(y), Number(m), 0).getDate();
      var isActive = state.dateFrom === (ym + "-01") && state.dateTo === (ym + "-" + String(last).padStart(2, "0"));
      var label = (multiYear ? y + "년 " : "") + Number(m) + "월";
      var btn = el("button", "chip" + (isActive ? " active" : ""), label);
      btn.addEventListener("click", function () { selectMonth(ym); });
      wrap.appendChild(btn);
    });
  }
  yearSel.addEventListener("change", handleYMDChange);
  monthSel.addEventListener("change", handleYMDChange);
  daySel.addEventListener("change", handleYMDChange);
  dateFromInput.addEventListener("change", handleRangeChange);
  dateToInput.addEventListener("change", handleRangeChange);

  if (daySel) {
    daySel.addEventListener("change", function(e) {
      state.dateTo = e.target.value === "ALL" ? null : e.target.value;
      render();
    });
  }

  var branchGroupMode = document.getElementById("branch-group-mode");
  if (branchGroupMode) {
    branchGroupMode.addEventListener("change", function() { render(); });
  }

  var topNSel = document.getElementById("topn-sel");

  function resetAllFilters() {
    state.hq = null; state.branch = null; state.agent = null;
    state.dateFrom = null; state.dateTo = null;
    state.search = "";
    document.getElementById("agent-search").value = "";
    yearSel.value = "ALL"; monthSel.value = "ALL"; daySel.value = "ALL";
    dateFromInput.value = ""; dateToInput.value = "";
    state.excludeCancelled = false;
    document.querySelectorAll("#cancel-toggle button").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-v") === "include"); });
    state.excludePlaceholder = false;
    document.querySelectorAll("#placeholder-toggle button").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-v") === "include"); });
    state.summaryOpen = false; state.agentListOpen = false;
  }
  document.getElementById("reset-filters-btn").addEventListener("click", function () { resetAllFilters(); render(); });
  document.querySelectorAll("#cancel-toggle button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.excludeCancelled = btn.getAttribute("data-v") === "exclude";
      document.querySelectorAll("#cancel-toggle button").forEach(function (b) { b.classList.toggle("active", b === btn); });
      render();
    });
  });
  document.querySelectorAll("#fee-unit-toggle button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.feeUnit = btn.getAttribute("data-v");
      document.querySelectorAll("#fee-unit-toggle button").forEach(function (b) { b.classList.toggle("active", b === btn); });
      render();
    });
  });

  document.querySelectorAll("#placeholder-toggle button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.excludePlaceholder = btn.getAttribute("data-v") === "exclude";
      if (state.excludePlaceholder && state.agent === PLACEHOLDER_AGENT) state.agent = null;
      document.querySelectorAll("#placeholder-toggle button").forEach(function (b) { b.classList.toggle("active", b === btn); });
      render();
    });
  });

  var hqSel = document.getElementById("hq-sel");
  var branchSel = document.getElementById("branch-sel");

  if (hqSel) {
    hqSel.addEventListener("change", function(e) {
      state.hq = e.target.value === "ALL" ? null : e.target.value;
      state.branch = null;
      state.agent = null;
      render();
    });
  }
  
  var hqGangbukBtn = document.getElementById("hq-gangbuk-btn");
  if (hqGangbukBtn) {
    hqGangbukBtn.addEventListener("click", function() {
      if (state.custom_branches) {
         state.custom_branches = null;
         hqGangbukBtn.style.background = "var(--primary)";
      } else {
         state.custom_branches = ["중앙", "강북", "서대문", "고양", "의정부", "남양주", "강릉", "원주"];
         state.hq = null;
         state.branch = null;
         state.agent = null;
         if (hqSel) hqSel.value = "ALL";
         if (branchSel) branchSel.value = "ALL";
         hqGangbukBtn.style.background = "var(--warning)";
      }
      render();
    });
  }

  if (branchSel) {
    branchSel.addEventListener("change", function(e) {
      state.branch = e.target.value === "ALL" ? null : e.target.value;
      state.agent = null;
      render();
    });
  }

  // ---------- file upload / CSV parsing ----------
  function showUploadWarning(msg) {
    var w = document.getElementById("upload-warning");
    w.innerHTML = "";
    if (!msg) return;
    w.appendChild(el("div", "warn-banner", msg));
  }

  function decodeArrayBuffer(buf) {
    var u8 = new Uint8Array(buf);
    var utf8 = new TextDecoder("utf-8", { fatal: false }).decode(u8);
    if (utf8.indexOf("\uFFFD") === -1) return utf8;
    try { return new TextDecoder("euc-kr").decode(u8); } catch (e) { return utf8; }
  }

  function parseCSV(text) {
    var rows = [], row = [], field = "", inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
        else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\r") { /* skip */ }
        else if (c === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
        else field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return !(r.length === 1 && r[0] === ""); });
  }

  function normalizeDate(s) {
    if (/^\d{8}$/.test(s)) return s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    if (/^\d{4}\/\d{2}\/\d{2}/.test(s)) return s.slice(0, 10).replace(/\//g, "-");
    return null;
  }

  function buildRecordsFromCSV(text) {
    var rows = parseCSV(text);
    if (rows.length < 2) throw new Error("데이터 행이 없습니다.");
    var header = rows[0];
    var idx = {};
    REQUIRED_COLS.forEach(function (col) { idx[col] = header.indexOf(col); });
    var missing = REQUIRED_COLS.filter(function (col) { return idx[col] === -1; });
    if (missing.length) throw new Error("필수 컬럼이 없습니다: " + missing.join(", "));
    var referrerIdx = header.indexOf("추천자명");
    var hqIdx = header.indexOf("영업본부명");
    if (hqIdx === -1) hqIdx = header.indexOf("관리본부명");
    var records = [], skipped = 0;
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      if (!r || r.length < 2) { skipped++; continue; }
      var date = normalizeDate((r[idx["청약일자"]] || "").trim());
      if (!date) { skipped++; continue; }
      var statusRaw = (r[idx["계약상태(중)"]] || "").trim();
      var status = (statusRaw.indexOf("취소") !== -1 || statusRaw.indexOf("해지") !== -1) ? "청약취소" : ((statusRaw === "유지" || statusRaw === "명변유지") ? "유지" : "청약");
      var fee = parseInt(String(r[idx["KTT월정료"]] || "0").replace(/[^0-9-]/g, ""), 10);
      if (isNaN(fee)) fee = 0;
      if (fee === 0) { skipped++; continue; }
      var hqVal = hqIdx >= 0 ? (r[hqIdx] || "").trim() : "";
      if (hqVal === "강원본부") hqVal = "강북/강원본부";
      else if (hqVal === "서부본부") hqVal = "강남/서부본부";
      records.push([
        (r[idx["영업지사명"]] || "").trim(),
        (r[idx["영업자명"]] || "").trim(),
        (r[idx["영업자소속"]] || "").trim(),
        date, status,
        (r[idx["계약번호"]] || "").trim(),
        (r[idx["상호"]] || "").trim(),
        fee,
        referrerIdx >= 0 ? (r[referrerIdx] || "").trim() : "",
        hqVal
      ]);
    }
    return { records: records, skipped: skipped };
  }

  function handleFile(f) {
    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var text = decodeArrayBuffer(ev.target.result);
        var result = buildRecordsFromCSV(text);
        if (result.records.length === 0) throw new Error("유효한 데이터 행을 찾지 못했습니다.");
        loadData({ records: result.records });
        resetAllFilters();
        populateDateSelects();
        document.getElementById("file-name").textContent =
          f.name + " · " + RECORDS.length.toLocaleString("ko-KR") + "건 로드" + (result.skipped ? " (건너뜀 " + result.skipped + "건)" : "");
        document.getElementById("reset-data-btn").style.display = "";
        showUploadWarning("");
        render();
      } catch (err) {
        showUploadWarning("업로드 실패: " + err.message);
      }
    };
    reader.readAsArrayBuffer(f);
  }

  var fileInput = document.getElementById("file-input");
  document.getElementById("upload-btn").addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function (e) {
    var f = e.target.files[0];
    if (f) handleFile(f);
    fileInput.value = "";
  });
  document.getElementById("reset-data-btn").addEventListener("click", function () {
    loadData(DEFAULT_DATA);
    resetAllFilters();
    populateDateSelects();
    document.getElementById("file-name").textContent = "";
    document.getElementById("reset-data-btn").style.display = "none";
    showUploadWarning("");
    render();
  });

  // ---------- org dropdowns (rebuilt each render for live counts) ----------
  function renderOrgSelects(hqDateRecs) {
    if (hqSel) {
      if (!ALL_HQS || ALL_HQS.length === 0) {
        document.getElementById("hq-filter-group").style.display = "none";
        document.getElementById("org-divider").style.display = "none";
      } else {
        document.getElementById("hq-filter-group").style.display = "";
        document.getElementById("org-divider").style.display = "";
        fillSelect(hqSel, ALL_HQS, "전체", function(h) { return h; });
        hqSel.value = state.hq || "ALL";
      }
    }

    if (branchSel) {
      var counts = {};
      aggregateByBranch(hqDateRecs).forEach(function (r) { counts[r.branch] = r; });
      var hqBranches = {};
      if (state.hq) {
        hqDateRecs.forEach(function(r) { hqBranches[r[0]] = true; });
      }

      var branchList = ALL_BRANCHES.filter(function(b) {
        return !(state.hq && !hqBranches[b]);
      });

      fillSelect(branchSel, branchList, "전체", function(b) {
        var c = counts[b];
        return shortBranch(b) + " (" + fmtMetric(c ? c[state.metric] : 0, state.metric) + ")";
      });
      branchSel.value = state.branch || "ALL";
    }
  }

  // ---------- agent drill-down chips ----------
  function renderAgentFilterWrap(records) {
    var wrap = document.getElementById("agent-filter-wrap");
    wrap.innerHTML = "";
    if (!state.branch) return;
    var agents = aggregateByAgent(records).sort(function (a, b) { return b[state.metric] - a[state.metric]; });
    var container = el("div", "filters");
    container.appendChild(el("span", "flabel", shortBranch(state.branch) + " 영업자"));
    var showCount = state.agentListOpen ? agents.length : Math.min(12, agents.length);
    for (var i = 0; i < showCount; i++) {
      (function (a) {
        var chip = el("button", "chip" + (state.agent === a.agent ? " active" : ""),
          a.agent + " (" + fmtMetric(a[state.metric], state.metric) + ")");
        chip.addEventListener("click", function () {
          state.agent = (state.agent === a.agent) ? null : a.agent;
          render();
        });
        container.appendChild(chip);
      })(agents[i]);
    }
    if (agents.length > 12) {
      var toggleBtn = el("button", "reset-btn", state.agentListOpen ? "접기" : ("더보기 (" + (agents.length - 12) + ")"));
      toggleBtn.addEventListener("click", function () { state.agentListOpen = !state.agentListOpen; render(); });
      container.appendChild(toggleBtn);
    }
    if (agents.length === 0) container.appendChild(el("span", "sub", "해당 조건의 영업자가 없습니다."));
    wrap.appendChild(container);
  }

  // ---------- contract-level drill-down ----------
  function renderDrilldown(records) {
    var wrap = document.getElementById("drilldown-wrap");
    wrap.innerHTML = "";
    if (!state.branch || !state.agent) return;
    var card = el("div", "card drill-card");
    var head = el("div", "drill-head");
    var titleWrap = document.createElement("div");
    var h2 = el("h2", null, shortBranch(state.branch) + " · " + state.agent + " 상세내역");
    h2.style.marginBottom = "2px";
    var feeSum = records.reduce(function (s, r) { return s + r[7]; }, 0);
    var sub = el("p", "sub", records.length.toLocaleString("ko-KR") + "건 · 월정료 합계 " + fmtFee(feeSum));
    sub.style.marginBottom = "0";
    titleWrap.appendChild(h2); titleWrap.appendChild(sub);
    head.appendChild(titleWrap);
    var closeBtn = el("button", "close-x", "✕");
    closeBtn.setAttribute("aria-label", "닫기");
    closeBtn.addEventListener("click", function () { state.agent = null; render(); });
    head.appendChild(closeBtn);
    card.appendChild(head);

    if (state.agent === PLACEHOLDER_AGENT) {
      card.appendChild(el("p", "sub", "\"" + PLACEHOLDER_AGENT + "\"은 담당 영업자 없이 추천 채널로 접수된 건입니다. 아래에서 실제 추천자(콜센터/파트너/개인) 기준으로 나눠 볼 수 있습니다."));
      var refRows = aggregateByReferrer(records).sort(function (a, b) { return b.count - a.count; });
      var refScroll = el("div", "table-scroll");
      refScroll.style.marginBottom = "16px";
      var refTable = document.createElement("table");
      refTable.className = "data one-label";
      var refThead = document.createElement("thead");
      var refHtr = document.createElement("tr");
      ["추천자", "건수", "월정료", "유지", "청약", "취소"].forEach(function (t) { refHtr.appendChild(el("th", null, t)); });
      refThead.appendChild(refHtr); refTable.appendChild(refThead);
      var refTbody = document.createElement("tbody");
      refRows.forEach(function (r) {
        var tr = document.createElement("tr");
        tr.appendChild(el("td", null, r.referrer));
        tr.appendChild(el("td", null, fmt(r.count)));
        tr.appendChild(el("td", null, fmtFee(r.fee)));
        tr.appendChild(el("td", null, fmt(r.bucket["유지"].count)));
        tr.appendChild(el("td", null, fmt(r.bucket["청약"].count)));
        tr.appendChild(el("td", null, fmt(r.bucket["청약취소"].count)));
        refTbody.appendChild(tr);
      });
      refTable.appendChild(refTbody);
      refScroll.appendChild(refTable);
      card.appendChild(el("h2", null, "추천자별 현황"));
      card.appendChild(refScroll);
      card.appendChild(el("h2", null, "계약 상세내역"));
    }

    var scroll = el("div", "table-scroll");
    var table = document.createElement("table");
    table.className = "data";
    var thead = document.createElement("thead");
    var htr = document.createElement("tr");
    ["계약번호", "상호", "청약일자", "상태", "추천자", "월정료"].forEach(function (t) { htr.appendChild(el("th", null, t)); });
    thead.appendChild(htr); table.appendChild(thead);
    var tbody = document.createElement("tbody");
    var sorted = records.slice().sort(function (a, b) { return a[3] < b[3] ? 1 : (a[3] > b[3] ? -1 : 0); });
    if (sorted.length === 0) {
      var etr = el("tr", "empty-row");
      var etd = el("td", null, "데이터가 없습니다.");
      etd.colSpan = 6;
      etr.appendChild(etd); tbody.appendChild(etr);
    }
    sorted.forEach(function (r) {
      var tr = document.createElement("tr");
      tr.appendChild(el("td", null, r[5]));
      tr.appendChild(el("td", null, r[6]));
      tr.appendChild(el("td", null, r[3]));
      tr.appendChild(el("td", null, STATUS_LABEL[r[4]]));
      tr.appendChild(el("td", null, r[8] || "–"));
      tr.appendChild(el("td", null, fmtFee(r[7])));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    card.appendChild(scroll);
    wrap.appendChild(card);
  }

  // ---------- summary card ----------
  function renderSummary(full, dateRecs) {
    var scopeLabel = state.branch ? (shortBranch(state.branch) + (state.agent ? " · " + state.agent : "")) : (state.hq ? state.hq : "전체 지사");
    document.getElementById("summary-scope").textContent = scopeLabel;
    
    var hqStr = state.hq ? " · " + state.hq : "";
    document.getElementById("summary-date").textContent = (state.dateFrom || "전체") + " ~ " + (state.dateTo || "전체") + hqStr;
    document.getElementById("summary-count").textContent = fmtMetric(full.length, "count");

    var wrap = document.getElementById("summary-detail");
    wrap.innerHTML = "";
    var breakdown = (state.branch ? aggregateByAgent(full) : aggregateByBranch(dateRecs)).slice()
      .sort(function (a, b) { return b.count - a.count; });
    breakdown.forEach(function (row) {
      var name = state.branch ? row.agent : shortBranch(row.branch);
      var line = el("div", null, name + " — " + fmt(row.count) + "건 · " + fmtFeeMillion(row.fee));
      line.style.padding = "3px 0";
      wrap.appendChild(line);
    });
    if (breakdown.length === 0) wrap.appendChild(el("div", null, "표시할 세부 항목이 없습니다."));

    var toggle = el("button", "collapse-toggle", state.summaryOpen ? "접기" : "자세히 보기");
    toggle.addEventListener("click", function () { state.summaryOpen = !state.summaryOpen; render(); });
    wrap.appendChild(toggle);
  }

  // ---------- KPI tiles ----------
  function renderKPIs(records) {
    var bucket = emptyBucket();
    records.forEach(function (r) { addToBucket(bucket, r); });
    var total = bucketTotal(bucket, "count");
    var totalFee = bucketTotal(bucket, "fee");
    var maintain = bucket["유지"].count, pending = bucket["청약"].count, cancel = bucket["청약취소"].count;
    var maintainFee = bucket["유지"].fee, pendingFee = bucket["청약"].fee, cancelFee = bucket["청약취소"].fee;
    var cancelRate = total ? (cancel / total * 100) : 0;
    var convRate = (maintain + cancel) > 0 ? (maintain / (maintain + cancel) * 100) : null;
    var agents = {};
    records.forEach(function (r) { agents[r[0] + "|" + r[1]] = 1; });

    var tiles = [
      { label: "건수", value: fmt(total) + "건", cls: "" },
      { label: "월정료 합계", value: fmtFee(totalFee), cls: "" },
      { label: "유지", value: fmt(maintain) + "건", subValue: fmtFee(maintainFee), cls: "good" },
      { label: "청약(진행중)", value: fmt(pending) + "건", subValue: fmtFee(pendingFee), cls: "warning" },
      { label: "취소/해지", value: fmt(cancel) + "건", subValue: fmtFee(cancelFee), cls: "critical" },
      { label: "취소율", value: cancelRate.toFixed(1) + "%", cls: cancelRate >= 10 ? "critical" : "" },
      { label: "유지전환율", value: convRate === null ? "–" : convRate.toFixed(1) + "%", cls: convRate !== null && convRate < 70 ? "critical" : "good" },
      { label: "활동 영업자", value: fmt(Object.keys(agents).length) + "명", cls: "" }
    ];

    
    // AI Anomaly Detection: Cancel Rate Spike
    var anomalyWrap = document.getElementById("anomaly-alert");
    if(!anomalyWrap) {
      anomalyWrap = el("div");
      anomalyWrap.id = "anomaly-alert";
      var container = document.querySelector(".wrap");
      container.insertBefore(anomalyWrap, document.getElementById("kpis").nextSibling);
    }
    anomalyWrap.innerHTML = "";
    
    var branchAgg = aggregateByBranch(records);
    var anomalies = window.calculateMultivariateAnomalies(branchAgg);
    if (anomalies.length > 0) {
      var alertDiv = el("div", null, "🚨 [AI 다변량 이상탐지] 비정상 실적 패턴 지사 발견: " + anomalies.join(" | "));
      alertDiv.style.background = "rgba(239, 68, 68, 0.1)";
      alertDiv.style.border = "1px solid var(--critical)";
      alertDiv.style.color = "var(--critical)";
      alertDiv.style.padding = "10px 16px";
      alertDiv.style.borderRadius = "8px";
      alertDiv.style.marginTop = "16px";
      alertDiv.style.fontWeight = "600";
      anomalyWrap.appendChild(alertDiv);
    }

    var wrap = document.getElementById("kpis");
    wrap.innerHTML = "";
    tiles.forEach(function (t) {
      var tile = el("div", "tile");
      tile.appendChild(el("div", "tlabel", t.label));
      tile.appendChild(el("div", "tvalue" + (t.cls ? " " + t.cls : ""), t.value));
      if (t.subValue) {
        var sub = el("div", "tsubvalue" + (t.cls ? " " + t.cls : ""), t.subValue);
        sub.style.fontSize = "16px";
        sub.style.marginTop = "2px";
        sub.style.fontWeight = "600";
        sub.style.color = "var(--text-secondary)";
        if(t.cls === "good") sub.style.color = "var(--good)";
        if(t.cls === "warning") sub.style.color = "var(--warning)";
        if(t.cls === "critical") sub.style.color = "var(--critical)";
        tile.appendChild(sub);
      }
      wrap.appendChild(tile);
    });
  }

  // ---------- forecast & goal ----------
  function computeForecast(records) {
    if (records.length === 0) return null;
    var maxDate = records.reduce(function (m, r) { return r[3] > m ? r[3] : m; }, records[0][3]);
    var ym = maxDate.slice(0, 7);
    var monthRecs = records.filter(function (r) { return r[3].slice(0, 7) === ym; });
    var elapsedDay = Number(maxDate.slice(8, 10));
    var y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
    var daysInMonth = new Date(y, m, 0).getDate();
    var countSoFar = monthRecs.length;
    var feeSoFar = monthRecs.reduce(function (s, r) { return s + r[7]; }, 0);
    var ratio = daysInMonth / elapsedDay;
    var forecastCount = Math.round(countSoFar * ratio);
    var forecastFee = Math.round(feeSoFar * ratio);

    var pm = m - 1, py = y;
    if (pm === 0) { pm = 12; py -= 1; }
    var pym = py + "-" + (pm < 10 ? "0" + pm : "" + pm);
    var prevMonthRecs = records.filter(function (r) { return r[3].slice(0, 7) === pym; });
    var prevCount = prevMonthRecs.length;
    var prevFee = prevMonthRecs.reduce(function (s, r) { return s + r[7]; }, 0);
    var momCountPct = prevCount > 0 ? ((forecastCount - prevCount) / prevCount * 100) : null;
    var momFeePct = prevFee > 0 ? ((forecastFee - prevFee) / prevFee * 100) : null;

    return {
      ym: ym, elapsedDay: elapsedDay, daysInMonth: daysInMonth,
      countSoFar: countSoFar, feeSoFar: feeSoFar,
      forecastCount: forecastCount, forecastFee: forecastFee,
      pym: pym, hasPrevMonth: prevMonthRecs.length > 0, prevCount: prevCount, prevFee: prevFee,
      momCountPct: momCountPct, momFeePct: momFeePct
    };
  }

  function linearRegression(xs, ys) {
    var n = xs.length;
    if (n < 2) return null;
    var sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (var i = 0; i < n; i++) { sumX += xs[i]; sumY += ys[i]; sumXY += xs[i] * ys[i]; sumXX += xs[i] * xs[i]; }
    var denom = n * sumXX - sumX * sumX;
    if (denom === 0) return null;
    var slope = (n * sumXY - sumX * sumY) / denom;
    var intercept = (sumY - slope * sumX) / n;
    var meanY = sumY / n;
    var ssTot = 0, ssRes = 0;
    for (var i = 0; i < n; i++) { var pred = slope * xs[i] + intercept; ssRes += Math.pow(ys[i] - pred, 2); ssTot += Math.pow(ys[i] - meanY, 2); }
    var r2 = ssTot > 0 ? 1 - ssRes / ssTot : (ssRes === 0 ? 1 : 0);
    return { slope: slope, intercept: intercept, r2: r2, predict: function (x) { return slope * x + intercept; } };
  }

  function holtLinear(ys, alpha, beta) {
    if (ys.length < 2) return null;
    alpha = alpha == null ? 0.5 : alpha;
    beta = beta == null ? 0.3 : beta;
    var level = ys[0], trend = ys[1] - ys[0];
    for (var i = 1; i < ys.length; i++) {
      var lastLevel = level;
      level = alpha * ys[i] + (1 - alpha) * (level + trend);
      trend = beta * (level - lastLevel) + (1 - beta) * trend;
    }
    return { level: level, trend: trend, predict: function (h) { return level + h * trend; } };
  }

  function computeYearEndForecast(records) {
    if (records.length === 0) return null;
    var maxDate = records.reduce(function (m, r) { return r[3] > m ? r[3] : m; }, records[0][3]);
    var year = maxDate.slice(0, 4);
    var yearRecs = records.filter(function (r) { return r[3].slice(0, 4) === year; });
    if (yearRecs.length === 0) return null;
    var jan1 = year + "-01-01";
    var elapsedDays = daysBetween(jan1, maxDate) + 1;
    var yNum = Number(year);
    var isLeap = (yNum % 4 === 0 && (yNum % 100 !== 0 || yNum % 400 === 0));
    var totalDays = isLeap ? 366 : 365;
    var ytdCount = yearRecs.length;
    var ytdFee = yearRecs.reduce(function (s, r) { return s + r[7]; }, 0);
    var naiveRatio = totalDays / elapsedDays;
    var naiveCount = Math.round(ytdCount * naiveRatio);
    var naiveFee = Math.round(ytdFee * naiveRatio);

    var byMonth = {};
    yearRecs.forEach(function (r) {
      var mm = Number(r[3].slice(5, 7));
      if (!byMonth[mm]) byMonth[mm] = { count: 0, fee: 0 };
      byMonth[mm].count++; byMonth[mm].fee += r[7];
    });
    var curMonth = Number(maxDate.slice(5, 7));
    var daysInCurMonth = new Date(yNum, curMonth, 0).getDate();
    var curMonthDay = Number(maxDate.slice(8, 10));
    var isCurMonthComplete = curMonthDay >= daysInCurMonth;
    var lastCompleteMonth = isCurMonthComplete ? curMonth : curMonth - 1;

    var xs = [], countYs = [], feeYs = [];
    for (var mm = 1; mm <= lastCompleteMonth; mm++) {
      if (!byMonth[mm]) continue;
      xs.push(mm); countYs.push(byMonth[mm].count); feeYs.push(byMonth[mm].fee);
    }

    var countReg = xs.length >= 2 ? linearRegression(xs, countYs) : null;
    var feeReg = xs.length >= 2 ? linearRegression(xs, feeYs) : null;
    var countHolt = countYs.length >= 2 ? holtLinear(countYs) : null;
    var feeHolt = feeYs.length >= 2 ? holtLinear(feeYs) : null;

    var curCount = byMonth[curMonth] ? byMonth[curMonth].count : 0;
    var curFee = byMonth[curMonth] ? byMonth[curMonth].fee : 0;
    var curMonthCountEst = isCurMonthComplete ? curCount : Math.round(curCount / curMonthDay * daysInCurMonth);
    var curMonthFeeEst = isCurMonthComplete ? curFee : Math.round(curFee / curMonthDay * daysInCurMonth);

    function sumActualBefore(field) {
      var s = 0;
      for (var mm2 = 1; mm2 < curMonth; mm2++) { if (byMonth[mm2]) s += byMonth[mm2][field]; }
      return s;
    }
    var actualBeforeCount = sumActualBefore("count");
    var actualBeforeFee = sumActualBefore("fee");

    function projectRemaining(predictFn, isHolt, lastX) {
      var sum = 0;
      for (var mm2 = curMonth + 1; mm2 <= 12; mm2++) {
        var x = isHolt ? (mm2 - lastX) : mm2;
        sum += Math.max(0, predictFn(x));
      }
      return sum;
    }

    var regressionCount = countReg ? Math.round(actualBeforeCount + curMonthCountEst + projectRemaining(countReg.predict, false)) : null;
    var regressionFee = feeReg ? Math.round(actualBeforeFee + curMonthFeeEst + projectRemaining(feeReg.predict, false)) : null;
    var holtCount = countHolt ? Math.round(actualBeforeCount + curMonthCountEst + projectRemaining(countHolt.predict, true, lastCompleteMonth)) : null;
    var holtFee = feeHolt ? Math.round(actualBeforeFee + curMonthFeeEst + projectRemaining(feeHolt.predict, true, lastCompleteMonth)) : null;

    return {
      year: year, elapsedDays: elapsedDays, totalDays: totalDays,
      ytdCount: ytdCount, ytdFee: ytdFee,
      naiveCount: naiveCount, naiveFee: naiveFee,
      regressionCount: regressionCount, regressionFee: regressionFee,
      holtCount: holtCount, holtFee: holtFee,
      countTrendSlope: countReg ? countReg.slope : null,
      countR2: countReg ? countReg.r2 : null,
      sampleMonths: xs.length,
      byMonth: byMonth, curMonth: curMonth, lastCompleteMonth: lastCompleteMonth,
      countReg: countReg, feeReg: feeReg, countHolt: countHolt, feeHolt: feeHolt
    };
  }

  function goalStorageKey() { return "subdash_goal_v1_" + (state.branch || "ALL") + "__" + (state.agent || "ALL"); }
  function loadGoal() {
    try {
      var raw = localStorage.getItem(goalStorageKey());
      if (raw) { var g = JSON.parse(raw); return { count: g.count, fee: g.fee }; }
    } catch (e) {}
    return { count: null, fee: null };
  }
  function saveGoal(g) { try { localStorage.setItem(goalStorageKey(), JSON.stringify(g)); } catch (e) {} }

  var currentForecast = null;

  function renderGoalBox() {
    currentForecast = computeForecast(branchAgentRecords());

    var fbox = document.getElementById("forecast-box");
    fbox.innerHTML = "";
    fbox.appendChild(el("div", "glabel", "예측 실적 (당월 말일 기준)"));
    if (!currentForecast) {
      fbox.appendChild(el("p", "sub", "예측할 데이터가 없습니다."));
    } else {
      var f = currentForecast;
      var capt = el("p", "sub", f.ym + " · 경과 " + f.elapsedDay + "일 / " + f.daysInMonth + "일");
      capt.style.margin = "0 0 8px";
      fbox.appendChild(capt);
      [
        ["현재 누적 건수", fmt(f.countSoFar) + "건", null],
        ["현재 누적 월정료", fmtFee(f.feeSoFar), null],
        ["예상 월말 건수", fmt(f.forecastCount) + "건", f.momCountPct],
        ["예상 월말 월정료", fmtFee(f.forecastFee), f.momFeePct]
      ].forEach(function (triple) {
        var row = el("div", "fstat");
        row.appendChild(el("span", null, triple[0]));
        var valWrap = document.createElement("span");
        valWrap.className = "fv";
        valWrap.appendChild(document.createTextNode(triple[1]));
        if (triple[2] !== null) {
          valWrap.appendChild(el("span", triple[2] >= 0 ? "delta-up" : "delta-down",
            (triple[2] >= 0 ? " ▲" : " ▼") + Math.abs(triple[2]).toFixed(1) + "%"));
        }
        row.appendChild(valWrap);
        fbox.appendChild(row);
      });
      if (f.hasPrevMonth) {
        var momNote = el("p", "sub", "전월(" + f.pym + ") 실적: " + fmt(f.prevCount) + "건 · " + fmtFee(f.prevFee) + " 대비 이번 달 예상치 증감률입니다.");
        momNote.style.margin = "8px 0 0";
        fbox.appendChild(momNote);
      }

      var yearEnd = computeYearEndForecast(branchAgentRecords());
      if (yearEnd) {
        var yeDivider = document.createElement("div");
        yeDivider.style.cssText = "border-top:1px solid var(--grid-line); margin:12px 0 10px;";
        fbox.appendChild(yeDivider);
        fbox.appendChild(el("div", "glabel", yearEnd.year + "년 말(12/31) 예측 · 예측 방식 비교"));
        var yeCapt = el("p", "sub", "경과 " + yearEnd.elapsedDays + "일 / " + yearEnd.totalDays + "일 · 완료된 " + yearEnd.sampleMonths + "개월 데이터로 추세를 계산합니다");
        yeCapt.style.margin = "0 0 8px";
        fbox.appendChild(yeCapt);

        var ytdRow = el("div", "fstat");
        ytdRow.appendChild(el("span", null, "올해 누적"));
        ytdRow.appendChild(el("span", "fv", fmt(yearEnd.ytdCount) + "건 · " + fmtFee(yearEnd.ytdFee)));
        fbox.appendChild(ytdRow);

        if (yearEnd.countTrendSlope !== null) {
          var dir = yearEnd.countTrendSlope > 0.5 ? "증가" : (yearEnd.countTrendSlope < -0.5 ? "감소" : "보합");
          var trendP = el("p", "sub",
            "선형회귀 기준 월평균 건수가 매월 약 " + fmt(Math.abs(yearEnd.countTrendSlope)) + "건씩 " + dir +
            "하는 추세입니다 (적합도 R² " + yearEnd.countR2.toFixed(2) + ").");
          trendP.style.margin = "6px 0 4px";
          fbox.appendChild(trendP);
        }

        [
          ["단순 연장 (연간 평균 페이스)", yearEnd.naiveCount, yearEnd.naiveFee],
          ["선형회귀 (추세선 연장)", yearEnd.regressionCount, yearEnd.regressionFee],
          ["지수평활 Holt (최근 가중)", yearEnd.holtCount, yearEnd.holtFee]
        ].forEach(function (mr) {
          var row = el("div", "fstat");
          row.appendChild(el("span", null, mr[0]));
          var val = mr[1] != null ? (fmt(mr[1]) + "건 · " + fmtFee(mr[2])) : "데이터 부족";
          row.appendChild(el("span", "fv", val));
          fbox.appendChild(row);
        });

        if (yearEnd.sampleMonths < 4) {
          var caveat = el("p", "sub", "※ 완료된 달이 " + yearEnd.sampleMonths + "개뿐이라 추세 기반 예측(선형회귀·지수평활)의 신뢰도가 낮습니다. 데이터가 쌓일수록 정확해집니다.");
          caveat.style.margin = "8px 0 0";
          fbox.appendChild(caveat);
        }
      }
    }

    var gcInput = document.getElementById("goal-count-input");
    var gfInput = document.getElementById("goal-fee-input");
    if (!gcInput.dataset.wired) {
      gcInput.addEventListener("input", onGoalInput);
      gfInput.addEventListener("input", onGoalInput);
      document.getElementById("auto-goal-btn").addEventListener("click", function () {
        if (!currentForecast) return;
        gcInput.value = Math.ceil(currentForecast.forecastCount / 10) * 10;
        gfInput.value = Math.ceil(currentForecast.forecastFee / 1000 / 100) * 100;
        onGoalInput();
      });
      gcInput.dataset.wired = "1"; gfInput.dataset.wired = "1";
    }
    gcInput.value = state.goal.count != null ? state.goal.count : "";
    gfInput.value = state.goal.fee != null ? Math.round(state.goal.fee / 1000) : "";
    document.getElementById("auto-goal-btn").disabled = !currentForecast;
    var t = document.getElementById("goal-title");
    if (t) t.textContent = (state.branch ? (shortBranch(state.branch) + (state.agent ? (" · " + state.agent) : "")) : (state.hq ? state.hq : "전체")) + " 목표";

    updateGoalMeters();
  }

  function onGoalInput() {
    var gcInput = document.getElementById("goal-count-input");
    var gfInput = document.getElementById("goal-fee-input");
    var c = gcInput.value === "" ? null : Number(gcInput.value);
    var f = gfInput.value === "" ? null : Number(gfInput.value) * 1000;
    state.goal = { count: (c != null && !isNaN(c)) ? c : null, fee: (f != null && !isNaN(f)) ? f : null };
    saveGoal(state.goal);
    updateGoalMeters();
  }

  function updateGoalMeters() {
    var wrap = document.getElementById("goal-meters");
    wrap.innerHTML = "";
    var soFarCount = currentForecast ? currentForecast.countSoFar : 0;
    var soFarFee = currentForecast ? currentForecast.feeSoFar : 0;
    [
      { label: "건수 달성율", value: soFarCount, goal: state.goal.count, unit: "건" },
      { label: "월정료 달성율", value: soFarFee / 1000, goal: state.goal.fee != null ? state.goal.fee / 1000 : null, unit: "천원" }
    ].forEach(function (m) {
      var box = document.createElement("div");
      box.style.marginTop = "10px";
      var rowTop = el("div", "meter-row");
      rowTop.appendChild(el("span", null, m.label));
      if (m.goal == null || m.goal <= 0) {
        rowTop.appendChild(el("span", null, "목표 미설정"));
        box.appendChild(rowTop);
        wrap.appendChild(box);
        return;
      }
      var rate = m.value / m.goal * 100;
      rowTop.appendChild(el("span", null, rate.toFixed(1) + "%"));
      box.appendChild(rowTop);
      var track = el("div", "meter-track");
      var fill = el("div", "meter-fill" + (rate >= 100 ? "" : rate >= 70 ? " warning" : " critical"));
      fill.style.width = Math.min(100, rate) + "%";
      track.appendChild(fill);
      box.appendChild(track);
      box.appendChild(el("div", "meter-row", fmt(m.value) + m.unit + " / 목표 " + fmt(m.goal) + m.unit));
      wrap.appendChild(box);
    });
  }

  // ---------- option bar ----------
  document.querySelectorAll("#metric-toggle button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.metric = btn.getAttribute("data-v");
      document.querySelectorAll("#metric-toggle button").forEach(function (b) { b.classList.toggle("active", b === btn); });
      render();
    });
  });
  document.getElementById("topn-sel").addEventListener("change", function (e) {
    state.topN = Number(e.target.value);
    render();
  });
  document.querySelectorAll("#trend-toggle button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.trendView = btn.getAttribute("data-v");
      document.querySelectorAll("#trend-toggle button").forEach(function (b) { b.classList.toggle("active", b === btn); });
      render();
    });
  });
  document.querySelectorAll("#trend-granularity button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.trendGranularity = btn.getAttribute("data-v");
      document.querySelectorAll("#trend-granularity button").forEach(function (b) { b.classList.toggle("active", b === btn); });
      render();
    });
  });
  document.querySelectorAll("#mline-metric-toggle button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.miniTrendMetric = btn.getAttribute("data-v");
      document.querySelectorAll("#mline-metric-toggle button").forEach(function (b) { b.classList.toggle("active", b === btn); });
      render();
    });
  });
  document.querySelectorAll("#mline-view-toggle button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.miniTrendView = btn.getAttribute("data-v");
      document.querySelectorAll("#mline-view-toggle button").forEach(function (b) { b.classList.toggle("active", b === btn); });
      document.getElementById("mline-split-section").style.display = state.miniTrendView === "split" ? "" : "none";
      document.getElementById("mline-combined-section").style.display = state.miniTrendView === "combined" ? "" : "none";
      render();
    });
  });
  document.getElementById("chip-ma").addEventListener("click", function () {
    state.showMA = !state.showMA;
    this.classList.toggle("active", state.showMA);
    render();
  });
  document.getElementById("chip-ci").addEventListener("click", function () {
    state.showCI = !state.showCI;
    this.classList.toggle("active", state.showCI);
    render();
  });
  document.getElementById("chip-outlier").addEventListener("click", function () {
    state.showOutliers = !state.showOutliers;
    this.classList.toggle("active", state.showOutliers);
    render();
  });
  document.querySelectorAll("#perf-toggle button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.perfMetric = btn.getAttribute("data-v");
      document.querySelectorAll("#perf-toggle button").forEach(function (b) { b.classList.toggle("active", b === btn); });
      render();
    });
  });
  document.querySelectorAll("#yoy-metric-toggle button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.yoyMetric = btn.getAttribute("data-v");
      document.querySelectorAll("#yoy-metric-toggle button").forEach(function (b) { b.classList.toggle("active", b === btn); });
      render();
    });
  });
  document.querySelectorAll("#yoy-mode-toggle button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.yoyMode = btn.getAttribute("data-v");
      document.querySelectorAll("#yoy-mode-toggle button").forEach(function (b) { b.classList.toggle("active", b === btn); });
      render();
    });
  });

  // ---------- branch chart ----------
  function renderBranchChart(records) {
    var groupMode = document.getElementById("branch-group-mode") ? document.getElementById("branch-group-mode").value : "branch";
    var rows = aggregateByBranch(records).sort(function (a, b) { return b[state.metric] - a[state.metric]; });
    var maxTotal = rows.reduce(function (m, r) { return Math.max(m, r[state.metric]); }, 0) || 1;
    document.getElementById("branch-chart-sub").textContent =
      "유지 · 청약(진행) · 취소/해지 " + (state.metric === "fee" ? "월정료" : "건수") + " 기준 · 청약일자 필터만 적용 · 지사명이나 막대를 클릭하면 지사가 선택됩니다";

    var wrap = document.getElementById("branch-chart");
    wrap.innerHTML = "";
    if (rows.length === 0) { wrap.appendChild(el("p", "sub", "표시할 데이터가 없습니다.")); return; }

    function createRow(r) {
      var rowEl = el("div", "branch-row" + (state.branch === r.branch ? " selected" : ""));
      var name = el("div", "bname", shortBranch(r.branch));
      name.style.cursor = "pointer";
      name.addEventListener("click", function () { state.branch = (state.branch === r.branch) ? null : r.branch; state.agent = null; render(); });
      rowEl.appendChild(name);

      var track = el("div", "bartrack");
      track.style.width = (r[state.metric] / maxTotal * 100) + "%";
      STATUSES.forEach(function (s) {
        var v = r.bucket[s][state.metric];
        if (v <= 0) return;
        var seg = el("div", "seg");
        seg.style.background = STATUS_COLOR[s];
        seg.style.flex = v;
        seg.tabIndex = 0;
        seg.setAttribute("role", "button");
        seg.setAttribute("aria-label", shortBranch(r.branch) + " " + STATUS_LABEL[s] + " " + fmtMetric(v, state.metric));
        var ttRows = STATUSES.map(function (st) { return { status: st, value: r.bucket[st][state.metric] }; });
        var title = shortBranch(r.branch) + " · 총 " + fmtMetric(r[state.metric], state.metric);
        seg.addEventListener("pointermove", function (evt) { showTooltip(evt, title, ttRows, s, state.metric); });
        seg.addEventListener("pointerleave", hideTooltip);
        seg.addEventListener("focus", function (evt) { showTooltip(evt, title, ttRows, s, state.metric); });
        seg.addEventListener("blur", hideTooltip);
        seg.addEventListener("click", function () { state.branch = (state.branch === r.branch) ? null : r.branch; state.agent = null; render(); });
        track.appendChild(seg);
      });
      rowEl.appendChild(track);
      rowEl.appendChild(el("div", "btotal", fmtMetric(r[state.metric], state.metric)));
      return rowEl;
    }

    if (groupMode === "hq") {
      var hqMap = {};
      rows.forEach(function(r) {
         var hq = r.hq;
         if(!hqMap[hq]) hqMap[hq] = { hq: hq, rows: [], total: 0 };
         hqMap[hq].rows.push(r);
         hqMap[hq].total += r[state.metric];
      });
      var hqList = Object.keys(hqMap).map(function(k) { return hqMap[k]; });
      hqList.sort(function(a,b) { return b.total - a.total; });
      
      hqList.forEach(function(g) {
         var hqHeader = el("h4", null, g.hq + " (" + fmtMetric(g.total, state.metric) + ")");
         hqHeader.style.marginTop = "20px";
         hqHeader.style.marginBottom = "8px";
         hqHeader.style.fontSize = "14px";
         hqHeader.style.color = "var(--text-secondary)";
         hqHeader.style.borderBottom = "1px solid var(--grid-line)";
         hqHeader.style.paddingBottom = "4px";
         wrap.appendChild(hqHeader);
         g.rows.forEach(function(r) { wrap.appendChild(createRow(r)); });
      });
    } else {
      rows.forEach(function (r) { wrap.appendChild(createRow(r)); });
    }
  }

  // ---------- TOP N leaderboard ----------
  function renderTop10(records) {
    var rows = aggregateByAgent(records).sort(function (a, b) { return b[state.metric] - a[state.metric]; });
    rows = rows.slice(0, state.topN);
    document.getElementById("topn-label").textContent = state.topN;
    var head = document.getElementById("top10-head");
    if (head) {
      head.innerHTML = "";
      head.appendChild(el("span", "sub",
      (state.branch ? shortBranch(state.branch) + " 내 " : (state.hq ? state.hq + " 내 " : "전체 지사 ")) + (state.metric === "fee" ? "월정료" : "건수") + " 기준 상위 영업자 · 청약일자 필터 적용 · 클릭 시 상세보기"
      ));
    }

    var wrap = document.getElementById("top10-chart");
    wrap.innerHTML = "";
    if (rows.length === 0) { wrap.appendChild(el("p", "sub", "표시할 데이터가 없습니다.")); return; }
    var maxV = rows[0][state.metric] || 1;

    rows.forEach(function (r, idx) {
      var rowEl = el("div", "branch-row");
      rowEl.style.gridTemplateColumns = "28px 100px 1fr 100px 76px"; // Added column for sparkline

      var badge = el("span", "rank-badge" + (idx === 0 ? " r1" : idx === 1 ? " r2" : idx === 2 ? " r3" : ""), String(idx + 1));
      rowEl.appendChild(badge);

      var name = el("div", "bname");
      name.appendChild(document.createTextNode(r.agent + " "));
      
      // Quality Badge Check (유지비중 >= 90%)
      var totalCnt = r.bucket["유지"].count + r.bucket["청약취소"].count;
      var convRate = totalCnt > 0 ? (r.bucket["유지"].count / totalCnt * 100) : null;
      if (convRate >= 90) {
        var qBadge = el("span", null, "🌟");
        qBadge.style.fontSize = "10px";
        qBadge.title = "우수 품질 (유지전환율 90%+ : " + convRate.toFixed(1) + "%)";
        name.appendChild(qBadge);
      }

      name.title = shortBranch(r.branch);
      name.style.cursor = "pointer";
      name.addEventListener("click", function () { state.branch = r.branch; state.agent = r.agent; render(); });
      rowEl.appendChild(name);

      var track = el("div", "bartrack");
      track.style.width = (r[state.metric] / maxV * 100) + "%";
      var seg = el("div", "seg");
      seg.style.background = "var(--rank-bar)";
      seg.style.flex = "1";
      seg.tabIndex = 0;
      seg.setAttribute("role", "img");
      var ttRows = STATUSES.map(function (st) { return { status: st, value: r.bucket[st][state.metric] }; });
      var title = shortBranch(r.branch) + " · " + r.agent + " · 총 " + fmtMetric(r[state.metric], state.metric);
      seg.setAttribute("aria-label", title);
      seg.addEventListener("pointermove", function (evt) { showTooltip(evt, title, ttRows, null, state.metric); });
      seg.addEventListener("pointerleave", hideTooltip);
      seg.addEventListener("focus", function (evt) { showTooltip(evt, title, ttRows, null, state.metric); });
      seg.addEventListener("blur", hideTooltip);
      track.appendChild(seg);
      rowEl.appendChild(track);

      // Sparkline
      var sparkWrap = el("div", null);
      sparkWrap.style.width = "90px";
      sparkWrap.style.height = "20px";
      sparkWrap.style.marginTop = "2px";
      
      var yms = Object.keys(r.monthly).sort();
      if (yms.length >= 2) {
        var sparkSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        sparkSvg.setAttribute("viewBox", "0 0 90 20");
        sparkSvg.style.width = "100%";
        sparkSvg.style.height = "100%";
        sparkSvg.style.display = "block";
        
        var mVals = yms.map(function(ym) { return bucketTotal(r.monthly[ym], state.metric); });
        var mMax = Math.max.apply(null, mVals) || 1;
        var pts = mVals.map(function(v, i) {
          return (i / (mVals.length - 1) * 86 + 2) + "," + (18 - (v / mMax) * 16);
        });
        
        var poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        poly.setAttribute("points", pts.join(" "));
        poly.setAttribute("fill", "none");
        poly.setAttribute("stroke", "var(--primary)");
        poly.setAttribute("stroke-width", "2");
        poly.setAttribute("stroke-linecap", "round");
        poly.setAttribute("stroke-linejoin", "round");
        sparkSvg.appendChild(poly);
        sparkWrap.appendChild(sparkSvg);
      } else {
        var noData = el("span", "sub", "데이터부족");
        noData.style.fontSize = "10px";
        sparkWrap.appendChild(noData);
      }
      rowEl.appendChild(sparkWrap);

      rowEl.appendChild(el("div", "btotal", fmtMetric(r[state.metric], state.metric)));
      wrap.appendChild(rowEl);
    });
  }

  // ---------- performance matrix ----------
  function median(nums) {
    if (nums.length === 0) return 0;
    var s = nums.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function perfColor(conv) {
    if (conv >= 90) return "var(--good)";
    if (conv >= 70) return "var(--warning)";
    return "var(--critical)";
  }
  function perfClass(conv) {
    if (conv === null) return "";
    return conv >= 90 ? "cell-good" : conv >= 70 ? "cell-warning" : "cell-critical";
  }
  function cancelClass(rate) {
    if (rate <= 5) return "cell-good";
    if (rate <= 15) return "cell-warning";
    return "cell-critical";
  }
  function perfBadge(conv) {
    if (conv === null) return "⚪ 진행중";
    if (conv >= 90) return "🟢 우수";
    if (conv >= 70) return "🟡 보통";
    return "🔴 관리필요";
  }
  function toSummaryRow(agg) {
    var m = agg.bucket["유지"], p = agg.bucket["청약"], c = agg.bucket["청약취소"];
    var denom = m.count + c.count;
    var out = {
      branch: agg.branch, agent: agg.agent, affiliation: agg.affiliation,
      total: agg.count, fee: agg.fee,
      maintainCount: m.count, maintainFee: m.fee,
      pendingCount: p.count, pendingFee: p.fee,
      cancelCount: c.count, cancelFee: c.fee,
      cancelRate: agg.count ? (c.count / agg.count * 100) : 0,
      conv: denom > 0 ? (m.count / denom * 100) : null
    };
    return out;
  }

  function renderPerfMatrix(records) {
    var rows = agentPerfRows(records);
    var xLabel = state.perfMetric === "전체" ? "유지+청약 건수" : (state.perfMetric === "유지" ? "유지 건수" : "청약(진행) 건수");
    var xOf = function (r) { return state.perfMetric === "전체" ? r.count : (state.perfMetric === "유지" ? r.maintain : r.pending); };

    var plottable = rows.filter(function (r) { return r.conv !== null; });
    var unresolved = rows.length - plottable.length;

    var companyBucket = emptyBucket();
    records.forEach(function (r) { addToBucket(companyBucket, r); });
    var cm = companyBucket["유지"].count, cp = companyBucket["청약"].count;
    var companyRate = (cm + cp) > 0 ? (cm / (cm + cp) * 100) : null;

    var wrap = document.getElementById("perf-scatter");
    var yAxisEl = document.getElementById("perf-yaxis");
    wrap.innerHTML = "";
    yAxisEl.innerHTML = "";
    document.getElementById("perf-quadrant").innerHTML = "";
    document.getElementById("perf-size-sub").textContent = "";

    if (plottable.length === 0) {
      wrap.appendChild(el("p", "sub", "유지/청약 이력이 있는 영업자가 없어 매트릭스를 표시할 수 없습니다."));
      document.getElementById("perf-axis-x").textContent = "";
      document.getElementById("perf-callouts").innerHTML = "";
      return;
    }

    [100, 75, 50, 25, 0].forEach(function (v) { yAxisEl.appendChild(el("span", null, v + "%")); });

    var xVals = plottable.map(xOf);
    var maxX = Math.max.apply(null, xVals) || 1;
    var axisMaxX = maxX * 1.08;
    var medX = median(xVals);
    var medY = companyRate !== null ? companyRate : median(plottable.map(function (r) { return r.conv; }));
    document.getElementById("perf-axis-x").textContent = "→ " + xLabel + " (0 ~ " + fmt(maxX) + ")";
    document.getElementById("perf-axis-sub").textContent =
      "X축: " + xLabel + " · Y축: 유지 비중(%, 취소/해지 제외) · 점 크기: 월정료 · 점선: " +
      (companyRate !== null ? ("전사 평균 유지 비중 " + companyRate.toFixed(1) + "%") : ("유지 비중 중앙값 " + medY.toFixed(1) + "%")) +
      " (가로) · " + xLabel + " 중앙값 " + fmt(medX) + "건 (세로) · 점을 클릭하면 상세보기로 이동합니다";

    var maxFee = plottable.reduce(function (m, r) { return Math.max(m, r.fee); }, 0);
    function bubbleSize(fee) {
      if (maxFee <= 0) return 12;
      return 8 + Math.sqrt(Math.max(0, fee) / maxFee) * 14;
    }
    if (maxFee > 0) {
      document.getElementById("perf-size-sub").textContent = "점 크기는 월정료 규모(클수록 매출 큼) · 가장 큰 점 = " + fmtFee(maxFee);
    }

    // quadrant zone watermarks
    wrap.appendChild(el("div", "scatter-zone z-tr", "핵심 인재"));
    wrap.appendChild(el("div", "scatter-zone z-tl", "안정형"));
    wrap.appendChild(el("div", "scatter-zone z-br", "볼륨 리스크"));
    wrap.appendChild(el("div", "scatter-zone z-bl", "관리 필요"));

    if (medX > 0) {
      var vline = el("div", "scatter-vline");
      vline.style.left = (medX / axisMaxX * 100) + "%";
      wrap.appendChild(vline);
    }
    var hline = el("div", "scatter-hline");
    hline.style.bottom = medY + "%";
    wrap.appendChild(hline);

    var best = plottable.reduce(function (a, b) { return (b.conv > a.conv || (b.conv === a.conv && xOf(b) > xOf(a))) ? b : a; });
    var worst = plottable.reduce(function (a, b) { return (b.conv < a.conv || (b.conv === a.conv && xOf(b) > xOf(a))) ? b : a; });
    var labelAll = plottable.length <= 12;

    var quad = { tr: 0, tl: 0, br: 0, bl: 0 };
    var points = plottable.map(function (r) {
      return { r: r, xPct: (xOf(r) / axisMaxX) * 100, yPct: r.conv, size: bubbleSize(r.fee) };
    });

    points.forEach(function (p) {
      var r = p.r, xPct = p.xPct, yPct = p.yPct, size = p.size;
      var dot = el("div", "scatter-dot");
      dot.style.left = xPct + "%";
      dot.style.bottom = yPct + "%";
      dot.style.width = size + "px";
      dot.style.height = size + "px";
      dot.style.background = perfColor(r.conv);
      dot.tabIndex = 0;
      dot.setAttribute("role", "button");
      var title = shortBranch(r.branch) + " · " + r.agent;
      var ttRows = [
        { status: "유지", value: r.maintain }, { status: "청약", value: r.pending }
      ];
      var tipTitle = title + " · " + xLabel + " " + fmt(xOf(r)) + " · 유지 비중 " + r.conv.toFixed(1) + "% · " + fmtFee(r.fee);
      dot.addEventListener("pointermove", function (evt) { showTooltip(evt, tipTitle, ttRows, null, "count"); });
      dot.addEventListener("pointerleave", hideTooltip);
      dot.addEventListener("focus", function (evt) { showTooltip(evt, tipTitle, ttRows, null, "count"); });
      dot.addEventListener("blur", hideTooltip);
      dot.addEventListener("click", function () { state.branch = r.branch; state.agent = r.agent; render(); });
      wrap.appendChild(dot);

      if (xOf(r) >= medX && yPct >= medY) quad.tr++;
      else if (xOf(r) < medX && yPct >= medY) quad.tl++;
      else if (xOf(r) >= medX && yPct < medY) quad.br++;
      else quad.bl++;
    });

    // labels: place extremes first, then fill in remaining (labelAll) points that don't collide
    var placed = [];
    function tooClose(xPct, yPct) {
      return placed.some(function (p) { return Math.abs(p.xPct - xPct) < 8 && Math.abs(p.yPct - yPct) < 9; });
    }
    function placeLabel(p, text, extreme) {
      var lbl = el("span", "scatter-label" + (p.yPct > 82 ? " below" : "") + (extreme ? "" : " dim"), text);
      lbl.style.left = p.xPct + "%";
      lbl.style.bottom = p.yPct + "%";
      wrap.appendChild(lbl);
      placed.push({ xPct: p.xPct, yPct: p.yPct });
    }

    var bestPoint = points.filter(function (p) { return p.r === best; })[0];
    var worstPoint = points.filter(function (p) { return p.r === worst; })[0];
    if (bestPoint) placeLabel(bestPoint, bestPoint.r.agent + " (최우수)", true);
    if (worstPoint && worstPoint !== bestPoint) placeLabel(worstPoint, worstPoint.r.agent + " (관리필요)", true);

    if (labelAll) {
      points
        .filter(function (p) { return p.r !== best && p.r !== worst; })
        .sort(function (a, b) { return b.yPct - a.yPct; })
        .forEach(function (p) {
          if (!tooClose(p.xPct, p.yPct)) placeLabel(p, p.r.agent, false);
        });
    }

    var quadDefs = [
      { key: "tr", label: "핵심 인재", color: "var(--good)" },
      { key: "tl", label: "안정형", color: "var(--rank-bar)" },
      { key: "br", label: "볼륨 리스크", color: "var(--warning)" },
      { key: "bl", label: "관리 필요", color: "var(--critical)" }
    ];
    var qWrap = document.getElementById("perf-quadrant");
    quadDefs.forEach(function (qd) {
      var chip = el("div", "quadrant-chip");
      var sw = document.createElement("i");
      sw.style.background = qd.color;
      chip.appendChild(sw);
      chip.appendChild(document.createTextNode(qd.label + " "));
      chip.appendChild(el("b", null, String(quad[qd.key]) + "명"));
      qWrap.appendChild(chip);
    });

    var footNote = unresolved > 0
      ? (unresolved + "명은 취소/해지 이력만 있어(유지·청약 이력 없음) 매트릭스에서 제외했습니다.")
      : "";

    // callouts
    var calloutsEl = document.getElementById("perf-callouts");
    calloutsEl.innerHTML = "";
    var withMin3 = plottable.filter(function (r) { return (r.maintain + r.pending) >= 3; });
    var pool = withMin3.length >= 6 ? withMin3 : plottable;
    var sortedDesc = pool.slice().sort(function (a, b) { return b.conv - a.conv || xOf(b) - xOf(a); });
    var top3 = sortedDesc.slice(0, 3);
    var bottom3 = pool.length > 3
      ? sortedDesc.slice(-3).reverse().filter(function (r) { return top3.indexOf(r) === -1; })
      : [];

    function buildCalloutBox(title, icon, list, emptyMsg) {
      var box = el("div", "callout-box");
      box.appendChild(el("div", "cbtitle", icon + " " + title));
      if (list.length === 0) {
        box.appendChild(el("p", "sub", emptyMsg));
      }
      list.forEach(function (r) {
        var row = el("div", "callout-row");
        var left = document.createElement("div");
        left.appendChild(el("div", "cname", r.agent));
        left.appendChild(el("div", "cmeta", shortBranch(r.branch) + " · " + xLabel + " " + fmt(xOf(r)) + "건"));
        row.appendChild(left);
        row.appendChild(el("span", "cval", r.conv.toFixed(1) + "%"));
        row.addEventListener("click", function () { state.branch = r.branch; state.agent = r.agent; render(); });
        box.appendChild(row);
      });
      return box;
    }

    calloutsEl.appendChild(buildCalloutBox("우수 영업자", "🟢", top3, "표시할 데이터가 없습니다."));
    calloutsEl.appendChild(buildCalloutBox("관리 필요 영업자", "🔴", bottom3, pool.length <= 3 ? "표본이 적어 하위 순위는 생략합니다." : "표시할 데이터가 없습니다."));

    if (footNote) {
      var note = el("p", "sub", footNote);
      note.style.gridColumn = "1 / -1";
      note.style.margin = "4px 0 0";
      calloutsEl.appendChild(note);
    }
  }

  // ---------- trend chart ----------
  function renderTrend(records) {
    document.getElementById("trend-title").textContent =
      (state.metric === "fee" ? "월정료" : "건수") + " 추이" +
      (state.branch ? " · " + shortBranch(state.branch) + (state.agent ? " · " + state.agent : "") : (state.hq ? " · " + state.hq : ""));
    var g = state.trendGranularity;
    var buckets = [];
    var seenKey = {};
    ALL_DATES.forEach(function (d) {
      var k = trendBucketKey(d, g);
      if (!seenKey[k]) { seenKey[k] = 1; buckets.push(k); }
    });

    var byBucket = {};
    buckets.forEach(function (k) { byBucket[k] = emptyBucket(); });
    records.forEach(function (r) {
      var k = trendBucketKey(r[3], g);
      if (!byBucket[k]) byBucket[k] = emptyBucket();
      addToBucket(byBucket[k], r);
    });

    var gLabel = g === "year" ? "년별" : (g === "month" ? "월별" : "일별");
    document.getElementById("date-sub").textContent =
      (state.trendView === "cumulative" ? "누적 " : "") + gLabel + " " + (state.metric === "fee" ? "월정료" : "건수") + " 추이" +
      (state.branch ? " · " + shortBranch(state.branch) + (state.agent ? " · " + state.agent : "") : (state.hq ? " · " + state.hq : ""));

    var chartEl = document.getElementById("date-chart");
    var axisEl = document.getElementById("date-axis");
    chartEl.innerHTML = ""; axisEl.innerHTML = "";
    if (buckets.length === 0) { chartEl.appendChild(el("p", "sub", "표시할 데이터가 없습니다.")); return; }
    var perCol = g === "day" ? 34 : (g === "month" ? 56 : 120);
    var minW = Math.max(320, buckets.length * perCol) + "px";
    chartEl.style.minWidth = minW; axisEl.style.minWidth = minW;

    var cum = { "유지": 0, "청약": 0, "청약취소": 0 };
    var series = buckets.map(function (k) {
      var b = byBucket[k];
      var out = {};
      if (state.trendView === "cumulative") {
        STATUSES.forEach(function (s) { cum[s] += b[s][state.metric]; out[s] = cum[s]; });
      } else {
        STATUSES.forEach(function (s) { out[s] = b[s][state.metric]; });
      }
      return { key: k, values: out };
    });
    var maxTotal = series.reduce(function (m, s) {
      return Math.max(m, STATUSES.reduce(function (sum, k2) { return sum + s.values[k2]; }, 0));
    }, 0) || 1;

    var bucketMultiYear = g === "month" && monthsSpanMultiYear(buckets);
    series.forEach(function (s) {
      var total = STATUSES.reduce(function (sum, k2) { return sum + s.values[k2]; }, 0);
      var labelStr = trendBucketLabel(s.key, g, bucketMultiYear);
      var group = el("div", "colgroup");
      STATUSES.forEach(function (st) {
        var v = s.values[st];
        if (v <= 0) return;
        var seg = el("div", "colseg");
        seg.style.background = STATUS_COLOR[st];
        seg.style.height = (v / maxTotal * 100) + "%";
        seg.tabIndex = 0;
        seg.setAttribute("role", "img");
        seg.setAttribute("aria-label", labelStr + " " + STATUS_LABEL[st] + " " + fmtMetric(v, state.metric));
        var ttRows = STATUSES.map(function (k2) { return { status: k2, value: s.values[k2] }; });
        var titleText = labelStr + (state.trendView === "cumulative" ? " (누적) · 총 " : " · 총 ") + fmtMetric(total, state.metric);
        seg.addEventListener("pointermove", function (evt) { showTooltip(evt, titleText, ttRows, st, state.metric); });
        seg.addEventListener("pointerleave", hideTooltip);
        seg.addEventListener("focus", function (evt) { showTooltip(evt, titleText, ttRows, st, state.metric); });
        seg.addEventListener("blur", hideTooltip);
        group.appendChild(seg);
      });
      chartEl.appendChild(group);
      axisEl.appendChild(el("span", null, labelStr));
    });
  }

  // ---------- monthly 유지/청약 analysis ----------
  function buildDeltaCell(cur, prev) {
    var td = document.createElement("td");
    if (prev === null) { td.textContent = "–"; return td; }
    if (prev === 0) { td.textContent = cur > 0 ? "신규" : "–"; return td; }
    var pct = (cur - prev) / prev * 100;
    td.appendChild(el("span", pct >= 0 ? "delta-up" : "delta-down", (pct >= 0 ? "▲" : "▼") + Math.abs(pct).toFixed(1) + "%"));
    return td;
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    var mag = Math.pow(10, Math.floor(Math.log10(v)));
    var norm = v / mag;
    var niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return niceNorm * mag;
  }

  function svgEl(tag, attrs) {
    var e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  function computeProjection(records, months, actualVals) {
    var lastYm = months[months.length - 1];
    var lastYear = lastYm.slice(0, 4);
    var lastMonthNum = Number(lastYm.slice(5, 7));
    var maxDateInRecords = records.reduce(function (m, r) { return r[3] > m ? r[3] : m; }, records[0][3]);
    var daysInLastMonth = new Date(Number(lastYear), lastMonthNum, 0).getDate();
    var lastActualDay = Number(maxDateInRecords.slice(8, 10));
    var isLastMonthComplete = maxDateInRecords.slice(0, 7) === lastYm && lastActualDay >= daysInLastMonth;
    var completeCount = isLastMonthComplete ? months.length : months.length - 1;
    var sameYear = months.every(function (ym) { return ym.slice(0, 4) === lastYear; });

    var projMonths = [];
    if (completeCount >= 2 && lastMonthNum < 12 && sameYear) {
      for (var mm = lastMonthNum + 1; mm <= 12; mm++) {
        projMonths.push(lastYear + "-" + (mm < 10 ? "0" + mm : "" + mm));
      }
    }
    var xsFit = [];
    for (var i = 0; i < completeCount; i++) { xsFit.push(Number(months[i].slice(5, 7))); }
    var fitVals = actualVals.slice(0, completeCount);
    // Exponential Smoothing (AI-lite time series)
    var projVals = [];
    if(projMonths.length && xsFit.length >= 2) {
      var smooth = window.exponentialSmoothing(fitVals, 0.5, 0.3, projMonths.length);
      projVals = smooth.forecasts;
    }

    var reg = null;
    var seFn = null, projLower = [], projUpper = [];
    if (reg && xsFit.length >= 3) {
      var n = xsFit.length;
      var meanX = xsFit.reduce(function (a, b) { return a + b; }, 0) / n;
      var Sxx = xsFit.reduce(function (s, x) { return s + (x - meanX) * (x - meanX); }, 0) || 1;
      var residSS = 0;
      for (var j = 0; j < n; j++) { var pred = reg.predict(xsFit[j]); residSS += Math.pow(fitVals[j] - pred, 2); }
      var rse = Math.sqrt(residSS / Math.max(1, n - 2));
      seFn = function (x0) { return rse * Math.sqrt(1 + 1 / n + Math.pow(x0 - meanX, 2) / Sxx); };
      var Z80 = 1.28;
      projMonths.forEach(function (ym, i) {
        var x0 = Number(ym.slice(5, 7));
        var se = seFn(x0);
        projLower.push(Math.max(0, projVals[i] - Z80 * se));
        projUpper.push(projVals[i] + Z80 * se);
      });
    }

    return {
      projMonths: projMonths, projVals: projVals, completeCount: completeCount, hasProjection: !!reg,
      reg: reg, xsFit: xsFit, fitVals: fitVals, seFn: seFn, projLower: projLower, projUpper: projUpper
    };
  }

  function movingAverage(vals, window) {
    var half = Math.floor(window / 2);
    return vals.map(function (_, i) {
      var lo = Math.max(0, i - half), hi = Math.min(vals.length - 1, i + half);
      var sum = 0, n = 0;
      for (var k = lo; k <= hi; k++) { sum += vals[k]; n++; }
      return sum / n;
    });
  }

  function detectOutliers(vals, completeCount, threshold) {
    var xs = vals.slice(0, completeCount);
    var n = xs.length;
    if (n < 4) return [];
    var mean = xs.reduce(function (a, b) { return a + b; }, 0) / n;
    var variance = xs.reduce(function (s, v) { return s + Math.pow(v - mean, 2); }, 0) / n;
    var std = Math.sqrt(variance);
    if (std === 0) return [];
    var out = [];
    xs.forEach(function (v, i) {
      var z = (v - mean) / std;
      if (Math.abs(z) >= threshold) out.push({ index: i, value: v, z: z, mean: mean, pct: mean !== 0 ? ((v - mean) / mean * 100) : 0 });
    });
    return out;
  }

  function renderMiniLineChart(prefix, months, actualVals, colorVar, seriesKey, proj, metric, tooltipRowsFn) {
    var svg = document.getElementById("mline-" + prefix + "-svg");
    var yAxisEl = document.getElementById("mline-" + prefix + "-yaxis");
    var hitRow = document.getElementById("mline-" + prefix + "-hitrow");
    var axisXEl = document.getElementById("mline-" + prefix + "-axis-x");
    var crosshair = document.getElementById("mline-" + prefix + "-crosshair");
    var plotEl = document.getElementById("mline-" + prefix + "-plot");
    var projNoteEl = document.getElementById("mline-" + prefix + "-proj-note");
    svg.innerHTML = ""; yAxisEl.innerHTML = ""; hitRow.innerHTML = ""; axisXEl.innerHTML = "";
    crosshair.classList.remove("show");
    var staleMsg = plotEl.querySelector(".mline-empty-msg");
    if (staleMsg) staleMsg.remove();

    if (months.length === 0) {
      var msg = el("p", "sub mline-empty-msg", "표시할 데이터가 없습니다.");
      plotEl.appendChild(msg);
      projNoteEl.textContent = "";
      return;
    }

    var projMonths = proj.projMonths, projVals = proj.projVals, hasProjection = proj.hasProjection, completeCount = proj.completeCount;
    var allMonths = hasProjection ? months.concat(projMonths) : months.slice();
    var monthMultiYear = monthsSpanMultiYear(allMonths);
    var colMinW = Math.max(280, allMonths.length * 42) + "px";
    plotEl.style.minWidth = colMinW;
    axisXEl.style.minWidth = colMinW;

    var ciOn = state.showCI && proj.projUpper && proj.projUpper.length > 0;
    var rawMax = Math.max.apply(null, actualVals.concat(projVals).concat(ciOn ? proj.projUpper : []));
    var maxCount = metric === "fee" ? niceMax(rawMax / 1000) * 1000 : niceMax(rawMax);
    [1, 0.75, 0.5, 0.25, 0].forEach(function (f) {
      yAxisEl.appendChild(el("span", null, metric === "fee" ? fmt(Math.round(maxCount * f / 1000)) + "천" : fmt(Math.round(maxCount * f))));
    });

    var W = plotEl.clientWidth || 600, H = plotEl.clientHeight || 260;
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    var padX = allMonths.length > 1 ? 24 : 300;
    var usableW = W - padX * 2;
    function xAt(i) { return allMonths.length > 1 ? padX + (i / (allMonths.length - 1)) * usableW : W / 2; }
    function yAt(v) { return H - (v / maxCount) * H; }

    [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
      var y = H - f * H;
      svg.appendChild(svgEl("line", { x1: 0, x2: W, y1: y, y2: y, stroke: "var(--border)", "stroke-width": 1, "stroke-dasharray": "4,4", opacity: "0.6" }));
    });
    if (hasProjection) {
      var splitX = xAt(months.length - 1);
      svg.appendChild(svgEl("line", { x1: splitX, x2: splitX, y1: 0, y2: H, stroke: "var(--text-muted)", "stroke-width": 1.5, "stroke-dasharray": "5,5", opacity: "0.8" }));
    }

    if (ciOn) {
      var lastIdxCi = actualVals.length - 1;
      var bandPts = [xAt(lastIdxCi) + "," + yAt(actualVals[lastIdxCi])];
      proj.projUpper.forEach(function (v, i) { bandPts.push(xAt(lastIdxCi + 1 + i) + "," + yAt(v)); });
      for (var bi = proj.projLower.length - 1; bi >= 0; bi--) { bandPts.push(xAt(lastIdxCi + 1 + bi) + "," + yAt(proj.projLower[bi])); }
      bandPts.push(xAt(lastIdxCi) + "," + yAt(actualVals[lastIdxCi]));
      svg.appendChild(svgEl("polygon", { points: bandPts.join(" "), fill: colorVar, opacity: "0.12", stroke: "none" }));
      var ciLabelX = xAt(allMonths.length - 1);
      var ciLabelY = yAt(proj.projUpper[proj.projUpper.length - 1]);
      var ciText = svgEl("text", { x: ciLabelX - 4, y: ciLabelY - 6, "text-anchor": "end", "font-size": 10.5, fill: "var(--text-muted)" });
      ciText.textContent = "80% 신뢰구간";
      svg.appendChild(ciText);
    }

    var defs = svgEl("defs");
    var gradId = "grad-" + prefix + "-" + Math.floor(Math.random() * 10000);
    var grad = svgEl("linearGradient", { id: gradId, x1: "0%", y1: "0%", x2: "0%", y2: "100%" });
    grad.appendChild(svgEl("stop", { offset: "0%", "stop-color": colorVar, "stop-opacity": "0.45" }));
    grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": colorVar, "stop-opacity": "0.0" }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    if (actualVals.length >= 2) {
      var pts = actualVals.map(function (v, i) { return xAt(i) + "," + yAt(v); });
      var poly = [xAt(0) + "," + H].concat(pts).concat([xAt(actualVals.length - 1) + "," + H]);
      svg.appendChild(svgEl("polygon", { points: poly.join(" "), fill: "url(#" + gradId + ")", stroke: "none" }));
    }

    var maOn = state.showMA && actualVals.length >= 3;
    if (maOn) {
      var maVals = movingAverage(actualVals, 3);
      var maPts = maVals.map(function (v, i) { return xAt(i) + "," + yAt(v); }).join(" ");
      svg.appendChild(svgEl("polyline", {
        points: maPts, fill: "none", stroke: "var(--text-secondary)", "stroke-width": 2,
        "stroke-dasharray": "1,4", "stroke-linecap": "round", opacity: "0.85"
      }));
    }

    var linePts = actualVals.map(function (v, i) { return xAt(i) + "," + yAt(v); }).join(" ");
    svg.appendChild(svgEl("polyline", {
      points: linePts, fill: "none", stroke: colorVar, "stroke-width": 3.5,
      "stroke-linejoin": "round", "stroke-linecap": "round"
    }));
    var outliers = state.showOutliers ? detectOutliers(actualVals, completeCount, 1.5) : [];
    var outlierIdx = {};
    outliers.forEach(function (o) { outlierIdx[o.index] = o; });
    actualVals.forEach(function (v, i) {
      if (outlierIdx[i]) {
        svg.appendChild(svgEl("circle", {
          cx: xAt(i), cy: yAt(v), r: 10, fill: "none", stroke: "var(--critical)", "stroke-width": 2.5, "stroke-dasharray": "2,2"
        }));
      }
      svg.appendChild(svgEl("circle", {
        cx: xAt(i), cy: yAt(v), r: 5.5, fill: "var(--surface-1)", stroke: colorVar, "stroke-width": 2.5
      }));
    });
    if (projVals.length) {
      var lastIdx = actualVals.length - 1;
      var projPts = [xAt(lastIdx) + "," + yAt(actualVals[lastIdx])];
      projVals.forEach(function (v, i) { projPts.push(xAt(lastIdx + 1 + i) + "," + yAt(v)); });
      svg.appendChild(svgEl("polyline", {
        points: projPts.join(" "), fill: "none", stroke: colorVar, "stroke-width": 3, opacity: "0.5",
        "stroke-dasharray": "7,5", "stroke-linejoin": "round", "stroke-linecap": "round"
      }));
      projVals.forEach(function (v, i) {
        svg.appendChild(svgEl("circle", {
          cx: xAt(lastIdx + 1 + i), cy: yAt(v), r: 4.5, fill: "var(--surface-1)", stroke: colorVar, "stroke-width": 2, opacity: "0.85"
        }));
      });
    }
    if (actualVals.length) {
      var li = actualVals.length - 1;
      var text = fmtMetric(actualVals[li], metric);
      var lx = xAt(li);
      var above = yAt(actualVals[li]) - 22;
      var ly = above - 12 < 4 ? yAt(actualVals[li]) + 26 : above;
      var estWidth = text.length * 8.5 + 20;
      
      var filterId = "drop-shadow-" + prefix;
      var filter = svgEl("filter", { id: filterId, x: "-20%", y: "-20%", width: "140%", height: "140%" });
      filter.appendChild(svgEl("feDropShadow", { dx: 0, dy: 3, stdDeviation: 3, "flood-color": "#000", "flood-opacity": "0.3" }));
      defs.appendChild(filter);

      svg.appendChild(svgEl("rect", { 
        x: lx - estWidth / 2, y: ly - 14, width: estWidth, height: 26, rx: 13, 
        fill: "var(--surface-1)", stroke: "var(--border)", "stroke-width": 1,
        filter: "url(#" + filterId + ")"
      }));
      var t = svgEl("text", { x: lx, y: ly + 5, "text-anchor": "middle", "font-size": 13.5, "font-weight": 700, fill: "var(--text-primary)" });
      t.textContent = text;
      svg.appendChild(t);
    }

    allMonths.forEach(function (ym, i) {
      var isProj = i >= months.length;
      var hit = el("div", "mline-hit");
      var label = trendBucketLabel(ym, "month", monthMultiYear);
      var v = isProj ? projVals[i - months.length] : actualVals[i];
      var ttRows = tooltipRowsFn ? tooltipRowsFn(i, isProj) : [{ status: seriesKey, value: v }];
      var ttTitle = label + (isProj ? " (예측)" : "");
      hit.addEventListener("pointermove", function (evt) {
        crosshair.style.left = (xAt(i) / W * 100) + "%";
        crosshair.classList.add("show");
        showTooltip(evt, ttTitle, ttRows, null, metric);
      });
      hit.addEventListener("pointerleave", function () { crosshair.classList.remove("show"); hideTooltip(); });
      hitRow.appendChild(hit);
      axisXEl.appendChild(el("span", isProj ? "proj-label" : null, label));
    });

    projNoteEl.innerHTML = "";
    if (hasProjection) {
      var line1 = "점선 구간(" + trendBucketLabel(projMonths[0], "month", monthMultiYear) + "~" + trendBucketLabel(projMonths[projMonths.length - 1], "month", monthMultiYear) + ")은 완료된 " + completeCount + "개월 실적에 지수평활(Exponential Smoothing) AI 알고리즘을 적용한 미래 예측치입니다.";
      if (ciOn) line1 += " 음영은 80% 신뢰구간으로, 미래로 갈수록 불확실성이 커져 범위가 넓어집니다.";
      projNoteEl.appendChild(el("div", null, line1));
    }
    if (maOn) {
      projNoteEl.appendChild(el("div", null, "점선(···)은 3개월 이동평균으로 월별 변동을 부드럽게 표시한 보조선입니다."));
    }
    if (outliers.length) {
      var outlierText = "이상치 감지: " + outliers.map(function (o) {
        return trendBucketLabel(months[o.index], "month", monthMultiYear) + "(평균 대비 " + (o.pct >= 0 ? "+" : "") + o.pct.toFixed(1) + "%)";
      }).join(", ") + " — 다른 달과 통계적으로 유의하게 다른 값입니다(표준편차 1.5배 이상).";
      var outlierP = el("div", null, outlierText);
      outlierP.style.color = "var(--critical)";
      projNoteEl.appendChild(outlierP);
    }
  }

  function renderMonthlyTrendCharts(records) {
    var byMonth = {};
    records.forEach(function (r) {
      var ym = r[3].slice(0, 7);
      if (!byMonth[ym]) byMonth[ym] = emptyBucket();
      addToBucket(byMonth[ym], r);
    });
    var months = Object.keys(byMonth).sort();
    var monthMultiYear = monthsSpanMultiYear(months);

    var feeChartEl = document.getElementById("mfee-chart");
    var feeAxisEl = document.getElementById("mfee-axis");
    feeChartEl.innerHTML = ""; feeAxisEl.innerHTML = "";

    var metric = state.miniTrendMetric;
    var view = state.miniTrendView;
    document.getElementById("mline-maintain-title").textContent = "월별 유지 " + (metric === "fee" ? "월정료" : "건수") + " 추이";
    document.getElementById("mline-pending-title").textContent = "월별 청약(진행) " + (metric === "fee" ? "월정료" : "건수") + " 추이";
    document.getElementById("mline-combined-title").textContent = "월별 유지+청약 합계 " + (metric === "fee" ? "월정료" : "건수") + " 추이";
    document.getElementById("mline-scale-note").textContent = "두 차트는 각자의 " + (metric === "fee" ? "월정료" : "건수") +
      " 규모에 맞춰 축을 따로 조정했습니다 (같은 축을 쓰면 청약 값이 유지 값에 눌려 잘 보이지 않습니다).";

    if (months.length === 0) {
      renderMiniLineChart("maintain", [], [], "var(--good)", "유지", {}, metric);
      renderMiniLineChart("pending", [], [], "var(--warning)", "청약", {}, metric);
      renderMiniLineChart("combined", [], [], "var(--rank-bar)", null, {}, metric);
      feeChartEl.appendChild(el("p", "sub", "표시할 데이터가 없습니다."));
      return;
    }

    var maintainVals = months.map(function (ym) { return byMonth[ym]["유지"][metric]; });
    var pendingVals = months.map(function (ym) { return byMonth[ym]["청약"][metric]; });
    var feeVals = months.map(function (ym) { return bucketTotal(byMonth[ym], "fee"); });

    var maintainProj = computeProjection(records, months, maintainVals);
    var pendingProj = computeProjection(records, months, pendingVals);

    if (view === "split") {
      renderMiniLineChart("maintain", months, maintainVals, "var(--good)", "유지", maintainProj, metric);
      renderMiniLineChart("pending", months, pendingVals, "var(--warning)", "청약", pendingProj, metric);
    } else {
      var combinedVals = maintainVals.map(function (v, i) { return v + pendingVals[i]; });
      var combinedProj = computeProjection(records, months, combinedVals);
      renderMiniLineChart("combined", months, combinedVals, "var(--rank-bar)", null, combinedProj, metric, function (i, isProj) {
        var mv = isProj ? maintainProj.projVals[i - months.length] : maintainVals[i];
        var pv = isProj ? pendingProj.projVals[i - months.length] : pendingVals[i];
        return [{ status: "유지", value: mv }, { status: "청약", value: pv }];
      });
    }

    var maxFee = (Math.max.apply(null, feeVals) || 1) * 1.25;
    var minW = Math.max(320, months.length * 84) + "px";
    feeChartEl.style.minWidth = minW; feeAxisEl.style.minWidth = minW;
    months.forEach(function (ym, i) {
      var group = el("div", "colgroup");
      var heightPct = feeVals[i] / maxFee * 100;
      var seg = el("div", "colseg");
      seg.style.background = "var(--rank-bar)";
      seg.style.height = heightPct + "%";
      seg.tabIndex = 0;
      seg.setAttribute("role", "img");
      var label = trendBucketLabel(ym, "month", monthMultiYear);
      seg.setAttribute("aria-label", label + " 월정료 " + fmtFee(feeVals[i]));
      var tipTitle = label + " · 월정료 " + fmtFee(feeVals[i]);
      seg.addEventListener("pointermove", function (evt) { showTooltip(evt, tipTitle, [], null, "count"); });
      seg.addEventListener("pointerleave", hideTooltip);
      seg.addEventListener("focus", function (evt) { showTooltip(evt, tipTitle, [], null, "count"); });
      seg.addEventListener("blur", hideTooltip);
      group.appendChild(seg);
      var valLabel = el("span", "col-value-label", fmtFee(feeVals[i]));
      valLabel.style.bottom = heightPct + "%";
      group.appendChild(valLabel);
      feeChartEl.appendChild(group);
      feeAxisEl.appendChild(el("span", null, label));
    });
  }

  function renderMonthlyAnalysis(records) {
    document.getElementById("month-anal-title").textContent =
      "월별 상세 분석" + (state.branch ? " · " + shortBranch(state.branch) + (state.agent ? " · " + state.agent : "") : (state.hq ? " · " + state.hq : ""));
    var sub = document.getElementById("month-anal-sub");
    if (sub) sub.textContent =
      "월별 유지·청약·취소/해지 건수와 전월 대비 증감입니다" + (state.branch ? " · " + shortBranch(state.branch) + (state.agent ? " · " + state.agent : "") : (state.hq ? " · " + state.hq : "")) + ".";

    var byMonth = {};
    records.forEach(function (r) {
      var ym = r[3].slice(0, 7);
      if (!byMonth[ym]) byMonth[ym] = emptyBucket();
      addToBucket(byMonth[ym], r);
    });
    var months = Object.keys(byMonth).sort();
    var monthMultiYear = monthsSpanMultiYear(months);

    var tbody = document.getElementById("monthly-analysis-tbody");
    tbody.innerHTML = "";
    if (months.length === 0) {
      var tr0 = el("tr", "empty-row");
      var td0 = el("td", null, "표시할 데이터가 없습니다.");
      td0.colSpan = 11;
      tr0.appendChild(td0);
      tbody.appendChild(tr0);
      return;
    }

    var prevMaintain = null, prevPending = null, prevTotal = null;
    var bestIncTotal = null, bestDecTotal = null;
    months.forEach(function (ym) {
      var b = byMonth[ym];
      var maintain = b["유지"].count, pending = b["청약"].count, cancel = b["청약취소"].count;
      var maintainFee = b["유지"].fee, pendingFee = b["청약"].fee, cancelFee = b["청약취소"].fee;
      var total = maintain + pending + cancel;
      var totalFee = maintainFee + pendingFee + cancelFee;
      var tr = document.createElement("tr");
      tr.appendChild(el("td", null, trendBucketLabel(ym, "month", monthMultiYear)));
      tr.appendChild(el("td", null, fmt(maintain)));
      tr.appendChild(el("td", null, fmtFee(maintainFee)));
      tr.appendChild(buildDeltaCell(maintain, prevMaintain));
      tr.appendChild(el("td", null, fmt(pending)));
      tr.appendChild(el("td", null, fmtFee(pendingFee)));
      tr.appendChild(buildDeltaCell(pending, prevPending));
      tr.appendChild(el("td", null, fmt(cancel)));
      tr.appendChild(el("td", null, fmtFee(cancelFee)));
      tr.appendChild(el("td", null, fmt(total)));
      tr.appendChild(el("td", null, fmtFee(totalFee)));
      tbody.appendChild(tr);
      if (prevTotal !== null && prevTotal > 0) {
        var pct = (total - prevTotal) / prevTotal * 100;
        if (!bestIncTotal || pct > bestIncTotal.pct) bestIncTotal = { ym: ym, pct: pct };
        if (!bestDecTotal || pct < bestDecTotal.pct) bestDecTotal = { ym: ym, pct: pct };
      }
      prevMaintain = maintain; prevPending = pending; prevTotal = total;
    });

    var momEl = document.getElementById("monthly-mom-note");
    if (bestIncTotal && bestDecTotal) {
      momEl.innerHTML = "";
      momEl.appendChild(document.createTextNode("MoM(전월 대비) 총건수 최대 증가: " + trendBucketLabel(bestIncTotal.ym, "month", monthMultiYear) + " "));
      momEl.appendChild(el("span", "delta-up", "▲" + bestIncTotal.pct.toFixed(1) + "%"));
      momEl.appendChild(document.createTextNode(" · 최대 감소: " + trendBucketLabel(bestDecTotal.ym, "month", monthMultiYear) + " "));
      momEl.appendChild(el("span", "delta-down", "▼" + Math.abs(bestDecTotal.pct).toFixed(1) + "%"));
    } else {
      momEl.textContent = "";
    }
  }

  // ---------- year-over-year comparison ----------
  var YOY_COLORS = ["var(--rank-bar)", "var(--cat-2)", "var(--cat-3)"];
  function renderYoyDeltaBars(byYM, activeYears, metric, els) {
    var svg = els.svg, yAxisEl = els.yAxisEl, hitRow = els.hitRow, axisXEl = els.axisXEl,
      crosshair = els.crosshair, plotEl = els.plotEl, legendEl = els.legendEl;
    var noteEl = document.getElementById("yoy-note");

    if (activeYears.length < 2) {
      var msg = el("p", "sub mline-empty-msg", "YoY 비교에는 연도가 2개 필요합니다. 위에서 연도를 2개 선택하세요.");
      plotEl.appendChild(msg);
      noteEl.textContent = "";
      return;
    }
    var prevY = activeYears[activeYears.length - 2];
    var curY = activeYears[activeYears.length - 1];

    var maxDate = ALL_DATES[ALL_DATES.length - 1];
    var maxYear = maxDate.slice(0, 4);
    var maxMonth = Number(maxDate.slice(5, 7));
    var daysInLastMonth = new Date(Number(maxYear), maxMonth, 0).getDate();
    var lastActualDay = Number(maxDate.slice(8, 10));
    var curYIsPartial = curY === maxYear && lastActualDay < daysInLastMonth;

    var months = [];
    for (var m = 1; m <= 12; m++) {
      var isFuture = curY > maxYear || (curY === maxYear && m > maxMonth);
      if (isFuture) continue;
      var pYm = prevY + "-" + (m < 10 ? "0" + m : "" + m);
      var cYm = curY + "-" + (m < 10 ? "0" + m : "" + m);
      var pB = byYM[pYm], cB = byYM[cYm];
      if (!pB) continue;
      var prevVal = bucketTotal(pB, metric);
      var curVal = cB ? bucketTotal(cB, metric) : 0;
      if (prevVal === 0) continue;
      var pct = (curVal - prevVal) / prevVal * 100;
      months.push({ m: m, prevVal: prevVal, curVal: curVal, pct: pct, isPartial: curYIsPartial && m === maxMonth });
    }

    if (months.length === 0) {
      var msg2 = el("p", "sub mline-empty-msg", "비교 가능한 달이 없습니다.");
      plotEl.appendChild(msg2);
      noteEl.textContent = "";
      return;
    }

    var maxAbsPct = Math.max.apply(null, months.map(function (x) { return Math.abs(x.pct); }).concat([10]));
    var axisMax = niceMax(maxAbsPct * 1.1);

    [1, 0.5, 0, -0.5, -1].forEach(function (f) {
      yAxisEl.appendChild(el("span", null, (f > 0 ? "+" : "") + Math.round(axisMax * f) + "%"));
    });

    var colMinW = Math.max(280, 12 * 42) + "px";
    plotEl.style.minWidth = colMinW;
    axisXEl.style.minWidth = colMinW;

    var W = plotEl.clientWidth || 600, H = plotEl.clientHeight || 260, padX = 24;
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    var usableW = W - padX * 2;
    function xAt(i) { return padX + (i / 11) * usableW; }
    function yAt(v) { return H / 2 - (v / axisMax) * (H / 2); }

    [1, 0.5, 0, -0.5, -1].forEach(function (f) {
      var y = H / 2 - f * (H / 2);
      svg.appendChild(svgEl("line", { x1: 0, x2: W, y1: y, y2: y, stroke: f === 0 ? "var(--baseline)" : "var(--grid-line)", "stroke-width": f === 0 ? 1.5 : 1 }));
    });

    var barW = (usableW / 11) * 0.42;
    var y0 = yAt(0);
    months.forEach(function (mo) {
      var i = mo.m - 1;
      var cx = xAt(i);
      var yv = yAt(mo.pct);
      var top = Math.min(y0, yv), h = Math.max(Math.abs(yv - y0), 1.5);
      var color = mo.pct >= 0 ? "var(--good)" : "var(--critical)";
      svg.appendChild(svgEl("rect", {
        x: cx - barW / 2, y: top, width: barW, height: h, rx: 2, fill: color, opacity: mo.isPartial ? 0.45 : 1
      }));
      var text = (mo.pct >= 0 ? "▲" : "▼") + Math.abs(mo.pct).toFixed(1) + "%";
      var ly = mo.pct >= 0 ? top - 8 : top + h + 16;
      var t = svgEl("text", { x: cx, y: ly, "text-anchor": "middle", "font-size": 12, "font-weight": 650, fill: color });
      t.textContent = text;
      svg.appendChild(t);
    });

    var monthByIdx = {};
    months.forEach(function (mo) { monthByIdx[mo.m - 1] = mo; });
    var _loop2 = function (mm) {
      var idx = mm - 1;
      var hit = el("div", "mline-hit");
      var mo2 = monthByIdx[idx];
      if (mo2) {
        hit.addEventListener("pointermove", function (evt) {
          crosshair.style.left = (xAt(idx) / W * 100) + "%";
          crosshair.classList.add("show");
          showColorTooltip(evt, mm + "월" + (mo2.isPartial ? " (진행중)" : ""), [
            { label: prevY + "년", value: mo2.prevVal, color: "var(--text-muted)", metric: metric },
            { label: curY + "년", value: mo2.curVal, color: "var(--text-muted)", metric: metric },
            { label: "YoY", value: (mo2.pct >= 0 ? "+" : "") + mo2.pct.toFixed(1) + "%", color: mo2.pct >= 0 ? "var(--good)" : "var(--critical)", metric: "text" }
          ]);
        });
        hit.addEventListener("pointerleave", function () { crosshair.classList.remove("show"); hideTooltip(); });
      }
      hitRow.appendChild(hit);
      axisXEl.appendChild(el("span", null, mm + "월"));
    };
    for (var mm = 1; mm <= 12; mm++) _loop2(mm);

    var maxInc = months.reduce(function (a, b) { return b.pct > a.pct ? b : a; });
    var maxDec = months.reduce(function (a, b) { return b.pct < a.pct ? b : a; });
    function addChip(text, value, color) {
      var chip = el("div", "quadrant-chip");
      var sw = document.createElement("i");
      sw.style.background = color;
      chip.appendChild(sw);
      chip.appendChild(document.createTextNode(text + " "));
      chip.appendChild(el("b", null, value));
      legendEl.appendChild(chip);
    }
    addChip(prevY + "→" + curY + "년", "비교 " + months.length + "개월", "var(--text-muted)");
    addChip("최대 증가", maxInc.m + "월 +" + maxInc.pct.toFixed(1) + "%", "var(--good)");
    addChip("최대 감소", maxDec.m + "월 " + maxDec.pct.toFixed(1) + "%", "var(--critical)");

    var partialMo = months.filter(function (mo) { return mo.isPartial; })[0];
    noteEl.textContent = partialMo
      ? curY + "년 " + partialMo.m + "월은 " + lastActualDay + "일까지의 데이터로 아직 진행 중입니다 — 해당 달의 YoY 증감률은 참고용입니다."
      : "";
  }

  function renderYoyChart(records) {
    var byYM = {};
    records.forEach(function (r) {
      var ym = r[3].slice(0, 7);
      if (!byYM[ym]) byYM[ym] = emptyBucket();
      addToBucket(byYM[ym], r);
    });

    var yearsPresent = {};
    ALL_DATES.forEach(function (d) { yearsPresent[d.slice(0, 4)] = 1; });
    var years = Object.keys(yearsPresent).sort();

    var svg = document.getElementById("yoy-svg");
    var yAxisEl = document.getElementById("yoy-yaxis");
    var hitRow = document.getElementById("yoy-hitrow");
    var axisXEl = document.getElementById("yoy-axis-x");
    var crosshair = document.getElementById("yoy-crosshair");
    var plotEl = document.getElementById("yoy-plot");
    var legendEl = document.getElementById("yoy-legend");
    var yearToggleEl = document.getElementById("yoy-year-toggle");
    svg.innerHTML = ""; yAxisEl.innerHTML = ""; hitRow.innerHTML = ""; axisXEl.innerHTML = ""; legendEl.innerHTML = "";
    crosshair.classList.remove("show");
    var staleMsg = plotEl.querySelector(".yoy-empty-msg");
    if (staleMsg) staleMsg.remove();

    var indexMode = state.yoyMode === "index";
    var yoyDeltaMode = state.yoyMode === "yoy";
    var scopeSuffix = (state.branch ? " · " + shortBranch(state.branch) + (state.agent ? " · " + state.agent : "") : (state.hq ? " · " + state.hq : "")) + ".";
    document.getElementById("yoy-sub").textContent = yoyDeltaMode
      ? "같은 달을 전년과 비교해 증감률이 큰 달을 찾습니다(YoY = 전년 동월 대비)" + scopeSuffix
      : indexMode
      ? "월별 값을 그 해 평균 대비 비율로 환산해 연도 간 규모 차이를 배제하고 계절 패턴만 비교합니다(100=그 해 평균)" + scopeSuffix
      : "같은 달을 연도별로 겹쳐서 비교합니다" + scopeSuffix;

    yearToggleEl.innerHTML = "";
    if (years.length === 0) {
      var msg0 = el("p", "sub mline-empty-msg", "표시할 데이터가 없습니다.");
      plotEl.appendChild(msg0);
      return;
    }

    if (!state.yoyYears) state.yoyYears = {};
    years.forEach(function (y) { if (!(y in state.yoyYears)) state.yoyYears[y] = true; });

    years.forEach(function (y) {
      var btn = el("button", "chip" + (state.yoyYears[y] ? " active" : ""), y + "년");
      btn.addEventListener("click", function () {
        state.yoyYears[y] = !state.yoyYears[y];
        render();
      });
      yearToggleEl.appendChild(btn);
    });

    var activeYears = years.filter(function (y) { return state.yoyYears[y]; });
    var metric = state.yoyMetric;

    if (activeYears.length === 0) {
      var msg1 = el("p", "sub mline-empty-msg", "비교할 연도를 선택하세요.");
      plotEl.appendChild(msg1);
      return;
    }

    if (yoyDeltaMode) {
      renderYoyDeltaBars(byYM, activeYears, metric, { svg: svg, yAxisEl: yAxisEl, hitRow: hitRow, axisXEl: axisXEl, crosshair: crosshair, plotEl: plotEl, legendEl: legendEl });
      return;
    }

    var maxDate = ALL_DATES[ALL_DATES.length - 1];
    var maxYear = maxDate.slice(0, 4);
    var maxMonth = Number(maxDate.slice(5, 7));
    var daysInLastMonthGlobal = new Date(Number(maxYear), maxMonth, 0).getDate();
    var lastActualDayGlobal = Number(maxDate.slice(8, 10));

    var series = activeYears.map(function (y, idx) {
      var vals = [];
      for (var m = 1; m <= 12; m++) {
        var isFuture = y > maxYear || (y === maxYear && m > maxMonth);
        if (isFuture) { vals.push(null); continue; }
        var ym = y + "-" + (m < 10 ? "0" + m : "" + m);
        var b = byYM[ym];
        vals.push(b ? bucketTotal(b, metric) : 0);
      }
      return { year: y, vals: vals, color: YOY_COLORS[idx % YOY_COLORS.length] };
    });

    var currentMonthPartial = lastActualDayGlobal < daysInLastMonthGlobal;
    series.forEach(function (s) {
      var avgIdx = [];
      s.vals.forEach(function (v, i) { if (v !== null) avgIdx.push(i); });
      s.partialExcluded = false;
      if (currentMonthPartial && s.year === maxYear) {
        var lastMonthIdx = maxMonth - 1;
        var pos = avgIdx.indexOf(lastMonthIdx);
        if (pos !== -1 && avgIdx.length > 1) { avgIdx.splice(pos, 1); s.partialExcluded = true; }
      }
      var sum = avgIdx.reduce(function (acc, i) { return acc + s.vals[i]; }, 0);
      s.avg = avgIdx.length ? sum / avgIdx.length : 0;
      s.lastCompleteMonth = avgIdx.length ? (Math.max.apply(null, avgIdx) + 1) : 0;
      if (indexMode) {
        s.vals = s.vals.map(function (v) { return v === null ? null : (s.avg > 0 ? (v / s.avg * 100) : 0); });
      }
    });

    var tooltipMetric = indexMode ? "percent" : metric;
    var allVals = [];
    series.forEach(function (s) { s.vals.forEach(function (v) { if (v !== null) allVals.push(v); }); });
    if (indexMode) allVals.push(100);
    var rawMax = allVals.length ? Math.max.apply(null, allVals) : 0;
    var maxVal = indexMode ? niceMax(rawMax * 1.05) : (metric === "fee" ? niceMax(rawMax / 1000) * 1000 : niceMax(rawMax));
    if (maxVal <= 0) maxVal = 1;

    [1, 0.75, 0.5, 0.25, 0].forEach(function (f) {
      var val = maxVal * f;
      yAxisEl.appendChild(el("span", null, indexMode ? Math.round(val) + "%" : (metric === "fee" ? fmt(Math.round(val / 1000)) + "천" : fmt(Math.round(val)))));
    });

    var colMinW = Math.max(280, 12 * 42) + "px";
    plotEl.style.minWidth = colMinW;
    axisXEl.style.minWidth = colMinW;

    var W = plotEl.clientWidth || 600, H = plotEl.clientHeight || 260, padX = 24;
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    var usableW = W - padX * 2;
    function xAt(i) { return padX + (i / 11) * usableW; }
    function yAt(v) { return H - (v / maxVal) * H; }

    [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
      var y = H - f * H;
      svg.appendChild(svgEl("line", { x1: 0, x2: W, y1: y, y2: y, stroke: "var(--grid-line)", "stroke-width": 1 }));
    });

    if (indexMode) {
      var y100 = yAt(100);
      svg.appendChild(svgEl("line", { x1: 0, x2: W, y1: y100, y2: y100, stroke: "var(--baseline)", "stroke-width": 1.5, "stroke-dasharray": "4,3" }));
      var baseText = svgEl("text", { x: 4, y: y100 - 6, "text-anchor": "start", "font-size": 10.5, fill: "var(--text-muted)" });
      baseText.textContent = "연평균 = 100";
      svg.appendChild(baseText);
    }

    series.forEach(function (s) {
      var pts = [];
      s.vals.forEach(function (v, i) { if (v !== null) pts.push(xAt(i) + "," + yAt(v)); });
      svg.appendChild(svgEl("polyline", {
        points: pts.join(" "), fill: "none", stroke: s.color, "stroke-width": 3,
        "stroke-linejoin": "round", "stroke-linecap": "round"
      }));
      var lastIdx = -1;
      s.vals.forEach(function (v, i) {
        if (v === null) return;
        lastIdx = i;
        svg.appendChild(svgEl("circle", { cx: xAt(i), cy: yAt(v), r: 5, fill: s.color, stroke: "var(--surface-1)", "stroke-width": 2 }));
      });
      if (lastIdx >= 0) {
        var text = fmtMetric(s.vals[lastIdx], tooltipMetric);
        var lx = xAt(lastIdx);
        var above = yAt(s.vals[lastIdx]) - 18;
        var ly = above - 10 < 4 ? yAt(s.vals[lastIdx]) + 22 : above;
        var estWidth = text.length * 7.8 + 14;
        svg.appendChild(svgEl("rect", { x: lx - estWidth / 2, y: ly - 11, width: estWidth, height: 21, rx: 4, fill: "var(--surface-1)" }));
        var t = svgEl("text", { x: lx, y: ly + 4, "text-anchor": "middle", "font-size": 13, "font-weight": 650, fill: s.color });
        t.textContent = text;
        svg.appendChild(t);
      }
    });

    var _loop = function (m) {
      var i = m - 1;
      var hit = el("div", "mline-hit");
      var ttRows = series.filter(function (s) { return s.vals[i] !== null; }).map(function (s) {
        return { label: s.year + "년", value: s.vals[i], color: s.color, rawYear: Number(s.year) };
      });
      ttRows.sort(function(a, b) { return b.rawYear - a.rawYear; });
      if (ttRows.length >= 2 && !indexMode) {
        var v1 = ttRows[0].value;
        var v2 = ttRows[1].value;
        var gap = v1 - v2;
        var gapText = (gap > 0 ? "+" : "") + fmtMetric(gap, tooltipMetric);
        if (v2 > 0) {
          var pct = Math.round((gap / v2) * 100);
          gapText += " (" + (pct > 0 ? "+" : "") + pct + "%)";
        }
        var c = gap > 0 ? "var(--good)" : (gap < 0 ? "var(--critical)" : "var(--text-muted)");
        ttRows.push({ label: ttRows[0].rawYear + " vs " + ttRows[1].rawYear + " (Gap)", value: gapText, metric: "text", color: c });
      }
      hit.addEventListener("pointermove", function (evt) {
        crosshair.style.left = (xAt(i) / W * 100) + "%";
        crosshair.classList.add("show");
        showColorTooltip(evt, m + "월", ttRows, tooltipMetric);
      });
      hit.addEventListener("pointerleave", function () { crosshair.classList.remove("show"); hideTooltip(); });
      hitRow.appendChild(hit);
      axisXEl.appendChild(el("span", null, m + "월"));
    };
    for (var m = 1; m <= 12; m++) _loop(m);

    activeYears.forEach(function (y, idx) {
      var s = series[idx];
      var chip = el("div", "quadrant-chip");
      var sw = document.createElement("i");
      sw.style.background = s.color;
      chip.appendChild(sw);
      if (indexMode) {
        var qualifier = s.lastCompleteMonth > 0 && s.lastCompleteMonth < 12 ? "(1~" + s.lastCompleteMonth + "월 평균) " : "(연평균) ";
        chip.appendChild(document.createTextNode(y + "년 " + qualifier));
        chip.appendChild(el("b", null, fmtMetric(s.avg, metric)));
      } else {
        var total = s.vals.reduce(function (sum, v) { return sum + (v || 0); }, 0);
        chip.appendChild(document.createTextNode(y + "년 합계 "));
        chip.appendChild(el("b", null, fmtMetric(total, metric)));
      }
      legendEl.appendChild(chip);
    });

    var noteEl = document.getElementById("yoy-note");
    var maxYearSeriesIdx = activeYears.indexOf(maxYear);
    if (maxYearSeriesIdx !== -1 && currentMonthPartial) {
      var noteText = maxYear + "년 " + maxMonth + "월은 " + lastActualDayGlobal + "일까지의 데이터로, 아직 진행 중인 달입니다(월말까지 집계되면 값이 늘어날 수 있습니다).";
      if (indexMode && series[maxYearSeriesIdx].partialExcluded) noteText += " 해당 월은 " + maxYear + "년 평균 계산에서 제외했습니다.";
      noteEl.textContent = noteText;
    } else {
      noteEl.textContent = "";
    }
  }

  // ---------- agent table ----------
  function computeAgentRows(records) {
    return aggregateByAgent(records).map(toSummaryRow);
  }

  function sortRows(rows, key, dir) {
    rows.sort(function (a, b) {
      if (key === "branch" || key === "agent" || key === "affiliation") {
        return dir * String(a[key]).localeCompare(String(b[key]), "ko");
      }
      var av = a[key], bv = b[key];
      if (av === null) av = -1;
      if (bv === null) bv = -1;
      return (av - bv) * dir;
    });
  }

  function appendPerfCells(tr, r) {
    tr.appendChild(el("td", null, fmtFee(r.fee)));
    tr.appendChild(el("td", null, fmt(r.maintainCount)));
    tr.appendChild(el("td", null, fmtFee(r.maintainFee)));
    tr.appendChild(el("td", null, fmt(r.pendingCount)));
    tr.appendChild(el("td", null, fmtFee(r.pendingFee)));
    tr.appendChild(el("td", null, fmt(r.cancelCount)));
    tr.appendChild(el("td", null, fmtFee(r.cancelFee)));
    
    var tdCancelRate = el("td", cancelClass(r.cancelRate), r.cancelRate.toFixed(1) + "%");
    // Heatmap for cancel rate (red when higher)
    var cp = Math.min(1, r.cancelRate / 30);
    tdCancelRate.style.background = "rgba(239, 68, 68, " + (cp * 0.25) + ")";
    tr.appendChild(tdCancelRate);
    
    var tdConv = el("td", perfClass(r.conv), r.conv === null ? "–" : r.conv.toFixed(1) + "%");
    if (r.conv !== null) {
      // Heatmap for conv rate (green when higher)
      var mp = Math.max(0, (r.conv - 50) / 50);
      tdConv.style.background = "rgba(16, 185, 129, " + (mp * 0.25) + ")";
    }
    tr.appendChild(tdConv);
    
    tr.appendChild(el("td", "badge-cell", perfBadge(r.conv)));
  }


  function renderClusters(records) {
    var svg = document.getElementById("cluster-svg");
    if(!svg) return;
    svg.innerHTML = "";
    
    var agents = agentPerfRows(records).filter(function(r) { return r.conv !== null && r.count > 0; });
    if(agents.length < 5) {
      svg.innerHTML = "<text x='50%' y='50%' text-anchor='middle' fill='#94a3b8'>데이터가 부족합니다.</text>";
      return;
    }
    
    // Normalize data for K-Means (count, convRate)
    var maxCnt = Math.max.apply(null, agents.map(function(a){return a.count}));
    var data = agents.map(function(a) { return [a.count / maxCnt, a.conv / 100]; });
    var k = Math.min(3, agents.length);
    var clusters = window.kMeans(data, k, 20);
    
    var colors = ["#ef4444", "#eab308", "#10b981"]; // Red, Yellow, Green
    
    // SVG Draw
    var rect = svg.getBoundingClientRect();
    var w = rect.width || svg.clientWidth || 800, h = rect.height || svg.clientHeight || 400;
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    
    // Axes
    var xAxis = svgEl("line"); xAxis.setAttribute("x1", 40); xAxis.setAttribute("y1", h-40); xAxis.setAttribute("x2", w-20); xAxis.setAttribute("y2", h-40); xAxis.setAttribute("stroke", "#cbd5e1"); svg.appendChild(xAxis);
    var yAxis = svgEl("line"); yAxis.setAttribute("x1", 40); yAxis.setAttribute("y1", 20); yAxis.setAttribute("x2", 40); yAxis.setAttribute("y2", h-40); yAxis.setAttribute("stroke", "#cbd5e1"); svg.appendChild(yAxis);
    
    var xLb = svgEl("text"); xLb.setAttribute("x", w/2); xLb.setAttribute("y", h-10); xLb.setAttribute("text-anchor", "middle"); xLb.setAttribute("fill", "#64748b"); xLb.textContent = "총 건수 (스케일)"; svg.appendChild(xLb);
    var yLb = svgEl("text"); yLb.setAttribute("x", -h/2); yLb.setAttribute("y", 15); yLb.setAttribute("transform", "rotate(-90)"); yLb.setAttribute("text-anchor", "middle"); yLb.setAttribute("fill", "#64748b"); yLb.textContent = "유지전환율 (%)"; svg.appendChild(yLb);
    
    agents.forEach(function(a, i) {
      var cx = 40 + (a.count / maxCnt) * (w - 70);
      var cy = (h - 40) - (a.conv / 100) * (h - 60);
      var r = 4 + Math.min(20, (a.fee / 1000000)); // Radius by fee
      var color = colors[clusters[i] % colors.length];
      
      var circle = svgEl("circle");
      circle.setAttribute("cx", cx); circle.setAttribute("cy", cy);
      circle.setAttribute("r", r);
      circle.setAttribute("fill", color);
      circle.setAttribute("opacity", "0.6");
      circle.setAttribute("stroke", "#fff");
      
      var title = svgEl("title");
      title.textContent = a.agent + " (" + shortBranch(a.branch) + ")\n건수: " + a.count + "\n유지율: " + a.conv.toFixed(1) + "%\n클러스터: Group " + (clusters[i]+1);
      circle.appendChild(title);
      svg.appendChild(circle);
    });
  }

  function renderTable(records) {
    var rows = computeAgentRows(records);
    if(window.calculateAgentRFM) window.calculateAgentRFM(rows);
    if (state.search) {
      var q = state.search.toLowerCase();
      rows = rows.filter(function (r) { return r.agent.toLowerCase().indexOf(q) !== -1; });
    }
    sortRows(rows, state.sortKey, state.sortDir);

    var tbody = document.getElementById("agent-tbody");
    tbody.innerHTML = "";

    if (rows.length === 0) {
      var tr0 = el("tr", "empty-row");
      var td0 = el("td", null, "조건에 맞는 영업자가 없습니다.");
      td0.colSpan = 15;
      tr0.appendChild(td0);
      tbody.appendChild(tr0);
    } else {
      var maxTotal = rows.reduce(function (m, r) { return Math.max(m, r.total); }, 0) || 1;
      rows.forEach(function (r, idx) {
        var tr = document.createElement("tr");
        tr.setAttribute("data-clickable", "1");
        if (state.branch === r.branch && state.agent === r.agent) tr.classList.add("selected");
        tr.addEventListener("click", function () { state.branch = r.branch; state.agent = r.agent; render(); });

        var tdRank = document.createElement("td");
        tdRank.appendChild(el("span", "rank", String(idx + 1)));
        tr.appendChild(tdRank);

        tr.appendChild(el("td", null, shortBranch(r.branch)));
        tr.appendChild(el("td", null, r.agent));
        tr.appendChild(el("td", null, r.affiliation));

        var tdTotal = document.createElement("td");
        var bar = el("span", "mini-bar");
        bar.style.width = Math.max(4, r.total / maxTotal * 40) + "px";
        tdTotal.appendChild(bar);
        tdTotal.appendChild(document.createTextNode(fmt(r.total)));
        tr.appendChild(tdTotal);

        appendPerfCells(tr, r);
        tbody.appendChild(tr);
      });
    }

    document.getElementById("table-sub").textContent = "지사 · 영업자 단위 집계 · " + fmt(rows.length) + "명 표시";
    document.querySelectorAll("#agent-table thead th[data-key]").forEach(function (th) {
      th.classList.toggle("sorted", th.getAttribute("data-key") === state.sortKey);
    });
  }

  function renderBranchSummaryTable(records) {
    var rows = aggregateByBranch(records).map(toSummaryRow);
    sortRows(rows, state.branchSortKey, state.branchSortDir);

    var tbody = document.getElementById("branch-summary-tbody");
    tbody.innerHTML = "";

    if (rows.length === 0) {
      var tr0 = el("tr", "empty-row");
      var td0 = el("td", null, "표시할 데이터가 없습니다.");
      td0.colSpan = 13;
      tr0.appendChild(td0);
      tbody.appendChild(tr0);
    } else {
      var maxTotal = rows.reduce(function (m, r) { return Math.max(m, r.total); }, 0) || 1;
      rows.forEach(function (r, idx) {
        var tr = document.createElement("tr");
        tr.setAttribute("data-clickable", "1");
        if (state.branch === r.branch && !state.agent) tr.classList.add("selected");
        tr.addEventListener("click", function () { state.branch = (state.branch === r.branch) ? null : r.branch; state.agent = null; render(); });

        var tdRank = document.createElement("td");
        tdRank.appendChild(el("span", "rank", String(idx + 1)));
        tr.appendChild(tdRank);

        tr.appendChild(el("td", null, shortBranch(r.branch)));

        var tdTotal = document.createElement("td");
        var bar = el("span", "mini-bar");
        bar.style.width = Math.max(4, r.total / maxTotal * 40) + "px";
        tdTotal.appendChild(bar);
        tdTotal.appendChild(document.createTextNode(fmt(r.total)));
        tr.appendChild(tdTotal);

        appendPerfCells(tr, r);
        tbody.appendChild(tr);
      });
    }

    document.querySelectorAll("#branch-summary-table thead th[data-key]").forEach(function (th) {
      th.classList.toggle("sorted", th.getAttribute("data-key") === state.branchSortKey);
    });
  }
  document.querySelectorAll("#branch-summary-table thead th[data-key]").forEach(function (th) {
    var key = th.getAttribute("data-key");
    if (key === "rank") return;
    th.addEventListener("click", function () {
      if (state.branchSortKey === key) state.branchSortDir *= -1;
      else { state.branchSortKey = key; state.branchSortDir = (key === "branch") ? 1 : -1; }
      render();
    });
  });

  document.querySelectorAll("#agent-table thead th[data-key]").forEach(function (th) {
    var key = th.getAttribute("data-key");
    if (key === "rank") return;
    th.addEventListener("click", function () {
      if (state.sortKey === key) state.sortDir *= -1;
      else { state.sortKey = key; state.sortDir = (key === "branch" || key === "agent" || key === "affiliation") ? 1 : -1; }
      render();
    });
  });

  document.getElementById("agent-search").addEventListener("input", function (e) {
    state.search = e.target.value;
    renderTable(branchDateRecords());
  });

  // ---------- master render ----------
  function updateSubtitle() {
    var scope = state.branch ? (shortBranch(state.branch) + (state.agent ? (" · " + state.agent) : "")) : "전체 지사";
    var dateLabel = (state.dateFrom || state.dateTo)
      ? ((state.dateFrom || ALL_DATES[0]) + " ~ " + (state.dateTo || ALL_DATES[ALL_DATES.length - 1]))
      : (ALL_DATES.length ? (ALL_DATES[0] + " ~ " + ALL_DATES[ALL_DATES.length - 1] + " (전체 기간)") : "데이터 없음");
    document.getElementById("subtitle").textContent = dateLabel + " · " + scope +
      (state.excludeCancelled ? " · 취소/해지 제외" : "") +
      (state.excludePlaceholder ? " · \"" + PLACEHOLDER_AGENT + "\" 제외" : "");
  }


  
  


  // --- ML/DL Utilities ---
  window.calculateZScores = function(arr) {
    var n = arr.length;
    if (n === 0) return [];
    var mean = arr.reduce(function(a,b){return a+b}, 0) / n;
    var variance = arr.reduce(function(a,b){return a + Math.pow(b - mean, 2)}, 0) / n;
    var stddev = Math.sqrt(variance) || 1;
    return arr.map(function(v) { return (v - mean) / stddev; });
  };

  window.kMeans = function(data, k, maxIter) {
    k = k || 3; maxIter = maxIter || 20;
    var centroids = [];
    for(var i=0; i<k; i++) centroids.push(data[Math.floor(Math.random() * data.length)]);
    var clusters = new Array(data.length);
    for(var iter=0; iter<maxIter; iter++) {
      var changed = false;
      for(var i=0; i<data.length; i++) {
        var minD = Infinity, bestC = 0;
        for(var c=0; c<k; c++) {
          var d = 0;
          for(var dIdx=0; dIdx<data[i].length; dIdx++) d += Math.pow(data[i][dIdx] - centroids[c][dIdx], 2);
          if (d < minD) { minD = d; bestC = c; }
        }
        if (clusters[i] !== bestC) { clusters[i] = bestC; changed = true; }
      }
      if (!changed) break;
      var newCents = Array.from({length: k}, function() { return new Array(data[0].length).fill(0); });
      var counts = new Array(k).fill(0);
      for(var i=0; i<data.length; i++) {
        var c = clusters[i];
        for(var dIdx=0; dIdx<data[0].length; dIdx++) newCents[c][dIdx] += data[i][dIdx];
        counts[c]++;
      }
      for(var c=0; c<k; c++) {
        if(counts[c] > 0) {
          for(var dIdx=0; dIdx<data[0].length; dIdx++) centroids[c][dIdx] = newCents[c][dIdx] / counts[c];
        }
      }
    }
    return clusters;
  };

  // ----------------------------------------------------
  // EXPERT EDA & AI/ML ALGORITHMS
  // ----------------------------------------------------

  // 1. Multivariate Anomaly Detection (Pseudo-Mahalanobis)
  window.calculateMultivariateAnomalies = function(branches) {
    if(branches.length < 3) return [];
    var pre = branches.map(function(b) {
      var c = b.conv;
      if (c === undefined && b.bucket) {
         var d = b.bucket["유지"].count + b.bucket["청약취소"].count;
         c = d > 0 ? (b.bucket["유지"].count / d * 100) : 50;
      }
      return { branch: b.branch, count: b.count || b.total || 0, fee: b.fee || 0, conv: c || 50 };
    });
    var mean = function(arr) { return arr.reduce(function(a,b){return a+b},0)/arr.length; };
    var std = function(arr, m) { return Math.sqrt(arr.reduce(function(a,b){return a+Math.pow(b-m,2)},0)/arr.length) || 1; };
    var counts = pre.map(function(b){return b.count});
    var fees = pre.map(function(b){return b.fee});
    var convs = pre.map(function(b){return b.conv});
    branches = pre;
    
    var mCount = mean(counts), sCount = std(counts, mCount);
    var mFee = mean(fees), sFee = std(fees, mFee);
    var mConv = mean(convs), sConv = std(convs, mConv);
    
    var anomalies = [];
    branches.forEach(function(b) {
      if(b.count < 3) return;
      var zCount = (b.count - mCount) / sCount;
      var zFee = (b.fee - mFee) / sFee;
      var zConv = (b.conv - mConv) / sConv;
      var dist = Math.sqrt(zCount*zCount + zFee*zFee + zConv*zConv);
      
      if(dist > 2.5) {
        var reasons = [];
        if(zCount < -1.5) reasons.push("건수 급감");
        if(zCount > 2.0) reasons.push("건수 폭증");
        if(zFee < -1.5) reasons.push("월정료 저조");
        if(zFee > 2.0) reasons.push("월정료 폭증");
        if(zConv < -2.0) reasons.push("유지율 치명적 하락");
        if(reasons.length > 0) anomalies.push(shortBranch(b.branch) + " (" + reasons.join(", ") + ")");
      }
    });
    return anomalies;
  };

  // 2. Exponential Smoothing (Holt-Winters Lite for Time Series Forecasting)
  window.exponentialSmoothing = function(data, alpha, beta, horizon) {
    if(data.length < 2) return [];
    var level = data[0], trend = data[1] - data[0];
    var smoothed = [level];
    for(var i=1; i<data.length; i++) {
      var lastLevel = level;
      level = alpha * data[i] + (1 - alpha) * (lastLevel + trend);
      trend = beta * (level - lastLevel) + (1 - beta) * trend;
      smoothed.push(level);
    }
    var forecasts = [];
    for(var j=1; j<=horizon; j++) {
      forecasts.push(Math.max(0, level + j * trend));
    }
    return { smoothed: smoothed, forecasts: forecasts };
  };

  // 3. RFM Agent Scoring Model
  window.calculateAgentRFM = function(agents) {
    if(agents.length === 0) return;
    var maxCount = Math.max.apply(null, agents.map(function(a){return a.total || a.count || 0})) || 1;
    var maxFee = Math.max.apply(null, agents.map(function(a){return a.fee || 0})) || 1;
    
    agents.forEach(function(a) {
      // Frequency Score (0-100)
      var fScore = ((a.total || a.count || 0) / maxCount) * 100;
      // Monetary Score (0-100)
      var mScore = (a.fee / maxFee) * 100;
      // Recency / Conversion quality Score (0-100)
      var rScore = a.conv !== null ? a.conv : 50; 
      
      // AI Weighted Score
      a.aiScore = (fScore * 0.4) + (mScore * 0.4) + (rScore * 0.2);
      
      if(a.aiScore >= 80) a.aiTier = "Platinum";
      else if(a.aiScore >= 50) a.aiTier = "Gold";
      else if(a.aiScore >= 25) a.aiTier = "Silver";
      else a.aiTier = "Risk";
    });
  };

  // 4. Pareto (80/20) Chart Rendering
  window.renderParetoChart = function(records) {
    var wrap = document.getElementById("pareto-svg");
    if(!wrap) return;
    wrap.innerHTML = "";
    
    var agents = agentPerfRows(records).filter(function(a){return a.fee > 0});
    if(agents.length === 0) {
      wrap.innerHTML = "<text x=\"50%\" y=\"50%\" text-anchor=\"middle\" fill=\"#94a3b8\">표시할 수익 데이터가 없습니다.</text>";
      return;
    }
    
    agents.sort(function(a,b){return b.fee - a.fee});
    var totalFee = agents.reduce(function(s, a){return s + a.fee}, 0);
    var cumul = 0;
    
    var rectInfo = wrap.getBoundingClientRect();
    var w = rectInfo.width || wrap.clientWidth || 800;
    var h = rectInfo.height || wrap.clientHeight || 350;
    wrap.setAttribute("viewBox", "0 0 " + w + " " + h);
    var pad = 40;
    
    // Axis
    var xAxis = svgEl("line", {x1:pad, y1:h-pad, x2:w-pad, y2:h-pad, stroke:"#cbd5e1"});
    var yAxisL = svgEl("line", {x1:pad, y1:pad, x2:pad, y2:h-pad, stroke:"#cbd5e1"});
    var yAxisR = svgEl("line", {x1:w-pad, y1:pad, x2:w-pad, y2:h-pad, stroke:"#cbd5e1"});
    wrap.appendChild(xAxis); wrap.appendChild(yAxisL); wrap.appendChild(yAxisR);
    
    var topN = Math.min(agents.length, 50); // Show top 50
    var barW = (w - pad*2) / topN;
    var maxBar = agents[0].fee;
    
    var linePts = [];
    
    agents.slice(0, topN).forEach(function(a, i) {
      var x = pad + i*barW + barW/2;
      var barH = (a.fee / maxBar) * (h - pad*2);
      var rect = svgEl("rect", {
        x: x - barW*0.4, y: h - pad - barH, width: barW*0.8, height: barH,
        fill: "var(--rank-bar)", rx: 2
      });
      var tt = svgEl("title"); tt.textContent = a.agent + " (" + fmtFee(a.fee) + ")";
      rect.appendChild(tt);
      wrap.appendChild(rect);
      
      cumul += a.fee;
      var pct = cumul / totalFee;
      var ly = h - pad - (pct * (h - pad*2));
      linePts.push(x + "," + ly);
      
      var dot = svgEl("circle", {cx: x, cy: ly, r: 3, fill: "var(--critical)"});
      wrap.appendChild(dot);
    });
    
    var polyline = svgEl("polyline", {
      points: linePts.join(" "), fill: "none", stroke: "var(--critical)", "stroke-width": 2
    });
    wrap.appendChild(polyline);
    
    // 80% line
    var y80 = h - pad - (0.8 * (h - pad*2));
    var line80 = svgEl("line", {x1:pad, y1:y80, x2:w-pad, y2:y80, stroke:"#94a3b8", "stroke-dasharray":"4,4"});
    wrap.appendChild(line80);
    var t80 = svgEl("text", {x:w-pad+5, y:y80+4, "font-size":10, fill:"#64748b"}); t80.textContent="80%";
    wrap.appendChild(t80);
  };

  // 5. Correlation Heatmap Rendering
  window.renderCorrelationHeatmap = function(records) {
    var wrap = document.getElementById("corr-svg");
    if(!wrap) return;
    wrap.innerHTML = "";
    
    var branches = aggregateByBranch(records).filter(function(b){return b.count > 0});
    if(branches.length < 3) {
      wrap.innerHTML = "<text x=\"50%\" y=\"50%\" text-anchor=\"middle\" fill=\"#94a3b8\">데이터가 부족합니다.</text>";
      return;
    }
    
    var vars = ["총건수", "총월정료", "유지건수", "취소율"];
    var dataMatrix = branches.map(function(b) {
      var cancelRate = b.bucket["청약취소"].count / b.count * 100;
      return [b.count, b.fee, b.bucket["유지"].count, cancelRate];
    });
    
    var mean = function(arr) { return arr.reduce(function(a,b){return a+b},0)/arr.length; };
    var std = function(arr, m) { return Math.sqrt(arr.reduce(function(a,b){return a+Math.pow(b-m,2)},0)/arr.length) || 1; };
    var corr = function(x, y) {
      var mx = mean(x), my = mean(y), sx = std(x, mx), sy = std(y, my);
      if(sx === 0 || sy === 0) return 0; // Prevent NaN if variance is 0
      var cov = 0;
      for(var i=0; i<x.length; i++) cov += (x[i]-mx)*(y[i]-my);
      return (cov / x.length) / (sx * sy);
    };
    
    var cols = vars.map(function(_, i){ return dataMatrix.map(function(row){return row[i]}) });
    var matrix = [];
    for(var i=0; i<4; i++) {
      matrix[i] = [];
      for(var j=0; j<4; j++) {
        matrix[i][j] = corr(cols[i], cols[j]);
      }
    }
    
    var rectInfo = wrap.getBoundingClientRect();
    var w = rectInfo.width || wrap.clientWidth || 400, h = rectInfo.height || wrap.clientHeight || 350;
    wrap.setAttribute("viewBox", "0 0 " + w + " " + h);
    var pad = 40, cellW = (w-pad*2)/4, cellH = (h-pad*2)/4;
    
    vars.forEach(function(v, i) {
      var tx = svgEl("text", {x: pad + i*cellW + cellW/2, y: pad-10, "text-anchor":"middle", "font-size":11, fill:"#64748b"});
      tx.textContent = v; wrap.appendChild(tx);
      var ty = svgEl("text", {x: pad-10, y: pad + i*cellH + cellH/2 + 4, "text-anchor":"end", "font-size":11, fill:"#64748b"});
      ty.textContent = v; wrap.appendChild(ty);
    });
    
    for(var i=0; i<4; i++) {
      for(var j=0; j<4; j++) {
        var val = isNaN(matrix[i][j]) ? 0 : matrix[i][j];
        // Map -1..1 to HSL (Blue for +1, Red for -1)
        var hue = val > 0 ? 220 : 0; // Blue or Red
        var sat = Math.abs(val) * 100;
        var light = 100 - Math.abs(val) * 50; // 100(white) to 50(color)
        var color = "hsl(" + hue + ", " + sat + "%, " + light + "%)";
        
        var rect = svgEl("rect", {
          x: pad + j*cellW, y: pad + i*cellH, width: cellW, height: cellH,
          fill: color, stroke: "#fff", "stroke-width": 1
        });
        var tt = svgEl("title"); tt.textContent = val.toFixed(2);
        rect.appendChild(tt);
        wrap.appendChild(rect);
        
        var tVal = svgEl("text", {
          x: pad + j*cellW + cellW/2, y: pad + i*cellH + cellH/2 + 4,
          "text-anchor":"middle", "font-size":11, "font-weight":600,
          fill: Math.abs(val) > 0.5 ? "#fff" : "#475569"
        });
        tVal.textContent = val.toFixed(2);
        wrap.appendChild(tVal);
      }
    }
  };

  // ----------------------

  function render() {
    var dateRecs = dateOnlyRecords();
    var hqRecs = hqDateRecords();
    var bdRecs = branchDateRecords();
    var full = fullScopedRecords();

    updateSubtitle();
    renderMonthButtons();
    renderOrgSelects(hqRecs);
    renderAgentFilterWrap(bdRecs);
    renderDrilldown(full);
    renderSummary(full, dateRecs);
    renderKPIs(full);
    state.goal = loadGoal();
    renderGoalBox();
    renderBranchChart(dateRecs);
    renderBranchSummaryTable(dateRecs);
    renderTop10(bdRecs);
    renderPerfMatrix(bdRecs);
    renderTrend(full);
    renderMonthlyTrendCharts(full);
    renderMonthlyAnalysis(full);
    renderYoyChart(branchAgentRecords());
    renderTable(bdRecs);
    renderClusters(bdRecs);
    if(window.renderParetoChart) window.renderParetoChart(bdRecs);
    if(window.renderCorrelationHeatmap) window.renderCorrelationHeatmap(bdRecs);
  }

  // ---------- init ----------
  loadData(DEFAULT_DATA);
  buildLegend("legend-branch");
  buildLegend("legend-date");
  populateDateSelects();
  render();
})();


