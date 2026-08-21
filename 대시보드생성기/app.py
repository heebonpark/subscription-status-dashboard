# -*- coding: utf-8 -*-
"""
청약현황 대시보드 생성기
CSV 실적 파일을 읽어 청약현황 대시보드(HTML) 파일을 자동으로 생성하는 GUI 프로그램입니다.
Python 표준 라이브러리(tkinter)만 사용하므로 별도 설치 없이 실행됩니다.
"""

import csv
import json
import os
import pathlib
import re
import sys
import threading
import traceback
import webbrowser
from datetime import datetime

try:
    import tkinter as tk
    from tkinter import ttk, filedialog, messagebox
except ImportError:
    sys.stderr.write(
        "이 프로그램을 실행하려면 tkinter가 필요합니다.\n"
        "Python 설치 시 tkinter가 빠졌을 수 있습니다. python.org에서 받은 기본 설치본은\n"
        "tkinter를 포함하므로, python.org에서 Python을 다시 설치해 보세요.\n"
    )
    err_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "error.log")
    try:
        with open(err_path, "a", encoding="utf-8") as f:
            f.write("\n---- " + datetime.now().isoformat() + " ----\n")
            f.write("tkinter import 실패: " + traceback.format_exc())
    except Exception:
        pass
    sys.exit(1)

APP_TITLE = "청약현황 대시보드 생성기"
APP_VERSION = "1.1.0"

# 대시보드 HTML의 색상 톤과 맞춘 팔레트
COLOR_ACCENT = "#2a78d6"
COLOR_ACCENT_HOVER = "#2264b8"
COLOR_ACCENT_ACTIVE = "#1a4f96"
COLOR_ACCENT_DISABLED = "#a9c6ea"
COLOR_BG = "#f4f5f7"
COLOR_CARD = "#ffffff"
COLOR_BORDER = "#dde1e6"
COLOR_TEXT = "#111418"
COLOR_MUTED = "#68707b"
COLOR_GOOD = "#0ca30c"

if getattr(sys, "frozen", False):
    # PyInstaller(--onefile)로 빌드된 실행 파일인 경우:
    # 번들 리소스(template.html)는 임시 해제 폴더(_MEIPASS)에서 읽고,
    # 설정/로그처럼 계속 남아야 하는 파일은 exe가 있는 폴더에 씁니다.
    RESOURCE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    DATA_DIR = os.path.dirname(sys.executable)
else:
    RESOURCE_DIR = os.path.dirname(os.path.abspath(__file__))
    DATA_DIR = RESOURCE_DIR

BASE_DIR = DATA_DIR  # 하위 호환용 별칭
TEMPLATE_PATH = os.path.join(RESOURCE_DIR, "template.html")
CONFIG_PATH = os.path.join(DATA_DIR, "config.json")
DATA_PLACEHOLDER = "__DASHBOARD_DATA_JSON__"

REQUIRED_COLS = ["영업지사명", "영업자명", "영업자소속", "청약일자", "계약상태(중)", "계약번호", "상호", "KTT월정료"]
OPTIONAL_REFERRER_COL = "추천자명"

STATUS_LABELS = {"유지": "유지", "청약": "청약(진행)", "청약취소": "취소(1번 파일)", "해지": "해지(일반해지)"}


# ---------------------------------------------------------------------------
# CSV -> records 변환 (대시보드 HTML의 "파일 업로드" 기능과 동일한 규칙 사용)
# ---------------------------------------------------------------------------

def normalize_date(raw):
    s = (raw or "").strip()
    if re.match(r"^\d{8}$", s):
        return s[0:4] + "-" + s[4:6] + "-" + s[6:8]
    if re.match(r"^\d{4}-\d{2}-\d{2}", s):
        return s[0:10]
    if re.match(r"^\d{4}/\d{2}/\d{2}", s):
        return s[0:10].replace("/", "-")
    return None


def classify_status(raw):
    """1번 파일(메인 CSV)의 취소/해지류(청약취소·명변해지·전출해지 등)는
    해지(일반해지, 2번 파일)와 별개이며 대시보드 전체에서 제외합니다.
    해당 상태는 None을 반환하니 호출부에서 건너뛰어야 합니다."""
    s = (raw or "").strip()
    if s == "일반해지":
        return "해지"
    if "취소" in s or "해지" in s:
        return None
    if s == "유지" or s == "명변유지":
        return "유지"
    return "청약"


class CsvFormatError(Exception):
    pass


