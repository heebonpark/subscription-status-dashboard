# -*- coding: utf-8 -*-
"""
메인 실적 CSV(C150_G0000_00006.csv)와 별도 해지 전용 CSV(전사해지2024-20260821/
C150_G0000_00076.csv)를 하나의 청약현황대시보드용 CSV로 병합합니다.

배경 (정밀 검토 결과):
- 해지 전용 파일의 "일반해지" 고유 계약(86,889건) 중 23,157건은 메인 파일에도
  이미 "일반해지"로 존재하는 동일 계약입니다(100% 부분집합). 단순 합치면 이
  계약들이 두 번 집계됩니다.
- 그래서 메인 파일의 "일반해지" 행은 전부 제외하고, 해지 전용 파일의
  "일반해지"(전출해지 제외)로 통째로 대체합니다. 순증분은 63,732건입니다.
- 메인 파일은 "청약일자"(계약 시작일, 1995년까지 존재)를 날짜로 쓰지만,
  해지 트렌드 분석에는 의미가 없으므로 해지 전용 파일에서 가져온 행은
  "해지일자"(2024-01-01~2026-08-21, 결측 0건)를 "청약일자" 컬럼 자리에 넣어
  대시보드가 해지 "발생 시점" 기준으로 추이를 보여주도록 합니다. 원래
  청약일자는 감사 추적을 위해 "원본청약일자" 컬럼에 별도로 남겨둡니다.
- 영업지사명이 빈 값인 행은(순증분의 약 7%) 항상 채워져 있는 관리지사명으로
  대체합니다(영업본부명/관리본부명도 동일하게 처리).
- KTT월정료가 빈칸/0인 해지 건은 실제로 존재할 수 있는 값이라 그대로 두되,
  app.py / template.html 쪽 파서를 "취소/해지 상태의 0원은 건너뛰지 않는다"로
  이미 수정해두었으므로 해지 건수 자체가 누락되지 않습니다.
- 같은 계약번호가 여러 번 나올 수 있는데(중복 스냅샷), 메인 CSV(1번 파일)도
  행 단위로 그대로 세는 것과 동일하게 여기서도 행을 그대로 각각 셉니다
  (건수를 원본 파일 기준과 맞추기 위함 — 엑셀 피벗으로 직접 검증한 결과
  2026년 8월 강북/강원본부 기준 607건이 정확한 원본 건수였습니다). KTT월정료가
  빈 사본은 0원으로 들어가므로 합계에는 영향이 없습니다.

사용법:
    python3 merge_termination_data.py

출력: merged_청약현황.csv (UTF-8 BOM, 표준 좁은 스키마)
"""
import csv
import os

MAIN_PATH = "C150_G0000_00006.csv"
TERM_PATH = os.path.join("전사해지2024-20260821", "C150_G0000_00076.csv")
OUT_PATH = "merged_청약현황.csv"

OUT_COLS = [
    "영업본부명", "관리본부명", "영업지사명", "영업자명", "영업자소속",
    "청약일자", "계약상태(중)", "계약번호", "상호", "KTT월정료", "추천자명",
    "원본청약일자", "데이터출처",
]


def read_header_index(reader):
    header = next(reader)
    return {name: i for i, name in enumerate(header)}, header


def get(row, idx, col, default=""):
    i = idx.get(col, -1)
    if i < 0 or i >= len(row):
        return default
    return row[i].strip()


def normalize_hq(v):
    return v  # 강원본부/서부본부 등의 재라벨링은 다운스트림(app.py/template.html)에서 처리


def parse_fee(raw):
    cleaned = re.sub(r"[^0-9-]", "", raw or "")
    if cleaned in ("", "-"):
        return 0
    try:
        return int(cleaned)
    except ValueError:
        return 0


def main():
    term_rows_out = []
    excluded_transfer = 0

    with open(TERM_PATH, "r", encoding="cp949", errors="replace", newline="") as f:
        reader = csv.reader(f)
        idx, _ = read_header_index(reader)
        for row in reader:
            status = get(row, idx, "계약상태(중)")
            if status == "전출해지":
                excluded_transfer += 1
                continue
            if status != "일반해지":
                continue
            cid = get(row, idx, "계약번호")
            fee_str = get(row, idx, "KTT월정료")

            # 관리지사명/관리본부명을 우선합니다: 영업지사명/영업본부명은 "본사",
            # "OO법인영업팀" 같은 비지역 영업채널명이 27%가량 섞여 있어 지역별
            # 집계 기준으로 쓰면 안 됩니다(관리 조직은 항상 채워져 있음).
            biz_branch = get(row, idx, "관리지사명") or get(row, idx, "영업지사명")
            biz_hq = get(row, idx, "관리본부명") or get(row, idx, "영업본부명")
            cancel_date = get(row, idx, "해지일자")
            orig_apply_date = get(row, idx, "청약일자")

            term_rows_out.append([
                normalize_hq(biz_hq),
                get(row, idx, "관리본부명"),
                biz_branch,
                get(row, idx, "영업자명"),
                get(row, idx, "영업자소속"),
                cancel_date,           # 청약일자 컬럼 자리에 해지일자를 넣음 (의도된 대체)
                "일반해지",
                cid,
                get(row, idx, "상호"),
                fee_str,
                get(row, idx, "추천자명"),
                orig_apply_date,
                "해지파일",
            ])

    main_rows_out = []
    main_excluded_normal_cancel = 0
    with open(MAIN_PATH, "r", encoding="cp949", errors="replace", newline="") as f:
        reader = csv.reader(f)
        idx, _ = read_header_index(reader)
        for row in reader:
            status = get(row, idx, "계약상태(중)")
            if status == "일반해지":
                main_excluded_normal_cancel += 1
                continue
            main_rows_out.append([
                normalize_hq(get(row, idx, "영업본부명")),
                get(row, idx, "관리본부명"),
                get(row, idx, "영업지사명"),
                get(row, idx, "영업자명"),
                get(row, idx, "영업자소속"),
                get(row, idx, "청약일자"),
                status,
                get(row, idx, "계약번호"),
                get(row, idx, "상호"),
                get(row, idx, "KTT월정료"),
                get(row, idx, "추천자명"),
                "",
                "메인파일",
            ])

    with open(OUT_PATH, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(OUT_COLS)
        writer.writerows(main_rows_out)
        writer.writerows(term_rows_out)

    print("메인파일 유지행:", len(main_rows_out), "(일반해지 제외:", main_excluded_normal_cancel, ")")
    print("해지파일 반영행(일반해지):", len(term_rows_out))
    print("  - 전출해지 제외:", excluded_transfer)
    print("최종 출력 행수:", len(main_rows_out) + len(term_rows_out))
    print("출력 파일:", OUT_PATH)


if __name__ == "__main__":
    main()
