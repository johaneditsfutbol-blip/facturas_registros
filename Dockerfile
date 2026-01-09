# Usamos la imagen oficial de Puppeteer (ya trae Chrome listo)
FROM ghcr.io/puppeteer/puppeteer:21.5.0

# Usamos usuario root para evitar problemas de permisos
USER root

# Directorio de trabajo
WORKDIR /usr/src/app

# Copiamos los archivos de configuración
COPY package*.json ./

# Instalamos dependencias (Usamos install para evitar errores de lockfile)
RUN npm install

# Copiamos el resto del código
COPY . .

# Exponemos el puerto
EXPOSE 3000

# Comando de arranque
CMD [ "node", "index.js" ]
