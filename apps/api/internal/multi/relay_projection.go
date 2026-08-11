package multi

import (
	"encoding/json"
	"errors"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

var ErrRelayTurnCharacterMissing = errors.New("relay turn character missing from snapshot")

// ValidMultiplayerMode reports whether mode is a supported multiplayer rules module.
func ValidMultiplayerMode(mode MultiplayerMode) bool {
	switch mode {
	case MultiplayerModeRace, MultiplayerModeRelay:
		return true
	default:
		return false
	}
}

// ValidTurnSeconds reports whether a relay turn limit is one of the room-creation choices.
func ValidTurnSeconds(seconds int) bool {
	switch seconds {
	case 30, 60, 90, 120:
		return true
	default:
		return false
	}
}

func GuessResultViewFromGame(result game.GuessResult) GuessResultView {
	feedback := make([]FieldFeedbackView, len(result.Feedback))
	for i, fb := range result.Feedback {
		feedback[i] = FieldFeedbackView{
			Field:        string(fb.Field),
			Label:        fb.Label,
			Status:       string(fb.Status),
			Symbol:       fb.Symbol,
			DisplayValue: fb.DisplayValue,
		}
	}
	return GuessResultView{
		GuessID:        result.GuessID,
		GuessName:      result.GuessName,
		GuessAvatarURL: result.GuessAvatarURL,
		IsCorrect:      result.IsCorrect,
		Feedback:       feedback,
	}
}

func HydrateGuessResultView(guess game.Character, statuses []string, isCorrect bool) GuessResultView {
	return GuessResultViewFromGame(HydrateGuessResult(guess, statuses, isCorrect))
}

func HydrateGuessResultViewWithFields(guess game.Character, statuses []string, isCorrect bool, fields []game.GuessField) GuessResultView {
	return GuessResultViewFromGame(HydrateGuessResultWithFields(guess, statuses, isCorrect, fields))
}

// HydrateRelayTurnRows rebuilds relay's shared board from stored turn rows.
func HydrateRelayTurnRows(turns []repo.MultiTurn, chars map[string]game.Character, memberSlotByID map[string]int32) ([]RelayTurnRow, error) {
	return HydrateRelayTurnRowsWithFields(turns, chars, memberSlotByID, game.CharacterGuessFields)
}

func HydrateRelayTurnRowsWithFields(turns []repo.MultiTurn, chars map[string]game.Character, memberSlotByID map[string]int32, fields []game.GuessField) ([]RelayTurnRow, error) {
	rows := make([]RelayTurnRow, 0, len(turns))
	for _, turn := range turns {
		row := RelayTurnRow{
			Index:      int(turn.TurnIndex),
			MemberSlot: int(memberSlotByID[turn.MemberID]),
			Kind:       RelayTurnKind(turn.Kind),
		}
		if turn.Kind == string(RelayTurnKindGuess) {
			var statuses []string
			if err := json.Unmarshal(turn.Statuses, &statuses); err != nil {
				return nil, err
			}
			guess, ok := chars[turn.GuessID.String]
			if !ok {
				return nil, ErrRelayTurnCharacterMissing
			}
			hydrated := HydrateGuessResultViewWithFields(guess, statuses, turn.IsCorrect, fields)
			row.Guess = &hydrated
		}
		rows = append(rows, row)
	}
	return rows, nil
}
