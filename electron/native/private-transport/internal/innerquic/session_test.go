package innerquic

import "testing"

func TestPrivateQUICConfigKeepsIdleChannelAlive(t *testing.T) {
	config := privateQUICConfig()
	if !config.EnableDatagrams || config.KeepAlivePeriod != privateKeepAlivePeriod ||
		config.MaxIdleTimeout != privateMaxIdleTimeout {
		t.Fatalf("unexpected idle private-channel config: %#v", config)
	}
}
