package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

//go:embed bundle/project.zip
var bundledSources embed.FS

const sourceArchive = "bundle/project.zip"
const maxEmbeddedFile = 256 << 20

func archiveBytes() ([]byte, error) { return bundledSources.ReadFile(sourceArchive) }
func archiveDigest() (string, error) {
	data, err := archiveBytes()
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:]), nil
}

// Prefer editable sources when EXE is next to a full project.
// Otherwise use source files embedded IN EXE, never the working directory.
func resolveProjectDirectory(exeDir string) (dir string, bundled bool, err error) {
	if fileExists(filepath.Join(exeDir, "package.json")) && fileExists(filepath.Join(exeDir, "src", "main.tsx")) {
		return exeDir, false, nil
	}
	cacheRoot, err := os.UserCacheDir()
	if err != nil {
		return "", false, fmt.Errorf("folder pamieci podrecznej uzytkownika: %w", err)
	}
	digest, err := archiveDigest()
	if err != nil {
		return "", false, err
	}
	// Versioned by the digest, so replacing EXE never mixes two source versions.
	return filepath.Join(cacheRoot, "FalconBEND", "versions", digest[:16]), true, nil
}
func fileExists(file string) bool {
	info, err := os.Stat(file)
	return err == nil && !info.IsDir()
}

func ensureBundledProject(target string) error {
	digest, err := archiveDigest()
	if err != nil {
		return err
	}
	stamp := filepath.Join(target, ".falcon-source-digest")
	if saved, err := os.ReadFile(stamp); err == nil && strings.TrimSpace(string(saved)) == digest &&
		fileExists(filepath.Join(target, "package.json")) && fileExists(filepath.Join(target, "src", "main.tsx")) &&
		fileExists(filepath.Join(target, "vite.config.ts")) {
		return nil
	}
	data, err := archiveBytes()
	if err != nil {
		return err
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return fmt.Errorf("nie mozna otworzyc archiwum: %w", err)
	}
	parent := filepath.Dir(target)
	if err := os.MkdirAll(parent, 0700); err != nil {
		return err
	}
	tmp, err := os.MkdirTemp(parent, ".falcon-unpack-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	for _, zf := range zr.File {
		name := zf.Name
		if name == "" || strings.HasPrefix(name, "/") || strings.Contains(name, "\\") || strings.Contains(name, ":") {
			return fmt.Errorf("niedozwolona sciezka archiwum: %q", name)
		}
		clean := filepath.Clean(filepath.FromSlash(name))
		if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || clean != filepath.FromSlash(name) {
			return fmt.Errorf("niedozwolona sciezka archiwum: %q", name)
		}
		if zf.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("nieobslugiwane dowiazanie: %q", name)
		}
		dest := filepath.Join(tmp, clean)
		if zf.FileInfo().IsDir() {
			if err := os.MkdirAll(dest, 0700); err != nil {
				return err
			}
			continue
		}
		if zf.UncompressedSize64 > maxEmbeddedFile {
			return errors.New("zbyt duzy plik w archiwum")
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0700); err != nil {
			return err
		}
		in, err := zf.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
		if err != nil {
			in.Close()
			return err
		}
		n, copyErr := io.Copy(out, io.LimitReader(in, maxEmbeddedFile+1))
		closeErr := out.Close()
		inErr := in.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if inErr != nil {
			return inErr
		}
		if n > maxEmbeddedFile {
			return errors.New("zbyt duzy plik w archiwum")
		}
	}
	if !fileExists(filepath.Join(tmp, "package.json")) || !fileExists(filepath.Join(tmp, "src", "main.tsx")) {
		return errors.New("niepelna paczka zrodlowa")
	}
	if err := os.WriteFile(filepath.Join(tmp, ".falcon-source-digest"), []byte(digest+"\n"), 0600); err != nil {
		return err
	}
	// Safe to replace only this application-managed versioned cache folder.
	if err := os.RemoveAll(target); err != nil {
		return err
	}
	if err := os.Rename(tmp, target); err != nil {
		return fmt.Errorf("nie mozna przeniesc plikow do folderu aplikacji: %w", err)
	}
	return nil
}
