with open("template.html", "r", encoding="utf-8") as f:
    html = f.read()

ml_utils = """
  // --- ML/DL Utilities ---
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

html = html.replace('  function render() {', ml_utils + '\n  function render() {')

# Also, the previous script injected linearRegression inside renderYoyChart, but there might be a conflict. Let's see if the forecast drawing fails because linearRegression was overwritten or already exists. The existing linearRegression has signature: linearRegression(xs, ys) returning an object { predict: function(x) }. My new one was: linearRegression(y, x).
# I'll check if the forecast code is failing by looking at the browser errors again.

with open("template.html", "w", encoding="utf-8") as f:
    f.write(html)
