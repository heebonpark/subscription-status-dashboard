#!/bin/bash
cd "$(dirname "$0")"

echo "청약현황 대시보드 생성기를 준비하는 중입니다..."

if command -v python3 >/dev/null 2>&1; then
    echo "Python3 실행기를 찾았습니다. 프로그램을 시작합니다..."
    python3 app.py
    exit 0
elif command -v python >/dev/null 2>&1; then
    echo "Python 실행기를 찾았습니다. 프로그램을 시작합니다..."
    python app.py
    exit 0
else
    echo ""
    echo "[오류] 이 Mac에서 Python을 찾을 수 없습니다."
    echo ""
    echo " 1) https://www.python.org/downloads/mac-osx/ 에서 Python 3를 설치하세요."
    echo " 2) 설치 완료 후 이 파일을 다시 실행하세요."
    echo ""
    read -p "엔터 키를 누르면 창이 닫힙니다..."
    exit 1
fi
