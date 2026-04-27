@echo off
echo ==============================================
echo [1/3] Adding changes to Git...
git add .

echo.
echo [2/3] Committing changes...
git commit -m "auto update from bat file"

echo.
echo [3/3] Pushing changes to GitHub...
git push

echo.
echo ==============================================
echo SUCCESS! Changes sent to GitHub.
echo.
echo Connecting to server to pull changes and restart...
echo (You will be prompted to enter the server password)
echo ==============================================

ssh root@82.202.131.184 "cd /root/wb_feedback && git pull && pm2 restart wb-reply"

echo.
echo ==============================================
echo SERVER UPDATE COMPLETE!
pause
