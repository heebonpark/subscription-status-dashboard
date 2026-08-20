const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({headless: "new"});
  const page = await browser.newPage();
  await page.goto('file://' + __dirname + '/test_out.html', {waitUntil: 'networkidle2'});
  
  const paretoHtml = await page.evaluate(() => document.getElementById('pareto-svg').innerHTML);
  const corrHtml = await page.evaluate(() => document.getElementById('corr-svg').innerHTML);
  
  console.log("PARETO_LENGTH:", paretoHtml.length);
  console.log("PARETO_SNIPPET:", paretoHtml.substring(0, 500));
  
  console.log("CORR_LENGTH:", corrHtml.length);
  console.log("CORR_SNIPPET:", corrHtml.substring(0, 500));
  
  await browser.close();
})();
