# Stage 1: Build the React frontend
FROM node:20-slim AS frontend-builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
# API lives on the same origin in production — use relative URLs
ENV VITE_API_URL=""
RUN npm run build

# Stage 2: Python backend + serve the built frontend as static files
FROM python:3.11-slim
WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# Copy frontend build into /app/static so FastAPI can serve it
COPY --from=frontend-builder /app/dist ./static

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
