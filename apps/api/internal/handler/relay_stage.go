package handler

import (
	"context"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
)

// RoomsRelayEncounterAction exposes the MRX-003 action shape without enabling
// encounter gameplay. MRX-006 owns validation, turn execution, and persistence.
func (s *Server) RoomsRelayEncounterAction(_ context.Context, _ openapi.RoomsRelayEncounterActionRequestObject) (openapi.RoomsRelayEncounterActionResponseObject, error) {
	return openapi.RoomsRelayEncounterAction501JSONResponse{
		Code:  codeFeatureDisabled,
		Error: "relay encounter actions are not enabled",
	}, nil
}

// RoomsListRelayStageHistory exposes the history contract while the relay
// projector and pagination implementation remain owned by MRX-011.
func (s *Server) RoomsListRelayStageHistory(_ context.Context, _ openapi.RoomsListRelayStageHistoryRequestObject) (openapi.RoomsListRelayStageHistoryResponseObject, error) {
	return openapi.RoomsListRelayStageHistory501JSONResponse{
		Code:  codeFeatureDisabled,
		Error: "relay stage history is not enabled",
	}, nil
}