def _set_max_csv_field_size():
    """csv.field_size_limit()은 내부적으로 C의 long 타입을 사용합니다.
    Windows에서는 64비트 파이썬이라도 C의 long이 32비트라서, 64비트 값인
    sys.maxsize를 그대로 넘기면 OverflowError가 납니다(macOS/Linux에서는
    C의 long이 64비트라 문제없이 통과되어 여기서만 발견되지 않았던 문제).
    실제로 넘어가는 가장 큰 값을 찾아 설정합니다."""
    limit = sys.maxsize
    while True:
        try:
            csv.field_size_limit(limit)
            return
        except OverflowError:
            limit //= 10


_set_max_csv_field_size()


def _parse_with_encoding(path, encoding, exclude_raw_status=None):
    records = []
    skipped = 0
    status_counts = {}
    exclude_raw_status = exclude_raw_status or frozenset()

    with open(path, encoding=encoding, newline="") as f:
        reader = csv.reader(f)
        try:
            header = next(reader)
        except StopIteration:
            raise CsvFormatError("CSV 파일에 데이터가 없습니다.")

        missing = [c for c in REQUIRED_COLS if c not in header]
        if missing:
            raise CsvFormatError("필수 컬럼이 없습니다: " + ", ".join(missing))

        idx = {c: header.index(c) for c in REQUIRED_COLS}
        ref_idx = header.index(OPTIONAL_REFERRER_COL) if OPTIONAL_REFERRER_COL in header else -1
        
        hq_idx = -1
        for hq_col in ["영업본부명", "관리본부명"]:
            if hq_col in header:
                hq_idx = header.index(hq_col)
                break

        i_branch, i_agent, i_aff = idx["영업지사명"], idx["영업자명"], idx["영업자소속"]
        i_date, i_status = idx["청약일자"], idx["계약상태(중)"]
        i_contract, i_company, i_fee = idx["계약번호"], idx["상호"], idx["KTT월정료"]

        for row in reader:
            if len(row) < 2:
                skipped += 1
                continue
            date = normalize_date(row[i_date] if i_date < len(row) else "")
            if not date:
                skipped += 1
                continue

            raw_status = row[i_status] if i_status < len(row) else ""
            if raw_status in exclude_raw_status:
                skipped += 1
                continue
            status_counts[raw_status] = status_counts.get(raw_status, 0) + 1
            status = classify_status(raw_status)
            if status is None:
                # 1번 파일의 취소/해지류(청약취소·명변해지·전출해지 등)는 해지와
                # 별개이며 대시보드 전체에서 제외합니다.
                skipped += 1
                continue

            fee_raw = re.sub(r"[^0-9-]", "", (row[i_fee] if i_fee < len(row) else "0") or "0")
            try:
                fee = int(fee_raw) if fee_raw not in ("", "-") else 0
            except ValueError:
                fee = 0

            # 월정료 0원/빈칸은 상태에 관계없이 제외합니다(엑셀 직접 검증 결과와
            # 일치하는 기준입니다).
            if fee == 0:
                skipped += 1
                continue

            hq_val = (row[hq_idx] if 0 <= hq_idx < len(row) else "").strip()
            if hq_val == "강원본부": hq_val = "강북/강원본부"
            elif hq_val == "서부본부": hq_val = "강남/서부본부"

            records.append([
                (row[i_branch] if i_branch < len(row) else "").strip(),
                (row[i_agent] if i_agent < len(row) else "").strip(),
                (row[i_aff] if i_aff < len(row) else "").strip(),
                date,
                status,
                (row[i_contract] if i_contract < len(row) else "").strip(),
                (row[i_company] if i_company < len(row) else "").strip(),
                fee,
                (row[ref_idx] if 0 <= ref_idx < len(row) else "").strip(),
                hq_val,
            ])

    return records, skipped, status_counts


def read_csv_records(path, exclude_raw_status=None):
    """UTF-8(BOM 포함) 우선 시도 후, 실패하면 CP949(EUC-KR)로 재시도합니다."""
    last_error = None
    for encoding in ("utf-8-sig", "cp949"):
        try:
            records, skipped, status_counts = _parse_with_encoding(path, encoding, exclude_raw_status)
            return records, skipped, status_counts, encoding
        except UnicodeDecodeError as e:
            last_error = e
            continue
    raise CsvFormatError(
        "CSV 파일의 인코딩을 인식할 수 없습니다 (UTF-8 / CP949 모두 실패). "
        "원본 프로그램에서 CSV로 다시 내보내 주세요."
    ) from last_error


TERM_REQUIRED_COLS = ["영업지사명", "영업자명", "영업자소속", "해지일자", "계약상태(중)", "계약번호", "상호", "KTT월정료"]


