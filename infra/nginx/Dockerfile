FROM nginx:1.29-alpine
RUN rm -f /etc/nginx/conf.d/default.conf \
    && mkdir -p /var/www/public
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY apps/api/public/ /var/www/public/
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/gateway-health || exit 1
