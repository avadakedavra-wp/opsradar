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
