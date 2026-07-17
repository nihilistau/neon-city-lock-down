@echo off
cd /d "%~dp0"
start "" http://localhost:8420
node tools\serve.mjs 8420
