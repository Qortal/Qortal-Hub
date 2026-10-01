# Datagram buffer accessors

Base: upstream masque-go v0.5.0, with its MIT license and tests retained.
Only `datagram_buffer.go` is added. It exposes the admitted tunnel's HTTP/3
receive-buffer opt-in and numeric snapshot through `Conn`.

It requires the paired quic-go module replacement. There are no changes to
CONNECT-UDP framing, certificates, ticket authorization, forwarding or encryption.
Keep this copy identical between Hub and the relay. On upgrade, rebase this one
file and run the upstream tests and real tunnel integration tests.
