package protocol

import (
	"sync"
	"time"
)

type reliableJob struct {
	bytes    int
	enqueued time.Time
	run      func(bool)
}

// One worker per active opaque stream key preserves ordering without serializing
// unrelated streams in the IPC reader. Idle workers disappear immediately.
type reliableDispatcher struct {
	maxQueueAge time.Duration
	mu          sync.Mutex
	queues      map[string][]reliableJob
	bytes       int
	workers     sync.WaitGroup
}

func (d *reliableDispatcher) submit(key string, size int, run func(bool)) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.queues == nil {
		d.queues = make(map[string][]reliableJob)
	}
	queue, exists := d.queues[key]
	if (!exists && len(d.queues) >= 64) || len(queue) >= 16 || d.bytes+size > 4*1024*1024 {
		return false
	}
	d.bytes += size
	d.queues[key] = append(queue, reliableJob{size, time.Now(), run})
	if exists {
		return true
	}
	d.workers.Add(1)
	go func() {
		defer d.workers.Done()
		for {
			d.mu.Lock()
			queue := d.queues[key]
			if len(queue) == 0 {
				delete(d.queues, key)
				d.mu.Unlock()
				return
			}
			job := queue[0]
			d.queues[key] = queue[1:]
			d.mu.Unlock()
			age := d.maxQueueAge
			if age == 0 {
				age = time.Second
			}
			job.run(time.Since(job.enqueued) <= age)
			d.mu.Lock()
			d.bytes -= job.bytes
			d.mu.Unlock()
		}
	}()
	return true
}
