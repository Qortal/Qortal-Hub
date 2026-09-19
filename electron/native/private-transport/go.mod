module qortal.org/qortal-hub/private-transport

go 1.26.0

replace github.com/mengelbart/moqtransport => ./third_party/moqtransport

replace github.com/quic-go/quic-go => ./third_party/quic-go

replace github.com/quic-go/masque-go => ./third_party/masque-go

require (
	github.com/cloudflare/circl v1.6.5
	github.com/mengelbart/moqtransport v0.5.1-0.20260831154657-9eaf40a4dedd
	github.com/quic-go/masque-go v0.5.0
	github.com/quic-go/quic-go v0.62.0
	github.com/yosida95/uritemplate/v3 v3.0.2
)

require (
	github.com/dunglas/httpsfv v1.1.0 // indirect
	github.com/quic-go/qpack v0.6.0 // indirect
	golang.org/x/crypto v0.54.0 // indirect
	golang.org/x/net v0.56.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
	golang.org/x/text v0.40.0 // indirect
)
