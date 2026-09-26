.PHONY: dev build lint test seed clean

dev:
	@echo "Starting API and Dashboard in dev mode..."
	@(cd apps/api && go run main.go) &
	@(cd apps/dashboard && npm run dev) &
	@wait

build:
	@echo "Building API..."
	cd apps/api && go build -o ../../bin/opsradar-api ./...
	@echo "Building Dashboard..."
	cd apps/dashboard && npm run build

lint:
	@echo "Linting Go..."
	cd apps/api && go vet ./...
	@echo "Linting Dashboard..."
	cd apps/dashboard && npm run lint
	@echo "Linting Helm..."
	helm lint deploy/helm

test:
	@echo "Running unit tests..."
	cd apps/api && go test ./...

test-integration:
	@echo "Running integration tests (requires live cluster)..."
	cd apps/api && go test ./... -tags integration

seed:
	@echo "Applying demo seed to cluster..."
	kubectl create namespace ops-radar-demo --dry-run=client -o yaml | kubectl apply -f -
	kubectl apply -k seed/demo-cluster/
	@echo "Seed applied. Run a scan to see findings."

clean:
	rm -rf bin/
	cd apps/dashboard && rm -rf .next node_modules

# ── Release ──────────────────────────────────────────────────────────────────
# Builds a distributable tar.gz for each platform + updates the Homebrew formula.
# Usage: make release VERSION=0.2.0
VERSION ?= 0.1.0
RELEASE_DIR := dist/opsradar-v$(VERSION)

release: release-build release-package release-formula
	@echo ""
	@echo "Release artifacts in dist/:"
	@ls dist/*.tar.gz dist/checksums.txt 2>/dev/null

release-build:
	@echo "==> Building API binaries..."
	@mkdir -p bin
	cd apps/api && GOOS=darwin  GOARCH=arm64  go build -ldflags "-s -w -X main.Version=$(VERSION)" -o ../../bin/opsradar-api-darwin-arm64  .
	cd apps/api && GOOS=darwin  GOARCH=amd64  go build -ldflags "-s -w -X main.Version=$(VERSION)" -o ../../bin/opsradar-api-darwin-amd64  .
	cd apps/api && GOOS=linux   GOARCH=amd64  go build -ldflags "-s -w -X main.Version=$(VERSION)" -o ../../bin/opsradar-api-linux-amd64   .
	cd apps/api && GOOS=linux   GOARCH=arm64  go build -ldflags "-s -w -X main.Version=$(VERSION)" -o ../../bin/opsradar-api-linux-arm64   .
	@echo "==> Building Next.js dashboard (standalone)..."
	cd apps/dashboard && npm ci --prefer-offline && npm run build

release-package:
	@echo "==> Packaging..."
	@mkdir -p dist
	@for platform in darwin-arm64 darwin-amd64 linux-amd64 linux-arm64; do \
		name="opsradar-v$(VERSION)-$$platform"; \
		dir="$(RELEASE_DIR)-$$platform"; \
		mkdir -p "$$dir/bin"; \
		cp "bin/opsradar-api-$$platform" "$$dir/bin/opsradar-api"; \
		cp scripts/opsradar "$$dir/bin/opsradar"; \
		sed -i.bak \
			"s|__DASHBOARD_DIR__|~/.opsradar/dashboard|g; s|__VERSION__|$(VERSION)|g" \
			"$$dir/bin/opsradar" && rm -f "$$dir/bin/opsradar.bak"; \
		chmod +x "$$dir/bin/opsradar" "$$dir/bin/opsradar-api"; \
		cd apps/dashboard/.next/standalone && tar -czf - . | (cd "../../../../$$dir" && mkdir dashboard && cd dashboard && tar -xzf -) && cd ../../../..; \
		mkdir -p "$$dir/dashboard/.next"; \
		cp -r apps/dashboard/.next/static "$$dir/dashboard/.next/static"; \
		[ -d apps/dashboard/public ] && cp -r apps/dashboard/public "$$dir/dashboard/public" || true; \
		tar -czf "dist/$$name.tar.gz" -C "dist" "$$(basename $$dir)"; \
		echo "  ✓ dist/$$name.tar.gz"; \
	done

release-formula:
	@echo "==> Computing sha256 and updating Homebrew formula..."
	@cd dist && for f in *.tar.gz; do \
		shasum -a 256 "$$f" | awk '{print $$1, $$2}'; \
	done > checksums.txt && cat checksums.txt
	@ARM64_SHA=$$(grep "darwin-arm64" dist/checksums.txt | awk '{print $$1}'); \
	AMD64_SHA=$$(grep "darwin-amd64" dist/checksums.txt | awk '{print $$1}'); \
	LINUX_AMD64_SHA=$$(grep "linux-amd64" dist/checksums.txt | awk '{print $$1}'); \
	LINUX_ARM64_SHA=$$(grep "linux-arm64" dist/checksums.txt | awk '{print $$1}'); \
	sed -i.bak \
		-e "s|PLACEHOLDER_ARM64_SHA256|$$ARM64_SHA|g" \
		-e "s|PLACEHOLDER_AMD64_SHA256|$$AMD64_SHA|g" \
		-e "s|PLACEHOLDER_LINUX_AMD64_SHA256|$$LINUX_AMD64_SHA|g" \
		-e "s|PLACEHOLDER_LINUX_ARM64_SHA256|$$LINUX_ARM64_SHA|g" \
		homebrew-tap/Formula/opsradar.rb && rm -f homebrew-tap/Formula/opsradar.rb.bak
	@echo "  ✓ homebrew-tap/Formula/opsradar.rb updated"
