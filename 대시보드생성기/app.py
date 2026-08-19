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
APP_VERSION = "1.0.0"

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

STATUS_LABELS = {"유지": "유지", "청약": "청약(진행)", "청약취소": "취소/해지"}


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
    s = (raw or "").strip()
    if "취소" in s or "해지" in s:
        return "청약취소"
    if s == "유지" or s == "명변유지":
        return "유지"
    return "청약"


class CsvFormatError(Exception):
    pass


def _parse_with_encoding(path, encoding):
    csv.field_size_limit(sys.maxsize)
    records = []
    skipped = 0
    status_counts = {}

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
            status_counts[raw_status] = status_counts.get(raw_status, 0) + 1
            status = classify_status(raw_status)

            fee_raw = re.sub(r"[^0-9-]", "", (row[i_fee] if i_fee < len(row) else "0") or "0")
            try:
                fee = int(fee_raw) if fee_raw not in ("", "-") else 0
            except ValueError:
                fee = 0

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
            ])

    return records, skipped, status_counts


def read_csv_records(path):
    """UTF-8(BOM 포함) 우선 시도 후, 실패하면 CP949(EUC-KR)로 재시도합니다."""
    last_error = None
    for encoding in ("utf-8-sig", "cp949"):
        try:
            records, skipped, status_counts = _parse_with_encoding(path, encoding)
            return records, skipped, status_counts, encoding
        except UnicodeDecodeError as e:
            last_error = e
            continue
    raise CsvFormatError(
        "CSV 파일의 인코딩을 인식할 수 없습니다 (UTF-8 / CP949 모두 실패). "
        "원본 프로그램에서 CSV로 다시 내보내 주세요."
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
            lines.append("  · {0!r} → {1} : {2:,}건".format(raw, STATUS_LABELS[bucket], cnt))
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
        self.root.geometry("760x620")
        self.root.minsize(680, 520)

        self.cfg = load_config()
        self.input_var = tk.StringVar(value=self.cfg.get("last_input", ""))
        self.output_var = tk.StringVar(value=self.cfg.get("last_output", ""))
        self.open_after_var = tk.BooleanVar(value=self.cfg.get("open_after", True))
        self.status_var = tk.StringVar(value="준비됨")

        self._build_style()
        self._build_widgets()
        self._worker = None

    # ---- UI 구성 ----------------------------------------------------------

    def _build_style(self):
        style = ttk.Style()
        try:
            style.theme_use(style.theme_use())
        except Exception:
            pass
        style.configure("Title.TLabel", font=("Segoe UI", 15, "bold"))
        style.configure("Sub.TLabel", foreground="#666666")
        style.configure("Primary.TButton", font=("Segoe UI", 10, "bold"))
        style.configure("Section.TLabelframe.Label", font=("Segoe UI", 9, "bold"))

    def _build_widgets(self):
        pad = {"padx": 14, "pady": 8}

        header = ttk.Frame(self.root)
        header.pack(fill="x", padx=14, pady=(14, 4))
        ttk.Label(header, text=APP_TITLE, style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            header,
            text="청약 실적 CSV를 선택하면 청약현황 대시보드(HTML)를 자동으로 만들어 드립니다.",
            style="Sub.TLabel",
        ).pack(anchor="w", pady=(2, 0))

        # 입력 파일
        in_frame = ttk.LabelFrame(self.root, text="1. 실적 CSV 파일", style="Section.TLabelframe")
        in_frame.pack(fill="x", **pad)
        row1 = ttk.Frame(in_frame)
        row1.pack(fill="x", padx=10, pady=10)
        ttk.Entry(row1, textvariable=self.input_var).pack(side="left", fill="x", expand=True)
        ttk.Button(row1, text="찾아보기...", command=self.pick_input).pack(side="left", padx=(8, 0))

        # 출력 파일
        out_frame = ttk.LabelFrame(self.root, text="2. 생성할 대시보드 HTML", style="Section.TLabelframe")
        out_frame.pack(fill="x", **pad)
        row2 = ttk.Frame(out_frame)
        row2.pack(fill="x", padx=10, pady=10)
        ttk.Entry(row2, textvariable=self.output_var).pack(side="left", fill="x", expand=True)
        ttk.Button(row2, text="다른 이름으로...", command=self.pick_output).pack(side="left", padx=(8, 0))

        opt_row = ttk.Frame(out_frame)
        opt_row.pack(fill="x", padx=10, pady=(0, 10))
        ttk.Checkbutton(
            opt_row, text="생성 후 브라우저에서 바로 열기", variable=self.open_after_var
        ).pack(anchor="w")

        # 실행 버튼 + 진행바
        action_frame = ttk.Frame(self.root)
        action_frame.pack(fill="x", padx=14, pady=(4, 4))
        self.generate_btn = ttk.Button(
            action_frame, text="대시보드 생성", style="Primary.TButton", command=self.on_generate
        )
        self.generate_btn.pack(side="left")
        self.progress = ttk.Progressbar(action_frame, mode="indeterminate")
        self.progress.pack(side="left", fill="x", expand=True, padx=(12, 0))

        # 로그
        log_frame = ttk.LabelFrame(self.root, text="처리 로그", style="Section.TLabelframe")
        log_frame.pack(fill="both", expand=True, padx=14, pady=(4, 8))
        log_inner = ttk.Frame(log_frame)
        log_inner.pack(fill="both", expand=True, padx=8, pady=8)
        self.log_text = tk.Text(log_inner, wrap="word", height=14, font=("Consolas", 9), state="disabled")
        scroll = ttk.Scrollbar(log_inner, command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=scroll.set)
        self.log_text.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

        # 상태바
        status_bar = ttk.Frame(self.root)
        status_bar.pack(fill="x", side="bottom")
        ttk.Separator(status_bar).pack(fill="x")
        ttk.Label(status_bar, textvariable=self.status_var, padding=(10, 4)).pack(anchor="w")

        if not self.input_var.get():
            self._log("CSV 파일을 선택한 뒤 [대시보드 생성] 버튼을 누르세요.")

    # ---- 로그 유틸 ----------------------------------------------------------

    def _log(self, text):
        self.log_text.configure(state="normal")
        self.log_text.insert("end", text + "\n")
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
        output_path = self.output_var.get().strip()

        if not input_path:
            messagebox.showwarning(APP_TITLE, "실적 CSV 파일을 선택해 주세요.")
            return
        if not os.path.isfile(input_path):
            messagebox.showerror(APP_TITLE, "선택한 CSV 파일을 찾을 수 없습니다:\n" + input_path)
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
            target=self._run_pipeline, args=(input_path, output_path), daemon=True
        )
        self._worker.start()

    def _run_pipeline(self, input_path, output_path):
        try:
            self._post(lambda: self._log("CSV 읽는 중: " + input_path))
            records, skipped, status_counts, encoding = read_csv_records(input_path)

            if not records:
                raise CsvFormatError("유효한 데이터 행을 찾지 못했습니다.")

            summary = build_summary(records, skipped, status_counts, encoding)
            self._post(lambda: self._log(summary))

            self._post(lambda: self._log("\n대시보드 HTML 생성 중: " + output_path))
            size_bytes = generate_dashboard_html(records, output_path)
            size_mb = size_bytes / (1024 * 1024)
            self._post(lambda: self._log("완료: {0:,} bytes ({1:.1f} MB)".format(size_bytes, size_mb)))

            self.cfg["last_input"] = input_path
            self.cfg["last_output"] = output_path
            self.cfg["open_after"] = self.open_after_var.get()
            save_config(self.cfg)

            self._post(lambda: self._finish_success(output_path))
        except CsvFormatError as e:
            self._post(lambda: self._finish_error("CSV 형식 오류", str(e)))
        except FileNotFoundError as e:
            self._post(lambda: self._finish_error("파일을 찾을 수 없음", str(e)))
        except Exception as e:
            tb = traceback.format_exc()
            self._post(lambda: self._finish_error("예상치 못한 오류", str(e) + "\n\n" + tb))

    def _post(self, fn):
        self.root.after(0, fn)

    def _finish_success(self, output_path):
        self.progress.stop()
        self.generate_btn.configure(state="normal")
        self.status_var.set("완료: " + output_path)
        self._log("\n대시보드가 생성되었습니다.")
        if self.open_after_var.get():
            try:
                webbrowser.open(pathlib.Path(output_path).resolve().as_uri())
            except Exception:
                pass
        messagebox.showinfo(APP_TITLE, "대시보드 생성이 완료되었습니다.\n\n" + output_path)

    def _finish_error(self, title, message):
        self.progress.stop()
        self.generate_btn.configure(state="normal")
        self.status_var.set("오류 발생")
        self._log("\n[오류] " + title + "\n" + message)
        messagebox.showerror(APP_TITLE + " - " + title, message)


def main():
    root = tk.Tk()
    try:
        root.call("tk", "scaling", 1.2)
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
