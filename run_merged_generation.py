import sys
import time
sys.path.insert(0, "대시보드생성기")
import app

INPUT = "merged_청약현황.csv"
OUTPUT = "청약현황_대시보드_병합_20260821.html"

t0 = time.time()
print("CSV 읽는 중:", INPUT)
records, skipped, status_counts, encoding = app.read_csv_records(INPUT)
print("인코딩:", encoding)
print(app.build_summary(records, skipped, status_counts, encoding))

print("\n대시보드 HTML 생성 중:", OUTPUT)
size_bytes = app.generate_dashboard_html(records, OUTPUT)
print("완료: {0:,} bytes ({1:.1f} MB), {2:.1f}초".format(size_bytes, size_bytes / (1024 * 1024), time.time() - t0))
