with open("template.html", "r", encoding="utf-8") as f:
    html = f.read()

# Fix the call to linearRegression
old_code = """          var model = linearRegression(histVals);
          var lastIdx = histVals.length - 1;
          var lastVal = histVals[lastIdx];
          var forecastPts = [agg[Object.keys(agg)[lastIdx]].pt];
          
          for(var f=1; f<=3; f++) {
            var predVal = Math.max(0, model.intercept + model.slope * (lastIdx + f));"""

new_code = """          var xs = histVals.map(function(_, i) { return i; });
          var model = linearRegression(xs, histVals);
          var lastIdx = histVals.length - 1;
          var forecastPts = [agg[Object.keys(agg)[lastIdx]].pt];
          
          for(var f=1; f<=3; f++) {
            var predVal = Math.max(0, model.predict(lastIdx + f));"""

html = html.replace(old_code, new_code)

with open("template.html", "w", encoding="utf-8") as f:
    f.write(html)
