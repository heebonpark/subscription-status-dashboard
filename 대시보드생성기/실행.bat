@echo off
chcp 65001 >nul
title 청약현황 대시보드 생성기
echo 청약현황 대시보드 생성기를 준비하는 중입니다...
setlocal
cd /d "%~dp0"

rem py / pyw(Python Launcher)를 최우선으로 사용합니다.
rem "python"/"pythonw" 이름은 일부 PC에서 Microsoft Store 설치 안내로 연결되는
rem 가짜 실행 파일(App Execution Alias)로 잡혀 있어 실행이 멈춘 것처럼 보일 수 있는데,
rem py.exe/pyw.exe는 그런 문제가 없는 정식 Python 런처입니다.

where pyw >nul 2>nul
if %ERRORLEVEL%==0 (
    echo Python 실행기를 찾았습니다. 프로그램을 시작합니다...
    start "" pyw "%~dp0app.py"
    goto :done
)

where py >nul 2>nul
if %ERRORLEVEL%==0 (
    echo Python 실행기를 찾았습니다. 프로그램을 시작합니다...
    start "" py -3 "%~dp0app.py"
    goto :done
)

where pythonw >nul 2>nul
if %ERRORLEVEL%==0 (
    echo Python을 찾았습니다. 프로그램을 시작합니다...
    start "" pythonw "%~dp0app.py"
    goto :done
)

where python >nul 2>nul
if %ERRORLEVEL%==0 (
    echo Python을 찾았습니다. 프로그램을 시작합니다...
    start "" python "%~dp0app.py"
    goto :done
)

echo.
echo [오류] 이 컴퓨터에서 Python을 찾을 수 없습니다.
echo.
echo  1^) https://www.python.org/downloads/ 에서 Python 3.10 이상을 설치하세요.
echo  2^) 설치 화면에서 "Add python.exe to PATH" 체크박스를 반드시 선택하세요.
echo  3^) 설치가 끝나면 이 파일을 다시 실행하세요.
echo.
pause
exit /b 1

:done
echo 프로그램 창이 뜰 때까지 몇 초 정도 걸릴 수 있습니다.
echo (백신 프로그램이 처음 실행되는 파일을 검사하면 더 걸릴 수 있습니다)
timeout /t 3 >nul
exit /b 0
