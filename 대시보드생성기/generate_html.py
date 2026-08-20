import sys
import app

with open("test.csv", "w", encoding="utf-8-sig") as f:
    f.write("영업본부명,관리본부명,영업지사명,영업자명,영업자소속,청약일자,계약상태(중),계약번호,상호,KTT월정료\n")
    f.write("A본부,관리A,지사1,홍길동,A팀,2023-01-01,유지,1,상호1,10000\n")
    f.write("A본부,관리A,지사1,김철수,A팀,2023-01-02,청약,2,상호2,20000\n")
    f.write("B본부,관리B,지사2,이영희,B팀,2023-01-03,청약취소,3,상호3,30000\n")

class MockApp(app.DashboardApp): pass
m = MockApp.__new__(MockApp)
m.csv_path_var = type('obj', (object,), {'get': lambda: 'test.csv'})()
m.output_path_var = type('obj', (object,), {'get': lambda: 'test_out.html'})()
m.open_after_var = type('obj', (object,), {'get': lambda: False})()
m._post = lambda fn: fn()
m._finish_success = lambda p: print("Success:", p)
m._finish_error = lambda t, e: print("Error:", t, e)
m._log = lambda t, error=False: print("Log:", t)

m._run_pipeline("test.csv", "test_out.html")
