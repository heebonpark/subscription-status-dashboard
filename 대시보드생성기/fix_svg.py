import re

with open("template.html", "r", encoding="utf-8") as f:
    html = f.read()

# Remove viewBox and preserveAspectRatio from HTML
html = re.sub(r' viewBox="0 0 600 380" preserveAspectRatio="none"', '', html)

# Replace hardcoded W, H in renderMiniLineChart
html = html.replace('var W = 600, H = 380;', 'var W = plotEl.clientWidth || 600, H = plotEl.clientHeight || 260;\n    svg.setAttribute("viewBox", "0 0 " + W + " " + H);')

# Replace hardcoded W, H in renderYoyDeltaBars
html = html.replace('var W = 600, H = 380, padX = 24;', 'var W = plotEl.clientWidth || 600, H = plotEl.clientHeight || 260, padX = 24;\n    svg.setAttribute("viewBox", "0 0 " + W + " " + H);')

with open("template.html", "w", encoding="utf-8") as f:
    f.write(html)
