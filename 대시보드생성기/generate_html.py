import sys
import app

import random
random.seed(42)
BRANCHES = [("강원본부", "중앙지사"), ("강원본부", "강북지사"), ("강원본부", "의정부지사"), ("서부본부", "판교지사"), ("서부본부", "분당지사")]
AGENTS = ["홍길동", "김철수", "이영희", "박민수", "최지우", "정하나", "오세훈", "강민재"]
STATUSES = ["유지", "청약", "청약취소"]
with open("test.csv", "w", encoding="utf-8-sig") as f:
    f.write("영업본부명,관리본부명,영업지사명,영업자명,영업자소속,청약일자,계약상태(중),계약번호,상호,KTT월정료\n")
    n = 1
    for month in ["2026-06", "2026-07", "2026-08"]:
        for day in range(1, 22):
            if random.random() > 0.55:
                continue
            hq, branch = random.choice(BRANCHES)
            agent = random.choice(AGENTS)
            status = random.choices(STATUSES, weights=[60, 25, 15])[0]
            fee = random.choice([10000, 15000, 20000, 25000, 30000])
            date = "%s-%02d" % (month, day)
            f.write("%s,관리팀,%s,%s,%s팀,%s,%s,%d,상호%d,%d\n" % (hq, branch, agent, agent[0], date, status, n, n, fee))
            n += 1

class MockApp(app.DashboardApp): pass
m = MockApp.__new__(MockApp)
m.csv_path_var = type('obj', (object,), {'get': lambda: 'test.csv'})()
m.output_path_var = type('obj', (object,), {'get': lambda: 'test_out.html'})()
m.open_after_var = type('obj', (object,), {'get': lambda: False})()
m._post = lambda fn: fn()
m._finish_success = lambda p: print("Success:", p)
m._finish_error = lambda t, e: print("Error:", t, e)
m._log = lambda t, error=False: print("Log:", t)
m.cfg = {}
m._save_cfg = lambda: None

m._run_pipeline("test.csv", "test_out.html")
