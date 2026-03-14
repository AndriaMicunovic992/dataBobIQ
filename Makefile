.PHONY: install dev frontend migrate reset-db

install:
	cd backend && pip install -e .
	cd frontend && npm install

dev:
	docker-compose up -d postgres
	cd backend && alembic upgrade head
	cd backend && uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

migrate:
	cd backend && alembic upgrade head

reset-db:
	cd backend && alembic downgrade base && alembic upgrade head
