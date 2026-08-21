const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const url = 'file://' + process.cwd() + '/test_out.html';
  await page.goto(url, { waitUntil: 'networkidle2' });

  const branchOpts = await page.evaluate(() => Array.from(document.getElementById('pipe-branch').options).map(o => o.value).filter(Boolean));

  // add entry with existing agent
  await page.select('#pipe-branch', branchOpts[0]);
  await new Promise(r => setTimeout(r, 50));
  const agentOpts = await page.evaluate(() => Array.from(document.getElementById('pipe-agent-select').options).map(o => o.value).filter(v => v && v !== '__new__'));
  await page.select('#pipe-agent-select', agentOpts[0]);
  await page.type('#pipe-count', '3');
  await page.type('#pipe-fee', '30000');
  await page.type('#pipe-memo', '원래메모');
  await page.click('#pipe-add-btn');
  await new Promise(r => setTimeout(r, 150));

  // add entry with manual new agent
  await page.select('#pipe-branch', branchOpts[0]);
  await page.select('#pipe-agent-select', '__new__');
  await page.type('#pipe-agent-new', '커스텀담당자');
  await page.type('#pipe-count', '1');
  await page.type('#pipe-fee', '10000');
  await page.click('#pipe-add-btn');
  await new Promise(r => setTimeout(r, 150));

  let rows = await page.evaluate(() => document.querySelectorAll('#pipeline-tbody tr').length);
  console.log('rows after 2 adds:', rows);

  // click 수정 on first row (existing-agent entry, since sorted by createdAt desc, first row = most recent = custom agent one)
  const rowsText = await page.evaluate(() => Array.from(document.querySelectorAll('#pipeline-tbody tr')).map(r => Array.from(r.children).slice(0,5).map(td=>td.textContent)));
  console.log('rows before edit:', rowsText);

  // edit the custom-agent row (should be first, most recent)
  await page.evaluate(() => document.querySelectorAll('#pipeline-tbody tr')[0].querySelector('button').click());
  await new Promise(r => setTimeout(r, 100));
  const formState = await page.evaluate(() => ({
    branch: document.getElementById('pipe-branch').value,
    agentSelect: document.getElementById('pipe-agent-select').value,
    agentNewVisible: document.getElementById('pipe-agent-new').style.display !== 'none',
    agentNewValue: document.getElementById('pipe-agent-new').value,
    count: document.getElementById('pipe-count').value,
    fee: document.getElementById('pipe-fee').value,
    btnLabel: document.getElementById('pipe-add-btn').textContent,
    cancelVisible: document.getElementById('pipe-cancel-btn').style.display !== 'none'
  }));
  console.log('form state after clicking 수정 on custom-agent row:', formState);

  // change count and fee, save edit
  await page.evaluate(() => { document.getElementById('pipe-count').value = ''; document.getElementById('pipe-fee').value = ''; });
  await page.type('#pipe-count', '9');
  await page.type('#pipe-fee', '99000');
  await page.click('#pipe-add-btn');
  await new Promise(r => setTimeout(r, 150));

  rows = await page.evaluate(() => document.querySelectorAll('#pipeline-tbody tr').length);
  const rowsAfterEdit = await page.evaluate(() => Array.from(document.querySelectorAll('#pipeline-tbody tr')).map(r => Array.from(r.children).map(td=>td.textContent)));
  console.log('row count after edit-save (should stay same, not grow):', rows);
  console.log('rows after edit:', rowsAfterEdit);

  const btnLabelAfterSave = await page.evaluate(() => document.getElementById('pipe-add-btn').textContent);
  const cancelVisibleAfterSave = await page.evaluate(() => document.getElementById('pipe-cancel-btn').style.display !== 'none');
  console.log('button label after save:', btnLabelAfterSave, 'cancel visible:', cancelVisibleAfterSave);

  // test cancel edit
  await page.evaluate(() => document.querySelectorAll('#pipeline-tbody tr')[1].querySelectorAll('button')[0].click());
  await new Promise(r => setTimeout(r, 80));
  const midEditBranch = await page.evaluate(() => document.getElementById('pipe-branch').value);
  await page.click('#pipe-cancel-btn');
  await new Promise(r => setTimeout(r, 80));
  const afterCancelBranch = await page.evaluate(() => document.getElementById('pipe-branch').value);
  const afterCancelBtnLabel = await page.evaluate(() => document.getElementById('pipe-add-btn').textContent);
  console.log('branch mid-edit:', midEditBranch, '-> after cancel:', afterCancelBranch, 'btn label:', afterCancelBtnLabel);

  // delete the row currently NOT being edited, verify count drops by 1 and form stays in add mode
  await page.evaluate(() => document.querySelectorAll('#pipeline-tbody tr')[0].querySelectorAll('button')[1].click());
  await new Promise(r => setTimeout(r, 100));
  const rowsAfterDelete = await page.evaluate(() => document.querySelectorAll('#pipeline-tbody tr').length);
  console.log('rows after delete:', rowsAfterDelete);

  console.log('TOTAL ERRORS:', errors.length, errors);
  await browser.close();
})();