def _parse_termination_with_encoding(path, encoding):
    """해지 전용 CSV(전사 해지 export 등 넓은 스키마)에서 계약상태(중)이
    '일반해지'인 행만 추려 표준 레코드로 변환합니다.
    - '전출해지'는 제외합니다(단순 관리 이관이라 실질적 해지가 아님).
    - 같은 계약번호가 여러 번 나올 수 있는데(중복 스냅샷), 메인 CSV(1번 파일)도
      행 단위로 그대로 세는 것과 동일하게 여기서도 행을 그대로 각각 셉니다
      (건수를 원본 파일 기준과 맞추기 위함). KTT월정료가 빈 사본은 0원으로
      들어가므로 합계에는 영향이 없습니다.
    - 날짜는 청약일자가 아니라 해지일자를 사용해, 실제 해지가 발생한 시점
      기준으로 추이를 볼 수 있게 합니다.
    - 영업지사명/영업본부명이 비어 있으면 관리지사명/관리본부명으로 대체합니다.
    """
    records = []
    skipped = 0
    excluded_transfer = 0

    with open(path, encoding=encoding, newline="") as f:
        reader = csv.reader(f)
        try:
            header = next(reader)
        except StopIteration:
            raise CsvFormatError("해지 전용 CSV 파일에 데이터가 없습니다.")

        missing = [c for c in TERM_REQUIRED_COLS if c not in header]
        if missing:
            raise CsvFormatError("해지 전용 CSV 파일에 필수 컬럼이 없습니다: " + ", ".join(missing))

        idx = {c: header.index(c) for c in TERM_REQUIRED_COLS}

        def opt_idx(name):
            return header.index(name) if name in header else -1

        i_mgmt_branch = opt_idx("관리지사명")
        i_biz_hq = opt_idx("영업본부명")
        i_mgmt_hq = opt_idx("관리본부명")
        ref_idx = opt_idx(OPTIONAL_REFERRER_COL)

        i_branch, i_agent, i_aff = idx["영업지사명"], idx["영업자명"], idx["영업자소속"]
        i_cancel_date, i_status = idx["해지일자"], idx["계약상태(중)"]
        i_contract, i_company, i_fee = idx["계약번호"], idx["상호"], idx["KTT월정료"]

        for row in reader:
            if len(row) < 2:
                skipped += 1
                continue

            status = row[i_status] if i_status < len(row) else ""
            if status == "전출해지":
                excluded_transfer += 1
                continue
            if status != "일반해지":
                continue  # 해지 전용 파일에서는 일반해지만 취급합니다.

            contract_id = (row[i_contract] if i_contract < len(row) else "").strip()

            date = normalize_date(row[i_cancel_date] if i_cancel_date < len(row) else "")
            if not date:
                skipped += 1
                continue

            fee_raw = re.sub(r"[^0-9-]", "", (row[i_fee] if i_fee < len(row) else "0") or "0")
            try:
                fee = int(fee_raw) if fee_raw not in ("", "-") else 0
            except ValueError:
                fee = 0
            # KTT월정료가 0원/빈칸인 행은 제외합니다(엑셀로 직접 검증: 2026년 8월
            # 강북/강원본부 기준 원본 607건 중 82건이 0원이었고, 이를 제외한
            # 525건 · 23,340,013원이 실제 정답과 일치했습니다).
            if fee == 0:
                skipped += 1
                continue

            # 관리지사명/관리본부명을 우선합니다: 영업지사명/영업본부명은 "본사",
            # "OO법인영업팀", "OOSI영업팀" 같은 비지역 영업채널명이 27%가량 섞여
            # 있어 지역별 집계 기준으로 쓰면 안 됩니다(관리 조직은 항상 채워져
            # 있고 실제 서비스 지역을 나타냅니다).
            branch = (row[i_mgmt_branch] if 0 <= i_mgmt_branch < len(row) else "").strip()
            if not branch and i_branch < len(row):
                branch = row[i_branch].strip()

            hq_val = (row[i_mgmt_hq] if 0 <= i_mgmt_hq < len(row) else "").strip()
            if not hq_val and 0 <= i_biz_hq < len(row):
                hq_val = row[i_biz_hq].strip()
            if hq_val == "강원본부":
                hq_val = "강북/강원본부"
            elif hq_val == "서부본부":
                hq_val = "강남/서부본부"

            records.append([
                branch,
                (row[i_agent] if i_agent < len(row) else "").strip(),
                (row[i_aff] if i_aff < len(row) else "").strip(),
                date,
                classify_status("일반해지"),
                contract_id,
                (row[i_company] if i_company < len(row) else "").strip(),
                fee,
                (row[ref_idx] if 0 <= ref_idx < len(row) else "").strip(),
                hq_val,
            ])

    return records, skipped, excluded_transfer


