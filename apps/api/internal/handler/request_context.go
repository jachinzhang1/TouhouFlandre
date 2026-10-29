package handler

import "context"

type requestHeaderContextKey struct{}

// WithIfNoneMatch carries the conditional request header through the strict
// OpenAPI handler, whose method signature intentionally receives only context.
func WithIfNoneMatch(ctx context.Context, value string) context.Context {
	return context.WithValue(ctx, requestHeaderContextKey{}, value)
}

func ifNoneMatch(ctx context.Context) string {
	value, _ := ctx.Value(requestHeaderContextKey{}).(string)
	return value
}
