with open("template.html", "r", encoding="utf-8") as f:
    html = f.read()

# Fix container variable for Anomaly Detection
html = html.replace('var container = document.querySelector(".dashboard-container");', 'var container = document.getElementById("kpis").parentNode;')

with open("template.html", "w", encoding="utf-8") as f:
    f.write(html)
