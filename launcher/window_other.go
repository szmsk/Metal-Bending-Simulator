//go:build !windows

package main

import "os/exec"

func hideChildWindow(_ *exec.Cmd) {}
func openBrowser(url string) error { return exec.Command("xdg-open", url).Start() }
