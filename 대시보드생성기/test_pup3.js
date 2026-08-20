const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({headless: "new"});
  const page = await browser.newPage();
  await page.goto('file://' + __dirname + '/test_out.html', {waitUntil: 'networkidle2'});
  
  const clusterHtml = await page.evaluate(() => document.getElementById('cluster-svg').innerHTML);
  console.log("CLUSTER_LENGTH:", clusterHtml.length);
  console.log("CLUSTER_SNIPPET:", clusterHtml.substring(0, 500));
  
  await browser.close();
})();
