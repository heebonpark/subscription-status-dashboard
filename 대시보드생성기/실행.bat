@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set PYLAUNCHER=

where pythonw >nul 2>nul
if %ERRORLEVEL%==0 (
    set PYLAUNCHER=pythonw
    goto :run
)

where python >nul 2>nul
if %ERRORLEVEL%==0 (
    set PYLAUNCHER=python
    goto :run
)

where py >nul 2>nul
if %ERRORLEVEL%==0 (
    set PYLAUNCHER=py
    goto :run
)

echo.
echo [오류] 이 컴퓨터에서 Python을 찾을 수 없습니다.
echo.
echo  1) https://www.python.org/downloads/ 에서 Python 3.10 이상을 설치하세요.
echo  2) 설치 화면에서 "Add python.exe to PATH" 체크박스를 반드시 선택하세요.
echo  3) 설치가 끝나면 이 파일을 다시 실행하세요.
echo.
pause
exit /b 1

:run
echo 청약현황 대시보드 생성기를 시작합니다... (%PYLAUNCHER%)
start "" %PYLAUNCHER% "%~dp0app.py"
exit /b 0
