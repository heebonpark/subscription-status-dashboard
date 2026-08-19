@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo =============================================
echo  청약현황 대시보드 생성기 - 단일 실행파일(exe) 빌드
echo  (Python 설치 없이도 실행 가능한 exe를 만듭니다)
echo =============================================
echo.

where python >nul 2>nul
if not %ERRORLEVEL%==0 (
    echo [오류] Python을 찾을 수 없습니다. 먼저 Python을 설치하세요.
    echo https://www.python.org/downloads/  ^(설치 시 "Add python.exe to PATH" 체크^)
    pause
    exit /b 1
)

echo PyInstaller 설치 확인 중...
python -m pip show pyinstaller >nul 2>nul
if not %ERRORLEVEL%==0 (
    echo PyInstaller가 없어 설치합니다...
    python -m pip install --upgrade pyinstaller
    if not %ERRORLEVEL%==0 (
        echo [오류] PyInstaller 설치에 실패했습니다.
        pause
        exit /b 1
    )
)

echo.
echo 빌드를 시작합니다... (완료까지 1~2분 정도 걸릴 수 있습니다)
python -m PyInstaller --noconfirm --clean --onefile --windowed ^
    --name "청약현황대시보드생성기" ^
    --add-data "template.html;." ^
    app.py

if not %ERRORLEVEL%==0 (
    echo.
    echo [오류] 빌드에 실패했습니다. 위 로그를 확인하세요.
    pause
    exit /b 1
)

echo.
echo =============================================
echo  빌드 완료!
echo  dist\청약현황대시보드생성기.exe 파일을 사용하세요.
echo  (이 exe 파일만 있으면 Python 없이도 실행됩니다)
echo =============================================
echo.
pause
