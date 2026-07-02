FROM alpine:3.20

RUN apk add --no-cache curl jq

WORKDIR /app

COPY release-watcher.sh /app/

RUN chmod +x /app/release-watcher.sh

# State persisted via volume mount
ENV STATE_DIR=/data
ENV CHECK_INTERVAL=60

CMD ["/app/release-watcher.sh"]
