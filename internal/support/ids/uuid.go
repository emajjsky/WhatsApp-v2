package ids

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"sync/atomic"
	"time"
)

var fallbackCounter atomic.Uint64

func NewUUID() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		now := uint64(time.Now().UTC().UnixNano())
		counter := fallbackCounter.Add(1)
		binary.BigEndian.PutUint64(value[0:8], now)
		binary.BigEndian.PutUint64(value[8:16], now^counter^0xa5a5a5a5a5a5a5a5)
	}

	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80

	buffer := make([]byte, 36)
	hex.Encode(buffer[0:8], value[0:4])
	buffer[8] = '-'
	hex.Encode(buffer[9:13], value[4:6])
	buffer[13] = '-'
	hex.Encode(buffer[14:18], value[6:8])
	buffer[18] = '-'
	hex.Encode(buffer[19:23], value[8:10])
	buffer[23] = '-'
	hex.Encode(buffer[24:36], value[10:16])

	return string(buffer)
}