def read_termination_csv_records(path):
    """UTF-8(BOM 포함) 우선 시도 후, 실패하면 CP949(EUC-KR)로 재시도합니다."""
    last_error = None
    for encoding in ("utf-8-sig", "cp949"):
        try:
            records, skipped, excluded_transfer = _parse_termination_with_encoding(path, encoding)
            return records, skipped, excluded_transfer, encoding
        except UnicodeDecodeError as e:
            last_error = e
            continue
    raise CsvFormatError(
        "해지 전용 CSV 파일의 인코딩을 인식할 수 없습니다 (UTF-8 / CP949 모두 실패)."
    ) from last_error


def build_summary(records, skipped, status_counts, encoding):
    lines = []
    lines.append("인코딩 감지: " + encoding)
    lines.append("총 {0:,}건 처리 (건너뜀 {1:,}건)".format(len(records), skipped))
    if records:
        dates = sorted(r[3] for r in records)
        lines.append("청약일자 범위: {0} ~ {1}".format(dates[0], dates[-1]))
        branches = sorted(set(r[0] for r in records))
        lines.append("지사 수: {0}개 ({1})".format(len(branches), ", ".join(branches[:8]) + (" 외" if len(branches) > 8 else "")))
        agents = set((r[0], r[1], r[2]) for r in records)
        lines.append("영업자 수(지사·소속 기준 고유): {0:,}명".format(len(agents)))
        total_fee = sum(r[7] for r in records)
        lines.append("월정료 합계: {0:,}천원".format(round(total_fee / 1000)))
        lines.append("상태값 원본 분포:")
        for raw, cnt in sorted(status_counts.items(), key=lambda kv: -kv[1]):
            bucket = classify_status(raw)
            label = STATUS_LABELS[bucket] if bucket else "제외됨(1번 파일 취소/해지류)"
            lines.append("  · {0!r} → {1} : {2:,}건".format(raw, label, cnt))
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# HTML 생성
# ---------------------------------------------------------------------------

def generate_dashboard_html(records, output_path):
    if not os.path.isfile(TEMPLATE_PATH):
        raise FileNotFoundError(
            "template.html 파일을 찾을 수 없습니다.\n"
            "app.py와 같은 폴더에 template.html이 있어야 합니다: " + TEMPLATE_PATH
        )
    with open(TEMPLATE_PATH, encoding="utf-8") as f:
        template = f.read()

    if DATA_PLACEHOLDER not in template:
        raise ValueError("template.html 형식이 올바르지 않습니다 (데이터 삽입 위치를 찾을 수 없음).")

    data_json = json.dumps({"records": records}, ensure_ascii=False, separators=(",", ":"))
    html = template.replace(DATA_PLACEHOLDER, data_json)

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)

    return os.path.getsize(output_path)


# ---------------------------------------------------------------------------
# 설정 저장/불러오기 (마지막 입출력 경로 기억)
# ---------------------------------------------------------------------------

def load_config():
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_config(cfg):
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# GUI
# ---------------------------------------------------------------------------

