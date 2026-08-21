const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const url = 'file://' + process.cwd() + '/test_out.html';
  await page.goto(url, { waitUntil: 'networkidle2' });

  // 1) branch dropdown should list actual branches (not free text)
  const branchOpts = await page.evaluate(() => Array.from(document.getElementById('pipe-branch').options).map(o => o.value));
  console.log('pipe-branch options (no hq filter):', branchOpts);

  // 2) selecting a branch populates agent dropdown with existing agents for that branch
  await page.select('#pipe-branch', branchOpts[1]);
  await new Promise(r => setTimeout(r, 100));
  const agentOpts = await page.evaluate(() => Array.from(document.getElementById('pipe-agent-select').options).map(o => ({v:o.value,t:o.textContent})));
  console.log('agent options for', branchOpts[1], ':', agentOpts);

  // 3) picking an existing agent + fill numbers + submit
  const realAgentVal = agentOpts.find(o => o.v && o.v !== '__new__').v;
  await page.select('#pipe-agent-select', realAgentVal);
  await page.type('#pipe-count', '4');
  await page.type('#pipe-fee', '60000');
  await page.click('#pipe-add-btn');
  await new Promise(r => setTimeout(r, 150));
  console.log('rows after adding existing-agent entry:', await page.evaluate(() => document.querySelectorAll('#pipeline-tbody tr').length));

  // 4) manual new-agent entry: select __new__, text input should appear
  await page.select('#pipe-agent-select', '__new__');
  const newInputVisible = await page.evaluate(() => document.getElementById('pipe-agent-new').style.display !== 'none');
  console.log('new-agent text input visible after selecting 직접입력:', newInputVisible);
  await page.type('#pipe-agent-new', '홍신규');
  await page.type('#pipe-count', '2');
  await page.type('#pipe-fee', '30000');
  await page.click('#pipe-add-btn');
  await new Promise(r => setTimeout(r, 150));
  const rowsAfterNewAgent = await page.evaluate(() => Array.from(document.querySelectorAll('#pipeline-tbody tr')).map(r => r.children[1] ? r.children[1].textContent : null));
  console.log('agent names in table after new-agent add:', rowsAfterNewAgent);

  // 5) branch dropdown scoping by hq filter
  await page.select('#hq-sel', '강북/강원본부');
  await new Promise(r => setTimeout(r, 200));
  const branchOptsHq = await page.evaluate(() => Array.from(document.getElementById('pipe-branch').options).map(o => o.value));
  console.log('pipe-branch options under 강북/강원본부 filter:', branchOptsHq);
  await page.select('#hq-sel', 'ALL');
  await new Promise(r => setTimeout(r, 200));

  // 6) collapse/expand: add many more entries to exceed the 8-row limit
  for (let i = 0; i < 8; i++) {
    await page.select('#pipe-branch', branchOpts[1]);
    await page.select('#pipe-agent-select', '__new__');
    await page.evaluate(() => document.getElementById('pipe-agent-new').value = '');
    await page.type('#pipe-agent-new', '벌크' + i);
    await page.evaluate(() => { document.getElementById('pipe-count').value = ''; document.getElementById('pipe-fee').value = ''; });
    await page.type('#pipe-count', '1');
    await page.type('#pipe-fee', '10000');
    await page.click('#pipe-add-btn');
    await new Promise(r => setTimeout(r, 60));
  }
  const totalRows = await page.evaluate(() => document.querySelectorAll('#pipeline-tbody tr').length);
  const toggleBtnText = await page.evaluate(() => { const w = document.getElementById('pipeline-toggle-wrap'); return w && w.style.display !== 'none' ? w.innerText : null; });
  console.log('visible rows before expand:', totalRows, 'toggle btn:', toggleBtnText);

  await page.evaluate(() => document.querySelector('#pipeline-toggle-wrap button').click());
  await new Promise(r => setTimeout(r, 150));
  const totalRowsExpanded = await page.evaluate(() => document.querySelectorAll('#pipeline-tbody tr').length);
  const toggleBtnText2 = await page.evaluate(() => document.querySelector('#pipeline-toggle-wrap button').textContent);
  console.log('visible rows after expand:', totalRowsExpanded, 'toggle btn now:', toggleBtnText2);

  console.log('TOTAL ERRORS:', errors.length, errors);
  await browser.close();
})();
