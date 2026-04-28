@echo off
setlocal

set "KAFKA_HOME=C:\kafka_2.13-3.6.1"
if not exist "%KAFKA_HOME%\bin\windows\kafka-server-start.bat" (
  set "KAFKA_HOME=C:\kafka\kafka_2.13-3.6.1"
)

if not exist "%KAFKA_HOME%\bin\windows\kafka-server-start.bat" (
  echo ERROR: Kafka installation not found.
  echo Expected one of:
  echo   C:\kafka_2.13-3.6.1
  echo   C:\kafka\kafka_2.13-3.6.1
  echo.
  pause
  exit /b 1
)

echo ========================================
echo Starting Kafka (Windows)
echo ========================================
echo.
echo Kafka home: %KAFKA_HOME%
echo.
echo This script will:
echo 1) free ports 2181 and 9092
echo 2) clear stale Kafka/Zookeeper local state
echo 3) start Zookeeper and Kafka in separate windows
echo Keep both windows open!
echo.
pause

echo Stopping stale processes on ports 2181 and 9092...
for %%P in (2181 9092) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr :%%P ^| findstr LISTENING') do (
    taskkill /F /PID %%A >nul 2>&1
  )
)

echo Cleaning stale local Kafka/Zookeeper state...
rd /s /q C:\tmp\zookeeper >nul 2>&1
rd /s /q C:\tmp\kafka-logs >nul 2>&1

echo Starting Zookeeper...
start "Zookeeper" cmd /k "cd /d %KAFKA_HOME% && bin\windows\zookeeper-server-start.bat config\zookeeper.properties"

echo Waiting 10 seconds for Zookeeper to start...
timeout /t 10 /nobreak

echo Starting Kafka...
start "Kafka" cmd /k "cd /d %KAFKA_HOME% && bin\windows\kafka-server-start.bat config\server.properties"

echo.
echo ========================================
echo Kafka started!
echo ========================================
echo.
echo Two new windows should have opened:
echo - Window 1: Zookeeper
echo - Window 2: Kafka
echo.
echo Keep both windows open!
echo.
pause