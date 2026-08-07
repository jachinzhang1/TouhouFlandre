package multi

import (
	"crypto/rand"
	"strings"
)

// roomCodeAlphabet 房间号字符集（08 §4.1：去除易混 0/O/1/I 的 32 字符集）。
const roomCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// RoomCodeLength 房间号长度（6 位 → 约 10.7 亿组合）。
const RoomCodeLength = 6

// GenerateRoomCode 生成 6 位房间号（crypto/rand，无偏样本取模与 newSessionID 同模式）。
func GenerateRoomCode() string {
	raw := make([]byte, RoomCodeLength)
	if _, err := rand.Read(raw); err != nil {
		panic("multi: crypto/rand unavailable: " + err.Error())
	}
	code := make([]byte, RoomCodeLength)
	for i, b := range raw {
		code[i] = roomCodeAlphabet[int(b)%len(roomCodeAlphabet)]
	}
	return string(code)
}

// NormalizeRoomCode 房间号输入归一化（08 §4.1）：去空格/连字符、转大写。
func NormalizeRoomCode(input string) string {
	input = strings.ReplaceAll(input, " ", "")
	input = strings.ReplaceAll(input, "-", "")
	return strings.ToUpper(input)
}
