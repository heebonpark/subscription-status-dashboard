const fs = require('fs');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;

const html = fs.readFileSync('template.html', 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
let jsCode = scriptMatch[1];
jsCode = "var __DASHBOARD_DATA_JSON__ = " + JSON.stringify({
  header: ["영업본부명","관리본부명","영업자","상태","월정료","접수일자"],
  records: [
    ["본부A","지사A","김철수","유지","10000","2023-01-01"],
    ["본부A","지사A","이영희","청약","20000","2023-01-02"],
    ["본부B","지사B","박민수","청약취소","30000","2023-01-03"]
  ]
}) + ";\n" + jsCode;

// Mock enough DOM for it not to crash
const dom = new JSDOM(`<!DOCTYPE html><html><body>
  <div id="hq-filters"></div><div id="branch-filters"></div>
  <div id="month-filters"></div>
  <div class="dashboard-container">
    <div id="kpis"></div>
    <div id="anomaly-alert"></div>
  </div>
  <div id="pareto-svg" style="width:800px; height:300px;"></div>
  <div id="corr-svg" style="width:300px; height:300px;"></div>
  <div id="cluster-svg"></div>
  <div id="callout-box"></div>
  <div id="trend-line-chart"></div>
  <div id="branch-chart"></div><div id="branch-chart-sub"></div>
  <table id="branch-summary-table"><thead><tr><th data-key="a"></th></tr></thead><tbody></tbody></table>
  <table id="agent-table"><thead><tr><th data-key="a"></th></tr></thead><tbody></tbody></table>
  <input id="agent-search" type="text" />
</body></html>`);

global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.SVGElement = dom.window.SVGElement;

// Provide getBoundingClientRect
dom.window.HTMLElement.prototype.getBoundingClientRect = function() {
  return {width: 400, height: 350, top: 0, left: 0};
};
dom.window.SVGElement.prototype.getBoundingClientRect = function() {
  return {width: 400, height: 350, top: 0, left: 0};
};

try {
  eval(jsCode);
  console.log("Evaluated OK. Testing Pareto...");
  var recs = [
    ["본부A","지사A","김철수","유지",10000,"2023-01-01"],
    ["본부A","지사A","이영희","청약",20000,"2023-01-02"],
    ["본부B","지사B","박민수","청약취소",30000,"2023-01-03"]
  ];
  window.renderParetoChart(recs);
  console.log("Pareto SVG innerHTML length:", document.getElementById("pareto-svg").innerHTML.length);
  window.renderCorrelationHeatmap(recs);
  console.log("Corr SVG innerHTML length:", document.getElementById("corr-svg").innerHTML.length);
} catch(e) {
  console.error("ERROR CAUGHT:", e);
}
