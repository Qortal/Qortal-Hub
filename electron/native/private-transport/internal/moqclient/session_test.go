package moqclient

import "testing"

func TestMediaQUICConfigKeepsSilentCallAlive(t *testing.T) {
	config := mediaQUICConfig()
	if !config.EnableDatagrams || config.KeepAlivePeriod != mediaKeepAlivePeriod ||
		config.MaxIdleTimeout != mediaMaxIdleTimeout {
		t.Fatalf("unexpected idle media config: %#v", config)
	}
}
