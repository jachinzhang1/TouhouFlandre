package multi

import "testing"

type fixedRandomSource struct{ value int }

func (r fixedRandomSource) IntN(n int) int { return r.value % n }

func TestDrawAnswerUsesInjectedRandomSource(t *testing.T) {
	pool := []string{"a", "b", "c", "d"}
	answer, err := DrawAnswer(pool, map[string]bool{"b": true}, fixedRandomSource{value: 4})
	if err != nil {
		t.Fatal(err)
	}
	// Candidates are a,c,d; 4 mod 3 deterministically selects c.
	if answer != "c" {
		t.Fatalf("answer = %q, want c", answer)
	}
}
