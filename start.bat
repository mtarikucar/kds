@echo off
REM Restaurant POS System - Quick Start Script for Windows
REM This script helps you get the application running quickly

echo.
echo Restaurant POS System - Quick Start
echo ========================================
echo.

REM Check if Docker is installed
where docker >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Docker is not installed. Please install Docker Desktop first.
    echo Visit: https://docs.docker.com/desktop/windows/install/
    pause
    exit /b 1
)

REM Create .env file if it doesn't exist
if not exist .env (
    echo Creating .env file...
    copy .env.production.example .env
    echo.
    echo IMPORTANT: Please edit .env and change the default passwords!
    echo Run: notepad .env
    echo.
    pause
)

REM Create backend .env if it doesn't exist
if not exist backend\.env (
    echo Creating backend\.env file...
    copy backend\.env.example backend\.env
)

REM Create frontend .env if it doesn't exist
if not exist frontend\.env (
    echo Creating frontend\.env file...
    copy frontend\.env.example frontend\.env
)

echo Starting Docker containers...
docker-compose up -d

echo Waiting for services to be ready...
timeout /t 10 /nobreak >nul

echo Running database migrations...
docker-compose exec -T backend npx prisma migrate deploy

echo Seeding database with sample data...
docker-compose exec -T backend npx prisma db seed

echo.
echo ========================================
echo Setup complete!
echo ========================================
echo.
echo Application is now running:
echo   Frontend: http://localhost:5173
echo   Backend:  http://localhost:3000/api
echo   API Docs: http://localhost:3000/api/docs
echo.
echo Default login credentials:
echo   Admin:  admin@restaurant.com / password123
echo   Waiter: waiter@restaurant.com / password123
echo.
echo View logs: docker-compose logs -f
echo Stop: docker-compose down
echo.
echo Remember to change default passwords in production!
echo.
pause
