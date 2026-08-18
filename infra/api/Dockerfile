# syntax=docker/dockerfile:1.7
FROM composer:2.10.2 AS vendor
WORKDIR /build
COPY apps/api/composer.json apps/api/composer.lock* ./
RUN test -f composer.lock
RUN composer install \
    --no-dev \
    --no-interaction \
    --no-progress \
    --no-scripts \
    --prefer-dist \
    --ignore-platform-req=ext-gd \
    --classmap-authoritative
COPY apps/api/ ./
RUN composer dump-autoload --no-dev --classmap-authoritative --no-interaction

FROM php:8.3-fpm-bookworm AS runtime
ARG APP_UID=10001
ARG APP_GID=10001

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        libfcgi-bin \
        libfreetype6 \
        libfreetype6-dev \
        libicu72 \
        libicu-dev \
        libjpeg62-turbo \
        libjpeg62-turbo-dev \
        libonig5 \
        libonig-dev \
        libpng16-16 \
        libpng-dev \
        libpq5 \
        libpq-dev \
        libwebp7 \
        libwebp-dev \
        libxml2 \
        libxml2-dev \
        libzip4 \
        libzip-dev \
        postgresql-client \
        unzip \
        $PHPIZE_DEPS \
    && docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp \
    && docker-php-ext-install -j"$(nproc)" \
        bcmath \
        dom \
        gd \
        intl \
        mbstring \
        opcache \
        pcntl \
        pdo_pgsql \
        zip \
    && pecl install redis \
    && docker-php-ext-enable redis \
    && apt-get purge -y --auto-remove \
        libfreetype6-dev \
        libicu-dev \
        libjpeg62-turbo-dev \
        libonig-dev \
        libpng-dev \
        libpq-dev \
        libwebp-dev \
        libxml2-dev \
        libzip-dev \
        $PHPIZE_DEPS \
    && rm -rf /var/lib/apt/lists/* /tmp/pear

RUN sed -ri 's!^listen = .*!listen = 9000!' /usr/local/etc/php-fpm.d/www.conf \
    && sed -ri 's!^;?listen.allowed_clients =.*!;listen.allowed_clients =!' /usr/local/etc/php-fpm.d/www.conf

RUN groupadd --gid "$APP_GID" roadops \
    && useradd --uid "$APP_UID" --gid "$APP_GID" --create-home --shell /usr/sbin/nologin roadops

WORKDIR /var/www
COPY --from=vendor --chown=roadops:roadops /build/ ./
COPY --chown=roadops:roadops infra/scripts/apply-migrations.sh /usr/local/bin/roadops-apply-migrations
COPY infra/api/zz-roadops.ini /usr/local/etc/php/conf.d/zz-roadops.ini
COPY infra/api/zz-roadops-fpm.conf /usr/local/etc/php-fpm.d/zz-roadops.conf

RUN mkdir -p storage/framework/cache storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
    && chown -R roadops:roadops storage bootstrap/cache \
    && chmod 0755 /usr/local/bin/roadops-apply-migrations

USER roadops
EXPOSE 9000
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=5 \
  CMD SCRIPT_FILENAME=/var/www/public/index.php SCRIPT_NAME=/index.php \
      REQUEST_METHOD=GET REQUEST_URI=/api/v1/health SERVER_PROTOCOL=HTTP/1.1 \
      HTTP_HOST=localhost cgi-fcgi -bind -connect 127.0.0.1:9000 2>/dev/null \
      | grep -q '"status":"ok"'

CMD ["php-fpm", "-F"]

# Local and CI verification target. Development packages and Composer are kept
# out of the default production image below.
FROM runtime AS test
USER root
COPY --from=composer:2.10.2 /usr/bin/composer /usr/local/bin/composer
RUN install -d -o roadops -g roadops /var/www/.phpunit.cache
USER roadops
RUN composer install \
    --no-interaction \
    --no-progress \
    --prefer-dist \
    --classmap-authoritative
COPY --chown=roadops:roadops packages/contracts/ /packages/contracts/
COPY --chown=roadops:roadops docs/iqn/schemas/ /docs/iqn/schemas/
HEALTHCHECK NONE
CMD ["composer", "test"]

FROM runtime AS production
