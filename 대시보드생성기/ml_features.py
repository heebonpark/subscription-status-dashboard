import re

with open("template.html", "r", encoding="utf-8") as f:
    html = f.read()

# 1. Add ML JS utilities (Linear Regression, Z-Score, KMeans)
ml_utils = """
  // --- ML/DL Utilities ---
  function linearRegression(y, x) {
    var n = y.length;
    var sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (var i = 0; i < n; i++) {
      var xi = x ? x[i] : i;
      sumX += xi; sumY += y[i]; sumXY += xi * y[i]; sumXX += xi * xi;
    }
    var slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    var intercept = (sumY - slope * sumX) / n;
    return { slope: slope, intercept: intercept };
  }

  function calculateZScores(arr) {
    var n = arr.length;
    if (n === 0) return [];
    var mean = arr.reduce(function(a,b){return a+b}, 0) / n;
    var variance = arr.reduce(function(a,b){return a + Math.pow(b - mean, 2)}, 0) / n;
    var stddev = Math.sqrt(variance) || 1;
    return arr.map(function(v) { return (v - mean) / stddev; });
  }

  function kMeans(data, k, maxIter) {
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
  }
  // ----------------------
"""
html = html.replace('  // ---------- UI State & Event Bindings ----------', ml_utils + '\n  // ---------- UI State & Event Bindings ----------')

# 2. Add Anomaly Detection to updateKPIs (Alert Banner)
kpi_target = 'var wrap = document.getElementById("kpis");'
anomaly_banner = """
    // AI Anomaly Detection: Cancel Rate Spike
    var anomalyWrap = document.getElementById("anomaly-alert");
    if(!anomalyWrap) {
      anomalyWrap = el("div");
      anomalyWrap.id = "anomaly-alert";
      var container = document.querySelector(".dashboard-container");
      container.insertBefore(anomalyWrap, document.getElementById("kpis").nextSibling);
    }
    anomalyWrap.innerHTML = "";
    
    var branchAgg = aggregateByBranch(records);
    var cancelRates = branchAgg.map(function(b) { return b.count ? (b.bucket["청약취소"].count / b.count * 100) : 0; });
    var zScores = calculateZScores(cancelRates);
    var anomalies = [];
    zScores.forEach(function(z, idx) {
      if(z > 2.0 && branchAgg[idx].count > 5) {
        anomalies.push(shortBranch(branchAgg[idx].branch) + "(" + cancelRates[idx].toFixed(1) + "%)");
      }
    });
    if (anomalies.length > 0) {
      var alertDiv = el("div", null, "🚨 [AI 이상탐지] 취소율 비정상 급등 지사 발견: " + anomalies.join(", "));
      alertDiv.style.background = "rgba(239, 68, 68, 0.1)";
      alertDiv.style.border = "1px solid var(--critical)";
      alertDiv.style.color = "var(--critical)";
      alertDiv.style.padding = "10px 16px";
      alertDiv.style.borderRadius = "8px";
      alertDiv.style.marginTop = "16px";
      alertDiv.style.fontWeight = "600";
      anomalyWrap.appendChild(alertDiv);
    }
"""
html = html.replace(kpi_target, anomaly_banner + '\n    ' + kpi_target)

# 3. Add Forecasting to renderYoyChart
# We find where the line chart creates polyline.
chart_target = 'poly.setAttribute("points", Object.keys(agg).map(function (ym) { return agg[ym].pt; }).join(" "));'
chart_forecast = """poly.setAttribute("points", Object.keys(agg).map(function (ym) { return agg[ym].pt; }).join(" "));
        
        // AI Forecasting (Linear Regression for next 3 months)
        var histVals = Object.keys(agg).map(function(ym) { return agg[ym].val; });
        if (histVals.length >= 3) {
          var model = linearRegression(histVals);
          var lastIdx = histVals.length - 1;
          var lastVal = histVals[lastIdx];
          var forecastPts = [agg[Object.keys(agg)[lastIdx]].pt];
          
          for(var f=1; f<=3; f++) {
            var predVal = Math.max(0, model.intercept + model.slope * (lastIdx + f));
            var predX = 30 + (lastIdx + f) * stepX;
            var predY = h - 20 - (predVal / maxY) * (h - 40);
            forecastPts.push(predX + "," + predY);
            
            // Draw prediction dot
            var dot = svgEl("circle");
            dot.setAttribute("cx", predX); dot.setAttribute("cy", predY);
            dot.setAttribute("r", 3);
            dot.setAttribute("fill", "var(--warning)");
            svg.appendChild(dot);
            
            var text = svgEl("text");
            text.setAttribute("x", predX); text.setAttribute("y", predY - 10);
            text.setAttribute("fill", "var(--text-secondary)");
            text.setAttribute("font-size", "10px");
            text.setAttribute("text-anchor", "middle");
            text.textContent = "AI예측";
            svg.appendChild(text);
          }
          
          var fPoly = svgEl("polyline");
          fPoly.setAttribute("points", forecastPts.join(" "));
          fPoly.setAttribute("fill", "none");
          fPoly.setAttribute("stroke", "var(--warning)");
          fPoly.setAttribute("stroke-width", "2");
          fPoly.setAttribute("stroke-dasharray", "4 4");
          svg.appendChild(fPoly);
        }
"""
html = html.replace(chart_target, chart_forecast)

# 4. Add ML Agent Clustering to template
cluster_html = """
    <div class="card">
      <div class="card-head">
        <h2 class="card-title">AI 영업자 실적 군집 분석 (K-Means Clustering)</h2>
        <p class="sub">수많은 영업자를 실적 패턴(건수, 유지전환율, 월정료)에 따라 AI가 자동 그룹화합니다.</p>
      </div>
      <div class="chart-wrap" style="height:400px; display:flex; align-items:center; justify-content:center; background:#f8fafc; border-radius:8px;">
        <svg id="cluster-svg" width="100%" height="100%"></svg>
      </div>
    </div>
"""
# insert before EDA table
html = html.replace('<div class="card">', cluster_html + '\n    <div class="card">', 1)

render_cluster_js = """
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
    var clusters = kMeans(data, k, 20);
    
    var colors = ["#ef4444", "#eab308", "#10b981"]; // Red, Yellow, Green
    
    // SVG Draw
    var rect = svg.getBoundingClientRect();
    var w = rect.width, h = rect.height;
    
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
      title.textContent = a.agent + " (" + shortBranch(a.branch) + ")\\n건수: " + a.count + "\\n유지율: " + a.conv.toFixed(1) + "%\\n클러스터: Group " + (clusters[i]+1);
      circle.appendChild(title);
      svg.appendChild(circle);
    });
  }
"""

html = html.replace('  function renderTable(records) {', render_cluster_js + '\n  function renderTable(records) {')
html = html.replace('renderTable(filtered);', 'renderClusters(filtered);\n    renderTable(filtered);')

with open("template.html", "w", encoding="utf-8") as f:
    f.write(html)
