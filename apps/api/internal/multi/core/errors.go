package core

import (
	"errors"
	"fmt"
)

// ErrorCode is a stable, transport-independent multiplayer domain error.
type ErrorCode string

const (
	ErrorMissingRuleSet        ErrorCode = "MISSING_RULE_SET"
	ErrorUnknownMode           ErrorCode = "UNKNOWN_MODE"
	ErrorUnknownRuleSetKey     ErrorCode = "UNKNOWN_RULE_SET_KEY"
	ErrorUnknownRuleSetVersion ErrorCode = "UNKNOWN_RULE_SET_VERSION"
	ErrorInvalidRuleSet        ErrorCode = "INVALID_RULE_SET"
	ErrorMissingCapability     ErrorCode = "MISSING_CAPABILITY"
	ErrorDuplicateRegistration ErrorCode = "DUPLICATE_REGISTRATION"
	ErrorInvalidConfiguration  ErrorCode = "INVALID_CONFIGURATION"
	ErrorUnsupportedCommand    ErrorCode = "UNSUPPORTED_COMMAND"
)

// DomainError keeps mode failures independent from HTTP and OpenAPI types.
type DomainError struct {
	Code       ErrorCode
	Mode       Mode
	RuleSet    RuleSetRef
	Capability string
	Detail     string
}

func (e *DomainError) Error() string {
	message := string(e.Code)
	if e.Mode != "" {
		message += ": mode=" + string(e.Mode)
	}
	if e.RuleSet.Key != "" || e.RuleSet.Version != 0 {
		message += ": rule_set=" + e.RuleSet.String()
	}
	if e.Capability != "" {
		message += ": capability=" + e.Capability
	}
	if e.Detail != "" {
		message += ": " + e.Detail
	}
	return message
}

func newError(code ErrorCode, mode Mode, ref RuleSetRef, capability, detail string) error {
	return &DomainError{Code: code, Mode: mode, RuleSet: ref, Capability: capability, Detail: detail}
}

// HasErrorCode supports stable assertions without coupling callers to messages.
func HasErrorCode(err error, code ErrorCode) bool {
	var domainErr *DomainError
	return errors.As(err, &domainErr) && domainErr.Code == code
}

func duplicateRegistration(mode Mode, capability string) error {
	return newError(ErrorDuplicateRegistration, mode, RuleSetRef{}, capability, "already registered")
}

func missingCapability(mode Mode, capability string) error {
	return newError(ErrorMissingCapability, mode, RuleSetRef{}, capability, "not registered")
}

func invalidConfiguration(mode Mode, detail string) error {
	return newError(ErrorInvalidConfiguration, mode, RuleSetRef{}, "", detail)
}

func unsupportedCommand(ref RuleSetRef, command CommandName) error {
	return newError(ErrorUnsupportedCommand, ref.Mode, ref, "command_handler", fmt.Sprintf("command %q is not supported", command))
}
