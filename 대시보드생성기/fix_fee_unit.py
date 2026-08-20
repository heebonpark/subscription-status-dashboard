import re

with open("template.html", "r", encoding="utf-8") as f:
    html = f.read()

# 1. state.feeUnit
html = html.replace(
    'branchSortKey: "total", branchSortDir: -1,',
    'branchSortKey: "total", branchSortDir: -1,\n    feeUnit: "천원",'
)

# 2. Add UI Toggle
filter_target = '<span class="flabel">영업자 "추천자와동일"</span>'
filter_replacement = '''<span class="flabel">금액 단위</span>
        <div class="toggle-group" id="fee-unit-toggle" style="margin-right:16px;">
          <button data-v="천원" class="active">천원</button>
          <button data-v="백만원">백만원</button>
        </div>
        <span class="flabel">영업자 "추천자와동일"</span>'''
html = html.replace(filter_target, filter_replacement)

# 3. Add JS Listener
js_target = 'document.querySelectorAll("#placeholder-toggle button").forEach(function (btn) {'
js_replacement = '''document.querySelectorAll("#fee-unit-toggle button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.feeUnit = btn.getAttribute("data-v");
      document.querySelectorAll("#fee-unit-toggle button").forEach(function (b) { b.classList.toggle("active", b === btn); });
      render();
    });
  });

  document.querySelectorAll("#placeholder-toggle button").forEach(function (btn) {'''
html = html.replace(js_target, js_replacement)

# 4. Modify fmtFee and fmtFeeMillion
fmt_target = '''  function fmtFee(v) { return fmt(Math.round(v / 1000)) + "천원"; }
  function fmtFeeMillion(v) {
    var m = v / 1000000;
    var decimals = Math.abs(m) >= 10 ? 1 : 2;
    return m.toLocaleString("ko-KR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + "백만원";
  }'''
fmt_replacement = '''  function fmtFee(v) {
    if (state.feeUnit === "백만원") {
      var m = v / 1000000;
      var decimals = Math.abs(m) >= 10 ? 1 : 2;
      return m.toLocaleString("ko-KR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + "백만원";
    }
    return fmt(Math.round(v / 1000)) + "천원";
  }
  function fmtFeeMillion(v) {
    return fmtFee(v);
  }'''
html = html.replace(fmt_target, fmt_replacement)

with open("template.html", "w", encoding="utf-8") as f:
    f.write(html)