class DashboardApp:
    def __init__(self, root):
        self.root = root
        self.root.title(APP_TITLE + " v" + APP_VERSION)
        self.root.geometry("820x760")
        self.root.minsize(700, 620)
        self.root.configure(bg=COLOR_BG)

        self.cfg = load_config()
        self.input_var = tk.StringVar(value=self.cfg.get("last_input", ""))
        self.term_input_var = tk.StringVar(value=self.cfg.get("last_term_input", ""))
        self.output_var = tk.StringVar(value=self.cfg.get("last_output", ""))
        self.open_after_var = tk.BooleanVar(value=self.cfg.get("open_after", True))
        self.status_var = tk.StringVar(value="준비됨")

        self._build_style()
        self._build_widgets()
        self._worker = None

    # ---- UI 구성 ----------------------------------------------------------

    def _build_style(self):
        style = ttk.Style()
        # clam은 색상을 완전히 커스터마이즈할 수 있는 유일한 내장 테마라
        # 대시보드와 톤을 맞춘 버튼/진행바 색을 정확히 낼 수 있습니다.
        try:
            style.theme_use("clam")
        except Exception:
            pass

        base_font = ("Segoe UI", 10)
        style.configure(".", font=base_font, background=COLOR_BG, foreground=COLOR_TEXT)

        style.configure("TFrame", background=COLOR_BG)
        style.configure("Card.TFrame", background=COLOR_CARD)

        style.configure("TLabel", background=COLOR_BG, foreground=COLOR_TEXT)
        style.configure("Title.TLabel", font=("Segoe UI", 17, "bold"), background=COLOR_BG, foreground=COLOR_TEXT)
        style.configure("Sub.TLabel", font=("Segoe UI", 9), background=COLOR_BG, foreground=COLOR_MUTED)
        style.configure("Status.TLabel", font=("Segoe UI", 9), background=COLOR_BG, foreground=COLOR_MUTED)

        style.configure(
            "TLabelframe", background=COLOR_BG, bordercolor=COLOR_BORDER,
            lightcolor=COLOR_BORDER, darkcolor=COLOR_BORDER, borderwidth=1, relief="solid",
        )
        style.configure(
            "Section.TLabelframe.Label", font=("Segoe UI", 10, "bold"),
            background=COLOR_BG, foreground=COLOR_TEXT,
        )

        style.configure(
            "TEntry", padding=7, fieldbackground=COLOR_CARD,
            bordercolor=COLOR_BORDER, lightcolor=COLOR_BORDER, darkcolor=COLOR_BORDER,
        )
        style.map("TEntry", bordercolor=[("focus", COLOR_ACCENT)])

        style.configure(
            "TButton", font=("Segoe UI", 9), padding=(12, 7),
            background=COLOR_CARD, foreground=COLOR_TEXT,
            bordercolor=COLOR_BORDER, lightcolor=COLOR_CARD, darkcolor=COLOR_CARD,
        )
        style.map(
            "TButton",
            background=[("active", "#eef1f5"), ("pressed", "#e4e8ed")],
        )

        style.configure(
            "Primary.TButton", font=("Segoe UI", 11, "bold"), padding=(20, 10),
            background=COLOR_ACCENT, foreground="#ffffff",
            bordercolor=COLOR_ACCENT, lightcolor=COLOR_ACCENT, darkcolor=COLOR_ACCENT,
        )
        style.map(
            "Primary.TButton",
            background=[
                ("disabled", COLOR_ACCENT_DISABLED),
                ("pressed", COLOR_ACCENT_ACTIVE),
                ("active", COLOR_ACCENT_HOVER),
            ],
            foreground=[("disabled", "#f0f4fa")],
        )

        style.configure("TCheckbutton", background=COLOR_BG, foreground=COLOR_TEXT, font=("Segoe UI", 9))
        style.map("TCheckbutton", background=[("active", COLOR_BG)])

        style.configure(
            "Horizontal.TProgressbar", background=COLOR_ACCENT, troughcolor="#e6e9ee",
            bordercolor="#e6e9ee", lightcolor=COLOR_ACCENT, darkcolor=COLOR_ACCENT, thickness=10,
        )

        style.configure("TSeparator", background=COLOR_BORDER)
        style.configure(
            "Vertical.TScrollbar", background="#d3d8de", troughcolor=COLOR_CARD,
            bordercolor=COLOR_CARD, arrowcolor=COLOR_MUTED,
        )

    def _badge(self, parent, text, size=22):
        badge = tk.Frame(parent, bg=COLOR_ACCENT, width=size, height=size)
        badge.pack_propagate(False)
        tk.Label(
            badge, text=text, font=("Segoe UI", 9, "bold"), bg=COLOR_ACCENT, fg="#ffffff",
        ).place(relx=0.5, rely=0.5, anchor="center")
        return badge

    def _section_label(self, labelframe, number, title):
        row = tk.Frame(labelframe, bg=COLOR_BG)
        self._badge(row, str(number)).pack(side="left", padx=(0, 7))
        tk.Label(
            row, text=title, font=("Segoe UI", 10, "bold"), bg=COLOR_BG, fg=COLOR_TEXT,
        ).pack(side="left")
        return row

    def _build_widgets(self):
        pad = {"padx": 16, "pady": 9}

        # 헤더 (아이콘 마크 + 제목 + 부제)
        header = ttk.Frame(self.root)
        header.pack(fill="x", padx=16, pady=(18, 6))
        mark = tk.Frame(header, bg=COLOR_ACCENT, width=36, height=36)
        mark.pack_propagate(False)
        tk.Label(mark, text="청", font=("Segoe UI", 13, "bold"), bg=COLOR_ACCENT, fg="#ffffff").place(
            relx=0.5, rely=0.5, anchor="center"
        )
        mark.pack(side="left", anchor="n")
        title_col = ttk.Frame(header)
        title_col.pack(side="left", fill="x", expand=True, padx=(12, 0))
        ttk.Label(title_col, text=APP_TITLE, style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            title_col,
            text="청약 실적 CSV를 선택하면 청약현황 대시보드(HTML)를 자동으로 만들어 드립니다.",
            style="Sub.TLabel",
        ).pack(anchor="w", pady=(2, 0))

        # 입력 파일
        in_frame = ttk.LabelFrame(self.root)
        in_frame.configure(labelwidget=self._section_label(in_frame, 1, "실적 CSV 파일"))
        in_frame.pack(fill="x", **pad)
        row1 = ttk.Frame(in_frame)
        row1.pack(fill="x", padx=12, pady=12)
        ttk.Entry(row1, textvariable=self.input_var).pack(side="left", fill="x", expand=True, ipady=2)
        ttk.Button(row1, text="찾아보기...", command=self.pick_input).pack(side="left", padx=(8, 0))

        # 해지 전용 CSV 파일 (선택 - 있으면 자동 병합)
        term_frame = ttk.LabelFrame(self.root)
        term_frame.configure(labelwidget=self._section_label(term_frame, 2, "해지 전용 CSV 파일 (선택 · 있으면 자동 병합)"))
        term_frame.pack(fill="x", **pad)
        row_term = ttk.Frame(term_frame)
        row_term.pack(fill="x", padx=12, pady=(12, 4))
        ttk.Entry(row_term, textvariable=self.term_input_var).pack(side="left", fill="x", expand=True, ipady=2)
        ttk.Button(row_term, text="찾아보기...", command=self.pick_term_input).pack(side="left", padx=(8, 0))
        ttk.Button(row_term, text="지우기", command=lambda: self.term_input_var.set("")).pack(side="left", padx=(6, 0))
        ttk.Label(
            term_frame,
            text="계약상태(중)이 '일반해지'인 행만 반영됩니다(전출해지 제외). 실적 CSV에 이미 있는 동일 계약(일반해지)은\n"
                 "자동으로 이 파일 값으로 대체되어 중복 집계되지 않으며, 날짜는 청약일자 대신 해지일자를 사용합니다.",
            style="Sub.TLabel", justify="left",
        ).pack(anchor="w", padx=12, pady=(0, 12))

        # 출력 파일
        out_frame = ttk.LabelFrame(self.root)
        out_frame.configure(labelwidget=self._section_label(out_frame, 3, "생성할 대시보드 HTML"))
        out_frame.pack(fill="x", **pad)
        row2 = ttk.Frame(out_frame)
        row2.pack(fill="x", padx=12, pady=12)
        ttk.Entry(row2, textvariable=self.output_var).pack(side="left", fill="x", expand=True, ipady=2)
        ttk.Button(row2, text="다른 이름으로...", command=self.pick_output).pack(side="left", padx=(8, 0))

        opt_row = ttk.Frame(out_frame)
        opt_row.pack(fill="x", padx=12, pady=(0, 12))
        ttk.Checkbutton(
            opt_row, text="생성 후 브라우저에서 바로 열기", variable=self.open_after_var
        ).pack(anchor="w")

        # 실행 버튼 + 진행바
        action_frame = ttk.Frame(self.root)
        action_frame.pack(fill="x", padx=16, pady=(6, 6))
        self.generate_btn = ttk.Button(
            action_frame, text="▶  대시보드 생성", style="Primary.TButton", command=self.on_generate
        )
        self.generate_btn.pack(side="left")
        self.progress = ttk.Progressbar(action_frame, mode="indeterminate")
        self.progress.pack(side="left", fill="x", expand=True, padx=(14, 0), ipady=1)

        # 상태바 (log_frame이 expand=True로 남은 공간을 전부 차지하기 전에
        # 먼저 pack해야 실제로 높이를 배정받습니다 — pack()은 side 값과 무관하게
        # 호출 순서대로 공간을 먼저 차지한 위젯이 우선합니다)
        status_bar = ttk.Frame(self.root)
        status_bar.pack(fill="x", side="bottom")
        ttk.Separator(status_bar).pack(fill="x")
        ttk.Label(
            status_bar, textvariable=self.status_var, style="Status.TLabel", padding=(12, 6)
        ).pack(anchor="w")

        # 로그
        log_frame = ttk.LabelFrame(self.root)
        log_frame.configure(labelwidget=self._section_label(log_frame, 4, "처리 로그"))
        log_frame.pack(fill="both", expand=True, padx=16, pady=(6, 10))
        log_inner = tk.Frame(
            log_frame, bg=COLOR_CARD, highlightthickness=1, highlightbackground=COLOR_BORDER,
        )
        log_inner.pack(fill="both", expand=True, padx=12, pady=12)
        self.log_text = tk.Text(
            log_inner, wrap="word", height=14, font=("Consolas", 10),
            bg=COLOR_CARD, fg=COLOR_TEXT, insertbackground=COLOR_TEXT,
            relief="flat", borderwidth=0, padx=10, pady=8, state="disabled",
        )
        self.log_text.tag_configure("error", foreground="#d03b3b")
        scroll = ttk.Scrollbar(log_inner, command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=scroll.set)
        self.log_text.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

        if not self.input_var.get():
            self._log("CSV 파일을 선택한 뒤 [대시보드 생성] 버튼을 누르세요.")

    # ---- 로그 유틸 ----------------------------------------------------------

    def _log(self, text, error=False):
        self.log_text.configure(state="normal")
        self.log_text.insert("end", text + "\n", ("error",) if error else ())
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def _clear_log(self):
        self.log_text.configure(state="normal")
        self.log_text.delete("1.0", "end")
        self.log_text.configure(state="disabled")

    # ---- 파일 선택 ----------------------------------------------------------

    def pick_input(self):
        initial_dir = os.path.dirname(self.input_var.get()) if self.input_var.get() else BASE_DIR
        path = filedialog.askopenfilename(
            title="실적 CSV 파일 선택",
            initialdir=initial_dir if os.path.isdir(initial_dir) else BASE_DIR,
            filetypes=[("CSV 파일", "*.csv"), ("모든 파일", "*.*")],
        )
        if not path:
            return
        self.input_var.set(path)
        if not self.output_var.get():
            self._suggest_output(path)

    def pick_term_input(self):
        initial_dir = os.path.dirname(self.term_input_var.get()) if self.term_input_var.get() else BASE_DIR
        path = filedialog.askopenfilename(
            title="해지 전용 CSV 파일 선택",
            initialdir=initial_dir if os.path.isdir(initial_dir) else BASE_DIR,
            filetypes=[("CSV 파일", "*.csv"), ("모든 파일", "*.*")],
        )
        if path:
            self.term_input_var.set(path)

    def _suggest_output(self, input_path):
        folder = os.path.dirname(input_path) or BASE_DIR
        stamp = datetime.now().strftime("%Y%m%d")
        name = "청약현황_대시보드_{0}.html".format(stamp)
        self.output_var.set(os.path.join(folder, name))

    def pick_output(self):
        initial_dir = os.path.dirname(self.output_var.get()) if self.output_var.get() else BASE_DIR
        path = filedialog.asksaveasfilename(
            title="대시보드 HTML 저장 위치",
            initialdir=initial_dir if os.path.isdir(initial_dir) else BASE_DIR,
            defaultextension=".html",
            filetypes=[("HTML 파일", "*.html")],
            initialfile=os.path.basename(self.output_var.get()) or "청약현황_대시보드.html",
        )
        if path:
            self.output_var.set(path)

    # ---- 생성 실행 ----------------------------------------------------------

    def on_generate(self):
        if self._worker and self._worker.is_alive():
            return

        input_path = self.input_var.get().strip()
        term_input_path = self.term_input_var.get().strip()
        output_path = self.output_var.get().strip()

        if not input_path:
            messagebox.showwarning(APP_TITLE, "실적 CSV 파일을 선택해 주세요.")
            return
        if not os.path.isfile(input_path):
            messagebox.showerror(APP_TITLE, "선택한 CSV 파일을 찾을 수 없습니다:\n" + input_path)
            return
        if term_input_path and not os.path.isfile(term_input_path):
            messagebox.showerror(APP_TITLE, "선택한 해지 전용 CSV 파일을 찾을 수 없습니다:\n" + term_input_path)
            return
        if not output_path:
            self._suggest_output(input_path)
            output_path = self.output_var.get().strip()

        if os.path.isfile(output_path):
            if not messagebox.askyesno(APP_TITLE, "출력 파일이 이미 있습니다. 덮어쓸까요?\n" + output_path):
                return

        self._clear_log()
        self.status_var.set("처리 중...")
        self.generate_btn.configure(state="disabled")
        self.progress.start(12)

        self._worker = threading.Thread(
            target=self._run_pipeline, args=(input_path, output_path, term_input_path), daemon=True
        )
        self._worker.start()

    def _run_pipeline(self, input_path, output_path, term_input_path=""):
        try:
            self._post(lambda: self._log("CSV 읽는 중: " + input_path))
            exclude_status = {"일반해지"} if term_input_path else None
            records, skipped, status_counts, encoding = read_csv_records(input_path, exclude_status)

            if term_input_path:
                self._post(lambda: self._log(
                    "해지 전용 파일과 병합하므로 실적 CSV의 '일반해지' 행은 건너뛰고 해지 전용 파일 값을 사용합니다."
                ))
                self._post(lambda: self._log("해지 전용 CSV 읽는 중: " + term_input_path))
                term_records, term_skipped, term_excluded_transfer, term_encoding = \
                    read_termination_csv_records(term_input_path)
                records = records + term_records
                self._post(lambda: self._log(
                    "해지 전용 파일: 일반해지 {0:,}건 반영(인코딩 {1}) · 전출해지 {2:,}건 제외 · "
                    "형식 오류로 건너뜀 {3:,}건".format(
                        len(term_records), term_encoding, term_excluded_transfer, term_skipped
                    )
                ))

            if not records:
                raise CsvFormatError("유효한 데이터 행을 찾지 못했습니다.")

            summary = build_summary(records, skipped, status_counts, encoding)
            self._post(lambda: self._log(summary))

            self._post(lambda: self._log("\n대시보드 HTML 생성 중: " + output_path))
            size_bytes = generate_dashboard_html(records, output_path)
            size_mb = size_bytes / (1024 * 1024)
            self._post(lambda: self._log("완료: {0:,} bytes ({1:.1f} MB)".format(size_bytes, size_mb)))

            self.cfg["last_input"] = input_path
            self.cfg["last_term_input"] = term_input_path
            self.cfg["last_output"] = output_path
            self.cfg["open_after"] = self.open_after_var.get()
            save_config(self.cfg)

            self._post(lambda: self._finish_success(output_path))
        except CsvFormatError as e:
            msg = str(e)
            self._post(lambda: self._finish_error("CSV 형식 오류", msg))
        except FileNotFoundError as e:
            msg = str(e)
            self._post(lambda: self._finish_error("파일을 찾을 수 없음", msg))
        except Exception as e:
            # 주의: except 블록을 벗어나면 파이썬이 'e'를 자동으로 해제하므로,
            # 나중에 실행되는(after()로 예약된) 람다에서 e를 직접 참조하면 안 됩니다.
            # 반드시 지금 이 시점에 문자열로 미리 뽑아 둡니다.
            msg = str(e)
            tb = traceback.format_exc()
            self._post(lambda: self._finish_error("예상치 못한 오류", msg + "\n\n" + tb))

    def _post(self, fn):
        self.root.after(0, fn)

    def _finish_success(self, output_path):
        self.progress.stop()
        self.generate_btn.configure(state="normal")
        self.status_var.set("완료: " + output_path)
        self._log("\n대시보드가 생성되었습니다.")
        if self.open_after_var.get():
            try:
                if sys.platform == 'win32':
                    os.startfile(output_path)
                else:
                    webbrowser.open("file://" + os.path.abspath(output_path))
            except Exception:
                pass
        messagebox.showinfo(APP_TITLE, "대시보드 생성이 완료되었습니다.\n\n" + output_path)

    def _finish_error(self, title, message):
        self.progress.stop()
        self.generate_btn.configure(state="normal")
        self.status_var.set("오류 발생")
        self._log("\n[오류] " + title + "\n" + message, error=True)
        messagebox.showerror(APP_TITLE + " - " + title, message)


