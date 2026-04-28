@echo off
setlocal

echo ========================================
echo Cleaning Kafka (Windows)
echo ========================================
echo.
echo This will:
echo 1) stop listeners on ports 2181 and 9092
echo 2) delete C:\tmp\zookeeper and C:\tmp\kafka-logs
echo.
echo This fixes NodeExistsException and dirty state startup issues.
echo.
pause

echo Stopping stale processes on ports 2181 and 9092...
for %%P in (2181 9092) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr :%%P ^| findstr LISTENING') do (
    taskkill /F /PID %%A >nul 2>&1
  )
)

echo Deleting C:\tmp\zookeeper...
rd /s /q C:\tmp\zookeeper
echo Deleting C:\tmp\kafka-logs...
rd /s /q C:\tmp\kafka-logs

echo.
echo ========================================
echo Directories cleaned! You can now start Kafka normally.
echo ========================================
echo.
pause
