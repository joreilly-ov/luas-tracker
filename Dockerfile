FROM python:3.9

WORKDIR /app

# Install dependencies first (cached layer)
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application code
COPY backend/ .

# App Runner sets PORT env var (default 8080)
ENV PORT=8080

EXPOSE ${PORT}

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT}
