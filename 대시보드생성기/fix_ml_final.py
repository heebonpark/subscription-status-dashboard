with open("template.html", "r", encoding="utf-8") as f:
    html = f.read()

# Fix anomalyWrap insertion
html = html.replace('var container = document.getElementById("kpis").parentNode;', 'var container = document.querySelector(".wrap");')

# Fix ML function definitions to window to avoid scope issues
ml_utils_global = """
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
  // ----------------------
"""

# replace the old function calculateZScores
import re
html = re.sub(r'function calculateZScores\(arr\) \{.*?\/\/ ----------------------', '', html, flags=re.DOTALL)
html = html.replace('// --- ML/DL Utilities ---', '')
html = html.replace('  function render() {', ml_utils_global + '\n  function render() {')

# update calls
html = html.replace('calculateZScores(cancelRates)', 'window.calculateZScores(cancelRates)')
html = html.replace('kMeans(data, k, 20)', 'window.kMeans(data, k, 20)')

with open("template.html", "w", encoding="utf-8") as f:
    f.write(html)
