SHELL := /bin/sh

.PHONY: help check-env build up down logs migrate php-test web-check contracts e2e verify

help:
	@echo "RoadOps targets:"
	@echo "  check-env  validate required local secret placeholders"
	@echo "  build      build all OCI images"
	@echo "  up         run the production-like local stack"
	@echo "  migrate    apply immutable SQL migrations"
	@echo "  verify     run backend, frontend, contract and E2E checks"
	@echo "  down       stop the stack without deleting data"

check-env:
	@test -s .env || (echo "Create .env with: cp infra/local.env.example .env" >&2; exit 1)
	@grep -Eq '^APP_KEY=.+$$' .env || (echo "APP_KEY is required." >&2; exit 1)
	@grep -Eq '^POSTGRES_PASSWORD=.+$$' .env || (echo "POSTGRES_PASSWORD is required." >&2; exit 1)
	@grep -Eq '^DB_PASSWORD=.+$$' .env || (echo "DB_PASSWORD is required." >&2; exit 1)
	@grep -Eq '^DB_SYNC_PASSWORD=.+$$' .env || (echo "DB_SYNC_PASSWORD is required." >&2; exit 1)

build: check-env
	docker compose build --pull

up: check-env
	docker compose up --build --detach

down:
	docker compose down

logs:
	docker compose logs --follow --tail=200 gateway api worker scheduler

migrate: check-env
	docker compose run --rm migrate

php-test:
	@test -f apps/api/composer.lock || (echo "apps/api/composer.lock is required; generate it in the pinned PHP 8.3/Composer 2.10.2 toolchain." >&2; exit 1)
	docker build --target test --tag roadops-api-test:local --file infra/api/Dockerfile .
	docker run --rm roadops-api-test:local sh -lc 'composer format:check && composer analyse && composer test'

web-check:
	docker build --target test --tag roadops-web-test:local --file infra/web/Dockerfile .
	docker run --rm roadops-web-test:local sh -lc 'npm run lint && npm run typecheck && npm run test && npm run build'

contracts:
	npx --yes @redocly/cli@2.46.1 lint packages/contracts/openapi.yaml
	npx --yes --package=ajv-cli@5.0.0 --package=ajv-formats@3.0.1 ajv validate --spec=draft2020 --strict=false -c ajv-formats -s packages/contracts/external/ytp/proposed-event.schema.json -d 'packages/contracts/external/ytp/samples/*.json'
	npx --yes --package=ajv-cli@5.0.0 --package=ajv-formats@3.0.1 ajv validate --spec=draft2020 --strict=false -c ajv-formats -s packages/contracts/external/roadvision/proposed-result-event.schema.json -d 'packages/contracts/external/roadvision/samples/*.json'
	npx --yes --package=ajv-cli@5.0.0 --package=ajv-formats@3.0.1 ajv compile --spec=draft2020 --strict=false -c ajv-formats -r packages/contracts/external/roadvision/proposed-result-event.schema.json -s packages/contracts/external/roadvision/proposed-s3-manifest.schema.json

e2e:
	cd apps/web && npx playwright install chromium && npm run test:e2e

verify: php-test web-check contracts e2e
