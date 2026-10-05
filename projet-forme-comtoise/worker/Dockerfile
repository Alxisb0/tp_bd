FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 MPLCONFIGDIR=/tmp/matplotlib
WORKDIR /worker

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# un seul rapport a la fois : pandas garde beaucoup de donnees en memoire
CMD ["celery", "-A", "app", "worker", "--loglevel=info", "--concurrency=1"]
