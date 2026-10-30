FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./
RUN mkdir /data && chown node:node /data
USER node
ENV OSTLER_SYNC_DATA=/data PORT=8080
VOLUME /data
EXPOSE 8080
CMD ["node", "server.mjs"]
