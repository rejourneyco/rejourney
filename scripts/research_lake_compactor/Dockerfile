FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

COPY scripts/research_lake_compactor/requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

COPY scripts/research_lake_compactor/compactor.py /app/compactor.py

USER nobody

CMD ["python", "/app/compactor.py"]
