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

// Extract body inner HTML safely
const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/i) || html.match(/<\/style>([\s\S]*?)<script>/i);
const domStr = `<!DOCTYPE html><html><body>${bodyMatch[1]}</body></html>`;

const dom = new JSDOM(domStr);
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.SVGElement = dom.window.SVGElement;

dom.window.HTMLElement.prototype.getBoundingClientRect = function() {
  return {width: 400, height: 350, top: 0, left: 0};
};
dom.window.SVGElement.prototype.getBoundingClientRect = function() {
  return {width: 400, height: 350, top: 0, left: 0};
};

try {
  eval(jsCode);
  console.log("Evaluation completed without crashing main thread!");
} catch(e) {
  console.error("RUNTIME ERROR:", e.stack);
}
