package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

const modulePath = "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/"

func main() {
	root, err := os.Getwd()
	if err != nil {
		fail(err)
	}
	paths := []string{
		filepath.Join(root, "internal", "multi"),
		filepath.Join(root, "internal", "handler"),
		filepath.Join(root, "internal", "hub"),
	}
	var violations []string
	for _, path := range paths {
		err := filepath.WalkDir(path, func(filename string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() || !strings.HasSuffix(filename, ".go") || strings.HasSuffix(filename, "_test.go") {
				return nil
			}
			file, err := parser.ParseFile(token.NewFileSet(), filename, nil, parser.ImportsOnly)
			if err != nil {
				return err
			}
			imports := importedPaths(file)
			relative, err := filepath.Rel(root, filename)
			if err != nil {
				return err
			}
			violations = append(violations, checkFile(filepath.ToSlash(relative), imports)...)
			return nil
		})
		if err != nil {
			fail(err)
		}
	}
	if len(violations) > 0 {
		sort.Strings(violations)
		for _, violation := range violations {
			fmt.Fprintln(os.Stderr, violation)
		}
		os.Exit(1)
	}
	fmt.Println("multiplayer package boundaries: ok")
}

func importedPaths(file *ast.File) []string {
	paths := make([]string, 0, len(file.Imports))
	for _, spec := range file.Imports {
		path, err := strconv.Unquote(spec.Path.Value)
		if err == nil {
			paths = append(paths, path)
		}
	}
	return paths
}

func checkFile(filename string, imports []string) []string {
	var violations []string
	isCore := strings.HasPrefix(filename, "internal/multi/core/")
	isRaceDomain := strings.HasPrefix(filename, "internal/multi/race/") && !strings.HasPrefix(filename, "internal/multi/race/adapter/")
	isRelayDomain := strings.HasPrefix(filename, "internal/multi/relay/") && !strings.HasPrefix(filename, "internal/multi/relay/adapter/")
	isModePackage := isCore || strings.HasPrefix(filename, "internal/multi/race/") || strings.HasPrefix(filename, "internal/multi/relay/")
	isAssembly := strings.HasPrefix(filename, "internal/multi/assembly/")
	importsRace := false
	importsRelay := false
	for _, imported := range imports {
		if strings.HasPrefix(imported, modulePath+"race") {
			importsRace = true
		}
		if strings.HasPrefix(imported, modulePath+"relay") {
			importsRelay = true
		}
		if isCore && (strings.HasPrefix(imported, modulePath+"race") || strings.HasPrefix(imported, modulePath+"relay")) {
			violations = append(violations, filename+": multiplayer core imports a concrete mode: "+imported)
		}
		if isRaceDomain && strings.HasPrefix(imported, modulePath+"relay") {
			violations = append(violations, filename+": race domain imports relay: "+imported)
		}
		if isRelayDomain && strings.HasPrefix(imported, modulePath+"race") {
			violations = append(violations, filename+": relay domain imports race: "+imported)
		}
		if isModePackage && forbiddenDomainImport(imported) {
			violations = append(violations, filename+": mode domain imports transport/generated infrastructure: "+imported)
		}
	}
	if importsRace && importsRelay && !isAssembly {
		violations = append(violations, filename+": only the assembly package may import both race and relay")
	}
	return violations
}

func forbiddenDomainImport(imported string) bool {
	return imported == "net/http" ||
		strings.Contains(imported, "/internal/generated/openapi") ||
		strings.Contains(imported, "/internal/hub")
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
