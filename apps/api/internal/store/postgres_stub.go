package store

import "time"

// PostgresStub is a compile-time placeholder for a future PostgreSQL backend.
// It satisfies the Store interface but panics at runtime if any method is called.
// Replace with a real implementation when migrating off SQLite.
type PostgresStub struct{}

var _ Store = (*PostgresStub)(nil) // compile-time interface check

func (p *PostgresStub) CreateScan(_ Scan) error                   { panic("postgres not implemented") }
func (p *PostgresStub) UpdateScan(_, _ string, _ time.Time) error { panic("postgres not implemented") }
func (p *PostgresStub) FinishScan(_, _ string, _ time.Time, _, _ int, _ string) error {
	panic("postgres not implemented")
}
func (p *PostgresStub) ListScans() ([]ScanRow, error)            { panic("postgres not implemented") }
func (p *PostgresStub) CreateScanTarget(_ ScanTarget) error      { panic("postgres not implemented") }
func (p *PostgresStub) CreateFinding(_ Finding) error            { panic("postgres not implemented") }
func (p *PostgresStub) GetFinding(_ string) (Finding, error)     { panic("postgres not implemented") }
func (p *PostgresStub) ListFindings(_ string) ([]Finding, error) { panic("postgres not implemented") }
func (p *PostgresStub) ResolveFinding(_ string) error            { panic("postgres not implemented") }
func (p *PostgresStub) GetRadar() ([]RadarRow, error)            { panic("postgres not implemented") }
func (p *PostgresStub) GetSetting(_ string) (string, error)      { panic("postgres not implemented") }
func (p *PostgresStub) SetSetting(_, _ string) error             { panic("postgres not implemented") }
func (p *PostgresStub) DeleteSetting(_ string) error             { panic("postgres not implemented") }
func (p *PostgresStub) Close() error                             { panic("postgres not implemented") }