def _enable_windows_dpi_awareness():
    """Windows에서 화면(고해상도/DPI 배율)을 흐릿하게 강제 확대하지 않고,
    실제 해상도 그대로 또렷하게 그리도록 프로세스를 DPI-aware로 선언합니다.
    반드시 tk.Tk()를 만들기 전에 호출해야 합니다."""
    if sys.platform != "win32":
        return
    try:
        import ctypes
        ctypes.windll.shcore.SetProcessDpiAwareness(1)  # PROCESS_SYSTEM_DPI_AWARE
    except Exception:
        try:
            import ctypes
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


def main():
    _enable_windows_dpi_awareness()
    root = tk.Tk()
    try:
        # 하드코딩된 배율 대신, 실제 시스템 DPI를 읽어 그에 맞춰 Tk 배율을 맞춥니다
        # (100%/125%/150%/200% 등 어떤 배율이든 또렷하게 보이도록).
        dpi_scale = root.winfo_fpixels("1i") / 72.0
        if dpi_scale > 0:
            root.call("tk", "scaling", dpi_scale)
    except Exception:
        pass
    app = DashboardApp(root)
    root.mainloop()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # 콘솔 없이 실행됐을 때도(즉 pythonw) 오류를 남기기 위해 로그 파일에 기록
        err_path = os.path.join(BASE_DIR, "error.log")
        with open(err_path, "a", encoding="utf-8") as f:
            f.write("\n---- " + datetime.now().isoformat() + " ----\n")
            f.write(traceback.format_exc())
        try:
            import tkinter.messagebox as mb
            mb.showerror(APP_TITLE, "프로그램 실행 중 오류가 발생했습니다.\n자세한 내용은 error.log 파일을 확인하세요.")
        except Exception:
            pass
        raise
