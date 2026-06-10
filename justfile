set dotenv-load := true

registry-dev:
	pnpm --filter @sail/registry dev

console-dev:
	pnpm --filter @sail/console dev

db-up:
	docker compose -f ops/local/compose.yml up -d --wait --wait-timeout 90 postgres

db-down:
	docker compose -f ops/local/compose.yml down

db-migrate:
	pnpm --filter @sail/registry db:migrate

db-verify:
	pnpm --filter @sail/registry db:verify

test-db: db-up
	pnpm --filter @sail/registry db:migrate
	pnpm test:db

durable-registry-check: db-up
	pnpm --filter @sail/registry db:migrate
	pnpm --filter @sail/registry test:db
	pnpm --filter @sail/registry check

gateway-build:
	./gradlew :minecraft:gateway:build

companion-build:
	./gradlew :minecraft:companion:build

protocol-check:
	pnpm protocol:check

check:
	pnpm check
	./gradlew test :minecraft:gateway:build :minecraft:companion:build

test:
	pnpm test
	./gradlew test

verify-local:
	just db-down
	pnpm check
	pnpm test
	./gradlew test

verify-local-db: db-up
	pnpm --filter @sail/registry db:migrate
	pnpm test:db
	pnpm test

structure-check:
	pnpm structure:check

smoke-local:
	node ops/local/smoke-local.mjs

smoke-local-api:
	node ops/local/smoke-local.mjs --skip-servers

runtime-artifacts:
	@du -sh .sail-smoke .sail-ui-run build platform/console/dist minecraft/gateway/build minecraft/companion/build node_modules platform/console/node_modules platform/registry/node_modules protocol/node_modules .gradle 2>/dev/null || true

runtime-clean-ui:
	rm -f .sail-ui-run/*.pid .sail-ui-run/*.log
	rmdir .sail-ui-run 2>/dev/null || true
