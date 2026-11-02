FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends gdal-bin python3-gdal python3-numpy python3-reportlab \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . ./

ENV PYTHONNOUSERSITE=1 \
    PYTHONPATH=/usr/lib/python3/dist-packages \
    RASTER_SCRIPTS_ROOT=/opt/arqueo/raster

CMD ["node", "index.js"]
